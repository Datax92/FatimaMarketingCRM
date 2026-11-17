"use client";

import { HomeLauncher } from "@/components/shell/HomeLauncher";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

/** Home: every app the role has, as a grid — on a phone as on a desktop. */
export default function HomePage() {
  useProtectedRoute(["admin", "subadmin", "employee"]);
  return <HomeLauncher />;
}
