# Groundwork Pro

The all-in-one management platform for excavation and grading contractors.

## Features

- **Dashboard** - Real-time overview of operations, jobs, and equipment
- **Team Messaging** - Built-in Slack-like communication with channels and DMs
- **Fleet Management** - Track equipment location, hours, and maintenance
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

## Tech Stack

- Next.js 15
- React 18
- Tailwind CSS
- Font Awesome Icons
- Chart.js
- Leaflet.js (Maps)

## License

Proprietary - All rights reserved
