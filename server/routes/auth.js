const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { db }  = require('../config/firestore');

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
      createdAt: new Date().toISOString(),
    });

    const token = jwt.sign(
      { userId: docRef.id },
      process.env.JWT_SECRET || 'community-hero-secret-key'
    );

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: { id: docRef.id, name, email, role: 'citizen' },
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

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId },
      process.env.JWT_SECRET || 'community-hero-secret-key'
    );

    res.json({
      token,
      user: {
        id:      userId,
        name:    user.name,
        email:   user.email,
        phone:   user.phone,
        address: user.address,
        role:    user.role || 'citizen',
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Error logging in', error: error.message });
  }
});

module.exports = router;
