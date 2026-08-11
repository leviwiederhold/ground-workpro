/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ATTENDANCE_STATUS_LABEL, deriveAttendanceStatus, formatAssignedJobSubtitle, getCompanyLocalDateKey, type AttendanceDisplayStatus } from '@/lib/jobsite-time/domain';
import { deriveCompanyBreakState, type CompanyBreakSchedule } from '@/lib/attendance/companyBreakSchedule';
import { formatAttendanceDateLabel, shiftAttendanceDateKey, timestampIsOnAttendanceDate } from '@/lib/attendance/dashboardDate';
import { AttendanceDiagnosticsPanel } from '@/app/components/debug/AttendanceDiagnosticsPanel';
import { AutoAttendanceSetupCard } from '@/app/components/views/AutoAttendanceSetupCard';
import { SETUP_PROBLEM_FIX, SETUP_PROBLEM_LABEL, type SetupHealthSummary, type SetupProblem } from '@/lib/attendance/setupHealth';
import { CORRECTION_TYPES, CORRECTION_TYPE_LABEL, describeCorrection, MIN_REASON_LENGTH, reconstructOriginal, type CorrectionRecord, type CorrectionType } from '@/lib/attendance/corrections';
import { EVENT_SOURCE_LABEL } from '@/lib/jobsite-time/domain';

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

type AttendanceActivityEvent = {
  id: string;
  timecardId: string | null;
  eventType: string;
  occurredAt: string | null;
  jobId: string | null;
  employeeId: string | null;
  userId: string | null;
  eventSource: string | null;
  validationResult: string | null;
  validationReason: string | null;
  notes: string;
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

const fmtTime = (iso: string | null, timezone: string) =>
  iso
    ? new Date(iso).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: timezone,
      })
    : '—';
const fmtHours = (min: number) => (min > 0 ? `${(min / 60).toFixed(1)} h` : '—');
const minutesSince = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)) : 0);

function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] || 'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300'}`}>{statusLabel(status)}</span>;
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
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ROSTER_STATUS_STYLES[status]}`}>{ATTENDANCE_STATUS_LABEL[status]}</span>;
}

export function JobsiteTimeView({
  employees = [],
  jobs = [],
}: {
  employees?: Array<{
    id: string;
    name?: string;
    user_id?: string | null;
    role?: string;
    jobId?: any;
    jobName?: string | null;
    status?: string;
  }>;
  jobs?: Array<{ id: string; name?: string; address_verified?: boolean }>;
}) {
  const [items, setItems] = useState<Timecard[]>([]);
  const [activity, setActivity] = useState<AttendanceActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ card: Timecard; events: any[] } | null>(null);
  // Correction history for the open timecard, and the correction form.
  const [corrections, setCorrections] = useState<CorrectionRecord[]>([]);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [correctionError, setCorrectionError] = useState('');
  const [correctionForm, setCorrectionForm] = useState<{
    correctionType: CorrectionType;
    reason: string;
    clockInAt: string;
    clockOutAt: string;
    jobId: string;
  }>({
    correctionType: 'incorrect_timestamp',
    reason: '',
    clockInAt: '',
    clockOutAt: '',
    jobId: '',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    employee: 'all',
    job: 'all',
    status: 'all',
    needsReview: false,
  });
  const [breakSchedule, setBreakSchedule] = useState<CompanyBreakSchedule | null>(null);
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [companyTimezone, setCompanyTimezone] = useState<string | null>(null);
  const [followingToday, setFollowingToday] = useState(true);
  // Opt-in internal diagnostics: this view is already admin/pm-gated by route
  // guards; the ?debug=attendance flag keeps the panel out of the way otherwise.
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const flag = new URLSearchParams(window.location.search).get('debug');
    setShowDiagnostics(flag === 'attendance' || process.env.NODE_ENV !== 'production');
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowIso(new Date().toISOString()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/company/settings', { cache: 'no-store' }).catch(() => null);
      if (cancelled || !res?.ok) return;
      const item = (await res.json().catch(() => null))?.item;
      if (!item) return;
      setBreakSchedule({
        startTime: item.attendance_break_start_time ?? null,
        endTime: item.attendance_break_end_time ?? null,
        returnGraceMinutes: Number(item.attendance_break_return_grace_minutes ?? 0),
        timezone: String(item.timezone || 'America/New_York'),
      });
    })();
    return () => {
      cancelled = true;
    };
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

  const activeFilterCount = (filters.employee !== 'all' ? 1 : 0) + (filters.job !== 'all' ? 1 : 0) + (filters.status !== 'all' ? 1 : 0) + (filters.needsReview ? 1 : 0);

  const requestedAttendanceDate = followingToday ? 'today' : (selectedDate ?? 'today');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const p = new URLSearchParams();
      p.set('date', requestedAttendanceDate);
      if (filters.employee !== 'all') p.set('employee', filters.employee);
      if (filters.job !== 'all') p.set('job', filters.job);
      if (filters.status !== 'all') p.set('status', filters.status);
      if (filters.needsReview) p.set('needsReview', '1');
      const res = await fetch(`/api/jobsite-time/timecards?${p.toString()}`, { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error || 'Failed to load attendance');
        setItems([]);
        setActivity([]);
        return;
      }
      setItems(json?.items || []);
      setActivity(json?.activity || []);
      if (json?.attendanceDate?.selectedDate) {
        setSelectedDate(String(json.attendanceDate.selectedDate));
      }
      if (json?.attendanceDate?.timezone) {
        setCompanyTimezone(String(json.attendanceDate.timezone));
      }
    } catch {
      setError('Failed to load attendance');
      setItems([]);
      setActivity([]);
    } finally {
      setLoading(false);
    }
  }, [filters, requestedAttendanceDate]);

  useEffect(() => {
    load();
  }, [load]);

  // Automatic-attendance setup health. Derived server-side from assignment,
  // jobsite verification, and device enrollment — so a manager finds out that
  // an employee's attendance will not record BEFORE payroll day, and without
  // that employee needing to have the app open.
  const [setupHealth, setSetupHealth] = useState<SetupHealthSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/attendance/setup-health', { cache: 'no-store' }).catch(() => null);
      if (cancelled || !res?.ok) return;
      const json = await res.json().catch(() => null);
      if (json) setSetupHealth(json);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Employee attendance roster — always computed when there are employees, even
  // before any timecards exist. Statuses/hours are derived from real timecards;
  // no fabricated time. Assigned job comes from the employee's jobId if present.
  const activeEmployees = useMemo(() => employees.filter((e) => !['inactive', 'deleted', 'archived', 'removed'].includes(String(e.status || '').toLowerCase())), [employees]);

  const timezone = companyTimezone || breakSchedule?.timezone || 'America/New_York';
  const today = getCompanyLocalDateKey(nowIso, timezone);
  const displayedDate = selectedDate || today;
  const isToday = displayedDate === today;
  const dayItems = useMemo(() => items.filter((card) => card.workDate === displayedDate), [items, displayedDate]);

  const selectDate = useCallback(
    (dateKey: string) => {
      setSelectedDate(dateKey);
      setFollowingToday(dateKey === today);
    },
    [today]
  );

  const selectPreviousDate = useCallback(() => {
    selectDate(shiftAttendanceDateKey(displayedDate, -1));
  }, [displayedDate, selectDate]);

  const selectNextDate = useCallback(() => {
    const next = shiftAttendanceDateKey(displayedDate, 1);
    if (next <= today) selectDate(next);
  }, [displayedDate, selectDate, today]);

  const selectToday = useCallback(() => {
    setSelectedDate(today);
    setFollowingToday(true);
  }, [today]);

  // Keep the live view pinned to the company's Today across its local
  // midnight. Historical selections remain fixed until the user moves them.
  useEffect(() => {
    if (!followingToday || !selectedDate || selectedDate === today) return;
    setSelectedDate(today);
    void load();
  }, [followingToday, selectedDate, today, load]);

  const roster = useMemo(() => {
    const cardsFor = (e: { id: string; user_id?: string | null }) => dayItems.filter((t) => String(t.userId || '') === String(e.user_id || ' ') || String(t.employeeId || '') === String(e.id));

    return activeEmployees.map((e) => {
      const cards = cardsFor(e);
      const dateCards = cards.sort((a, b) => Date.parse(b.clockInAt || b.clockOutAt || '0') - Date.parse(a.clockInAt || a.clockOutAt || '0'));
      const dateCard = dateCards[0] || null;
      const lastCard = dateCard;
      const hasStaleOpenCard = displayedDate < today && dateCards.some((c) => c.clockInAt && !c.clockOutAt);

      const assignedJob = e.jobId != null && e.jobId !== '' ? jobById.get(String(e.jobId)) || null : null;
      // Prefer the job name hydrated by the API; fall back to the jobs prop
      // lookup. Either counts as "has an assigned job".
      const assignedJobName = (e.jobName && String(e.jobName).trim()) || assignedJob?.name || '';
      const hasAssignedJob = Boolean(assignedJobName) || (e.jobId != null && e.jobId !== '');
      const status = deriveAttendanceStatus({
        hasAssignedJob,
        assignedJobAddressVerified: Boolean(assignedJob?.address_verified),
        todayCard: dateCard
          ? {
              clockInAt: dateCard.clockInAt,
              clockOutAt: dateCard.clockOutAt,
              status: dateCard.status,
            }
          : null,
        hasStaleOpenCard,
      });

      const hoursSoFarMin = dateCards.reduce((sum, card) => sum + (isToday && card.clockInAt && !card.clockOutAt ? minutesSince(card.clockInAt) : card.totalMinutes || 0), 0);
      const breakState = breakSchedule
        ? deriveCompanyBreakState({
            now: nowIso,
            workDate: displayedDate,
            schedule: breakSchedule,
            sessions: dateCards,
          })
        : { status: 'none' as const, departureAt: null, returnAt: null, returnDueAt: null };

      // Roster subtitle: "{roleLabel} - {jobName}" (e.g. "PM - Smith Excavation").
      const rosterSubtitle = formatAssignedJobSubtitle({
        role: e.role,
        jobName: assignedJobName,
        jobId: e.jobId,
      });
      const lastActivity = lastCard ? lastCard.clockOutAt || lastCard.clockInAt : null;
      return {
        e,
        cards,
        dateCards,
        dateCard,
        lastCard,
        status,
        breakState,
        rosterSubtitle,
        lastActivity,
        hoursSoFarMin,
      };
    });
  }, [activeEmployees, dayItems, jobById, breakSchedule, nowIso, displayedDate, today, isToday]);

  const onSite = useMemo(() => roster.filter((r) => r.status === 'checked_in'), [roster]);
  const notArrived = useMemo(() => roster.filter((r) => r.status === 'waiting' || r.status === 'address_needs_verification'), [roster]);
  const recentlyLeft = useMemo(() => roster.filter((r) => r.status === 'checked_out').sort((a, b) => Date.parse(b.lastActivity || '0') - Date.parse(a.lastActivity || '0')), [roster]);
  const breakExceptions = useMemo(() => roster.filter((r) => r.breakState.status === 'not_returned' || r.breakState.status === 'returned_late'), [roster]);

  const summary = useMemo(() => {
    // Sum every session for the selected date, including split shifts. The old
    // latest-card-only total undercounted employees who left and returned.
    const hoursTodayMin = roster.reduce((sum, row) => sum + row.hoursSoFarMin, 0);
    return {
      onSite: onSite.length,
      pendingReview: roster.filter((r) => r.status === 'needs_review').length,
      missingArrival: notArrived.filter((r) => r.status === 'waiting').length,
      missingClockOut: roster.filter((r) => r.status === 'missing_clock_out').length,
      hoursTodayMin,
    };
  }, [onSite, roster, notArrived]);

  // The API queries the append-only event trail using the selected company-day
  // UTC bounds. Keep the same boundary check here as a defense against a bad or
  // stale response ever leaking an older event into the visible date.
  const recentActivity = useMemo(() => {
    const arrivalTypes = new Set(['entered_geofence', 'auto_clock_in', 'scheduled_clock_in', 'clock_in_backfilled']);
    const departureTypes = new Set(['exited_geofence', 'auto_clock_out', 'fallback_clock_out', 'departure_pending']);
    const cardsById = new Map(dayItems.map((card) => [card.id, card]));
    const events: Array<{
      key: string;
      t: Timecard | null;
      label: string;
      detail: string | null;
      icon: string;
      tone: string;
      at: string;
    }> = [];
    for (const event of activity) {
      if (!timestampIsOnAttendanceDate(event.occurredAt, displayedDate, timezone)) continue;
      const name = nameByUser.get(String(event.userId || event.employeeId || '')) || 'Team member';
      const job = (event.jobId && jobById.get(String(event.jobId))?.name) || 'Unassigned';
      const readableType = event.eventType.replace(/_/g, ' ');
      const isArrival = arrivalTypes.has(event.eventType);
      const isDeparture = departureTypes.has(event.eventType);
      events.push({
        key: event.id,
        t: event.timecardId ? (cardsById.get(event.timecardId) ?? null) : null,
        label: isArrival ? `${name} arrived at ${job}` : isDeparture ? `${name} left ${job}` : `${name} — ${readableType}`,
        detail: event.validationResult && event.validationResult !== 'accepted' ? event.validationResult : event.eventSource ? (EVENT_SOURCE_LABEL[event.eventSource] ?? event.eventSource) : null,
        icon: isArrival ? 'fa-arrow-right-to-bracket' : isDeparture ? 'fa-arrow-right-from-bracket' : event.validationResult && event.validationResult !== 'accepted' ? 'fa-triangle-exclamation' : 'fa-clock-rotate-left',
        tone: isArrival ? 'text-green-500' : isDeparture ? 'text-amber-500' : event.validationResult && event.validationResult !== 'accepted' ? 'text-orange-500' : 'text-blue-500',
        at: event.occurredAt!,
      });
    }
    events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return events;
  }, [activity, dayItems, nameByUser, jobById, displayedDate, timezone]);

  const needsReview = useMemo(() => dayItems.filter((t) => t.status === 'needs_review' || t.status === 'pending_review'), [dayItems]);

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
    setCorrections([]);
    setCorrectionOpen(false);
    setCorrectionError('');
    const [res, corrRes] = await Promise.all([
      fetch(`/api/jobsite-time/timecards/${card.id}`, { cache: 'no-store' }),
      fetch(`/api/attendance/corrections?timecardId=${encodeURIComponent(card.id)}`, {
        cache: 'no-store',
      }).catch(() => null),
    ]);
    const json = await res.json().catch(() => null);
    if (res.ok) setDetail({ card: json.item, events: json.events || [] });
    if (corrRes?.ok) setCorrections(((await corrRes.json().catch(() => null))?.items ?? []) as CorrectionRecord[]);
  };

  const submitCorrection = async () => {
    if (!detail) return;
    setCorrectionSaving(true);
    setCorrectionError('');
    try {
      const values: Record<string, unknown> = {};
      if (correctionForm.clockInAt) values.clockInAt = new Date(correctionForm.clockInAt).toISOString();
      if (correctionForm.clockOutAt) values.clockOutAt = new Date(correctionForm.clockOutAt).toISOString();
      if (correctionForm.jobId) values.jobId = correctionForm.jobId;

      const res = await fetch('/api/attendance/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timecardId: detail.card.id,
          correctionType: correctionForm.correctionType,
          reason: correctionForm.reason,
          values,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const details = json?.details ? Object.values(json.details).join(' ') : '';
        setCorrectionError(details || json?.error || 'Could not record the correction');
        return;
      }
      setItems((prev) => prev.map((t) => (t.id === detail.card.id ? { ...t, ...json.item } : t)));
      setDetail((d) => (d ? { ...d, card: { ...d.card, ...json.item } } : d));
      setCorrections((prev) => [...prev, json.correction]);
      setCorrectionOpen(false);
      setCorrectionForm({
        correctionType: 'incorrect_timestamp',
        reason: '',
        clockInAt: '',
        clockOutAt: '',
        jobId: '',
      });
      await load();
    } finally {
      setCorrectionSaving(false);
    }
  };

  const cards = [
    {
      label: 'On Site',
      value: summary.onSite,
      icon: 'fa-user-check',
      tone: 'text-green-600 dark:text-green-400',
    },
    {
      label: 'Pending Review',
      value: summary.pendingReview,
      icon: 'fa-clipboard-check',
      tone: 'text-amber-600 dark:text-amber-400',
    },
    {
      label: 'Missing Arrival',
      value: summary.missingArrival,
      icon: 'fa-user-clock',
      tone: 'text-gray-500 dark:text-zinc-400',
    },
    {
      label: 'Missing Clock-Out',
      value: summary.missingClockOut,
      icon: 'fa-triangle-exclamation',
      tone: 'text-orange-600 dark:text-orange-400',
    },
    {
      label: isToday ? 'Hours Today' : 'Hours',
      value: fmtHours(summary.hoursTodayMin),
      icon: 'fa-clock',
      tone: 'text-blue-600 dark:text-blue-400',
    },
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
          <p className="text-sm text-gray-500 dark:text-zinc-400">{isToday ? 'Live workforce status — who’s on site, who’s missing, who needs a look.' : `Attendance history for ${formatAttendanceDateLabel(displayedDate)}.`}</p>
        </div>
        <button type="button" onClick={() => setShowFilters((v) => !v)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-[#111]">
          <i className="fa-solid fa-sliders text-xs" /> Filters
          {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
      </div>

      <div className={`${cardCls} flex flex-wrap items-center justify-between gap-3 p-3`}>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-zinc-400">Attendance date</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{isToday ? 'Today' : formatAttendanceDateLabel(displayedDate)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={selectPreviousDate} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-[#111]">
            <i className="fa-solid fa-chevron-left text-xs" /> Previous day
          </button>
          <button type="button" onClick={selectNextDate} disabled={isToday} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-[#111]">
            Next day <i className="fa-solid fa-chevron-right text-xs" />
          </button>
          <input
            type="date"
            aria-label="Attendance date"
            value={displayedDate}
            max={today}
            onChange={(event) => {
              if (event.target.value) selectDate(event.target.value);
            }}
            className={sel}
          />
          <button type="button" onClick={selectToday} disabled={isToday && followingToday} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50">
            Today
          </button>
        </div>
      </div>

      {/* The summary and warning below consume the same server-built employee
          population and readiness evaluation. Never reintroduce a second
          permission-only fetch here: it produced contradictory 0/0 and 0/1
          counts beside a separate warning for the same employee. */}
      {isToday && <AutoAttendanceSetupCard items={setupHealth?.items ?? null} />}

      {/* Broken automatic-attendance setup. Shown above the roster because an
          employee whose phone cannot report is invisible in every panel below
          — they look like they simply haven't arrived. */}
      {isToday && setupHealth && setupHealth.brokenCount > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 px-4 py-3 dark:border-amber-900/40">
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              <i className="fa-solid fa-triangle-exclamation mr-1.5" />
              Automatic attendance needs setup ({setupHealth.brokenCount})
            </h3>
            <p className="text-xs text-amber-800 dark:text-amber-300">
              {setupHealth.healthyCount} {setupHealth.healthyCount === 1 ? 'employee is' : 'employees are'} set up correctly
            </p>
          </div>
          <div className="divide-y divide-amber-200 dark:divide-amber-900/40">
            {setupHealth.items
              .filter((item) => !item.healthy)
              .map((item) => (
                <div key={item.employeeId} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-amber-950 dark:text-amber-100">{item.name}</p>
                    {item.jobName && <p className="text-xs text-amber-800 dark:text-amber-300">{item.jobName}</p>}
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {item.problems.map((problem: SetupProblem) => (
                      <li key={problem} className="text-xs text-amber-900 dark:text-amber-200">
                        <span className="font-medium">{SETUP_PROBLEM_LABEL[problem]}</span>
                        {' — '}
                        <span className="opacity-80">{SETUP_PROBLEM_FIX[problem]}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
          <p className="border-t border-amber-200 px-4 py-2 text-[11px] text-amber-700 dark:border-amber-900/40 dark:text-amber-400">Setup status only — this shows whether attendance can be recorded, never where anyone is.</p>
        </div>
      )}

      {isToday && <AttendanceDiagnosticsPanel enabled={showDiagnostics} />}

      {showFilters && (
        <div className={`${cardCls} flex flex-wrap items-center gap-2 p-3`}>
          <select value={filters.employee} onChange={(e) => setFilters((f) => ({ ...f, employee: e.target.value }))} className={sel} aria-label="Employee">
            <option value="all">All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={String(e.user_id || e.id)}>
                {e.name || 'Team member'}
              </option>
            ))}
          </select>
          <select value={filters.job} onChange={(e) => setFilters((f) => ({ ...f, job: e.target.value }))} className={sel} aria-label="Job">
            <option value="all">All jobs</option>
            {jobs.map((j) => (
              <option key={j.id} value={String(j.id)}>
                {j.name || 'Job'}
              </option>
            ))}
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

      {breakExceptions.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20">
          <div className="border-b border-amber-200 px-4 py-3 dark:border-amber-900/40">
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">Break exceptions ({breakExceptions.length})</h3>
          </div>
          <div className="divide-y divide-amber-200 dark:divide-amber-900/40">
            {breakExceptions.map((r) => (
              <div key={r.e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-amber-950 dark:text-amber-100">{r.e.name || 'Team member'}</p>
                  <p className="text-xs text-amber-800 dark:text-amber-300">{r.rosterSubtitle}</p>
                </div>
                <p className="text-xs font-medium text-amber-900 dark:text-amber-200">{r.breakState.status === 'not_returned' ? `Not returned from break · due ${fmtTime(r.breakState.returnDueAt, timezone)}` : `Returned late from break · ${fmtTime(r.breakState.returnAt, timezone)}`}</p>
              </div>
            ))}
          </div>
        </div>
      )}

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
              ) : (
                onSite.map((r) => (
                  <div key={r.e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-zinc-100">{r.e.name || 'Team member'}</p>
                      <p className="truncate text-xs text-gray-500 dark:text-zinc-400">
                        {r.rosterSubtitle} · Arrived {fmtTime(r.dateCard?.clockInAt ?? null, timezone)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs tabular-nums text-gray-600 dark:text-zinc-300">{fmtHours(r.hoursSoFarMin)} so far</span>
                      <RosterBadge status={r.status} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Not Arrived / Missing Arrival */}
          <div className={cardCls}>
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Not Arrived ({notArrived.length})</h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {notArrived.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">{isToday ? 'Everyone assigned today has arrived.' : 'No missing arrival for this date.'}</p>
              ) : (
                notArrived.map((r) => (
                  <div key={r.e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-zinc-100">{r.e.name || 'Team member'}</p>
                      <p className="truncate text-xs text-gray-500 dark:text-zinc-400">{r.rosterSubtitle}</p>
                    </div>
                    <RosterBadge status={r.status} />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Recently Left / Checked Out */}
          <div className={cardCls}>
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Recently Left ({recentlyLeft.length})</h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {recentlyLeft.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">{isToday ? 'No one has checked out yet today.' : 'No departures recorded for this date.'}</p>
              ) : (
                recentlyLeft.map((r) => (
                  <button key={r.e.id} type="button" onClick={() => r.dateCard && openDetail(r.dateCard)} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-[#101010]">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-zinc-100">{r.e.name || 'Team member'}</p>
                      <p className="truncate text-xs text-gray-500 dark:text-zinc-400">
                        {r.rosterSubtitle} · {r.breakState.status === 'expected_break' ? 'Scheduled break since' : 'Left'} {fmtTime(r.dateCard?.clockOutAt ?? null, timezone)}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-gray-600 dark:text-zinc-300">{fmtHours(r.dateCard?.totalMinutes ?? 0)}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Selected-date activity */}
          <div className={cardCls}>
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{isToday ? 'Today’s Activity' : 'Activity'}</h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {recentActivity.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">{isToday ? 'No activity recorded yet today.' : 'No activity recorded for this date.'}</p>
              ) : (
                recentActivity.map((ev) => {
                  const content = (
                    <>
                      <span className="min-w-0 truncate text-sm text-gray-800 dark:text-zinc-200">
                        <i className={`fa-solid ${ev.icon} ${ev.tone} mr-1.5`} />
                        {ev.label}
                        {ev.detail && <span className="ml-1.5 text-xs text-gray-500 dark:text-zinc-400">· {ev.detail}</span>}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-zinc-400">{fmtTime(ev.at, timezone)}</span>
                    </>
                  );
                  return ev.t ? (
                    <button key={ev.key} type="button" onClick={() => openDetail(ev.t!)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-[#101010]">
                      {content}
                    </button>
                  ) : (
                    <div key={ev.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      {content}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Every session for the selected date. This is deliberately not a
              "latest card" view: split shifts and return visits remain visible
              in historical attendance. */}
          <div className={`${cardCls} lg:col-span-2`}>
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Attendance sessions ({dayItems.length})</h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {dayItems.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">No sessions recorded for this date.</p>
              ) : (
                dayItems
                  .slice()
                  .sort((a, b) => Date.parse(b.clockInAt || b.clockOutAt || '0') - Date.parse(a.clockInAt || a.clockOutAt || '0'))
                  .map((card) => (
                    <button key={card.id} type="button" onClick={() => openDetail(card)} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-[#101010]">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-zinc-100">{empName(card)}</p>
                        <p className="truncate text-xs text-gray-500 dark:text-zinc-400">
                          {jobName(card.jobId)} · {fmtTime(card.clockInAt, timezone)} – {fmtTime(card.clockOutAt, timezone)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs tabular-nums text-gray-600 dark:text-zinc-300">{fmtHours(card.totalMinutes)}</span>
                        <StatusBadge status={card.status} />
                      </div>
                    </button>
                  ))
              )}
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
                        {jobName(t.jobId)} · Arrived {fmtTime(t.clockInAt, timezone)} · Left {fmtTime(t.clockOutAt, timezone)} · {fmtHours(t.totalMinutes)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={t.status} />
                      <button type="button" disabled={savingId === t.id} onClick={() => patch(t.id, { action: 'approve' })} className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                        Approve
                      </button>
                      <button type="button" onClick={() => openDetail(t)} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-[#111]">
                        Review
                      </button>
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
              <button type="button" onClick={() => setDetail(null)} className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 dark:border-zinc-700 dark:text-zinc-300">
                Close
              </button>
            </div>
            <div className="mb-3">
              <StatusBadge status={detail.card.status} />
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-gray-500">Assigned Job</p>
                <p className="font-medium text-gray-900 dark:text-zinc-100">{jobName(detail.card.jobId)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Hours</p>
                <p className="font-medium tabular-nums text-gray-900 dark:text-zinc-100">{fmtHours(detail.card.totalMinutes)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Arrived</p>
                <p className="font-medium tabular-nums text-gray-900 dark:text-zinc-100">{fmtTime(detail.card.clockInAt, timezone)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Left</p>
                <p className="font-medium tabular-nums text-gray-900 dark:text-zinc-100">{fmtTime(detail.card.clockOutAt, timezone)}</p>
              </div>
            </div>
            <div className="mt-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Note</p>
              <textarea
                defaultValue={detail.card.notes}
                onBlur={(e) => {
                  if (e.target.value !== detail.card.notes) patch(detail.card.id, { notes: e.target.value });
                }}
                className="h-16 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-[#050505] dark:text-zinc-100"
                placeholder="Add a note…"
              />
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={savingId === detail.card.id} onClick={() => patch(detail.card.id, { action: 'approve' })} className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                Approve
              </button>
              {/* Voiding a record changes what someone is paid, so it goes
                  through the correction form (which requires a reason) rather
                  than a one-click status flip. */}
              <button
                type="button"
                onClick={() => {
                  setCorrectionForm((f) => ({
                    ...f,
                    correctionType: 'invalid_record',
                    reason: '',
                  }));
                  setCorrectionError('');
                  setCorrectionOpen(true);
                }}
                className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-900/50 dark:text-red-300"
              >
                Void…
              </button>
            </div>
            {/* Corrections. The effective record above is what payroll uses;
                this is how it got there. The original values are shown beside
                the corrected ones — a correction never replaces the history. */}
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Corrections{corrections.length > 0 ? ` (${corrections.length})` : ''}</p>
                <button type="button" onClick={() => setCorrectionOpen((v) => !v)} className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 dark:border-zinc-700 dark:text-zinc-200">
                  {correctionOpen ? 'Cancel' : 'Correct record'}
                </button>
              </div>

              {corrections.length > 0 && (
                <div className="mb-3 space-y-2">
                  {corrections.map((c) => (
                    <div key={c.id} className="rounded-lg border border-gray-200 px-3 py-2 text-xs dark:border-zinc-800">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-gray-900 dark:text-zinc-100">{CORRECTION_TYPE_LABEL[c.correctionType] ?? c.correctionType}</span>
                        <span className="tabular-nums text-gray-500 dark:text-zinc-400">{c.correctedAt ? new Date(c.correctedAt).toLocaleString([], { timeZone: timezone }) : '—'}</span>
                      </div>
                      {describeCorrection(c).map((diff) => (
                        <p key={diff.field} className="mt-0.5 text-gray-600 dark:text-zinc-400">
                          {diff.field}: <span className="line-through">{String(diff.from ?? '—')}</span>
                          {' → '}
                          <span className="font-medium text-gray-900 dark:text-zinc-100">{String(diff.to ?? '—')}</span>
                        </p>
                      ))}
                      <p className="mt-1 text-gray-700 dark:text-zinc-300">{c.reason}</p>
                    </div>
                  ))}
                  {/* The system's own answer, before any manager touched it. */}
                  {(() => {
                    const original = reconstructOriginal(
                      {
                        id: detail.card.id,
                        jobId: detail.card.jobId,
                        workDate: detail.card.workDate,
                        clockInAt: detail.card.clockInAt,
                        clockOutAt: detail.card.clockOutAt,
                        breakStartAt: detail.card.breakStartAt,
                        breakEndAt: detail.card.breakEndAt,
                        status: detail.card.status,
                      },
                      corrections
                    );
                    return (
                      <p className="text-xs text-gray-500 dark:text-zinc-400">
                        Originally recorded: {fmtTime(original.clockInAt, timezone)} – {fmtTime(original.clockOutAt, timezone)}
                      </p>
                    );
                  })()}
                </div>
              )}

              {correctionOpen && (
                <div className="mb-3 space-y-2 rounded-lg border border-gray-300 p-3 dark:border-zinc-700">
                  <select
                    value={correctionForm.correctionType}
                    onChange={(e) =>
                      setCorrectionForm((f) => ({
                        ...f,
                        correctionType: e.target.value as CorrectionType,
                      }))
                    }
                    className={`${sel} w-full`}
                    aria-label="Correction type"
                  >
                    {CORRECTION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {CORRECTION_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>

                  {correctionForm.correctionType !== 'duplicate_record' && correctionForm.correctionType !== 'invalid_record' && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-gray-600 dark:text-zinc-400">
                        Clock in
                        <input type="datetime-local" value={correctionForm.clockInAt} onChange={(e) => setCorrectionForm((f) => ({ ...f, clockInAt: e.target.value }))} className={`${sel} mt-0.5 w-full`} />
                      </label>
                      <label className="text-xs text-gray-600 dark:text-zinc-400">
                        Clock out
                        <input type="datetime-local" value={correctionForm.clockOutAt} onChange={(e) => setCorrectionForm((f) => ({ ...f, clockOutAt: e.target.value }))} className={`${sel} mt-0.5 w-full`} />
                      </label>
                    </div>
                  )}

                  {correctionForm.correctionType === 'incorrect_job' && (
                    <select value={correctionForm.jobId} onChange={(e) => setCorrectionForm((f) => ({ ...f, jobId: e.target.value }))} className={`${sel} w-full`} aria-label="Correct job">
                      <option value="">Select the correct job…</option>
                      {jobs.map((j) => (
                        <option key={j.id} value={String(j.id)}>
                          {j.name || 'Job'}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Required. A correction with no explanation is
                      indistinguishable from tampering when read back later. */}
                  <textarea value={correctionForm.reason} onChange={(e) => setCorrectionForm((f) => ({ ...f, reason: e.target.value }))} placeholder={`Why is this being corrected? (required, at least ${MIN_REASON_LENGTH} characters)`} className="h-16 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-[#050505] dark:text-zinc-100" />
                  {correctionError && <p className="text-xs text-red-600 dark:text-red-300">{correctionError}</p>}
                  <button type="button" disabled={correctionSaving || correctionForm.reason.trim().length < MIN_REASON_LENGTH} onClick={submitCorrection} className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                    {correctionSaving ? 'Recording…' : 'Record correction'}
                  </button>
                  <p className="text-[11px] text-gray-500 dark:text-zinc-500">The original values are kept. Corrections are permanent and cannot be edited or deleted.</p>
                </div>
              )}
            </div>

            <div className="mt-5">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Original event trail</p>
              <div className="space-y-2">
                {detail.events.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-zinc-400">No events recorded.</p>
                ) : (
                  detail.events.map((ev) => (
                    <div key={ev.id} className="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-zinc-800">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-800 dark:text-zinc-200">{String(ev.eventType || '').replace(/_/g, ' ')}</span>
                        <span className="shrink-0 tabular-nums text-gray-500 dark:text-zinc-400">{ev.occurredAt ? new Date(ev.occurredAt).toLocaleString([], { timeZone: timezone }) : '—'}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-gray-500 dark:text-zinc-400">
                        {ev.eventSource && <span>{EVENT_SOURCE_LABEL[ev.eventSource] ?? ev.eventSource}</span>}
                        {ev.validationResult && ev.validationResult !== 'accepted' && <span className="text-orange-600 dark:text-orange-400">{ev.validationResult}</span>}
                        {/* The gap between device and server time IS the offline
                          delay — showing it is the point of storing both. */}
                        {ev.deviceReportedAt && ev.serverReceivedAt && Date.parse(ev.serverReceivedAt) - Date.parse(ev.deviceReportedAt) > 120000 && (
                          <span>
                            synced{' '}
                            {new Date(ev.serverReceivedAt).toLocaleTimeString([], {
                              timeZone: timezone,
                            })}
                          </span>
                        )}
                      </div>
                      {ev.notes && <p className="mt-0.5 text-xs text-gray-600 dark:text-zinc-400">{ev.notes}</p>}
                    </div>
                  ))
                )}
              </div>
              <p className="mt-2 text-[11px] text-gray-500 dark:text-zinc-500">Append-only. These are the events the system observed and are never modified by a correction.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
