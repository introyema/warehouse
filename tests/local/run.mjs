// Локальна перевірка міграцій та RLS без Supabase: використовує вбудований PostgreSQL (PGlite).
// Тут імітується мінімум Supabase (ролі anon/authenticated, схеми auth та storage).
// Це НЕ заміна перевірці на справжньому проєкті Supabase (tests/rls_test.sql), але ловить
// помилки в SQL і в логіці політик. Запуск:  npm install  та  npm test
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const db = new PGlite();

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, aud text, role text);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.protect_delete() returns trigger language plpgsql as $$
  begin
    if coalesce(current_setting('storage.allow_delete_query', true), 'false') <> 'true' then
      raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.' using errcode = '42501';
    end if;
    return null;
  end $$;
  create trigger protect_objects_delete before delete on storage.objects
    for each statement execute function storage.protect_delete();
  grant usage on schema auth, storage, public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant all on storage.objects, storage.buckets to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
`);

for (const f of ["supabase/migrations/001_schema_and_security.sql", "supabase/migrations/002_import_existing_projects.sql"]) {
  let sql = read(f);
  // Негативний контроль: WEAKEN=1 навмисно послаблює політики — тести МАЮТЬ провалитись
  if (process.env.WEAKEN) sql = sql.replaceAll("with check ((select public.is_admin()))", "with check (true)");
  await db.exec(sql);
  console.log("міграція виконана:", f);
}
// Повторний запуск має бути безпечним (ідемпотентність)
for (const f of ["supabase/migrations/001_schema_and_security.sql", "supabase/migrations/002_import_existing_projects.sql"]) {
  let sql = read(f);
  if (process.env.WEAKEN) sql = sql.replaceAll("with check ((select public.is_admin()))", "with check (true)");
  await db.exec(sql);
}
console.log("повторний запуск міграцій: без помилок");

const count = await db.query("select count(*)::int as n from public.projects");
console.log("проєктів після імпорту:", count.rows[0].n);

const results = await db.exec(read("tests/rls_test.sql"));
const rows = results[results.length - 1].rows;
let failed = 0;
for (const r of rows) {
  if (!r.ok) failed++;
  console.log(r.ok ? "  OK   " : "  FAIL ", r.test, r.ok ? "" : "— " + r.details);
}
console.log(`\nПеревірок: ${rows.length}, невдалих: ${failed}`);
process.exit(failed ? 1 : 0);
