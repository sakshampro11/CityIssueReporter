const admin = require('firebase-admin');
const path  = require('path');

/**
 * Firebase Admin SDK initialisation.
 *
 * Service account key is loaded from one of two sources (in priority order):
 *   1. FIREBASE_SERVICE_ACCOUNT_PATH env var  — absolute or relative path to the JSON file
 *   2. The bundled ./firebase-service-account.json in this directory (never commit to git)
 *
 * FIREBASE_PROJECT_ID env var is used as a safety check to confirm the right
 * project is being targeted at startup.
 */

// Only initialise once (guards against hot-reload double-init)
if (!admin.apps.length) {
  // If FIREBASE_SERVICE_ACCOUNT_PATH is set via env, resolve it relative to the
  // project root (process.cwd()). The default falls back to the sibling JSON
  // file in the same directory as this module (__dirname).
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    ? path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
    : path.join(__dirname, 'firebase-service-account.json');

  const serviceAccount = require(serviceAccountPath);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
  });

  console.log(
    `✅ Firebase Admin SDK initialised — project: ${admin.app().options.projectId}`
  );
}

const db = admin.firestore();

module.exports = { admin, db };
