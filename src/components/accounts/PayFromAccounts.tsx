"use client";

/**
 * "Pay from account": pick the account the money comes out of, and the amount.
 * The server re-checks the same rules (`lib/ledger.checkAllocations`), so a payment
 * this window allows is never refused, and the expense remembers what is still owed.
 */

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { karachiDayKey } from "@/lib/dates";
import { checkAllocations, type SourceModule, type TransactionType } from "@/lib/ledger";
import { payFromAccounts } from "@/lib/clientActions";
import type { AccountDoc } from "@/hooks/useLedger";
import { BankLogo } from "./BankLogo";

export function PayFromAccounts({
  open,
  onClose,
  onPaid,
  accounts,
  balances,
  getIdToken,
  submit: submitOverride,
  source,
  copy,
  extra,
}: {
  open: boolean;
  onClose: () => void;
  onPaid: (message: string) => void;
  accounts: AccountDoc[];
  balances: Map<string, { balance: number }>;
  getIdToken: () => Promise<string>;
  /** Posts the payment when the generic ledger call is not the right one (paying a period's total). */
  submit?: (input: {
    allocations: Array<{ accountId: string; amount: number }>;
    dayKey: string;
    note: string | null;
  }) => Promise<{ ok: true; fullyPaid: boolean; posted: number } | { ok: false; error: string }>;
  copy?: { title: string; full: string; part: string; linesTitle?: string; done: string; noun?: string; settledWord?: string };
  extra?: React.ReactNode;
  source: {
    module: SourceModule;
    collection: string;
    id: string;
    label: string;
    amount: number;
    alreadyPaid: number;
    direction?: "IN" | "OUT";
    type?: TransactionType;
  };
}) {
  const live = accounts.filter((a) => a.status !== "ARCHIVED");
  const outstanding = Math.round((source.amount - source.alreadyPaid) * 100) / 100;
  const balanceOf = (id: string) => balances.get(id)?.balance ?? 0;

  // Start on the account that can cover it, else the one holding the most.
  const [accountId, setAccountId] = useState(
    () =>
      live.find((a) => balanceOf(a.id) >= outstanding)?.id ??
      [...live].sort((a, b) => balanceOf(b.id) - balanceOf(a.id))[0]?.id ??
      ""
  );
  const [amount, setAmount] = useState(outstanding > 0 ? String(outstanding) : "");
  const [dayKey, setDayKey] = useState(karachiDayKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = Number(amount.replace(/,/g, "")) || 0;
  const allocations = useMemo(() => (accountId ? [{ accountId, amount: value }] : []), [accountId, value]);
  const check = useMemo(
    () => checkAllocations(source.amount, allocations, source.alreadyPaid),
    [source.amount, source.alreadyPaid, allocations]
  );
  const chosen = live.find((a) => a.id === accountId);
  const short = chosen && (source.direction ?? "OUT") === "OUT" && value > balanceOf(chosen.id);

  if (!open) return null;

  const submit = async () => {
    if (!chosen) return setError("Choose the account the money comes from.");
    if (!(value > 0)) return setError("Enter an amount above zero.");
    if (!check.valid) return setError(check.errors[0] ?? "That amount is more than is owed.");
    setBusy(true);
    setError(null);
    try {
      const result = submitOverride
        ? await submitOverride({ allocations, dayKey, note: null })
        : await payFromAccounts(await getIdToken(), {
            sourceModule: source.module,
            sourceId: source.id,
            sourceCollection: source.collection,
            sourceLabel: source.label,
            allocations,
            direction: source.direction ?? "OUT",
            type: source.type ?? (source.direction === "IN" ? "INCOME" : "EXPENSE"),
            dayKey,
            note: null,
          });
      if (!result.ok) return setError(result.error);
      const done = "data" in result ? result.data : result;
      onPaid(
        done.fullyPaid || value >= outstanding
          ? `${formatMoney(value)} paid from ${chosen.name} — ${source.label} is fully paid.`
          : `${formatMoney(value)} paid from ${chosen.name} — ${formatMoney(outstanding - value)} still to pay.`
      );
      onClose();
    } catch {
      setError("Could not reach the server. Nothing was paid.");
    } finally {
      setBusy(false);
    }
  };

  // On the body, so a phone's tab bar can never sit over the buttons.
  return createPortal(
    <div className="overlay fm-acc-overlay" onClick={onClose}>
      <div className="modal fm-acc-modal" role="dialog" aria-modal="true" aria-label="Pay from account" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div>
            <h2>{copy?.title ?? "Pay from account"}</h2>
            <p>
              {source.label} · {outstanding < source.amount ? `${formatMoney(outstanding)} left of ${formatMoney(source.amount)}` : formatMoney(source.amount)}
            </p>
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-b">
          {live.length === 0 ? (
            <div className="fm-acc-empty">
              <b>No accounts yet</b>
              <p>Create an account and add money to it first.</p>
              <Link className="btn pri" href="/admin/accounts">
                Go to Accounts
              </Link>
            </div>
          ) : (
            <form className="fm-acc-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <div className="fld">
                <span>Pay from</span>
                <div className="fm-pay-list" role="radiogroup" aria-label="Account">
                  {live.map((a) => {
                    const bal = balanceOf(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        role="radio"
                        aria-checked={a.id === accountId}
                        className={`fm-pay-opt ${a.id === accountId ? "on" : ""}`}
                        onClick={() => setAccountId(a.id)}
                      >
                        <BankLogo name={a.name} size={36} />
                        <span className="fm-pay-name">{a.name}</span>
                        <b className={bal < outstanding ? "low" : ""}>{formatMoney(bal)}</b>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="fld">
                <label htmlFor="pay-amount">Amount (Rs)</label>
                <input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} />
              </div>
              {!submitOverride && (
                <div className="fld">
                  <label htmlFor="pay-day">Date</label>
                  <input id="pay-day" type="date" value={dayKey} onChange={(e) => setDayKey(e.target.value)} />
                </div>
              )}
              {short && chosen && (
                <p className="fm-acc-hint" style={{ color: "var(--warn)", margin: 0 }}>
                  {chosen.name} only has {formatMoney(balanceOf(chosen.id))} — it will go below zero.
                </p>
              )}
              {extra}
              {error && <p className="fm-acc-err">{error}</p>}
            </form>
          )}
        </div>

        {live.length > 0 && (
          <div className="modal-f">
            <span className="spacer" />
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn pri" disabled={busy || !chosen || !(value > 0)} onClick={submit}>
              {busy ? "Paying…" : chosen && value > 0 ? `Pay ${formatMoney(value)} from ${chosen.name}` : "Pay"}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
