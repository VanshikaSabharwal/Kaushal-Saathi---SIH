/** Erase my record, tasks and files (DPDP Act), then sign out. */

import { BENEFICIARY_COOKIE, clearCookie } from "../../../../lib/auth/session";
import { beneficiaryProxy } from "../../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const res = await beneficiaryProxy(request, "/internal/beneficiaries/delete", (s) => ({ id: s.beneficiaryId }));
  const data = await res.json();
  return Response.json(data, {
    status: res.status,
    headers: res.ok ? { "Set-Cookie": clearCookie(BENEFICIARY_COOKIE) } : undefined,
  });
}
