/** Returns why a password is rejected, or null if it is acceptable. */
export function passwordProblem(
  password: string,
  user: { username: string; email: string }
): string | null {
  if (password.length < 8) return 'password must be at least 8 characters';
  // bcrypt only uses the first 72 bytes; longer passwords would silently match on their prefix.
  if (Buffer.byteLength(password, 'utf8') > 72) return 'password must be at most 72 bytes';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'password must contain a letter and a digit';
  }
  const lower = password.toLowerCase();
  const local = user.email.split('@')[0].toLowerCase();
  if (lower.includes(user.username.toLowerCase()) || (local.length >= 3 && lower.includes(local))) {
    return 'password must not contain your username or email';
  }
  return null;
}
