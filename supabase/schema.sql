create table if not exists saju_lotto_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  birth_year int not null,
  birth_month int not null,
  birth_day int not null,
  birth_hour int,
  birth_minute int,
  unknown_time boolean not null default false,
  gender text,
  numbers int[] not null,
  bonus int not null,
  analysis text
);

alter table saju_lotto_requests enable row level security;
