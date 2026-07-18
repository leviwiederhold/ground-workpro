#!/bin/sh
# Fail the build when Google Sign-In client configuration is missing.
#
# Why this exists: App/Info.plist expands $(GOOGLE_IOS_CLIENT_ID) and
# $(GOOGLE_IOS_REVERSED_CLIENT_ID). Xcode expands an undefined or empty build
# setting to an empty string WITHOUT warning, so a Release archive would ship
# with GIDClientID="" and a CFBundleURLSchemes entry of "". That app installs,
# launches, and shows the login screen normally — Google sign-in just fails on
# device, which is exactly the kind of defect that reaches TestFlight.
#
# Debug: warn only, so a fresh clone can build and work on unrelated features
# without configuring Google.
# Release: hard error, so a broken archive cannot be produced silently.

set -eu

missing=""
[ -z "${GOOGLE_IOS_CLIENT_ID:-}" ] && missing="${missing} GOOGLE_IOS_CLIENT_ID"
[ -z "${GOOGLE_IOS_REVERSED_CLIENT_ID:-}" ] && missing="${missing} GOOGLE_IOS_REVERSED_CLIENT_ID"

if [ -n "${missing}" ]; then
    hint="Copy ios/Google.local.xcconfig.example to ios/Google.local.xcconfig and fill in the iOS OAuth client ID. See docs/native-auth-setup.md."
    if [ "${CONFIGURATION:-}" = "Release" ]; then
        echo "error: Missing Google Sign-In build setting(s):${missing}. ${hint}" >&2
        exit 1
    fi
    echo "warning: Missing Google Sign-In build setting(s):${missing}. Google sign-in will not work in this build. ${hint}"
    exit 0
fi

# Guard against a reversed client ID that is not actually reversed — a wrong
# URL scheme fails only at runtime, mid-sign-in, which is hard to diagnose.
case "${GOOGLE_IOS_REVERSED_CLIENT_ID}" in
    com.googleusercontent.apps.*) ;;
    *)
        echo "error: GOOGLE_IOS_REVERSED_CLIENT_ID must start with 'com.googleusercontent.apps.' (got '${GOOGLE_IOS_REVERSED_CLIENT_ID}'). It is the iOS client ID with its dot-separated parts reversed." >&2
        exit 1
        ;;
esac

case "${GOOGLE_IOS_CLIENT_ID}" in
    *.apps.googleusercontent.com) ;;
    *)
        echo "error: GOOGLE_IOS_CLIENT_ID must end with '.apps.googleusercontent.com' (got '${GOOGLE_IOS_CLIENT_ID}')." >&2
        exit 1
        ;;
esac

exit 0
