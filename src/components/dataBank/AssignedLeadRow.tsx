"use client";

/**
 * One lead in a folder's list — the admin's Assigned half and everybody's Meta
 * Leads folder draw the same row.
 *
 * Shared rather than copied because the owner asked for the employee's Meta
 * Leads to look exactly like the admin's, and two copies of a row drift the
 * first time either is touched. What differs is passed in: the admin's chip
 * names who holds the lead, an employee's names its status.
 */

import { initialsOf } from "@/lib/leadDisplay";

/**
 * Read-state shading, so the list reads like the pipeline's — dark to light,
 * selected deepest, unopened in the middle, already-read receding almost to the
 * panel's white. Inline rather than Tailwind arbitrary values: a value the
 * content scanner never saw emits no rule at all.
 */
export const ROW_TONES = {
  selected: { background: "var(--rule-2)", border: "var(--brand)" },
  unopened: { background: "var(--brand-wash)", border: "var(--rule-2)" },
  opened: { background: "var(--card)", border: "var(--rule)" },
} as const;

export interface RowChip {
  text: string;
  background: string;
  color: string;
  title?: string;
}

export function AssignedLeadRow({
  name,
  phone,
  kindLabel,
  chip,
  ringColor,
  active,
  seen,
  index,
  onClick,
}: {
  name: string;
  phone: string | null | undefined;
  kindLabel: string;
  chip: RowChip;
  ringColor: string;
  active: boolean;
  seen: boolean;
  index: number;
  onClick: () => void;
}) {
  const shade = ROW_TONES[active ? "selected" : seen ? "opened" : "unopened"];
  return (
    <button
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      style={{
        // Stagger only the first screenful; beyond that the delay outlasts the
        // scroll and the list reads as laggy.
        animationDelay: `${Math.min(index, 12) * 35}ms`,
        background: shade.background,
        borderColor: shade.border,
      }}
      className="animate-lead-row grid w-full min-w-0 flex-1 grid-cols-[44px_1fr_auto] items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors hover:border-[var(--brand-edge)]"
    >
      <span
        className="flex h-11 w-11 items-center justify-center rounded-full border-2 bg-white text-[13.5px] font-medium text-[var(--ink-2)]"
        style={{ borderColor: ringColor }}
        aria-hidden
      >
        {initialsOf(name)}
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          {/* Shading alone would carry read state on colour only — the dot and
              the text beside it give it a second and a third form. */}
          {!seen && !active && (
            <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: "var(--brand)" }} aria-hidden />
          )}
          <span className="truncate text-sm font-medium text-[var(--ink)]">{name}</span>
          {!seen && !active && <span className="sr-only">(not opened yet)</span>}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] tabular-nums text-[var(--ink-3)]">
          {phone || "No number"}
        </span>
      </span>
      <span className="flex max-w-[132px] flex-col items-end gap-1.5">
        <span className="text-right text-[11px] leading-tight text-[var(--ink-3)]">{kindLabel}</span>
        <span
          className="max-w-full truncate rounded-full px-2.5 py-1 text-[11px]"
          style={{ background: chip.background, color: chip.color }}
          title={chip.title}
        >
          {chip.text}
        </span>
      </span>
    </button>
  );
}
