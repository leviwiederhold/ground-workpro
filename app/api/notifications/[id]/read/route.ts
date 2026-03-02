import { NextResponse } from 'next/server';
import { z } from 'next/dist/compiled/zod';
import { getCompanyId, TenantResolverError } from '@/lib/tenant/getCompanyId';
import { formatNotification, type NotificationType } from '@/lib/notifications/format';
import { getEffectiveRole } from '@/lib/auth/effectiveRole';
import { markFallbackNotificationRead } from '@/lib/notifications/fallbackStore';

const paramsSchema = z.object({
  id: z.string().uuid(),
});

type NotificationRow = {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

function isMissingNotificationsTable(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('notifications') &&
    (normalized.includes('does not exist') || normalized.includes('not find'))
  );
}

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          error: 'Validation error',
          details: parsedParams.error.issues.map((issue: { path: (string | number)[]; message: string }) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const role = await getEffectiveRole();
    const canCompanyWide = role === 'admin' || role === 'pm';

    let query = supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('id', parsedParams.data.id);
    if (!canCompanyWide) {
      query = query.eq('user_id', userId);
    }
    const result = await query.select('id, type, payload, read_at, created_at').maybeSingle();

    if (result.error) {
      if (isMissingNotificationsTable(result.error.message)) {
        const fallbackRow = markFallbackNotificationRead({
          companyId,
          notificationId: parsedParams.data.id,
          userId,
          companyWide: canCompanyWide,
        });
        if (!fallbackRow) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        const fallbackPayload = (fallbackRow.payload ?? {}) as Record<string, unknown>;
        const fallbackDisplay = formatNotification(fallbackRow.type, fallbackPayload);
        return NextResponse.json({
          item: {
            id: fallbackRow.id,
            readAt: fallbackRow.read_at,
            notification_type: fallbackRow.type,
            title: fallbackDisplay.title,
            message: fallbackDisplay.message,
            payload: fallbackPayload,
            is_read: Boolean(fallbackRow.read_at),
            read_at: fallbackRow.read_at,
            created_at: fallbackRow.created_at,
          },
        });
      }
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }

    if (!result.data) {
      const fallbackRow = markFallbackNotificationRead({
        companyId,
        notificationId: parsedParams.data.id,
        userId,
        companyWide: canCompanyWide,
      });
      if (!fallbackRow) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      const fallbackPayload = (fallbackRow.payload ?? {}) as Record<string, unknown>;
      const fallbackDisplay = formatNotification(fallbackRow.type, fallbackPayload);
      return NextResponse.json({
        item: {
          id: fallbackRow.id,
          readAt: fallbackRow.read_at,
          notification_type: fallbackRow.type,
          title: fallbackDisplay.title,
          message: fallbackDisplay.message,
          payload: fallbackPayload,
          is_read: Boolean(fallbackRow.read_at),
          read_at: fallbackRow.read_at,
          created_at: fallbackRow.created_at,
        },
      });
    }

    const row = result.data as NotificationRow;
    const payload = row.payload ?? {};
    const display = formatNotification(row.type, payload);

    return NextResponse.json({
      item: {
        id: row.id,
        readAt: row.read_at,
        notification_type: row.type,
        title: display.title,
        message: display.message,
        payload,
        is_read: Boolean(row.read_at),
        read_at: row.read_at,
        created_at: row.created_at,
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
