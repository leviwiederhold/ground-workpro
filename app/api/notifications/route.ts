import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCompanyId, TenantResolverError } from '@/lib/tenant/getCompanyId';
import { formatNotification, type NotificationType } from '@/lib/notifications/format';
import { getEffectiveRole } from '@/lib/auth/effectiveRole';
import { listFallbackNotifications } from '@/lib/notifications/fallbackStore';

export const dynamic = 'force-dynamic';

type NotificationRow = {
  id: string;
  user_id: string;
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
    const role = await getEffectiveRole();
    const isCompanyWide = role === 'admin' || role === 'pm';

    let query = supabase
      .from('notifications')
      .select('id, user_id, type, payload, read_at, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!isCompanyWide) {
      query = query.eq('user_id', userId);
    }
    const result = await query;
    const fallbackRows = listFallbackNotifications({
      companyId,
      userId,
      companyWide: isCompanyWide,
      limit,
    });

    if (result.error) {
      if (isMissingNotificationsTable(result.error.message)) {
        const items = fallbackRows.map((row) => {
          const payload = (row.payload ?? {}) as Record<string, unknown>;
          const display = formatNotification(row.type, payload);
          return {
            id: row.id,
            userId: row.user_id,
            actorName: isCompanyWide ? 'Team member' : null,
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
      }
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }

    const rows = (result.data ?? []) as NotificationRow[];
    const userIds = Array.from(new Set(rows.map((row) => String(row.user_id ?? "")).filter(Boolean)));
    const employeeLookup = new Map<string, string>();
    if (isCompanyWide && userIds.length > 0) {
      const employeesResult = await supabase
        .from('employees')
        .select('user_id, name, full_name')
        .eq('company_id', companyId)
        .in('user_id', userIds);
      if (!employeesResult.error) {
        for (const row of employeesResult.data ?? []) {
          const name = String((row as { name?: string; full_name?: string }).name ?? (row as { name?: string; full_name?: string }).full_name ?? '').trim();
          if (!name) continue;
          employeeLookup.set(String((row as { user_id?: string }).user_id ?? ''), name);
        }
      }
    }

    const items = rows.map((row) => {
      const payload = row.payload ?? {};
      const display = formatNotification(row.type, payload);
      return {
        id: row.id,
        userId: (row as unknown as { user_id?: string }).user_id ?? null,
        actorName:
          employeeLookup.get(String((row as unknown as { user_id?: string }).user_id ?? '')) ??
          (isCompanyWide ? 'Team member' : null),
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

    const fallbackItems = fallbackRows.map((row) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const display = formatNotification(row.type, payload);
      return {
        id: row.id,
        userId: row.user_id,
        actorName: isCompanyWide ? 'Team member' : null,
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

    const mergedItems = [...items, ...fallbackItems]
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
      .slice(0, limit);

    return NextResponse.json({ items: mergedItems });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
