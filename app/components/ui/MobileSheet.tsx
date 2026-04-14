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
      <div className="relative flex h-full w-full items-end justify-center sm:items-center sm:p-4">
        <div
          className={`mobile-sheet-panel relative flex max-h-full w-full min-w-0 flex-col overflow-x-hidden bg-white shadow-2xl ${SIZE_CLASSNAMES[size]} sm:max-h-[min(90dvh,56rem)] ${panelClassName}`.trim()}
        >
          {!hideHeader ? (
            <div
              className={`mobile-sheet-header border-b border-gray-200 bg-white px-4 pb-3 sm:px-5 ${headerClassName}`.trim()}
            >
              <div className="grid min-h-10 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-start gap-2">
                <span aria-hidden="true" className="block h-10 w-10" />
                <div className="min-w-0 pt-1 text-center">
                  {title ? (
                    <h2 className="truncate text-lg font-semibold leading-tight text-gray-900 sm:text-xl">
                      {title}
                    </h2>
                  ) : null}
                  {subtitle ? (
                    <p className="mt-1 truncate text-sm leading-5 text-gray-500">{subtitle}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center self-start justify-self-end rounded-full border border-gray-200 bg-white text-xl leading-none text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                  aria-label={closeLabel || (title ? `Close ${title}` : 'Close panel')}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            </div>
          ) : null}
          <div
            className={`mobile-sheet-body min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-[max(1rem,var(--safe-area-bottom))] pt-4 sm:px-5 sm:pb-5 ${headerVariant === 'form' ? 'space-y-3' : ''} ${bodyClassName}`.trim()}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
