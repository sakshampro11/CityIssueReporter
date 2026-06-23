const express           = require('express');
const { db }            = require('../config/firestore');
const authenticateToken = require('../middleware/auth');
const upload            = require('../middleware/upload');
const { saveFile }      = require('../services/storage');

const router = express.Router();

// ── POST /api/issues — submit a new issue (public, no auth required) ─────────
// Accepts up to 5 files via the `media` field (multipart/form-data).
router.post('/', upload.array('media', 5), async (req, res) => {
  try {
    console.log('Received issue data:', req.body);

    const {
      name, email, phone, address,
      lat, lng,
      issueType, description, priority, reporterId,
      title, summary
    } = req.body;

    // ── Persist uploaded files via the storage service ──────────────────────
    // saveFile() is the only place to change if you switch to Firebase Storage.
    let mediaUrls = [];
    if (req.files && req.files.length > 0) {
      const results = await Promise.all(req.files.map(f => saveFile(f)));
      mediaUrls = results.map(r => r.url);
    }

    const issueData = {
      name:        name        || null,
      email:       email       || null,
      phone:       phone       || null,
      // location stores structured geodata; address kept at top level for backwards compat.
      address:     address     || null,
      location: {
        address: address || null,
        lat:     lat     ? parseFloat(lat) : null,
        lng:     lng     ? parseFloat(lng) : null,
      },
      issueType:   issueType   || null,
      description: description || null,
      title:       title       || null,
      summary:     summary     || null,
      priority:    priority    || 'Low',
      status:      'Reported',
      statusHistory: [
        {
          status: 'Reported',
          timestamp: new Date().toISOString(),
          note: 'Issue reported by citizen.'
        }
      ],
      // mediaUrls stores an array; mediaUrl kept for backwards compatibility.
      mediaUrls:   mediaUrls,
      mediaUrl:    mediaUrls[0] || null,
      reporterId:  reporterId  || null,
      confirmations: 0,
      confirmedBy:   [],
      commentsList:  [],
      comments:      0,
      createdAt:   new Date().toISOString(),
      updatedAt:   null,
    };

    const docRef = await db.collection('issues').add(issueData);
    console.log('Issue saved successfully with ID:', docRef.id);

    res.status(201).json({
      message: 'Issue submitted successfully',
      issue: { id: docRef.id, ...issueData },
    });
  } catch (error) {
    console.error('Error submitting issue:', error);
    res.status(500).json({ message: 'Error submitting issue', error: error.message });
  }
});

// ── GET /api/issues — list all issues (authenticated users only) ─────────────
router.get('/', authenticateToken, async (req, res) => {
  try {
    // Ordered by createdAt descending to match original Mongoose sort
    const snapshot = await db.collection('issues')
      .orderBy('createdAt', 'desc')
      .get();

    const issues = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(issues);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching issues', error: error.message });
  }
});

// ── GET /api/issues/:id ──────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('issues').doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({ message: 'Issue not found' });
    }

    res.json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching issue', error: error.message });
  }
});

// ── PUT /api/issues/:id — update issue (e.g. status change) ─────────────────
router.put('/:id', async (req, res) => {
  try {
    const docRef = db.collection('issues').doc(req.params.id);
    const doc    = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: 'Issue not found' });
    }

    // Merge the incoming fields; always refresh updatedAt
    const updates = { ...req.body, updatedAt: new Date().toISOString() };
    await docRef.update(updates);

    // Return the full merged document
    const updated = await docRef.get();
    res.json({ id: updated.id, ...updated.data() });
  } catch (error) {
    res.status(500).json({ message: 'Error updating issue', error: error.message });
  }
});

// ── DELETE /api/issues/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const docRef = db.collection('issues').doc(req.params.id);
    const doc    = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: 'Issue not found' });
    }

    await docRef.delete();
    res.json({ message: 'Issue deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting issue', error: error.message });
  }
});

// ── POST /api/issues/:id/confirm — confirm an issue (authenticated users only) ──
router.post('/:id/confirm', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const docRef = db.collection('issues').doc(req.params.id);
    const doc    = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: 'Issue not found' });
    }

    const data = doc.data();
    const confirmedBy = data.confirmedBy || [];

    // Prevent same user from confirming twice
    if (confirmedBy.includes(userId)) {
      return res.status(400).json({ message: 'You have already confirmed this issue.' });
    }

    const newConfirmations = (data.confirmations || 0) + 1;
    const updates = {
      confirmations: newConfirmations,
      confirmedBy: [...confirmedBy, userId],
      updatedAt: new Date().toISOString()
    };

    // Once an issue crosses 3 confirmations, automatically mark it as "Verified"
    if (newConfirmations >= 3 && data.status !== 'Verified') {
      updates.status = 'Verified';
      
      const statusHistory = data.statusHistory || [
        { status: 'Reported', timestamp: data.createdAt || new Date().toISOString(), note: 'Issue reported by citizen.' }
      ];
      updates.statusHistory = [
        ...statusHistory,
        {
          status: 'Verified',
          timestamp: new Date().toISOString(),
          note: 'Community verified (3+ confirmations).'
        }
      ];
    }

    await docRef.update(updates);

    const updatedDoc = await docRef.get();
    res.json({ id: updatedDoc.id, ...updatedDoc.data() });
  } catch (error) {
    console.error('Error confirming issue:', error);
    res.status(500).json({ message: 'Error confirming issue', error: error.message });
  }
});

// ── PUT /api/issues/:id/status — update status (Resolvers only) ─────────────────
router.put('/:id/status', authenticateToken, upload.array('media', 5), async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!status || !note) {
      return res.status(400).json({ message: 'Status and note are required' });
    }

    // Verify user is a resolver
    const userDoc = await db.collection('users').doc(req.user.userId).get();
    if (!userDoc.exists || userDoc.data().role !== 'resolver') {
      return res.status(403).json({ message: 'Access denied: Resolvers only' });
    }

    const docRef = db.collection('issues').doc(req.params.id);
    const doc    = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Issue not found' });
    }

    // Save uploaded files if any
    let mediaUrls = [];
    if (req.files && req.files.length > 0) {
      const results = await Promise.all(req.files.map(f => saveFile(f)));
      mediaUrls = results.map(r => r.url);
    }

    const data = doc.data();
    
    // Support fallback for older issues that don't have statusHistory
    const statusHistory = data.statusHistory || [
      { status: 'Reported', timestamp: data.createdAt || new Date().toISOString(), note: 'Issue reported by citizen.' }
    ];

    const newHistoryEntry = {
      status,
      timestamp: new Date().toISOString(),
      note: note.trim(),
      mediaUrls
    };

    const updates = {
      status,
      statusHistory: [...statusHistory, newHistoryEntry],
      updatedAt: new Date().toISOString()
    };

    if (status === 'Resolved') {
      updates.resolutionProof = {
        note: note.trim(),
        mediaUrls
      };
    }

    await docRef.update(updates);
    const updatedDoc = await docRef.get();
    res.json({ id: updatedDoc.id, ...updatedDoc.data() });
  } catch (error) {
    console.error('Error updating issue status:', error);
    res.status(500).json({ message: 'Error updating issue status', error: error.message });
  }
});

// ── POST /api/issues/:id/comments — add a comment (authenticated users only) ──
router.post('/:id/comments', authenticateToken, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'Comment text is required' });
    }

    const docRef = db.collection('issues').doc(req.params.id);
    const doc    = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Issue not found' });
    }

    // Fetch user details from database to get name and role
    const userDoc = await db.collection('users').doc(req.user.userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    const userData = userDoc.data();

    const data = doc.data();
    const commentsList = data.commentsList || [];

    const newComment = {
      username: userData.name || userData.email || 'Anonymous',
      role: userData.role || 'citizen',
      text: text.trim(),
      timestamp: new Date().toISOString()
    };

    const updatedComments = [...commentsList, newComment];

    const updates = {
      commentsList: updatedComments,
      comments: updatedComments.length,
      updatedAt: new Date().toISOString()
    };

    await docRef.update(updates);
    const updatedDoc = await docRef.get();
    res.json({ id: updatedDoc.id, ...updatedDoc.data() });
  } catch (error) {
    console.error('Error posting comment:', error);
    res.status(500).json({ message: 'Error posting comment', error: error.message });
  }
});

module.exports = router;
