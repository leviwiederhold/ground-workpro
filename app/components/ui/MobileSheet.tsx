'use client';

import { useEffect } from 'react';

type MobileSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  panelClassName?: string;
  bodyClassName?: string;
  headerClassName?: string;
  hideHeader?: boolean;
  closeLabel?: string;
  headerVariant?: 'detail' | 'form';
  footer?: React.ReactNode;
  status?: React.ReactNode;
};

const SIZE_CLASSNAMES = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
  full: 'max-w-[95vw]',
};

export function MobileSheet({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  size = 'md',
  panelClassName = '',
  bodyClassName = '',
  headerClassName = '',
  hideHeader = false,
  closeLabel,
  headerVariant = 'detail',
  footer,
  status,
}: MobileSheetProps) {
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return undefined;
    document.body.classList.add('modal-open');
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="mobile-sheet-backdrop fixed inset-0 z-50">
      <button
        type="button"
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
        aria-label={closeLabel || (title ? `Close ${title}` : 'Close panel')}
      />
      <div className="relative flex min-h-0 w-full items-start justify-center sm:h-full sm:items-center sm:p-4">
        <div
          className={`mobile-sheet-panel relative flex max-h-full w-full min-w-0 flex-col overflow-x-hidden border border-gray-200 bg-white shadow-2xl ${SIZE_CLASSNAMES[size]} sm:max-h-[min(90dvh,56rem)] ${panelClassName}`.trim()}
        >
          {!hideHeader ? (
            <div
              className={`mobile-sheet-header shrink-0 border-b border-gray-200 bg-white px-5 pb-4 sm:px-6 ${headerClassName}`.trim()}
            >
              <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_2.5rem] items-start gap-4">
                <div className="min-w-0 pt-1 pr-2 text-left">
                  {title ? (
                    <h2 className="truncate text-lg font-semibold leading-tight text-gray-900 sm:text-xl">
                      {title}
                    </h2>
                  ) : null}
                  {subtitle ? (
                    <p className="mt-1 truncate text-sm leading-5 text-gray-500">{subtitle}</p>
                  ) : null}
                  {status ? <div className="mt-2">{status}</div> : null}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center self-start justify-self-end rounded-full border border-gray-200 bg-white p-0 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                  aria-label={closeLabel || (title ? `Close ${title}` : 'Close panel')}
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M5 5l10 10M15 5L5 15" />
                  </svg>
                </button>
              </div>
            </div>
          ) : null}
          <div
            className={`mobile-sheet-body min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-5 sm:px-6 ${footer ? 'pb-5' : 'pb-[max(1.25rem,var(--safe-area-bottom))] sm:pb-6'} ${headerVariant === 'form' ? 'space-y-4' : ''} ${bodyClassName}`.trim()}
          >
            {children}
          </div>
          {footer ? (
            <div className="mobile-sheet-footer shrink-0 border-t border-gray-200 bg-white px-5 py-4 pb-[max(1rem,var(--safe-area-bottom))] sm:px-6 sm:pb-4">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
