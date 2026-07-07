// Headers the middleware uses to forward the identity it already verified via
// supabase.auth.getUser(), so downstream route handlers (getCompanyId) don't
// have to call getUser() a second time — halving per-request Supabase Auth
// calls. SECURITY: the middleware strips these from the incoming client request
// on EVERY pass and only re-sets them after a successful getUser, so they are
// never client-controllable. Consumers MUST fall back to getUser() when absent.
export const GW_VERIFIED_UID_HEADER = "x-gw-verified-uid";
export const GW_VERIFIED_EMAIL_HEADER = "x-gw-verified-email";
