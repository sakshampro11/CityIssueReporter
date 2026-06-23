const express = require('express');
const cors    = require('cors');
const path    = require('path');
require('dotenv').config();

// Initialise Firebase Admin SDK + Firestore (must happen before routes load)
require('./config/firestore');

const app = express();



// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Serve static frontend files
app.use(express.static('frontend'));

// Serve uploaded media files at /uploads/*
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',           require('./routes/auth'));
app.use('/api/issues/analyze', require('./routes/analyze'));
app.use('/api/issues',         require('./routes/issues'));

// Health-check route
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', project: 'community-hero' });
});

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`🚀 Lokally server running on port ${PORT}`);
  console.log(`   Frontend: http://localhost:${PORT}/landing.html`);

  // Seed default resolver account if not present
  try {
    const bcrypt = require('bcryptjs');
    const { db } = require('./config/firestore');
    const snapshot = await db.collection('users')
      .where('email', '==', 'resolver@lokally.com')
      .limit(1)
      .get();

    if (snapshot.empty) {
      const hashedPassword = await bcrypt.hash('resolverpassword', 10);
      await db.collection('users').add({
        name: 'Seeded Resolver',
        email: 'resolver@lokally.com',
        password: hashedPassword,
        role: 'resolver',
        phone: '0000000000',
        address: 'HQ City Hall',
        createdAt: new Date().toISOString()
      });
      console.log('✅ Default resolver account seeded (resolver@lokally.com / resolverpassword)');
    } else {
      console.log('ℹ️ Resolver account already exists.');
    }
  } catch (error) {
    console.error('❌ Error seeding resolver account:', error);
  }
});
