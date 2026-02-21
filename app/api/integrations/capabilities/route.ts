import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { okItems } from "@/lib/http/json";
import { forbidden, notFound, serverError } from "@/lib/http/errors";
import { listProviderAdapters } from "@/lib/integrations/providerAdapters";

export const dynamic = "force-dynamic";

function toTenantErrorResponse(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

export async function GET() {
  try {
    await getCompanyId();

    const items = listProviderAdapters().map((adapter) => ({
      provider: adapter.key,
      name: adapter.name,
      category: adapter.category,
      icon: adapter.icon,
      description: adapter.description,
      popular: !!adapter.popular,
      capabilities: adapter.capabilities,
      connect_url_placeholder: adapter.getConnectUrlPlaceholder(),
    }));

    return okItems(items);
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
