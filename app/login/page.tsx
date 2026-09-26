"use client";

/** Staff sign-in: officers, state corporations, Saathis, centres, consultants. */

import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, Button } from "../components/ks/ui";

const HOME: Record<string, string> = {
  saathi: "/saathi",
  centre: "/centre",
  consultant: "/admin/consultants",
};

function Login() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await api<{ user: { role: string } }>("/api/auth/login", { body: { username, password } });
    setBusy(false);

    if (!r.ok) return setError(r.data.error ?? "Sign-in failed.");
    router.replace(next && next !== "/login" ? next : HOME[r.data.user.role] ?? "/admin");
  }

  const field = "w-full rounded-lg border border-[var(--border-strong)] bg-white px-3 py-2 text-sm focus:border-[var(--ks-primary)] focus:outline-none";

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-[var(--border)] bg-white p-6 shadow-sm">
        <div>
          <p className="text-lg font-bold text-[var(--ks-primary)]">कौशल साथी · Staff sign-in</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">District officers, state corporations, Saathis, training centres and consultants.</p>
        </div>
        <label className="block text-xs font-medium text-[var(--text-muted)]">
          Username
          <input className={`${field} mt-1`} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label className="block text-xs font-medium text-[var(--text-muted)]">
          Password
          <input className={`${field} mt-1`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">{error}</p>}
        <Button type="submit" className="w-full py-2" disabled={busy || !username || !password}>Sign in</Button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <Login />
    </Suspense>
  );
}
