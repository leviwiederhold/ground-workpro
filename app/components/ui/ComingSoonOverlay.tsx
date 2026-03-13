'use client';

import type { ReactNode } from 'react';

type ComingSoonOverlayProps = {
  children: ReactNode;
  active?: boolean;
  label?: string;
  className?: string;
};

export function ComingSoonOverlay({
  children,
  active = true,
  label = 'Coming Soon',
  className = '',
}: ComingSoonOverlayProps) {
  if (!active) {
    return <>{children}</>;
  }

  return (
    <div className={`relative ${className}`}>
      <div className="pointer-events-none select-none" inert aria-hidden="true">
        {children}
      </div>
      <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] bg-white/55 p-4 backdrop-blur-sm dark:bg-black/45">
        <div className="mx-auto flex max-w-[min(90vw,24rem)] items-center justify-center gap-3 rounded-full border border-gray-300/80 bg-white/92 px-5 py-3 text-center shadow-lg dark:border-white/10 dark:bg-zinc-900/92">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500/10 text-brand-600 dark:bg-brand-500/20 dark:text-brand-300">
            <i className="fa-solid fa-wand-magic-sparkles text-sm" aria-hidden="true" />
          </span>
          <span className="text-base font-semibold tracking-[0.18em] text-gray-900 dark:text-white sm:text-lg">{label}</span>
        </div>
      </div>
    </div>
  );
}
