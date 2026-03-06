/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
export function ScheduleView({ equipment, employees, scheduleData, setScheduleData, currentRole, setShowModal, ui }) {
  const { Card, Button, Icon } = ui;
  const [currentWeek, setCurrentWeek] = useState(0);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleWarning, setScheduleWarning] = useState('');
  const [eventsByDate, setEventsByDate] = useState({});
  const [movingEventId, setMovingEventId] = useState(null);

  const TIME_GRID_START_HOUR = 6;
  const TIME_GRID_END_HOUR = 18;
  const TIME_SLOT_HEIGHT = 46;
  const timeGridHours = Array.from({ length: TIME_GRID_END_HOUR - TIME_GRID_START_HOUR }, (_, index) => TIME_GRID_START_HOUR + index);
  const timelineHeight = timeGridHours.length * TIME_SLOT_HEIGHT;

  const getWeekDates = (offset = 0) => {
    const today = new Date();
    const monday = new Date(today);
    const day = today.getDay();
    const offsetToMonday = day === 0 ? -6 : 1 - day;
    monday.setDate(today.getDate() + offsetToMonday + (offset * 7));
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      return date;
    });
  };

  const asDateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const weekDates = getWeekDates(currentWeek);
  const weekStartKey = asDateKey(weekDates[0]);
  const weekDateKeys = weekDates.map((date) => asDateKey(date));
  const isFieldRole = ['foreman', 'mechanic', 'operator'].includes(currentRole);

  const employeeMap = useMemo(
    () => new Map(employees.map((employee) => [String(employee.id), employee])),
    [employees]
  );
  const equipmentMap = useMemo(
    () => new Map(equipment.map((item) => [String(item.id), item])),
    [equipment]
  );

  const bucketEventsByWeekDate = useCallback((events) => {
    const buckets = {};
    const weekKeySet = new Set(weekDateKeys);
    for (const event of events || []) {
      const start = new Date(event.startsAt);
      const end = new Date(event.endsAt);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
      const cursor = new Date(start);
      cursor.setHours(0, 0, 0, 0);
      const endDay = new Date(end);
      endDay.setHours(0, 0, 0, 0);
      while (cursor.getTime() <= endDay.getTime()) {
        const key = asDateKey(cursor);
        if (weekKeySet.has(key)) {
          const list = buckets[key] || [];
          list.push(event);
          buckets[key] = list;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return buckets;
  }, [weekDateKeys]);

  const loadWeekAssignments = useCallback(async () => {
    try {
      setScheduleLoading(true);
      setScheduleError('');
      if (isFieldRole) {
        const response = await fetch(`/api/schedule/my-week?start=${weekStartKey}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setScheduleError(payload?.error || 'Failed to load schedule assignments.');
          return;
        }
        setScheduleWarning('');

        const nextSchedule = {};
        for (const assignment of payload?.items?.assignments || []) {
          const dateKey = assignment.date;
          const key = `${assignment.jobId}-${dateKey}`;
          const assigned = nextSchedule[key] || [];
          const employee = assignment.employeeId ? employeeMap.get(String(assignment.employeeId)) : null;
          const assignedEquipment = assignment.equipmentId ? equipmentMap.get(String(assignment.equipmentId)) : null;
          const type = employee ? 'employee' : 'equipment';
          const name = employee?.name || assignedEquipment?.name || 'Assigned';
          assigned.push({
            id: assignment.id,
            type,
            name,
            employeeId: assignment.employeeId ?? null,
            equipmentId: assignment.equipmentId ?? null,
            startsAt: assignment.startsAt ?? null,
            endsAt: assignment.endsAt ?? null,
          });
          nextSchedule[key] = assigned;
        }
        setScheduleData(nextSchedule);

        setEventsByDate(bucketEventsByWeekDate(payload?.items?.events || []));
        return;
      }

      const [assignmentsResponse, eventsResponse] = await Promise.all([
        fetch(`/api/schedule/week?start=${weekStartKey}`, { cache: 'no-store' }),
        fetch(`/api/calendar/week?start=${weekStartKey}`, { cache: 'no-store' }),
      ]);

      const assignmentsPayload = await assignmentsResponse.json().catch(() => ({}));
      const eventsPayload = await eventsResponse.json().catch(() => ({}));

      if (!assignmentsResponse.ok) {
        setScheduleError(assignmentsPayload?.error || 'Failed to load schedule assignments.');
        return;
      }
      setScheduleWarning('');

      const nextSchedule = {};
      for (const day of assignmentsPayload?.items || []) {
        const dateKey = day.date;
        for (const assignment of day.assignments || []) {
          const key = `${assignment.jobId}-${dateKey}`;
          const assigned = nextSchedule[key] || [];
          const employee = assignment.employeeId ? employeeMap.get(String(assignment.employeeId)) : null;
          const assignedEquipment = assignment.equipmentId ? equipmentMap.get(String(assignment.equipmentId)) : null;
          const type = employee ? 'employee' : 'equipment';
          const name = employee?.name || assignedEquipment?.name || 'Assigned';
          assigned.push({
            id: assignment.id,
            type,
            name,
            employeeId: assignment.employeeId ?? null,
            equipmentId: assignment.equipmentId ?? null,
            startsAt: assignment.startsAt ?? null,
            endsAt: assignment.endsAt ?? null,
          });
          nextSchedule[key] = assigned;
        }
      }
      setScheduleData(nextSchedule);

      if (!eventsResponse.ok) {
        setScheduleError(eventsPayload?.error || 'Failed to load calendar events.');
        return;
      }

      setEventsByDate(bucketEventsByWeekDate(eventsPayload?.items || []));
    } catch {
      setScheduleError('Failed to load schedule assignments.');
    } finally {
      setScheduleLoading(false);
    }
  }, [equipmentMap, employeeMap, isFieldRole, setScheduleData, weekStartKey, bucketEventsByWeekDate]);

  useEffect(() => {
    loadWeekAssignments();
  }, [loadWeekAssignments]);

  const formatHourLabel = (hour) => {
    const date = new Date(Date.UTC(2026, 0, 1, hour, 0, 0));
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  };

  const getTimedHour = (startsAt) => {
    const start = new Date(startsAt);
    if (Number.isNaN(start.getTime())) return TIME_GRID_START_HOUR;
    return Math.max(TIME_GRID_START_HOUR, Math.min(TIME_GRID_END_HOUR - 1, start.getHours()));
  };

  const getEventTypeClasses = (eventType) => {
    const type = String(eventType || '').toLowerCase();
    if (type === 'client') return { chip: 'bg-cyan-200 text-cyan-900 border-cyan-300', cell: 'bg-cyan-100 border-cyan-300 ring-1 ring-cyan-300' };
    if (type === 'inspection') return { chip: 'bg-amber-200 text-amber-900 border-amber-300', cell: 'bg-amber-100 border-amber-300 ring-1 ring-amber-300' };
    if (type === 'delivery') return { chip: 'bg-emerald-200 text-emerald-900 border-emerald-300', cell: 'bg-emerald-100 border-emerald-300 ring-1 ring-emerald-300' };
    if (type === 'internal') return { chip: 'bg-slate-300 text-slate-900 border-slate-400', cell: 'bg-slate-200 border-slate-400 ring-1 ring-slate-400' };
    return { chip: 'bg-indigo-200 text-indigo-900 border-indigo-300', cell: 'bg-indigo-100 border-indigo-300 ring-1 ring-indigo-300' };
  };

  const getMinutesSinceGridStart = (dateTimeValue) => {
    const point = new Date(dateTimeValue);
    if (Number.isNaN(point.getTime())) return 0;
    const minutes = (point.getHours() - TIME_GRID_START_HOUR) * 60 + point.getMinutes();
    return Math.max(0, Math.min((TIME_GRID_END_HOUR - TIME_GRID_START_HOUR) * 60, minutes));
  };

  const getEventBlockStyle = (event) => {
    const startMinutes = getMinutesSinceGridStart(event.startsAt);
    let endMinutes = getMinutesSinceGridStart(event.endsAt);
    if (endMinutes <= startMinutes) {
      endMinutes = Math.min(startMinutes + 60, (TIME_GRID_END_HOUR - TIME_GRID_START_HOUR) * 60);
    }
    const topPx = (startMinutes / 60) * TIME_SLOT_HEIGHT;
    const heightPx = Math.max(30, ((endMinutes - startMinutes) / 60) * TIME_SLOT_HEIGHT);
    return { topPx, heightPx, startMinutes, endMinutes };
  };

  const buildEventLanes = (timedEvents) => {
    const sortedEvents = [...timedEvents].sort((a, b) => {
      const aStart = getMinutesSinceGridStart(a.startsAt);
      const bStart = getMinutesSinceGridStart(b.startsAt);
      if (aStart !== bStart) return aStart - bStart;
      const aEnd = getMinutesSinceGridStart(a.endsAt);
      const bEnd = getMinutesSinceGridStart(b.endsAt);
      return aEnd - bEnd;
    });

    const lanes = [];
    const groups = [];

    for (const event of sortedEvents) {
      const block = getEventBlockStyle(event);
      let laneIndex = lanes.findIndex((laneEnd) => laneEnd <= block.startMinutes);
      if (laneIndex === -1) {
        laneIndex = lanes.length;
        lanes.push(block.endMinutes);
      } else {
        lanes[laneIndex] = block.endMinutes;
      }

      let group = groups.find((entry) => entry.endMinutes > block.startMinutes);
      if (!group) {
        group = { startMinutes: block.startMinutes, endMinutes: block.endMinutes, eventIds: [] };
        groups.push(group);
      } else {
        group.endMinutes = Math.max(group.endMinutes, block.endMinutes);
      }
      group.eventIds.push(event.id);
    }

    const laneById = new Map();
    for (const event of sortedEvents) {
      const block = getEventBlockStyle(event);
      let laneIndex = 0;
      for (const priorEvent of sortedEvents) {
        if (priorEvent.id === event.id) break;
        const prior = getEventBlockStyle(priorEvent);
        const overlaps = prior.startMinutes < block.endMinutes && block.startMinutes < prior.endMinutes;
        if (overlaps) {
          laneIndex += 1;
        }
      }

      const group = groups.find((entry) => entry.eventIds.includes(event.id));
      const maxConcurrent = group ? group.eventIds.reduce((max, eventId) => {
        const target = sortedEvents.find((item) => item.id === eventId);
        if (!target) return max;
        const targetBlock = getEventBlockStyle(target);
        const concurrent = group.eventIds.filter((otherId) => {
          const other = sortedEvents.find((item) => item.id === otherId);
          if (!other) return false;
          const otherBlock = getEventBlockStyle(other);
          return targetBlock.startMinutes < otherBlock.endMinutes && otherBlock.startMinutes < targetBlock.endMinutes;
        }).length;
        return Math.max(max, concurrent);
      }, 1) : 1;

      laneById.set(event.id, { laneIndex, laneCount: Math.max(1, maxConcurrent) });
    }

    return laneById;
  };

  const openEventModalAtSlot = (dateKey, startHour) => {
    const start = new Date(`${dateKey}T00:00:00`);
    start.setHours(startHour, 0, 0, 0);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    setShowModal({
      type: 'calendar-event',
      data: {
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
      },
    });
  };

  const getAssignmentsForDate = (dateKey) =>
    Object.entries(scheduleData).flatMap(([key, items]) => (key.endsWith(`-${dateKey}`) ? items : []));

  const findEventById = useCallback(
    (eventId) => {
      for (const dateKey of Object.keys(eventsByDate || {})) {
        const found = (eventsByDate[dateKey] || []).find((event) => String(event.id) === String(eventId));
        if (found) return found;
      }
      return null;
    },
    [eventsByDate]
  );

  const moveEventToSlot = useCallback(
    async (eventId, dateKey, hour) => {
      const event = findEventById(eventId);
      if (!event) return;
      const start = new Date(event.startsAt);
      const end = new Date(event.endsAt);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;

      const durationMs = Math.max(30 * 60 * 1000, end.getTime() - start.getTime());
      const nextStart = new Date(`${dateKey}T00:00:00`);
      nextStart.setHours(hour, start.getMinutes(), 0, 0);
      const nextEnd = new Date(nextStart.getTime() + durationMs);

      try {
        setMovingEventId(String(eventId));
        setScheduleError('');
        const response = await fetch(`/api/calendar/events/${eventId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startsAt: nextStart.toISOString(),
            endsAt: nextEnd.toISOString(),
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setScheduleError(payload?.error || 'Failed to move event');
          return;
        }
        await loadWeekAssignments();
      } catch {
        setScheduleError('Failed to move event');
      } finally {
        setMovingEventId(null);
      }
    },
    [findEventById, loadWeekAssignments]
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="p-3 sm:p-4 bg-white/90 backdrop-blur border border-gray-200/80 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Button variant="secondary" size="sm" onClick={() => setCurrentWeek(w => w - 1)}>
              <Icon name="chevron-left" />
            </Button>
            <h2 className="text-base sm:text-lg font-semibold tracking-tight">
              {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </h2>
            <Button variant="secondary" size="sm" onClick={() => setCurrentWeek(w => w + 1)}>
              <Icon name="chevron-right" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCurrentWeek(0)}>Today</Button>
            <Button variant="brand" size="sm" onClick={() => setShowModal({ type: 'calendar-event' })}>
              <Icon name="calendar-plus" className="mr-2" /> Add Event
            </Button>
          </div>
        </div>
      </Card>

      <div className="overflow-x-auto">
          <Card className="p-0 min-w-[880px] border border-gray-200/80 shadow-sm">
            {/* Days Header */}
            <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))] border-b border-gray-200 bg-gray-50/70">
              <div className="border-r border-gray-200" />
              {weekDates.map((date, i) => {
                const isToday = date.toDateString() === new Date().toDateString();
                return (
                  <div key={i} className={`p-3 text-center border-r border-gray-200 last:border-r-0 ${isToday ? 'bg-brand-50/80' : ''}`}>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                    <div className={`text-xl font-semibold mt-0.5 ${isToday ? 'text-brand-600' : 'text-gray-900'}`}>{date.getDate()}</div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))]">
              <div className="relative border-r border-gray-200 bg-gray-50/40" style={{ height: `${timelineHeight}px` }}>
                <div className="relative" style={{ height: `${timelineHeight}px` }}>
                  {timeGridHours.map((hour) => {
                    const top = (hour - TIME_GRID_START_HOUR) * TIME_SLOT_HEIGHT;
                    return (
                      <div key={`time-label-${hour}`} className="absolute inset-x-0" style={{ top: `${top}px` }}>
                        <div className="h-px bg-transparent" />
                        <div className="px-2 text-[10px] font-medium leading-none text-gray-500" style={{ transform: 'translateY(-2px)' }}>
                          {formatHourLabel(hour)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {weekDates.map((date, i) => {
                const dateKey = asDateKey(date);
                const assigned = getAssignmentsForDate(dateKey);
                const dayEvents = eventsByDate[dateKey] || [];
                const timedEvents = dayEvents;
                const eventLaneMap = buildEventLanes(timedEvents);
                const timedAssignments = assigned.filter((item) => item.startsAt && item.endsAt);

                return (
                  <div
                    key={i}
                    data-testid={`schedule-day-${dateKey}`}
                    className="border-r border-gray-200 last:border-r-0 transition-colors bg-white"
                  >
                    <div
                      className="relative"
                      style={{ height: `${timelineHeight}px` }}
                    >
                      {timeGridHours.map((hour) => {
                        const top = (hour - TIME_GRID_START_HOUR) * TIME_SLOT_HEIGHT;
                        return (
                          <div
                            key={`${dateKey}-hour-line-${hour}`}
                            data-testid={`schedule-time-cell-${dateKey}-${hour}`}
                            className="absolute inset-x-0 border-t border-gray-100 cursor-pointer hover:bg-brand-50/40"
                            style={{ top: `${top}px`, height: `${TIME_SLOT_HEIGHT}px` }}
                            onDragOver={(dragEvent) => {
                              dragEvent.preventDefault();
                            }}
                            onDrop={(dropEvent) => {
                              dropEvent.preventDefault();
                              const draggedEventId = dropEvent.dataTransfer.getData('text/calendar-event-id');
                              if (!draggedEventId) return;
                              moveEventToSlot(draggedEventId, dateKey, hour);
                            }}
                            onClick={(clickEvent) => {
                              clickEvent.stopPropagation();
                              openEventModalAtSlot(dateKey, hour);
                            }}
                          />
                        );
                      })}

                      {timedAssignments.map((item) => {
                        const top = (getTimedHour(item.startsAt) - TIME_GRID_START_HOUR) * TIME_SLOT_HEIGHT + 4;
                        return (
                          <div
                            key={`assignment-pill-${item.id}`}
                            data-testid={`schedule-time-assignment-${item.id}`}
                            className={`absolute left-2 right-2 z-10 text-[10px] truncate rounded px-2 py-0.5 border ${
                              item.type === 'equipment'
                                ? 'bg-blue-100/95 text-blue-800 border-blue-300'
                                : 'bg-emerald-100/95 text-emerald-800 border-emerald-300'
                            }`}
                            style={{ top: `${top}px` }}
                            onClick={(clickEvent) => clickEvent.stopPropagation()}
                            title={item.name}
                          >
                            {item.name}
                          </div>
                        );
                      })}

                      {timedEvents.map((event) => {
                        const blockStyle = getEventBlockStyle(event);
                        const laneData = eventLaneMap.get(event.id) || { laneIndex: 0, laneCount: 1 };
                        const laneWidth = 100 / laneData.laneCount;
                        const inset = 6;
                        return (
                          <button
                            type="button"
                            key={`timed-event-${event.id}-${dateKey}`}
                            data-testid={`schedule-time-event-${event.id}`}
                            aria-label={`Schedule event ${event.title}`}
                            draggable
                            className={`absolute z-20 rounded-md border px-2 py-1 text-left shadow-sm hover:brightness-95 ${getEventTypeClasses(event.eventType).chip}`}
                            style={{
                              top: `${blockStyle.topPx}px`,
                              height: `${blockStyle.heightPx}px`,
                              left: `calc(${laneData.laneIndex * laneWidth}% + ${inset}px)`,
                              width: `calc(${laneWidth}% - ${inset * 2}px)`,
                            }}
                            title={`${event.title} (${new Date(event.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${new Date(event.endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`}
                            onDragStart={(dragEvent) => {
                              dragEvent.dataTransfer.setData('text/calendar-event-id', String(event.id));
                              dragEvent.dataTransfer.effectAllowed = 'move';
                            }}
                            onClick={(clickEvent) => {
                              clickEvent.stopPropagation();
                              setShowModal({ type: 'calendar-event', data: event });
                            }}
                          >
                            <div className="text-[11px] font-semibold truncate">{event.title}</div>
                            <div className="text-[10px] opacity-80 truncate">
                              {new Date(event.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - {new Date(event.endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
      </div>

      <p className="text-sm text-gray-500">
        <Icon name="circle-info" className="mr-1" />
        Click a time slot to open Add Event.
      </p>
      {scheduleWarning && (
        <p data-testid="schedule-conflict-warning" className="text-sm text-yellow-700">{scheduleWarning}</p>
      )}
      {(scheduleLoading || movingEventId) && (
        <p className="text-sm text-gray-500">Loading schedule assignments...</p>
      )}
      {scheduleError && (
        <p className="text-sm text-red-600">{scheduleError}</p>
      )}
    </div>
  );
};
