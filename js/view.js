/* Спільний код відображення проєктів: використовується і публічним сайтом (js/app.js),
   і попереднім переглядом в адмін-панелі (admin/admin.js). Зазвичай не змінюється. */
(function () {
  "use strict";

  var CATEGORIES = {
    ukrainizer: "Українізатор",
    mod: "Мод",
    addon: "Доповнення",
    tool: "Інструмент",
    other: "Інше"
  };
  var FILTER_LABELS = {
    ukrainizer: "Українізатори",
    mod: "Моди",
    addon: "Доповнення",
    tool: "Інструменти",
    other: "Інше"
  };
  var STATUSES = {
    done: { label: "Завершено", cls: "tag-ok" },
    wip: { label: "У розробці", cls: "tag-wip" },
    archived: { label: "Архівний", cls: "tag-arch" }
  };

  var C = {
    CATEGORIES: CATEGORIES,
    FILTER_LABELS: FILTER_LABELS,
    STATUSES: STATUSES,
    base: "" // префікс шляху до кореня сайту ("" на головній, "../" в адмін-панелі)
  };

  function el(tag, opts, children) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.cls) node.className = opts.cls;
    if (opts.text != null) node.textContent = opts.text;
    if (opts.attrs) Object.keys(opts.attrs).forEach(function (k) { node.setAttribute(k, opts.attrs[k]); });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  function isText(v) { return typeof v === "string" && v.trim() !== ""; }
  function str(v) { return isText(v) ? v.trim() : ""; }
  function toList(v) {
    if (isText(v)) return [v.trim()];
    if (Array.isArray(v)) return v.filter(isText).map(function (s) { return s.trim(); });
    return [];
  }
  /* Дозволяємо лише http(s)-посилання та відносні шляхи */
  function safeUrl(v) {
    if (!isText(v)) return "";
    v = v.trim();
    if (/^https?:\/\//i.test(v)) return v;
    if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.indexOf("//") === 0) return "";
    return v;
  }
  function withBase(src) {
    return /^https?:\/\//i.test(src) ? src : C.base + src;
  }
  function formatDate(v) {
    if (!isText(v)) return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
    if (!m) return v;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (isNaN(d)) return v;
    return d.toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  }
  function formatSize(bytes) {
    if (typeof bytes !== "number" || !(bytes > 0)) return "";
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " КБ";
    return (bytes / 1024 / 1024).toFixed(1).replace(".", ",") + " МБ";
  }
  function link(text, href, cls, external) {
    var a = el("a", { cls: cls, text: text, attrs: { href: href } });
    if (external) { a.target = "_blank"; a.rel = "noopener"; }
    return a;
  }

  var PLACEHOLDER = "images/placeholder.svg";

  /* ---------- Supabase: публічні параметри ---------- */
  C.config = function () {
    var c = window.SUPABASE_CONFIG || {};
    var url = str(c.url).replace(/\/+$/, "");
    var key = str(c.anonKey);
    // Підтримується хмарний Supabase та локальний (Supabase CLI) для розробки
    var ok = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url);
    if (!ok || !key) return null;
    return { url: url, anonKey: key };
  };
  function storageUrl(bucket, path) {
    var cfg = C.config();
    if (!cfg || !isText(path)) return "";
    return cfg.url + "/storage/v1/object/public/" + bucket + "/" + path.split("/").map(encodeURIComponent).join("/");
  }
  C.mediaUrl = function (path) { return storageUrl("project-media", path); };
  C.fileUrl = function (path) { return storageUrl("project-files", path); };

  /* Рядок таблиці projects → «сирий» запис у форматі data/projects.js */
  C.fromRow = function (row) {
    var shots = Array.isArray(row.screenshots) ? row.screenshots : [];
    var file = row.download_file && typeof row.download_file === "object" ? row.download_file : null;
    return {
      id: row.slug,
      title: row.title,
      example: row.is_example === true,
      game: row.game,
      category: row.category,
      shortDescription: row.short_description,
      description: row.description,
      cover: C.mediaUrl(row.cover_path),
      screenshots: shots.map(function (s) {
        return s && { src: C.mediaUrl(s.path), caption: s.caption, alt: s.alt };
      }),
      status: row.status === "archived" ? "archived" : (row.progress || ""),
      version: row.version,
      updatedAt: row.updated_on || (row.updated_at ? String(row.updated_at).slice(0, 10) : ""),
      compatibility: row.compatibility,
      requirements: row.requirements,
      features: row.features,
      changes: row.changes,
      dependencies: row.dependencies,
      conflicts: row.conflicts,
      installation: row.installation,
      downloadUrl: row.download_url || (file ? C.fileUrl(file.path) : ""),
      downloadFileName: file ? file.name : "",
      downloadFileSize: file ? file.size : 0,
      sourceUrl: row.source_url,
      guideUrl: row.guide_url,
      credits: row.credits,
      author: row.author,
      license: row.license
    };
  };

  /* ---------- Приведення запису до єдиного вигляду ---------- */
  C.normalize = function (p) {
    if (!p || typeof p !== "object" || !isText(p.id) || !isText(p.title)) return null;

    var category = p.category === "translation" ? "ukrainizer" : p.category; // стара категорія «Переклади»
    if (!CATEGORIES[category]) category = "other";

    // Підтримка старих назв полів: description (короткий) + longDescription
    var shortDesc = str(p.shortDescription), fullDesc = str(p.description);
    if (!shortDesc && isText(p.longDescription)) { shortDesc = fullDesc; fullDesc = str(p.longDescription); }
    else if (!shortDesc) { shortDesc = fullDesc; fullDesc = ""; }

    var shots = (Array.isArray(p.screenshots) ? p.screenshots : []).map(function (s) {
      if (typeof s === "string") s = { src: s };
      if (!s || typeof s !== "object") return null;
      var src = safeUrl(s.src);
      if (!src) return null;
      var caption = str(s.caption);
      return { src: src, caption: caption, alt: str(s.alt) || caption || "Скриншот проєкту «" + p.title + "»" };
    }).filter(Boolean);

    return {
      id: p.id.trim(),
      title: p.title.trim(),
      example: p.example === true,
      game: str(p.game),
      category: category,
      shortDescription: shortDesc,
      description: fullDesc,
      cover: safeUrl(p.cover || p.image),
      screenshots: shots,
      status: STATUSES[p.status] ? p.status : "",
      version: str(p.version),
      updatedAt: str(p.updatedAt),
      compatibility: str(p.compatibility),
      requirements: str(p.requirements),
      features: toList(p.features),
      changes: toList(p.changes),
      dependencies: toList(p.dependencies),
      conflicts: toList(p.conflicts),
      installation: toList(p.installation || p.installSteps),
      downloadUrl: safeUrl(p.downloadUrl),
      downloadFileName: str(p.downloadFileName),
      downloadFileSize: typeof p.downloadFileSize === "number" ? p.downloadFileSize : 0,
      sourceUrl: safeUrl(p.sourceUrl),
      guideUrl: safeUrl(p.guideUrl),
      detailsUrl: safeUrl(p.detailsUrl),
      credits: toList(p.credits),
      author: str(p.author),
      license: str(p.license)
    };
  };

  /* ---------- Спільні елементи ---------- */
  function image(src, alt, cls) {
    var full = withBase(src || PLACEHOLDER);
    var img = el("img", { cls: cls, attrs: { src: full, alt: alt, loading: "lazy", width: "640", height: "360" } });
    img.addEventListener("error", function () {
      var ph = withBase(PLACEHOLDER);
      if (img.getAttribute("src") !== ph) img.src = ph;
    });
    return img;
  }
  function cover(p, cls) {
    return image(p.cover, p.cover ? "Обкладинка проєкту «" + p.title + "»" : "Заглушка замість обкладинки проєкту «" + p.title + "»", cls);
  }
  function tagsFor(p) {
    var tags = el("div", { cls: "tags" });
    tags.appendChild(el("span", { cls: "tag", text: CATEGORIES[p.category] }));
    var st = STATUSES[p.status];
    if (st) tags.appendChild(el("span", { cls: "tag " + st.cls, text: st.label }));
    if (p.example) tags.appendChild(el("span", { cls: "tag tag-example", text: "Приклад — замінити своїми даними" }));
    return tags;
  }
  function downloadLabel(p) {
    if (p.category === "ukrainizer") return "Завантажити українізатор";
    if (p.category === "mod") return "Завантажити мод";
    return "Завантажити";
  }

  /* ---------- Картка ---------- */
  C.card = function (p, opts) {
    opts = opts || {};
    var body = el("div", { cls: "card-body" });
    body.appendChild(tagsFor(p));
    body.appendChild(el("h3", { text: p.title }));
    if (p.game) body.appendChild(el("p", { cls: "card-game", text: p.game }));
    if (p.shortDescription) body.appendChild(el("p", { cls: "card-desc", text: p.shortDescription }));

    var meta = [];
    if (p.version) meta.push("Версія " + p.version);
    if (p.updatedAt) meta.push("Оновлено: " + formatDate(p.updatedAt));
    if (meta.length) body.appendChild(el("p", { cls: "card-meta", text: meta.join(" · ") }));

    var actions = el("div", { cls: "card-actions" });
    if (opts.preview) {
      actions.appendChild(el("span", { cls: "btn btn-primary btn-sm", text: "Докладніше" }));
      if (p.downloadUrl) actions.appendChild(el("span", { cls: "btn btn-ghost btn-sm", text: "Завантажити" }));
    } else {
      actions.appendChild(p.detailsUrl
        ? link("Докладніше", p.detailsUrl, "btn btn-primary btn-sm", true)
        : link("Докладніше", "#/project/" + encodeURIComponent(p.id), "btn btn-primary btn-sm"));
      if (p.downloadUrl) actions.appendChild(link("Завантажити", p.downloadUrl, "btn btn-ghost btn-sm", true));
    }
    body.appendChild(actions);
    return el("article", { cls: "card" }, [cover(p, "card-img"), body]);
  };

  /* ---------- Lightbox ---------- */
  var lb = { items: [], index: 0, opener: null };
  function $(id) { return document.getElementById(id); }

  function lbShow() {
    var s = lb.items[lb.index];
    var img = $("lightbox-img");
    img.src = withBase(s.src);
    img.alt = s.alt;
    $("lightbox-caption").textContent = s.caption;
    $("lb-count").textContent = (lb.index + 1) + " / " + lb.items.length;
    var multi = lb.items.length > 1;
    $("lb-prev").hidden = !multi;
    $("lb-next").hidden = !multi;
  }
  function lbOpen(items, index, opener) {
    var dlg = $("lightbox");
    if (!dlg || typeof dlg.showModal !== "function") { window.open(withBase(items[index].src), "_blank", "noopener"); return; }
    lb.items = items; lb.index = index; lb.opener = opener;
    lbShow();
    dlg.showModal();
  }
  function lbStep(d) {
    if (lb.items.length < 2) return;
    lb.index = (lb.index + d + lb.items.length) % lb.items.length;
    lbShow();
  }
  C.initLightbox = function () {
    var dlg = $("lightbox");
    if (!dlg) return;
    $("lb-close").addEventListener("click", function () { dlg.close(); });
    $("lb-prev").addEventListener("click", function () { lbStep(-1); });
    $("lb-next").addEventListener("click", function () { lbStep(1); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") lbStep(-1);
      else if (e.key === "ArrowRight") lbStep(1);
    });
    dlg.addEventListener("close", function () {
      $("lightbox-img").removeAttribute("src");
      if (lb.opener && document.body.contains(lb.opener)) lb.opener.focus();
    });
  };

  function gallery(p) {
    var title = p.category === "ukrainizer" ? "Скриншоти перекладу" : p.category === "mod" ? "Скриншоти мода в грі" : "Скриншоти";
    var box = el("section", { cls: "gallery", attrs: { "aria-label": title } }, [el("h3", { text: title })]);
    if (!p.screenshots.length) {
      box.appendChild(el("div", { cls: "gallery-empty" }, [
        image(PLACEHOLDER, "Заглушка: скриншотів поки немає", ""),
        el("p", { text: "Скриншотів поки немає." })
      ]));
      return box;
    }
    var grid = el("div", { cls: "gallery-grid" });
    p.screenshots.forEach(function (s, i) {
      var btn = el("button", { cls: "shot", attrs: { type: "button", "aria-label": "Збільшити скриншот" + (s.caption ? ": " + s.caption : " " + (i + 1)) } });
      btn.appendChild(image(s.src, s.alt, ""));
      if (s.caption) btn.appendChild(el("span", { cls: "shot-caption", text: s.caption }));
      btn.addEventListener("click", function () { lbOpen(p.screenshots, i, btn); });
      grid.appendChild(btn);
    });
    box.appendChild(grid);
    return box;
  }

  function listOf(tag, items) {
    var node = el(tag);
    items.forEach(function (i) { node.appendChild(el("li", { text: i })); });
    return node;
  }

  /* ---------- Повна сторінка проєкту ---------- */
  C.detail = function (p, opts) {
    opts = opts || {};
    var wrap = el("div", { cls: "container narrow detail" });
    if (!opts.preview) wrap.appendChild(link("← До всіх проєктів", "#/catalog", "detail-back"));

    var head = el("div", { cls: "detail-head" });
    head.appendChild(cover(p, ""));
    var info = el("div");
    info.appendChild(tagsFor(p));
    info.appendChild(el("h2", { text: p.title }));
    if (p.game) info.appendChild(el("p", { cls: "card-game", text: "Гра: " + p.game }));
    if (p.shortDescription) info.appendChild(el("p", { text: p.shortDescription }));
    head.appendChild(info);
    wrap.appendChild(head);

    var facts = [["Версія", p.version], ["Оновлено", formatDate(p.updatedAt)], ["Сумісність", p.compatibility], ["Автор", p.author], ["Ліцензія", p.license]]
      .filter(function (f) { return f[1]; });
    if (facts.length) {
      var ul = el("ul", { cls: "facts" });
      facts.forEach(function (f) {
        ul.appendChild(el("li", {}, [el("span", { text: f[0] }), document.createTextNode(f[1])]));
      });
      wrap.appendChild(ul);
    }

    if (p.downloadUrl || p.sourceUrl || p.guideUrl) {
      var actions = el("div", { cls: "card-actions detail-actions" });
      if (p.downloadUrl) actions.appendChild(link(downloadLabel(p), p.downloadUrl, "btn btn-primary btn-lg", true));
      if (p.sourceUrl) actions.appendChild(link("Вихідний код / сторінка проєкту", p.sourceUrl, "btn btn-ghost", true));
      if (p.guideUrl) actions.appendChild(link("Інструкція", p.guideUrl, "btn btn-ghost", true));
      wrap.appendChild(actions);
      if (p.downloadUrl) {
        var note = p.downloadFileName
          ? "Файл: " + p.downloadFileName + (formatSize(p.downloadFileSize) ? " (" + formatSize(p.downloadFileSize) + ")" : "")
          : "Файл розміщено за зовнішнім посиланням, указаним автором.";
        wrap.appendChild(el("p", { cls: "note", text: note }));
      }
    }

    function add(title, node) {
      wrap.appendChild(el("h3", { text: title }));
      wrap.appendChild(node);
    }
    var isUk = p.category === "ukrainizer";
    if (p.description) add("Опис", el("p", { cls: "pre", text: p.description }));
    if (p.changes.length) add("Що змінює мод", listOf("ul", p.changes));
    if (p.features.length) add(isUk ? "Особливості перекладу" : "Особливості", listOf("ul", p.features));
    if (p.requirements) add("Вимоги", el("p", { text: p.requirements }));
    if (p.dependencies.length) add("Необхідні залежності", listOf("ul", p.dependencies));
    if (p.conflicts.length) add("Можливі конфлікти", listOf("ul", p.conflicts));
    if (p.installation.length) add("Встановлення", listOf("ol", p.installation));
    wrap.appendChild(gallery(p));
    if (p.credits.length) add("Авторство та використані матеріали", listOf("ul", p.credits));
    return wrap;
  };

  C.el = el; C.isText = isText; C.toList = toList; C.formatDate = formatDate; C.formatSize = formatSize; C.str = str;
  window.Catalog = C;
})();
