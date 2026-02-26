/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
'use client';

import { useEffect, useState } from 'react';
import { BidShareLinkPanel } from '@/app/components/bids/BidShareLinkPanel';
import { EmptyState, InlineError, LoadingBlock, SkeletonBlock } from '@/app/components/ui/FeedbackBlocks';

const confirmDelete = (targetLabel) => window.confirm(`Delete ${targetLabel}? This cannot be undone.`);

export function BidsView({ bids, bidsLoading, setBids, jobs, ui, currentRole }) {
  const { StatGrid, StatCard, SearchInput, Card, Icon, Button, Badge, formatCurrency, formatDate } = ui;
      const [filter, setFilter] = useState('all');
      const [search, setSearch] = useState('');
      const [selectedBidId, setSelectedBidId] = useState(null);
      const [showBidModal, setShowBidModal] = useState(false);
      const [editingBidId, setEditingBidId] = useState(null);
      const [showItemModal, setShowItemModal] = useState(false);
      const [editingItemId, setEditingItemId] = useState(null);
      const [saveLoading, setSaveLoading] = useState(false);
      const [deleteLoading, setDeleteLoading] = useState(false);
      const [itemSaveLoading, setItemSaveLoading] = useState(false);
      const [itemDeleteLoading, setItemDeleteLoading] = useState(false);
      const [formError, setFormError] = useState('');
      const [itemError, setItemError] = useState('');
      const [bidItems, setBidItems] = useState([]);
      const [bidItemsLoading, setBidItemsLoading] = useState(false);
      const [bidSummary, setBidSummary] = useState(null);
      const [bidSummaryLoading, setBidSummaryLoading] = useState(false);
      const [bidSummaryError, setBidSummaryError] = useState('');
      const [sendLoading, setSendLoading] = useState(false);
      const [sendError, setSendError] = useState('');
      const [showSendOverride, setShowSendOverride] = useState(false);
      const [sendOverrideChecked, setSendOverrideChecked] = useState(false);
      const [sendOverrideNote, setSendOverrideNote] = useState('');
      const [pipelineLoading, setPipelineLoading] = useState(false);
      const [analytics, setAnalytics] = useState(null);
      const [analyticsLoading, setAnalyticsLoading] = useState(false);
      const [bidForm, setBidForm] = useState({
        title: '',
        status: 'draft',
        stage: 'estimating',
        job_id: '',
        client: '',
        bid_date: '',
        probability: 0,
        notes: '',
      });
      const [itemForm, setItemForm] = useState({
        item_type: 'custom',
        description: '',
        quantity: 1,
        unit_cost: 0,
      });

      const selectedBid = bids.find((bid) => String(bid.id) === String(selectedBidId)) || null;
      const canSeeExecAnalytics = currentRole === 'executive';
      const canSeePmAnalytics = currentRole === 'operations' || canSeeExecAnalytics;
      const isEstimatorView = currentRole === 'operations';

      const filteredBids = bids.filter((bid) => {
        const stageValue = String(bid.stage || '').toLowerCase();
        const statusValue = String(bid.status || '').toLowerCase();
        if (filter !== 'all' && stageValue !== filter && statusValue !== filter) return false;
        if (!search) return true;
        const query = search.toLowerCase();
        return (
          (bid.projectName || bid.title || '').toLowerCase().includes(query) ||
          (bid.client || '').toLowerCase().includes(query)
        );
      });

      const totalPending = bids
        .filter((bid) => ['lead', 'qualified', 'estimating', 'review'].includes(String(bid.stage || 'estimating')))
        .reduce((sum, bid) => sum + (Number(bid.amount) || 0), 0);
      const wonCount = bids.filter((bid) => (bid.stage || bid.status) === 'won').length;
      const closedCount = bids.filter((bid) => ['won', 'lost'].includes(String(bid.stage || bid.status))).length;
      const winRate = Math.round((wonCount / closedCount) * 100) || 0;

      const getStatusIcon = (status) => {
        const icons = {
          draft: 'file',
          pending: 'clock',
          submitted: 'paper-plane',
          sent: 'paper-plane',
          accepted: 'trophy',
          rejected: 'xmark',
          archived: 'box-archive',
          won: 'trophy',
          lost: 'xmark',
          canceled: 'ban',
        };
        return icons[status] || 'file';
      };

      const getStageBadgeClass = (stage) => {
        const key = String(stage || '').toLowerCase();
        if (key === 'won') return 'bg-green-100 text-green-700';
        if (key === 'lost') return 'bg-red-100 text-red-700';
        if (key === 'review') return 'bg-purple-100 text-purple-700';
        if (key === 'qualified') return 'bg-blue-100 text-blue-700';
        if (key === 'lead') return 'bg-gray-100 text-gray-700';
        return 'bg-amber-100 text-amber-700';
      };

      const resetBidForm = () => {
        setBidForm({
          title: '',
          status: 'draft',
          stage: 'estimating',
          job_id: '',
          client: '',
          bid_date: '',
          probability: 0,
          notes: '',
        });
        setEditingBidId(null);
        setFormError('');
      };

      const resetItemForm = () => {
        setItemForm({
          item_type: 'custom',
          description: '',
          quantity: 1,
          unit_cost: 0,
        });
        setEditingItemId(null);
        setItemError('');
      };

      const refreshBids = async ({ preserveSelection = true } = {}) => {
        const response = await fetch('/api/bids', { cache: 'no-store' });
        const raw = await response.text();
        let parsed = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          parsed = {};
        }
        if (!response.ok) {
          throw new Error(parsed?.error || raw || 'Failed to load bids');
        }
        const nextBids = parsed?.bids || [];
        setBids(nextBids);
        if (!preserveSelection) {
          setSelectedBidId(nextBids[0]?.id || null);
          return;
        }
        if (!selectedBidId && nextBids.length > 0) {
          setSelectedBidId(nextBids[0].id);
          return;
        }
        if (selectedBidId && !nextBids.some((bid) => String(bid.id) === String(selectedBidId))) {
          setSelectedBidId(nextBids[0]?.id || null);
        }
      };

      const loadAnalytics = async () => {
        try {
          setAnalyticsLoading(true);
          const response = await fetch('/api/bids/analytics', { cache: 'no-store' });
          const raw = await response.text();
          let parsed = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = {};
          }
          if (!response.ok) return;
          setAnalytics(parsed?.item || null);
        } finally {
          setAnalyticsLoading(false);
        }
      };

      const loadBidItems = async (bidId) => {
        if (!bidId) {
          setBidItems([]);
          return;
        }
        const response = await fetch(`/api/bids/${bidId}/items`, { cache: 'no-store' });
        const raw = await response.text();
        let parsed = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          parsed = {};
        }
        if (!response.ok) {
          throw new Error(parsed?.error || raw || 'Failed to load bid items');
        }
        setBidItems(parsed?.items || []);
      };

      const loadBidSummary = async (bidId) => {
        if (!bidId) {
          setBidSummary(null);
          setBidSummaryError('');
          return;
        }
        const response = await fetch(`/api/bids/${bidId}/summary`, { cache: 'no-store' });
        const raw = await response.text();
        let parsed = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          parsed = {};
        }
        if (!response.ok) {
          throw new Error(parsed?.error || raw || 'Failed to load bid summary');
        }
        setBidSummary(parsed?.summary || null);
        setBidSummaryError('');
      };

      useEffect(() => {
        if (!selectedBidId && bids.length > 0) {
          setSelectedBidId(bids[0].id);
          return;
        }
        if (selectedBidId && !bids.some((bid) => String(bid.id) === String(selectedBidId))) {
          setSelectedBidId(bids[0]?.id || null);
        }
      }, [bids, selectedBidId]);

      useEffect(() => {
        let isMounted = true;

        const load = async () => {
          if (!selectedBidId) {
            if (isMounted) {
              setBidItems([]);
              setBidSummary(null);
              setBidSummaryError('');
            }
            return;
          }
          try {
            setBidItemsLoading(true);
            setBidSummaryLoading(true);
            await Promise.all([
              loadBidItems(selectedBidId),
              loadBidSummary(selectedBidId),
            ]);
          } catch {
            if (isMounted) {
              setBidItems([]);
              setBidSummary(null);
              setBidSummaryError('Failed to load bid summary');
            }
          } finally {
            if (isMounted) {
              setBidItemsLoading(false);
              setBidSummaryLoading(false);
            }
          }
        };

        load();
        return () => {
          isMounted = false;
        };
      }, [selectedBidId]);

      useEffect(() => {
        setSendError('');
        setShowSendOverride(false);
        setSendOverrideChecked(false);
        setSendOverrideNote('');
      }, [selectedBidId]);

      useEffect(() => {
        loadAnalytics();
      }, []);

      const openCreateBid = () => {
        resetBidForm();
        setShowBidModal(true);
      };

      const openEditBid = (bid) => {
        setBidForm({
          title: bid.projectName || bid.title || '',
          status: bid.status || 'draft',
          stage: bid.stage || 'estimating',
          job_id: bid.job_id || bid.jobId || '',
          client: bid.client || '',
          bid_date: bid.bid_date || bid.bidDate || '',
          probability: Number(bid.probability) || 0,
          notes: bid.notes || '',
        });
        setEditingBidId(bid.id);
        setFormError('');
        setShowBidModal(true);
      };

      const closeBidModal = () => {
        if (saveLoading) return;
        setShowBidModal(false);
        resetBidForm();
      };

      const handleSaveBid = async () => {
        if (!bidForm.title.trim()) {
          setFormError('Project name is required.');
          return;
        }

        try {
          setSaveLoading(true);
          setFormError('');

          const payload = {
            title: bidForm.title.trim(),
            status: bidForm.status,
            stage: bidForm.stage,
            job_id: bidForm.job_id || null,
            client: bidForm.client.trim(),
            bid_date: bidForm.bid_date || null,
            probability: Number(bidForm.probability) || 0,
            notes: bidForm.notes.trim(),
          };

          const response = await fetch(editingBidId ? `/api/bids/${editingBidId}` : '/api/bids', {
            method: editingBidId ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          const raw = await response.text();
          let parsed = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = {};
          }

          if (!response.ok) {
            setFormError(parsed?.error || raw || 'Failed to save bid');
            return;
          }

          await refreshBids({ preserveSelection: true });
          if (!editingBidId && parsed?.bid?.id) {
            setSelectedBidId(parsed.bid.id);
          }
          setShowBidModal(false);
          resetBidForm();
        } catch {
          setFormError('Failed to save bid');
        } finally {
          setSaveLoading(false);
        }
      };

      const handleDeleteBid = async (bidId) => {
        const confirmed = confirmDelete('this bid');
        if (!confirmed) return;

        try {
          setDeleteLoading(true);
          setFormError('');

          const response = await fetch(`/api/bids/${bidId}`, { method: 'DELETE' });
          const raw = await response.text();
          let parsed = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = {};
          }
          if (!response.ok) {
            setFormError(parsed?.error || raw || 'Failed to delete bid');
            return;
          }

          setBids((prev) => prev.filter((bid) => String(bid.id) !== String(bidId)));
          if (String(selectedBidId) === String(bidId)) {
            setSelectedBidId(null);
            setBidItems([]);
          }
        } catch {
          setFormError('Failed to delete bid');
        } finally {
          setDeleteLoading(false);
        }
      };

      const handleSendBid = async ({ override = false } = {}) => {
        if (!selectedBid) return;

        try {
          setSendLoading(true);
          setSendError('');

          const response = await fetch(`/api/bids/${selectedBid.id}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              override,
              override_note: override ? sendOverrideNote.trim() : undefined,
            }),
          });

          const raw = await response.text();
          let parsed = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = {};
          }

          if (response.status === 409) {
            setSendError(parsed?.error || 'Margin below target');
            if (parsed?.summary) {
              setBidSummary(parsed.summary);
            }
            setShowSendOverride(true);
            return;
          }

          if (!response.ok) {
            setSendError(parsed?.error || raw || 'Failed to send bid');
            return;
          }

          setShowSendOverride(false);
          setSendOverrideChecked(false);
          setSendOverrideNote('');
          await Promise.all([refreshBids({ preserveSelection: true }), loadBidSummary(selectedBid.id)]);
          await loadAnalytics();
        } catch {
          setSendError('Failed to send bid');
        } finally {
          setSendLoading(false);
        }
      };

      const handlePipelinePatch = async (patch) => {
        if (!selectedBid?.id) return;
        try {
          setPipelineLoading(true);
          setFormError('');
          const response = await fetch(`/api/bids/${selectedBid.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          });
          const raw = await response.text();
          let parsed = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = {};
          }
          if (!response.ok) {
            setFormError(parsed?.error || raw || 'Failed to update bid pipeline');
            return;
          }
          await refreshBids({ preserveSelection: true });
          await loadAnalytics();
        } finally {
          setPipelineLoading(false);
        }
      };

      const handleConvertToJob = async () => {
        if (!selectedBid?.id) return;
        try {
          setPipelineLoading(true);
          setFormError('');
          const response = await fetch(`/api/bids/${selectedBid.id}/convert`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          const raw = await response.text();
          let parsed = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = {};
          }
          if (!response.ok) {
            setFormError(parsed?.error || raw || 'Failed to convert bid');
            return;
          }
          await refreshBids({ preserveSelection: true });
          await loadAnalytics();
        } finally {
          setPipelineLoading(false);
        }
      };

      const openCreateItem = () => {
        resetItemForm();
        setShowItemModal(true);
      };

      const openEditItem = (item) => {
        setItemForm({
          item_type: item.item_type || 'custom',
          description: item.description || '',
          quantity: Number(item.quantity) || 1,
          unit_cost: Number(item.unit_cost) || 0,
        });
        setEditingItemId(item.id);
        setItemError('');
        setShowItemModal(true);
      };

      const closeItemModal = () => {
        if (itemSaveLoading) return;
        setShowItemModal(false);
        resetItemForm();
      };

      const handleSaveItem = async () => {
        if (!selectedBidId) {
          setItemError('Select a bid first.');
          return;
        }
        if (!itemForm.description.trim()) {
          setItemError('Description is required.');
          return;
        }

        try {
          setItemSaveLoading(true);
          setItemError('');
          const payload = {
            item_type: itemForm.item_type,
            description: itemForm.description.trim(),
            quantity: Number(itemForm.quantity) || 0,
            unit_cost: Number(itemForm.unit_cost) || 0,
          };

          const response = await fetch(
            editingItemId
              ? `/api/bids/${selectedBidId}/items/${editingItemId}`
              : `/api/bids/${selectedBidId}/items`,
            {
              method: editingItemId ? 'PATCH' : 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }
          );

          const raw = await response.text();
          let parsed = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = {};
          }
          if (!response.ok) {
            setItemError(parsed?.error || raw || 'Failed to save bid item');
            return;
          }

          await Promise.all([refreshBids({ preserveSelection: true }), loadBidItems(selectedBidId), loadBidSummary(selectedBidId)]);
          setShowItemModal(false);
          resetItemForm();
        } catch {
          setItemError('Failed to save bid item');
        } finally {
          setItemSaveLoading(false);
        }
      };

      const handleDeleteItem = async (itemId) => {
        if (!selectedBidId) return;
        const confirmed = confirmDelete('this bid item');
        if (!confirmed) return;

        try {
          setItemDeleteLoading(true);
          setItemError('');
          const response = await fetch(`/api/bids/${selectedBidId}/items/${itemId}`, { method: 'DELETE' });
          const raw = await response.text();
          let parsed = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = {};
          }
          if (!response.ok) {
            setItemError(parsed?.error || raw || 'Failed to delete bid item');
            return;
          }
          await Promise.all([refreshBids({ preserveSelection: true }), loadBidItems(selectedBidId), loadBidSummary(selectedBidId)]);
        } catch {
          setItemError('Failed to delete bid item');
        } finally {
          setItemDeleteLoading(false);
        }
      };

      return (
        <div className="space-y-6">
          <StatGrid desktopColsClass="md:grid-cols-4" testId="stats-grid">
            <StatCard icon="file-invoice-dollar" label="Active Opportunities" value={analytics?.counts?.open ?? bids.filter((bid) => !['won', 'lost'].includes(String(bid.stage || bid.status))).length} color="brand" />
            <StatCard icon="dollar-sign" label="Pipeline Value" value={formatCurrency((canSeePmAnalytics && analytics?.pipeline_value) || totalPending)} color="blue" />
            <StatCard icon="trophy" label="Win Rate" value={`${(canSeePmAnalytics && analytics?.win_rate_percent) ?? winRate}%`} color="green" />
            <StatCard icon="chart-line" label={isEstimatorView ? 'Avg Estimated Margin' : 'Cycle Time'} value={isEstimatorView ? `${(canSeePmAnalytics && analytics?.avg_estimated_margin_percent) ?? 0}%` : `${(canSeePmAnalytics && analytics?.avg_cycle_time_days) ?? 0}d`} color="yellow" />
          </StatGrid>
          {analyticsLoading ? <LoadingBlock>Loading analytics...</LoadingBlock> : null}

          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex flex-wrap bg-gray-100 rounded-lg p-1">
              {['all', 'lead', 'qualified', 'estimating', 'review', 'won', 'lost'].map((status) => (
                <button
                  key={status}
                  onClick={() => setFilter(status)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${filter === status ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="w-56 max-w-[60vw]">
                <SearchInput value={search} onChange={setSearch} placeholder="Search bids..." />
              </div>
              <Button variant="brand" onClick={openCreateBid} data-testid="bids-create"><Icon name="plus" className="mr-2" />New Bid</Button>
            </div>
          </div>

          {formError && <InlineError testId="bids-form-error">{formError}</InlineError>}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="space-y-4">
              {bidsLoading ? (
                <SkeletonBlock lines={4} testId="bids-loading" />
              ) : filteredBids.length === 0 ? (
                <EmptyState testId="bids-empty">No bids found. Create your first bid to get started.</EmptyState>
              ) : (
                filteredBids.map((bid) => (
                  <Card
                    key={bid.id}
                    data-testid={`bid-row-${bid.id}`}
                    className={`p-4 cursor-pointer ${String(selectedBidId) === String(bid.id) ? 'ring-2 ring-brand-orange border-brand-orange' : ''}`}
                    onClick={() => setSelectedBidId(bid.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-4">
                        <div className={`p-3 rounded-lg ${bid.status === 'won' ? 'bg-green-100' : bid.status === 'lost' ? 'bg-red-100' : 'bg-blue-100'}`}>
                          <Icon name={getStatusIcon(bid.status)} className={`text-lg ${bid.status === 'won' ? 'text-green-600' : bid.status === 'lost' ? 'text-red-600' : 'text-blue-600'}`} />
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-900">{bid.projectName || bid.title}</h4>
                          <p className="text-sm text-gray-500">{bid.client || 'No client'}</p>
                          <p className="text-xs text-gray-400 mt-1">Bid Date: {formatDate(bid.bidDate || bid.bid_date)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-gray-900">{formatCurrency(bid.amount || 0)}</p>
                        <Badge className={getStageBadgeClass(bid.stage || bid.status)}>{bid.stage || bid.status}</Badge>
                        {['lead', 'qualified', 'estimating', 'review'].includes(String(bid.stage || 'estimating')) && (
                          <p className="text-sm text-gray-500 mt-1">{bid.probability || 0}% probability</p>
                        )}
                      </div>
                    </div>
                    {bid.notes && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <p className="text-sm text-gray-600"><Icon name="sticky-note" className="mr-2 text-gray-400" />{bid.notes}</p>
                      </div>
                    )}
                  </Card>
                ))
              )}
            </div>

            <Card className="p-4">
              {selectedBid ? (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <div>
                      <h4 className="text-lg font-bold text-gray-900">{selectedBid.projectName || selectedBid.title}</h4>
                      <p className="text-sm text-gray-500">{selectedBid.client || 'No client selected'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => openEditBid(selectedBid)}>
                        <Icon name="pen" className="mr-2" />Edit
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => handlePipelinePatch({ review_ready: true, stage: 'review' })}
                        disabled={pipelineLoading || Boolean(selectedBid.reviewReadyAt)}
                      >
                        Review Ready
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => handlePipelinePatch({ review_approved: true, stage: 'review' })}
                        disabled={pipelineLoading || Boolean(selectedBid.reviewApprovedAt)}
                      >
                        Approve Review
                      </Button>
                      <Button
                        variant="brand"
                        onClick={handleConvertToJob}
                        disabled={pipelineLoading || Boolean(selectedBid.convertedJobId)}
                      >
                        {selectedBid.convertedJobId ? 'Converted' : 'Convert to Job'}
                      </Button>
                      {canSeeExecAnalytics ? (
                        <Button
                          variant="secondary"
                          onClick={() => window.open(`/api/bids/${selectedBid.id}/handoff?format=json`, '_blank')}
                        >
                          Export Handoff JSON
                        </Button>
                      ) : null}
                      {canSeePmAnalytics ? (
                        <Button
                          variant="secondary"
                          onClick={() => window.open(`/api/bids/${selectedBid.id}/handoff?format=pdf`, '_blank')}
                        >
                          Export Handoff PDF
                        </Button>
                      ) : null}
                      <Button
                        variant="brand"
                        onClick={() => handleSendBid({ override: false })}
                        disabled={sendLoading || selectedBid.status === 'sent'}
                        data-testid="bids-send"
                      >
                        <Icon name="paper-plane" className="mr-2" />
                        {sendLoading ? 'Sending...' : (selectedBid.status === 'sent' ? 'Sent' : 'Send')}
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => handleDeleteBid(selectedBid.id)}
                        disabled={deleteLoading}
                        data-testid="bids-delete"
                      >
                        <Icon name="trash" className="mr-2" />Delete
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-gray-500">Stage</p>
                      <p className="font-semibold text-gray-900 capitalize" data-testid="bid-status-value">{selectedBid.stage || selectedBid.status}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Bid Date</p>
                      <p className="font-semibold text-gray-900">{formatDate(selectedBid.bidDate || selectedBid.bid_date)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Probability</p>
                      <p className="font-semibold text-gray-900">{selectedBid.probability || 0}%</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Total</p>
                      <p className="font-semibold text-gray-900">{formatCurrency(selectedBid.amount || 0)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Review Ready</p>
                      <p className="font-semibold text-gray-900">{selectedBid.reviewReadyAt ? formatDate(selectedBid.reviewReadyAt) : 'No'}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Approved</p>
                      <p className="font-semibold text-gray-900">{selectedBid.reviewApprovedAt ? formatDate(selectedBid.reviewApprovedAt) : 'No'}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm pt-2 border-t border-gray-200">
                    <div>
                      <p className="text-gray-500">Revenue</p>
                      <p className="font-semibold text-gray-900">{formatCurrency(Number(bidSummary?.revenue || 0))}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Cost</p>
                      <p className="font-semibold text-gray-900">{formatCurrency(Number(bidSummary?.subtotalCost || 0))}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Profit</p>
                      <p className="font-semibold text-gray-900">{formatCurrency(Number(bidSummary?.profit || 0))}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Margin %</p>
                      <p className="font-semibold text-gray-900" data-testid="bids-summary-margin">
                        {Number(bidSummary?.marginPercent || 0).toFixed(2)}%
                      </p>
                    </div>
                  </div>

                  {bidSummaryLoading && <LoadingBlock testId="bids-summary-loading">Loading summary...</LoadingBlock>}
                  {bidSummaryError && <InlineError testId="bids-summary-error">{bidSummaryError}</InlineError>}
                  {bidSummary?.isBelowTarget && (
                    <Card className="p-3 border border-yellow-300 bg-yellow-50 text-yellow-800 text-sm">
                      <Icon name="triangle-exclamation" className="mr-2" />
                      {bidSummary.warnings?.[0] || 'Margin is below target.'}
                    </Card>
                  )}
                  {sendError && <InlineError testId="bids-send-warning">{sendError}</InlineError>}
                  {showSendOverride && (
                    <Card className="p-3 border border-yellow-300 bg-yellow-50 text-yellow-900 space-y-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={sendOverrideChecked}
                          onChange={(e) => setSendOverrideChecked(e.target.checked)}
                          data-testid="bids-send-override-checkbox"
                        />
                        <span>I understand, send anyway</span>
                      </label>
                      <textarea
                        value={sendOverrideNote}
                        onChange={(e) => setSendOverrideNote(e.target.value)}
                        placeholder="Override note (optional)"
                        className="w-full border border-yellow-300 rounded-lg px-3 py-2 text-sm bg-white"
                        data-testid="bids-send-override-note"
                      />
                      <div className="flex justify-end">
                        <Button
                          variant="brand"
                          onClick={() => handleSendBid({ override: true })}
                          disabled={!sendOverrideChecked || sendLoading}
                          data-testid="bids-send-confirm-override"
                        >
                          {sendLoading ? 'Sending...' : 'Send Anyway'}
                        </Button>
                      </div>
                    </Card>
                  )}

                  <BidShareLinkPanel bidId={selectedBid ? String(selectedBid.id) : null} />

                  <div className="pt-2 border-t border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                      <h5 className="font-semibold text-gray-900">Line Items</h5>
                      <Button variant="brand" onClick={openCreateItem} data-testid="bids-add-item">
                        <Icon name="plus" className="mr-2" />Add Item
                      </Button>
                    </div>

                    {itemError && <InlineError className="mb-2" testId="bids-item-error">{itemError}</InlineError>}

                    {bidItemsLoading ? (
                      <LoadingBlock testId="bids-items-loading">Loading items...</LoadingBlock>
                    ) : bidItems.length === 0 ? (
                      <EmptyState testId="bids-items-empty">No bid items yet. Add a line item to price this bid.</EmptyState>
                    ) : (
                      <div className="space-y-2">
                        {bidItems.map((item) => (
                          <div key={item.id} className="border border-gray-200 rounded-lg p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium text-gray-900">{item.description}</p>
                                <p className="text-xs text-gray-500 capitalize">
                                  {item.item_type} • {item.quantity} × {formatCurrency(item.unit_cost)}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="font-semibold text-gray-900">{formatCurrency(item.total_cost)}</p>
                                <div className="mt-1 flex gap-1 justify-end">
                                  <button
                                    type="button"
                                    className="text-xs text-blue-600 hover:text-blue-700"
                                    onClick={() => openEditItem(item)}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="text-xs text-red-600 hover:text-red-700"
                                    disabled={itemDeleteLoading}
                                    onClick={() => handleDeleteItem(item.id)}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <EmptyState testId="bids-select-empty">
                  <div className="text-center">
                    <Icon name="file-invoice-dollar" className="text-4xl mb-2 text-gray-300" />
                    <p>Select a bid to view details</p>
                  </div>
                </EmptyState>
              )}
            </Card>
          </div>

          {showBidModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
              <button className="absolute inset-0 bg-black/40" onClick={closeBidModal} aria-label="Close bid modal" />
              <Card className="relative z-10 w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900">{editingBidId ? 'Edit Bid' : 'Create Bid'}</h3>
                  <button type="button" className="text-gray-500 hover:text-gray-700" onClick={closeBidModal}>
                    <Icon name="xmark" className="text-lg" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Project Name</label>
                    <input
                      type="text"
                      data-testid="bids-title-input"
                      value={bidForm.title}
                      onChange={(e) => setBidForm({ ...bidForm, title: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Stage</label>
                      <select
                        value={bidForm.stage}
                        onChange={(e) => setBidForm({ ...bidForm, stage: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      >
                        {['lead', 'qualified', 'estimating', 'review', 'won', 'lost'].map((status) => (
                          <option key={status} value={status}>
                            {status.charAt(0).toUpperCase() + status.slice(1)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Bid Date</label>
                      <input
                        type="date"
                        value={bidForm.bid_date || ''}
                        onChange={(e) => setBidForm({ ...bidForm, bid_date: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Related Job (Optional)</label>
                    <select
                      value={bidForm.job_id || ''}
                      onChange={(e) => setBidForm({ ...bidForm, job_id: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">None</option>
                      {jobs.map((job) => (
                        <option key={job.id} value={job.id}>
                          {job.name || job.projectName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
                    <input
                      type="text"
                      value={bidForm.client}
                      onChange={(e) => setBidForm({ ...bidForm, client: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Probability (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={bidForm.probability}
                      onChange={(e) => setBidForm({ ...bidForm, probability: Number(e.target.value) })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                    <textarea
                      rows={3}
                      value={bidForm.notes}
                      onChange={(e) => setBidForm({ ...bidForm, notes: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  {formError && <p className="text-sm text-red-600">{formError}</p>}
                </div>

                <div className="mt-6 flex flex-col sm:flex-row gap-2 sm:justify-end">
                  <Button variant="secondary" onClick={closeBidModal} disabled={saveLoading}>Cancel</Button>
                  <Button variant="brand" onClick={handleSaveBid} disabled={saveLoading} data-testid="bids-save">
                    {saveLoading ? 'Saving...' : (editingBidId ? 'Save Bid' : 'Create Bid')}
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {showItemModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
              <button className="absolute inset-0 bg-black/40" onClick={closeItemModal} aria-label="Close bid item modal" />
              <Card className="relative z-10 w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900">{editingItemId ? 'Edit Bid Item' : 'Add Bid Item'}</h3>
                  <button type="button" className="text-gray-500 hover:text-gray-700" onClick={closeItemModal}>
                    <Icon name="xmark" className="text-lg" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                    <select
                      value={itemForm.item_type}
                      onChange={(e) => setItemForm({ ...itemForm, item_type: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    >
                      {['custom', 'labor', 'equipment', 'material', 'subcontract'].map((type) => (
                        <option key={type} value={type}>
                          {type.charAt(0).toUpperCase() + type.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <input
                      type="text"
                      data-testid="bid-item-description"
                      value={itemForm.description}
                      onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                      <input
                        type="number"
                        data-testid="bid-item-quantity"
                        min="0.01"
                        step="0.01"
                        value={itemForm.quantity}
                        onChange={(e) => setItemForm({ ...itemForm, quantity: Number(e.target.value) })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Unit Cost</label>
                      <input
                        type="number"
                        data-testid="bid-item-unit-cost"
                        min="0"
                        step="0.01"
                        value={itemForm.unit_cost}
                        onChange={(e) => setItemForm({ ...itemForm, unit_cost: Number(e.target.value) })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                  {itemError && <p className="text-sm text-red-600">{itemError}</p>}
                </div>

                <div className="mt-6 flex flex-col sm:flex-row gap-2 sm:justify-end">
                  <Button variant="secondary" onClick={closeItemModal} disabled={itemSaveLoading}>Cancel</Button>
                  <Button variant="brand" onClick={handleSaveItem} disabled={itemSaveLoading} data-testid="bids-item-save">
                    {itemSaveLoading ? 'Saving...' : (editingItemId ? 'Save Item' : 'Add Item')}
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </div>
      );
}
