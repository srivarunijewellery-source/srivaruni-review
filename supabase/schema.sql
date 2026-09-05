create table if not exists reels (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text unique not null,
  name text not null,
  caption text,
  status text not null default 'pending',
  metrics jsonb,
  report jsonb,
  frames jsonb,
  transcript text,
  ig_media_id text,
  ig_permalink text,
  insights jsonb,
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists reels_status_idx on reels (status, created_at);
alter table reels enable row level security; -- only the service role touches this table
