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
   - `https://www.groundwork-pro.com/auth/callback`
   - `https://ground-workpro.vercel.app/auth/callback`
   - `http://localhost:3000/auth/callback`

## Google Cloud

1. Create a Google OAuth client.
2. Add the Supabase provider callback URL shown in the Supabase Google provider
   settings as an authorized redirect URI.
3. Add the client ID and secret to the Supabase Google provider settings.

## Apple Developer

1. Configure Sign in with Apple.
2. Create the Service ID required for the web flow.
3. Add the Supabase provider callback URL shown in the Supabase Apple provider
   settings as the return URL.
4. Add the resulting Apple credentials to the Supabase Apple provider settings.

## Password recovery

Allow `https://groundwork-pro.com/reset-password`,
`https://www.groundwork-pro.com/reset-password`,
`https://ground-workpro.vercel.app/reset-password`, and
`http://localhost:3000/reset-password` as Supabase Auth redirect URLs.
