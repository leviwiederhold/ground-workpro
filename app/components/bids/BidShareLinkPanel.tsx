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
    let parsed: any = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = {};
    }

    if (!response.ok) {
      throw new Error(parsed?.error || raw || 'Failed to load proposal link');
    }

    setActiveShareLink(parsed?.item || null);
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
      let parsed: any = {};
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        parsed = {};
      }
      if (!response.ok) {
        setActiveShareError(parsed?.error || raw || 'Failed to create proposal link');
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
      let parsed: any = {};
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        parsed = {};
      }
      if (!response.ok) {
        setActiveShareError(parsed?.error || raw || 'Failed to revoke proposal link');
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
