// Перевірка безпеки НА ВАШОМУ СПРАВЖНЬОМУ проєкті Supabase через публічний API (негативні сценарії).
// Потрібен Node.js 18+. Використовує лише ПУБЛІЧНІ значення (url і anon/publishable key).
//
// Запуск (PowerShell), з папки сайту:
//   $env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_ANON_KEY="sb_publishable_..."; node tests/live_api_check.mjs
// Необов'язково — перевірка від імені ЗВИЧАЙНОГО (не адміністратора) користувача:
//   $env:USER_EMAIL="..."; $env:USER_PASSWORD="..."   (створіть такого користувача в Dashboard → Authentication)
// Скрипт НЕ змінює і не створює жодних даних, якщо захист працює. Якщо захист зламано, він
// спробує вставити тестовий рядок із slug "apicheck-*" і повідомить про це — тоді видаліть його вручну.

const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const key = process.env.SUPABASE_ANON_KEY || "";
if (!url || !key) { console.error("Вкажіть SUPABASE_URL та SUPABASE_ANON_KEY"); process.exit(2); }

let failed = 0;
const report = (ok, name, extra = "") => { if (!ok) failed++; console.log((ok ? "  OK   " : "  FAIL ") + name + (extra ? " — " + extra : "")); };
const api = (path, { token, method = "GET", body, headers = {} } = {}) =>
  fetch(url + path, { method, headers: { apikey: key, ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

async function suite(label, token) {
  console.log("\n" + label);
  let r = await api("/rest/v1/projects?select=slug,status", { token });
  const rows = r.ok ? await r.json() : [];
  report(r.ok, "читання каталогу працює", "HTTP " + r.status);
  report(rows.every((x) => x.status === "published" || x.status === "archived"), "серед прочитаного немає чернеток", rows.length + " проєктів");

  r = await api("/rest/v1/projects", { token, method: "POST", body: { slug: "apicheck-" + Date.now(), title: "apicheck" }, headers: { Prefer: "return=representation" } });
  report(r.status === 401 || r.status === 403, "створення проєкту відхилено", "HTTP " + r.status);

  r = await api("/rest/v1/projects?slug=like.*", { token, method: "PATCH", body: { title: "hacked" }, headers: { Prefer: "return=representation" } });
  const patched = r.ok ? await r.json() : [];
  report(patched.length === 0, "зміна проєктів не змінила жодного рядка", "HTTP " + r.status + ", змінено " + patched.length);

  r = await api("/rest/v1/projects?status=eq.draft", { token, method: "PATCH", body: { status: "published" }, headers: { Prefer: "return=representation" } });
  const pub = r.ok ? await r.json() : [];
  report(pub.length === 0, "публікація чернеток відхилена", "змінено " + pub.length);

  r = await api("/rest/v1/projects?slug=like.*", { token, method: "DELETE", headers: { Prefer: "return=representation" } });
  const del = r.ok ? await r.json() : [];
  report(del.length === 0, "видалення проєктів не видалило жодного рядка", "HTTP " + r.status + ", видалено " + del.length);

  r = await api("/rest/v1/admins?select=*", { token });
  const adm = r.ok ? await r.json() : [];
  report(!r.ok || adm.length === 0, "таблиця admins недоступна", "HTTP " + r.status);

  r = await api("/rest/v1/admins", { token, method: "POST", body: { user_id: "00000000-0000-0000-0000-000000000000" } });
  report(r.status >= 400, "самопризначення адміністратором відхилено", "HTTP " + r.status);

  r = await api("/rest/v1/rpc/is_admin", { token, method: "POST", body: {} });
  report(r.ok && (await r.json()) === false, "is_admin() повертає false");

  for (const bucket of ["project-media", "project-files"]) {
    const r1 = await fetch(`${url}/storage/v1/object/${bucket}/apicheck/${Date.now()}.zip`, { method: "POST", headers: { apikey: key, ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/octet-stream" }, body: "x" });
    report(r1.status === 400 || r1.status === 401 || r1.status === 403, `завантаження у ${bucket} відхилено`, "HTTP " + r1.status);
    const r2 = await fetch(`${url}/storage/v1/object/${bucket}`, { method: "DELETE", headers: { apikey: key, ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: ["anything.png"] }) });
    const b2 = r2.ok ? await r2.json().catch(() => []) : [];
    report(!r2.ok || (Array.isArray(b2) && b2.length === 0), `видалення у ${bucket} нічого не видалило`, "HTTP " + r2.status);
    const r3 = await fetch(`${url}/storage/v1/object/list/${bucket}`, { method: "POST", headers: { apikey: key, ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" }, body: JSON.stringify({ prefix: "", limit: 5 }) });
    const b3 = r3.ok ? await r3.json().catch(() => []) : [];
    report(!r3.ok || (Array.isArray(b3) && b3.length === 0), `анонім/користувач не бачить список файлів у ${bucket}`, "HTTP " + r3.status);
  }
}

await suite("== Анонімний відвідувач ==", null);

if (process.env.USER_EMAIL && process.env.USER_PASSWORD) {
  const r = await api("/auth/v1/token?grant_type=password", { method: "POST", body: { email: process.env.USER_EMAIL, password: process.env.USER_PASSWORD } });
  if (!r.ok) { console.log("\nНе вдалося увійти як звичайний користувач: HTTP " + r.status); failed++; }
  else await suite("== Звичайний користувач (не адміністратор) ==", (await r.json()).access_token);
} else {
  console.log("\n(Перевірку звичайного користувача пропущено: не задано USER_EMAIL / USER_PASSWORD.)");
}

// Самореєстрація має бути вимкнена
const su = await api("/auth/v1/signup", { method: "POST", body: { email: "apicheck-" + Date.now() + "@example.invalid", password: "Check-" + Date.now() + "-xY9!" } });
const sb = await su.json().catch(() => ({}));
report(su.status >= 400 && /disabled|not allowed|signup/i.test(JSON.stringify(sb)), "самореєстрація вимкнена", "HTTP " + su.status + " " + (sb.msg || sb.message || ""));

console.log(`\nНевдалих перевірок: ${failed}`);
process.exit(failed ? 1 : 0);
