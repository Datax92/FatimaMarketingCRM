import "server-only";

/**
 * **Who may read what** — `firestore.rules`, moved to the server.
 *
 * Browsers no longer talk to the database. Every read a screen makes goes
 * through `/api/db`, which verifies the Firebase ID token and then asks this
 * module about **every document it is about to return**. A document the
 * caller may not read is never sent; a query is not refused for being
 * "unprovable" the way Firestore refused it, it is simply answered with what
 * the caller may see. The screens' queries still carry their scope clauses
 * (`where('assignedUserId','==',me)` and so on), so in practice nothing is
 * filtered out — the check is the boundary, the clause is the efficiency.
 *
 * The rules are the same, clause for clause, as the Firestore rules they
 * replace, including the reasons recorded there:
 *
 * - writes from a browser are refused everywhere except an admin renaming a
 *   connected WhatsApp number's label;
 * - HR's reach comes from the `managerKind` claim;
 * - a Sales manager reads by the denormalised `subAdminUid` on the document;
 * - `wa_secrets`, `wa_meta`, `cronState` and anything not listed are never
 *   readable from a browser.
 */

export interface Caller {
  uid: string;
  role: string | null;
  managerKind: string | null;
}

type Data = Record<string, unknown>;
export type DocLoader = (path: string) => Promise<Data | null>;

const isAdmin = (c: Caller) => c.role === "admin";
const isEmployee = (c: Caller) => c.role === "employee";
const isSubAdmin = (c: Caller) => c.role === "subadmin";
const isHr = (c: Caller) => isSubAdmin(c) && c.managerKind === "HR";
const ownsTeam = (c: Caller, d: Data | null) => isSubAdmin(c) && !!d && d.subAdminUid === c.uid;

type Rule = (caller: Caller, data: Data | null, ids: string[], load: DocLoader) => boolean | Promise<boolean>;

const adminOrHr: Rule = (c) => isAdmin(c) || isHr(c);
const adminOnly: Rule = (c) => isAdmin(c);

async function ownsLead(c: Caller, leadId: string, load: DocLoader): Promise<boolean> {
  if (!isEmployee(c)) return false;
  const lead = await load(`leads/${leadId}`);
  return !!lead && lead.assignedUserId === c.uid;
}

async function managesLead(c: Caller, leadId: string, load: DocLoader): Promise<boolean> {
  if (!isSubAdmin(c)) return false;
  const lead = await load(`leads/${leadId}`);
  return !!lead && lead.subAdminUid === c.uid;
}

const leadChild: Rule = async (c, _d, ids, load) =>
  isAdmin(c) || isHr(c) || (await ownsLead(c, ids[0], load)) || (await managesLead(c, ids[0], load));

/**
 * Keyed by the collection pattern with ids removed: `leads`, `leads/followUps`,
 * `users/kpiMonths`. `ids` are the document ids along the path, outermost first.
 */
const RULES: Record<string, Rule> = {
  users: (c, d, ids) => isAdmin(c) || c.uid === ids[0] || ownsTeam(c, d) || isHr(c),
  "users/kpiMonths": async (c, _d, ids, load) => {
    if (isAdmin(c) || c.uid === ids[0]) return true;
    if (!isSubAdmin(c)) return false;
    const user = await load(`users/${ids[0]}`);
    return !!user && user.subAdminUid === c.uid;
  },
  attendance: (c, d) => isAdmin(c) || (!!d && d.uid === c.uid),
  leaveRequests: (c, d) => isAdmin(c) || (!!d && d.uid === c.uid) || ownsTeam(c, d),
  payrollPeriods: adminOrHr,
  payslips: (c, d) => isAdmin(c) || (!!d && d.uid === c.uid),
  attendancePeriods: adminOrHr,
  configHistory: adminOnly,
  campaigns: () => true,
  leads: (c, d) => isAdmin(c) || (isEmployee(c) && !!d && d.assignedUserId === c.uid) || ownsTeam(c, d) || isHr(c),
  "leads/followUps": leadChild,
  "leads/events": leadChild,
  // A missing deal reads as absent for anyone who could have read it, as the
  // Firestore rule's `resource == null` clause allowed.
  closedDeals: (c, d) =>
    isAdmin(c) ||
    isHr(c) ||
    (isEmployee(c) && (d === null || d.userId === c.uid)) ||
    (isSubAdmin(c) && (d === null || d.subAdminUid === c.uid)),
  dealDistributions: adminOnly,
  dealPayouts: (c, d) => isAdmin(c) || (!!d && d.recipientUid === c.uid) || ownsTeam(c, d),
  expenses: (c, d) => isAdmin(c) || (isHr(c) && !!d && d.addedByUid === c.uid),
  notifications: (c, d) => isAdmin(c) || ((isEmployee(c) || isSubAdmin(c)) && !!d && d.targetUid === c.uid),
  accounts: adminOrHr,
  transactions: adminOrHr,
  stateLifePolicies: adminOrHr,
  marketingIncome: adminOrHr,
  carSales: adminOrHr,
  investmentBooks: adminOrHr,
  investmentRounds: adminOrHr,
  groupMonths: adminOrHr,
  groupFinanceConfig: adminOrHr,
  receivableEntries: adminOrHr,
  receivableSheetConfig: adminOrHr,
  amanatEntries: adminOrHr,
  metaIntakeIssues: (c) => isAdmin(c) || isSubAdmin(c),
  capitalSpendings: adminOrHr,
  committee: adminOnly,
  investments: adminOnly,
  capitalInvestments: adminOnly,
  personalExpenses: (c, d) => isAdmin(c) || isHr(c) || (!!d && d.employeeUid === c.uid) || ownsTeam(c, d),
  receivables: adminOnly,
  clientFolders: (c, d) => isAdmin(c) || ownsTeam(c, d),
  clientFolderLeads: (c, d) => isAdmin(c) || ownsTeam(c, d),
  config: adminOnly,
  dataBankFolders: (c, d) => isAdmin(c) || ownsTeam(c, d),
  dataBankRecords: async (c, d, _ids, load) => {
    if (isAdmin(c)) return true;
    if (!isSubAdmin(c) || !d || typeof d.folderId !== "string") return false;
    const folder = await load(`dataBankFolders/${d.folderId}`);
    return !!folder && folder.subAdminUid === c.uid;
  },
  wa_messages: adminOnly,
  wa_conversations: adminOnly,
  wa_contacts: adminOnly,
  wa_numbers: adminOnly,
};

/** `leads/abc/followUps/x` → `{ key: "leads/followUps", ids: ["abc", "x"] }`. */
export function ruleKey(docPath: string): { key: string; ids: string[] } {
  const parts = docPath.split("/").filter(Boolean);
  const names: string[] = [];
  const ids: string[] = [];
  for (let i = 0; i < parts.length; i++) (i % 2 === 0 ? names : ids).push(parts[i]);
  return { key: names.join("/"), ids };
}

/** The pattern a collection's documents fall under, for a quick yes/no before running a query. */
export function collectionKey(parent: string, collection: string, group: boolean): string {
  if (group) {
    const match = Object.keys(RULES).find((key) => key === collection || key.endsWith(`/${collection}`));
    return match ?? collection;
  }
  const parts = parent.split("/").filter(Boolean);
  const names = parts.filter((_, index) => index % 2 === 0);
  return [...names, collection].join("/");
}

export function hasRule(key: string): boolean {
  return key in RULES;
}

export async function canRead(caller: Caller, docPath: string, data: Data | null, load: DocLoader): Promise<boolean> {
  const { key, ids } = ruleKey(docPath);
  const rule = RULES[key];
  if (!rule) return false;
  return rule(caller, data, ids, load);
}

/** The only write a browser may make: an admin renaming a connected WhatsApp number. */
export function canClientUpdate(caller: Caller, docPath: string, fields: string[]): boolean {
  const { key } = ruleKey(docPath);
  return key === "wa_numbers" && isAdmin(caller) && fields.length > 0 && fields.every((field) => field === "label");
}
