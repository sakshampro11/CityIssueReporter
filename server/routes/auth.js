const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { db }  = require('../config/firestore');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find a user document by email.
 * Firestore has no unique-index concept, so we query by field and take the
 * first result. Emails are enforced as unique in the register handler.
 *
 * @param {string} email
 * @returns {Promise<{id: string, data: object} | null>}
 */
async function findUserByEmail(email) {
  const snapshot = await db.collection('users')
    .where('email', '==', email)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, data: doc.data() };
}

function normalizeUserGamification(user = {}) {
  return {
    points: Number.isFinite(user.points) ? user.points : 0,
    badges: Array.isArray(user.badges) ? user.badges : [],
    reportsCount: Number.isFinite(user.reportsCount) ? user.reportsCount : 0,
    verificationsCount: Number.isFinite(user.verificationsCount) ? user.verificationsCount : 0,
    resolvedReportsCount: Number.isFinite(user.resolvedReportsCount) ? user.resolvedReportsCount : 0,
    resolverIssuesResolved: Number.isFinite(user.resolverIssuesResolved) ? user.resolverIssuesResolved : 0,
  };
}

// ── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, address, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    // Enforce email uniqueness
    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ message: 'An account with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Write new user document to Firestore "users" collection
    // See server/models/User.js for the full document shape reference.
    const docRef = await db.collection('users').add({
      name,
      email,
      phone:     phone   || null,
      address:   address || null,
      password:  hashedPassword,
      role:      'citizen',
      points: 0,
      badges: [],
      reportsCount: 0,
      verificationsCount: 0,
      resolvedReportsCount: 0,
      resolverIssuesResolved: 0,
      createdAt: new Date().toISOString(),
    });

    const token = jwt.sign(
      { userId: docRef.id },
      process.env.JWT_SECRET || 'community-hero-secret-key'
    );

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: {
        id: docRef.id,
        name,
        email,
        role: 'citizen',
        points: 0,
        badges: [],
        reportsCount: 0,
        verificationsCount: 0,
        resolvedReportsCount: 0,
        resolverIssuesResolved: 0,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Error creating account', error: error.message });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const userRecord = await findUserByEmail(email);
    if (!userRecord) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const { id: userId, data: user } = userRecord;
    const normalized = normalizeUserGamification(user);

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId },
      process.env.JWT_SECRET || 'community-hero-secret-key'
    );

    // Backfill old users missing gamification fields.
    if (
      user.points === undefined ||
      user.badges === undefined ||
      user.reportsCount === undefined ||
      user.verificationsCount === undefined ||
      user.resolvedReportsCount === undefined
      || user.resolverIssuesResolved === undefined
    ) {
      await db.collection('users').doc(userId).update({
        points: normalized.points,
        badges: normalized.badges,
        reportsCount: normalized.reportsCount,
        verificationsCount: normalized.verificationsCount,
        resolvedReportsCount: normalized.resolvedReportsCount,
        resolverIssuesResolved: normalized.resolverIssuesResolved,
      });
    }

    res.json({
      token,
      user: {
        id:      userId,
        name:    user.name,
        email:   user.email,
        phone:   user.phone,
        address: user.address,
        role:    user.role || 'citizen',
        points: normalized.points,
        badges: normalized.badges,
        reportsCount: normalized.reportsCount,
        verificationsCount: normalized.verificationsCount,
        resolvedReportsCount: normalized.resolvedReportsCount,
        resolverIssuesResolved: normalized.resolverIssuesResolved,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Error logging in', error: error.message });
  }
});

// ── GET /api/auth/me ───────────────────────────────────────────────────────
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userDoc.data();
    const normalized = normalizeUserGamification(user);
    if (
      user.points === undefined ||
      user.badges === undefined ||
      user.reportsCount === undefined ||
      user.verificationsCount === undefined ||
      user.resolvedReportsCount === undefined
      || user.resolverIssuesResolved === undefined
    ) {
      await db.collection('users').doc(req.user.userId).update({
        points: normalized.points,
        badges: normalized.badges,
        reportsCount: normalized.reportsCount,
        verificationsCount: normalized.verificationsCount,
        resolvedReportsCount: normalized.resolvedReportsCount,
        resolverIssuesResolved: normalized.resolverIssuesResolved,
      });
    }

    res.json({
      id: userDoc.id,
      name: user.name,
      email: user.email,
      phone: user.phone || null,
      address: user.address || null,
      role: user.role || 'citizen',
      points: normalized.points,
      badges: normalized.badges,
      reportsCount: normalized.reportsCount,
      verificationsCount: normalized.verificationsCount,
      resolvedReportsCount: normalized.resolvedReportsCount,
      resolverIssuesResolved: normalized.resolverIssuesResolved,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user profile', error: error.message });
  }
});

// ── PUT /api/auth/me ───────────────────────────────────────────────────────
router.put('/me', authenticateToken, async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    const updates = {
      updatedAt: new Date().toISOString(),
    };

    if (typeof name === 'string') updates.name = name.trim() || null;
    if (typeof phone === 'string') updates.phone = phone.trim() || null;
    if (typeof address === 'string') updates.address = address.trim() || null;

    const userRef = db.collection('users').doc(req.user.userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    await userRef.update(updates);
    const updatedDoc = await userRef.get();
    const updated = updatedDoc.data();
    const normalized = normalizeUserGamification(updated);

    res.json({
      id: updatedDoc.id,
      name: updated.name,
      email: updated.email,
      phone: updated.phone || null,
      address: updated.address || null,
      role: updated.role || 'citizen',
      points: normalized.points,
      badges: normalized.badges,
      reportsCount: normalized.reportsCount,
      verificationsCount: normalized.verificationsCount,
      resolvedReportsCount: normalized.resolvedReportsCount,
      resolverIssuesResolved: normalized.resolverIssuesResolved,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating profile', error: error.message });
  }
});

module.exports = router;
