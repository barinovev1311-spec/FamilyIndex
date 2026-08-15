// relationship-suggestions.js — подсказки «вероятно, это отец» по
// отчеству. Работает без ИИ (надёжная лингвистика: отчество почти
// всегда образовано от имени отца), поэтому доступно сразу, бесплатно.
// ИИ (если настроен) только дописывает объяснение — само предложение
// связи никогда не строится исключительно на догадке модели.

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

// db — объект DB (singleton с методами parentsOf и т.д.)
export function computeRelationshipSuggestions(db) {
  const state = db.get();
  const persons = state.persons;
  const suggestions = [];
  const seenPairs = new Set();

  persons.forEach((child) => {
    const parents = db.parentsOf(child.id);
    const hasFather = parents.some((p) => p.gender === "male");
    if (hasFather || !child.middleName) return;

    const guesses = patronymicToFirstNameGuesses(child.middleName).map((g) => g.toLowerCase());
    if (!guesses.length) return;

    persons.forEach((cand) => {
      if (cand.id === child.id) return;
      if (cand.gender !== "male") return;
      if (!guesses.includes((cand.firstName || "").toLowerCase())) return;
      const childYear = birthYearOf(child), candYear = birthYearOf(cand);
      if (childYear && candYear) {
        const gap = childYear - candYear;
        if (gap < 12 || gap > 55) return;
      }
      const alreadyRelated = state.relationships.some((r) =>
        (r.a === child.id && r.b === cand.id) || (r.a === cand.id && r.b === child.id));
      if (alreadyRelated) return;
      const pairKey = [child.id, cand.id].sort().join("|");
      if (seenPairs.has(pairKey)) return;
      seenPairs.add(pairKey);

      suggestions.push({
        childId: child.id, childName: fioOf(child),
        candidateId: cand.id, candidateName: fioOf(cand),
        reason: `Отчество «${child.middleName}» образовано от имени «${cand.firstName}» — совпадает с ${fioOf(cand)}`,
        type: "father",
      });
    });
  });

  return suggestions;
}
