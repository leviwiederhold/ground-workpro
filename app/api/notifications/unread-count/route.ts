import { NextResponse } from 'next/server';
import { getCompanyId, TenantResolverError } from '@/lib/tenant/getCompanyId';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { supabase, companyId, userId } = await getCompanyId();

    const result = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .is('read_at', null);

    if (result.error) {
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
