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

    const unreadLookup = await supabase
      .from('notifications')
      .select('id, is_read, read_at')
      .eq('company_id', companyId)
      .eq('user_id', userId);

    if (unreadLookup.error) {
      if (isMissingNotificationsTable(unreadLookup.error.message)) {
        const updated = markAllFallbackNotificationsRead({
          companyId,
          userId,
          companyWide: false,
        });
        return NextResponse.json({ item: { updated } });
      }
      return NextResponse.json({ error: unreadLookup.error.message }, { status: 400 });
    }

    const unreadIds = (unreadLookup.data ?? [])
      .filter((row) => !(Boolean(row.is_read) || Boolean(row.read_at)))
      .map((row) => String(row.id ?? '').trim())
      .filter(Boolean);

    if (unreadIds.length === 0) {
      const updated = markAllFallbackNotificationsRead({
        companyId,
        userId,
        companyWide: false,
      });
      return NextResponse.json({ item: { updated } });
    }

    const result = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: now })
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .in('id', unreadIds)
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
        const fallbackUpdated = markAllFallbackNotificationsRead({
          companyId,
          userId,
          companyWide: false,
        });
        return NextResponse.json({ item: { updated: (legacy.data ?? []).length + fallbackUpdated } });
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

    const fallbackUpdated = markAllFallbackNotificationsRead({
      companyId,
      userId,
      companyWide: false,
    });
    return NextResponse.json({ item: { updated: (result.data ?? []).length + fallbackUpdated } });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
