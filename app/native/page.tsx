"use client";

// NATIVE app entry point — the original onboarding.
//
// This is where the iOS app starts. It renders the EXISTING OnboardingGate
// component unchanged: the same six feature slides, dots, Skip/Next, the same
// role/entry-choice cards, the same company-access and join-invite screens, the
// same copy and styling. Nothing here is a reimplementation.
//
// The only difference from the root-route usage is that "Sign In" hands off to
// /native/login, so the login step can offer Apple and Google alongside email.
//
// Session behaviour matches what it always was: an authenticated user never sees
// onboarding. There was no "onboarding completed" persistence key before this
// branch, and none is invented here — the session IS the gate.

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { OnboardingGate } from "@/app/components/OnboardingGate";
import { NATIVE_LOGIN_ROUTE } from "@/lib/auth/loginFlow";

type OnboardingScreen = "carousel" | "role" | "employer-auth" | "employee-invite" | "company-access";

const DEEP_LINKABLE_SCREENS: OnboardingScreen[] = ["carousel", "role", "employee-invite", "company-access"];

function parseScreen(value: string | null): OnboardingScreen | undefined {
  if (!value) return undefined;
  return DEEP_LINKABLE_SCREENS.includes(value as OnboardingScreen) ? (value as OnboardingScreen) : undefined;
}

export default function NativeOnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sessionChecked, setSessionChecked] = useState(false);

  const initialScreen = parseScreen(searchParams.get("screen"));

  useEffect(() => {
    let active = true;

    supabaseBrowser()
      .auth.getSession()
      .then(({ data }) => {
        if (!active) return;
        if (data.session) {
          // Already signed in — straight into the authenticated app, exactly as
          // before. Onboarding is never replayed for an authenticated user.
          router.replace("/");
          router.refresh();
          return;
        }
        setSessionChecked(true);
      })
      .catch(() => {
        // Can't determine the session — show onboarding rather than blocking.
        if (active) setSessionChecked(true);
      });

    return () => {
      active = false;
    };
  }, [router]);

  // Avoid flashing the slides at an already-authenticated user mid-redirect.
  if (!sessionChecked) return null;

  return (
    <OnboardingGate
      initialScreen={initialScreen}
      onRequestLogin={() => router.push(NATIVE_LOGIN_ROUTE)}
      onLogin={() => {
        router.replace("/");
        router.refresh();
      }}
    />
  );
}
