-- Schema for Supabase Postgres (run in SQL editor)
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid not null unique,
  role text not null check (role in ('RESIDENT','WORKER')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  name text not null,
  phone text not null unique,
  block text,
  flat_no text,
  age int,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists worker_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  worker_type text not null check (worker_type in ('COOK','MAID','BOTH')),
  cuisine text check (cuisine in ('NORTH','SOUTH','BOTH')),
  experience_yrs int not null default 0,
  charges int not null,
  long_term_offer text,
  rating float not null default 0,
  rating_count int not null default 0,
  time_slots jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists service_posts (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references worker_profiles(id) on delete cascade,
  title text not null,
  cuisine text check (cuisine in ('NORTH','SOUTH','BOTH')),
  price int not null,
  service_area text,
  available_timing text,
  description text,
  time_slots jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists requirements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  need_type text not null check (need_type in ('COOK','MAID','BOTH')),
  details text,
  preferred_timing text,
  preferred_price int,
  block text,
  flat_no text,
  urgency text not null default 'MEDIUM' check (urgency in ('LOW','MEDIUM','HIGH')),
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists requirement_applications (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references requirements(id) on delete cascade,
  worker_id uuid not null references worker_profiles(id) on delete cascade,
  message text,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  constraint unique_application unique (requirement_id, worker_id)
);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  reviewer_id uuid not null references users(id) on delete cascade,
  worker_id uuid not null references worker_profiles(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references users(id) on delete cascade,
  to_id uuid not null references users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

-- Views for convenient joins
create or replace view users_view as
select u.*, p.name, p.phone, p.block, p.flat_no, p.age, p.verified,
       wp.worker_type, wp.cuisine, wp.experience_yrs, wp.charges, wp.long_term_offer, wp.rating, wp.rating_count, wp.time_slots
from users u
left join profiles p on p.user_id = u.id
left join worker_profiles wp on wp.user_id = u.id;

create view service_posts_view as
select 
    sp.id,
    sp.worker_id,
    sp.title,
    sp.cuisine,
    sp.price,
    sp.service_area,
    sp.available_timing,
    sp.description,
    sp.time_slots,
    sp.is_active,
    sp.created_at,
    sp.updated_at,
    wp.user_id, 
    wp.rating, 
    wp.rating_count, 
    wp.experience_yrs, 
    u.role, 
    u.auth_id, 
    p.name, 
    p.phone
from service_posts sp
join worker_profiles wp on wp.id = sp.worker_id
join users u on u.id = wp.user_id
left join profiles p on p.user_id = u.id;

create view requirements_view as
select 
    r.id,
    r.owner_id,
    r.need_type,
    r.details,
    r.preferred_timing,
    r.preferred_price,
    r.block,
    r.flat_no,
    r.urgency,
    r.is_open,
    r.created_at,
    r.updated_at,
    u.role, 
    p.name, 
    p.phone, 
    p.block as profile_block, 
    p.flat_no as profile_flat_no
from requirements r
join users u on u.id = r.owner_id
left join profiles p on p.user_id = u.id;

create or replace view workers_view as
select wp.*, u.auth_id, p.name, p.phone, p.block, p.flat_no
from worker_profiles wp
join users u on u.id = wp.user_id
left join profiles p on p.user_id = u.id;

-- Enable Row Level Security
alter table users enable row level security;
alter table profiles enable row level security;
alter table worker_profiles enable row level security;
alter table service_posts enable row level security;
alter table requirements enable row level security;
alter table requirement_applications enable row level security;
alter table reviews enable row level security;
alter table messages enable row level security;

-- RLS Policies (optimized for performance)
create policy "users_select_self" on users
for select using (auth_id = (select auth.uid()));

create policy "users_insert_self" on users
for insert with check (auth_id = (select auth.uid()));

create policy "users_update_self" on users
for update using (auth_id = (select auth.uid()));

create policy "profiles_policy" on profiles
for all using (
  user_id in (
    select id from users where auth_id = (select auth.uid())
  )
);

create policy "worker_profiles_policy" on worker_profiles
for all using (
  user_id in (
    select id from users where auth_id = (select auth.uid())
  )
);

create policy "service_posts_select" on service_posts
for select using (true); -- Public read access

create policy "service_posts_modify" on service_posts
for all using (
  worker_id in (
    select wp.id from worker_profiles wp
    join users u on u.id = wp.user_id
    where u.auth_id = (select auth.uid())
  )
);

create policy "requirements_select" on requirements
for select using (true); -- Public read access

create policy "requirements_modify" on requirements
for all using (
  owner_id in (
    select id from users where auth_id = (select auth.uid())
  )
);

create policy "requirement_applications_policy" on requirement_applications
for all using (
  requirement_id in (
    select r.id from requirements r
    join users u on u.id = r.owner_id
    where u.auth_id = (select auth.uid())
  ) or
  worker_id in (
    select wp.id from worker_profiles wp
    join users u on u.id = wp.user_id
    where u.auth_id = (select auth.uid())
  )
);

create policy "reviews_policy" on reviews
for all using (
  reviewer_id in (
    select id from users where auth_id = (select auth.uid())
  ) or
  worker_id in (
    select wp.id from worker_profiles wp
    join users u on u.id = wp.user_id
    where u.auth_id = (select auth.uid())
  )
);

create policy "messages_policy" on messages
for all using (
  from_id in (
    select id from users where auth_id = (select auth.uid())
  ) or
  to_id in (
    select id from users where auth_id = (select auth.uid())
  )
);

-- Grant permissions
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;

-- Grant public read access to views
grant select on users_view to anon, authenticated;
grant select on service_posts_view to anon, authenticated;
grant select on requirements_view to anon, authenticated;
grant select on workers_view to anon, authenticated;
