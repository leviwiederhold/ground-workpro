import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCompanyId, TenantResolverError } from '@/lib/tenant/getCompanyId';
import { formatNotification, type NotificationType } from '@/lib/notifications/format';
import { listFallbackNotifications } from '@/lib/notifications/fallbackStore';

export const dynamic = 'force-dynamic';

type NotificationRow = {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string | null;
  body: string | null;
  link: string | null;
  actor_user_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  is_read: boolean | null;
  read_at: string | null;
  created_at: string;
};

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('notifications_timeout')), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

function isMissingNotificationsTable(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('notifications') &&
    (normalized.includes('does not exist') || normalized.includes('not find'))
  );
}

function isMissingNotificationsColumns(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes('column') && (
    normalized.includes('title') ||
    normalized.includes('body') ||
    normalized.includes('link') ||
    normalized.includes('is_read') ||
    normalized.includes('actor_user_id') ||
    normalized.includes('entity_type') ||
    normalized.includes('entity_id')
  );
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation error',
          details: parsed.error.issues.map((issue: { path: (string | number)[]; message: string }) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }
    const limit = parsed.data.limit;

    const { supabase, companyId, userId } = await getCompanyId();

    const primaryResult = await withTimeout(
      supabase
        .from('notifications')
        .select('id, user_id, type, title, body, link, actor_user_id, entity_type, entity_id, payload, is_read, read_at, created_at')
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit),
      3500
    ).catch((error) => ({
      data: [],
      error: { message: error instanceof Error ? error.message : 'notifications_timeout' },
    }));

    let rows: NotificationRow[] = (primaryResult.data ?? []) as NotificationRow[];
    let resultError: { message: string } | null = primaryResult.error
      ? { message: String(primaryResult.error.message ?? 'Failed to load notifications') }
      : null;

    if (resultError && isMissingNotificationsColumns(resultError.message || '')) {
      const legacy = await supabase
        .from('notifications')
        .select('id, user_id, type, payload, read_at, created_at')
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (!legacy.error) {
        rows = (legacy.data ?? []).map((row) => ({
          ...(row as NotificationRow),
          title: null,
          body: null,
          link: null,
          actor_user_id: null,
          entity_type: null,
          entity_id: null,
          is_read: Boolean((row as { read_at?: string | null }).read_at),
        })) as NotificationRow[];
        resultError = null;
      }
    }

    if (resultError) {
      if (isMissingNotificationsTable(resultError.message)) {
        const fallbackRows = listFallbackNotifications({
          companyId,
          userId,
          companyWide: false,
          limit,
        });
        const items = fallbackRows.map((row) => {
          const payload = (row.payload ?? {}) as Record<string, unknown>;
          const display = formatNotification(row.type, payload);
          const isRead = Boolean((row as { is_read?: boolean }).is_read ?? row.read_at);
          return {
            id: row.id,
            userId: row.user_id,
            type: row.type,
            notification_type: row.type,
            title: display.title,
            message: display.message,
            body: display.message,
            link: display.link || String(payload.href ?? ''),
            actor_user_id: null,
            entity_type: null,
            entity_id: null,
            payload,
            is_read: isRead,
            read_at: row.read_at,
            created_at: row.created_at,
          };
        });
        return NextResponse.json({ items });
      }
      if (resultError.message === 'notifications_timeout') {
        return NextResponse.json({ items: [], degraded: true, reason: 'notifications_timeout' });
      }
      return NextResponse.json({ error: resultError.message, items: [], degraded: true }, { status: 200 });
    }

    const items = rows.map((row) => {
      const payload = row.payload ?? {};
      const display = formatNotification(row.type, payload);
      const isRead = Boolean(row.is_read ?? row.read_at);
      const title = String(row.title ?? display.title);
      const body = String(row.body ?? display.message);
      const link = String(row.link ?? display.link ?? (payload.href ?? ''));
      return {
        id: row.id,
        userId: row.user_id,
        type: row.type,
        notification_type: row.type,
        title,
        message: body,
        body,
        link,
        actor_user_id: row.actor_user_id,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        payload,
        is_read: isRead,
        read_at: row.read_at,
        created_at: row.created_at,
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ items: [], degraded: true, error: message }, { status: 200 });
  }
}
