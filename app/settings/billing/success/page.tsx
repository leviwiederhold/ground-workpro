import BillingSuccessClient from "./success-client";

interface PageProps {
  searchParams: Promise<{ session_id?: string }>;
}

export default async function BillingSuccessPage({ searchParams }: PageProps) {
  const params = await searchParams;
  return <BillingSuccessClient sessionId={params.session_id ?? ""} />;
}
