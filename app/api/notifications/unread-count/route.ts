import { NextResponse } from 'next/server';
import { getCompanyId, TenantResolverError } from '@/lib/tenant/getCompanyId';
import { countFallbackUnread } from '@/lib/notifications/fallbackStore';

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

export async function GET() {
  try {
    const { supabase, companyId, userId } = await getCompanyId();

    const query = supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .eq('is_read', false);
    const result = await query;

    if (result.error && isMissingNotificationsColumns(result.error.message || '')) {
      const legacyQuery = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .is('read_at', null);
      if (!legacyQuery.error) {
        return NextResponse.json({ item: { count: legacyQuery.count ?? 0 } });
      }
    }

    if (result.error) {
      if (isMissingNotificationsTable(result.error.message)) {
        const fallbackCount = countFallbackUnread({
          companyId,
          userId,
          companyWide: false,
        });
        return NextResponse.json({ item: { count: fallbackCount } });
      }
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }

    return NextResponse.json({ item: { count: result.count ?? 0 } });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
