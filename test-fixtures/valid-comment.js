// Demo fixtures with VALID comments. None of these should be flagged —
// they describe high-level intent or accurately match the code.

// Returns true if the user has editing permission.
function canEdit(user) {
  return user.role === "admin" || user.role === "moderator";
}

// Sorts the scores from highest to lowest.
function sortScores(scores) {
  return scores.sort((a, b) => b - a);
}

// Parses the raw config string into an object.
function parseConfig(raw) {
  if (!raw) return null;
  return JSON.parse(raw);
}

// Handles the uploaded image file.
function isSupportedImage(file) {
  return file.type === "image/jpeg" || file.type === "image/png";
}

// Cache entries expire after 30 minutes.
function cacheTtl() {
  return 30 * 60;
}

module.exports = { canEdit, sortScores, parseConfig, isSupportedImage, cacheTtl };
