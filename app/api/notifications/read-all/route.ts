import { NextResponse } from 'next/server';
import { getCompanyId, TenantResolverError } from '@/lib/tenant/getCompanyId';
import { markAllFallbackNotificationsRead } from '@/lib/notifications/fallbackStore';

export const dynamic = 'force-dynamic';

function isMissingNotificationsTable(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('notifications') &&
    (normalized.includes('does not exist') || normalized.includes('not find'))
  );
}

function isMissingNotificationsColumns(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes('column') && (normalized.includes('is_read') || normalized.includes('read_at'));
}

export async function POST() {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const now = new Date().toISOString();

    const result = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: now })
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .eq('is_read', false)
      .select('id');

    if (result.error && isMissingNotificationsColumns(result.error.message || '')) {
      const legacy = await supabase
        .from('notifications')
        .update({ read_at: now })
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .is('read_at', null)
        .select('id');
      if (!legacy.error) {
        return NextResponse.json({ item: { updated: (legacy.data ?? []).length } });
      }
    }

    if (result.error) {
      if (isMissingNotificationsTable(result.error.message)) {
        const updated = markAllFallbackNotificationsRead({
          companyId,
          userId,
          companyWide: false,
        });
        return NextResponse.json({ item: { updated } });
      }
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }

    return NextResponse.json({ item: { updated: (result.data ?? []).length } });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
