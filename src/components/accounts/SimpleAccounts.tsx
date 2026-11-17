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
import { karachiDayKey, karachiMonthKey } from "@/lib/dates";
import { BANKS, bankFor, colourFor } from "@/lib/banks";
import { addManualTransaction, createAccount, deleteAccount, deleteTransaction, updateAccount } from "@/lib/clientActions";
import { BankLogo } from "./BankLogo";

const ACCOUNTS_PATH = "/admin/accounts";
const PAGE_SIZE = 10;

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

/** "2026-11-08" → "8 Nov 2026", without a time zone shifting the day. */
function dayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) return dayKey;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const kindLabel = (name: string) => {
  const bank = bankFor(name);
  return bank ? (bank.kind === "wallet" ? "Mobile wallet" : bank.kind === "cash" ? "Cash" : "Bank account") : "Account";
};

/** The account's brand colour, used for its card's accent. */
const tint = (name: string) => bankFor(name)?.bg ?? colourFor(name);

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
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const account = accountId ? byId.get(accountId) ?? null : null;
  const balanceOf = (a: AccountDoc) => balances.get(a.id)?.balance ?? a.openingBalance;

  const month = karachiMonthKey();
  const monthIn = posted.filter((t) => t.direction === "IN" && t.type !== "TRANSFER" && t.dayKey.startsWith(month)).reduce((s, t) => s + t.amount, 0);
  const monthOut = posted.filter((t) => t.direction === "OUT" && t.type !== "TRANSFER" && t.dayKey.startsWith(month)).reduce((s, t) => s + t.amount, 0);

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
            balance={balanceOf(account)}
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

          <section className="fm-acc-hero">
            <div className="fm-acc-hero-main">
              <span>Total in all accounts</span>
              <b>{formatMoney(totalBalance)}</b>
              <small>
                {live.length} {live.length === 1 ? "account" : "accounts"}
              </small>
            </div>
            <div className="fm-acc-hero-side">
              <div>
                <span>Added this month</span>
                <b className="in">+{formatMoney(monthIn)}</b>
              </div>
              <div>
                <span>Spent this month</span>
                <b className="out">−{formatMoney(monthOut)}</b>
              </div>
            </div>
            {/* The accounts' own colours, as a strip under the total. */}
            {totalBalance > 0 && (
              <div className="fm-acc-mix" aria-hidden="true">
                {live
                  .filter((a) => balanceOf(a) > 0)
                  .map((a) => (
                    <i key={a.id} style={{ flexGrow: balanceOf(a), background: tint(a.name) }} title={`${a.name}: ${formatMoney(balanceOf(a))}`} />
                  ))}
              </div>
            )}
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
              {live.map((a, i) => {
                const last = posted.find((t) => t.accountId === a.id);
                return (
                  <article
                    key={a.id}
                    className="fm-acc-card"
                    style={{ animationDelay: `${i * 40}ms`, "--acc": tint(a.name) } as React.CSSProperties}
                  >
                    <Link href={`${ACCOUNTS_PATH}/ledger/${a.id}`} className="fm-acc-card-top">
                      <BankLogo name={a.name} size={44} />
                      <span className="fm-acc-card-id">
                        <span className="fm-acc-name">{a.name}</span>
                        <small>{kindLabel(a.name)}</small>
                      </span>
                    </Link>
                    <div className="fm-acc-card-bal">
                      <small>Balance</small>
                      <b className={balanceOf(a) < 0 ? "neg" : ""}>{formatMoney(balanceOf(a))}</b>
                      <span className="fm-acc-last">
                        {last
                          ? `${last.direction === "IN" ? "+" : "−"}${formatMoney(last.amount)} · ${dayLabel(last.dayKey)}`
                          : "No activity yet"}
                      </span>
                    </div>
                    <div className="fm-acc-card-acts">
                      <button type="button" className="btn sm pri" onClick={() => setDialog({ kind: "add", account: a })}>
                        + Add money
                      </button>
                      <Link className="btn sm" href={`${ACCOUNTS_PATH}/ledger/${a.id}`}>
                        History
                      </Link>
                    </div>
                  </article>
                );
              })}
              <button type="button" className="fm-acc-card fm-acc-add" onClick={() => setDialog({ kind: "new" })}>
                <span>+</span>
                New account
              </button>
            </div>
          )}

          <History title="Recent activity" sub="Across every account" rows={posted} byId={byId} showAccount />
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

      <section className="fm-acc-hero fm-acc-hero-acc" style={{ "--acc": tint(account.name) } as React.CSSProperties}>
        <div className="fm-acc-hero-id">
          <BankLogo name={account.name} size={56} />
          <div>
            {/* h2: on a phone the title bar names the section, and this names the account. */}
            <h2 className="fm-acc-title">{account.name}</h2>
            <small>
              {kindLabel(account.name)} · started with {formatMoney(account.openingBalance)}
            </small>
          </div>
        </div>
        <div className="fm-acc-hero-main">
          <span>Balance</span>
          <b>{formatMoney(balance)}</b>
        </div>
        <div className="fm-acc-hero-side">
          <div>
            <span>Money added</span>
            <b className="in">+{formatMoney(moneyIn)}</b>
          </div>
          <div>
            <span>Money spent</span>
            <b className="out">−{formatMoney(moneyOut)}</b>
          </div>
        </div>
        <div className="fm-acc-hero-acts">
          <button type="button" className="btn fm-ghost-light" onClick={onManage}>
            Rename / delete
          </button>
          <button type="button" className="btn fm-solid-light" onClick={onAdd}>
            + Add money
          </button>
        </div>
      </section>

      <History title="History" rows={rows} onRemove={remove} />
    </>
  );
}

type Flow = "ALL" | "IN" | "OUT";

/** A searchable, filterable, paged list of movements. */
function History({
  title,
  sub,
  rows,
  byId,
  showAccount,
  onRemove,
}: {
  title: string;
  sub?: string;
  rows: TransactionDoc[];
  byId?: Map<string, AccountDoc>;
  showAccount?: boolean;
  onRemove?: (t: TransactionDoc) => void;
}) {
  const [flow, setFlow] = useState<Flow>("ALL");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (t) =>
        (flow === "ALL" || t.direction === flow) &&
        (!q ||
          (t.sourceLabel ?? "").toLowerCase().includes(q) ||
          describe(t).toLowerCase().includes(q) ||
          (byId?.get(t.accountId)?.name ?? "").toLowerCase().includes(q))
    );
  }, [rows, flow, query, byId]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  // A filter that shrinks the list never leaves you on a page that no longer exists.
  const current = Math.min(page, pages);
  const slice = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const changeFlow = (f: Flow) => {
    setFlow(f);
    setPage(1);
  };
  const changeQuery = (q: string) => {
    setQuery(q);
    setPage(1);
  };

  return (
    <section className="panel fm-acc-panel">
      <div className="panel-h">
        <h3>{title}</h3>
        {sub && <span className="sub">{sub}</span>}
        <span className="spacer" />
        <Link className="btn sm gh" href="/admin/accounts/office-expenses">
          Pay office expense
        </Link>
        <Link className="btn sm gh" href="/admin/accounts/personal-expense">
          Pay personal expense
        </Link>
      </div>
      <div className="fm-acc-tools">
        <input className="fm-acc-search" placeholder="Search…" value={query} onChange={(e) => changeQuery(e.target.value)} aria-label="Search history" />
        <span className="seg" role="group" aria-label="Show">
          {(["ALL", "IN", "OUT"] as const).map((f) => (
            <button key={f} type="button" aria-pressed={flow === f} onClick={() => changeFlow(f)}>
              {f === "ALL" ? "All" : f === "IN" ? "Money in" : "Money out"}
            </button>
          ))}
        </span>
      </div>

      {slice.length === 0 ? (
        <p className="fm-acc-none">
          {rows.length === 0 ? "Nothing yet. Add money to an account, or pay an expense from one." : "Nothing matches."}
        </p>
      ) : (
        <ul className="fm-acc-rows" key={`${current}-${flow}`}>
          {slice.map((t, i) => {
            const acc = byId?.get(t.accountId);
            return (
              <li key={t.id} style={{ animationDelay: `${i * 25}ms` }}>
                {showAccount ? (
                  <BankLogo name={acc?.name ?? "?"} size={30} />
                ) : (
                  <span className={`fm-acc-dot ${t.direction === "IN" ? "in" : "out"}`}>{t.direction === "IN" ? "+" : "−"}</span>
                )}
                <span className="fm-acc-row-t">
                  <b>{t.sourceLabel || describe(t)}</b>
                  <small>
                    <em className={`fm-acc-tag ${t.direction === "IN" ? "in" : "out"}`}>{describe(t)}</em> {dayLabel(t.dayKey)}
                    {showAccount ? ` · ${acc?.name ?? "Deleted account"}` : ""}
                  </small>
                </span>
                <b className={t.direction === "IN" ? "pos" : "neg"}>
                  {t.direction === "IN" ? "+" : "−"}
                  {formatMoney(t.amount)}
                </b>
                {onRemove ? (
                  <button type="button" className="fm-acc-x" aria-label="Remove" title="Remove" onClick={() => onRemove(t)}>
                    ×
                  </button>
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {shown.length > PAGE_SIZE && <Pager page={current} pages={pages} total={shown.length} onPage={setPage} />}
    </section>
  );
}

function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (n: number) => void }) {
  // First, last, and the pages around the current one; gaps become "…".
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1);
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  return (
    <nav className="fm-pager" aria-label="Pages">
      <span className="fm-pager-info">
        {from}–{to} of {total}
      </span>
      <span className="fm-pager-btns">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          ‹
        </button>
        {nums.map((n, i) => (
          <span key={n} style={{ display: "contents" }}>
            {i > 0 && n - nums[i - 1] > 1 && <span className="fm-pager-gap">…</span>}
            <button type="button" className={n === page ? "on" : ""} aria-current={n === page ? "page" : undefined} onClick={() => onPage(n)}>
              {n}
            </button>
          </span>
        ))}
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          ›
        </button>
      </span>
    </nav>
  );
}

function Dialog({
  title,
  sub,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  wide?: boolean;
}) {
  // On the body, so a phone's tab bar can never sit over the buttons.
  return createPortal(
    <div className="overlay fm-acc-overlay" onClick={onClose}>
      <div
        className={`modal fm-acc-modal ${wide ? "fm-acc-modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
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
  const n = toNumber(value);
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
      {n > 0 && <small className="fm-acc-hint">{formatMoney(n)}</small>}
    </div>
  );
}

const toNumber = (v: string) => Number(v.replace(/,/g, "")) || 0;

/** The banks offered first when creating an account; the rest are one tap away. */
const POPULAR = ["ubl", "hbl", "meezan", "mcb", "alfalah", "allied", "easypaisa", "jazzcash", "cash"];

function NewAccountDialog({ onClose, onDone }: { onClose: () => void; onDone: (text: string) => void }) {
  const { getIdToken } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picked = bankFor(name);
  const options = all ? BANKS : BANKS.filter((b) => POPULAR.includes(b.id));

  const save = async () => {
    setBusy(true);
    setError(null);
    const kind = picked?.kind === "wallet" ? "WALLET" : picked?.kind === "cash" ? "CASH" : "BANK";
    const res = await createAccount(await getIdToken(), { name, kind, openingBalance: toNumber(amount) });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onDone(`${name.trim()} created${toNumber(amount) ? ` with ${formatMoney(toNumber(amount))}` : ""}.`);
    router.prefetch(`${ACCOUNTS_PATH}/ledger/${res.data.accountId}`);
  };

  return (
    <Dialog
      title="New account"
      sub="Pick a bank or wallet, or type any name."
      onClose={onClose}
      wide
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
        <div className="fm-bank-grid" role="radiogroup" aria-label="Bank or wallet">
          {options.map((b) => (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={picked?.id === b.id}
              className={`fm-bank-opt ${picked?.id === b.id ? "on" : ""}`}
              onClick={() => setName(b.kind === "cash" ? "Cash in hand" : b.name)}
            >
              <BankLogo name={b.kind === "cash" ? "Cash" : b.name} size={36} />
              <span>{b.name}</span>
            </button>
          ))}
          {!all && (
            <button type="button" className="fm-bank-opt more" onClick={() => setAll(true)}>
              <span className="fm-bank-more">+{BANKS.length - options.length}</span>
              <span>More banks</span>
            </button>
          )}
        </div>
        <div className="fld">
          <label htmlFor="acc-name">Account name</label>
          <div className="fm-acc-name-in">
            <BankLogo name={name || "?"} size={30} />
            <input id="acc-name" placeholder="UBL, EasyPaisa, Cash… or any name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
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
      title="Add money"
      sub={account.name}
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
        <div className="fm-acc-to">
          <BankLogo name={account.name} size={36} />
          <span>
            Into <b>{account.name}</b>
          </span>
        </div>
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
          <div className="fm-acc-name-in">
            <BankLogo name={name || "?"} size={30} />
            <input id="acc-rename" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
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
