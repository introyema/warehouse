/* ===== КАТАЛОГ ПРОЄКТІВ =====
   Щоб додати проєкт — скопіюйте один блок { ... } (разом з комою після нього),
   вставте під ним і змініть значення. Щоб видалити — видаліть весь блок.
   Готові шаблони та покрокові інструкції — у файлі ADDING_PROJECTS.md.

   ОБОВ'ЯЗКОВІ поля: id, title, category.
   Усі інші — необов'язкові: порожні або відсутні просто не показуються.

   category: "ukrainizer" | "mod" | "addon" | "tool" | "other"
   status:   "done" (Завершено) | "wip" (У розробці) | "archived" (Архівний)
   updatedAt: РІК-МІСЯЦЬ-ДЕНЬ, наприклад "2025-01-31"
   cover: головна обкладинка, наприклад "images/projects/my-mod/cover.jpg" ("" — буде заглушка)
   screenshots: список скриншотів: { src: "шлях", caption: "підпис", alt: "опис для доступності" }

   Записи з example: true — лише ПРИКЛАДИ. Замініть їх своїми й видаліть рядок example. */
window.PROJECTS = [
  {
    id: "million-depth-example",
    example: true,
    title: "Український переклад Million Depth",
    game: "Million Depth",
    category: "ukrainizer",
    shortDescription: "Приклад — замінити своїми даними. Український переклад інтерфейсу та текстів гри.",
    description: "Приклад — замінити своїми даними. Тут можна докладно розповісти, що саме перекладено й у якому стані переклад.",
    cover: "",
    screenshots: [],
    status: "wip",
    version: "0.1",
    updatedAt: "2025-01-15",
    compatibility: "",
    features: [
      "Приклад: перекладено меню та інтерфейс",
      "Приклад: перекладено діалоги"
    ],
    installation: [
      "Приклад: завантажте архів з українізатором.",
      "Приклад: розпакуйте його у папку гри за вказівками автора.",
      "Приклад: запустіть гру та оберіть українську мову, якщо потрібно."
    ],
    requirements: "",
    downloadUrl: "",
    sourceUrl: "",
    credits: ""
  },
  {
    id: "example-witcher-mod",
    example: true,
    title: "Приклад мода",
    game: "The Witcher 3: Wild Hunt",
    category: "mod",
    shortDescription: "Приклад — замінити своїми даними. Короткий опис мода в одне-два речення.",
    description: "Приклад — замінити своїми даними. Тут можна розповісти про мод докладніше.",
    cover: "",
    screenshots: [],
    status: "wip",
    version: "0.1.0",
    updatedAt: "2025-01-15",
    changes: [
      "Приклад: що саме змінює мод (перша зміна)",
      "Приклад: друга зміна"
    ],
    compatibility: "Приклад: версія гри, з якою працює мод.",
    requirements: "Приклад: потрібна ліцензійна копія гри.",
    dependencies: ["Приклад: інший мод або програма, потрібні для роботи"],
    conflicts: ["Приклад: мод, з яким є конфлікт (якщо відомо)"],
    installation: [
      "Приклад: завантажте архів.",
      "Приклад: розпакуйте його в папку гри."
    ],
    downloadUrl: "",
    sourceUrl: "",
    credits: ""
  },
  {
    id: "example-ukrainizer",
    example: true,
    title: "Приклад українізатора",
    game: "Назва гри",
    category: "ukrainizer",
    shortDescription: "Приклад — замінити своїми даними. Український переклад інтерфейсу та субтитрів.",
    cover: "",
    status: "done",
    version: "1.0",
    updatedAt: "2024-11-02"
  },
  {
    /* Раніше цей запис мав категорію «Переклади» — перенесено до «Українізатори» */
    id: "example-translation",
    example: true,
    title: "Приклад перекладу",
    game: "Назва гри",
    category: "ukrainizer",
    shortDescription: "Приклад — замінити своїми даними. Переклад окремого тексту чи доповнення до гри.",
    cover: "",
    status: "archived",
    updatedAt: "2023-06-20"
  },
  {
    id: "example-addon",
    example: true,
    title: "Приклад доповнення до мода",
    game: "The Witcher 3: Wild Hunt",
    category: "addon",
    shortDescription: "Приклад — замінити своїми даними. Невелике доповнення до існуючого мода.",
    cover: "",
    status: "wip",
    updatedAt: "2025-02-01"
  },
  {
    id: "example-tool",
    example: true,
    title: "Приклад інструмента",
    category: "tool",
    shortDescription: "Приклад — замінити своїми даними. Невелика програма чи експериментальний проєкт.",
    cover: "",
    status: "done",
    version: "2.3",
    updatedAt: "2024-08-10"
  }
];
