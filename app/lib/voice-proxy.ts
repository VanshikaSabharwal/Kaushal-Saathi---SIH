/**
 * Forwarding to the voice server's control plane.
 *
 * Livelihood records, like call records, are owned by the voice server (see
 * voice-server/livelihood-routes.ts); these routes are thin proxies so the
 * browser only ever talks to this app. Every request carries:
 *  - INTERNAL_TOKEN, so only this app can reach the control plane; and
 *  - the caller's scope, derived here from their signed session cookie — the
 *    voice server filters and authorises by it. The client can never set it.
 */

import {
  BENEFICIARY_COOKIE,
  cookieValue,
  readToken,
  STAFF_COOKIE,
  type BeneficiarySession,
  type StaffSession,
} from "../../lib/auth/session";

const VOICE_URL = process.env.VOICE_SERVER_URL ?? "http://localhost:3001";

export function internalHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = process.env.INTERNAL_TOKEN?.trim();
  return { "Content-Type": "application/json", ...(token ? { "x-internal-token": token } : {}), ...extra };
}

export function staffSession(request: Request): StaffSession | null {
  const s = readToken(cookieValue(request, STAFF_COOKIE));
  return s?.kind === "staff" ? s : null;
}

export function beneficiarySession(request: Request): BeneficiarySession | null {
  const s = readToken(cookieValue(request, BENEFICIARY_COOKIE));
  return s?.kind === "beneficiary" ? s : null;
}

function scopeHeaders(session: StaffSession | BeneficiarySession | null): Record<string, string> {
  if (!session) return {};
  if (session.kind === "beneficiary") {
    return { "x-scope-role": "beneficiary", "x-scope-beneficiary": session.beneficiaryId };
  }

  const h: Record<string, string> = { "x-scope-role": session.role };
  if (session.state) h["x-scope-state"] = session.state;
  if (session.district) h["x-scope-district"] = session.district;
  if (session.centreId) h["x-scope-centre"] = session.centreId;
  if (session.consultantId) h["x-scope-consultant"] = session.consultantId;
  return h;
}

export async function callVoice(
  path: string,
  init: { method?: string; body?: unknown; search?: string; session?: StaffSession | BeneficiarySession | null } = {},
): Promise<Response> {
  const target = new URL(path, VOICE_URL);
  if (init.search) target.search = init.search;

  try {
    const res = await fetch(target, {
      method: init.method ?? "GET",
      headers: internalHeaders(scopeHeaders(init.session ?? null)),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    return Response.json(await res.json(), { status: res.status });
  } catch {
    // A stopped voice server is the normal case when only the UI is running,
    // so say so plainly rather than surfacing a connection error.
    return Response.json(
      { error: `Voice server unreachable at ${VOICE_URL}. Start it with \`npm run dev:voice\`.` },
      { status: 503 },
    );
  }
}

/** Proxy as the signed-in staff member; 401 without a session. */
export async function staffProxy(request: Request, path: string): Promise<Response> {
  const session = staffSession(request);
  if (!session) return Response.json({ error: "Please sign in." }, { status: 401 });

  return callVoice(path, {
    method: request.method,
    search: new URL(request.url).search,
    body: request.method === "GET" ? undefined : await request.json().catch(() => ({})),
    session,
  });
}

/** Proxy as the signed-in beneficiary; 401 without a session. */
export async function beneficiaryProxy(
  request: Request,
  path: string,
  shape?: (session: BeneficiarySession, body: Record<string, unknown>) => Record<string, unknown>,
): Promise<Response> {
  const session = beneficiarySession(request);
  if (!session) return Response.json({ error: "Please sign in." }, { status: 401 });

  const body = request.method === "GET" ? undefined : ((await request.json().catch(() => ({}))) as Record<string, unknown>);
  const search = request.method === "GET" ? `?id=${encodeURIComponent(session.beneficiaryId)}` : undefined;

  return callVoice(path, {
    method: request.method,
    search,
    body: body && shape ? shape(session, body) : body,
    session,
  });
}
