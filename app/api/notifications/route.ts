import { NextResponse } from 'next/server';
import { z } from 'next/dist/compiled/zod';
import { getCompanyId, TenantResolverError } from '@/lib/tenant/getCompanyId';
import { formatNotification, type NotificationType } from '@/lib/notifications/format';

export const dynamic = 'force-dynamic';

type NotificationRow = {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

function isMissingNotificationsTable(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('notifications') &&
    (normalized.includes('does not exist') || normalized.includes('not find'))
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

    const result = await supabase
      .from('notifications')
      .select('id, type, payload, read_at, created_at')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (result.error) {
      if (isMissingNotificationsTable(result.error.message)) {
        return NextResponse.json({ items: [] });
      }
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }

    const items = ((result.data ?? []) as NotificationRow[]).map((row) => {
      const payload = row.payload ?? {};
      const display = formatNotification(row.type, payload);
      return {
        id: row.id,
        type: row.type,
        createdAt: row.created_at,
        readAt: row.read_at,
        notification_type: row.type,
        title: display.title,
        message: display.message,
        payload,
        is_read: Boolean(row.read_at),
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
