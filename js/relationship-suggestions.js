// relationship-suggestions.js — подсказки «вероятно, это отец» для детей
// без указанного отца.
//
// ВАЖНО (переписано после жалобы на лишние срабатывания): отчество —
// только ПЕРВЫЙ фильтр, не единственный критерий. Раньше алгоритм
// предлагал КАЖДОГО человека с подходящим именем и возрастом — если в
// дереве было три разных «Ивана» подходящего возраста, предлагались все
// три сразу. Теперь для каждого ребёнка среди всех кандидатов с
// подходящим именем считается совокупный балл по нескольким факторам
// (возрастной разрыв, совпадение фамилии, совпадение места рождения,
// уже подтверждённый брак с известной матерью ребёнка), и предлагается
// только явный лидер — если явного лидера нет (несколько кандидатов
// набрали близкий балл), подсказка не выводится вообще, чтобы не
// гадать вместо человека.

function patronymicToFirstNameGuesses(middleName) {
  if (!middleName) return [];
  const m = middleName.trim();
  const guesses = new Set();
  if (/овна$/i.test(m)) guesses.add(m.replace(/овна$/i, ""));
  if (/евна$/i.test(m)) { guesses.add(m.replace(/евна$/i, "")); guesses.add(m.replace(/евна$/i, "") + "й"); }
  if (/ична$/i.test(m)) guesses.add(m.replace(/ична$/i, "а"));
  if (/ович$/i.test(m)) guesses.add(m.replace(/ович$/i, ""));
  if (/евич$/i.test(m)) { guesses.add(m.replace(/евич$/i, "")); guesses.add(m.replace(/евич$/i, "") + "й"); }
  if (/ич$/i.test(m) && !/(ов|ев)ич$/i.test(m)) guesses.add(m.replace(/ич$/i, ""));
  return [...guesses].filter(Boolean);
}

function birthYearOf(p) {
  const b = p?.birth;
  if (!b) return null;
  if (b.exact) { const y = String(b.exact).match(/\d{4}/); if (y) return Number(y[0]); }
  if (b.year) return Number(b.year);
  if (b.from) return Number(b.from);
  return null;
}

function fioOf(p) {
  return [p.lastName, p.firstName, p.middleName].filter(Boolean).join(" ");
}

function stripGenderSuffix(name) {
  const rules = [[/ская$/i, "ский"], [/цкая$/i, "цкий"], [/ова$/i, "ов"], [/ева$/i, "ев"], [/ёва$/i, "ёв"], [/ина$/i, "ин"], [/ына$/i, "ын"]];
  for (const [re, rep] of rules) if (re.test(name)) return name.replace(re, rep);
  return name;
}

// балл кандидата на роль отца конкретного ребёнка + причины, из которых он сложился
function scoreCandidate(child, cand, db) {
  let score = 0;
  const reasons = [];

  const childYear = birthYearOf(child), candYear = birthYearOf(cand);
  if (childYear && candYear) {
    const gap = childYear - candYear;
    if (gap < 12 || gap > 60) return null; // за пределами — не кандидат вообще
    if (gap >= 18 && gap <= 40) { score += 3; reasons.push("правдоподобная разница в возрасте"); }
    else { score += 1; }
  } else {
    score += 0.5; // даты неизвестны — не штрафуем, но и не поддерживаем сильно
  }

  if (child.birthPlace && cand.birthPlace) {
    if (child.birthPlace === cand.birthPlace) { score += 2; reasons.push("совпадает место рождения"); }
  }

  if (stripGenderSuffix(child.lastName || "").toLowerCase() === stripGenderSuffix(cand.lastName || "").toLowerCase() && child.lastName) {
    score += 2; reasons.push("совпадает фамилия");
  }

  // сильнейший сигнал: кандидат уже женат на известной матери этого ребёнка
  const childMother = db.parentsOf(child.id).find((p) => p.gender === "female");
  if (childMother) {
    const candSpouses = db.spousesOf(cand.id);
    if (candSpouses.some((s) => s.id === childMother.id)) { score += 6; reasons.push("уже муж известной матери этого ребёнка"); }
  }

  return { score, reasons };
}

// db — объект DB (singleton с методами parentsOf и т.д.)
export function computeRelationshipSuggestions(db) {
  const state = db.get();
  const persons = state.persons;
  const suggestions = [];

  persons.forEach((child) => {
    const parents = db.parentsOf(child.id);
    const hasFather = parents.some((p) => p.gender === "male");
    if (hasFather || !child.middleName) return;

    const guesses = patronymicToFirstNameGuesses(child.middleName).map((g) => g.toLowerCase());
    if (!guesses.length) return;

    const scored = [];
    persons.forEach((cand) => {
      if (cand.id === child.id) return;
      if (cand.gender !== "male") return;
      if (!guesses.includes((cand.firstName || "").toLowerCase())) return;
      const alreadyRelated = state.relationships.some((r) => (r.a === child.id && r.b === cand.id) || (r.a === cand.id && r.b === child.id));
      if (alreadyRelated) return;
      const result = scoreCandidate(child, cand, db);
      if (result) scored.push({ cand, ...result });
    });

    if (scored.length === 0) return;
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const runnerUp = scored[1];

    // предлагаем только явного лидера: минимальный порог уверенности +
    // заметный отрыв от второго места (если он есть). Без явного лидера —
    // молчим, а не гадаем.
    if (best.score < 2) return;
    if (runnerUp && best.score - runnerUp.score < 2) return;

    suggestions.push({
      childId: child.id, childName: fioOf(child),
      candidateId: best.cand.id, candidateName: fioOf(best.cand),
      reason: `Отчество «${child.middleName}» образовано от имени «${best.cand.firstName}»; ${best.reasons.join(", ") || "другие факторы не выявлены"}.`,
      type: "father",
      score: best.score,
    });
  });

  return suggestions;
}
