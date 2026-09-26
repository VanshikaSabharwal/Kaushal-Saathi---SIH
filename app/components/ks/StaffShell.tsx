"use client";

/**
 * The staff frame: who is signed in, and the pages their role uses. Every
 * page below it can read the session with useStaff(); data access itself is
 * enforced server-side by scope, this only decides what to show.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import type { StaffSession } from "../../../lib/auth/session";
import { LanguagePicker, TranslateProvider } from "./Translate";

const StaffContext = createContext<StaffSession | null>(null);

export function useStaff(): StaffSession | null {
  return useContext(StaffContext);
}

type NavItem = { href: string; label: string; roles?: StaffSession["role"][] };

const OFFICERS: StaffSession["role"][] = ["ministry", "state", "district"];

const NAV: NavItem[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/beneficiaries", label: "Beneficiaries" },
  { href: "/admin/tasks", label: "Needs attention" },
  { href: "/admin/insights", label: "District insights", roles: OFFICERS },
  { href: "/admin/placement", label: "Placement", roles: [...OFFICERS, "saathi"] },
  { href: "/admin/consultants", label: "Consultants", roles: [...OFFICERS, "consultant"] },
  { href: "/admin/words", label: "Dialect words", roles: [...OFFICERS, "saathi"] },
  { href: "/saathi", label: "Saathi desk", roles: ["saathi", "district"] },
  { href: "/centre", label: "Centre desk", roles: ["centre"] },
  { href: "/dev/call", label: "Engine tools", roles: ["ministry"] },
];

const ROLE_LABEL: Record<StaffSession["role"], string> = {
  ministry: "Ministry",
  state: "State corporation",
  district: "District officer",
  saathi: "Saathi (field)",
  centre: "Training centre",
  consultant: "Financial consultant",
};

export default function StaffShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "";
  const router = useRouter();
  const [user, setUser] = useState<StaffSession | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUser(d?.user ?? null))
      .finally(() => setChecked(true));
  }, [path]);

  useEffect(() => {
    if (checked && !user && path !== "/login") router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [checked, user, path, router]);

  if (path === "/login") {
    return (
      <TranslateProvider source="en">
        <div className="min-h-screen bg-[var(--ks-paper)]">
          <div className="flex justify-end p-3"><LanguagePicker tone="dark" /></div>
          {children}
        </div>
      </TranslateProvider>
    );
  }
  if (!checked || !user) return <p className="p-8 text-sm text-[var(--text-muted)]">Loading…</p>;

  const scope = user.district ?? user.state ?? (user.role === "ministry" ? "All India" : "");
  const items = NAV.filter((n) => !n.roles || n.roles.includes(user.role));

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <StaffContext.Provider value={user}>
      <TranslateProvider source="en">
      <div className="flex min-h-screen flex-col bg-[var(--background)] lg:flex-row">
        <aside className="border-b border-[var(--border)] bg-[var(--ks-primary)] text-white lg:w-60 lg:border-b-0 lg:border-r">
          <div className="px-4 py-4">
            <p className="text-base font-bold">कौशल साथी · Admin</p>
            <p className="mt-1 text-xs text-white/70">
              {user.name} · {ROLE_LABEL[user.role]}
              {scope ? ` · ${scope}` : ""}
            </p>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-2 pb-3 lg:flex-col lg:overflow-visible">
            {items.map((n) => {
              const active = n.href === "/admin" ? path === "/admin" : path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${active ? "bg-white/15 font-semibold" : "text-white/80 hover:bg-white/10"}`}
                >
                  {n.label}
                </Link>
              );
            })}
            <div className="px-1 py-1"><LanguagePicker /></div>
            <button onClick={logout} className="cursor-pointer whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm text-white/70 hover:bg-white/10">
              Sign out
            </button>
          </nav>
        </aside>

        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
      </TranslateProvider>
    </StaffContext.Provider>
  );
}
