create table if not exists public.bid_share_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bid_id uuid not null references public.bids(id) on delete cascade,
  token text not null,
  expires_at timestamptz null,
  revoked_at timestamptz null,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists bid_share_links_token_key on public.bid_share_links(token);
create index if not exists bid_share_links_bid_id_idx on public.bid_share_links(bid_id);
create index if not exists bid_share_links_company_id_idx on public.bid_share_links(company_id);

alter table public.bid_share_links enable row level security;

do $$ begin
  create policy "bid_share_links_select_company"
    on public.bid_share_links
    for select
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "bid_share_links_insert_company"
    on public.bid_share_links
    for insert
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "bid_share_links_update_company"
    on public.bid_share_links
    for update
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "bid_share_links_delete_company"
    on public.bid_share_links
    for delete
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;
