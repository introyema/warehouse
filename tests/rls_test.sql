-- =====================================================================
-- «Сховище» — автоматична перевірка прав доступу (RLS)
--
-- Як запустити: Supabase Dashboard → SQL Editor → вставити весь файл → Run.
-- Скрипт сам створює тимчасових тестових користувачів і тестові проєкти,
-- імітує запити від імені анонімного відвідувача, звичайного користувача та
-- адміністратора, а наприкінці видаляє всі тестові дані.
-- Результат — таблиця: кожен рядок має show ok = true. Якщо є false — є проблема з доступом.
-- Попередньо мають бути виконані міграції 001 (і бажано 002).
-- =====================================================================

-- Supabase забороняє прямі DELETE з storage.objects (тригер protect_delete).
-- Для тесту вмикаємо офіційний дозвіл на час цього сеансу; наприкінці вимикаємо.
select set_config('storage.allow_delete_query', 'true', false);

create temp table if not exists rls_results (n serial, test text, ok boolean, details text);
truncate rls_results;

-- Тестові користувачі (видаляються в кінці)
insert into auth.users (id, email, aud, role)
values
  ('aaaaaaaa-0000-0000-0000-00000000a001', 'rls-admin@example.invalid', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-00000000b002', 'rls-user@example.invalid',  'authenticated', 'authenticated')
on conflict (id) do nothing;
insert into public.admins (user_id) values ('aaaaaaaa-0000-0000-0000-00000000a001') on conflict do nothing;

-- Тестові проєкти (створює postgres)
delete from public.projects where slug like 'rlstest-%';
insert into public.projects (slug, title, status, short_description) values
  ('rlstest-draft',     'RLS draft',     'draft',     null),
  ('rlstest-published', 'RLS published', 'published', 'x'),
  ('rlstest-archived',  'RLS archived',  'archived',  'x');

-- Виконує SQL від імені ролі/користувача; повертає 'OK:<кількість рядків>' або 'ERR:<код>'
create or replace function pg_temp.run_as(who text, uid uuid, sql text, claims_extra jsonb default '{}')
returns text language plpgsql as $$
declare n bigint; res text;
begin
  if who = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims',
      (jsonb_build_object('sub', uid, 'role', 'authenticated') || claims_extra)::text, true);
    perform set_config('request.jwt.claim.sub', uid::text, true);
    set local role authenticated;
  end if;
  begin
    execute sql;
    get diagnostics n = row_count;
    res := 'OK:' || n;
  exception when others then
    res := 'ERR:' || sqlstate;
  end;
  reset role;
  return res;
end $$;

create or replace function pg_temp.check(name text, got text, expected text)
returns void language plpgsql as $$
begin
  insert into rls_results (test, ok, details)
  values (name, got like any (string_to_array(expected, '|')), 'отримано ' || got || ', очікувалось ' || expected);
end $$;

do $$
declare
  adm  uuid := 'aaaaaaaa-0000-0000-0000-00000000a001';
  usr  uuid := 'aaaaaaaa-0000-0000-0000-00000000b002';
  r text;
begin
  -- ----- Анонімний відвідувач -----
  perform pg_temp.check('anon: бачить лише опубліковані й архівні (2 з 3 тестових)',
    pg_temp.run_as('anon', null, $q$select * from public.projects where slug like 'rlstest-%'$q$), 'OK:2');
  perform pg_temp.check('anon: чернетка недоступна за slug',
    pg_temp.run_as('anon', null, $q$select * from public.projects where slug = 'rlstest-draft'$q$), 'OK:0');
  perform pg_temp.check('anon: INSERT у projects заборонено',
    pg_temp.run_as('anon', null, $q$insert into public.projects (slug, title) values ('rlstest-anon', 'x')$q$), 'ERR:%');
  perform pg_temp.check('anon: UPDATE заборонено',
    pg_temp.run_as('anon', null, $q$update public.projects set title = 'hack' where slug = 'rlstest-published'$q$), 'ERR:%');
  perform pg_temp.check('anon: публікація чернетки (UPDATE status) заборонена',
    pg_temp.run_as('anon', null, $q$update public.projects set status = 'published' where slug = 'rlstest-draft'$q$), 'ERR:%');
  perform pg_temp.check('anon: DELETE заборонено',
    pg_temp.run_as('anon', null, $q$delete from public.projects where slug = 'rlstest-published'$q$), 'ERR:%');
  perform pg_temp.check('anon: таблиця admins недоступна',
    pg_temp.run_as('anon', null, $q$select * from public.admins$q$), 'ERR:%');
  perform pg_temp.check('anon: is_admin() = false',
    pg_temp.run_as('anon', null, $q$select 1 where public.is_admin()$q$), 'OK:0');
  perform pg_temp.check('anon: запис у storage.objects (project-media) заборонено',
    pg_temp.run_as('anon', null, $q$insert into storage.objects (bucket_id, name) values ('project-media', 'rlstest/anon.png')$q$), 'ERR:%');
  perform pg_temp.check('anon: запис у storage.objects (project-files) заборонено',
    pg_temp.run_as('anon', null, $q$insert into storage.objects (bucket_id, name) values ('project-files', 'rlstest/anon.zip')$q$), 'ERR:%');

  -- ----- Звичайний авторизований користувач (не адміністратор) -----
  perform pg_temp.check('user: бачить лише опубліковані й архівні',
    pg_temp.run_as('auth', usr, $q$select * from public.projects where slug like 'rlstest-%'$q$), 'OK:2');
  perform pg_temp.check('user: INSERT заборонено',
    pg_temp.run_as('auth', usr, $q$insert into public.projects (slug, title) values ('rlstest-user', 'x')$q$), 'ERR:%');
  perform pg_temp.check('user: UPDATE не змінює жодного рядка',
    pg_temp.run_as('auth', usr, $q$update public.projects set title = 'hack' where slug like 'rlstest-%'$q$), 'OK:0');
  perform pg_temp.check('user: публікація чернетки неможлива',
    pg_temp.run_as('auth', usr, $q$update public.projects set status = 'published' where slug = 'rlstest-draft'$q$), 'OK:0');
  perform pg_temp.check('user: DELETE не видаляє жодного рядка',
    pg_temp.run_as('auth', usr, $q$delete from public.projects where slug like 'rlstest-%'$q$), 'OK:0');
  perform pg_temp.check('user: таблиця admins недоступна (читання)',
    pg_temp.run_as('auth', usr, $q$select * from public.admins$q$), 'ERR:%');
  perform pg_temp.check('user: не може призначити себе адміністратором',
    pg_temp.run_as('auth', usr, format($q$insert into public.admins (user_id) values (%L)$q$, usr), '{}'), 'ERR:%');
  perform pg_temp.check('user: is_admin() = false',
    pg_temp.run_as('auth', usr, $q$select 1 where public.is_admin()$q$), 'OK:0');
  perform pg_temp.check('user з user_metadata {is_admin:true} / app_metadata: усе одно не адмін',
    pg_temp.run_as('auth', usr, $q$insert into public.projects (slug, title) values ('rlstest-meta', 'x')$q$,
      '{"user_metadata": {"is_admin": true, "role": "admin"}, "app_metadata": {"role": "admin"}}'), 'ERR:%');
  perform pg_temp.check('user: запис у storage.objects заборонено',
    pg_temp.run_as('auth', usr, $q$insert into storage.objects (bucket_id, name) values ('project-media', 'rlstest/user.png')$q$), 'ERR:%');

  -- ----- Адміністратор -----
  perform pg_temp.check('admin: is_admin() = true',
    pg_temp.run_as('auth', adm, $q$select 1 where public.is_admin()$q$), 'OK:1');
  perform pg_temp.check('admin: бачить усі 3 тестові проєкти (разом із чернеткою)',
    pg_temp.run_as('auth', adm, $q$select * from public.projects where slug like 'rlstest-%'$q$), 'OK:3');
  perform pg_temp.check('admin: INSERT працює',
    pg_temp.run_as('auth', adm, $q$insert into public.projects (slug, title) values ('rlstest-new', 'Новий')$q$), 'OK:1');
  perform pg_temp.check('admin: UPDATE працює',
    pg_temp.run_as('auth', adm, $q$update public.projects set title = 'Змінено' where slug = 'rlstest-new'$q$), 'OK:1');
  perform pg_temp.check('admin: публікація без короткого опису відхиляється обмеженням',
    pg_temp.run_as('auth', adm, $q$update public.projects set status = 'published' where slug = 'rlstest-new'$q$), 'ERR:23514');
  perform pg_temp.check('admin: публікація з коротким описом працює',
    pg_temp.run_as('auth', adm, $q$update public.projects set status = 'published', short_description = 'ok' where slug = 'rlstest-new'$q$), 'OK:1');
  perform pg_temp.check('admin: зняття з публікації працює',
    pg_temp.run_as('auth', adm, $q$update public.projects set status = 'draft' where slug = 'rlstest-new'$q$), 'OK:1');
  perform pg_temp.check('admin: некоректний slug відхиляється',
    pg_temp.run_as('auth', adm, $q$insert into public.projects (slug, title) values ('Bad Slug!', 'x')$q$), 'ERR:23514');
  perform pg_temp.check('admin: посилання javascript: у download_url відхиляється',
    pg_temp.run_as('auth', adm, $q$update public.projects set download_url = 'javascript:alert(1)' where slug = 'rlstest-new'$q$), 'ERR:23514');
  perform pg_temp.check('admin: посилання https:// у download_url приймається',
    pg_temp.run_as('auth', adm, $q$update public.projects set download_url = 'https://example.com/a.zip' where slug = 'rlstest-new'$q$), 'OK:1');
  perform pg_temp.check('admin: DELETE працює',
    pg_temp.run_as('auth', adm, $q$delete from public.projects where slug = 'rlstest-new'$q$), 'OK:1');
  perform pg_temp.check('admin: завантаження зображення (storage.objects INSERT) дозволено',
    pg_temp.run_as('auth', adm, $q$insert into storage.objects (bucket_id, name) values ('project-media', 'rlstest/admin.png')$q$), 'OK:1');
  perform pg_temp.check('user: не може видалити файл адміністратора',
    pg_temp.run_as('auth', usr, $q$delete from storage.objects where name = 'rlstest/admin.png'$q$), 'OK:0');
  perform pg_temp.check('anon: не може видалити файл (0 рядків або помилка)',
    pg_temp.run_as('anon', null, $q$delete from storage.objects where name = 'rlstest/admin.png'$q$), 'OK:0|ERR:%');
  perform pg_temp.check('admin: видалення файлу дозволено',
    pg_temp.run_as('auth', adm, $q$delete from storage.objects where name = 'rlstest/admin.png'$q$), 'OK:1');

  -- ----- Структурні перевірки -----
  insert into rls_results (test, ok, details)
  select 'RLS увімкнено для public.' || c.relname, c.relrowsecurity, ''
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r';

  insert into rls_results (test, ok, details)
  select 'бакет ' || b.id || ': є ліміт розміру та типи файлів',
         b.file_size_limit is not null and b.allowed_mime_types is not null, coalesce(b.file_size_limit::text, 'немає')
  from storage.buckets b where b.id in ('project-media', 'project-files');

  insert into rls_results (test, ok, details)
  select 'бакетів project-media та project-files рівно 2', count(*) = 2, count(*)::text
  from storage.buckets b where b.id in ('project-media', 'project-files');
end $$;

-- Прибирання
delete from storage.objects where name like 'rlstest/%';
delete from public.projects where slug like 'rlstest-%';
delete from public.admins where user_id = 'aaaaaaaa-0000-0000-0000-00000000a001';
delete from auth.users where id in ('aaaaaaaa-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-00000000b002');

select set_config('storage.allow_delete_query', 'false', false);

-- РЕЗУЛЬТАТ: усі рядки мають бути ok = true
select n, ok, test, details from rls_results order by n;
