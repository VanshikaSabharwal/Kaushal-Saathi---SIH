/**
 * Password hashing for staff accounts: scrypt with a per-user salt, compared
 * in constant time. Node's own crypto, so there is no native dependency to
 * build on the deploy target.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return { salt, hash };
}

export function checkPassword(password: string, salt: string, hash: string): boolean {
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, KEY_LENGTH);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
