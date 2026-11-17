"use client";

import { HomeLauncher } from "@/components/shell/HomeLauncher";
import { MobileDashboard } from "@/components/mobile/MobileDashboard";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/** Home: the app grid on a desktop, the day's summary on a phone. */
export default function HomePage() {
  useProtectedRoute(["admin", "subadmin", "employee"]);
  const isMobile = useIsMobile();
  return isMobile ? <MobileDashboard /> : <HomeLauncher />;
}
