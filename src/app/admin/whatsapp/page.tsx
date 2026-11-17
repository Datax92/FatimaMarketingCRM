"use client";

import dynamic from "next/dynamic";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { IS_DEMO } from "@/lib/demo/store";

// WhatsApp Web-style monitor, loaded only when an admin opens it.
const AdminWhatsAppMonitor = dynamic(() => import("@/components/whatsapp/AdminWhatsAppMonitor"), {
  ssr: false,
  loading: () => (
    <div className="grid h-[calc(100dvh-var(--nav-h))] place-items-center text-[var(--ink-3)]">Loading chats…</div>
  ),
});

export default function WhatsAppPage() {
  useProtectedRoute(["admin"]);

  if (IS_DEMO) {
    return (
      <div className="mx-auto max-w-xl rounded border border-[var(--rule-2)] bg-white p-6 shadow-[var(--sh-1)]">
        <h1 className="text-lg font-semibold">WhatsApp monitor</h1>
        <p className="mt-2 text-sm text-[var(--ink-2)]">
          The monitor reads employees&apos; WhatsApp Business chats through Meta&apos;s Cloud API (Coexistence), so it needs the live
          database and the WhatsApp app keys. It is switched off in demo mode.
        </p>
        <p className="mt-3 text-sm text-[var(--ink-2)]">
          To turn it on, set <code>WHATSAPP_VERIFY_TOKEN</code>, <code>WHATSAPP_APP_SECRET</code>, <code>WHATSAPP_ACCESS_TOKEN</code>,{" "}
          <code>NEXT_PUBLIC_WHATSAPP_APP_ID</code> and <code>NEXT_PUBLIC_WHATSAPP_CONFIG_ID</code>, and point the Meta webhook at{" "}
          <code>/api/whatsapp/webhook</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="-mx-8 -mt-8 -mb-14">
      <AdminWhatsAppMonitor />
    </div>
  );
}
