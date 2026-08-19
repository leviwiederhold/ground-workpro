# Groundwork Pro

The all-in-one management platform for excavation and grading contractors.

## Features

- **Dashboard** - Real-time overview of operations, jobs, and equipment
- **Team Messaging** - Built-in Slack-like communication with channels and DMs
- **Equipment Management** - Track equipment location, hours, and maintenance
- **Smart Scheduling** - Drag-and-drop crew and equipment scheduling
- **Job Costing** - Track costs, budgets, and profitability in real-time
- **Safety & Compliance** - Digital sign-offs, incident tracking, certifications
- **40+ Integrations** - Connect QuickBooks, Samsara, Procore, and more

## Quick Start

1. Use Node.js 20:

   ```bash
   nvm use
   ```

2. Install dependencies with pnpm:

   ```bash
   pnpm install
   ```

3. Start the app locally:

   ```bash
   pnpm dev
   ```

## Verify the project in one command

Run the full verification pipeline (lint + build + e2e):

```bash
pnpm verify
```

## Verify (Local)

```bash
pnpm verify
```

## Schema Health Check

Run this before debugging runtime API errors:

```bash
pnpm check-schema
```

It validates required Supabase tables/columns used by the app and fails fast with exact missing table/column errors.

## Testing Workflow

- Default (most PRs): `pnpm check:fast`
- Feature/module changes: `pnpm check:fast` + `pnpm test:e2e:spec tests/e2e/<spec>.spec.ts`
- Run full suite (`pnpm test:e2e:full`) only for:
  - auth/RLS/RBAC
  - pricing or money math
  - storage/uploads
  - cross-module APIs
  - DB schema changes
- Full suite is optional for UI-only changes, refactors, and docs-only PRs.

## Performance checks

- Lightweight perf/load smoke: `pnpm test:e2e:spec tests/e2e/perf-smoke.spec.ts`
- Baseline metrics are tracked in `docs/perf-baseline.md`

## Observability

- Sentry is enabled for client/server error capture with route and tenant context tags.
- Golden signals and alert-ready thresholds are documented in `docs/golden-signals.md`.

## PR output format (default)

For normal PRs, use this output format:

1. List of changed files
2. Short summary
3. Raw successful logs from:
   - `pnpm lint`
   - `pnpm build`
   - `pnpm test:e2e`

Do **not** require full diffs by default.

### When diffs are required

Include diffs only for:

- RLS/Auth/RBAC changes
- Pricing or money-math changes
- DB migrations or schema changes
- Large refactors (for example, `app/page.tsx` extraction)

## Code quality commands

```bash
pnpm lint
pnpm format
pnpm format:check
```

## Billing setup

1. Enable billing in your environment:

   ```bash
   BILLING_ENABLED=true
   ```

2. Run the billing migration SQL in the Supabase SQL editor:

   ```sql
   -- supabase/migrations/20260220_02_billing_companies_columns.sql
   alter table if exists public.companies
     add column if not exists plan_type text not null default 'starter',
     add column if not exists subscription_status text not null default 'inactive',
     add column if not exists trial_ends_at timestamptz,
     add column if not exists stripe_customer_id text,
     add column if not exists stripe_subscription_id text,
     add column if not exists current_period_end timestamptz;

   create index if not exists companies_subscription_status_idx
     on public.companies (subscription_status);

   create index if not exists companies_current_period_end_idx
     on public.companies (current_period_end);
   ```

3. Add Stripe environment variables later when wiring real checkout/portal flows:

   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`

## Operations: Backups, Restore Rehearsal, and Incident Runbooks

See the ops runbook for production backup/restore and outage handling:

- `docs/ops-backup-restore-runbooks.md`

This includes:

- Supabase backup approach (database + storage + config)
- Storage bucket recovery notes
- Verified restore rehearsal checklist
- Incident runbooks for auth outage, DB outage, and storage outage

## Tech Stack

- Next.js 15
- React 18
- Tailwind CSS
- Font Awesome Icons
- Chart.js
- Leaflet.js (Maps)

## License

Proprietary - All rights reserved
