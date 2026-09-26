/** Beneficiaries: list (district, block, status) or one by ?id=; POST registers one (Saathi). Staff only, scoped to the signed-in role. */

import { staffProxy } from "../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return staffProxy(request, "/internal/beneficiaries");
}

export async function POST(request: Request) {
  return staffProxy(request, "/internal/beneficiaries");
}
