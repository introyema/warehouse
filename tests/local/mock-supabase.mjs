// Імітація Supabase (Auth + REST + Storage) для перевірки інтерфейсу адмін-панелі в браузері без
// справжнього проєкту. Це ТЕСТОВА ЗАГЛУШКА: вона НЕ перевіряє справжні політики RLS (їх перевіряє
// tests/rls_test.sql та npm test), а лише поведінку інтерфейсу. Запуск: node mock-supabase.mjs
// Потім відкрийте http://127.0.0.1:54321/ (сайт) та http://127.0.0.1:54321/admin/ (адмін-панель).
// Облікові дані: admin@test.local / pw (адміністратор), user@test.local / pw (звичайний користувач).
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 54321;
const base = `http://127.0.0.1:${PORT}`;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };

const USERS = {
  "admin@test.local": { id: "11111111-1111-1111-1111-111111111111", token: "admin-token", admin: true },
  "user@test.local": { id: "22222222-2222-2222-2222-222222222222", token: "user-token", admin: false }
};
const byToken = (t) => Object.entries(USERS).find(([, u]) => u.token === t);

let seq = 0;
const now = () => new Date(Date.now() + seq++).toISOString();
const projects = [
  { id: "00000000-0000-4000-8000-000000000001", slug: "million-depth-example", title: "Український переклад Million Depth", game: "Million Depth", category: "ukrainizer", short_description: "Приклад", description: null, status: "published", progress: "wip", version: "0.1", updated_on: "2025-01-15", features: ["Меню"], changes: [], dependencies: [], conflicts: [], installation: ["Крок 1"], screenshots: [], is_example: true, sort_order: 10, created_at: now(), updated_at: now() },
  { id: "00000000-0000-4000-8000-000000000002", slug: "secret-draft", title: "Секретна чернетка", category: "mod", status: "draft", features: [], changes: [], dependencies: [], conflicts: [], installation: [], screenshots: [], sort_order: 20, created_at: now(), updated_at: now() },
  { id: "00000000-0000-4000-8000-000000000003", slug: "old-one", title: "Архівний приклад", category: "tool", short_description: "x", status: "archived", features: [], changes: [], dependencies: [], conflicts: [], installation: [], screenshots: [], sort_order: 30, created_at: now(), updated_at: now() }
];
const storage = new Map(); // "bucket/path" -> {type, size}
export const log = [];

const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*", "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? "" : (typeof body === "string" || Buffer.isBuffer(body)) ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, base);
  const p = decodeURIComponent(url.pathname);
  if (req.method === "OPTIONS") return send(res, 204);
  const auth = (req.headers.authorization || "").replace("Bearer ", "");
  const found = byToken(auth);
  const user = found ? found[1] : null;
  const isAdmin = !!(user && user.admin);

  if (p === "/__log") return send(res, 200, log);
  // --- статичні файли сайту ---
  if (!p.startsWith("/auth/") && !p.startsWith("/rest/") && !p.startsWith("/storage/")) {
    if (p === "/data/supabase-config.js") return send(res, 200, `window.SUPABASE_CONFIG = { url: "${base}", anonKey: "test-anon-key" };`, { "Content-Type": "text/javascript" });
    let f = join(root, p === "/" ? "index.html" : p);
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
    if (!existsSync(f)) return send(res, 404, "not found", { "Content-Type": "text/plain" });
    return send(res, 200, readFileSync(f), { "Content-Type": MIME[extname(f)] || "application/octet-stream" });
  }

  // --- Auth ---
  if (p === "/auth/v1/token") {
    const b = JSON.parse((await readBody(req)).toString() || "{}");
    if (url.searchParams.get("grant_type") === "password") {
      const u = USERS[b.email];
      if (!u || b.password !== "pw") return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      return send(res, 200, { access_token: u.token, refresh_token: "r-" + u.token, expires_in: 3600, user: { id: u.id, email: b.email } });
    }
    const e = Object.entries(USERS).find(([, u]) => "r-" + u.token === b.refresh_token);
    if (!e) return send(res, 400, { error: "invalid_grant" });
    return send(res, 200, { access_token: e[1].token, refresh_token: b.refresh_token, expires_in: 3600, user: { id: e[1].id, email: e[0] } });
  }
  if (p === "/auth/v1/logout") return send(res, 204);

  // --- REST ---
  if (p === "/rest/v1/rpc/is_admin") return send(res, 200, JSON.stringify(isAdmin));
  if (p.startsWith("/rest/v1/projects")) {
    const visible = (r) => isAdmin || r.status === "published" || r.status === "archived";
    const idEq = (url.searchParams.get("id") || "").replace("eq.", "");
    const target = () => projects.filter((r) => visible(r) && (!idEq || r.id === idEq));
    if (req.method === "GET") return send(res, 200, target().slice().sort((a, b) => a.sort_order - b.sort_order));
    if (!isAdmin) return send(res, req.method === "POST" ? 403 : 200, req.method === "POST" ? { code: "42501", message: "new row violates row-level security policy" } : []);
    if (req.method === "POST") {
      const row = JSON.parse((await readBody(req)).toString());
      if (projects.some((r) => r.slug === row.slug)) return send(res, 409, { code: "23505", message: 'duplicate key value violates unique constraint "projects_slug_key"' });
      if (row.status !== "draft" && !(row.short_description || "").trim()) return send(res, 400, { code: "23514", message: "violates check constraint projects_publish_requires_description" });
      const rec = { ...row, created_at: now(), updated_at: now() };
      projects.push(rec); log.push(["insert", rec.slug]);
      return send(res, 201, [rec]);
    }
    if (req.method === "PATCH") {
      const patch = JSON.parse((await readBody(req)).toString());
      const t = target();
      t.forEach((r) => Object.assign(r, patch, { updated_at: now() }));
      log.push(["update", t.map((r) => r.slug)]);
      return send(res, 200, t);
    }
    if (req.method === "DELETE") {
      const t = target();
      t.forEach((r) => projects.splice(projects.indexOf(r), 1));
      log.push(["delete", t.map((r) => r.slug)]);
      return send(res, 200, t);
    }
  }

  // --- Storage ---
  const pub = /^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/.exec(p);
  if (pub && req.method === "GET") {
    const o = storage.get(pub[1] + "/" + pub[2]);
    if (!o) return send(res, 404, { error: "not found" });
    return send(res, 200, o.buf, { "Content-Type": o.type });
  }
  const up = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(p);
  if (up && req.method === "POST") {
    if (!isAdmin) return send(res, 403, { error: "Unauthorized", message: "new row violates row-level security policy" });
    const buf = await readBody(req);
    if (buf.length > 5 * 1024 * 1024 && up[1] === "project-media") return send(res, 413, { error: "Payload too large", message: "The object exceeded the maximum allowed size" });
    storage.set(up[1] + "/" + up[2], { type: req.headers["content-type"], buf });
    log.push(["upload", up[1] + "/" + up[2]]);
    return send(res, 200, { Key: up[1] + "/" + up[2] });
  }
  const del = /^\/storage\/v1\/object\/([^/]+)$/.exec(p);
  if (del && req.method === "DELETE") {
    if (!isAdmin) return send(res, 403, { error: "Unauthorized" });
    const b = JSON.parse((await readBody(req)).toString());
    b.prefixes.forEach((x) => { storage.delete(del[1] + "/" + x); log.push(["remove", del[1] + "/" + x]); });
    return send(res, 200, []);
  }
  if (p === "/__log") return send(res, 200, log);
  send(res, 404, { error: "unknown" });
}).listen(PORT, "127.0.0.1", () => console.log("Імітація Supabase + сайт: " + base));
