# OAuth auth setup

OAuth buttons are enabled on the web login and signup pages. They remain hidden
inside the native wrapper until a reliable Capacitor deep-link callback is
implemented and verified.

## Supabase

1. Enable the Google provider in Supabase Auth.
2. Enable the Apple provider in Supabase Auth.
3. Add these application redirect URLs:
   - `https://groundwork-pro.com/auth/callback`
   - `https://groundwork-pro.com/**`
   - `https://ground-workpro.vercel.app/auth/callback`
   - `http://localhost:3000/auth/callback`

## Google Cloud

1. Create a Google OAuth client.
2. Add the Supabase provider callback URL shown in the Supabase Google provider
   settings as an authorized redirect URI.
3. Add the client ID and secret to the Supabase Google provider settings.

## Apple Developer

1. Configure Sign in with Apple.
2. Use the existing `com.groundwork-pro.web` Services ID for the web flow.
3. Add the Supabase provider callback URL shown in the Supabase Apple provider
   settings as the return URL.
4. In Supabase, set **Client IDs** to the exact ordered value
   `com.groundwork-pro.web,com.leviwiederhold.groundworkpro`.
5. Keep the OAuth secret JWT's `sub` set to `com.groundwork-pro.web`.
6. Run `pnpm auth:contract` after any provider change.

## Password recovery

Recovery emails route through the shared `/auth/callback` handler (with
`?next=/reset-password`) so the recovery session is restored server-side before
the user reaches the reset page. The callback URLs listed above already cover
this, so no extra redirect URL is required — but ensure these production and
local reset entry points are present in the Supabase Auth **Redirect URLs**
allow-list:

- `https://groundwork-pro.com/auth/callback`
- `https://groundwork-pro.com/reset-password`
- `https://ground-workpro.vercel.app/auth/callback`
- `https://ground-workpro.vercel.app/reset-password`
- `http://localhost:3000/auth/callback`
- `http://localhost:3000/reset-password`

Flow:

1. User requests a reset from `/forgot-password` (or in-app account settings).
2. Supabase emails a link to `/auth/callback?next=/reset-password&type=recovery`.
3. The callback exchanges the code, sets the session cookies, and redirects to
   `/reset-password`.
4. The user sets a new password (`supabase.auth.updateUser({ password })` via
   `/api/auth/reset-password`), is signed out, and returns to `/login?reset=1`.
5. Expired, malformed, or already-used links redirect back to
   `/reset-password?error=recovery_link_invalid`, which shows a clear "request a
   new link" message.
