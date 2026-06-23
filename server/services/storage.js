/**
 * storage.js — Swappable file-storage service
 *
 * Currently saves files to the local /server/uploads folder and returns a
 * public URL path.  When you're ready to switch to Firebase Storage, replace
 * the body of `saveFile` (and add `deleteFile` if you need it) without
 * touching any other part of the codebase.
 *
 * Expected interface:
 *   saveFile(file)  → Promise<{ url: string }>
 *     `file` is the Express/Multer file object (req.file or req.files[n]).
 */

const path = require('path');

/**
 * Save a file that Multer has already written to disk and return its public URL.
 *
 * @param {Express.Multer.File} file  — Multer file object
 * @returns {Promise<{ url: string }>}
 */
async function saveFile(file) {
  // Multer (diskStorage) has already written the file to server/uploads/.
  // We just need to return the URL path that the static-file middleware will serve.
  const publicUrl = `/uploads/${file.filename}`;
  return { url: publicUrl };
}

// ── Future Firebase Storage implementation (uncomment & fill in when ready) ──
//
// const { getStorage } = require('firebase-admin/storage');
//
// async function saveFile(file) {
//   const bucket  = getStorage().bucket();
//   const dest    = `issues/${Date.now()}-${file.originalname}`;
//   await bucket.upload(file.path, { destination: dest, public: true });
//   const [meta] = await bucket.file(dest).getMetadata();
//   return { url: meta.mediaLink };
// }

module.exports = { saveFile };
