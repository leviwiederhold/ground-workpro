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
--
-- STORAGE BUCKET (manual, one-time): create BEFORE using the feature. Bucket
-- creation is intentionally NOT done in SQL here — on hosted Supabase, inserting
-- into storage.buckets from a migration is permission-sensitive and, if it
-- fails, it aborts this whole migration. Create it in the dashboard instead:
--   - Name:          message-attachments
--   - Public:        false (private)
--   - File size limit: 10 MB
--   - Allowed MIME types: image/jpeg, image/png, image/gif, image/webp,
--       image/heic, image/heif, application/pdf, text/plain, text/csv,
--       application/msword,
--       application/vnd.openxmlformats-officedocument.wordprocessingml.document,
--       application/vnd.ms-excel,
--       application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
-- (Server-side upload validation enforces the same size/type allowlist, so the
--  bucket-level limits are defense-in-depth.)
-- ============================================================================

-- The FK below references public.messages(id, company_id), which requires a
-- matching composite unique key. Create it FIRST so the table's FK can bind.
create unique index if not exists messages_id_company_key
  on public.messages(id, company_id);

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
