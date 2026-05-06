alter table public.attachments
  add column if not exists job_id uuid references public.jobs(id) on delete set null;

create index if not exists attachments_company_job_idx
  on public.attachments (company_id, job_id)
  where job_id is not null;
