-- =====================================================================
-- «Сховище» — міграція 001: таблиці, безпека (RLS) та сховище файлів
-- Безпечно запускати повторно (використовує IF NOT EXISTS / DROP IF EXISTS).
-- Виконується у Supabase Dashboard → SQL Editor.
-- =====================================================================

-- ---------- 1. Адміністратори ----------
-- Приватна таблиця дозволених користувачів. Через API вона НЕДОСТУПНА нікому
-- (RLS увімкнено, політик немає, права відкликано). Змінювати її можна лише
-- з SQL Editor (під роллю postgres).
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on table public.admins from public, anon, authenticated;

-- Безпечна функція перевірки: чи поточний користувач є адміністратором.
-- Працює з правами власника (security definer), тому читає admins попри RLS.
-- Ґрунтується ЛИШЕ на auth.uid() із перевіреного токена, а не на user_metadata.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins a where a.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------- 2. Проєкти ----------
create table if not exists public.projects (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique
                      check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  title             text not null check (length(btrim(title)) between 1 and 200),
  game              text check (length(game) <= 200),
  category          text not null default 'other'
                      check (category in ('ukrainizer', 'mod', 'addon', 'tool', 'other')),
  short_description text check (length(short_description) <= 500),
  description       text check (length(description) <= 20000),
  -- status: публікація. draft — прихований; published — видимий; archived — видимий як архівний
  status            text not null default 'draft'
                      check (status in ('draft', 'published', 'archived')),
  -- progress: стан розробки (необов'язково)
  progress          text check (progress in ('done', 'wip')),
  version           text check (length(version) <= 50),
  updated_on        date,                       -- «дата оновлення» проєкту, яку вказує автор
  compatibility     text check (length(compatibility) <= 500),
  requirements      text check (length(requirements) <= 2000),
  features          text[] not null default '{}',
  changes           text[] not null default '{}',
  dependencies      text[] not null default '{}',
  conflicts         text[] not null default '{}',
  installation      text[] not null default '{}',
  cover_path        text check (cover_path !~ '\.\.' and length(cover_path) <= 300),
  -- [{ "path": "...", "caption": "...", "alt": "..." }, ...]
  screenshots       jsonb not null default '[]'::jsonb
                      check (jsonb_typeof(screenshots) = 'array' and jsonb_array_length(screenshots) <= 40),
  -- зовнішнє пряме посилання на файл (GitHub Releases тощо)
  download_url      text check (download_url ~* '^https?://' and length(download_url) <= 2000),
  -- або файл у Storage: { "path": "...", "name": "...", "size": 123 }
  download_file     jsonb check (jsonb_typeof(download_file) = 'object'),
  source_url        text check (source_url ~* '^https?://' and length(source_url) <= 2000),
  guide_url         text check (guide_url ~* '^https?://' and length(guide_url) <= 2000),
  credits           text check (length(credits) <= 5000),
  author            text check (length(author) <= 200),
  license           text check (length(license) <= 200),
  is_example        boolean not null default false,
  sort_order        integer not null default 100,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- не можна опублікувати без короткого опису
  constraint projects_publish_requires_description
    check (status = 'draft' or length(btrim(coalesce(short_description, ''))) > 0)
);

create index if not exists projects_status_sort_idx on public.projects (status, sort_order);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------- 3. RLS для projects ----------
alter table public.projects enable row level security;

revoke all on table public.projects from public, anon, authenticated;
grant select on table public.projects to anon;
grant select, insert, update, delete on table public.projects to authenticated;

drop policy if exists "projects_public_read"  on public.projects;
drop policy if exists "projects_admin_read"   on public.projects;
drop policy if exists "projects_admin_insert" on public.projects;
drop policy if exists "projects_admin_update" on public.projects;
drop policy if exists "projects_admin_delete" on public.projects;

-- Усі (включно з анонімами) бачать лише опубліковані та архівні проєкти
create policy "projects_public_read" on public.projects
  for select to anon, authenticated
  using (status in ('published', 'archived'));

-- Адміністратор бачить усе, зокрема чернетки
create policy "projects_admin_read" on public.projects
  for select to authenticated
  using ((select public.is_admin()));

create policy "projects_admin_insert" on public.projects
  for insert to authenticated
  with check ((select public.is_admin()));

create policy "projects_admin_update" on public.projects
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "projects_admin_delete" on public.projects
  for delete to authenticated
  using ((select public.is_admin()));

-- ---------- 4. Storage: бакети ----------
-- project-media: обкладинки та скриншоти (до 5 МБ, лише зображення)
-- project-files: архіви українізаторів і модів (до 50 МБ — максимум безкоштовного плану Supabase)
-- Обидва бакети публічні ЛИШЕ ДЛЯ ЧИТАННЯ за прямим посиланням; запис — тільки адміністратор.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('project-media', 'project-media', true, 5242880,
     array['image/jpeg', 'image/png', 'image/webp']),
  ('project-files', 'project-files', true, 52428800,
     array['application/zip', 'application/x-zip-compressed', 'application/x-7z-compressed',
           'application/vnd.rar', 'application/x-rar-compressed', 'application/octet-stream'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------- 5. Storage: політики ----------
-- Публічної політики SELECT немає навмисно: файли віддаються за прямим публічним
-- посиланням, але анонім не може переглядати список файлів через API.
drop policy if exists "shovyshche_admin_select" on storage.objects;
drop policy if exists "shovyshche_admin_insert" on storage.objects;
drop policy if exists "shovyshche_admin_update" on storage.objects;
drop policy if exists "shovyshche_admin_delete" on storage.objects;

create policy "shovyshche_admin_select" on storage.objects
  for select to authenticated
  using (bucket_id in ('project-media', 'project-files') and (select public.is_admin()));

create policy "shovyshche_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('project-media', 'project-files') and (select public.is_admin()));

create policy "shovyshche_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id in ('project-media', 'project-files') and (select public.is_admin()))
  with check (bucket_id in ('project-media', 'project-files') and (select public.is_admin()));

create policy "shovyshche_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id in ('project-media', 'project-files') and (select public.is_admin()));
