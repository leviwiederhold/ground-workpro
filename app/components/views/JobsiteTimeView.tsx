/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ATTENDANCE_STATUS_LABEL, deriveAttendanceStatus, formatAssignedJobSubtitle, type AttendanceDisplayStatus } from '@/lib/jobsite-time/domain';
import { AttendanceDiagnosticsPanel } from '@/app/components/debug/AttendanceDiagnosticsPanel';

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
const minutesSince = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)) : 0);

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] || 'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300'}`}>
      {statusLabel(status)}
    </span>
  );
}

const ROSTER_STATUS_STYLES: Record<AttendanceDisplayStatus, string> = {
  no_job: 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400',
  address_needs_verification: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
  waiting: 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400',
  checked_in: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
  checked_out: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  needs_review: 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300',
  missing_clock_out: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
};

function RosterBadge({ status }: { status: AttendanceDisplayStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ROSTER_STATUS_STYLES[status]}`}>
      {ATTENDANCE_STATUS_LABEL[status]}
    </span>
  );
}

export function JobsiteTimeView({
  employees = [],
  jobs = [],
}: {
  employees?: Array<{ id: string; name?: string; user_id?: string | null; role?: string; jobId?: any; jobName?: string | null; status?: string }>;
  jobs?: Array<{ id: string; name?: string; address_verified?: boolean }>;
}) {
  const [items, setItems] = useState<Timecard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ card: Timecard; events: any[] } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ from: '', to: '', employee: 'all', job: 'all', status: 'all', needsReview: false });
  // Opt-in internal diagnostics: this view is already admin/pm-gated by route
  // guards; the ?debug=attendance flag keeps the panel out of the way otherwise.
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const flag = new URLSearchParams(window.location.search).get('debug');
    setShowDiagnostics(flag === 'attendance' || process.env.NODE_ENV !== 'production');
  }, []);

  const nameByUser = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) {
      if (e.user_id) m.set(String(e.user_id), String(e.name || 'Team member'));
      m.set(String(e.id), String(e.name || 'Team member'));
    }
    return m;
  }, [employees]);
  const jobById = useMemo(() => {
    const m = new Map<string, { id: string; name?: string; address_verified?: boolean }>();
    for (const j of jobs) m.set(String(j.id), j);
    return m;
  }, [jobs]);
  const jobName = (jobId: string | null) => (jobId && jobById.get(String(jobId))?.name) || 'Unassigned';
  const empName = (t: Timecard) => nameByUser.get(String(t.userId || t.employeeId || '')) || 'Team member';

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

  // Employee attendance roster — always computed when there are employees, even
  // before any timecards exist. Statuses/hours are derived from real timecards;
  // no fabricated time. Assigned job comes from the employee's jobId if present.
  const activeEmployees = useMemo(
    () => employees.filter((e) => !['inactive', 'deleted', 'archived', 'removed'].includes(String(e.status || '').toLowerCase())),
    [employees]
  );

  const roster = useMemo(() => {
    const today = todayStr();
    const weekStart = (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10); })();
    const cardsFor = (e: { id: string; user_id?: string | null }) =>
      items.filter((t) => String(t.userId || '') === String(e.user_id || ' ') || String(t.employeeId || '') === String(e.id));

    return activeEmployees.map((e) => {
      const cards = cardsFor(e);
      const todayCard = cards.find((c) => c.workDate === today) || null;
      const weekMinutes = cards.filter((c) => c.workDate && c.workDate >= weekStart).reduce((sum, c) => sum + (c.totalMinutes || 0), 0);
      const lastCard = cards.slice().sort((a, b) =>
        Date.parse(b.clockOutAt || b.clockInAt || '0') - Date.parse(a.clockOutAt || a.clockInAt || '0'))[0] || null;
      const hasStaleOpenCard = !todayCard && cards.some((c) => c.clockInAt && !c.clockOutAt && c.workDate && c.workDate < today);

      const assignedJob = e.jobId != null && e.jobId !== '' ? jobById.get(String(e.jobId)) || null : null;
      // Prefer the job name hydrated by the API; fall back to the jobs prop
      // lookup. Either counts as "has an assigned job".
      const assignedJobName = (e.jobName && String(e.jobName).trim()) || assignedJob?.name || '';
      const hasAssignedJob = Boolean(assignedJobName) || (e.jobId != null && e.jobId !== '');
      const status = deriveAttendanceStatus({
        hasAssignedJob,
        assignedJobAddressVerified: Boolean(assignedJob?.address_verified),
        todayCard: todayCard ? { clockInAt: todayCard.clockInAt, clockOutAt: todayCard.clockOutAt, status: todayCard.status } : null,
        hasStaleOpenCard,
      });

      const hoursSoFarMin = todayCard?.clockInAt && !todayCard.clockOutAt
        ? minutesSince(todayCard.clockInAt)
        : (todayCard?.totalMinutes ?? 0);

      // Roster subtitle: "{roleLabel} - {jobName}" (e.g. "PM - Smith Excavation").
      const rosterSubtitle = formatAssignedJobSubtitle({ role: e.role, jobName: assignedJobName, jobId: e.jobId });
      const lastActivity = lastCard ? (lastCard.clockOutAt || lastCard.clockInAt) : null;
      return { e, cards, todayCard, lastCard, weekMinutes, status, rosterSubtitle, lastActivity, hoursSoFarMin };
    });
  }, [activeEmployees, items, jobById]);

  const onSite = useMemo(() => roster.filter((r) => r.status === 'checked_in'), [roster]);
  const notArrived = useMemo(() => roster.filter((r) => r.status === 'waiting' || r.status === 'address_needs_verification'), [roster]);
  const recentlyLeft = useMemo(
    () => roster.filter((r) => r.status === 'checked_out').sort((a, b) => Date.parse(b.lastActivity || '0') - Date.parse(a.lastActivity || '0')),
    [roster]
  );

  const summary = useMemo(() => {
    const hoursTodayMin = onSite.reduce((s, r) => s + r.hoursSoFarMin, 0) +
      roster.filter((r) => r.status === 'checked_out' || r.status === 'needs_review').reduce((s, r) => s + (r.todayCard?.totalMinutes || 0), 0);
    return {
      onSite: onSite.length,
      pendingReview: roster.filter((r) => r.status === 'needs_review').length,
      missingArrival: notArrived.filter((r) => r.status === 'waiting').length,
      missingClockOut: roster.filter((r) => r.status === 'missing_clock_out').length,
      hoursTodayMin,
    };
  }, [onSite, roster, notArrived]);

  // Today's Activity — arrivals/departures plus items flagged for review.
  const recentActivity = useMemo(() => {
    const events: Array<{ key: string; t: Timecard; label: string; icon: string; tone: string; at: string }> = [];
    for (const t of items) {
      const name = nameByUser.get(String(t.userId || t.employeeId || '')) || 'Team member';
      const job = (t.jobId && jobById.get(String(t.jobId))?.name) || 'Unassigned';
      if (t.clockInAt) events.push({ key: `${t.id}-in`, t, label: `${name} arrived at ${job}`, icon: 'fa-arrow-right-to-bracket', tone: 'text-green-500', at: t.clockInAt });
      if (t.clockOutAt) events.push({ key: `${t.id}-out`, t, label: `${name} left ${job}`, icon: 'fa-arrow-right-from-bracket', tone: 'text-amber-500', at: t.clockOutAt });
      if (t.status === 'needs_review' && t.workDate === todayStr()) {
        events.push({
          key: `${t.id}-review`,
          t,
          label: `${name} needs review — ${t.confidence === 'low' ? 'low GPS accuracy' : 'unconfirmed location'}`,
          icon: 'fa-triangle-exclamation',
          tone: 'text-orange-500',
          at: t.clockInAt || t.clockOutAt || t.workDate || new Date().toISOString(),
        });
      }
    }
    events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return events.slice(0, 10);
  }, [items, nameByUser, jobById]);

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
    { label: 'On Site', value: summary.onSite, icon: 'fa-user-check', tone: 'text-green-600 dark:text-green-400' },
    { label: 'Pending Review', value: summary.pendingReview, icon: 'fa-clipboard-check', tone: 'text-amber-600 dark:text-amber-400' },
    { label: 'Missing Arrival', value: summary.missingArrival, icon: 'fa-user-clock', tone: 'text-gray-500 dark:text-zinc-400' },
    { label: 'Missing Clock-Out', value: summary.missingClockOut, icon: 'fa-triangle-exclamation', tone: 'text-orange-600 dark:text-orange-400' },
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
          <p className="text-sm text-gray-500 dark:text-zinc-400">Live workforce status — who&apos;s on site, who&apos;s missing, who needs a look.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-[#111]"
        >
          <i className="fa-solid fa-sliders text-xs" /> Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
      </div>

      <AttendanceDiagnosticsPanel enabled={showDiagnostics} />

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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
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
      ) : activeEmployees.length === 0 && items.length === 0 ? (
        <div className={cardCls}>{emptyState}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* On Site */}
          <div className={cardCls}>
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">On Site ({onSite.length})</h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {onSite.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">No one is checked in right now.</p>
              ) : onSite.map((r) => (
                <div key={r.e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-zinc-100">{r.e.name || 'Team member'}</p>
                    <p className="truncate text-xs text-gray-500 dark:text-zinc-400">{r.rosterSubtitle} · Arrived {fmtTime(r.todayCard?.clockInAt ?? null)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs tabular-nums text-gray-600 dark:text-zinc-300">{fmtHours(r.hoursSoFarMin)} so far</span>
                    <RosterBadge status={r.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Not Arrived / Missing Arrival */}
          <div className={cardCls}>
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Not Arrived ({notArrived.length})</h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {notArrived.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">Everyone assigned today has arrived.</p>
              ) : notArrived.map((r) => (
                <div key={r.e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-zinc-100">{r.e.name || 'Team member'}</p>
                    <p className="truncate text-xs text-gray-500 dark:text-zinc-400">{r.rosterSubtitle}</p>
                  </div>
                  <RosterBadge status={r.status} />
                </div>
              ))}
            </div>
          </div>

          {/* Recently Left / Checked Out */}
          <div className={cardCls}>
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Recently Left ({recentlyLeft.length})</h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {recentlyLeft.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">No one has checked out yet today.</p>
              ) : recentlyLeft.map((r) => (
                <button
                  key={r.e.id}
                  type="button"
                  onClick={() => r.todayCard && openDetail(r.todayCard)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-[#101010]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-zinc-100">{r.e.name || 'Team member'}</p>
                    <p className="truncate text-xs text-gray-500 dark:text-zinc-400">{r.rosterSubtitle} · Left {fmtTime(r.todayCard?.clockOutAt ?? null)}</p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-gray-600 dark:text-zinc-300">{fmtHours(r.todayCard?.totalMinutes ?? 0)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Today's Activity */}
          <div className={cardCls}>
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Today&apos;s Activity</h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {recentActivity.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">No activity recorded yet today.</p>
              ) : recentActivity.map((ev) => (
                <button key={ev.key} type="button" onClick={() => openDetail(ev.t)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-[#101010]">
                  <span className="min-w-0 truncate text-sm text-gray-800 dark:text-zinc-200">
                    <i className={`fa-solid ${ev.icon} ${ev.tone} mr-1.5`} />
                    {ev.label}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-zinc-400">{fmtTime(ev.at)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Needs Review */}
          {needsReview.length > 0 && (
          <div className={`${cardCls} lg:col-span-2`}>
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Needs Review ({needsReview.length})</h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {needsReview.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-zinc-100">{empName(t)}</p>
                    <p className="truncate text-xs text-gray-500 dark:text-zinc-400">
                      {jobName(t.jobId)} · Arrived {fmtTime(t.clockInAt)} · Left {fmtTime(t.clockOutAt)} · {fmtHours(t.totalMinutes)}
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
          )}
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
              <div><p className="text-xs text-gray-500">Assigned Job</p><p className="font-medium text-gray-900 dark:text-zinc-100">{jobName(detail.card.jobId)}</p></div>
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
