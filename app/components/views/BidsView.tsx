/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
'use client';

import { useEffect, useState } from 'react';
import { BidShareLinkPanel } from '@/app/components/bids/BidShareLinkPanel';
import { EmptyState, InlineError, LoadingBlock, SkeletonBlock } from '@/app/components/ui/FeedbackBlocks';

const confirmDelete = (targetLabel) => window.confirm(`Delete ${targetLabel}? This cannot be undone.`);

export function BidsView({ bids, bidsLoading, setBids, jobs, ui, currentRole }) {
  const { StatGrid, StatCard, SearchInput, Card, Icon, Button, Badge, formatCurrency, formatDate } = ui;
      const toDateOnly = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return '';
        return parsed.toISOString().slice(0, 10);
      };
      const getBidClient = (bid) => bid?.client || bid?.client_name || bid?.customer || bid?.customer_name || '';
      const getBidDate = (bid) => toDateOnly(bid?.bidDate || bid?.bid_date || bid?.biddate || '');
      const getBidProbability = (bid) => {
        const value = bid?.probability ?? bid?.win_probability ?? 0;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const getBidStage = (bid) => bid?.stage || bid?.status || 'estimating';
      const getBidFinancials = (bid) => {
        const revenue = Number(
          bid?.revenue ??
          bid?.amount ??
          bid?.total ??
          bid?.total_amount ??
          0
        ) || 0;
        const actualJobCost = Number(
          bid?.actual_job_cost ??
          bid?.actualJobCost ??
          bid?.subtotal ??
          0
        ) || 0;
        const profit = Number.isFinite(Number(bid?.profit))
          ? Number(bid?.profit)
          : (revenue - actualJobCost);
        const margin = Number.isFinite(Number(bid?.margin))
          ? Number(bid?.margin)
          : (revenue > 0 ? (profit / revenue) : 0);
        return { revenue, actualJobCost, profit, margin };
      };
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
      const [isMobile, setIsMobile] = useState(false);
      const [showMobileDetails, setShowMobileDetails] = useState(false);
      const [bidForm, setBidForm] = useState({
        title: '',
        status: 'draft',
        stage: 'estimating',
        job_id: '',
        client: '',
        bid_date: '',
        probability: 0,
        actual_job_cost: 0,
        revenue: 0,
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
          getBidClient(bid).toLowerCase().includes(query)
        );
      });

      const totalPending = bids
        .filter((bid) => ['lead', 'qualified', 'estimating', 'review'].includes(String(bid.stage || 'estimating')))
        .reduce((sum, bid) => sum + (Number(bid.amount) || 0), 0);
      const wonCount = bids.filter((bid) => getBidStage(bid) === 'won').length;
      const closedCount = bids.filter((bid) => ['won', 'lost'].includes(String(getBidStage(bid)))).length;
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
          actual_job_cost: 0,
          revenue: 0,
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
        const media = window.matchMedia('(max-width: 1279px)');
        const update = () => setIsMobile(media.matches);
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
      }, []);

      useEffect(() => {
        if (!isMobile) setShowMobileDetails(false);
      }, [isMobile]);

      useEffect(() => {
        if (!selectedBid) setShowMobileDetails(false);
      }, [selectedBid]);

      useEffect(() => {
        if (!(showMobileDetails || showBidModal || showItemModal) || typeof document === 'undefined') return undefined;
        document.body.classList.add('modal-open');
        return () => {
          document.body.classList.remove('modal-open');
        };
      }, [showBidModal, showItemModal, showMobileDetails]);

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
        const financials = getBidFinancials(bid);
        setBidForm({
          title: bid.projectName || bid.title || '',
          status: bid.status || 'draft',
          stage: getBidStage(bid),
          job_id: bid.job_id || bid.jobId || '',
          client: getBidClient(bid),
          bid_date: getBidDate(bid) || '',
          probability: getBidProbability(bid),
          actual_job_cost: financials.actualJobCost,
          revenue: financials.revenue,
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
          const allowedStatuses = new Set([
            'draft',
            'pending',
            'submitted',
            'sent',
            'accepted',
            'rejected',
            'archived',
            'won',
            'lost',
            'canceled',
          ]);
          const normalizedStatus = allowedStatuses.has(String(bidForm.status || '').toLowerCase())
            ? String(bidForm.status).toLowerCase()
            : 'draft';

          const payload = {
            title: bidForm.title.trim(),
            stage: bidForm.stage,
            job_id: bidForm.job_id || null,
            client: bidForm.client.trim(),
            bid_date: toDateOnly(bidForm.bid_date) || null,
            probability: Number(bidForm.probability) || 0,
            actual_job_cost: Number(bidForm.actual_job_cost) || 0,
            revenue: Number(bidForm.revenue) || 0,
            notes: bidForm.notes.trim(),
            ...(editingBidId ? {} : { status: normalizedStatus }),
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

          const rawSavedBid = parsed?.bid || parsed?.item || null;
          const savedBid = rawSavedBid?.id
            ? {
                ...rawSavedBid,
                client: rawSavedBid.client ?? bidForm.client.trim(),
                bid_date: toDateOnly(rawSavedBid.bid_date ?? rawSavedBid.bidDate ?? bidForm.bid_date),
                bidDate: toDateOnly(rawSavedBid.bidDate ?? rawSavedBid.bid_date ?? bidForm.bid_date),
                probability:
                  Number.isFinite(Number(rawSavedBid.probability))
                    ? Number(rawSavedBid.probability)
                    : (Number(bidForm.probability) || 0),
                actual_job_cost: Number(rawSavedBid.actual_job_cost ?? rawSavedBid.actualJobCost ?? bidForm.actual_job_cost ?? 0) || 0,
                actualJobCost: Number(rawSavedBid.actualJobCost ?? rawSavedBid.actual_job_cost ?? bidForm.actual_job_cost ?? 0) || 0,
                revenue: Number(rawSavedBid.revenue ?? rawSavedBid.total ?? rawSavedBid.amount ?? bidForm.revenue ?? 0) || 0,
                profit: Number(rawSavedBid.profit ?? ((Number(rawSavedBid.revenue ?? bidForm.revenue ?? 0) || 0) - (Number(rawSavedBid.actual_job_cost ?? bidForm.actual_job_cost ?? 0) || 0))) || 0,
                margin: Number(rawSavedBid.margin ?? 0),
              }
            : null;
          if (savedBid?.id) {
            setBids((prev) => {
              const exists = prev.some((bid) => String(bid.id) === String(savedBid.id));
              if (exists) {
                return prev.map((bid) => (String(bid.id) === String(savedBid.id) ? { ...bid, ...savedBid } : bid));
              }
              return [savedBid, ...prev];
            });
            setSelectedBidId(savedBid.id);
          }
          await refreshBids({ preserveSelection: true });
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
            <StatCard icon="file-invoice-dollar" label="Active Opportunities" value={analytics?.counts?.open ?? bids.filter((bid) => !['won', 'lost'].includes(String(getBidStage(bid)))).length} color="brand" />
            <StatCard icon="dollar-sign" label="Pipeline Value" value={formatCurrency((canSeePmAnalytics && analytics?.pipeline_value) || totalPending)} color="blue" />
            <StatCard icon="trophy" label="Win Rate" value={`${(canSeePmAnalytics && analytics?.win_rate_percent) ?? winRate}%`} color="green" />
            <StatCard icon="chart-line" label={isEstimatorView ? 'Avg Estimated Margin' : 'Cycle Time'} value={isEstimatorView ? `${(canSeePmAnalytics && analytics?.avg_estimated_margin_percent) ?? 0}%` : `${(canSeePmAnalytics && analytics?.avg_cycle_time_days) ?? 0}d`} color="yellow" />
          </StatGrid>
          {analyticsLoading ? <LoadingBlock>Loading analytics...</LoadingBlock> : null}

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center lg:w-auto">
              <div className="w-full sm:hidden">
                <label className="mb-1 block text-xs font-medium uppercase tracking-[0.16em] text-gray-500">Stage</label>
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base font-medium text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  data-testid="bids-mobile-filter"
                >
                  {['all', 'lead', 'qualified', 'estimating', 'review', 'won', 'lost'].map((status) => (
                    <option key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="hidden flex-wrap rounded-lg bg-gray-100 p-1 sm:flex">
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
              <div className="w-full sm:w-64 lg:w-72">
                <SearchInput value={search} onChange={setSearch} placeholder="Search bids..." />
              </div>
            </div>
            <Button variant="brand" onClick={openCreateBid} data-testid="bids-create" className="w-full sm:w-auto"><Icon name="plus" className="mr-2" />New Bid</Button>
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
                    onClick={() => {
                      setSelectedBidId(bid.id);
                      if (isMobile) setShowMobileDetails(true);
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-4">
                        <div className={`p-3 rounded-lg ${bid.status === 'won' ? 'bg-green-100' : bid.status === 'lost' ? 'bg-red-100' : 'bg-blue-100'}`}>
                          <Icon name={getStatusIcon(bid.status)} className={`text-lg ${bid.status === 'won' ? 'text-green-600' : bid.status === 'lost' ? 'text-red-600' : 'text-blue-600'}`} />
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-900">{bid.projectName || bid.title}</h4>
                          <p className="text-sm text-gray-500">{getBidClient(bid) || 'No client'}</p>
                          <p className="text-xs text-gray-400 mt-1">Bid Date: {formatDate(getBidDate(bid))}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-gray-900">{formatCurrency(bid.amount || 0)}</p>
                        <Badge className={getStageBadgeClass(getBidStage(bid))}>{getBidStage(bid)}</Badge>
                        {['lead', 'qualified', 'estimating', 'review'].includes(String(getBidStage(bid))) && (
                          <p className="text-sm text-gray-500 mt-1">{getBidProbability(bid)}% probability</p>
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

            {!isMobile && (
            <Card className="p-4">
              {selectedBid ? (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <div>
                      <h4 className="text-lg font-bold text-gray-900">{selectedBid.projectName || selectedBid.title}</h4>
                      <p className="text-sm text-gray-500">{getBidClient(selectedBid) || 'No client selected'}</p>
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
                      <p className="font-semibold text-gray-900 capitalize" data-testid="bid-status-value">{getBidStage(selectedBid)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Bid Date</p>
                      <p className="font-semibold text-gray-900">{formatDate(getBidDate(selectedBid))}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Probability</p>
                      <p className="font-semibold text-gray-900">{getBidProbability(selectedBid)}%</p>
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
                      <p className="font-semibold text-gray-900">{formatCurrency(Number(getBidFinancials(selectedBid).revenue || bidSummary?.revenue || 0))}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Actual Job Cost</p>
                      <p className="font-semibold text-gray-900">{formatCurrency(Number(getBidFinancials(selectedBid).actualJobCost || bidSummary?.subtotalCost || 0))}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Profit</p>
                      <p className="font-semibold text-gray-900">{formatCurrency(Number(getBidFinancials(selectedBid).profit || bidSummary?.profit || 0))}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Margin</p>
                      <p className="font-semibold text-gray-900" data-testid="bids-summary-margin">
                        {(Number(getBidFinancials(selectedBid).margin || 0) * 100).toFixed(2)}%
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
                    <Icon name="file-invoice-dollar" className="mb-3 text-4xl text-gray-300" />
                    <p className="font-medium text-gray-600">Bid details stay here.</p>
                    <p className="mt-1 text-sm text-gray-500">Open a bid to review pricing, notes, and line items.</p>
                  </div>
                </EmptyState>
              )}
            </Card>
            )}
          </div>

          {isMobile && showMobileDetails && selectedBid && (
            <>
              <button
                type="button"
                aria-label="Close bid details"
                className="fixed inset-0 z-40 bg-black/50"
                onClick={() => setShowMobileDetails(false)}
              />
              <Card className="mobile-sheet-backdrop fixed inset-0 z-50 flex flex-col overflow-hidden rounded-none p-0 sm:items-center sm:justify-center sm:bg-black/0 sm:p-4">
                <div className="mobile-sheet-panel flex min-h-0 flex-1 flex-col bg-white shadow-2xl sm:max-h-[min(90dvh,56rem)] sm:max-w-4xl">
                <div className="mobile-sheet-header mb-0 flex items-start justify-between gap-3 border-b border-gray-200 px-4 pb-4 sm:items-center sm:px-5">
                  <div>
                    <h4 className="text-lg font-bold text-gray-900">{selectedBid.projectName || selectedBid.title}</h4>
                    <p className="text-sm text-gray-500">{getBidClient(selectedBid) || 'No client selected'}</p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-300 text-gray-700"
                    onClick={() => setShowMobileDetails(false)}
                  >
                    <Icon name="xmark" />
                  </button>
                </div>

                <div className="mobile-sheet-body min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,var(--safe-area-bottom))] pt-4 sm:px-5 sm:pb-5">
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => openEditBid(selectedBid)}>
                      <Icon name="pen" className="mr-2" />Edit
                    </Button>
                    <Button variant="brand" onClick={handleConvertToJob} disabled={pipelineLoading || Boolean(selectedBid.convertedJobId)}>
                      {selectedBid.convertedJobId ? 'Converted' : 'Convert to Job'}
                    </Button>
                    <Button variant="brand" onClick={() => handleSendBid({ override: false })} disabled={sendLoading || selectedBid.status === 'sent'}>
                      {sendLoading ? 'Sending...' : (selectedBid.status === 'sent' ? 'Sent' : 'Send')}
                    </Button>
                    <Button variant="danger" onClick={() => handleDeleteBid(selectedBid.id)} disabled={deleteLoading}>
                      Delete
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><p className="text-gray-500">Stage</p><p className="font-semibold text-gray-900 capitalize">{getBidStage(selectedBid)}</p></div>
                    <div><p className="text-gray-500">Bid Date</p><p className="font-semibold text-gray-900">{formatDate(getBidDate(selectedBid))}</p></div>
                    <div><p className="text-gray-500">Revenue</p><p className="font-semibold text-gray-900">{formatCurrency(Number(getBidFinancials(selectedBid).revenue || bidSummary?.revenue || 0))}</p></div>
                    <div><p className="text-gray-500">Actual Job Cost</p><p className="font-semibold text-gray-900">{formatCurrency(Number(getBidFinancials(selectedBid).actualJobCost || bidSummary?.subtotalCost || 0))}</p></div>
                    <div><p className="text-gray-500">Profit</p><p className="font-semibold text-gray-900">{formatCurrency(Number(getBidFinancials(selectedBid).profit || bidSummary?.profit || 0))}</p></div>
                    <div><p className="text-gray-500">Margin</p><p className="font-semibold text-gray-900">{(Number(getBidFinancials(selectedBid).margin || 0) * 100).toFixed(2)}%</p></div>
                  </div>

                  <BidShareLinkPanel bidId={selectedBid ? String(selectedBid.id) : null} />

                  <div className="pt-2 border-t border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                      <h5 className="font-semibold text-gray-900">Line Items</h5>
                      <Button variant="brand" onClick={openCreateItem}>
                        <Icon name="plus" className="mr-2" />Add Item
                      </Button>
                    </div>
                    {bidItemsLoading ? (
                      <LoadingBlock>Loading items...</LoadingBlock>
                    ) : bidItems.length === 0 ? (
                      <EmptyState>No bid items yet.</EmptyState>
                    ) : (
                      <div className="space-y-2">
                        {bidItems.map((item) => (
                          <div key={item.id} className="border border-gray-200 rounded-lg p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium text-gray-900">{item.description}</p>
                                <p className="text-xs text-gray-500 capitalize">{item.item_type} • {item.quantity} × {formatCurrency(item.unit_cost)}</p>
                              </div>
                              <p className="font-semibold text-gray-900">{formatCurrency(item.total_cost)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                </div>
                </div>
              </Card>
            </>
          )}

          {showBidModal && (
            <div className="mobile-sheet-backdrop fixed inset-0 z-50 flex items-end justify-center overflow-hidden sm:items-center sm:p-4">
              <button className="absolute inset-0 bg-black/40" onClick={closeBidModal} aria-label="Close bid modal" />
              <Card className="mobile-sheet-panel relative z-10 flex w-full max-w-xl flex-col bg-white shadow-2xl sm:max-h-[min(90dvh,56rem)]">
                <div className="mobile-sheet-header mb-0 flex items-start justify-between gap-3 border-b border-gray-200 px-5 pb-4 sm:items-center sm:px-6">
                  <h3 className="text-lg font-bold text-gray-900">{editingBidId ? 'Edit Bid' : 'Create Bid'}</h3>
                  <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700" onClick={closeBidModal}>
                    <Icon name="xmark" className="text-lg" />
                  </button>
                </div>

                <div className="mobile-sheet-body space-y-3 overflow-y-auto px-5 pb-[max(1rem,var(--safe-area-bottom))] pt-4 sm:px-6 sm:pb-6">
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
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                          data-testid="bids-bid-date-input"
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
                        data-testid="bids-client-input"
                        value={bidForm.client}
                        onChange={(e) => setBidForm({ ...bidForm, client: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Probability (%)</label>
                      <input
                        type="number"
                        data-testid="bids-probability-input"
                        min="0"
                        max="100"
                        value={bidForm.probability}
                        onChange={(e) => setBidForm({ ...bidForm, probability: Number(e.target.value) })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Actual Job Cost</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={bidForm.actual_job_cost}
                          onChange={(e) => setBidForm({ ...bidForm, actual_job_cost: Number(e.target.value) || 0 })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Revenue</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={bidForm.revenue}
                          onChange={(e) => setBidForm({ ...bidForm, revenue: Number(e.target.value) || 0 })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Profit</label>
                        <p className="w-full border border-gray-200 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                          {formatCurrency((Number(bidForm.revenue) || 0) - (Number(bidForm.actual_job_cost) || 0))}
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Margin</label>
                        <p className="w-full border border-gray-200 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                          {(((Number(bidForm.revenue) || 0) > 0
                            ? (((Number(bidForm.revenue) || 0) - (Number(bidForm.actual_job_cost) || 0)) / (Number(bidForm.revenue) || 0))
                            : 0) * 100).toFixed(2)}%
                        </p>
                      </div>
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
                  <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button variant="secondary" onClick={closeBidModal} disabled={saveLoading}>Cancel</Button>
                    <Button variant="brand" onClick={handleSaveBid} disabled={saveLoading} data-testid="bids-save">
                      {saveLoading ? 'Saving...' : (editingBidId ? 'Save Bid' : 'Create Bid')}
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {showItemModal && (
            <div className="mobile-sheet-backdrop fixed inset-0 z-50 flex items-end justify-center overflow-hidden sm:items-center sm:p-4">
              <button className="absolute inset-0 bg-black/40" onClick={closeItemModal} aria-label="Close bid item modal" />
              <Card className="mobile-sheet-panel relative z-10 flex w-full max-w-lg flex-col bg-white shadow-2xl sm:max-h-[min(90dvh,56rem)]">
                <div className="mobile-sheet-header mb-0 flex items-start justify-between gap-3 border-b border-gray-200 px-5 pb-4 sm:items-center sm:px-6">
                  <h3 className="text-lg font-bold text-gray-900">{editingItemId ? 'Edit Bid Item' : 'Add Bid Item'}</h3>
                  <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700" onClick={closeItemModal}>
                    <Icon name="xmark" className="text-lg" />
                  </button>
                </div>

                <div className="mobile-sheet-body space-y-3 overflow-y-auto px-5 pb-[max(1rem,var(--safe-area-bottom))] pt-4 sm:px-6 sm:pb-6">
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
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                    <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                      <Button variant="secondary" onClick={closeItemModal} disabled={itemSaveLoading}>Cancel</Button>
                      <Button variant="brand" onClick={handleSaveItem} disabled={itemSaveLoading} data-testid="bids-item-save">
                        {itemSaveLoading ? 'Saving...' : (editingItemId ? 'Save Item' : 'Add Item')}
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      );
}
