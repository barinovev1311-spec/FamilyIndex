// research-service.js — ResearchService из ТЗ: конкретные генеалогические
// операции поверх AiService (DeepSeek). Каждая функция — отдельный,
// узкий промпт со своими правилами честности, а не общий чат.

const { callDeepSeek } = require("./ai-service");

const HONESTY_RULES = `
Правила, которые нельзя нарушать:
- Никогда не выдавай предположение за факт. Если не уверен — прямо скажи об этом.
- Никогда не утверждай, что конкретный человек участвовал в историческом событии, если это не подтверждено данными.
- Никогда не указывай проценты вероятности родства (не "93,7%") — используй только "сильное совпадение", "возможное совпадение", "слабое совпадение" с объяснением причин.
- Общие сведения о происхождении фамилии (этимология) — это НЕ доказательство истории конкретной семьи. Чётко разделяй эти два слоя.
- Никогда не придумывай факты, даты, места или события, которых нет в предоставленных данных.
`;

function personSummary(p) {
  const fio = [p.lastName, p.firstName, p.middleName].filter(Boolean).join(" ");
  const lines = [`ФИО: ${fio}`];
  if (p.maidenName) lines.push(`Девичья фамилия: ${p.maidenName}`);
  if (p.gender) lines.push(`Пол: ${p.gender === "male" ? "мужской" : p.gender === "female" ? "женский" : "не указан"}`);
  if (p.birth && p.birth.mode !== "unknown") lines.push(`Рождение: ${JSON.stringify(p.birth)}`);
  if (p.birthPlace) lines.push(`Место рождения: ${p.birthPlace}`);
  if (p.death && p.death.mode !== "unknown") lines.push(`Смерть: ${JSON.stringify(p.death)}`);
  if (p.deathPlace) lines.push(`Место смерти: ${p.deathPlace}`);
  if (p.occupation) lines.push(`Род занятий: ${p.occupation}`);
  if (p.bio) lines.push(`Известно о жизни: ${p.bio}`);
  if (p.nameVariants && p.nameVariants.length) lines.push(`Варианты написания имени: ${p.nameVariants.join(", ")}`);
  return lines.join("\n");
}

function relativesSummary(relLabelled) {
  return relLabelled.map((r) => `${r.role}: ${[r.person.lastName, r.person.firstName, r.person.middleName].filter(Boolean).join(" ")}`).join("\n");
}

async function generateSearchStrategies(person, relatives) {
  const prompt = `Ты помогаешь в семейном генеалогическом поиске. У тебя НЕТ доступа к интернету — ты не можешь сам искать, только предлагать стратегию человеку, который будет искать сам.
${HONESTY_RULES}

Данные о человеке, для которого ищем родственников или подтверждающие документы:
${personSummary(person)}

Известные родственники:
${relativesSummary(relatives) || "неизвестны"}

Составь несколько (4-7) конкретных поисковых запросов (готовые строки для поисковика или архивного каталога) и короткие пояснения, что и где стоит проверить в первую очередь (архивы, форумы, региональные базы). Учитывай варианты написания имени, инициалы, вероятный диапазон дат, известные места.

Ответь строго в формате JSON:
{"queries": ["строка запроса 1", "строка запроса 2", ...], "strategyNotes": "короткий абзац с общей стратегией и приоритетами поиска"}`;

  return callDeepSeek([{ role: "user", content: prompt }], { jsonMode: true });
}

async function compareCandidate(person, candidate) {
  const prompt = `Ты сравниваешь предполагаемого родственника (кандидата) с уже известным человеком в семейном дереве.
${HONESTY_RULES}

Известный человек в дереве:
${personSummary(person)}

Найденный кандидат (введено пользователем вручную по итогам собственного поиска):
ФИО: ${candidate.name}
Год рождения: ${candidate.birthYear || "неизвестен"}
Год смерти: ${candidate.deathYear || "неизвестен"}
Место: ${candidate.place || "неизвестно"}
Предполагаемая связь: ${candidate.assumedRelation || "не указана"}
Найденная информация: ${candidate.foundInfo || "нет"}

Сравни их и ответь строго в формате JSON:
{"matchStrength": "strong" | "possible" | "weak", "matchingFacts": ["совпадающий факт 1", ...], "contradictions": ["противоречие 1", ...], "explanation": "короткое объяснение вывода, 2-4 предложения"}`;

  return callDeepSeek([{ role: "user", content: prompt }], { jsonMode: true });
}

async function generateDossier(person, relatives, style) {
  const narrative = style === "narrative";
  const prompt = `Составь ${narrative ? "художественное жизнеописание с аккуратным историческим контекстом эпохи (но БЕЗ выдуманных событий из жизни самого человека)" : "фактическую справку"} по имеющимся данным.
${HONESTY_RULES}
${narrative ? "В художественном режиме исторический контекст эпохи (что происходило в стране/мире в эти годы) можно описывать, но никогда не приписывай человеку участие в этих событиях без прямых данных." : ""}

Данные о человеке:
${personSummary(person)}

Родственники:
${relativesSummary(relatives) || "неизвестны"}

Ответь строго в формате JSON:
{"basics": "основные сведения", "parents": "о родителях, если известно", "family": "о супругах, если известно", "children": "о детях, если известно", "places": "о местах жизни", "events": "важные известные события", "known": "краткое резюме что известно точно", "unknown": "что остаётся неизвестным и стоит исследовать"${narrative ? ', "narrative": "художественный связный текст жизнеописания, 150-300 слов"' : ""}}`;

  return callDeepSeek([{ role: "user", content: prompt }], { jsonMode: true });
}

async function explainSurname(surname, familyContext) {
  const prompt = `Объясни происхождение русской фамилии «${surname}».
${HONESTY_RULES}

В нашем дереве эту фамилию носят: ${familyContext || "сведений нет"}

СТРОГО раздели два слоя: (1) общая ономастика — что обычно означает такая фамилия, откуда типично происходят такие фамилии в целом (это НЕ факт про конкретно эту семью); (2) доказанная история именно этой ветви — только то, что реально есть в данных дерева, без додумывания связи с общей этимологией.

Ответь строго в формате JSON:
{"etymology": "общее происхождение и значение фамилии", "variants": ["вариант написания 1", ...], "historicalDistribution": "историческая распространённость", "regions": "характерные регионы", "additionalNotes": "дополнительный историко-культурный контекст", "disclaimer": "явное напоминание, что это общие сведения об ономастике, а не доказанная история конкретной семьи"}`;

  return callDeepSeek([{ role: "user", content: prompt }], { jsonMode: true });
}

async function historicalContextFor(person, yearFrom, yearTo) {
  const prompt = `Подбери значимые исторические события (войны, революции, смены границ, переселения, репрессии, эпидемии, голод, крупные политические изменения), которые могли повлиять на жизнь человека в указанный период. НЕ утверждай, что человек участвовал в событии — только контекст эпохи.
${HONESTY_RULES}

Человек: ${personSummary(person)}
Период: с ${yearFrom} по ${yearTo}
Место жизни: ${person.birthPlace || "неизвестно"}

Дай не более 8 самых значимых событий (не засоряй список второстепенным). Для каждого события посчитай, сколько лет было человеку в этот момент (если известна дата рождения), и сформулируй нейтрально ("человеку было N лет, он проживал в X"), не приписывая участия.

Ответь строго в формате JSON:
{"events": [{"year": 1941, "scope": "world"|"country"|"region", "title": "краткое название события", "personAge": "сколько лет было человеку или null", "note": "нейтральная фраза о контексте, без утверждений об участии"}]}`;

  return callDeepSeek([{ role: "user", content: prompt }], { jsonMode: true });
}

async function analyzeBranch(branchLabel, personsContext) {
  const prompt = `Проанализируй ветвь семейного дерева и предложи наиболее перспективные направления дальнейшего поиска.
${HONESTY_RULES}

Ветвь: ${branchLabel}
Люди в ветви:
${personsContext}

Ответь строго в формате JSON:
{"summary": "краткая оценка состояния ветви", "priorities": [{"title": "направление поиска", "reason": "почему это перспективно"}]}`;

  return callDeepSeek([{ role: "user", content: prompt }], { jsonMode: true });
}

module.exports = {
  generateSearchStrategies,
  compareCandidate,
  generateDossier,
  explainSurname,
  historicalContextFor,
  analyzeBranch,
};
