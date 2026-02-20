'use client';

import { useEffect, useState } from 'react';
import { ProposalLinkSection } from '@/app/components/bids/ProposalLinkSection';

type ActiveShareLink = {
  token: string;
  url: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string | null;
} | null;

type Props = {
  bidId: string | null;
};

const parseJson = (raw: string): Record<string, unknown> => {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const getErrorMessage = (parsed: Record<string, unknown>, fallback: string) => {
  const error = parsed.error;
  return typeof error === 'string' && error ? error : fallback;
};

const toActiveShareLink = (value: unknown): ActiveShareLink => {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.url !== 'string' || typeof row.token !== 'string') return null;

  return {
    token: row.token,
    url: row.url,
    expires_at: typeof row.expires_at === 'string' ? row.expires_at : null,
    revoked_at: typeof row.revoked_at === 'string' ? row.revoked_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
  };
};

export function BidShareLinkPanel({ bidId }: Props) {
  const [activeShareLink, setActiveShareLink] = useState<ActiveShareLink>(null);
  const [activeShareLoading, setActiveShareLoading] = useState(false);
  const [activeShareError, setActiveShareError] = useState('');
  const [shareActionLoading, setShareActionLoading] = useState(false);
  const [shareCopyState, setShareCopyState] = useState('');

  const loadActiveShareLink = async (id: string | null) => {
    if (!id) {
      setActiveShareLink(null);
      setActiveShareError('');
      return;
    }

    const response = await fetch(`/api/bids/${id}/share/active`, { cache: 'no-store' });
    const raw = await response.text();
    const parsed = parseJson(raw);

    if (!response.ok) {
      throw new Error(getErrorMessage(parsed, raw || 'Failed to load proposal link'));
    }

    setActiveShareLink(toActiveShareLink(parsed.item));
    setActiveShareError('');
  };

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      if (!bidId) {
        if (isMounted) {
          setActiveShareLink(null);
          setActiveShareError('');
          setShareCopyState('');
        }
        return;
      }

      try {
        setActiveShareLoading(true);
        await loadActiveShareLink(bidId);
      } catch {
        if (isMounted) {
          setActiveShareLink(null);
          setActiveShareError('Failed to load proposal link');
        }
      } finally {
        if (isMounted) {
          setActiveShareLoading(false);
        }
      }
    };

    run();
    return () => {
      isMounted = false;
    };
  }, [bidId]);

  const handleCreateShareLink = async () => {
    if (!bidId) return;
    try {
      setShareActionLoading(true);
      setActiveShareError('');
      const response = await fetch(`/api/bids/${bidId}/share`, { method: 'POST' });
      const raw = await response.text();
      const parsed = parseJson(raw);
      if (!response.ok) {
        setActiveShareError(getErrorMessage(parsed, raw || 'Failed to create proposal link'));
        return;
      }
      await loadActiveShareLink(bidId);
    } catch {
      setActiveShareError('Failed to create proposal link');
    } finally {
      setShareActionLoading(false);
    }
  };

  const handleRevokeShareLink = async () => {
    if (!bidId) return;
    try {
      setShareActionLoading(true);
      setActiveShareError('');
      const response = await fetch(`/api/bids/${bidId}/share/revoke`, { method: 'POST' });
      const raw = await response.text();
      const parsed = parseJson(raw);
      if (!response.ok) {
        setActiveShareError(getErrorMessage(parsed, raw || 'Failed to revoke proposal link'));
        return;
      }
      await loadActiveShareLink(bidId);
    } catch {
      setActiveShareError('Failed to revoke proposal link');
    } finally {
      setShareActionLoading(false);
    }
  };

  const handleCopyShareLink = async () => {
    if (!activeShareLink?.url) return;
    try {
      await navigator.clipboard.writeText(activeShareLink.url);
      setShareCopyState('copied');
    } catch {
      setShareCopyState('failed');
    }
  };

  return (
    <ProposalLinkSection
      activeShareLink={activeShareLink}
      activeShareLoading={activeShareLoading}
      activeShareError={activeShareError}
      shareActionLoading={shareActionLoading}
      shareCopyState={shareCopyState}
      onCreate={handleCreateShareLink}
      onCopy={handleCopyShareLink}
      onRevoke={handleRevokeShareLink}
    />
  );
}
