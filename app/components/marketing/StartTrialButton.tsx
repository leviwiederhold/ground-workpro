"use client";

import { isIosNativeAppRuntime } from "@/lib/runtime/isNativeApp";
import { useEffect, useState } from "react";

type StartTrialButtonProps = {
  className?: string;
  label?: string;
  onError?: (message: string) => void;
};

export function StartTrialButton({
  className = "",
  label = "Start 7-Day Free Trial",
  onError,
}: StartTrialButtonProps) {
  const [mounted, setMounted] = useState(false);
  const [iosAppRuntime, setIosAppRuntime] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIosAppRuntime(isIosNativeAppRuntime());
  }, []);

  if (!mounted || iosAppRuntime) return null;

  const startSignup = () => {
    onError?.("");
    window.location.href = "/signup?trial=1";
  };

  return (
    <button type="button" onClick={startSignup} className={className}>
      {label}
    </button>
  );
}
