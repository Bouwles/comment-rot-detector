// Demo fixtures with STALE comments. Each comment contradicts the code below it.
// Run:  node src/index.js scan test-fixtures/stale-comment.js --whole

// Returns true only if the user is an admin.
function canEdit(user) {
  return user.role === "admin" || user.role === "moderator";
}

// Sorts the scores in ascending order.
function sortScores(scores) {
  return scores.sort((a, b) => b - a);
}

// Throws an error when the input is invalid.
function parseConfig(raw) {
  if (!raw) return null;
  return JSON.parse(raw);
}

// Only supports JPEG images.
function isSupportedImage(file) {
  return file.type === "image/jpeg" || file.type === "image/png";
}

/**
 * Does not mutate the input array.
 * @param {number[]} items
 * @returns {number[]}
 */
function normalize(items) {
  items.push(0);
  return items.map((x) => x / Math.max(...items));
}

// Cache entries expire after 5 minutes.
function cacheTtl() {
  return 30 * 60;
}

module.exports = { canEdit, sortScores, parseConfig, isSupportedImage, normalize, cacheTtl };
