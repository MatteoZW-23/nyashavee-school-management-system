// A school system holds child, health and finance records. Passwords therefore
// need a consistent minimum standard wherever a staff member or guardian sets
// one. Existing accounts are not silently invalidated; the rule applies at the
// next activation or reset.
const commonPasswords = new Set([
  "passwordpassword", "password1234", "adminadmin123", "qwertyuiop123",
  "welcome123456", "schoolpassword", "changeme12345",
]);

export function passwordPolicyError(password: string) {
  if (password.length < 12 || password.length > 120) return "Use 12 to 120 characters.";
  const normalized = password.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  if (commonPasswords.has(normalized)) return "Choose a password that is not common or easily guessed.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return "Include upper-case, lower-case and numeric characters.";
  }
  return null;
}

export function isValidPassword(password: string) {
  return passwordPolicyError(password) === null;
}
