const express = require('express');
const upload  = require('../middleware/upload');
const fs      = require('fs');

const router = express.Router();

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent';

router.post('/', upload.array('media', 5), async (req, res) => {
  try {
    const { description } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ message: 'GEMINI_API_KEY is not configured.' });
    }

    const prompt = `Analyze the following community issue report.
Description: "${description || ''}"

Please extract and return a JSON object with the following fields:
- "category": Choose one of ["Pothole", "Water", "Electric", "Waste", "Streetlight", "Other"]
- "priority": Choose one of ["Low", "Medium", "High"]
- "title": A short, clear title for the issue (max 50 chars)
- "summary": A brief 1-2 sentence summary of the issue

Return ONLY the raw JSON object. Do not wrap it in markdown or code fences.`;

    const parts = [{ text: prompt }];

    // Attach the first uploaded image (if any) as inline base64 data
    if (req.files && req.files.length > 0) {
      const file = req.files[0];
      if (file.mimetype.startsWith('image/')) {
        parts.push({
          inlineData: {
            data: fs.readFileSync(file.path).toString('base64'),
            mimeType: file.mimetype
          }
        });
      }
    }

    const response = await fetch(`${GEMINI_API_URL}?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini API error:', data?.error?.message);
      return res.status(500).json({
        message: 'Gemini API returned an error.',
        error: data?.error?.message || 'Unknown error'
      });
    }

    const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let analysis;
    try {
      const cleaned = responseText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      analysis = JSON.parse(cleaned);
    } catch (e) {
      console.error('Failed to parse Gemini response as JSON:', responseText);
      return res.status(500).json({ message: 'Failed to generate structured data from AI.' });
    }

    res.json(analysis);

  } catch (error) {
    console.error('Error during AI analysis:', error.message);
    res.status(500).json({ message: 'Error analyzing issue with AI', error: error.message });
  }
});

module.exports = router;
