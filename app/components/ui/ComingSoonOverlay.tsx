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
      <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] bg-white/40 backdrop-blur-[2px]">
        <div className="rounded-full border border-gray-300/80 bg-white/85 px-6 py-2 text-center shadow-sm">
          <span className="text-xl font-semibold tracking-wide text-gray-800">{label}</span>
        </div>
      </div>
    </div>
  );
}
