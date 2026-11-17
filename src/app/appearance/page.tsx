"use client";

import { AppearancePage } from "@/components/shell/AppearancePage";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

export default function Page() {
  useProtectedRoute(["admin", "subadmin", "employee"]);
  return <AppearancePage />;
}
