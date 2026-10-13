/* Адмін-панель «Сховища». Вхід, перелік проєктів, форма, зображення, файли, попередній перегляд.
   Права доступу забезпечує база даних (RLS), цей код лише надає зручний інтерфейс. */
(function () {
  "use strict";

  var C = window.Catalog;
  var SB = window.SB;
  var el = C.el;
  C.base = "../";

  var MAX_IMAGE = 5 * 1024 * 1024;
  var MAX_ARCHIVE = 50 * 1024 * 1024;
  var IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  var ARCHIVE_EXT = ["zip", "7z", "rar"];

  var CATS = [["ukrainizer", "Українізатор"], ["mod", "Мод"], ["addon", "Доповнення"], ["tool", "Інструмент"], ["other", "Інше"]];
  var STATUS_LABEL = { draft: "Чернетка", published: "Опубліковано", archived: "Архівний" };
  var PROGRESS = [["", "— не вказувати —"], ["wip", "У розробці"], ["done", "Завершено"]];

  var rows = [];            // усі проєкти (адміністратор бачить і чернетки)
  var listFilter = { q: "", category: "", status: "" };
  var form = null;          // стан відкритої форми

  function $(id) { return document.getElementById(id); }

  /* ---------- Загальні утиліти ---------- */
  var toastTimer;
  function toast(msg, isError) {
    var t = $("toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, isError ? 8000 : 3500);
  }

  function confirmDialog(text, yesLabel) {
    return new Promise(function (resolve) {
      var d = $("confirm-dialog");
      $("confirm-text").textContent = text;
      $("confirm-yes").textContent = yesLabel || "Підтвердити";
      function finish(v) {
        $("confirm-yes").onclick = null; $("confirm-no").onclick = null; d.onclose = null;
        if (d.open) d.close();
        resolve(v);
      }
      $("confirm-yes").onclick = function () { finish(true); };
      $("confirm-no").onclick = function () { finish(false); };
      d.onclose = function () { finish(false); };
      d.showModal();
    });
  }

  function errText(e) {
    if (!e) return "Невідома помилка.";
    var m = String(e.message || e);
    if (e.code === "23505" || /duplicate key|already exists/i.test(m)) return "Такий slug (адреса проєкту) уже використовується. Змініть його.";
    if (e.code === "23514" || /check constraint/i.test(m)) return "Дані не пройшли перевірку бази: " + m;
    if (e.status === 413 || /exceeded the maximum allowed size|too large/i.test(m)) return "Файл завеликий для сховища. Скористайтеся зовнішнім посиланням (наприклад, GitHub Releases).";
    if (/mime type .* not supported|invalid_mime_type/i.test(m)) return "Цей тип файлу не дозволений у сховищі.";
    if (e.status === 401 || e.status === 403 || e.code === "42501") return "Немає прав або сесія завершилась. Увійдіть знову.";
    return m;
  }

  function handleAuthFailure(e) {
    if (e && e.status === 401) {
      form = null;
      showLogin("Сесія завершилась. Увійдіть знову.");
      return true;
    }
    return false;
  }

  var TRANSLIT = { а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ye", ж: "zh", з: "z", и: "y", і: "i", ї: "yi", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "yu", я: "ya", ы: "y", э: "e", ё: "yo", ъ: "" };
  function slugify(text) {
    var s = String(text || "").toLowerCase().split("").map(function (ch) { return TRANSLIT.hasOwnProperty(ch) ? TRANSLIT[ch] : ch; }).join("");
    return s.replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  }
  function lines(text) {
    return String(text || "").split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function nul(v) { v = String(v == null ? "" : v).trim(); return v === "" ? null : v; }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function isHttpUrl(v) { return /^https?:\/\/\S+$/i.test(v); }

  /* ---------- Перемикання екранів ---------- */
  function showOnly(id) {
    ["view-loading", "view-noconfig", "view-login", "view-denied", "view-app"].forEach(function (v) { $(v).hidden = v !== id; });
    $("admin-nav").hidden = id !== "view-app";
  }

  function showLogin(message) {
    showOnly("view-login");
    var err = $("login-error");
    err.hidden = !message;
    err.textContent = message || "";
    $("login-password").value = "";
    $("login-submit").disabled = false;
  }

  function showDenied() {
    var u = SB.user();
    $("denied-email").textContent = (u && u.email) || "";
    showOnly("view-denied");
  }

  /* ---------- Вхід / вихід ---------- */
  function bootSession() {
    showOnly("view-loading");
    SB.isAdmin().then(function (ok) {
      if (!ok) { showDenied(); return; }
      var u = SB.user();
      $("admin-user").textContent = (u && u.email) || "";
      showOnly("view-app");
      route();
    }).catch(function (e) {
      if (e && e.status === 401) { showLogin(); return; }
      showLogin("Не вдалося перевірити права доступу: " + errText(e));
    });
  }

  function logout() {
    form = null;
    SB.signOut().then(function () { showLogin(); location.hash = "#/"; });
  }

  /* ---------- Маршрутизація ---------- */
  function setNav(name) {
    [].forEach.call(document.querySelectorAll("[data-nav]"), function (a) {
      if (a.getAttribute("data-nav") === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }

  function route() {
    if ($("view-app").hidden) return;
    var h = (location.hash || "#/").replace(/^#/, "");
    var content = $("app-content");
    content.textContent = "";
    var m;
    if (h === "/projects") { setNav("projects"); renderList(content); }
    else if (h === "/new") { setNav("new"); openForm(content, null); }
    else if ((m = /^\/edit\/([0-9a-f-]{36})$/i.exec(h))) { setNav("projects"); openForm(content, m[1]); }
    else { setNav("home"); renderHome(content); }
    window.scrollTo(0, 0);
  }

  function loadRows() {
    return SB.listProjects().then(function (r) { rows = r || []; return rows; });
  }

  function loadFailed(content, e) {
    if (handleAuthFailure(e)) return;
    content.textContent = "";
    content.appendChild(el("div", { cls: "panel" }, [el("p", { cls: "form-error", text: "Не вдалося завантажити проєкти: " + errText(e) })]));
  }

  /* ---------- Головна панель ---------- */
  function renderHome(content) {
    content.appendChild(el("p", { text: "Завантаження…" }));
    loadRows().then(function () {
      content.textContent = "";
      content.appendChild(el("h1", { text: "Головна панель" }));
      var count = function (st) { return rows.filter(function (r) { return r.status === st; }).length; };
      var stats = el("div", { cls: "stats" });
      [["Усього проєктів", rows.length], ["Опубліковано", count("published")], ["Чернеток", count("draft")], ["Архівних", count("archived")]].forEach(function (s) {
        stats.appendChild(el("div", { cls: "stat" }, [el("b", { text: String(s[1]) }), el("span", { text: s[0] })]));
      });
      content.appendChild(stats);
      content.appendChild(el("p", {}, [el("a", { cls: "btn btn-primary", text: "+ Додати проєкт", attrs: { href: "#/new" } })]));

      content.appendChild(el("h2", { text: "Останні змінені" }));
      var recent = rows.slice().sort(function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)); }).slice(0, 5);
      if (!recent.length) content.appendChild(el("p", { cls: "note", text: "Проєктів ще немає. Натисніть «Додати проєкт»." }));
      else content.appendChild(projectsTable(recent, content, true));
    }).catch(function (e) { loadFailed(content, e); });
  }

  /* ---------- Перелік проєктів ---------- */
  function select(options, value, id) {
    var s = el("select", { attrs: id ? { id: id } : {} });
    options.forEach(function (o) {
      var op = el("option", { text: o[1], attrs: { value: o[0] } });
      if (o[0] === value) op.selected = true;
      s.appendChild(op);
    });
    return s;
  }

  function renderList(content) {
    content.appendChild(el("p", { text: "Завантаження…" }));
    loadRows().then(function () { drawList(content); }).catch(function (e) { loadFailed(content, e); });
  }

  function drawList(content) {
    content.textContent = "";
    content.appendChild(el("h1", { text: "Проєкти" }));

    var q = el("input", { attrs: { type: "search", id: "lf-q", placeholder: "Назва або гра", value: listFilter.q } });
    var cat = select([["", "Усі категорії"]].concat(CATS), listFilter.category, "lf-cat");
    var st = select([["", "Усі статуси"], ["draft", "Чернетки"], ["published", "Опубліковані"], ["archived", "Архівні"]], listFilter.status, "lf-st");
    var holder = el("div");
    function field(label, id, input) { return el("div", { cls: "field" }, [el("label", { text: label, attrs: { for: id } }), input]); }
    content.appendChild(el("div", { cls: "toolbar-admin" }, [
      field("Пошук", "lf-q", q), field("Категорія", "lf-cat", cat), field("Статус", "lf-st", st),
      el("a", { cls: "btn btn-primary", text: "+ Додати проєкт", attrs: { href: "#/new" } })
    ]));
    content.appendChild(holder);

    function redraw() {
      listFilter = { q: q.value, category: cat.value, status: st.value };
      var qq = q.value.trim().toLowerCase();
      var shown = rows.filter(function (r) {
        if (cat.value && r.category !== cat.value) return false;
        if (st.value && r.status !== st.value) return false;
        if (qq && ((r.title || "") + " " + (r.game || "")).toLowerCase().indexOf(qq) === -1) return false;
        return true;
      });
      holder.textContent = "";
      if (!shown.length) holder.appendChild(el("p", { cls: "empty", text: rows.length ? "За цими умовами нічого не знайдено." : "Проєктів ще немає." }));
      else holder.appendChild(projectsTable(shown, content, false));
    }
    q.addEventListener("input", redraw); cat.addEventListener("change", redraw); st.addEventListener("change", redraw);
    redraw();
  }

  function catLabel(v) { var c = CATS.filter(function (x) { return x[0] === v; })[0]; return c ? c[1] : v; }

  function projectsTable(list, content, compact) {
    var table = el("table", { cls: "projects" });
    var head = el("tr");
    ["Назва", "Гра", "Категорія", "Версія", "Статус", "Оновлено", "Дії"].forEach(function (t) { head.appendChild(el("th", { text: t, attrs: { scope: "col" } })); });
    table.appendChild(el("thead", {}, [head]));
    var body = el("tbody");
    list.forEach(function (r) {
      var tr = el("tr");
      tr.appendChild(el("td", {}, [el("strong", { text: r.title })]));
      tr.appendChild(el("td", { text: r.game || "—" }));
      tr.appendChild(el("td", { text: catLabel(r.category) }));
      tr.appendChild(el("td", { text: r.version || "—" }));
      tr.appendChild(el("td", {}, [el("span", { cls: "status-" + r.status, text: STATUS_LABEL[r.status] || r.status })]));
      tr.appendChild(el("td", { text: C.formatDate(r.updated_on || r.updated_at) || "—" }));

      var act = el("div", { cls: "row-actions" });
      act.appendChild(el("a", { cls: "btn btn-ghost btn-sm", text: "Редагувати", attrs: { href: "#/edit/" + r.id } }));
      var view = el("button", { cls: "btn btn-ghost btn-sm", text: "Переглянути", attrs: { type: "button" } });
      view.addEventListener("click", function () { openPreview(rowToState(r)); });
      act.appendChild(view);
      var pub = el("button", { cls: "btn btn-ghost btn-sm", text: r.status === "published" ? "Зняти з публікації" : "Опублікувати", attrs: { type: "button" } });
      pub.addEventListener("click", function () { togglePublish(r, pub, content, compact); });
      act.appendChild(pub);
      var del = el("button", { cls: "btn btn-danger btn-sm", text: "Видалити", attrs: { type: "button" } });
      del.addEventListener("click", function () { deleteRow(r, content, compact); });
      act.appendChild(del);
      tr.appendChild(el("td", {}, [act]));
      body.appendChild(tr);
    });
    table.appendChild(body);
    return el("div", { cls: "table-wrap" }, [table]);
  }

  function refreshView(content, compact) {
    content.textContent = "";
    if (compact) renderHome(content); else drawList(content);
  }

  function togglePublish(r, btn, content, compact) {
    var next = r.status === "published" ? "draft" : "published";
    if (next === "published" && !C.isText(r.short_description)) {
      toast("Щоб опублікувати, відкрийте проєкт і заповніть короткий опис.", true);
      return;
    }
    btn.disabled = true;
    SB.updateProject(r.id, { status: next }).then(function (row) {
      rows = rows.map(function (x) { return x.id === row.id ? row : x; });
      toast(next === "published" ? "Проєкт опубліковано." : "Проєкт знято з публікації.");
      refreshView(content, compact);
    }).catch(function (e) {
      btn.disabled = false;
      if (!handleAuthFailure(e)) toast("Не вдалося змінити статус: " + errText(e), true);
    });
  }

  function deleteRow(r, content, compact) {
    confirmDialog("Видалити проєкт «" + r.title + "»? Проєкт і його завантажені зображення та файли буде видалено остаточно. Цю дію не можна скасувати.", "Так, видалити").then(function (yes) {
      if (!yes) return;
      SB.deleteProject(r.id).then(function () {
        var paths = storagePaths(r);
        return Promise.all([
          SB.removeFiles("project-media", paths.media).catch(function () {}),
          SB.removeFiles("project-files", paths.files).catch(function () {})
        ]);
      }).then(function () {
        rows = rows.filter(function (x) { return x.id !== r.id; });
        toast("Проєкт видалено.");
        refreshView(content, compact);
      }).catch(function (e) {
        if (!handleAuthFailure(e)) toast("Не вдалося видалити: " + errText(e), true);
      });
    });
  }

  function storagePaths(r) {
    var media = [];
    if (r.cover_path) media.push(r.cover_path);
    (r.screenshots || []).forEach(function (s) { if (s && s.path) media.push(s.path); });
    var files = r.download_file && r.download_file.path ? [r.download_file.path] : [];
    return { media: media, files: files };
  }

  /* ---------- Стан форми ---------- */
  function rowToState(r) {
    return {
      id: r.id, isNew: false,
      slug: r.slug || "", slugTouched: true,
      title: r.title || "", game: r.game || "", category: r.category || "other",
      status: r.status || "draft", progress: r.progress || "", sort_order: r.sort_order == null ? 100 : r.sort_order,
      short_description: r.short_description || "", description: r.description || "",
      version: r.version || "", updated_on: r.updated_on || "", compatibility: r.compatibility || "", requirements: r.requirements || "",
      features: (r.features || []).join("\n"), changes: (r.changes || []).join("\n"),
      dependencies: (r.dependencies || []).join("\n"), conflicts: (r.conflicts || []).join("\n"),
      installation: (r.installation || []).join("\n"),
      cover_path: r.cover_path || "",
      screenshots: (r.screenshots || []).map(function (s) { return { path: s.path, caption: s.caption || "", alt: s.alt || "" }; }),
      download_mode: r.download_file ? "file" : (r.download_url ? "url" : "none"),
      download_url: r.download_url || "", download_file: r.download_file || null,
      source_url: r.source_url || "", guide_url: r.guide_url || "",
      author: r.author || "", license: r.license || "", credits: r.credits || "",
      is_example: r.is_example === true,
      updated_at: r.updated_at, created_at: r.created_at
    };
  }

  function newState() {
    return {
      id: uuid(), isNew: true, slug: "", slugTouched: false, title: "", game: "", category: "ukrainizer",
      status: "draft", progress: "wip", sort_order: 100, short_description: "", description: "",
      version: "", updated_on: today(), compatibility: "", requirements: "",
      features: "", changes: "", dependencies: "", conflicts: "", installation: "",
      cover_path: "", screenshots: [], download_mode: "none", download_url: "", download_file: null,
      source_url: "", guide_url: "", author: "", license: "", credits: "", is_example: false
    };
  }

  function usedPaths(s) {
    var m = [], f = [];
    if (s.cover_path) m.push(s.cover_path);
    s.screenshots.forEach(function (x) { m.push(x.path); });
    if (s.download_mode === "file" && s.download_file) f.push(s.download_file.path);
    return { media: m, files: f };
  }

  /* Поля, що не стосуються категорії, не зберігаємо (щоб не показувались публічно) */
  function applicable(cat) {
    return {
      changes: cat === "mod" || cat === "addon",
      conflicts: cat === "mod" || cat === "addon",
      dependencies: cat !== "ukrainizer"
    };
  }

  function stateToRow(s, status) {
    var ap = applicable(s.category);
    return {
      slug: s.slug.trim(), title: s.title.trim(), game: nul(s.game), category: s.category,
      short_description: nul(s.short_description), description: nul(s.description),
      status: status, progress: s.progress || null, version: nul(s.version),
      updated_on: s.updated_on || null, compatibility: nul(s.compatibility), requirements: nul(s.requirements),
      features: lines(s.features), changes: ap.changes ? lines(s.changes) : [],
      dependencies: ap.dependencies ? lines(s.dependencies) : [], conflicts: ap.conflicts ? lines(s.conflicts) : [],
      installation: lines(s.installation),
      cover_path: s.cover_path || null,
      screenshots: s.screenshots.map(function (x) { return { path: x.path, caption: x.caption.trim(), alt: x.alt.trim() }; }),
      download_url: s.download_mode === "url" ? nul(s.download_url) : null,
      download_file: s.download_mode === "file" && s.download_file ? s.download_file : null,
      source_url: nul(s.source_url), guide_url: nul(s.guide_url),
      author: nul(s.author), license: nul(s.license), credits: nul(s.credits),
      sort_order: parseInt(s.sort_order, 10) || 0,
      is_example: !!s.is_example
    };
  }

  /* ---------- Перевірка ---------- */
  function validate(s, forPublish) {
    var e = {};
    if (!s.title.trim()) e.title = "Вкажіть назву проєкту.";
    if (!s.slug.trim()) e.slug = "Вкажіть адресу проєкту (slug).";
    else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.slug.trim())) e.slug = "Лише малі латинські літери, цифри та дефіси, напр. million-depth.";
    if (forPublish && !s.short_description.trim()) e.short_description = "Для публікації потрібен короткий опис.";
    if (s.short_description.length > 500) e.short_description = "Короткий опис — не більше 500 символів.";
    if (s.download_mode === "url" && s.download_url.trim() && !isHttpUrl(s.download_url.trim())) e.download_url = "Посилання має починатися з http:// або https://.";
    if (s.download_mode === "file" && forPublish && !s.download_file) e.download_file = "Завантажте файл або оберіть інший спосіб.";
    if (s.source_url.trim() && !isHttpUrl(s.source_url.trim())) e.source_url = "Посилання має починатися з http:// або https://.";
    if (s.guide_url.trim() && !isHttpUrl(s.guide_url.trim())) e.guide_url = "Посилання має починатися з http:// або https://.";
    if (s.updated_on && !/^\d{4}-\d{2}-\d{2}$/.test(s.updated_on)) e.updated_on = "Невірна дата.";
    if (s.sort_order !== "" && !/^-?\d+$/.test(String(s.sort_order))) e.sort_order = "Вкажіть ціле число.";
    return e;
  }

  /* ---------- Форма ---------- */
  function openForm(content, id) {
    if (!id) { form = { s: newState(), orig: { media: [], files: [] }, uploaded: { media: [], files: [] }, dirty: false }; drawForm(content); return; }
    content.appendChild(el("p", { text: "Завантаження…" }));
    SB.getProject(id).then(function (r) {
      content.textContent = "";
      if (!r) { content.appendChild(el("div", { cls: "panel" }, [el("p", { text: "Проєкт не знайдено." }), el("a", { cls: "btn btn-ghost", text: "До проєктів", attrs: { href: "#/projects" } })])); return; }
      var s = rowToState(r);
      form = { s: s, orig: usedPaths(s), uploaded: { media: [], files: [] }, dirty: false };
      drawForm(content);
    }).catch(function (e) { loadFailed(content, e); });
  }

  function drawForm(content) {
    var s = form.s;
    content.textContent = "";
    content.appendChild(el("h1", { text: s.isNew ? "Новий проєкт" : "Редагування: " + s.title }));
    var summary = el("div", { cls: "panel form-error", attrs: { role: "alert", id: "form-summary" } });
    summary.hidden = true;
    content.appendChild(summary);

    var errEls = {};
    var inputs = {};

    function mark() { form.dirty = true; }

    function fieldWrap(key, label, input, opts) {
      opts = opts || {};
      var id = "f-" + key;
      input.id = id;
      var lab = el("label", { attrs: { for: id } }, [document.createTextNode(label), opts.required ? el("span", { cls: "req", text: " *" }) : null]);
      var err = el("div", { cls: "field-error", attrs: { id: id + "-err" } });
      err.hidden = true;
      errEls[key] = err; inputs[key] = input;
      var kids = [lab, input];
      if (opts.hint) kids.push(el("span", { cls: "hint", text: opts.hint }));
      kids.push(err);
      var w = el("div", { cls: "field" }, kids);
      if (opts.cats) w.setAttribute("data-cats", opts.cats.join(","));
      return w;
    }
    function text(key, label, opts) {
      opts = opts || {};
      var i = el("input", { attrs: { type: opts.type || "text", value: s[key] == null ? "" : s[key] } });
      if (opts.maxlength) i.maxLength = opts.maxlength;
      i.addEventListener("input", function () { s[key] = i.value; mark(); if (opts.onInput) opts.onInput(i); });
      return fieldWrap(key, label, i, opts);
    }
    function area(key, label, opts) {
      opts = opts || {};
      var t = el("textarea", { text: s[key] || "" });
      t.value = s[key] || "";
      if (opts.rows) t.rows = opts.rows;
      t.addEventListener("input", function () { s[key] = t.value; mark(); if (opts.onInput) opts.onInput(t); });
      return fieldWrap(key, label, t, opts);
    }
    function sel(key, label, options, opts) {
      var se = select(options, s[key], null);
      se.addEventListener("change", function () { s[key] = se.value; mark(); if (opts && opts.onInput) opts.onInput(se); });
      return fieldWrap(key, label, se, opts);
    }
    function section(title, kids) {
      return el("fieldset", { cls: "section" }, [el("legend", { text: title })].concat(kids));
    }

    /* --- Основне --- */
    var slugInput;
    var titleField = text("title", "Назва проєкту", {
      required: true, maxlength: 200, hint: "Так проєкт називатиметься на сайті.",
      onInput: function (i) {
        if (!s.slugTouched) { s.slug = slugify(i.value); if (slugInput) slugInput.value = s.slug; }
      }
    });
    var slugField = text("slug", "Адреса проєкту (slug)", {
      required: true, maxlength: 80,
      hint: "Короткий унікальний код латиницею для посилання, напр. million-depth. Заповнюється автоматично з назви. Після публікації краще не змінювати.",
      onInput: function () { s.slugTouched = true; }
    });
    slugInput = inputs.slug;
    var catField = sel("category", "Категорія", CATS, { required: true, hint: "Від категорії залежать поля нижче.", onInput: applyCategory });
    var sections = [];
    var basics = [titleField, text("game", "Назва гри", { maxlength: 200, hint: "Напр. Million Depth або The Witcher 3: Wild Hunt." }), catField, slugField,
      el("div", { cls: "row" }, [
        sel("status", "Статус публікації", [["draft", "Чернетка (не видно відвідувачам)"], ["published", "Опубліковано"], ["archived", "Архівний (видно як архівний)"]],
          { hint: "Зазвичай достатньо кнопок «Зберегти чернетку» та «Опублікувати» внизу." }),
        sel("progress", "Стан розробки", PROGRESS, { hint: "Мітка на картці: «У розробці» або «Завершено»." }),
        text("sort_order", "Порядок у каталозі", { type: "number", hint: "Менше число — вище в списку." })
      ])];
    if (s.is_example) {
      var ex = el("input", { attrs: { type: "checkbox", id: "f-is_example" } });
      ex.checked = true;
      ex.addEventListener("change", function () { s.is_example = ex.checked; mark(); });
      basics.push(el("div", { cls: "field" }, [el("label", {}, [ex, document.createTextNode(" Це приклад (показувати мітку «Приклад — замінити своїми даними»)")])]));
    }
    sections.push(section("1. Основне", basics));

    /* --- Опис --- */
    var counter = el("span", { cls: "hint", text: "" });
    function updCounter() { counter.textContent = s.short_description.length + " / 500"; }
    var shortF = area("short_description", "Короткий опис", { rows: 3, hint: "1–2 речення для картки в каталозі. Обов'язковий для публікації.", onInput: updCounter });
    shortF.insertBefore(counter, errEls.short_description);
    updCounter();
    sections.push(section("2. Опис", [shortF,
      area("description", "Повний опис", { rows: 8, hint: "Докладно про проєкт. Нові рядки зберігаються." })]));

    /* --- Версія --- */
    sections.push(section("3. Версія та сумісність", [
      el("div", { cls: "row" }, [
        text("version", "Версія проєкту", { maxlength: 50, hint: "Напр. 1.0" }),
        text("updated_on", "Дата оновлення", { type: "date" })
      ]),
      text("compatibility", "Сумісність із версією гри", { maxlength: 500, hint: "Вказуйте лише те, що перевірили. Напр. «Steam, версія 1.2»." }),
      area("requirements", "Вимоги", { rows: 2, hint: "Напр. ліцензійна копія гри." })
    ]));

    /* --- Особливості та встановлення (адаптивно) --- */
    var featField = area("features", "Особливості", { rows: 4, hint: "Кожен пункт з нового рядка." });
    var featLabel = featField.querySelector("label");
    var featHint = featField.querySelector(".hint");
    sections.push(section("4. Особливості та встановлення", [
      featField,
      area("changes", "Що змінює мод", { rows: 4, hint: "Кожна зміна з нового рядка.", cats: ["mod", "addon"] }),
      area("dependencies", "Необхідні залежності", { rows: 3, hint: "Інші моди чи програми, потрібні для роботи. Кожна з нового рядка.", cats: ["mod", "addon", "tool", "other"] }),
      area("conflicts", "Можливі конфлікти", { rows: 3, hint: "З якими модами конфліктує, якщо відомо. Кожен з нового рядка.", cats: ["mod", "addon"] }),
      area("installation", "Інструкція зі встановлення", { rows: 6, hint: "Кожен крок з нового рядка; на сайті вони стануть пронумерованим списком." })
    ]));

    /* --- Зображення --- */
    var coverBox = el("div");
    var shotsBox = el("div");
    var shotHint = el("p", { cls: "note" });
    sections.push(section("5. Зображення", [
      el("div", { cls: "field" }, [el("span", { cls: "label", text: "Обкладинка" }),
        el("span", { cls: "hint", text: "JPG, PNG або WebP до 5 МБ, бажано 16:9 (напр. 1280×720)." }), coverBox]),
      el("div", { cls: "field" }, [el("span", { cls: "label", text: "Скриншоти" }), shotHint, shotsBox])
    ]));

    /* --- Завантаження --- */
    var dlBox = el("div");
    sections.push(section("6. Завантаження та посилання", [
      dlBox,
      text("source_url", "Вихідний код або сторінка проєкту", { type: "url", hint: "Окреме від завантаження, напр. репозиторій на GitHub." }),
      text("guide_url", "Посилання на окрему інструкцію", { type: "url" })
    ]));

    /* --- Авторство --- */
    sections.push(section("7. Авторство", [
      el("div", { cls: "row" }, [text("author", "Автор", { maxlength: 200 }), text("license", "Ліцензія", { maxlength: 200 })]),
      area("credits", "Авторство та використані матеріали", { rows: 3, hint: "Хто що робив, які сторонні матеріали використано." })
    ]));

    sections.forEach(function (x) { content.appendChild(x); });

    /* --- Адаптація до категорії --- */
    function applyCategory() {
      var c = s.category;
      [].forEach.call(content.querySelectorAll("[data-cats]"), function (w) {
        w.hidden = w.getAttribute("data-cats").split(",").indexOf(c) === -1;
      });
      featLabel.textContent = c === "ukrainizer" ? "Особливості перекладу" : "Особливості";
      featHint.textContent = c === "ukrainizer"
        ? "Що саме перекладено (меню, діалоги, інтерфейс…), стан перекладу. Кожен пункт з нового рядка."
        : "Кожен пункт з нового рядка.";
      shotHint.textContent = c === "ukrainizer"
        ? "Додайте скриншоти саме результату перекладу: меню, діалоги, ігрові інтерфейси. Підписи покажуть приклади українських текстів."
        : c === "mod" ? "Додайте скриншоти роботи мода в грі." : "Скриншоти допоможуть відвідувачам зрозуміти, що це за проєкт.";
    }
    applyCategory();

    /* --- Обкладинка --- */
    function drawCover() {
      coverBox.textContent = "";
      var img = el("img", { attrs: { alt: s.cover_path ? "Попередній перегляд обкладинки" : "Заглушка: обкладинки немає", src: s.cover_path ? C.mediaUrl(s.cover_path) : "../images/placeholder.svg" } });
      img.addEventListener("error", function () { img.src = "../images/placeholder.svg"; });
      var file = el("input", { attrs: { type: "file", accept: "image/jpeg,image/png,image/webp", id: "cover-file", "aria-label": "Обрати обкладинку" } });
      var progress = progressUi();
      file.addEventListener("change", function () {
        var f = file.files[0]; if (!f) return;
        var bad = checkImage(f);
        if (bad) { progress.fail(bad); file.value = ""; return; }
        var path = "projects/" + s.id + "/cover-" + Date.now() + "." + IMAGE_TYPES[f.type];
        progress.start(f.name);
        SB.upload("project-media", path, f, progress.set).then(function () {
          form.uploaded.media.push(path);
          s.cover_path = path; mark();
          progress.done("Обкладинку завантажено. Збережіть проєкт, щоб застосувати.");
          drawCover();
        }).catch(function (e) { if (!handleAuthFailure(e)) progress.fail("Не вдалося завантажити: " + errText(e) + " Поточна обкладинка не змінена."); });
      });
      var kids = [el("div", { cls: "media-preview" }, [img, el("div", {}, [
        el("label", { text: s.cover_path ? "Замінити обкладинку" : "Завантажити обкладинку", attrs: { for: "cover-file" } }), file, progress.node,
        s.cover_path ? (function () {
          var rm = el("button", { cls: "btn btn-ghost btn-sm", text: "Прибрати обкладинку", attrs: { type: "button" } });
          rm.addEventListener("click", function () { s.cover_path = ""; mark(); drawCover(); });
          return rm;
        })() : null
      ])])];
      kids.forEach(function (k) { coverBox.appendChild(k); });
    }
    drawCover();

    /* --- Скриншоти --- */
    function drawShots() {
      shotsBox.textContent = "";
      var list = el("div", { cls: "shots" });
      s.screenshots.forEach(function (sh, i) {
        var img = el("img", { attrs: { src: C.mediaUrl(sh.path), alt: sh.alt || sh.caption || "Скриншот " + (i + 1) } });
        img.addEventListener("error", function () { img.src = "../images/placeholder.svg"; });
        function mini(key, label) {
          var id = "shot-" + i + "-" + key;
          var inp = el("input", { attrs: { type: "text", id: id, value: sh[key], maxlength: "300" } });
          inp.addEventListener("input", function () { sh[key] = inp.value; mark(); });
          return el("div", { cls: "field" }, [el("label", { text: label, attrs: { for: id } }), inp]);
        }
        var up = el("button", { cls: "btn btn-ghost btn-sm", text: "↑ Вище", attrs: { type: "button" } });
        var down = el("button", { cls: "btn btn-ghost btn-sm", text: "↓ Нижче", attrs: { type: "button" } });
        var rm = el("button", { cls: "btn btn-danger btn-sm", text: "Видалити", attrs: { type: "button" } });
        up.disabled = i === 0; down.disabled = i === s.screenshots.length - 1;
        up.addEventListener("click", function () { s.screenshots.splice(i - 1, 0, s.screenshots.splice(i, 1)[0]); mark(); drawShots(); });
        down.addEventListener("click", function () { s.screenshots.splice(i + 1, 0, s.screenshots.splice(i, 1)[0]); mark(); drawShots(); });
        rm.addEventListener("click", function () { s.screenshots.splice(i, 1); mark(); drawShots(); });
        list.appendChild(el("div", { cls: "shot-item" }, [img, el("div", { cls: "shot-fields" }, [
          mini("caption", "Підпис (видно під скриншотом)"),
          mini("alt", "Альтернативний текст (опис для людей, які не бачать зображення)"),
          el("div", { cls: "row-actions" }, [up, down, rm])
        ])]));
      });
      shotsBox.appendChild(list);

      var file = el("input", { attrs: { type: "file", accept: "image/jpeg,image/png,image/webp", multiple: "multiple", id: "shots-file", "aria-label": "Додати скриншоти" } });
      var progress = progressUi();
      file.addEventListener("change", function () {
        var files = [].slice.call(file.files); file.value = "";
        if (!files.length) return;
        if (s.screenshots.length + files.length > 40) { progress.fail("Можна додати не більше 40 скриншотів."); return; }
        var chain = Promise.resolve();
        var okCount = 0;
        files.forEach(function (f, idx) {
          chain = chain.then(function () {
            var bad = checkImage(f);
            if (bad) { toast(f.name + ": " + bad, true); return; }
            var path = "projects/" + s.id + "/shot-" + Date.now() + "-" + idx + "." + IMAGE_TYPES[f.type];
            progress.start(f.name + " (" + (idx + 1) + " з " + files.length + ")");
            return SB.upload("project-media", path, f, progress.set).then(function () {
              form.uploaded.media.push(path);
              s.screenshots.push({ path: path, caption: "", alt: "" });
              okCount++; mark(); drawShotsList();
            }).catch(function (e) { if (!handleAuthFailure(e)) toast(f.name + ": " + errText(e), true); });
          });
        });
        chain.then(function () {
          if (okCount) progress.done("Додано скриншотів: " + okCount + ". Додайте підписи та збережіть проєкт.");
          else progress.fail("Жодного скриншота не додано.");
          drawShots();
        });
      });
      function drawShotsList() { /* список перемалюється після завершення всіх файлів */ }
      shotsBox.appendChild(el("div", { cls: "field" }, [
        el("label", { text: "Додати скриншоти (можна кілька файлів; JPG, PNG, WebP до 5 МБ)", attrs: { for: "shots-file" } }), file, progress.node
      ]));
      if (!s.screenshots.length) shotsBox.insertBefore(el("p", { cls: "note", text: "Скриншотів ще немає — на сайті буде показано заглушку." }), list);
    }
    drawShots();

    /* --- Завантаження файлу / посилання --- */
    function drawDownload() {
      dlBox.textContent = "";
      var radios = el("div", { cls: "radio-row", attrs: { role: "radiogroup", "aria-label": "Спосіб завантаження" } });
      [["none", "Без кнопки «Завантажити»"], ["url", "Зовнішнє посилання (напр. GitHub Releases)"], ["file", "Завантажити архів на сайт"]].forEach(function (o) {
        var r = el("input", { attrs: { type: "radio", name: "dl-mode", value: o[0] } });
        r.checked = s.download_mode === o[0];
        r.addEventListener("change", function () { s.download_mode = o[0]; mark(); drawDownload(); });
        radios.appendChild(el("label", {}, [r, document.createTextNode(" " + o[1])]));
      });
      dlBox.appendChild(radios);

      if (s.download_mode === "url") {
        var i = el("input", { attrs: { type: "url", id: "f-download_url", value: s.download_url, placeholder: "https://github.com/…/releases/download/…/file.zip" } });
        i.addEventListener("input", function () { s.download_url = i.value; mark(); });
        var er = el("div", { cls: "field-error", attrs: { id: "f-download_url-err" } }); er.hidden = true;
        errEls.download_url = er; inputs.download_url = i;
        dlBox.appendChild(el("div", { cls: "field" }, [el("label", { text: "Пряме посилання на файл", attrs: { for: "f-download_url" } }), i,
          el("span", { cls: "hint", text: "Саме посилання на файл для завантаження, а не на сторінку проєкту." }), er]));
      } else if (s.download_mode === "file") {
        var fileBox = el("div", { cls: "field" });
        var progress = progressUi();
        var er2 = el("div", { cls: "field-error", attrs: { id: "f-download_file-err" } }); er2.hidden = true;
        errEls.download_file = er2;
        if (s.download_file) {
          fileBox.appendChild(el("p", { text: "Поточний файл: " + s.download_file.name + " (" + C.formatSize(s.download_file.size) + ")" }));
        } else fileBox.appendChild(el("p", { cls: "note", text: "Файл ще не завантажено." }));
        var fi = el("input", { attrs: { type: "file", accept: ".zip,.7z,.rar", id: "archive-file", "aria-label": "Обрати архів" } });
        fi.addEventListener("change", function () {
          var f = fi.files[0]; if (!f) return;
          var bad = checkArchive(f);
          if (bad) { progress.fail(bad); fi.value = ""; return; }
          var path = "projects/" + s.id + "/" + Date.now() + "-" + safeName(f.name);
          progress.start(f.name);
          SB.upload("project-files", path, f, progress.set).then(function () {
            form.uploaded.files.push(path);
            s.download_file = { path: path, name: f.name, size: f.size };
            mark();
            progress.done("Файл завантажено. Збережіть проєкт, щоб застосувати.");
            drawDownload();
          }).catch(function (e) { if (!handleAuthFailure(e)) progress.fail("Не вдалося завантажити: " + errText(e) + " Поточний файл не змінено."); });
        });
        fileBox.appendChild(el("label", { text: s.download_file ? "Замінити файл" : "Обрати архів (.zip, .7z, .rar до 50 МБ)", attrs: { for: "archive-file" } }));
        fileBox.appendChild(fi);
        fileBox.appendChild(progress.node);
        fileBox.appendChild(el("span", { cls: "hint", text: "Якщо архів більший за 50 МБ, виберіть «Зовнішнє посилання» і завантажте файл у GitHub Releases." }));
        fileBox.appendChild(er2);
        dlBox.appendChild(fileBox);
      }
    }
    drawDownload();

    /* --- Кнопки дій --- */
    var state = el("span", { cls: "save-state", attrs: { id: "save-state", role: "status" } });
    var bDraft = el("button", { cls: "btn btn-ghost", text: "Зберегти чернетку", attrs: { type: "button" } });
    var bPrev = el("button", { cls: "btn btn-ghost", text: "Попередній перегляд", attrs: { type: "button" } });
    var bPub = el("button", { cls: "btn btn-primary", text: s.status === "archived" ? "Зберегти як архівний" : (s.status === "published" ? "Зберегти зміни" : "Опублікувати"), attrs: { type: "button" } });
    var bCancel = el("button", { cls: "btn btn-ghost", text: "Скасувати", attrs: { type: "button" } });
    var buttons = [bDraft, bPrev, bPub, bCancel];

    function busy(on, msg) { buttons.forEach(function (b) { b.disabled = on; }); state.textContent = msg || ""; }

    function showErrors(errs) {
      Object.keys(errEls).forEach(function (k) {
        errEls[k].hidden = true; errEls[k].textContent = "";
        if (inputs[k]) inputs[k].removeAttribute("aria-invalid");
      });
      var keys = Object.keys(errs);
      keys.forEach(function (k) {
        if (errEls[k]) { errEls[k].textContent = errs[k]; errEls[k].hidden = false; }
        if (inputs[k]) { inputs[k].setAttribute("aria-invalid", "true"); inputs[k].setAttribute("aria-describedby", "f-" + k + "-err"); }
      });
      summary.hidden = !keys.length;
      summary.textContent = keys.length ? "Виправте помилки у формі (" + keys.length + "): " + keys.map(function (k) { return errs[k]; }).join(" ") : "";
      if (keys.length) {
        var first = inputs[keys[0]];
        if (first) { first.scrollIntoView({ block: "center" }); first.focus(); } else summary.scrollIntoView();
      }
    }

    function save(status, navigateAfter) {
      var forPublish = status !== "draft";
      var errs = validate(s, forPublish);
      showErrors(errs);
      if (Object.keys(errs).length) return;
      var row = stateToRow(s, status);
      busy(true, "Збереження…");
      var op = s.isNew ? SB.insertProject(Object.assign({ id: s.id }, row)) : SB.updateProject(s.id, row);
      op.then(function (saved) {
        s.isNew = false; s.status = saved.status; s.updated_at = saved.updated_at;
        // Видаляємо файли, які більше не використовуються (після успішного збереження)
        var cur = usedPaths(s);
        var all = { media: form.orig.media.concat(form.uploaded.media), files: form.orig.files.concat(form.uploaded.files) };
        var rmMedia = all.media.filter(function (p, i, a) { return cur.media.indexOf(p) === -1 && a.indexOf(p) === i; });
        var rmFiles = all.files.filter(function (p, i, a) { return cur.files.indexOf(p) === -1 && a.indexOf(p) === i; });
        form.orig = cur; form.uploaded = { media: [], files: [] }; form.dirty = false;
        return Promise.all([SB.removeFiles("project-media", rmMedia).catch(function () {}), SB.removeFiles("project-files", rmFiles).catch(function () {})]).then(function () {
          toast(status === "draft" ? "Чернетку збережено." : (status === "archived" ? "Збережено як архівний." : "Проєкт опубліковано. Зміни вже видно на сайті."));
          if (navigateAfter && window.history && history.replaceState) history.replaceState(null, "", "#/edit/" + s.id);
          rows = rows.filter(function (r) { return r.id !== saved.id; }); rows.push(saved);
          drawForm(content);
        });
      }).catch(function (e) {
        busy(false, "");
        if (handleAuthFailure(e)) return;
        showErrors({});
        summary.hidden = false;
        summary.textContent = "Не вдалося зберегти: " + errText(e) + " Введені дані збережено у формі — спробуйте ще раз.";
        summary.scrollIntoView();
      });
    }

    bDraft.addEventListener("click", function () { s.status = "draft"; save("draft", s.isNew); });
    bPub.addEventListener("click", function () {
      var st = s.status === "archived" ? "archived" : "published";
      save(st, s.isNew);
    });
    bPrev.addEventListener("click", function () { openPreview(s); });
    bCancel.addEventListener("click", function () {
      function leave() {
        var u = form.uploaded;
        // Файли, завантажені під час цього сеансу й не збережені, видаляємо
        Promise.all([SB.removeFiles("project-media", u.media).catch(function () {}), SB.removeFiles("project-files", u.files).catch(function () {})]);
        form = null; location.hash = "#/projects";
      }
      if (form.dirty) confirmDialog("Є незбережені зміни. Вийти без збереження? Завантажені, але не збережені файли буде видалено.", "Так, вийти").then(function (y) { if (y) leave(); });
      else leave();
    });

    content.appendChild(el("div", { cls: "actions-bar" }, [bDraft, bPrev, bPub, bCancel, state]));
  }

  /* ---------- Файли: перевірки та індикатор ---------- */
  function checkImage(f) {
    if (!IMAGE_TYPES[f.type]) return "Дозволені лише зображення JPG, PNG або WebP.";
    if (f.size > MAX_IMAGE) return "Зображення завелике (" + C.formatSize(f.size) + "). Максимум 5 МБ.";
    return "";
  }
  function checkArchive(f) {
    var ext = (f.name.split(".").pop() || "").toLowerCase();
    if (ARCHIVE_EXT.indexOf(ext) === -1) return "Дозволені архіви .zip, .7z або .rar.";
    if (f.size > MAX_ARCHIVE) return "Файл завеликий (" + C.formatSize(f.size) + "): ліміт сховища — 50 МБ. Завантажте його в GitHub Releases і вставте зовнішнє посилання.";
    return "";
  }
  function safeName(name) {
    var ext = (name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    var base = slugify(name.replace(/\.[^.]*$/, "")) || "file";
    return base + (ext ? "." + ext : "");
  }

  function progressUi() {
    var line = el("div", { cls: "upload-line", attrs: { role: "status" } });
    var bar = el("i"); var track = el("div", { cls: "progress" }, [bar]);
    track.hidden = true;
    var node = el("div", {}, [line, track]);
    return {
      node: node,
      start: function (name) { line.className = "upload-line"; line.textContent = "Завантаження: " + name + " — 0%"; track.hidden = false; bar.style.width = "0"; this._name = name; },
      set: function (p) { bar.style.width = Math.round(p * 100) + "%"; line.textContent = "Завантаження… " + Math.round(p * 100) + "%"; },
      done: function (msg) { track.hidden = true; line.textContent = msg; },
      fail: function (msg) { track.hidden = true; line.className = "upload-line form-error"; line.textContent = msg; }
    };
  }

  /* ---------- Попередній перегляд ---------- */
  function openPreview(s) {
    var row = stateToRow(s, s.status === "draft" ? "published" : s.status);
    row.id = s.id; row.updated_at = s.updated_at;
    var p = C.normalize(C.fromRow(row));
    var d = $("preview-dialog");
    if (!p) { toast("Для перегляду вкажіть назву проєкту.", true); return; }
    $("preview-title").textContent = "Попередній перегляд: " + p.title;
    $("preview-note").textContent = "Це лише перегляд для вас. Дані ще не опубліковано, відвідувачам вони не показуються.";
    var body = $("preview-body");
    function show(which) {
      $("tab-card").setAttribute("aria-pressed", String(which === "card"));
      $("tab-page").setAttribute("aria-pressed", String(which === "page"));
      body.textContent = "";
      if (which === "card") body.appendChild(el("div", { cls: "preview-card-wrap" }, [C.card(p, { preview: true })]));
      else body.appendChild(el("div", { cls: "preview-frame" }, [C.detail(p, { preview: true })]));
    }
    $("tab-card").onclick = function () { show("card"); };
    $("tab-page").onclick = function () { show("page"); };
    $("preview-close").onclick = function () { d.close(); };
    show("card");
    if (!d.open) d.showModal();
  }

  /* ---------- Запуск ---------- */
  function init() {
    var cfg = C.config();
    if (!cfg) { showOnly("view-noconfig"); return; }
    SB.init(cfg);
    C.initLightbox();

    $("login-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var email = $("login-email").value.trim(), pw = $("login-password").value;
      if (!email || !pw) { showLogin("Введіть пошту та пароль."); return; }
      $("login-submit").disabled = true;
      SB.signIn(email, pw).then(bootSession).catch(function (e) {
        var msg = e.status === 400 || e.status === 401 ? "Невірна пошта або пароль." : errText(e);
        showLogin(msg);
        $("login-email").value = email;
      });
    });
    $("logout-btn").addEventListener("click", logout);
    $("denied-logout").addEventListener("click", logout);
    window.addEventListener("hashchange", route);
    window.addEventListener("beforeunload", function (e) { if (form && form.dirty) { e.preventDefault(); e.returnValue = ""; } });

    if (SB.hasSession()) bootSession(); else showLogin();
  }

  init();
})();
