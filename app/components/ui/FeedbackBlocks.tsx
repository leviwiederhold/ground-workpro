import { ReactNode } from "react";

type BlockProps = {
  children: ReactNode;
  className?: string;
  testId?: string;
};

export function LoadingBlock({ children, className = "", testId }: BlockProps) {
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500 ${className}`.trim()}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

export function EmptyState({ children, className = "", testId }: BlockProps) {
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500 ${className}`.trim()}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

export function InlineError({ children, className = "", testId }: BlockProps) {
  return (
    <div
      className={`rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 ${className}`.trim()}
      data-testid={testId}
      role="alert"
    >
      {children}
    </div>
  );
}

