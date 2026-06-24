const express = require('express');
const { db }  = require('../config/firestore');

const router = express.Router();

const CATEGORIES = ['Pothole', 'Water', 'Electric', 'Waste', 'Streetlight', 'Sanitation', 'Road', 'Other'];
const STATUSES   = ['Reported', 'Verified', 'In Progress', 'Resolved'];

function getResolvedTimestamp(issue) {
  const history = issue.statusHistory || [];
  const resolved = [...history].reverse().find(h => h.status === 'Resolved');
  if (resolved?.timestamp) return new Date(resolved.timestamp);
  if (issue.status === 'Resolved' && issue.updatedAt) return new Date(issue.updatedAt);
  return null;
}

function normalizeCategory(issueType) {
  if (!issueType || typeof issueType !== 'string') return 'Other';
  const match = CATEGORIES.find(c => c.toLowerCase() === issueType.trim().toLowerCase());
  return match || 'Other';
}

function normalizeArea(issue) {
  const addr = issue.location?.address || issue.address || null;
  if (!addr || typeof addr !== 'string') return null;
  const trimmed = addr.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed === '—') return null;
  return trimmed;
}

function isThisMonth(date, now) {
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function emptyCategoryCounts() {
  return Object.fromEntries(CATEGORIES.map(c => [c, 0]));
}

function emptyStatusCounts() {
  return Object.fromEntries(STATUSES.map(s => [s, 0]));
}

// GET /api/stats/impact — citywide aggregate stats (no per-resolver data)
router.get('/impact', async (req, res) => {
  try {
    const snapshot = await db.collection('issues').get();
    const now = new Date();
    const issues = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const byCategory = emptyCategoryCounts();
    const byStatus   = emptyStatusCounts();
    const areaMap    = {};

    let totalAllTime       = 0;
    let totalThisMonth     = 0;
    let resolvedAllTime    = 0;
    let resolvedThisMonth  = 0;
    let totalConfirmations = 0;
    const resolutionDays   = [];

    issues.forEach(issue => {
      totalAllTime++;

      const createdAt = issue.createdAt ? new Date(issue.createdAt) : null;
      if (createdAt && !isNaN(createdAt) && isThisMonth(createdAt, now)) {
        totalThisMonth++;
      }

      const category = normalizeCategory(issue.issueType);
      byCategory[category]++;

      const status = STATUSES.includes(issue.status) ? issue.status : 'Reported';
      byStatus[status]++;

      totalConfirmations += typeof issue.confirmations === 'number' ? issue.confirmations : 0;

      const area = normalizeArea(issue);
      if (area) {
        const key = area.toLowerCase();
        if (!areaMap[key]) areaMap[key] = { area, count: 0 };
        areaMap[key].count++;
      }

      if (issue.status === 'Resolved') {
        resolvedAllTime++;
        const resolvedAt = getResolvedTimestamp(issue);
        if (resolvedAt && !isNaN(resolvedAt)) {
          if (isThisMonth(resolvedAt, now)) resolvedThisMonth++;
          if (createdAt && !isNaN(createdAt) && resolvedAt > createdAt) {
            const days = (resolvedAt - createdAt) / (1000 * 60 * 60 * 24);
            resolutionDays.push(days);
          }
        }
      }
    });

    const hasData = totalAllTime > 0;
    const hasEnoughForRate = totalAllTime > 0;
    const hasEnoughForAvgTime = resolutionDays.length > 0;

    const resolutionRate = hasEnoughForRate
      ? Math.round((resolvedAllTime / totalAllTime) * 1000) / 10
      : null;

    const avgResolutionDays = hasEnoughForAvgTime
      ? Math.round((resolutionDays.reduce((a, b) => a + b, 0) / resolutionDays.length) * 10) / 10
      : null;

    const topAreas = Object.values(areaMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    res.json({
      hasData,
      totals: {
        allTime: totalAllTime,
        thisMonth: totalThisMonth,
      },
      resolution: {
        resolvedThisMonth,
        resolvedAllTime,
        resolutionRate,
        avgResolutionDays,
        hasEnoughForRate,
        hasEnoughForAvgTime,
        resolvedCountForAvg: resolutionDays.length,
      },
      byCategory,
      byStatus,
      topAreas,
      community: {
        totalConfirmations,
      },
      generatedAt: now.toISOString(),
    });
  } catch (err) {
    console.error('Error fetching impact stats:', err);
    res.status(500).json({ message: 'Failed to fetch impact stats', error: err.message });
  }
});

module.exports = router;
