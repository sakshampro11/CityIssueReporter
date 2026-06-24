const express = require('express');
const { db }  = require('../config/firestore');

const router = express.Router();

const CATEGORIES = ['Pothole', 'Water', 'Electric', 'Waste', 'Streetlight', 'Sanitation', 'Road', 'Other'];
const STATUSES   = ['Reported', 'Verified', 'In Progress', 'Resolved'];

const GEMINI_MODEL_URLS = [
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
  'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent',
];
const INSIGHTS_CACHE_TTL  = 60 * 60 * 1000; // 1 hour
const INSIGHTS_WINDOW_DAYS = 30;
const INSIGHTS_CACHE_DOC  = 'insightsCache';

let memoryInsightsCache = null;

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

function buildRecentSummary(issues, now) {
  const cutoff = new Date(now.getTime() - INSIGHTS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recent = issues.filter(issue => {
    const created = issue.createdAt ? new Date(issue.createdAt) : null;
    return created && !isNaN(created) && created >= cutoff;
  });

  const comboMap = {};
  const byCategory = emptyCategoryCounts();
  const byArea = {};
  const byStatusRecent = emptyStatusCounts();
  let highPriority = 0;
  let totalConfirmations = 0;

  recent.forEach(issue => {
    const category = normalizeCategory(issue.issueType);
    const area = normalizeArea(issue) || 'Unknown area';
    byCategory[category]++;
    byArea[area] = (byArea[area] || 0) + 1;

    const status = STATUSES.includes(issue.status) ? issue.status : 'Reported';
    byStatusRecent[status]++;
    if (issue.priority === 'High') highPriority++;
    totalConfirmations += typeof issue.confirmations === 'number' ? issue.confirmations : 0;

    const key = `${area}::${category}`;
    if (!comboMap[key]) comboMap[key] = { area, category, count: 0 };
    comboMap[key].count++;
  });

  return {
    recentCount: recent.length,
    windowDays: INSIGHTS_WINDOW_DAYS,
    topAreaCategoryCombos: Object.values(comboMap).sort((a, b) => b.count - a.count).slice(0, 15),
    categoryTotals: byCategory,
    topAreas: Object.entries(byArea)
      .map(([area, count]) => ({ area, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    statusBreakdown: byStatusRecent,
    highPriorityCount: highPriority,
    totalConfirmations,
  };
}

function hasEnoughDataForInsights(summary) {
  return summary.recentCount >= 3;
}

function sanitizeInsights(raw) {
  if (!raw?.insights || !Array.isArray(raw.insights)) return [];
  return raw.insights
    .filter(i => i && typeof i.text === 'string' && i.text.trim())
    .slice(0, 4)
    .map(i => ({
      text: i.text.trim(),
      severity: ['info', 'watch', 'urgent'].includes(i.severity) ? i.severity : 'info',
    }));
}

function parseGeminiJson(text) {
  const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  return JSON.parse(cleaned);
}

async function readInsightsCache() {
  try {
    const doc = await db.collection('stats').doc(INSIGHTS_CACHE_DOC).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (!data?.generatedAt) return null;
    if (!data.insights?.length && data.message?.includes('temporarily unavailable')) return null;
    const age = Date.now() - new Date(data.generatedAt).getTime();
    if (age >= INSIGHTS_CACHE_TTL) return null;
    return { ...data, cached: true };
  } catch (err) {
    console.warn('Insights Firestore cache read failed:', err.message);
    return null;
  }
}

async function writeInsightsCache(payload) {
  try {
    await db.collection('stats').doc(INSIGHTS_CACHE_DOC).set(payload);
  } catch (err) {
    console.warn('Insights Firestore cache write failed:', err.message);
  }
  memoryInsightsCache = payload;
}

function readMemoryCache() {
  if (!memoryInsightsCache?.generatedAt) return null;
  const age = Date.now() - new Date(memoryInsightsCache.generatedAt).getTime();
  if (age >= INSIGHTS_CACHE_TTL) return null;
  return { ...memoryInsightsCache, cached: true };
}

async function callGeminiForInsights(summary) {
  const prompt = `You are analyzing civic issue reports for a community dashboard.

Here is an aggregate summary of issues from the last ${summary.windowDays} days (${summary.recentCount} total reports). This is pre-aggregated data — do not invent numbers not present here.

${JSON.stringify({
  areaCategoryCombos: summary.topAreaCategoryCombos,
  categoryTotals: summary.categoryTotals,
  topAreas: summary.topAreas,
  statusBreakdown: summary.statusBreakdown,
  highPriorityCount: summary.highPriorityCount,
  totalConfirmations: summary.totalConfirmations,
}, null, 2)}

Identify recurring patterns or escalating problems. Write 2-4 short insight bullets in plain, citizen-friendly language (e.g. "5 water-related reports near 58 Charak Sadan apartments in the last 30 days — this may indicate a recurring pipeline issue worth escalated attention.").

Return ONLY valid JSON in this exact shape:
{
  "insights": [
    { "text": "...", "severity": "info" }
  ]
}

Rules:
- Maximum 4 insights
- severity must be exactly one of: "info", "watch", "urgent"
- Use "urgent" only for clear escalation (multiple same-area same-category reports, many unresolved high-priority issues)
- Use "watch" for emerging or growing patterns
- Use "info" for general helpful observations
- Do not mention individual resolvers, officials, or citizens by name
- Reference specific areas and categories from the data when relevant
- Do not wrap the JSON in markdown`;

  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
  let lastError = null;

  for (const apiUrl of GEMINI_MODEL_URLS) {
    const response = await fetch(`${apiUrl}?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const data = await response.json();
    if (!response.ok) {
      lastError = new Error(data?.error?.message || 'Gemini API returned an error');
      continue;
    }

    const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!responseText) {
      lastError = new Error('Empty response from Gemini');
      continue;
    }

    return sanitizeInsights(parseGeminiJson(responseText));
  }

  throw lastError || new Error('All Gemini models failed');
}

async function generateInsights() {
  const now = new Date();
  const snapshot = await db.collection('issues').get();
  const issues = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const summary = buildRecentSummary(issues, now);

  if (!hasEnoughDataForInsights(summary)) {
    return {
      insights: [],
      message: 'Not enough data yet for AI insights — check back as more issues are reported.',
      generatedAt: now.toISOString(),
      cached: false,
      cacheable: true,
    };
  }

  if (!process.env.GEMINI_API_KEY) {
    return {
      insights: [],
      message: 'AI insights are temporarily unavailable.',
      generatedAt: now.toISOString(),
      cached: false,
      cacheable: false,
    };
  }

  try {
    const insights = await callGeminiForInsights(summary);
    return {
      insights,
      message: insights.length
        ? null
        : 'No notable patterns detected in recent reports yet.',
      generatedAt: now.toISOString(),
      cached: false,
      cacheable: true,
    };
  } catch (err) {
    console.error('Gemini insights generation failed:', err.message);
    return {
      insights: [],
      message: 'AI insights are temporarily unavailable. Please check back later.',
      generatedAt: now.toISOString(),
      cached: false,
      cacheable: false,
    };
  }
}

// GET /api/stats/insights — AI-generated pattern insights (cached 1 hour)
router.get('/insights', async (req, res) => {
  try {
    const cached = (await readInsightsCache()) || readMemoryCache();
    if (cached) {
      return res.json({
        insights: cached.insights || [],
        message: cached.message || null,
        generatedAt: cached.generatedAt,
        cached: true,
      });
    }

    const result = await generateInsights();
    if (result.cacheable !== false) {
      await writeInsightsCache({
        insights: result.insights,
        message: result.message,
        generatedAt: result.generatedAt,
      });
    }

    const { cacheable, ...payload } = result;
    res.json(payload);
  } catch (err) {
    console.error('Error fetching AI insights:', err);
    res.json({
      insights: [],
      message: 'AI insights are temporarily unavailable. Please check back later.',
      generatedAt: new Date().toISOString(),
      cached: false,
    });
  }
});

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
