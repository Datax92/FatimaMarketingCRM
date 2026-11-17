"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { HIDDEN_IN_QUIET, useQuietHours } from "@/hooks/useQuietHours";
import { navFor } from "@/lib/navigation";
import { MobileShell } from "./mobile/MobileShell";
import { IncomingLeadPopup } from "./leads/IncomingLeadPopup";
import { Navbar } from "./shell/Navbar";

/**
 * The signed-in frame. Desktop gets the Property-style shell — a navbar carrying the
 * open section's menus over a pale canvas; phones keep their own shell with a tab bar.
 */
export function GlobalLayout({ children }: { children: React.ReactNode }) {
  const { user, role, isHr } = useAuth();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const quietHours = useQuietHours();

  // Team → Reports is out of the menu during quiet hours (owner, 2026-09-25).
  const sections = useMemo(() => {
    const all = navFor(role, isHr);
    if (!quietHours) return all;
    return all
      .map((s) => ({ ...s, items: s.items.filter((i) => !HIDDEN_IN_QUIET.has(i.path)) }))
      .filter((s) => s.items.length > 0);
  }, [role, isHr, quietHours]);

  if (!user) return <>{children}</>;

  // Portals to document.body and renders nothing unless an employee has a lead waiting.
  const leadOffer = <IncomingLeadPopup />;

  if (isMobile)
    return (
      <MobileShell role={role ?? undefined}>
        {children}
        {leadOffer}
      </MobileShell>
    );

  const isHome = pathname === "/home";

  return (
    <div className="shell">
      <Navbar sections={sections} />
      <main id="main" className={isHome ? "home" : "fm-page"}>
        {children}
      </main>
      {leadOffer}
    </div>
  );
}
