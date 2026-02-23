import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationPayload, NotificationType } from '@/lib/notifications/format';

type EnqueueInput = {
  supabase: SupabaseClient;
  companyId: string;
  userIds: string[];
  type: NotificationType;
  payload: NotificationPayload;
};

export async function enqueueNotifications(input: EnqueueInput): Promise<void> {
  const uniqueUserIds = Array.from(new Set(input.userIds.map(String))).filter(Boolean);
  if (uniqueUserIds.length === 0) return;

  const rows = uniqueUserIds.map((userId) => ({
    company_id: input.companyId,
    user_id: userId,
    type: input.type,
    payload: input.payload,
  }));

  const { error } = await input.supabase.from('notifications').insert(rows);
  if (error) {
    throw new Error(error.message);
  }
}
