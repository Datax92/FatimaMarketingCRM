"use client";

/**
 * One Meta campaign, as a card — the admin's Meta Ads screen and everybody's
 * Meta Leads screen draw the same one.
 *
 * **One component, because the owner asked for the two screens to look exactly
 * alike.** They answer different questions with different figures — an admin
 * sees what is still to give out, an employee sees what is waiting for them —
 * so the figures and the action are passed in; everything else is shared, and a
 * change to how a campaign looks lands on every role at once.
 */

import Link from "next/link";
import { ChevronRight, FolderOpen, Megaphone, Users } from "lucide-react";
import { formatBusinessDate } from "@/lib/dates";

export const META_BASIS_LABEL: Record<string, string> = {
  CAMPAIGN: "Campaign",
  FORM: "Lead form",
  AD: "Ad",
  NONE: "Unattributed",
};

export interface CampaignFigure {
  value: number;
  label: string;
  /** Teal for the figure that is already handled, ink for the one needing action. */
  tone: "ink" | "teal";
}

export function MetaCampaignCard({
  name,
  basis,
  href,
  figures,
  lastLeadAt,
  actionLabel,
  routedTo,
  onEditRouting,
}: {
  name: string;
  basis: string;
  href: string;
  figures: CampaignFigure[];
  lastLeadAt: Date | null;
  actionLabel: string;
  /**
   * Who this folder's leads go to — names, or `null` for the whole rotation.
   *
   * Passed in, and only by the managing screens: an employee's Meta Leads cards
   * are the same component and have no business seeing how the lane is drawn.
   */
  routedTo?: string | null;
  /** Opens the picker. Absent on every screen that may not change the routing. */
  onEditRouting?: () => void;
}) {
  return (
    <div className="group overflow-hidden rounded-2xl border border-[var(--rule)] bg-white transition-colors hover:border-[var(--brand-edge)]">
      <Link href={href} className="block px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="block truncate text-[16px] text-[var(--ink)]">{name}</span>
            <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-wash)] px-2.5 py-0.5 text-[11px] text-[var(--brand)]">
              <Megaphone size={11} />
              {META_BASIS_LABEL[basis] ?? "Meta"}
            </span>
          </div>
          <ChevronRight size={18} className="mt-1 shrink-0 text-[var(--brand-edge)]" />
        </div>

        <div className="mt-4 flex items-end gap-6">
          {figures.map((figure) => (
            <div key={figure.label}>
              <div
                className="text-[24px] tabular-nums"
                style={{ color: figure.tone === "teal" ? "var(--brand)" : "var(--ink)" }}
              >
                {figure.value.toLocaleString()}
              </div>
              <div className="text-[11px] tracking-[0.9px] text-[var(--ink-3)] uppercase">{figure.label}</div>
            </div>
          ))}
        </div>

        <p className="mt-3.5 text-[12px] text-[var(--ink-3)]">
          {lastLeadAt ? `Last lead ${formatBusinessDate(lastLeadAt)}` : "No leads yet"}
        </p>

        {/* Only where the routing can be changed. Saying "goes to everyone" on
            a screen with no control to change it would read as a setting the
            reader has lost. */}
        {onEditRouting && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[var(--ink-3)]">
            <Users size={12} className="shrink-0" />
            <span className="truncate">
              {routedTo ? `Goes to ${routedTo}` : "Goes to everyone in the rotation"}
            </span>
          </p>
        )}
      </Link>

      {/* Wraps rather than squeezing: two actions plus a 390px phone is one
          row too many, and a clipped label is worse than a second line. */}
      <div className="flex flex-wrap items-center gap-1 border-t border-[var(--paper-2)] px-3 py-2">
        <Link
          href={href}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-[var(--ink-2)] transition-colors hover:bg-[var(--brand-wash)]"
        >
          <FolderOpen size={13} />
          <span>{actionLabel}</span>
        </Link>

        {onEditRouting && (
          <button
            type="button"
            onClick={onEditRouting}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-[var(--ink-2)] transition-colors hover:bg-[var(--brand-wash)]"
          >
            <Users size={13} />
            <span>Who gets these leads</span>
          </button>
        )}
      </div>
    </div>
  );
}
