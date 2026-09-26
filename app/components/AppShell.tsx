"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import StaffShell from "./ks/StaffShell";
import BeneficiaryShell from "./ks/BeneficiaryShell";
import { MenuIcon, WaveIcon } from "./Icons";
import { ConfigProvider } from "../lib/ConfigContext";
import { ConnectionProvider } from "../lib/ConnectionContext";
import { sourceForPath } from "../lib/shells";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  const source = sourceForPath(path);

  // Three audiences, three shells: beneficiaries get large, simple screens;
  // staff get their role's navigation; developers get the engine tools.
  if (source === "en") return <StaffShell>{children}</StaffShell>;
  if (source === "hi") return <BeneficiaryShell>{children}</BeneficiaryShell>;

  return (
    <ConfigProvider>
      <ConnectionProvider>
        <Shell>{children}</Shell>
      </ConnectionProvider>
    </ConfigProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile-only top bar: the sidebar brand lives in the drawer on small screens. */}
        <header className="flex items-center gap-3 border-b border-[var(--border)] bg-white px-4 py-3 lg:hidden">
          <button
            onClick={() => setNavOpen(true)}
            className="text-[var(--text-muted)]"
            aria-label="Open menu"
          >
            <MenuIcon className="h-6 w-6" />
          </button>
          <span className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--brand)] text-white">
              <WaveIcon className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold">Voice Agent</span>
          </span>
        </header>

        <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
