/** Consultant registry with performance; POST registers one (officers). Staff only, scoped to the signed-in role. */

import { staffProxy } from "../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return staffProxy(request, "/internal/consultants");
}

export async function POST(request: Request) {
  return staffProxy(request, "/internal/consultants");
}
