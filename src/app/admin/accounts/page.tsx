"use client";

import { SimpleAccounts } from "@/components/accounts/SimpleAccounts";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

export default function AccountsPage() {
  useProtectedRoute(["admin"]);
  return <SimpleAccounts />;
}
