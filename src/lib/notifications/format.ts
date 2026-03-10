export type NotificationType =
  | 'new_message'
  | 'calendar_invite'
  | 'calendar_event_reminder'
  | 'job_assigned'
  | 'task_assigned'
  | 'company_invite'
  | 'bid_won'
  | 'maintenance_assigned'
  | 'safety_assigned';

export type NotificationPayload = Record<string, unknown>;

export type NotificationDisplay = {
  title: string;
  message: string;
  link?: string | null;
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
  const href = asString(payload.href, '');
  const fallbackLink = href || null;

  switch (type) {
    case 'new_message':
      return {
        title: 'New Message',
        message: asString(payload.messagePreview, 'You have a new message.'),
        link: fallbackLink || '/messages',
      };
    case 'calendar_invite':
      return {
        title: 'Calendar Invite',
        message: `You were invited to ${eventTitle}.`,
        link: fallbackLink || '/schedule',
      };
    case 'calendar_event_reminder':
      return {
        title: 'Calendar Reminder',
        message: `${eventTitle} is coming up.`,
        link: fallbackLink || '/schedule',
      };
    case 'job_assigned':
      return {
        title: 'Job Assigned',
        message: `Assigned to ${jobName} on ${date}.`,
        link: fallbackLink || '/jobs',
      };
    case 'task_assigned':
      return {
        title: 'Task Assigned',
        message: asString(payload.taskName, `You have a new task for ${jobName}.`),
        link: fallbackLink || '/schedule',
      };
    case 'company_invite':
      return {
        title: 'Company Invite',
        message: asString(payload.inviteMessage, 'A company invite was sent or updated.'),
        link: fallbackLink || '/team',
      };
    case 'bid_won':
      return {
        title: 'Bid Won',
        message: asString(payload.bidTitle, 'A bid was marked as won and converted to a job.'),
        link: fallbackLink || '/bids',
      };
    case 'maintenance_assigned':
      return {
        title: 'Maintenance Assigned',
        message: asString(payload.title, 'A maintenance item was assigned.'),
        link: fallbackLink || '/maintenance',
      };
    case 'safety_assigned':
      return {
        title: 'Safety Assigned',
        message: asString(payload.summary, 'A safety task was assigned.'),
        link: fallbackLink || '/safety',
      };
    default:
      return {
        title: 'Notification',
        message: 'You have a new notification.',
        link: fallbackLink,
      };
  }
}
