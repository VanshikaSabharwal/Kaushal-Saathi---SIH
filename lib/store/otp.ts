/**
 * One-time codes for beneficiaries to open "मेरी प्रगति" with just their
 * phone number — no password to remember.
 *
 * Codes are stored hashed, expire in 10 minutes, allow 5 tries, and can be
 * requested once a minute per number.
 *
 * Sending the SMS needs a provider (MSG91, Twilio, Gupshup) with DLT-registered
 * templates, which is not wired up yet. Until it is, the code is returned in
 * the response when OTP_DEV=1 — for demos only, and said so on screen.
 */

import { createHash, randomInt } from "node:crypto";
import { createCollection } from "./collection";

type Otp = { id: string; hash: string; expiresAt: number; attempts: number; sentAt: number };

const otps = createCollection<Otp>("otps");

const TTL_MS = 10 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

const hashOf = (phone: string, code: string) => createHash("sha256").update(`${phone}:${code}`).digest("hex");

/** Normalise to +91XXXXXXXXXX, or undefined when it is not a phone number. */
export function normalizePhone(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return undefined;
}

export async function requestOtp(
  phone: string,
): Promise<{ ok: true; devCode?: string } | { ok: false; error: string }> {
  const existing = await otps.get(phone);
  if (existing && Date.now() - existing.sentAt < RESEND_MS) {
    return { ok: false, error: "Please wait a minute before asking for a new code." };
  }

  const code = String(randomInt(100000, 1000000));
  await otps.upsert({ id: phone, hash: hashOf(phone, code), expiresAt: Date.now() + TTL_MS, attempts: 0, sentAt: Date.now() });

  if (process.env.OTP_DEV === "1") return { ok: true, devCode: code };

  // No SMS provider yet: log it so a developer can still sign in.
  console.log(`[otp] code for ${phone.slice(0, 5)}…: ${code} (set up an SMS provider to send it)`);
  return { ok: true };
}

export async function verifyOtp(phone: string, code: string): Promise<boolean> {
  let ok = false;

  await otps.update(phone, (o) => {
    if (!o || o.expiresAt < Date.now() || o.attempts >= MAX_ATTEMPTS) return o;

    ok = o.hash === hashOf(phone, code.trim());
    // A used code cannot be replayed; a wrong one counts against the limit.
    return ok ? { ...o, expiresAt: 0 } : { ...o, attempts: o.attempts + 1 };
  });

  return ok;
}
