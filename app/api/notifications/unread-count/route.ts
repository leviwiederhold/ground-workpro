import { NextResponse } from 'next/server';
import { getCompanyId, TenantResolverError } from '@/lib/tenant/getCompanyId';
import { getEffectiveRole } from '@/lib/auth/effectiveRole';
import { countFallbackUnread } from '@/lib/notifications/fallbackStore';

export const dynamic = 'force-dynamic';

function isMissingNotificationsTable(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('notifications') &&
    (normalized.includes('does not exist') || normalized.includes('not find'))
  );
}

export async function GET() {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const role = await getEffectiveRole();
    const isCompanyWide = role === 'admin' || role === 'pm';

    let query = supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .is('read_at', null);
    if (!isCompanyWide) {
      query = query.eq('user_id', userId);
    }
    const result = await query;
    const fallbackCount = countFallbackUnread({
      companyId,
      userId,
      companyWide: isCompanyWide,
    });

    if (result.error) {
      if (isMissingNotificationsTable(result.error.message)) {
        return NextResponse.json({ item: { count: fallbackCount } });
      }
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }

    return NextResponse.json({ item: { count: (result.count ?? 0) + fallbackCount } });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
