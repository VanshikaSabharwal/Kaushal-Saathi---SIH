/**
 * A 2-minute ticket for a Saathi to start the voice interview for someone in
 * their scope ({ id }) — handing over the phone after quick registration.
 */

import { createToken } from "../../../../lib/auth/session";
import { callVoice, staffSession } from "../../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = staffSession(request);
  if (!session) return Response.json({ error: "Please sign in." }, { status: 401 });

  const { id } = await request.json().catch(() => ({}));
  // Only for someone this staff member can see — checked by the owner.
  const check = await callVoice("/internal/beneficiaries", { search: `?id=${encodeURIComponent(String(id ?? ""))}`, session });
  if (!check.ok) return Response.json({ error: "No such beneficiary." }, { status: 404 });

  return Response.json({ ticket: createToken({ kind: "call", beneficiaryId: String(id), exp: Date.now() + 2 * 60 * 1000 }) });
}
