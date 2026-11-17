"use client";
import { useEffect, useRef, useState } from "react";
import { MdAddLink, MdClose } from "react-icons/md";
import { auth } from "@/lib/firebase/client";

// Adds an employee's WhatsApp Business app number (Coexistence) to the monitor.
// The employee keeps using the app on their phone; /api/whatsapp/onboard
// subscribes our webhook to the number. Two routes:
//   make - the number was already linked in Make.com; the admin pastes its
//          WhatsApp account ID.
//   meta - links the number here through Meta's Embedded Signup. Needs Tech
//          Provider approval and VITE_WHATSAPP_CONFIG_ID.

const APP_ID = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID;
const CONFIG_ID = process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID;
const META_READY = Boolean(APP_ID && CONFIG_ID);

const MODES = [
  { id: "make", label: "Linked in Make.com" },
  { id: "meta", label: "Meta signup" },
];

const INPUT_CLS =
  "w-full bg-[#2a3942] border border-transparent rounded-lg px-3 py-2.5 text-sm text-[#e9edef] outline-none focus:border-[#00a884] placeholder:text-[#8696a0] transition-colors";
const PRIMARY_CLS =
  "px-5 py-2 rounded-full text-sm font-semibold bg-[#00a884] hover:bg-[#06cf9c] text-[#111b21] disabled:opacity-50 transition-colors";

let sdkPromise;
function loadFacebookSdk() {
  sdkPromise ||= new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: "v25.0" });
      resolve(window.FB);
    };
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error("Could not load the Facebook SDK. Disable any ad blocker and try again."));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}

export default function WhatsAppConnectNumber({ renderTrigger }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(META_READY ? "meta" : "make");
  const [label, setLabel] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [sdkReady, setSdkReady] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | waiting | saving | done | error
  const [error, setError] = useState("");
  const [connected, setConnected] = useState([]);

  // Meta signup reports the account ids through a window message and the code
  // through the FB.login callback; the ids are collected here.
  const session = useRef({});

  const fail = (message) => {
    setError(message);
    setPhase("error");
  };

  const submit = async (payload) => {
    setError("");
    setPhase("saving");
    try {
      if (!auth.currentUser) throw new Error("Sign in with your admin account to connect a number.");
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch("/api/whatsapp/onboard", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setConnected(data.numbers || []);
      setPhase("done");
    } catch (err) {
      fail(err.message);
    }
  };

  useEffect(() => {
    if (!open || mode !== "meta" || !META_READY) return;
    loadFacebookSdk().then(() => setSdkReady(true), (err) => fail(err.message));

    const onMessage = (event) => {
      if (!event.origin.endsWith("facebook.com")) return;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type !== "WA_EMBEDDED_SIGNUP") return;
      if (data.event === "CANCEL") {
        fail(data.data?.error_message || "Signup was closed before it finished.");
        return;
      }
      session.current = {
        wabaId: data.data?.waba_id,
        phoneNumberId: data.data?.phone_number_id,
        businessId: data.data?.business_id,
      };
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open, mode]);

  // Must run directly inside the click handler or the popup gets blocked.
  const launch = () => {
    session.current = {};
    setError("");
    setPhase("waiting");
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (code) submit({ code, label: label.trim(), ...session.current });
        else setPhase((p) => (p === "waiting" ? "idle" : p));
      },
      {
        config_id: CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      }
    );
  };

  const close = () => {
    setOpen(false);
    setPhase("idle");
    setError("");
    setLabel("");
    setWabaId("");
    setConnected([]);
  };

  const switchMode = (id) => {
    setMode(id);
    setError("");
    setPhase("idle");
  };

  const busy = phase === "waiting" || phase === "saving";

  return (
    <>
      {renderTrigger ? (
        renderTrigger(() => setOpen(true))
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="ml-auto shrink-0 px-3.5 py-2 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-2 transition-colors"
        >
          <MdAddLink className="text-lg" />
          Connect a number
        </button>
      )}

      {open && (
        <div className="wa-anim-fade fixed inset-0 z-[70] bg-[#0b141a]/80 flex items-center justify-center p-4">
          <div className="wa-anim-pop w-full max-w-md bg-[#233138] rounded-xl shadow-[0_17px_50px_rgba(0,0,0,0.6)] text-[#e9edef]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <h2 className="text-lg font-bold text-white">Connect an employee number</h2>
              <button onClick={close} disabled={busy} className="text-[#8696a0] hover:text-white disabled:opacity-40" aria-label="Close">
                <MdClose size={22} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {phase === "done" ? (
                <div className="space-y-3">
                  <p className="text-sm text-emerald-300 font-semibold">
                    {connected.length ? "Connected. New messages will appear in the monitor." : "No phone number was found on that WhatsApp account."}
                  </p>
                  {connected.map((n) => (
                    <div key={n.phoneNumberId} className="text-xs text-[#aebac1] bg-[#111b21] rounded-lg p-3 space-y-1 wa-anim-up">
                      <p className="text-sm font-semibold text-white">
                        {n.label ? `${n.label} · ` : ""}
                        {n.displayNumber}
                      </p>
                      <p>Contacts sync: {n.contactsSync}</p>
                      <p>Chat history sync: {n.historySync}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="flex gap-1 bg-[#111b21] rounded-full p-1">
                    {MODES.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => switchMode(m.id)}
                        disabled={busy}
                        className={`flex-1 px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                          mode === m.id ? "bg-[#0a332c] text-[#d9fdd3]" : "text-[#8696a0] hover:text-[#e9edef]"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  {mode === "make" ? (
                    <>
                      <p className="text-sm text-[#aebac1]">
                        Link the number in Make.com first (Coexistence mode), then paste its WhatsApp account ID from
                        Meta Business Settings &rarr; Accounts &rarr; WhatsApp accounts.
                      </p>
                      <div>
                        <label className="block text-xs text-[#8696a0] font-medium mb-1">WhatsApp account ID</label>
                        <input
                          value={wabaId}
                          onChange={(e) => setWabaId(e.target.value.replace(/\D/g, ""))}
                          disabled={busy}
                          inputMode="numeric"
                          placeholder="e.g. 102290129340398"
                          className={INPUT_CLS}
                        />
                      </div>
                    </>
                  ) : META_READY ? (
                    <ol className="text-sm text-[#aebac1] list-decimal list-inside space-y-1">
                      <li>Have the employee&apos;s phone ready, with WhatsApp Business open.</li>
                      <li>Continue with Facebook and enter that phone&apos;s number.</li>
                      <li>Scan the QR code from WhatsApp Business and choose to share chat history.</li>
                    </ol>
                  ) : (
                    <p className="text-sm text-amber-300">
                      Available once Meta approves the app as a Tech Provider. Then set VITE_WHATSAPP_APP_ID and
                      VITE_WHATSAPP_CONFIG_ID in Vercel and redeploy.
                    </p>
                  )}

                  {(mode === "make" || META_READY) && (
                    <div>
                      <label className="block text-xs text-[#8696a0] font-medium mb-1">Employee name</label>
                      <input
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        disabled={busy}
                        placeholder="e.g. Ali (Ticketing)"
                        className={INPUT_CLS}
                      />
                    </div>
                  )}
                  {error && <p className="text-sm text-rose-400">{error}</p>}
                </>
              )}
            </div>

            <div className="px-5 py-4 border-t border-white/5 flex justify-end gap-2">
              <button onClick={close} disabled={busy} className="px-4 py-2 rounded-xl text-sm font-semibold text-[#aebac1] hover:text-white disabled:opacity-40">
                {phase === "done" ? "Close" : "Cancel"}
              </button>
              {phase !== "done" && mode === "make" && (
                <button onClick={() => submit({ wabaId, label: label.trim() })} disabled={!wabaId || busy} className={PRIMARY_CLS}>
                  {busy ? "Connecting…" : "Add to monitor"}
                </button>
              )}
              {phase !== "done" && mode === "meta" && META_READY && (
                <button onClick={launch} disabled={!sdkReady || busy} className={PRIMARY_CLS}>
                  {phase === "waiting" ? "Waiting for Facebook…" : phase === "saving" ? "Connecting…" : "Continue with Facebook"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
