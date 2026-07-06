/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Timecard = {
  id: string;
  userId: string | null;
  employeeId: string | null;
  jobId: string | null;
  workDate: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  breakStartAt: string | null;
  breakEndAt: string | null;
  totalMinutes: number;
  status: string;
  source: string;
  confidence: string;
  notes: string;
  approvedAt: string | null;
};

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  pending_review: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  needs_review: 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300',
  approved: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Checked In',
  pending_review: 'Pending Review',
  needs_review: 'Needs Review',
  approved: 'Approved',
  rejected: 'Rejected',
};
const statusLabel = (s: string) => STATUS_LABELS[s] || s.replace(/_/g, ' ');

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
const fmtHours = (min: number) => (min > 0 ? `${(min / 60).toFixed(1)} h` : '—');
const todayStr = () => new Date().toISOString().slice(0, 10);

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] || 'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300'}`}>
      {statusLabel(status)}
    </span>
  );
}

export function JobsiteTimeView({
  employees = [],
  jobs = [],
}: {
  employees?: Array<{ id: string; name?: string; user_id?: string | null }>;
  jobs?: Array<{ id: string; name?: string }>;
}) {
  const [items, setItems] = useState<Timecard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ card: Timecard; events: any[] } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ from: '', to: '', employee: 'all', job: 'all', status: 'all', needsReview: false });

  const nameByUser = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) {
      if (e.user_id) m.set(String(e.user_id), String(e.name || 'Team member'));
      m.set(String(e.id), String(e.name || 'Team member'));
    }
    return m;
  }, [employees]);
  const jobNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of jobs) m.set(String(j.id), String(j.name || 'Job'));
    return m;
  }, [jobs]);
  const empName = (t: Timecard) => nameByUser.get(String(t.userId || t.employeeId || '')) || 'Team member';
  const jobName = (t: Timecard) => jobNameById.get(String(t.jobId || '')) || 'Unassigned';

  const activeFilterCount =
    (filters.from ? 1 : 0) + (filters.to ? 1 : 0) + (filters.employee !== 'all' ? 1 : 0) +
    (filters.job !== 'all' ? 1 : 0) + (filters.status !== 'all' ? 1 : 0) + (filters.needsReview ? 1 : 0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const p = new URLSearchParams();
      if (filters.from) p.set('from', filters.from);
      if (filters.to) p.set('to', filters.to);
      if (filters.employee !== 'all') p.set('employee', filters.employee);
      if (filters.job !== 'all') p.set('job', filters.job);
      if (filters.status !== 'all') p.set('status', filters.status);
      if (filters.needsReview) p.set('needsReview', '1');
      const res = await fetch(`/api/jobsite-time/timecards?${p.toString()}`, { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error || 'Failed to load attendance');
        setItems([]);
        return;
      }
      setItems(json?.items || []);
    } catch {
      setError('Failed to load attendance');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => {
    const today = todayStr();
    let hoursTodayMin = 0;
    let checkedIn = 0;
    let pending = 0;
    let missing = 0;
    for (const t of items) {
      if (t.workDate === today) hoursTodayMin += t.totalMinutes;
      if (t.clockInAt && !t.clockOutAt) { checkedIn += 1; missing += 1; }
      if (t.status === 'pending_review' || t.status === 'needs_review') pending += 1;
    }
    return { hoursTodayMin, checkedIn, pending, missing };
  }, [items]);

  // Recent activity derived from arrival/departure timestamps (no separate feed).
  const recentActivity = useMemo(() => {
    const events: Array<{ key: string; t: Timecard; event: 'Arrived' | 'Left'; at: string }> = [];
    for (const t of items) {
      if (t.clockInAt) events.push({ key: `${t.id}-in`, t, event: 'Arrived', at: t.clockInAt });
      if (t.clockOutAt) events.push({ key: `${t.id}-out`, t, event: 'Left', at: t.clockOutAt });
    }
    events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return events.slice(0, 8);
  }, [items]);

  const assignedToday = useMemo(() => items.filter((t) => t.workDate === todayStr()), [items]);
  const needsReview = useMemo(() => items.filter((t) => t.status === 'needs_review' || t.status === 'pending_review'), [items]);

  const patch = async (id: string, body: any) => {
    setSavingId(id);
    try {
      const res = await fetch(`/api/jobsite-time/timecards/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.item) {
        setItems((prev) => prev.map((t) => (t.id === id ? { ...t, ...json.item } : t)));
        if (detail?.card.id === id) setDetail((d) => (d ? { ...d, card: { ...d.card, ...json.item } } : d));
      }
    } finally {
      setSavingId(null);
    }
  };

  const openDetail = async (card: Timecard) => {
    setDetail({ card, events: [] });
    const res = await fetch(`/api/jobsite-time/timecards/${card.id}`, { cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (res.ok) setDetail({ card: json.item, events: json.events || [] });
  };

  const cards = [
    { label: 'Checked In', value: summary.checkedIn, icon: 'fa-user-check', tone: 'text-green-600 dark:text-green-400' },
    { label: 'Pending Review', value: summary.pending, icon: 'fa-clipboard-check', tone: 'text-amber-600 dark:text-amber-400' },
    { label: 'Missing Clock-Outs', value: summary.missing, icon: 'fa-triangle-exclamation', tone: 'text-orange-600 dark:text-orange-400' },
    { label: 'Hours Today', value: fmtHours(summary.hoursTodayMin), icon: 'fa-clock', tone: 'text-blue-600 dark:text-blue-400' },
  ];

  const sel = 'rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-900 dark:border-zinc-700 dark:bg-[#090909] dark:text-zinc-100';
  const cardCls = 'rounded-xl border border-gray-200 bg-white dark:border-zinc-800 dark:bg-[#090909]';

  const emptyState = (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium text-gray-700 dark:text-zinc-200">No timecards yet.</p>
      <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">Assigned employees will appear here once attendance events are recorded.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100">Attendance</h2>
          <p className="text-sm text-gray-500 dark:text-zinc-400">Review arrivals, departures, and employee hours.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-[#111]"
        >
          <i className="fa-solid fa-sliders text-xs" /> Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
      </div>

      {showFilters && (
        <div className={`${cardCls} flex flex-wrap items-center gap-2 p-3`}>
          <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className={sel} aria-label="From date" />
          <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className={sel} aria-label="To date" />
          <select value={filters.employee} onChange={(e) => setFilters((f) => ({ ...f, employee: e.target.value }))} className={sel} aria-label="Employee">
            <option value="all">All employees</option>
            {employees.map((e) => <option key={e.id} value={String(e.user_id || e.id)}>{e.name || 'Team member'}</option>)}
          </select>
          <select value={filters.job} onChange={(e) => setFilters((f) => ({ ...f, job: e.target.value }))} className={sel} aria-label="Job">
            <option value="all">All jobs</option>
            {jobs.map((j) => <option key={j.id} value={String(j.id)}>{j.name || 'Job'}</option>)}
          </select>
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className={sel} aria-label="Status">
            <option value="all">Any status</option>
            <option value="active">Checked In</option>
            <option value="pending_review">Pending Review</option>
            <option value="needs_review">Needs Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <label className="inline-flex items-center gap-2 px-1 text-sm text-gray-700 dark:text-zinc-200">
            <input type="checkbox" checked={filters.needsReview} onChange={(e) => setFilters((f) => ({ ...f, needsReview: e.target.checked }))} className="h-4 w-4 accent-brand-500" />
            Needs review
          </label>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className={`${cardCls} p-3`}>
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500 dark:text-zinc-500">{c.label}</p>
              <i className={`fa-solid ${c.icon} ${c.tone}`} />
            </div>
            <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-zinc-100">{c.value}</p>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-300">{error}</p>}

      {loading ? (
        <div className={`${cardCls} px-4 py-10 text-center text-sm text-gray-500 dark:text-zinc-400`}>Loading…</div>
      ) : items.length === 0 ? (
        <div className={cardCls}>{emptyState}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Recent Activity */}
          <div className={cardCls}>
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Recent Activity</h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {recentActivity.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">No activity yet.</p>
              ) : recentActivity.map((ev) => (
                <button key={ev.key} type="button" onClick={() => openDetail(ev.t)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-[#101010]">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-900 dark:text-zinc-100">{empName(ev.t)}</span>
                    <span className="block truncate text-xs text-gray-500 dark:text-zinc-400">
                      <i className={`fa-solid ${ev.event === 'Arrived' ? 'fa-arrow-right-to-bracket text-green-500' : 'fa-arrow-right-from-bracket text-amber-500'} mr-1`} />
                      {ev.event} · {jobName(ev.t)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-zinc-400">{fmtTime(ev.at)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Assigned Today */}
          <div className={cardCls}>
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Assigned Today</h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {assignedToday.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">No assignments recorded today.</p>
              ) : assignedToday.map((t) => (
                <button key={t.id} type="button" onClick={() => openDetail(t)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-[#101010]">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-900 dark:text-zinc-100">{empName(t)}</span>
                    <span className="block truncate text-xs text-gray-500 dark:text-zinc-400">{jobName(t)} · Last activity {fmtTime(t.clockOutAt || t.clockInAt)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs tabular-nums text-gray-600 dark:text-zinc-300">{fmtHours(t.totalMinutes)}</span>
                    <StatusBadge status={t.status} />
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Timecards needing review */}
          <div className={`${cardCls} lg:col-span-2`}>
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Timecards needing review</h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {needsReview.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">Nothing needs review right now.</p>
              ) : needsReview.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-zinc-100">{empName(t)}</p>
                    <p className="truncate text-xs text-gray-500 dark:text-zinc-400">
                      {jobName(t)} · Arrived {fmtTime(t.clockInAt)} · Left {fmtTime(t.clockOutAt)} · {fmtHours(t.totalMinutes)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={t.status} />
                    <button type="button" disabled={savingId === t.id} onClick={() => patch(t.id, { action: 'approve' })} className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50">Approve</button>
                    <button type="button" onClick={() => openDetail(t)} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-[#111]">Review</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex">
          <button type="button" aria-label="Close details" className="flex-1 bg-black/40" onClick={() => setDetail(null)} />
          <div className="h-full w-full max-w-md overflow-y-auto border-l border-gray-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-[#0b0b0b]">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-zinc-100">{empName(detail.card)}</h3>
              <button type="button" onClick={() => setDetail(null)} className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 dark:border-zinc-700 dark:text-zinc-300">Close</button>
            </div>
            <div className="mb-3"><StatusBadge status={detail.card.status} /></div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-gray-500">Assigned Job</p><p className="font-medium text-gray-900 dark:text-zinc-100">{jobName(detail.card)}</p></div>
              <div><p className="text-xs text-gray-500">Hours Today</p><p className="font-medium tabular-nums text-gray-900 dark:text-zinc-100">{fmtHours(detail.card.totalMinutes)}</p></div>
              <div><p className="text-xs text-gray-500">Arrived</p><p className="font-medium tabular-nums text-gray-900 dark:text-zinc-100">{fmtTime(detail.card.clockInAt)}</p></div>
              <div><p className="text-xs text-gray-500">Left</p><p className="font-medium tabular-nums text-gray-900 dark:text-zinc-100">{fmtTime(detail.card.clockOutAt)}</p></div>
            </div>
            <div className="mt-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Note</p>
              <textarea
                defaultValue={detail.card.notes}
                onBlur={(e) => { if (e.target.value !== detail.card.notes) patch(detail.card.id, { notes: e.target.value }); }}
                className="h-16 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-[#050505] dark:text-zinc-100"
                placeholder="Add a note…"
              />
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={savingId === detail.card.id} onClick={() => patch(detail.card.id, { action: 'approve' })} className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Approve</button>
              <button type="button" disabled={savingId === detail.card.id} onClick={() => patch(detail.card.id, { action: 'reject' })} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50 dark:border-red-900/50 dark:text-red-300">Reject</button>
            </div>
            <div className="mt-5">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Timeline</p>
              <div className="space-y-2">
                {detail.events.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-zinc-400">No events recorded.</p>
                ) : detail.events.map((ev) => (
                  <div key={ev.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-zinc-800">
                    <span className="text-gray-800 dark:text-zinc-200">{String(ev.eventType || '').replace(/_/g, ' ')}</span>
                    <span className="tabular-nums text-gray-500 dark:text-zinc-400">{ev.occurredAt ? new Date(ev.occurredAt).toLocaleString() : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
