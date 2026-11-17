# Fatima Marketing CRM

Meta-leads CRM for Fatima Marketing. Built from three earlier projects:

| From | What came over |
|---|---|
| CRM (baseline) | Leads, Meta Ads intake & distribution, Data Bank, Team, Clients, Closed Deals, Profit Distribution, Financial Reports, Attendance & Leave, Office/Personal Expenses |
| Property-CRM | The whole look: themed navbar, app-grid home with shortcuts and cards, Appearance page (themes, wallpapers, icon packs), sign-in screen, animations |
| Datadash | WhatsApp monitor (Meta Cloud API, Coexistence) — admin only, `/admin/whatsapp` |

Removed from the baseline: every Accounts module and all Salary/Payroll. **Accounts** is now simple: create an account with any name (UBL, EasyPaisa, Cash), add money to it, and pay office or personal expenses from it.

## Run

```bash
npm install
cp .env.example .env.local   # fill in Firebase + WhatsApp keys
npm run dev
```

Set `NEXT_PUBLIC_DEMO_MODE=true` in `.env.local` to run with sample data and no database (username `demo`, password `demo123`).

## Checks

```bash
npm run check   # typecheck + unit tests + lint
npm run build
```

## Where things are

- `src/components/accounts/SimpleAccounts.tsx` — Accounts: create an account, add money, see its history
- `src/components/accounts/PayFromAccounts.tsx` — "Pay from account" on office and personal expenses
- `src/lib/navigation.ts` — every menu and home tile, per role
- `src/components/shell/` — navbar, home launcher, appearance, icons, wallpapers
- `src/app/fm-shell.css` — the Property design system (layered so Tailwind still wins)
- `src/lib/brand.ts` — company name, receipt address and phone
- `src/app/api/whatsapp/*` + `src/components/whatsapp/` — WhatsApp monitor
- `firestore.rules` — includes the `wa_*` collections (admin read only)

## Next phase

Move the data layer from Firestore to Neon (Postgres); Firebase Auth stays.
