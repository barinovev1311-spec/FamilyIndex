// gaps.js — определение «точек расследования» (пробелов) для человека.
// Чистая логика по графу родства, без ИИ — статус хранится отдельно на
// сервере (DB.investigationStatus) и может закрывать пробел вручную.

export const GAP_LABELS = {
  father: "Неизвестен отец",
  mother: "Неизвестна мать",
  parents: "Неизвестны родители",
  siblings: "Неизвестны братья/сёстры",
  spouse: "Неизвестен супруг(а)",
  children: "Неизвестно, были ли дети",
  descendants: "Непроверенная боковая ветвь потомков",
  maidenName: "Неизвестна девичья фамилия",
  dates: "Неизвестна дата рождения",
  places: "Неизвестно место рождения",
};

export const STATUS_LABELS = {
  unknown: "неизвестно",
  needs_research: "нужно исследовать",
  researching: "исследуется",
  has_hypothesis: "есть гипотеза",
  candidate_found: "найден кандидат",
  confirmed: "подтверждено",
  no_continuation: "связи/продолжения нет",
  closed_manually: "закрыто вручную",
};

// статусы, при которых маркер `?` больше не показывается — пробел закрыт
const TERMINAL_STATUSES = new Set(["no_continuation", "closed_manually", "confirmed"]);

function ageAtDeathOrNow(p) {
  const by = birthYearOf(p);
  if (!by) return null;
  if (p.isLiving) return new Date().getFullYear() - by;
  const dy = deathYearOf(p);
  return dy ? dy - by : null;
}
function birthYearOf(p) {
  const b = p?.birth;
  if (!b) return null;
  if (b.exact) { const m = String(b.exact).match(/\d{4}/); if (m) return Number(m[0]); }
  if (b.year) return Number(b.year);
  if (b.from) return Number(b.from);
  return null;
}
function deathYearOf(p) {
  const d = p?.death;
  if (!d) return null;
  if (d.exact) { const m = String(d.exact).match(/\d{4}/); if (m) return Number(m[0]); }
  if (d.year) return Number(d.year);
  return null;
}

// возвращает список ПРИМЕНИМЫХ пробелов (уже без закрытых вручную/подтверждённых)
export function computeGaps(person, db) {
  const parents = db.parentsOf(person.id);
  const hasFather = parents.some((p) => p.gender === "male");
  const hasMother = parents.some((p) => p.gender === "female");
  const raw = [];

  if (!hasFather && !hasMother) raw.push("parents");
  else {
    if (!hasFather) raw.push("father");
    if (!hasMother) raw.push("mother");
  }

  if (parents.length > 0 && db.siblingsOf(person.id).length === 0) raw.push("siblings");

  const age = ageAtDeathOrNow(person);
  const diedYoung = age !== null && age < 15;
  if (!diedYoung) {
    if (db.spousesOf(person.id).length === 0) raw.push("spouse");
    if (db.childrenOf(person.id).length === 0) raw.push("children");
  }

  if (person.gender === "female" && !person.maidenName && db.spousesOf(person.id).length > 0) raw.push("maidenName");
  if (!person.birth || person.birth.mode === "unknown") raw.push("dates");
  if (!person.birthPlace) raw.push("places");

  const kids = db.childrenOf(person.id);
  if (kids.length > 0 && kids.every((k) => db.childrenOf(k.id).length === 0 && db.investigationStatus(k.id, "children") === "unknown")) {
    raw.push("descendants");
  }

  return raw
    .map((type) => ({ type, label: GAP_LABELS[type], status: db.investigationStatus(person.id, type) }))
    .filter((g) => !TERMINAL_STATUSES.has(g.status));
}

export function hasAnyGap(person, db) {
  return computeGaps(person, db).length > 0;
}

// агрегированная сводка для «🤖 Проанализировать дерево» — считается на
// лету по тем же самым правилам, без обращения к ИИ (числа должны быть
// точными и мгновенными, а не сгенерированными)
export function computeTreeStats(db) {
  let total = 0, unknownParents = 0, uncheckedDescendantLines = 0, sideBranches = 0, unknownSiblings = 0;
  db.get().persons.forEach((p) => {
    const gaps = computeGaps(p, db);
    total += gaps.length;
    if (gaps.some((g) => g.type === "father" || g.type === "mother" || g.type === "parents")) unknownParents++;
    if (gaps.some((g) => g.type === "children")) uncheckedDescendantLines++;
    if (gaps.some((g) => g.type === "descendants")) sideBranches++;
    if (gaps.some((g) => g.type === "siblings")) unknownSiblings++;
  });
  return { total, unknownParents, uncheckedDescendantLines, sideBranches, unknownSiblings };
}

export function gapStatusColor(status) {
  return { unknown: "gap-grey", needs_research: "gap-amber", researching: "gap-violet", has_hypothesis: "gap-teal", candidate_found: "gap-gold" }[status] || "gap-grey";
}
