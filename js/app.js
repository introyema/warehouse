/* Публічна частина сайту: каталог, пошук, фільтри, сторінка проєкту.
   Дані беруться з Supabase (якщо вказано в data/supabase-config.js),
   інакше — з файлу data/projects.js. Зазвичай цей файл змінювати не потрібно. */
(function () {
  "use strict";

  var C = window.Catalog;
  var SITE = window.SITE || {};
  var el = C.el, isText = C.isText, toList = C.toList;

  var state = { query: "", category: "all" };
  var projects = [];
  var source = "local";

  function $(id) { return document.getElementById(id); }

  function githubUrl() {
    return isText(SITE.githubUsername) ? "https://github.com/" + encodeURIComponent(SITE.githubUsername.trim()) : "";
  }

  /* ---------- Завантаження даних ---------- */
  function setProjects(rawList) {
    var seen = {};
    projects = [];
    rawList.forEach(function (raw, i) {
      var p = null;
      try { p = C.normalize(raw); } catch (e) { p = null; }
      if (!p) {
        if (window.console) console.warn("Проєкт №" + (i + 1) + " пропущено: потрібні текстові поля id і title.", raw);
        return;
      }
      if (seen[p.id]) {
        if (window.console) console.warn("Проєкт пропущено: id «" + p.id + "» повторюється.");
        return;
      }
      seen[p.id] = true;
      projects.push(p);
    });
  }

  function loadLocal() {
    source = "local";
    setProjects(Array.isArray(window.PROJECTS) ? window.PROJECTS : []);
  }

  /* Публічне читання: ключ anon/publishable + RLS показують лише опубліковані й архівні */
  function loadRemote(cfg) {
    var url = cfg.url + "/rest/v1/projects?select=*&order=sort_order.asc,updated_on.desc.nullslast";
    return fetch(url, { headers: { apikey: cfg.anonKey, Accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (rows) {
        if (!Array.isArray(rows)) throw new Error("Неочікувана відповідь");
        source = "remote";
        setProjects(rows.map(C.fromRow));
      });
  }

  function loadData() {
    var cfg = C.config();
    if (!cfg) { loadLocal(); return Promise.resolve(); }
    return loadRemote(cfg).catch(function (e) {
      if (window.console) console.warn("Не вдалося завантажити проєкти з Supabase, показано локальні дані (data/projects.js):", e);
      loadLocal();
    });
  }

  /* ---------- Каталог ---------- */
  function matches(p) {
    if (state.category !== "all" && p.category !== state.category) return false;
    var q = state.query.trim().toLowerCase();
    if (!q) return true;
    return [p.title, p.game, p.shortDescription, p.description].some(function (s) {
      return s && s.toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderCatalog() {
    var shown = projects.filter(matches);
    var grid = $("grid");
    grid.textContent = "";
    shown.forEach(function (p) {
      try { grid.appendChild(C.card(p)); } catch (e) { if (window.console) console.warn("Не вдалося показати картку", p.id, e); }
    });

    $("result-count").textContent = projects.length ? "Показано проєктів: " + shown.length + " з " + projects.length : "";
    $("empty").hidden = shown.length > 0;
    $("empty").textContent = projects.length
      ? "Нічого не знайдено. Спробуйте змінити запит або обрати іншу категорію."
      : "Проєктів поки немає.";
  }

  function renderFilters() {
    var box = $("filters");
    box.textContent = "";
    var items = [["all", "Усі проєкти"]];
    Object.keys(C.FILTER_LABELS).forEach(function (k) {
      if (k === "other" && !projects.some(function (p) { return p.category === "other"; })) return;
      items.push([k, C.FILTER_LABELS[k]]);
    });
    items.forEach(function (it) {
      var b = el("button", { cls: "chip", text: it[1], attrs: { type: "button", "aria-pressed": String(state.category === it[0]) } });
      b.addEventListener("click", function () {
        state.category = it[0];
        renderFilters();
        renderCatalog();
      });
      box.appendChild(b);
    });
  }

  /* ---------- Деталі проєкту ---------- */
  function renderDetail(id) {
    var box = $("detail");
    box.textContent = "";
    var p = projects.filter(function (x) { return x.id === id; })[0];
    if (!p) {
      box.appendChild(el("div", { cls: "container narrow detail" }, [
        el("a", { cls: "detail-back", text: "← До всіх проєктів", attrs: { href: "#/catalog" } }),
        el("div", { cls: "not-found" }, [
          el("h2", { text: "Проєкт не знайдено" }),
          el("p", { text: "Можливо, його було видалено, знято з публікації або посилання неправильне." })
        ])
      ]));
      document.title = "Проєкт не знайдено — " + (SITE.title || "");
      return;
    }
    box.appendChild(C.detail(p));
    document.title = p.title + " — " + (SITE.title || "");
  }

  /* ---------- Маршрутизація (адреса після #) ---------- */
  function show(ids) {
    ["hero", "catalog", "about", "detail"].forEach(function (id) { $(id).hidden = ids.indexOf(id) === -1; });
  }

  function route() {
    var h = "";
    try { h = decodeURIComponent((location.hash || "").replace(/^#/, "")); } catch (e) { h = ""; }
    var m = /^\/project\/(.+)$/.exec(h);
    document.title = SITE.title || document.title;
    if (m) {
      show(["detail"]);
      try { renderDetail(m[1]); } catch (e) {
        if (window.console) console.error(e);
        $("detail").textContent = "Не вдалося показати проєкт.";
      }
    } else if (h === "/catalog") {
      show(["catalog"]);
    } else if (h === "/about") {
      show(["about"]);
    } else {
      show(["hero", "catalog", "about"]);
    }
    window.scrollTo(0, 0);
    $("main").focus({ preventScroll: true });
  }

  /* ---------- Початкове налаштування ---------- */
  function setLink(id, href) {
    var a = $(id);
    if (href) { a.href = href; a.hidden = false; }
  }

  function init() {
    var title = SITE.title || "Сховище";
    $("site-title").textContent = title;
    $("hero-title").textContent = title;
    $("footer-title").textContent = title;
    $("hero-text").textContent = SITE.tagline || "";
    if (isText(SITE.tagline)) {
      var d = document.querySelector('meta[name="description"]');
      if (d) d.setAttribute("content", SITE.tagline);
    }

    var gh = githubUrl();
    setLink("header-github", gh);
    setLink("hero-github", gh);
    setLink("footer-github", gh);

    var about = $("about-text");
    toList(SITE.about).forEach(function (t) { about.appendChild(el("p", { text: t })); });
    $("footer-note").textContent = SITE.copyrightNote || "";
    $("year").textContent = new Date().getFullYear();

    $("search").addEventListener("input", function (e) {
      state.query = e.target.value;
      renderCatalog();
    });

    C.initLightbox();
    $("result-count").textContent = "Завантаження проєктів…";

    loadData().then(function () {
      renderFilters();
      renderCatalog();
      window.addEventListener("hashchange", route);
      route();
    });
  }

  init();
})();
