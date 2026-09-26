/**
 * The Twilio control plane: TwiML for a call, request signature checks, and
 * placing outbound calls — plain HTTP, no SDK.
 *
 * Configured by environment:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN  account credentials
 *   TWILIO_FROM_NUMBER                     the number calls come from (E.164)
 *   PUBLIC_VOICE_URL                       https URL Twilio can reach this server at
 *
 * Note for India: outbound calls to Indian mobiles need DLT/TRAI registration,
 * which takes days to weeks; an inbound number (people dial in) avoids it.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_FROM_NUMBER?.trim() &&
      process.env.PUBLIC_VOICE_URL?.trim(),
  );
}

const publicBase = () => (process.env.PUBLIC_VOICE_URL ?? "").replace(/\/$/, "");

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * TwiML that bridges the call to our media WebSocket.
 *
 * <Connect>, not <Start>: <Start> is one-way, and the agent must be able to
 * speak, clear (barge-in) and mark. Who is calling travels as Stream
 * parameters, because the WebSocket itself carries no call details.
 */
export function streamTwiml(params: Record<string, string | undefined>): string {
  const wsUrl = publicBase().replace(/^http/, "ws") + "/ws/twilio";
  const parameters = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `      <Parameter name="${xml(k)}" value="${xml(v!)}"/>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${xml(wsUrl)}">
${parameters}
    </Stream>
  </Connect>
</Response>`;
}

/**
 * Is this request really from Twilio?
 *
 * Twilio signs the full URL followed by every POST parameter (sorted by name,
 * name then value, no separators) with HMAC-SHA1 using the auth token, and
 * sends the base64 result as X-Twilio-Signature.
 */
export function validTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | undefined,
  authToken = process.env.TWILIO_AUTH_TOKEN ?? "",
): boolean {
  if (!signature || !authToken) return false;

  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = Buffer.from(createHmac("sha1", authToken).update(data).digest("base64"));
  const actual = Buffer.from(signature);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Place an outbound call; Twilio then fetches our TwiML for it. Returns the call SID. */
export async function placeCall(to: string, callId: string): Promise<string> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      To: to,
      From: process.env.TWILIO_FROM_NUMBER!,
      Url: `${publicBase()}/twilio/voice?callId=${encodeURIComponent(callId)}`,
      Method: "POST",
    }),
    signal: AbortSignal.timeout(10000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return (data as { sid: string }).sid;
}
