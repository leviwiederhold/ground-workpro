# E2E Setup (Playwright)

## 1) Create a test user in Supabase Auth

1. In Supabase Dashboard, create a user with email + password.
2. Use that same email/password for:
   - `E2E_EMAIL`
   - `E2E_PASSWORD`

## 2) Ensure the user has a company membership

1. Log in once as the test user in the app.
2. If needed, run bootstrap:

```bash
curl -X POST http://localhost:3000/api/bootstrap
```

This should create a company + admin membership for the logged-in user.

## 3) Ensure test role is `admin`

The smoke tests perform create/delete, so the test user must be `admin`.

Run in Supabase SQL editor (replace with your user id):

```sql
update memberships
set role = 'admin'
where user_id = '<YOUR_E2E_USER_ID>';
```

## 4) Local env for tests

Copy `.env.e2e.example` values into your shell env (or `.env.local`):

- `E2E_BASE_URL` (default: `http://localhost:3000`)
- `E2E_EMAIL`
- `E2E_PASSWORD`

## 5) Run

```bash
pnpm test:e2e
```

Playwright config starts Next automatically via `pnpm dev`.
