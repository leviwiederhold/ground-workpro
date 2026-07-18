#!/bin/sh
# Refuse to archive a build that points at a non-production deployment.
#
# The iOS app loads a remote URL baked into App/capacitor.config.json by
# `npx cap sync ios`. A developer who syncs a PR preview to test on device and
# then archives without re-syncing would ship an App Store / TestFlight build
# pointing at a Vercel preview — which is short-lived, unauthenticated-by-default
# on some setups, and disappears when the branch is deleted.
#
# Debug: informational only.
# Release: hard error unless explicitly overridden.
#
# Override (rare — e.g. an internal TestFlight build aimed at a staging host):
#   ALLOW_NON_PRODUCTION_SERVER_URL=1

set -eu

PRODUCTION_URL="https://ground-workpro.vercel.app"
CONFIG="${SRCROOT}/App/capacitor.config.json"

if [ ! -f "${CONFIG}" ]; then
    echo "warning: ${CONFIG} not found. Run 'pnpm ios:sync' before building."
    exit 0
fi

# plutil reads JSON as well as plists and is always present on macOS, so this
# needs no node/python on the build machine's PATH.
SERVER_URL=$(plutil -extract server.url raw -o - "${CONFIG}" 2>/dev/null || echo "")

if [ -z "${SERVER_URL}" ]; then
    echo "warning: could not read server.url from ${CONFIG}."
    exit 0
fi

if [ "${SERVER_URL}" = "${PRODUCTION_URL}" ]; then
    exit 0
fi

if [ "${CONFIGURATION:-}" != "Release" ]; then
    echo "warning: This build loads a NON-PRODUCTION server URL: ${SERVER_URL}"
    exit 0
fi

if [ "${ALLOW_NON_PRODUCTION_SERVER_URL:-}" = "1" ]; then
    echo "warning: Release build is using a non-production server URL (${SERVER_URL}) because ALLOW_NON_PRODUCTION_SERVER_URL=1."
    exit 0
fi

echo "error: Release build points at a non-production server URL: ${SERVER_URL}" >&2
echo "error: Expected ${PRODUCTION_URL}. Run 'pnpm ios:sync' to restore production, then archive again." >&2
echo "error: To archive against this URL deliberately, set ALLOW_NON_PRODUCTION_SERVER_URL=1." >&2
exit 1
