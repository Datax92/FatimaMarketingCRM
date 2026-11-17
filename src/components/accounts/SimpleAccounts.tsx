"use client";

/**
 * Accounts, kept simple: an account is a named pot of money (UBL, EasyPaisa, Cash).
 * Money is added to it, and office and personal expenses are paid out of it.
 * Every movement is a ledger transaction, so a balance is always opening + in − out.
 */

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useLedger, type AccountDoc, type TransactionDoc } from "@/hooks/useLedger";
import { formatMoney } from "@/lib/money";
import { karachiDayKey } from "@/lib/dates";
import { addManualTransaction, createAccount, deleteAccount, deleteTransaction, updateAccount } from "@/lib/clientActions";

const ACCOUNTS_PATH = "/admin/accounts";

/** What a movement was, in the words someone would use for it. */
function describe(t: TransactionDoc): string {
  switch (t.sourceModule) {
    case "OFFICE_EXPENSE":
      return "Office expense";
    case "PERSONAL_EXPENSE":
      return "Personal expense";
    case "TRANSFER":
      return "Transfer";
    case "DEAL_PAYOUT":
      return "Deal";
    default:
      return t.direction === "IN" ? "Money added" : t.type === "TRANSFER" ? "Transfer" : "Money out";
  }
}

const signed = (t: TransactionDoc) => (t.direction === "IN" ? t.amount : -t.amount);

/** "2026-11-08" → "8 Nov 2026", without a time zone shifting the day. */
function dayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) return dayKey;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function SimpleAccounts({ accountId }: { accountId?: string }) {
  const { role, isHr } = useAuth();
  const allowed = role === "admin" || isHr;
  const { accounts, transactions, balances, totalBalance, loading, error } = useLedger(allowed);
  const [dialog, setDialog] = useState<
    | { kind: "new" }
    | { kind: "add"; account: AccountDoc }
    | { kind: "manage"; account: AccountDoc }
    | null
  >(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const live = useMemo(() => accounts.filter((a) => a.status !== "ARCHIVED"), [accounts]);
  const posted = useMemo(() => transactions.filter((t) => t.status !== "VOIDED"), [transactions]);
  const names = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const account = accountId ? accounts.find((a) => a.id === accountId) ?? null : null;

  const flash = (ok: boolean, text: string) => {
    setNote({ ok, text });
    window.setTimeout(() => setNote(null), 3500);
  };

  if (!allowed) {
    return <Empty title="Accounts are for the administrator" body="Your role does not include the company's money." />;
  }

  return (
    <div className="fm-acc">
      {note && (
        <div className={`fm-acc-note ${note.ok ? "ok" : "bad"}`} role="status">
          {note.text}
        </div>
      )}
      {error && (
        <div className="fm-acc-note bad" role="alert">
          {error}
        </div>
      )}

      {accountId ? (
        account ? (
          <AccountDetail
            account={account}
            balance={balances.get(account.id)?.balance ?? account.openingBalance}
            rows={posted.filter((t) => t.accountId === account.id)}
            onAdd={() => setDialog({ kind: "add", account })}
            onManage={() => setDialog({ kind: "manage", account })}
            onFlash={flash}
          />
        ) : (
          <Empty
            title={loading ? "Loading…" : "This account no longer exists"}
            body={loading ? "" : "It may have been deleted."}
            action={
              <Link className="btn" href={ACCOUNTS_PATH}>
                Back to accounts
              </Link>
            }
          />
        )
      ) : (
        <>
          <header className="fm-acc-head">
            <div>
              <h1>Accounts</h1>
              <p>Create an account, add money to it, and pay office or personal expenses from it.</p>
            </div>
            <button type="button" className="btn pri" onClick={() => setDialog({ kind: "new" })}>
              + New account
            </button>
          </header>

          <section className="fm-acc-total">
            <span>Total in all accounts</span>
            <b>{formatMoney(totalBalance)}</b>
            <small>
              {live.length} {live.length === 1 ? "account" : "accounts"}
            </small>
          </section>

          {live.length === 0 && !loading ? (
            <Empty
              title="No accounts yet"
              body="Create your first account — for example UBL, EasyPaisa or Cash in hand — and add the money it holds."
              action={
                <button type="button" className="btn pri" onClick={() => setDialog({ kind: "new" })}>
                  + New account
                </button>
              }
            />
          ) : (
            <div className="fm-acc-grid">
              {live.map((a, i) => (
                <article key={a.id} className="fm-acc-card" style={{ animationDelay: `${i * 40}ms` }}>
                  <Link href={`${ACCOUNTS_PATH}/ledger/${a.id}`} className="fm-acc-card-top">
                    <span className="fm-acc-ini">{a.name.slice(0, 1).toUpperCase()}</span>
                    <span className="fm-acc-name">{a.name}</span>
                    <b className={(balances.get(a.id)?.balance ?? 0) < 0 ? "neg" : ""}>
                      {formatMoney(balances.get(a.id)?.balance ?? a.openingBalance)}
                    </b>
                  </Link>
                  <div className="fm-acc-card-acts">
                    <button type="button" className="btn sm pri" onClick={() => setDialog({ kind: "add", account: a })}>
                      + Add money
                    </button>
                    <Link className="btn sm" href={`${ACCOUNTS_PATH}/ledger/${a.id}`}>
                      History
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}

          <section className="panel fm-acc-panel">
            <div className="panel-h">
              <h3>Recent activity</h3>
              <span className="sub">Across every account</span>
              <span className="spacer" />
              <Link className="btn sm gh" href="/admin/accounts/office-expenses">
                Pay office expense
              </Link>
              <Link className="btn sm gh" href="/admin/accounts/personal-expense">
                Pay personal expense
              </Link>
            </div>
            <Rows rows={posted.slice(0, 12)} names={names} showAccount />
          </section>
        </>
      )}

      {dialog?.kind === "new" && <NewAccountDialog onClose={() => setDialog(null)} onDone={(t) => { setDialog(null); flash(true, t); }} />}
      {dialog?.kind === "add" && (
        <AddMoneyDialog account={dialog.account} onClose={() => setDialog(null)} onDone={(t) => { setDialog(null); flash(true, t); }} />
      )}
      {dialog?.kind === "manage" && (
        <ManageDialog account={dialog.account} onClose={() => setDialog(null)} onDone={(t) => { setDialog(null); flash(true, t); }} />
      )}
    </div>
  );
}

function AccountDetail({
  account,
  balance,
  rows,
  onAdd,
  onManage,
  onFlash,
}: {
  account: AccountDoc;
  balance: number;
  rows: TransactionDoc[];
  onAdd: () => void;
  onManage: () => void;
  onFlash: (ok: boolean, text: string) => void;
}) {
  const { getIdToken } = useAuth();
  const moneyIn = rows.filter((t) => t.direction === "IN").reduce((s, t) => s + t.amount, 0);
  const moneyOut = rows.filter((t) => t.direction === "OUT").reduce((s, t) => s + t.amount, 0);

  const remove = async (t: TransactionDoc) => {
    const what = t.direction === "IN" ? "this money added" : "this payment";
    if (!window.confirm(`Remove ${what} (${formatMoney(t.amount)})? The balance changes back.`)) return;
    const res = await deleteTransaction(await getIdToken(), t.id);
    onFlash(res.ok, res.ok ? "Removed." : res.error);
  };

  return (
    <>
      <Link href={ACCOUNTS_PATH} className="fm-acc-back">
        ← All accounts
      </Link>
      <header className="fm-acc-head">
        <div>
          {/* h2: on a phone the title bar names the section, and this names the account. */}
          <h2 className="fm-acc-title">{account.name}</h2>
          <p>Every rupee added to this account, and every expense paid from it.</p>
        </div>
        <div className="fm-acc-head-acts">
          <button type="button" className="btn" onClick={onManage}>
            Rename / delete
          </button>
          <button type="button" className="btn pri" onClick={onAdd}>
            + Add money
          </button>
        </div>
      </header>

      <section className="fm-acc-stats">
        <div className="fm-acc-total">
          <span>Balance</span>
          <b>{formatMoney(balance)}</b>
          <small>Started with {formatMoney(account.openingBalance)}</small>
        </div>
        <div className="fm-acc-stat in">
          <span>Money added</span>
          <b>{formatMoney(moneyIn)}</b>
        </div>
        <div className="fm-acc-stat out">
          <span>Money spent</span>
          <b>{formatMoney(moneyOut)}</b>
        </div>
      </section>

      <section className="panel fm-acc-panel">
        <div className="panel-h">
          <h3>History</h3>
          <span className="sub">
            {rows.length} {rows.length === 1 ? "entry" : "entries"}
          </span>
          <span className="spacer" />
          <Link className="btn sm gh" href="/admin/accounts/office-expenses">
            Pay office expense
          </Link>
          <Link className="btn sm gh" href="/admin/accounts/personal-expense">
            Pay personal expense
          </Link>
        </div>
        <Rows rows={rows} onRemove={remove} />
      </section>
    </>
  );
}

function Rows({
  rows,
  names,
  showAccount,
  onRemove,
}: {
  rows: TransactionDoc[];
  names?: Map<string, string>;
  showAccount?: boolean;
  onRemove?: (t: TransactionDoc) => void;
}) {
  if (rows.length === 0) {
    return <p className="fm-acc-none">Nothing yet. Add money to an account, or pay an expense from one.</p>;
  }
  return (
    <ul className="fm-acc-rows">
      {rows.map((t, i) => (
        <li key={t.id} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
          <span className={`fm-acc-dot ${t.direction === "IN" ? "in" : "out"}`}>{t.direction === "IN" ? "+" : "−"}</span>
          <span className="fm-acc-row-t">
            <b>{t.sourceLabel || describe(t)}</b>
            <small>
              {describe(t)} · {dayLabel(t.dayKey)}
              {showAccount && names ? ` · ${names.get(t.accountId) ?? "Deleted account"}` : ""}
            </small>
          </span>
          <b className={t.direction === "IN" ? "pos" : "neg"}>
            {signed(t) > 0 ? "+" : "−"}
            {formatMoney(t.amount)}
          </b>
          {onRemove && (
            <button type="button" className="fm-acc-x" aria-label="Remove" title="Remove" onClick={() => onRemove(t)}>
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Dialog({
  title,
  sub,
  onClose,
  children,
  footer,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  // On the body, so a phone's tab bar can never sit over the buttons.
  return createPortal(
    <div className="overlay fm-acc-overlay" onClick={onClose}>
      <div className="modal fm-acc-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-b">{children}</div>
        <div className="modal-f">{footer}</div>
      </div>
    </div>,
    document.body
  );
}

function AmountField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="fld">
      <label htmlFor="acc-amount">Amount (Rs)</label>
      <input
        id="acc-amount"
        inputMode="decimal"
        autoFocus={autoFocus}
        placeholder="500,000"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
      />
    </div>
  );
}

const toNumber = (v: string) => Number(v.replace(/,/g, "")) || 0;

function NewAccountDialog({ onClose, onDone }: { onClose: () => void; onDone: (text: string) => void }) {
  const { getIdToken } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await createAccount(await getIdToken(), { name, kind: "BANK", openingBalance: toNumber(amount) });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onDone(`${name.trim()} created${toNumber(amount) ? ` with ${formatMoney(toNumber(amount))}` : ""}.`);
    router.prefetch(`${ACCOUNTS_PATH}/ledger/${res.data.accountId}`);
  };

  return (
    <Dialog
      title="New account"
      sub="Any name you like — a bank, a wallet, cash in the drawer."
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn pri" disabled={busy || !name.trim()} onClick={save}>
            {busy ? "Creating…" : "Create account"}
          </button>
        </>
      }
    >
      <form className="fm-acc-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save(); }}>
        <div className="fld">
          <label htmlFor="acc-name">Account name</label>
          <input id="acc-name" autoFocus placeholder="UBL, EasyPaisa, Cash…" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <AmountField value={amount} onChange={setAmount} />
        <p className="fm-acc-hint">The money already in it. Leave empty to start at zero.</p>
        {error && <p className="fm-acc-err">{error}</p>}
      </form>
    </Dialog>
  );
}

function AddMoneyDialog({ account, onClose, onDone }: { account: AccountDoc; onClose: () => void; onDone: (text: string) => void }) {
  const { getIdToken } = useAuth();
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [day, setDay] = useState(karachiDayKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const value = toNumber(amount);
    if (!(value > 0)) return setError("Enter an amount above zero.");
    setBusy(true);
    setError(null);
    const res = await addManualTransaction(await getIdToken(), {
      accountId: account.id,
      direction: "IN",
      amount: value,
      type: "INCOME",
      dayKey: day,
      label: label.trim() || "Money added",
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onDone(`${formatMoney(value)} added to ${account.name}.`);
  };

  return (
    <Dialog
      title={`Add money to ${account.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn pri" disabled={busy} onClick={save}>
            {busy ? "Adding…" : "Add money"}
          </button>
        </>
      }
    >
      <form className="fm-acc-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <AmountField value={amount} onChange={setAmount} autoFocus />
        <div className="fld">
          <label htmlFor="acc-label">Where it came from (optional)</label>
          <input id="acc-label" placeholder="Deal commission, owner's deposit…" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="fld">
          <label htmlFor="acc-day">Date</label>
          <input id="acc-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        {error && <p className="fm-acc-err">{error}</p>}
      </form>
    </Dialog>
  );
}

function ManageDialog({ account, onClose, onDone }: { account: AccountDoc; onClose: () => void; onDone: (text: string) => void }) {
  const { getIdToken } = useAuth();
  const router = useRouter();
  const [name, setName] = useState(account.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rename = async () => {
    setBusy(true);
    const res = await updateAccount(await getIdToken(), account.id, { name: name.trim() });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onDone("Renamed.");
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${account.name} and its whole history? This cannot be undone.`)) return;
    setBusy(true);
    const res = await deleteAccount(await getIdToken(), account.id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.push(ACCOUNTS_PATH);
    onDone(`${account.name} deleted.`);
  };

  return (
    <Dialog
      title="Rename or delete"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn bad" disabled={busy} onClick={remove}>
            Delete account
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn pri" disabled={busy || !name.trim() || name.trim() === account.name} onClick={rename}>
            Save name
          </button>
        </>
      }
    >
      <form className="fm-acc-form" onSubmit={(e) => { e.preventDefault(); rename(); }}>
        <div className="fld">
          <label htmlFor="acc-rename">Account name</label>
          <input id="acc-rename" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {error && <p className="fm-acc-err">{error}</p>}
      </form>
    </Dialog>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="fm-acc-empty">
      <b>{title}</b>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}
