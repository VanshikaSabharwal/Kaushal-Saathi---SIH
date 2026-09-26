/**
 * Signed session tokens for staff and beneficiaries.
 *
 * A token is base64url(JSON payload) + "." + HMAC-SHA256 of it, carried in an
 * HttpOnly cookie. Stateless, so the Next app (bound for serverless hosting)
 * needs no session store; the expiry is inside the signed payload.
 *
 * SESSION_SECRET must be set in production — and in development whenever calls
 * should open as a signed-in person, because the voice server checks the same
 * signature. Without it a random secret is made per process: safe, but call
 * tickets from the Next app are then not recognised and calls are anonymous.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type Role = "ministry" | "state" | "district" | "saathi" | "centre" | "consultant";

export type StaffSession = {
  kind: "staff";
  userId: string;
  name: string;
  role: Role;
  state?: string;
  district?: string;
  centreId?: string;
  consultantId?: string;
  exp: number;
};

export type BeneficiarySession = {
  kind: "beneficiary";
  beneficiaryId: string;
  phone: string;
  exp: number;
};

/**
 * A short-lived ticket to open a voice call as a known person. Issued by the
 * Next app to a signed-in beneficiary (for themselves) or a Saathi (for someone
 * they registered); checked by the voice server. The WebSocket URL never
 * carries a raw id or phone number anyone could substitute.
 */
export type CallTicket = {
  kind: "call";
  beneficiaryId: string;
  exp: number;
};

export type Session = StaffSession | BeneficiarySession | CallTicket;

export const STAFF_COOKIE = "ks_staff";
export const BENEFICIARY_COOKIE = "ks_me";

const globalForSecret = globalThis as unknown as { __sessionSecret?: string };

function secret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured) return configured;

  globalForSecret.__sessionSecret ??= randomBytes(32).toString("hex");
  return globalForSecret.__sessionSecret;
}

const sign = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

export function createToken(session: Session): string {
  const data = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function readToken(token: string | undefined): Session | null {
  if (!token) return null;

  const [data, mac] = token.split(".");
  if (!data || !mac) return null;

  const expected = Buffer.from(sign(data));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const session = JSON.parse(Buffer.from(data, "base64url").toString()) as Session;
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function sessionCookie(name: string, token: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
