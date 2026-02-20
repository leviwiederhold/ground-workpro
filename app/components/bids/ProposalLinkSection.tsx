'use client';

type ActiveShareLink = {
  token: string;
  url: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string | null;
} | null;

type Props = {
  activeShareLink: ActiveShareLink;
  activeShareLoading: boolean;
  activeShareError: string;
  shareActionLoading: boolean;
  shareCopyState: string;
  onCreate: () => void;
  onCopy: () => void;
  onRevoke: () => void;
};

export function ProposalLinkSection({
  activeShareLink,
  activeShareLoading,
  activeShareError,
  shareActionLoading,
  shareCopyState,
  onCreate,
  onCopy,
  onRevoke,
}: Props) {
  return (
    <div className="pt-2 border-t border-gray-200 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h5 className="font-semibold text-gray-900">Proposal Link</h5>
        {!activeShareLink && (
          <button
            type="button"
            className="bg-brand-orange hover:bg-brand-orange-dark text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed mobile-tap-target"
            onClick={onCreate}
            disabled={shareActionLoading || activeShareLoading}
            data-testid="bids-share-create"
          >
            {shareActionLoading ? 'Creating...' : 'Create Link'}
          </button>
        )}
      </div>

      {activeShareLoading ? (
        <p className="text-sm text-gray-500">Loading proposal link...</p>
      ) : activeShareLink ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-700 break-all" data-testid="bids-share-url">
            {activeShareLink.url}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed mobile-tap-target"
              onClick={onCopy}
              disabled={shareActionLoading}
              data-testid="bids-share-copy"
            >
              Copy
            </button>
            <button
              type="button"
              className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed mobile-tap-target"
              onClick={onRevoke}
              disabled={shareActionLoading}
              data-testid="bids-share-revoke"
            >
              {shareActionLoading ? 'Revoking...' : 'Revoke'}
            </button>
            {shareCopyState === 'copied' && (
              <span className="text-xs text-green-600">Copied</span>
            )}
            {shareCopyState === 'failed' && (
              <span className="text-xs text-red-600">Copy failed</span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-500">No active proposal link.</p>
      )}

      {activeShareError && (
        <p className="text-sm text-red-600">{activeShareError}</p>
      )}
    </div>
  );
}
