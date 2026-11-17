/**
 * Every place a person can go, per role. The navbar shows the open section's
 * items as its menu; the home screen shows one icon per item (`tile`), and the
 * cards view groups them under each section's title.
 */

export type Role = "admin" | "subadmin" | "employee";

export interface NavItem {
  label: string;
  path: string;
  /** AppIcon artwork for the home tile. */
  icon: string;
  /** The home tile's name when the menu label alone would be ambiguous there. */
  tile?: string;
  /** Tooltip / card subtitle on the home screen. */
  hint?: string;
}

export interface NavSection {
  id: string;
  label: string;
  icon: string;
  items: NavItem[];
}

const attendance = (base: string, opts: { manage: boolean; settings: boolean }): NavSection => ({
  id: "attendance",
  label: "Attendance",
  icon: "attendance",
  items: opts.manage
    ? [
        { label: "Overview", path: `${base}/attendance`, icon: "attendance", tile: "Attendance", hint: "Who is in today" },
        { label: "My Attendance", path: `${base}/attendance/me`, icon: "checkin", hint: "Check in and out" },
        { label: "Calendar", path: `${base}/attendance/calendar`, icon: "calendar", hint: "The month at a glance" },
        { label: "Leave", path: `${base}/attendance/leave`, icon: "leave", hint: "Requests and balances" },
        { label: "Reports", path: `${base}/attendance/reports`, tile: "Attendance Reports", icon: "fiscal", hint: "Attendance over a period" },
        { label: "Late / Absence", path: `${base}/attendance/records`, icon: "late", hint: "Late arrivals and absences" },
        ...(opts.settings
          ? [{ label: "Settings", path: `${base}/attendance/settings`, tile: "Attendance Settings", icon: "settings", hint: "Office hours and rules" }]
          : []),
      ]
    : [
        { label: "My Attendance", path: `${base}/attendance`, icon: "checkin", hint: "Check in and out" },
        { label: "Calendar", path: `${base}/attendance/calendar`, icon: "calendar", hint: "Your month" },
        { label: "My Leave", path: `${base}/attendance/leave`, icon: "leave", hint: "Apply for leave" },
      ],
});

const ADMIN: NavSection[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "dashboard",
    items: [{ label: "Day End", path: "/dashboard", tile: "Dashboard", icon: "dashboard", hint: "Targets, KPIs and the team today" }],
  },
  {
    id: "leads",
    label: "Leads",
    icon: "leads",
    items: [
      { label: "Leads", path: "/admin/leads", icon: "leads", hint: "Every lead and who is working it" },
      { label: "Campaigns", path: "/admin/leads/campaigns", icon: "campaigns", hint: "Leads by campaign" },
    ],
  },
  {
    id: "data",
    label: "Data Bank",
    icon: "databank",
    items: [
      { label: "Sources", path: "/admin/data-bank", tile: "Data Bank", icon: "databank", hint: "Imported lists and folders" },
      { label: "Meta Ads", path: "/admin/meta-ads", icon: "meta", hint: "Facebook & Instagram lead forms" },
    ],
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: "whatsapp",
    items: [{ label: "Monitor", path: "/admin/whatsapp", tile: "WhatsApp", icon: "whatsapp", hint: "Employees' WhatsApp chats" }],
  },
  {
    id: "team",
    label: "Team",
    icon: "agents",
    items: [
      { label: "Directory", path: "/admin/employees/directory", tile: "Employees", icon: "agents", hint: "Employees and managers" },
      { label: "Reports", path: "/admin/team/reports", tile: "Team Reports", icon: "reports", hint: "Activity per person" },
      { label: "Priority", path: "/admin/employees/priority", tile: "Lead Priority", icon: "priority", hint: "Who gets the next lead" },
    ],
  },
  {
    id: "clients",
    label: "Clients",
    icon: "clients",
    items: [{ label: "Folders", path: "/admin/clients", tile: "Clients", icon: "clients", hint: "Customers by folder" }],
  },
  {
    id: "money",
    label: "Financials",
    icon: "pnl",
    items: [
      { label: "Closed Deals", path: "/admin/financials/deals", icon: "sales", hint: "Every won deal" },
      { label: "Profit Distribution", path: "/admin/financials/distribution", icon: "gross", hint: "Who gets what" },
      { label: "Reports", path: "/admin/financials/reports", tile: "Financial Reports", icon: "net", hint: "Revenue and profit" },
    ],
  },
  {
    id: "accounts",
    label: "Accounts",
    icon: "bank",
    items: [
      { label: "Banks & Wallets", path: "/admin/accounts", icon: "bank", hint: "UBL, EasyPaisa, cash — add income" },
      { label: "Office Expenses", path: "/admin/accounts/office-expenses", icon: "expenses", hint: "Rent, bills, supplies" },
      { label: "Personal Expenses", path: "/admin/accounts/personal-expense", icon: "cash", hint: "Owner's own spending" },
    ],
  },
  attendance("/admin", { manage: true, settings: true }),
  {
    id: "settings",
    label: "Settings",
    icon: "admin",
    items: [
      { label: "Settings", path: "/admin/settings", icon: "admin", hint: "Lead rules and integrations" },
      { label: "Appearance", path: "/appearance", icon: "appearance", hint: "Themes, wallpapers & icons" },
    ],
  },
];

function subadmin(isHr: boolean): NavSection[] {
  return [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: "dashboard",
      items: [{ label: "Day End", path: "/dashboard", tile: "Dashboard", icon: "dashboard", hint: "Your team today" }],
    },
    {
      id: "leads",
      label: "Leads",
      icon: "leads",
      items: [
        { label: "Team Leads", path: "/subadmin/leads", icon: "leads", hint: "Your team's pipeline" },
        { label: "Meta Leads", path: "/subadmin/meta-leads", icon: "meta", hint: "Facebook leads offered to you" },
      ],
    },
    {
      id: "data",
      label: "Data Bank",
      icon: "databank",
      items: [
        { label: "My Sources", path: "/subadmin/data-bank", tile: "Data Bank", icon: "databank", hint: "Lists assigned to you" },
        { label: "Meta Ads", path: "/subadmin/meta-ads", icon: "campaigns", hint: "Your team's campaigns" },
      ],
    },
    {
      id: "team",
      label: "My Team",
      icon: "agents",
      items: [
        { label: "My Profile", path: "/subadmin/profile", icon: "account", hint: "You and your team" },
        { label: "Team Performance", path: "/subadmin/team", icon: "agents", hint: "Each member's numbers" },
        { label: "Reports", path: "/subadmin/reports", tile: "Team Reports", icon: "reports", hint: "Activity per person" },
      ],
    },
    {
      id: "clients",
      label: "Clients",
      icon: "clients",
      items: [{ label: "Folders", path: "/subadmin/clients", tile: "Clients", icon: "clients", hint: "Customers by folder" }],
    },
    attendance("/subadmin", { manage: true, settings: isHr }),
    {
      id: "money",
      label: "Earnings",
      icon: "income",
      items: [
        { label: "My Earnings", path: "/subadmin/earnings", icon: "income", hint: "Commission on your deals" },
        ...(isHr
          ? [{ label: "Office Expenses", path: "/subadmin/financials/expenses", icon: "expenses", hint: "Record office spending" }]
          : []),
      ],
    },
    {
      id: "settings",
      label: "Settings",
      icon: "appearance",
      items: [{ label: "Appearance", path: "/appearance", icon: "appearance", hint: "Themes, wallpapers & icons" }],
    },
  ];
}

const EMPLOYEE: NavSection[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "dashboard",
    items: [{ label: "Day End", path: "/dashboard", tile: "Dashboard", icon: "dashboard", hint: "Your day and your targets" }],
  },
  {
    id: "workspace",
    label: "My Workspace",
    icon: "leads",
    items: [
      { label: "My Leads", path: "/employee/leads", icon: "leads", hint: "Leads to call today" },
      { label: "Meta Leads", path: "/employee/meta-leads", icon: "meta", hint: "Facebook leads offered to you" },
    ],
  },
  {
    id: "performance",
    label: "Performance",
    icon: "net",
    items: [
      { label: "My Profile", path: "/employee/profile", icon: "account", hint: "Your record" },
      { label: "My Stats", path: "/employee/performance/stats", icon: "net", hint: "Calls, meetings, deals" },
      { label: "My Report", path: "/employee/reports", icon: "reports", hint: "Your activity over a period" },
      { label: "My Earnings", path: "/employee/earnings", icon: "income", hint: "Commission on your deals" },
    ],
  },
  attendance("/employee", { manage: false, settings: false }),
  {
    id: "settings",
    label: "Settings",
    icon: "appearance",
    items: [{ label: "Appearance", path: "/appearance", icon: "appearance", hint: "Themes, wallpapers & icons" }],
  },
];

export function navFor(role: string | null | undefined, isHr = false): NavSection[] {
  if (role === "admin") return ADMIN;
  if (role === "subadmin") return subadmin(isHr);
  if (role === "employee") return EMPLOYEE;
  return [];
}

/** The item a path belongs to: exact match first, then the longest prefix match. */
export function activeItem(sections: NavSection[], pathname: string): { section: NavSection; item: NavItem } | null {
  let best: { section: NavSection; item: NavItem; len: number } | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      if (pathname === item.path) return { section, item };
      if (pathname.startsWith(item.path + "/") && (!best || item.path.length > best.len)) {
        best = { section, item, len: item.path.length };
      }
    }
  }
  return best ? { section: best.section, item: best.item } : null;
}

export const allItems = (sections: NavSection[]) => sections.flatMap((s) => s.items);
