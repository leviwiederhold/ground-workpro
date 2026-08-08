# Apple Sign-In client secret

The Apple OAuth private key must stay outside the repository. The default
location expected by the generator is:

```text
/private/AuthKey_<KEY_ID>.p8
```

Restrict the file so only its owner can read it:

```bash
chmod 600 /private/AuthKey_<KEY_ID>.p8
```

On macOS, writing to `/private` may require administrator privileges. The
generator automatically falls back to this user-private location:

```bash
mkdir -p ~/.private
chmod 700 ~/.private
mv ~/Downloads/AuthKey_<KEY_ID>.p8 ~/.private/
chmod 600 ~/.private/AuthKey_<KEY_ID>.p8
```

Set the Apple Developer values before generating the client secret:

```bash
export APPLE_TEAM_ID="<APPLE_DEVELOPER_TEAM_ID>"
export APPLE_KEY_ID="<APPLE_PRIVATE_KEY_ID>"
export APPLE_CLIENT_ID="com.groundwork-pro.web"
```

`APPLE_CLIENT_ID` is deliberately the existing web Services ID. The generated
JWT's `sub` must be `com.groundwork-pro.web`; the native bundle ID is not valid
for the web OAuth client secret.

To use a different location, set:

```bash
export APPLE_PRIVATE_KEY_PATH="$HOME/.private/AuthKey_<KEY_ID>.p8"
```

Generate the 180-day ES256 client secret:

```bash
pnpm apple:secret
```

The command prints only the JWT. Paste it into:

```text
Supabase -> Authentication -> Providers -> Apple -> Secret Key
```

The JWT expires after 180 days. Generate and replace it before expiration.

The Supabase Apple provider's **Client IDs** field must be exactly:

```text
com.groundwork-pro.web,com.leviwiederhold.groundworkpro
```

The order is part of the production contract: Supabase uses the first value for
web OAuth, while the second value allows native iOS ID-token validation. Run
`pnpm auth:contract` after any provider change to verify the live request.
