const express = require('express');
const { db } = require('../config/firestore');

const router = express.Router();

function normalizeLeaderboardUser(user = {}, id) {
  return {
    id,
    name: user.name || user.email || 'Citizen',
    points: Number.isFinite(user.points) ? user.points : 0,
    badges: Array.isArray(user.badges) ? user.badges : [],
    role: user.role || 'citizen',
  };
}

// GET /api/leaderboard — citizen-only top users by points
router.get('/', async (_req, res) => {
  try {
    const snapshot = await db.collection('users').get();
    const leaders = snapshot.docs
      .map(doc => normalizeLeaderboardUser(doc.data(), doc.id))
      .filter(user => user.role !== 'resolver')
      .sort((a, b) => b.points - a.points)
      .slice(0, 20)
      .map(({ id, name, points, badges }) => ({ id, name, points, badges }));

    res.json({ leaders });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching leaderboard', error: error.message });
  }
});

module.exports = router;
