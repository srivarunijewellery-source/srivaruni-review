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

-- v2: list pages must not load frames. One thumbnail per reel and the frame count live outside the frames blob.
alter table reels add column if not exists thumb text;
update reels set thumb = frames -> coalesce((report -> 'product_frames' ->> 0)::int, 0) ->> 'src' where frames is not null and thumb is null;
update reels set metrics = metrics || jsonb_build_object('frame_count', jsonb_array_length(frames)) where frames is not null and metrics is not null and (metrics ->> 'frame_count') is null;

-- v3: experiments. One row per A/B test; results are read from Meta by ad id.
create table if not exists experiments (
  id uuid primary key default gen_random_uuid(),
  hypothesis text not null,          -- key from lib/hypotheses.ts, e.g. "price"
  variant_a text not null,           -- what A is, e.g. "price on first frame"
  variant_b text not null,           -- what B is, e.g. "no price"
  ad_id_a text,
  ad_id_b text,
  metric text not null default 'saves',   -- saves | link_clicks | follows | engagement
  status text not null default 'planned', -- planned | running | read
  result jsonb,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table experiments enable row level security;

-- v4: manual verdicts on hypotheses. Overrides the computed verdict and steers the brief and the acceptance rules.
create table if not exists hypothesis_marks (
  key text primary key,
  mark text not null,        -- supported | rejected | retest | unknown
  note text,
  updated_at timestamptz default now()
);
alter table hypothesis_marks enable row level security;

-- v5: competitor reels via Business Discovery. Stored under drive_file_id 'comp:<handle>:<media id>' so they never enter your bar or model.
alter table reels add column if not exists media_url text;
alter table reels add column if not exists competitor text;
create index if not exists reels_competitor_idx on reels (competitor);
