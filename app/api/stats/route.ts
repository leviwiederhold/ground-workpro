import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCompanyId, TenantResolverError } from '@/lib/tenant/getCompanyId';
import { getEffectiveRole } from '@/lib/auth/effectiveRole';
import { getStatsForRole } from '@/lib/stats/getStats';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  scope: z.enum(['dashboard', 'jobs', 'fleet', 'team', 'safety', 'messages']),
});

function toErrorResponse(error: unknown) {
  if (error instanceof TenantResolverError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : 'Internal server error';
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid query' }, { status: 422 });
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const role = await getEffectiveRole();

    if (!role) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (parsed.data.scope === 'dashboard') {
      const item = await getStatsForRole({ supabase, companyId, userId, role });
      return NextResponse.json({ item });
    }

    return NextResponse.json({ item: {} });
  } catch (error) {
    return toErrorResponse(error);
  }
}
