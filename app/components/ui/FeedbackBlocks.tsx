import { ReactNode } from "react";

type BlockProps = {
  children: ReactNode;
  className?: string;
  testId?: string;
};

export function LoadingBlock({ children, className = "", testId }: BlockProps) {
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500 dark:border-zinc-800 dark:bg-[#090909] dark:text-zinc-400 ${className}`.trim()}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

export function EmptyState({ children, className = "", testId }: BlockProps) {
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500 dark:border-zinc-800 dark:bg-[#090909] dark:text-zinc-400 ${className}`.trim()}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

export function InlineError({ children, className = "", testId }: BlockProps) {
  return (
    <div
      className={`rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-200 ${className}`.trim()}
      data-testid={testId}
      role="alert"
    >
      {children}
    </div>
  );
}

type SkeletonBlockProps = {
  lines?: number;
  className?: string;
  testId?: string;
};

export function SkeletonBlock({ lines = 3, className = "", testId }: SkeletonBlockProps) {
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#090909] ${className}`.trim()}
      data-testid={testId}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="animate-pulse space-y-2">
        {Array.from({ length: lines }).map((_, idx) => (
          <div
            key={idx}
            className={`h-3 rounded bg-gray-200 dark:bg-zinc-800 ${idx === lines - 1 ? "w-2/3" : "w-full"}`}
          />
        ))}
      </div>
    </div>
  );
}
