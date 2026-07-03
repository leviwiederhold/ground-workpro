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
  active: 'bg-blue-100 text-blue-800',
  pending_review: 'bg-amber-100 text-amber-800',
  needs_review: 'bg-orange-100 text-orange-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};
const CONF_STYLES: Record<string, string> = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-red-100 text-red-700',
};

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString() : '—');
const fmtHours = (min: number) => (min > 0 ? `${(min / 60).toFixed(2)} h` : '—');

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
  const [filters, setFilters] = useState({
    from: '',
    to: '',
    employee: 'all',
    job: 'all',
    status: 'all',
    confidence: 'all',
    source: 'all',
    quick: 'all', // needsReview | missingClockOut | lateArrival | earlyDeparture | approved | unapproved
  });

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
      if (filters.confidence !== 'all') p.set('confidence', filters.confidence);
      if (filters.source !== 'all') p.set('source', filters.source);
      if (filters.quick === 'needsReview') p.set('needsReview', '1');
      if (filters.quick === 'missingClockOut') p.set('missingClockOut', '1');
      if (filters.quick === 'lateArrival') p.set('lateArrival', '1');
      if (filters.quick === 'earlyDeparture') p.set('earlyDeparture', '1');
      if (filters.quick === 'approved') p.set('approved', '1');
      if (filters.quick === 'unapproved') p.set('unapproved', '1');
      const res = await fetch(`/api/jobsite-time/timecards?${p.toString()}`, { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error || 'Failed to load jobsite time');
        setItems([]);
        return;
      }
      setItems(json?.items || []);
    } catch {
      setError('Failed to load jobsite time');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const weekStart = startOfWeek.toISOString().slice(0, 10);
    let hoursTodayMin = 0;
    let pending = 0;
    let missing = 0;
    let late = 0;
    let approvedWeek = 0;
    for (const t of items) {
      if (t.workDate === today) hoursTodayMin += t.totalMinutes;
      if (t.status === 'pending_review' || t.status === 'needs_review') pending += 1;
      if (!t.clockOutAt) missing += 1;
      if (t.scheduledStart && t.clockInAt && Date.parse(t.clockInAt) > Date.parse(t.scheduledStart) + 5 * 60000) late += 1;
      if (t.status === 'approved' && t.workDate && t.workDate >= weekStart) approvedWeek += 1;
    }
    return { hoursTodayMin, pending, missing, late, approvedWeek };
  }, [items]);

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

  const cards: Array<[string, string | number]> = [
    ['Hours today', fmtHours(summary.hoursTodayMin)],
    ['Pending review', summary.pending],
    ['Missing clock-outs', summary.missing],
    ['Late arrivals', summary.late],
    ['Approved this week', summary.approvedWeek],
  ];

  const sel =
    'rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-900 dark:border-zinc-700 dark:bg-[#090909] dark:text-zinc-100';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100">Jobsite Time</h2>
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          Automatic arrival/departure time from assigned jobs. Only jobsite arrival and departure during scheduled shifts
          are recorded — never continuous location.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white p-3 dark:border-zinc-800 dark:bg-[#090909]">
            <p className="text-xs text-gray-500 dark:text-zinc-500">{label}</p>
            <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-zinc-100">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className={sel} aria-label="From date" />
        <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className={sel} aria-label="To date" />
        <select value={filters.employee} onChange={(e) => setFilters((f) => ({ ...f, employee: e.target.value }))} className={sel} aria-label="Employee">
          <option value="all">All employees</option>
          {employees.map((e) => (
            <option key={e.id} value={String(e.user_id || e.id)}>{e.name || 'Team member'}</option>
          ))}
        </select>
        <select value={filters.job} onChange={(e) => setFilters((f) => ({ ...f, job: e.target.value }))} className={sel} aria-label="Job">
          <option value="all">All jobs</option>
          {jobs.map((j) => (
            <option key={j.id} value={String(j.id)}>{j.name || 'Job'}</option>
          ))}
        </select>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className={sel} aria-label="Status">
          <option value="all">Any status</option>
          <option value="active">Active</option>
          <option value="pending_review">Pending review</option>
          <option value="needs_review">Needs review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select value={filters.confidence} onChange={(e) => setFilters((f) => ({ ...f, confidence: e.target.value }))} className={sel} aria-label="Confidence">
          <option value="all">Any confidence</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={filters.source} onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))} className={sel} aria-label="Source">
          <option value="all">Any source</option>
          <option value="jobsite_auto">Jobsite auto</option>
          <option value="manual">Manual</option>
          <option value="manager_adjusted">Manager adjusted</option>
        </select>
        <select value={filters.quick} onChange={(e) => setFilters((f) => ({ ...f, quick: e.target.value }))} className={sel} aria-label="Quick filter">
          <option value="all">All</option>
          <option value="needsReview">Needs review only</option>
          <option value="unapproved">Unapproved</option>
          <option value="approved">Approved</option>
          <option value="missingClockOut">Missing clock-out</option>
          <option value="lateArrival">Late arrival</option>
          <option value="earlyDeparture">Early departure</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-300">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-zinc-800">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-[#050505]">
              <tr>
                {['Employee', 'Job', 'Date', 'Arrival', 'Departure', 'Total', 'Status', 'Confidence', 'Source', 'Actions'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {loading ? (
                <tr><td colSpan={10} className="px-3 py-3 text-gray-500 dark:text-zinc-400">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-3 text-gray-500 dark:text-zinc-400">No jobsite time yet.</td></tr>
              ) : items.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-[#101010]">
                  <td className="whitespace-nowrap px-3 py-1.5 text-gray-900 dark:text-zinc-100">{nameByUser.get(String(t.userId || t.employeeId || '')) || 'Team member'}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-gray-600 dark:text-zinc-300">{jobNameById.get(String(t.jobId || '')) || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-gray-600 dark:text-zinc-300">{fmtDate(t.workDate)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-gray-700 dark:text-zinc-300">{fmtTime(t.clockInAt)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-gray-700 dark:text-zinc-300">{fmtTime(t.clockOutAt)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums font-medium text-gray-900 dark:text-zinc-100">{fmtHours(t.totalMinutes)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status] || 'bg-gray-100 text-gray-700'}`}>{t.status.replace('_', ' ')}</span></td>
                  <td className="whitespace-nowrap px-3 py-1.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONF_STYLES[t.confidence] || 'bg-gray-100 text-gray-700'}`}>{t.confidence}</span></td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-gray-600 dark:text-zinc-300">{t.source.replace('_', ' ')}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => openDetail(t)} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-[#111]">View</button>
                      <button type="button" disabled={savingId === t.id || t.status === 'approved'} onClick={() => patch(t.id, { action: 'approve' })} className="rounded-md border border-green-300 px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-40 dark:border-green-900/50 dark:text-green-300">Approve</button>
                      <button type="button" disabled={savingId === t.id || t.status === 'rejected'} onClick={() => patch(t.id, { action: 'reject' })} className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-900/50 dark:text-red-300">Reject</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex">
          <button type="button" aria-label="Close details" className="flex-1 bg-black/40" onClick={() => setDetail(null)} />
          <div className="h-full w-full max-w-md overflow-y-auto border-l border-gray-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-[#0b0b0b]">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-zinc-100">{nameByUser.get(String(detail.card.userId || '')) || 'Team member'}</h3>
              <button type="button" onClick={() => setDetail(null)} className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 dark:border-zinc-700 dark:text-zinc-300">Close</button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-gray-500">Job</p><p className="font-medium text-gray-900 dark:text-zinc-100">{jobNameById.get(String(detail.card.jobId || '')) || '—'}</p></div>
              <div><p className="text-xs text-gray-500">Date</p><p className="font-medium text-gray-900 dark:text-zinc-100">{fmtDate(detail.card.workDate)}</p></div>
              <div><p className="text-xs text-gray-500">Arrival</p><p className="font-medium tabular-nums text-gray-900 dark:text-zinc-100">{fmtTime(detail.card.clockInAt)}</p></div>
              <div><p className="text-xs text-gray-500">Departure</p><p className="font-medium tabular-nums text-gray-900 dark:text-zinc-100">{fmtTime(detail.card.clockOutAt)}</p></div>
              <div><p className="text-xs text-gray-500">Total</p><p className="font-medium tabular-nums text-gray-900 dark:text-zinc-100">{fmtHours(detail.card.totalMinutes)}</p></div>
              <div><p className="text-xs text-gray-500">Confidence</p><p className="font-medium text-gray-900 dark:text-zinc-100">{detail.card.confidence}</p></div>
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
              <button type="button" disabled={savingId === detail.card.id} onClick={() => patch(detail.card.id, { action: 'approve' })} className="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Approve</button>
              <button type="button" disabled={savingId === detail.card.id} onClick={() => patch(detail.card.id, { action: 'reject' })} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50 dark:border-red-900/50 dark:text-red-300">Reject / flag</button>
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
