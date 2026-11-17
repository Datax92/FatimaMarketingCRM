"use client";
import { MdClose, MdNotificationsActive, MdNotificationsOff, MdVolumeUp, MdDesktopWindows, MdChatBubble } from "react-icons/md";
import { FaWhatsapp } from "react-icons/fa";
import { Avatar, Dropdown, IconButton, MenuLabel } from "./ui";

import { TOAST_MS } from "./utils";

// Stack of "new message" popups, bottom-right.
export function MessageToasts({ toasts, onOpen, onDismiss }) {
  return (
    <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2.5 w-[340px] max-w-[calc(100vw-32px)] pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.key}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(t)}
          onKeyDown={(e) => e.key === "Enter" && onOpen(t)}
          className="wa-anim-toast pointer-events-auto relative overflow-hidden rounded-xl bg-[var(--wa-popup)] shadow-[0_12px_32px_rgba(0,0,0,0.55)] cursor-pointer hover:bg-[#2a3942] transition-colors"
        >
          <div className="flex gap-3 p-3 pr-9">
            <Avatar name={t.name} seed={t.customer} size={44} />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-[var(--wa-accent)] flex items-center gap-1">
                <FaWhatsapp /> New message · {t.handler}
              </p>
              <p className="text-[15px] text-[var(--wa-text)] truncate font-medium">{t.name}</p>
              <p className="text-[13.5px] text-[var(--wa-muted)] line-clamp-2 break-words">{t.text}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(t.key);
            }}
            className="absolute top-2 right-2 text-[var(--wa-muted)] hover:text-[var(--wa-text)] text-lg"
            aria-label="Dismiss"
          >
            <MdClose />
          </button>
          <div className="wa-toast-bar h-[3px] bg-[var(--wa-accent)]" style={{ animationDuration: `${TOAST_MS}ms` }} />
        </div>
      ))}
    </div>
  );
}

function Toggle({ icon, label, hint, checked, onChange }) {
  const Icon = icon;
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-[#182229] transition-colors"
    >
      <Icon className="text-xl text-[var(--wa-muted)] shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[14.5px] text-[var(--wa-text)]">{label}</p>
        {hint && <p className="text-[12px] text-[var(--wa-muted)]">{hint}</p>}
      </div>
      <span className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? "bg-[var(--wa-accent)]" : "bg-[#3b4a54]"}`}>
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </span>
    </button>
  );
}

// Bell button + settings popup.
export function NotificationSettings({ prefs, onChange, unanswered, align = "left" }) {
  const desktopState = typeof Notification === "undefined" ? "unsupported" : Notification.permission;

  const setDesktop = async (on) => {
    if (on && desktopState === "default") {
      const result = await Notification.requestPermission();
      onChange({ ...prefs, desktop: result === "granted" });
      return;
    }
    onChange({ ...prefs, desktop: on && desktopState === "granted" });
  };

  const anyOn = prefs.popups || prefs.sound || prefs.desktop;

  return (
    <Dropdown
      align={align}
      width={300}
      trigger={({ open, toggle }) => (
        <IconButton label="Notifications" active={open} onClick={toggle} badge={unanswered}>
          {anyOn ? <MdNotificationsActive /> : <MdNotificationsOff />}
        </IconButton>
      )}
    >
      {() => (
        <>
          <MenuLabel>Notifications</MenuLabel>
          <p className="px-5 pb-2 text-[12.5px] text-[var(--wa-muted)]">
            {unanswered > 0
              ? `${unanswered} chat${unanswered === 1 ? " is" : "s are"} waiting for a reply.`
              : "Every customer has been answered."}
          </p>
          <Toggle
            icon={MdChatBubble}
            label="Message popups"
            hint="Show new customer messages on screen"
            checked={prefs.popups}
            onChange={(v) => onChange({ ...prefs, popups: v })}
          />
          <Toggle
            icon={MdVolumeUp}
            label="Sound"
            hint="Play a tone for new messages"
            checked={prefs.sound}
            onChange={(v) => onChange({ ...prefs, sound: v })}
          />
          <Toggle
            icon={MdDesktopWindows}
            label="Desktop alerts"
            hint={
              desktopState === "denied"
                ? "Blocked in browser settings"
                : desktopState === "unsupported"
                  ? "Not supported in this browser"
                  : "Alert when this tab is in the background"
            }
            checked={prefs.desktop && desktopState === "granted"}
            onChange={setDesktop}
          />
        </>
      )}
    </Dropdown>
  );
}
