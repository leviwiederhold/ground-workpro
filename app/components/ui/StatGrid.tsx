import { ReactNode } from "react";

type StatGridProps = {
  children: ReactNode;
  className?: string;
  desktopColsClass?: string;
  testId?: string;
};

export function StatGrid({
  children,
  className = "",
  desktopColsClass = "md:grid-cols-4",
  testId,
}: StatGridProps) {
  return (
    <div
      className={`stat-grid grid grid-cols-2 ${desktopColsClass} gap-4 ${className}`.trim()}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

