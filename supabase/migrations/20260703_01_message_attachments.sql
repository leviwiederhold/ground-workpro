-- ============================================================================
-- Message attachments: photos/files on any messaging thread (companywide / team
-- chat, direct messages, and custom group chats all share message_threads +
-- messages, so a single attachments table covers every chat type).
--
-- - Linked to message_id (and company_id for tenant isolation).
-- - Preserves uploader_id (the sending member).
-- - Files live in the private "message-attachments" storage bucket, keyed by a
--   company-scoped, content-hashed path so identical bytes are not duplicated.
-- - RLS mirrors messages: only participants of the thread can read/insert, and
--   only within their own company.
-- ============================================================================

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  message_id uuid not null,
  thread_id uuid not null,
  uploader_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  content_type text not null,
  file_size bigint not null,
  storage_bucket text not null default 'message-attachments',
  storage_path text not null,
  content_sha256 text null,
  created_at timestamptz not null default now(),
  constraint message_attachments_message_fk
    foreign key (message_id, company_id)
    references public.messages(id, company_id)
    on delete cascade
);

-- messages needs a composite unique on (id, company_id) for the FK above.
create unique index if not exists messages_id_company_key
  on public.messages(id, company_id);

create index if not exists message_attachments_company_message_idx
  on public.message_attachments(company_id, message_id);

create index if not exists message_attachments_company_thread_idx
  on public.message_attachments(company_id, thread_id);

-- Dedupe helper: identical file bytes within a company reuse the same storage
-- object (one storage_path per content hash); rows still link per message.
create index if not exists message_attachments_company_hash_idx
  on public.message_attachments(company_id, content_sha256);

alter table public.message_attachments enable row level security;

drop policy if exists "message_attachments_select_participant" on public.message_attachments;
drop policy if exists "message_attachments_insert_participant" on public.message_attachments;
drop policy if exists "message_attachments_delete_participant" on public.message_attachments;

-- Only participants of the attachment's thread (in the same company) may read.
do $$ begin
  create policy "message_attachments_select_participant"
    on public.message_attachments
    for select
    using (
      exists (
        select 1
        from public.message_participants p
        where p.company_id = message_attachments.company_id
          and p.thread_id = message_attachments.thread_id
          and p.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

-- Only the uploader, who must be a participant of the thread, may insert.
do $$ begin
  create policy "message_attachments_insert_participant"
    on public.message_attachments
    for insert
    with check (
      uploader_id = auth.uid()
      and exists (
        select 1
        from public.message_participants p
        where p.company_id = message_attachments.company_id
          and p.thread_id = message_attachments.thread_id
          and p.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

-- Uploader may remove their own attachment.
do $$ begin
  create policy "message_attachments_delete_participant"
    on public.message_attachments
    for delete
    using (uploader_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Private storage bucket for message attachments (idempotent). Access is always
-- via short-lived signed URLs minted server-side after a participant check.
insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', false)
on conflict (id) do nothing;
