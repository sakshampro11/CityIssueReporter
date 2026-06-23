/**
 * upload.js — Multer middleware for file uploads
 *
 * Stores files locally in server/uploads/ with unique filenames.
 * Accepts images (jpeg, png, webp, gif) and videos (mp4, mov, webm, avi).
 * Max file size: 50 MB per file.  Max 5 files per request.
 */

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// Ensure the uploads directory exists
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext      = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`;
    cb(null, safeName);
  },
});

function fileFilter(_req, file, cb) {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize:  50 * 1024 * 1024,   // 50 MB per file
    files: 5,                        // max 5 files per request
  },
});

module.exports = upload;
