// quests.js — игровой слой поверх обычных пробелов в дереве (gaps.js).
// Ничего не выдумывает и не решает за Марину — просто превращает уже
// существующие «дыры» в данных (нет фото, нет истории жизни, неизвестны
// родственники...) в понятные задания с очками, уровнем и streak’ом.
// Задание считается выполненным САМО, как только соответствующее поле
// в карточке реально заполнено — отдельной кнопки «готово» нет,
// потому что честнее засчитывать реальную работу, а не отметку о ней.

import { computeGaps } from "./gaps.js";

export const TASK_TYPES = {
  photo: { label: "Добавить фото", points: 10, icon: "📷", verb: "фотографии" },
  bio: { label: "Рассказать, чем жил(а)", points: 15, icon: "📝", verb: "истории жизни" },
  dates: { label: "Уточнить дату рождения", points: 8, icon: "📅", verb: "даты" },
  places: { label: "Уточнить место рождения", points: 8, icon: "📍", verb: "места" },
  relatives: { label: "Найти родственников", points: 20, icon: "🔎", verb: "родственники" },
  surname: { label: "Подтвердить историю фамилии", points: 12, icon: "🏷️", verb: "фамилии" },
};

const TASK_ORDER = ["photo", "bio", "dates", "places", "relatives", "surname"];

function personPhotosOf(p) {
  if (Array.isArray(p.photos) && p.photos.length) return p.photos;
  return p.photo ? [p.photo] : [];
}

function fullNameOf(p) {
  return [p.lastName, p.firstName, p.middleName].filter(Boolean).join(" ") || "(без имени)";
}

function stripGenderSuffix(name) {
  const rules = [[/ская$/i, "ский"], [/цкая$/i, "цкий"], [/ова$/i, "ов"], [/ева$/i, "ев"], [/ёва$/i, "ёв"], [/ина$/i, "ин"], [/ына$/i, "ын"]];
  for (const [re, rep] of rules) if (re.test(name)) return name.replace(re, rep);
  return name;
}

// сегодняшняя «тема дня» — та же идея ротации, что и у «Сегодня вспомним»
// на главной: детерминированно меняется по дню года, без сервера и ИИ
export function todaysFeaturedType() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return TASK_ORDER[dayOfYear % TASK_ORDER.length];
}

// db — объект DB (singleton). surnameOriginsList — window.SURNAME_ORIGINS
// (для проверки, какие фамилии ещё не подтверждены)
export function computeTasks(db, surnameOriginsList) {
  const persons = db.get().persons;
  const tasks = [];

  persons.forEach((p) => {
    const name = fullNameOf(p);
    if (personPhotosOf(p).length === 0) {
      tasks.push({ id: `photo:${p.id}`, type: "photo", personId: p.id, title: `Добавить фото: ${name}`, sub: p._meta?.relationToMarina || "" });
    }
    if (!p.bio && !p.occupation) {
      tasks.push({ id: `bio:${p.id}`, type: "bio", personId: p.id, title: `Заполнить карточку: ${name}`, sub: "чем занимался(ась), что вспоминается" });
    }
    if (!p.birth || p.birth.mode === "unknown") {
      tasks.push({ id: `dates:${p.id}`, type: "dates", personId: p.id, title: `Уточнить дату рождения: ${name}`, sub: p._meta?.relationToMarina || "" });
    }
    if (!p.birthPlace) {
      tasks.push({ id: `places:${p.id}`, type: "places", personId: p.id, title: `Уточнить место рождения: ${name}`, sub: p._meta?.relationToMarina || "" });
    }
    const gaps = computeGaps(p, db);
    const relKinds = new Set(["father", "mother", "parents", "spouse", "children", "siblings"]);
    const relGaps = gaps.filter((g) => relKinds.has(g.type));
    if (relGaps.length > 0) {
      tasks.push({ id: `relatives:${p.id}`, type: "relatives", personId: p.id, title: `Найти родственников: ${name}`, sub: relGaps.map((g) => g.label).join(", ") });
    }
  });

  if (surnameOriginsList) {
    const seen = new Set();
    persons.forEach((p) => {
      const key = stripGenderSuffix(p.lastName || "").toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      const verified = db.isSurnameVerified ? db.isSurnameVerified(key) : false;
      if (!verified) tasks.push({ id: `surname:${key}`, type: "surname", personId: null, surnameKey: key, title: `Подтвердить историю фамилии: ${p.lastName}`, sub: "прочитать и подтвердить или поправить" });
    });
  }

  return tasks;
}

// какие из заданий уже реально выполнены прямо сейчас (данные заполнены),
// но ещё не были засчитаны в очки — это и есть события «начислить баллы»
export function findFreshlyCompleted(previousTasks, currentTasks, alreadyCredited) {
  const currentIds = new Set(currentTasks.map((t) => t.id));
  return previousTasks.filter((t) => !currentIds.has(t.id) && !alreadyCredited.has(t.id));
}

const LEVELS = [
  { min: 0, title: "Новичок архива" },
  { min: 50, title: "Начинающий архивариус" },
  { min: 150, title: "Хранитель памяти" },
  { min: 350, title: "Летописец рода" },
  { min: 700, title: "Знаток родословной" },
  { min: 1200, title: "Хранитель фамильной истории" },
  { min: 2000, title: "Мастер-генеалог" },
];

export function levelFor(points) {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (points >= LEVELS[i].min) idx = i;
  const current = LEVELS[idx], next = LEVELS[idx + 1];
  const progress = next ? (points - current.min) / (next.min - current.min) : 1;
  return { title: current.title, index: idx, total: LEVELS.length, next: next ? next.title : null, pointsToNext: next ? next.min - points : 0, progress: Math.max(0, Math.min(1, progress)) };
}

export function computeBadges(db, quest) {
  const badges = [];
  const ids = quest.completedTaskIds || [];
  if (ids.length >= 1) badges.push({ key: "first", icon: "🌱", label: "Первые шаги" });
  if (ids.filter((id) => id.startsWith("photo:")).length >= 10) badges.push({ key: "photos10", icon: "📸", label: "10 фотографий" });
  if (ids.filter((id) => id.startsWith("bio:")).length >= 10) badges.push({ key: "bio10", icon: "📖", label: "10 историй жизни" });
  if ((quest.streak?.count || 0) >= 7) badges.push({ key: "streak7", icon: "🔥", label: "Неделя подряд" });
  if ((quest.totalPoints || 0) >= 500) badges.push({ key: "points500", icon: "⭐", label: "500 очков" });
  const persons = db.get().persons.filter((p) => stripGenderSuffix(p.lastName || "").toLowerCase() === "скрябин");
  if (persons.length && persons.every((p) => personPhotosOf(p).length && (p.bio || p.occupation))) {
    badges.push({ key: "skryabin-done", icon: "🏆", label: "Скрябины заполнены" });
  }
  return badges;
}
