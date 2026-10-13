/* Мінімальний клієнт Supabase (без сторонніх бібліотек): вхід, таблиця projects, Storage.
   Використовує ЛИШЕ публічний ключ із data/supabase-config.js та токен користувача.
   Справжній захист даних забезпечують політики RLS у базі, а не цей код. */
(function () {
  "use strict";

  var KEY = "shovyshche.admin.session";
  var cfg = null;
  var session = null;

  function store(op, value) {
    try {
      if (op === "get") return localStorage.getItem(KEY);
      if (op === "set") localStorage.setItem(KEY, value);
      if (op === "del") localStorage.removeItem(KEY);
    } catch (e) { /* сховище може бути недоступним */ }
    return null;
  }

  function SBError(message, status, code) {
    var e = new Error(message);
    e.status = status;
    e.code = code;
    return e;
  }

  function saveSession(s) {
    session = {
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      expires_at: s.expires_at || (Math.floor(Date.now() / 1000) + (s.expires_in || 3600)),
      user: s.user
    };
    store("set", JSON.stringify(session));
    return session;
  }

  function parseError(res, body) {
    var msg = (body && (body.msg || body.message || body.error_description || body.error)) || ("Помилка " + res.status);
    return SBError(msg, res.status, body && (body.code || body.error_code || body.error));
  }

  function request(url, opts) {
    return fetch(url, opts).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        if (text) { try { body = JSON.parse(text); } catch (e) { body = text; } }
        if (!res.ok) throw parseError(res, body);
        return body;
      });
    }, function () {
      throw SBError("Немає з'єднання з сервером. Перевірте інтернет.", 0, "network");
    });
  }

  function refresh() {
    if (!session || !session.refresh_token) return Promise.reject(SBError("Сесія завершена", 401, "no_session"));
    return request(cfg.url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    }).then(saveSession).catch(function (e) {
      if (e.status === 400 || e.status === 401) { session = null; store("del"); }
      throw e;
    });
  }

  function freshToken() {
    if (!session) return Promise.reject(SBError("Потрібен вхід", 401, "no_session"));
    if (session.expires_at - 60 > Date.now() / 1000) return Promise.resolve(session.access_token);
    return refresh().then(function (s) { return s.access_token; });
  }

  function authHeaders(token, extra) {
    var h = { apikey: cfg.anonKey, Authorization: "Bearer " + token };
    Object.keys(extra || {}).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  function rest(path, opts) {
    opts = opts || {};
    return freshToken().then(function (token) {
      var headers = authHeaders(token, opts.headers || {});
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
      return request(cfg.url + "/rest/v1/" + path, {
        method: opts.method || "GET",
        headers: headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
      });
    });
  }

  var SB = {
    init: function (c) {
      cfg = c;
      var raw = store("get");
      if (raw) { try { session = JSON.parse(raw); } catch (e) { session = null; } }
      if (session && (!session.access_token || !session.refresh_token)) session = null;
    },
    hasSession: function () { return !!session; },
    user: function () { return session && session.user; },

    signIn: function (email, password) {
      return request(cfg.url + "/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, password: password })
      }).then(saveSession);
    },

    signOut: function () {
      var s = session;
      session = null;
      store("del");
      if (!s) return Promise.resolve();
      return request(cfg.url + "/auth/v1/logout", {
        method: "POST",
        headers: authHeaders(s.access_token)
      }).catch(function () { /* токен і так видалено локально */ });
    },

    /* Чи є поточний користувач адміністратором (перевірка на боці бази) */
    isAdmin: function () {
      return rest("rpc/is_admin", { method: "POST", body: {} }).then(function (r) { return r === true; });
    },

    listProjects: function () {
      return rest("projects?select=*&order=sort_order.asc,updated_at.desc");
    },
    getProject: function (id) {
      return rest("projects?select=*&id=eq." + encodeURIComponent(id)).then(function (rows) { return rows && rows[0]; });
    },
    insertProject: function (row) {
      return rest("projects", { method: "POST", body: row, headers: { Prefer: "return=representation" } })
        .then(function (rows) { return rows[0]; });
    },
    updateProject: function (id, row) {
      return rest("projects?id=eq." + encodeURIComponent(id), { method: "PATCH", body: row, headers: { Prefer: "return=representation" } })
        .then(function (rows) {
          if (!rows || !rows.length) throw SBError("Запис не оновлено: немає прав або проєкт видалено.", 403, "no_rows");
          return rows[0];
        });
    },
    deleteProject: function (id) {
      return rest("projects?id=eq." + encodeURIComponent(id), { method: "DELETE", headers: { Prefer: "return=representation" } })
        .then(function (rows) {
          if (!rows || !rows.length) throw SBError("Проєкт не видалено: немає прав або він уже видалений.", 403, "no_rows");
        });
    },

    /* Завантаження файлу у Storage з індикатором прогресу (XMLHttpRequest) */
    upload: function (bucket, path, file, onProgress) {
      return freshToken().then(function (token) {
        return new Promise(function (resolve, reject) {
          var xhr = new XMLHttpRequest();
          var url = cfg.url + "/storage/v1/object/" + bucket + "/" + path.split("/").map(encodeURIComponent).join("/");
          xhr.open("POST", url);
          xhr.setRequestHeader("apikey", cfg.anonKey);
          xhr.setRequestHeader("Authorization", "Bearer " + token);
          xhr.setRequestHeader("x-upsert", "false");
          xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
          xhr.upload.onprogress = function (e) {
            if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
          };
          xhr.onerror = function () { reject(SBError("Немає з'єднання з сервером.", 0, "network")); };
          xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) { resolve(path); return; }
            var body = null;
            try { body = JSON.parse(xhr.responseText); } catch (e) { body = null; }
            var err = SBError((body && (body.message || body.error)) || ("Помилка завантаження " + xhr.status), xhr.status, body && body.error);
            reject(err);
          };
          xhr.send(file);
        });
      });
    },

    removeFiles: function (bucket, paths) {
      if (!paths.length) return Promise.resolve();
      return freshToken().then(function (token) {
        return request(cfg.url + "/storage/v1/object/" + bucket, {
          method: "DELETE",
          headers: authHeaders(token, { "Content-Type": "application/json" }),
          body: JSON.stringify({ prefixes: paths })
        });
      });
    }
  };

  window.SB = SB;
})();
