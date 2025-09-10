-- Enable Row Level Security
alter table users enable row level security;
alter table profiles enable row level security;
alter table worker_profiles enable row level security;
alter table service_posts enable row level security;
alter table requirements enable row level security;
alter table requirement_applications enable row level security;

-- Helper: get current app user id (from users.auth_id)
create or replace function public.current_user_id()
returns uuid language sql stable as $$
  select id from users where auth_id = auth.uid();
$$;

-- USERS
drop policy if exists users_select_self on users;
create policy users_select_self on users
for select
to authenticated
using (auth_id = auth.uid());

drop policy if exists users_upsert_self on users;
create policy users_upsert_self on users
for insert to authenticated
with check (auth_id = auth.uid());
drop policy if exists users_update_self on users;
create policy users_update_self on users
for update to authenticated
using (auth_id = auth.uid())
with check (auth_id = auth.uid());

-- PROFILES
drop policy if exists profiles_read_all on profiles;
create policy profiles_read_all on profiles for select to authenticated using (true);

drop policy if exists profiles_write_own on profiles;
create policy profiles_write_own on profiles
for insert to authenticated
with check (user_id = public.current_user_id());
drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles
for update to authenticated
using (user_id = public.current_user_id())
with check (user_id = public.current_user_id());

-- WORKER PROFILES
drop policy if exists worker_profiles_read_all on worker_profiles;
create policy worker_profiles_read_all on worker_profiles for select to authenticated using (true);
drop policy if exists worker_profiles_write_own on worker_profiles;
create policy worker_profiles_write_own on worker_profiles
for insert to authenticated
with check (user_id = public.current_user_id());
drop policy if exists worker_profiles_update_own on worker_profiles;
create policy worker_profiles_update_own on worker_profiles
for update to authenticated
using (user_id = public.current_user_id())
with check (user_id = public.current_user_id());

-- SERVICE POSTS
drop policy if exists service_posts_read_active on service_posts;
create policy service_posts_read_active on service_posts for select to anon using (is_active);
drop policy if exists service_posts_write_own on service_posts;
create policy service_posts_write_own on service_posts
for insert to authenticated
with check (worker_id in (select id from worker_profiles where user_id = public.current_user_id()));
drop policy if exists service_posts_update_own on service_posts;
create policy service_posts_update_own on service_posts
for update to authenticated
using (worker_id in (select id from worker_profiles where user_id = public.current_user_id()))
with check (worker_id in (select id from worker_profiles where user_id = public.current_user_id()));

-- REQUIREMENTS
drop policy if exists requirements_read_open on requirements;
create policy requirements_read_open on requirements for select to anon using (is_open);
drop policy if exists requirements_write_own on requirements;
create policy requirements_write_own on requirements
for insert to authenticated
with check (owner_id = public.current_user_id());
drop policy if exists requirements_update_own on requirements;
create policy requirements_update_own on requirements
for update to authenticated
using (owner_id = public.current_user_id())
with check (owner_id = public.current_user_id());

-- REQUIREMENT APPLICATIONS
drop policy if exists req_apps_read_own on requirement_applications;
create policy req_apps_read_own on requirement_applications for select to authenticated using (
  worker_id in (select id from worker_profiles where user_id = public.current_user_id())
);
drop policy if exists req_apps_insert_own on requirement_applications;
create policy req_apps_insert_own on requirement_applications
for insert to authenticated
with check (
  worker_id in (select id from worker_profiles where user_id = public.current_user_id())
);
