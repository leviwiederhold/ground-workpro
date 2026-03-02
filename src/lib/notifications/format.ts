export type NotificationType =
  | 'assignment_created'
  | 'assignment_removed'
  | 'event_invited'
  | 'event_updated'
  | 'event_canceled'
  | 'work_order_reported'
  | 'safety_log_created';

export type NotificationPayload = Record<string, unknown>;

export type NotificationDisplay = {
  title: string;
  message: string;
};

const asString = (value: unknown, fallback = '') => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return fallback;
};

export function formatNotification(type: NotificationType, payload: NotificationPayload): NotificationDisplay {
  const jobName = asString(payload.jobName, 'Job');
  const eventTitle = asString(payload.eventTitle ?? payload.title, 'Event');
  const date = asString(payload.date, 'today');

  switch (type) {
    case 'assignment_created':
      return {
        title: 'Schedule Updated',
        message: `Assigned to ${jobName} on ${date}.`,
      };
    case 'assignment_removed':
      return {
        title: 'Schedule Updated',
        message: `Removed from ${jobName} on ${date}.`,
      };
    case 'event_invited':
      return {
        title: 'Event Invitation',
        message: `You were added to ${eventTitle}.`,
      };
    case 'event_updated':
      return {
        title: 'Event Updated',
        message: `${eventTitle} has new details.`,
      };
    case 'event_canceled':
      return {
        title: 'Event Canceled',
        message: `${eventTitle} was canceled.`,
      };
    case 'work_order_reported':
      return {
        title: 'Maintenance Request',
        message: `${asString(payload.title, 'New issue')} was reported.`,
      };
    case 'safety_log_created':
      return {
        title: 'Safety Log',
        message: `${asString(payload.summary, 'New safety log')} was submitted.`,
      };
    default:
      return {
        title: 'Notification',
        message: 'You have a new notification.',
      };
  }
}
