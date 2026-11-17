/**
 * Sample rows for the Accounts section in demo mode.
 *
 * Every Accounts screen reads through `useLive`, keyed by collection, so this
 * is one table of rows per key rather than a branch in each hook. It is
 * read-only: the writes go through Server Actions, which a demo deployment has
 * no database behind (`runAction` says so in plain words).
 *
 * The figures hang together the way the real ledger does — an expense split across two
 * accounts is two OUT legs, a transfer is a pair — so balances and statements agree.
 */

type Row = Record<string, unknown> & { id: string };

const by = { createdByUid: 'demo-admin', createdByName: 'Usman Sheikh' };

const accounts: Row[] = [
  { id: 'acc_ubl', name: 'UBL — Current', kind: 'BANK', openingBalance: 1_800_000, status: 'ACTIVE' },
  { id: 'acc_meezan', name: 'Meezan Bank', kind: 'BANK', openingBalance: 950_000, status: 'ACTIVE' },
  { id: 'acc_hbl', name: 'HBL — Business', kind: 'BANK', openingBalance: 600_000, status: 'ACTIVE' },
  { id: 'acc_easypaisa', name: 'EasyPaisa', kind: 'WALLET', openingBalance: 85_000, status: 'ACTIVE' },
  { id: 'acc_jazz', name: 'JazzCash', kind: 'WALLET', openingBalance: 40_000, status: 'ACTIVE' },
  { id: 'acc_cash', name: 'Cash in Hand', kind: 'CASH', openingBalance: 150_000, status: 'ACTIVE' },
].sort((a, b) => String(a.name).localeCompare(String(b.name)));

function txn(
  id: string,
  accountId: string,
  direction: 'IN' | 'OUT',
  amount: number,
  type: string,
  dayKey: string,
  sourceModule: string,
  sourceLabel: string,
  extra: Record<string, unknown> = {}
): Row {
  return {
    id, accountId, direction, amount, type, dayKey, sourceModule, sourceLabel,
    sourceId: extra.sourceId ?? null, groupId: extra.groupId ?? null, status: 'POSTED', note: null,
    ...by, ...extra,
  };
}

const transactions: Row[] = [
  // Income added to a bank or wallet.
  txn('t01', 'acc_ubl', 'IN', 450_000, 'INCOME', '2026-10-09', 'DEAL_PAYOUT', 'Deal — DHA Phase 6 commission'),
  txn('t02', 'acc_meezan', 'IN', 180_000, 'INCOME', '2026-10-18', 'MANUAL', 'Campaign fee — Gulberg Heights'),
  txn('t03', 'acc_easypaisa', 'IN', 35_000, 'INCOME', '2026-11-03', 'MANUAL', 'Booking token received'),
  txn('t04', 'acc_ubl', 'IN', 320_000, 'INCOME', '2026-11-08', 'DEAL_PAYOUT', 'Deal — Bahria Town plot commission'),
  txn('t05', 'acc_hbl', 'IN', 95_000, 'INCOME', '2026-11-12', 'MANUAL', 'Lead package — Lake City'),
  // Office expenses paid from accounts, one split across two.
  txn('t06', 'acc_ubl', 'OUT', 110_000, 'EXPENSE', '2026-11-02', 'OFFICE_EXPENSE', 'Office rent (part)', { sourceId: 'demo-exp-1', groupId: 'g_rent' }),
  txn('t07', 'acc_meezan', 'OUT', 40_000, 'EXPENSE', '2026-11-02', 'OFFICE_EXPENSE', 'Office rent (part)', { sourceId: 'demo-exp-1', groupId: 'g_rent' }),
  txn('t08', 'acc_cash', 'OUT', 60_000, 'EXPENSE', '2026-11-05', 'OFFICE_EXPENSE', 'Generator repair', { sourceId: 'demo-exp-2' }),
  txn('t09', 'acc_hbl', 'OUT', 75_000, 'EXPENSE', '2026-11-10', 'MANUAL', 'Meta ads top-up'),
  // Day-to-day.
  txn('t10', 'acc_cash', 'OUT', 18_500, 'EXPENSE', '2026-11-07', 'MANUAL', 'Fuel and tea'),
  txn('t11', 'acc_jazz', 'OUT', 12_000, 'EXPENSE', '2026-11-08', 'MANUAL', 'Mobile packages'),
  // A transfer, both legs.
  txn('t12', 'acc_ubl', 'OUT', 100_000, 'TRANSFER', '2026-11-04', 'MANUAL', 'Transfer to cash', { groupId: 'g_tr1', counterAccountId: 'acc_cash' }),
  txn('t13', 'acc_cash', 'IN', 100_000, 'TRANSFER', '2026-11-04', 'MANUAL', 'Transfer from UBL', { groupId: 'g_tr1', counterAccountId: 'acc_ubl' }),
].sort((a, b) => String(b.dayKey).localeCompare(String(a.dayKey)));

const personalExpenses: Row[] = [
  { id: 'pe_1', employeeUid: 'demo-admin', title: 'Client lunch', category: 'Meals', vendor: 'Monal', amount: 14_500, paidAmount: 0, dayKey: '2026-10-07', purpose: 'Meeting with Gulberg Heights' },
  { id: 'pe_2', employeeUid: 'demo-admin', title: 'Site visit fuel', category: 'Travel', vendor: 'PSO', amount: 6_000, paidAmount: 6_000, dayKey: '2026-10-02', purpose: 'DHA Phase 6 visit' },
];

const FIXTURE: Record<string, Row[]> = {
  accounts,
  transactions,
  'personalExpenses:all': personalExpenses,
};

/** The rows a `useLive` key reads in demo mode; an unknown key reads empty. */
export function demoLiveRows(key: string): Row[] {
  if (key in FIXTURE) return FIXTURE[key];
  if (key.startsWith('personalExpenses:')) {
    const uid = key.slice('personalExpenses:'.length);
    return personalExpenses.filter((row) => row.employeeUid === uid);
  }
  return [];
}
