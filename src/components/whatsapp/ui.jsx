"use client";
import { useState } from "react";
import { useDismiss } from "./useDismiss";
import { avatarColor, initials } from "./utils";

export function Avatar({ name, seed, size = 49, ring = false }) {
  return (
    <div
      className={`rounded-full flex items-center justify-center font-semibold text-[#111b21] shrink-0 select-none ${ring ? "wa-pulse" : ""}`}
      style={{ width: size, height: size, background: avatarColor(seed || name), fontSize: size * 0.36 }}
    >
      {initials(name)}
    </div>
  );
}

export function IconButton({ label, active, onClick, children, className = "", badge }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`relative w-10 h-10 rounded-full flex items-center justify-center text-[22px] transition-colors duration-150 ${
        active ? "bg-[var(--wa-active)] text-[var(--wa-text)]" : "text-[var(--wa-muted)] hover:bg-white/5 hover:text-[var(--wa-text)]"
      } ${className}`}
    >
      {children}
      {badge > 0 && (
        <span className="wa-anim-badge absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--wa-badge)] text-[#111b21] text-[11px] font-bold flex items-center justify-center">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

// A trigger plus a floating menu. `children` receives close().
export function Dropdown({ trigger, children, align = "right", width = 220 }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={`wa-popup wa-anim-pop absolute z-40 mt-1 py-2 rounded-md bg-[var(--wa-popup)] shadow-[0_8px_24px_rgba(0,0,0,0.5)] ${
            align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left"
          }`}
          style={{ width }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, children, active, icon: Icon, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-5 py-2.5 text-[14.5px] flex items-center gap-3 transition-colors hover:bg-[#182229] ${
        danger ? "text-rose-400" : "text-[var(--wa-text)]"
      }`}
    >
      {Icon && <Icon className="text-lg text-[var(--wa-muted)] shrink-0" />}
      <span className="flex-1 truncate">{children}</span>
      {active && <span className="w-2 h-2 rounded-full bg-[var(--wa-accent)]" />}
    </button>
  );
}

export function MenuLabel({ children }) {
  return <p className="px-5 pt-1 pb-1.5 text-[12px] uppercase tracking-wide text-[var(--wa-accent)]">{children}</p>;
}

export function Highlight({ text, query }) {
  if (!query || !text) return text || null;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts = [];
  let i = 0;
  while (i < text.length) {
    const hit = lower.indexOf(q, i);
    if (hit === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (hit > i) parts.push(text.slice(i, hit));
    parts.push(
      <mark key={hit} className="wa-mark">
        {text.slice(hit, hit + q.length)}
      </mark>
    );
    i = hit + q.length;
  }
  return parts;
}
