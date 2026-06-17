// Coerce a string-or-array request field → array, in place, for fields that
// MUST be arrays. Prevents frontend crashes when a caller passes "SB-225"
// instead of ["SB-225"]. Shared by the item and design route handlers.
export function coerceArrayField(body, key) {
  if (body[key] === undefined) return;
  if (body[key] === '' || body[key] === null) { body[key] = []; return; }
  if (typeof body[key] === 'string') {
    body[key] = body[key].split(',').map(s => s.trim()).filter(Boolean);
  }
}
