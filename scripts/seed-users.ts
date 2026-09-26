/**
 * Create the demo staff accounts, one per role, scoped to the demo districts.
 *
 *   npm run seed:users                     # random password, printed once
 *   DEMO_PASSWORD=... npm run seed:users   # a password of your choosing
 *
 * Writes to the same store the voice server reads (MongoDB when MONGODB_URL is
 * set, else .data/). Re-running resets these accounts' passwords. For real
 * deployments create named accounts per officer instead of sharing these.
 */

import { randomBytes } from "node:crypto";
import { loadEnv } from "../lib/env";

loadEnv();

import { createUser } from "../lib/store/users";

const ACCOUNTS = [
  { username: "ministry", name: "Ministry (MoSJE)", role: "ministry" },
  { username: "up_state", name: "UP SC Development Corporation", role: "state", state: "Uttar Pradesh" },
  { username: "jhansi_officer", name: "District Officer, Jhansi", role: "district", district: "jhansi" },
  { username: "gaya_officer", name: "District Officer, Gaya", role: "district", district: "gaya" },
  { username: "nashik_officer", name: "District Officer, Nashik", role: "district", district: "nashik" },
  { username: "ratlam_officer", name: "District Officer, Ratlam", role: "district", district: "ratlam" },
  { username: "jhansi_saathi", name: "Saathi, Jhansi", role: "saathi", district: "jhansi" },
  { username: "centre_j2", name: "Sample PMKVY Centre – Babina", role: "centre", centreId: "j2", district: "jhansi" },
  { username: "consultant_j1", name: "Sample Consultant A", role: "consultant", consultantId: "fc_j1", district: "jhansi" },
] as const;

async function main(): Promise<void> {
  const password = process.env.DEMO_PASSWORD?.trim() || randomBytes(6).toString("base64url");

  for (const a of ACCOUNTS) {
    await createUser({ ...a, password });
    console.log(`  ${a.username.padEnd(16)} ${a.role}`);
  }

  console.log(`\npassword for all demo accounts: ${password}`);
  console.log("Sign in at http://localhost:3000/login");
  process.exit(0);
}

void main();
