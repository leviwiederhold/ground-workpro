#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const contract = JSON.parse(
  await readFile(new URL("../config/auth-contract.json", import.meta.url), "utf8")
);

function fail(message) {
  throw new Error(`[auth-contract] ${message}`);
}

const authorizeUrl = new URL(
  `/auth/v1/authorize`,
  `https://${contract.supabaseProjectRef}.supabase.co`
);
authorizeUrl.searchParams.set("provider", "apple");
authorizeUrl.searchParams.set("redirect_to", `${contract.productionSiteOrigin}/auth/callback`);
authorizeUrl.searchParams.set("code_challenge", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
authorizeUrl.searchParams.set("code_challenge_method", "s256");

const supabaseResponse = await fetch(authorizeUrl, {
  redirect: "manual",
  signal: AbortSignal.timeout(15_000),
});

if (supabaseResponse.status < 300 || supabaseResponse.status >= 400) {
  fail(`Supabase Apple authorize returned HTTP ${supabaseResponse.status}, expected a redirect`);
}

const location = supabaseResponse.headers.get("location");
if (!location) fail("Supabase Apple authorize did not return a Location header");

const appleRequest = new URL(location);
if (
  appleRequest.origin !== "https://appleid.apple.com" ||
  appleRequest.pathname !== "/auth/authorize"
) {
  fail(
    `Supabase redirected to unexpected Apple endpoint: ${appleRequest.origin}${appleRequest.pathname}`
  );
}

const actualClientId = appleRequest.searchParams.get("client_id");
if (actualClientId !== contract.apple.webServicesId) {
  fail(
    `Apple client_id is ${JSON.stringify(actualClientId)}; expected web Services ID ` +
      JSON.stringify(contract.apple.webServicesId)
  );
}

const actualCallback = appleRequest.searchParams.get("redirect_uri");
if (actualCallback !== contract.supabaseAuthCallback) {
  fail(
    `Apple redirect_uri is ${JSON.stringify(actualCallback)}; expected ` +
      JSON.stringify(contract.supabaseAuthCallback)
  );
}

const appleResponse = await fetch(appleRequest, {
  redirect: "manual",
  headers: {
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  },
  signal: AbortSignal.timeout(15_000),
});
const appleBody = await appleResponse.text();

if (/invalid_request|invalid client id or web redirect url/i.test(appleBody)) {
  fail("Apple rejected the production authorization request with invalid_request");
}
if (!appleResponse.ok) {
  fail(`Apple authorization endpoint returned HTTP ${appleResponse.status}`);
}

process.stdout.write(
  [
    "Production Apple auth contract is healthy.",
    `client_id=${actualClientId}`,
    `redirect_uri=${actualCallback}`,
  ].join("\n") + "\n"
);
