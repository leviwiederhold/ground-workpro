import { NextResponse } from 'next/server';
import { z } from 'next/dist/compiled/zod';
import { getCompanyId, TenantResolverError } from '@/lib/tenant/getCompanyId';
import { formatNotification, type NotificationType } from '@/lib/notifications/format';

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

    const result = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .eq('id', parsedParams.data.id)
      .select('id, type, payload, read_at, created_at')
      .maybeSingle();

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }

    if (!result.data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
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
