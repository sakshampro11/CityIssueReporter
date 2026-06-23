/**
 * Firestore "issues" collection — document shape reference
 *
 * Each document is keyed by a Firestore auto-generated ID.
 *
 * Document fields:
 * {
 *   name:        string  — name of the reporter
 *   email:       string  — email of the reporter
 *   phone:       string  — phone number of the reporter
 *   issueType:   string  — category of the issue (e.g. "Road", "Water", "Sanitation")
 *   title:       string  — short, AI-generated or user-provided title of the issue
 *   summary:     string  — brief, AI-generated or user-provided summary of the issue
 *   description: string  — detailed description of the problem
 *   priority:    string  — severity level: "Low" | "Medium" | "High"
 *   status:      string  — current status: "Reported" | "Verified" | "In Progress" | "Resolved"
 *                          defaults to "Reported" when created
 *   statusHistory: object[] — history of status changes, array of:
 *     {
 *       status:    string — status value reached
 *       timestamp: string — ISO 8601 timestamp when changed
 *       note:      string — short transition note
 *     }
 *   location:    object  — geospatial data for the issue
 *     {
 *       address: string  — human-readable address / area (manual fallback or reverse-geocoded)
 *       lat:     number? — latitude from browser geolocation API (null if unavailable)
 *       lng:     number? — longitude from browser geolocation API (null if unavailable)
 *     }
 *   mediaUrls:   string[] — array of URLs to uploaded images / videos (may be empty).
 *                           Files are stored in server/uploads/ (local) or Firebase Storage (future).
 *                           Access via GET /uploads/<filename> while using local storage.
 *   mediaUrl:    string?  — convenience alias: always the first entry of mediaUrls (or null).
 *                           Kept for backwards compatibility with older documents.
 *   reporterId:  string?  — userId of the authenticated reporter (if logged in)
 *   confirmations: number — count of users who confirmed this issue (default 0)
 *   confirmedBy:   string[] — list of user IDs who confirmed this issue (default [])
 *   commentsList:  object[] — list of comments: { username, role, text, timestamp } (default [])
 *   comments:      number   — count of comments on this issue (default 0)
 *   resolutionProof: object? — details of resolution if status === 'Resolved': { note, mediaUrls }
 *   createdAt:   string   — ISO 8601 timestamp, set once on creation
 *   updatedAt:   string?  — ISO 8601 timestamp, updated on every PUT or verification
 * }
 *
 * Note: Firestore is schemaless — this file exists purely as documentation so
 * every developer knows exactly what shape to expect when reading/writing issues.
 * Validation is performed in the route handlers before writing.
 *
 * Swapping storage backends
 * ─────────────────────────
 * File upload logic lives in server/services/storage.js.
 * Replace `saveFile()` there to use Firebase Storage (or any other provider)
 * without touching the route handlers.
 */

// No code to export — this is a documentation-only module.
// Import the db instance from ../config/firestore and use:
//   db.collection('issues')
