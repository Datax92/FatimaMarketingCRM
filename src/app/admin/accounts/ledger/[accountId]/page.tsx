"use client";

import { use } from "react";
import { SimpleAccounts } from "@/components/accounts/SimpleAccounts";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";

export default function AccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = use(params);
  useProtectedRoute(["admin"]);
  return <SimpleAccounts accountId={accountId} />;
}
