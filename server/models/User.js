/**
 * Firestore "users" collection — document shape reference
 *
 * Each document is keyed by a Firestore auto-generated ID (used as userId in JWTs).
 *
 * Document fields:
 * {
 *   name:      string   — display name of the user
 *   email:     string   — unique email address (enforced in app logic, not schema)
 *   phone:     string?  — optional phone number
 *   address:   string?  — optional address
 *   password:  string   — bcrypt-hashed password (never plain text)
 *   role:      string   — user role: "citizen" | "resolver" (default "citizen")
 *   createdAt: string   — ISO 8601 timestamp (stored as string; set once on registration)
 * }
 *
 * Note: Firestore is schemaless — this file exists purely as documentation so
 * every developer knows exactly what shape to expect when reading/writing users.
 * Validation is performed in the route handlers before writing.
 */

// No code to export — this is a documentation-only module.
// Import the db instance from ../config/firestore and use:
//   db.collection('users')
