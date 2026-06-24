const express = require('express');
const { db } = require('../config/firestore');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

async function requireResolver(req, res, next) {
  try {
    const userDoc = await db.collection('users').doc(req.user.userId).get();
    if (!userDoc.exists || userDoc.data().role !== 'resolver') {
      return res.status(403).json({ message: 'Access denied: Resolvers only' });
    }
    req.resolverUser = { id: userDoc.id, ...userDoc.data() };
    next();
  } catch (error) {
    return res.status(500).json({ message: 'Error checking resolver access', error: error.message });
  }
}

function simpleName(name = '', email = '') {
  const source = (name || email || 'Resolver').trim();
  return source.split(/\s+/)[0];
}

router.get('/leaderboard', authenticateToken, requireResolver, async (_req, res) => {
  try {
    const snapshot = await db.collection('users').get();
    const leaders = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(user => user.role === 'resolver')
      .sort((a, b) => (b.resolverIssuesResolved || 0) - (a.resolverIssuesResolved || 0))
      .map(user => ({
        id: user.id,
        name: simpleName(user.name, user.email),
        issuesResolved: Number.isFinite(user.resolverIssuesResolved) ? user.resolverIssuesResolved : 0,
        badges: Array.isArray(user.badges)
          ? user.badges.filter(badge => ['5 Issues Resolved', '10 Issues Resolved', '25 Issues Resolved'].includes(badge))
          : [],
      }));

    res.json({ leaders });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching resolver leaderboard', error: error.message });
  }
});

module.exports = router;
