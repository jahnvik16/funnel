import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// A fixed bcrypt hash with no real corresponding password. Login compares
// against this when no matching account exists, so a request for an unknown
// email still pays bcrypt's ~100ms+ cost — without it, "unknown email" would
// return near-instantly while "known email, wrong password" pays the bcrypt
// cost, letting an attacker enumerate valid admin emails purely by timing.
export const DUMMY_PASSWORD_HASH = "$2b$12$u.GSvaKMGmW2YF/SdklJvuqZBFOwfv4y6XDxlY8epPBfOI9RWf08C";
