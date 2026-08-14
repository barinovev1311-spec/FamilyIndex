// relations.js — «кем приходится Марине» для любого человека в дереве,
// плюс восстановление самой цепочки родства (для хлебных крошек на
// карточке человека) и расчёт колец для страницы «Схема».

function addToSetMap(map, k, v) {
  if (!map.has(k)) map.set(k, new Set());
  map.get(k).add(v);
}

// Общий шаг для всех функций ниже: строит карту «ребёнок → родители»,
// дополненную через связи sibling там, где у человека нет собственной
// записи о родителях, но есть родной брат/сестра с известными родителями.
function buildAugmentedParents(relationships) {
  const parentsOf = new Map();
  const sibGraph = new Map();
  relationships.forEach((r) => {
    if (r.type === "parent") addToSetMap(parentsOf, r.b, r.a);
    if (r.type === "sibling") { addToSetMap(sibGraph, r.a, r.b); addToSetMap(sibGraph, r.b, r.a); }
  });

  const parentsAug = new Map();
  parentsOf.forEach((v, k) => parentsAug.set(k, new Set(v)));
  const visited = new Set();
  let synthCounter = 0;

  const component = (start) => {
    const comp = new Set([start]); const q = [start];
    while (q.length) {
      const cur = q.shift();
      for (const nb of sibGraph.get(cur) || []) if (!comp.has(nb)) { comp.add(nb); q.push(nb); }
    }
    return comp;
  };

  for (const node of sibGraph.keys()) {
    if (visited.has(node)) continue;
    const comp = component(node);
    comp.forEach((m) => visited.add(m));
    let unionParents = new Set();
    comp.forEach((m) => (parentsOf.get(m) || []).forEach((p) => unionParents.add(p)));
    if (unionParents.size) {
      comp.forEach((m) => {
        if (!parentsOf.get(m) || !parentsOf.get(m).size) {
          if (!parentsAug.has(m)) parentsAug.set(m, new Set());
          unionParents.forEach((p) => parentsAug.get(m).add(p));
        }
      });
    }
    const anyKnown = [...comp].some((m) => parentsOf.get(m) && parentsOf.get(m).size);
    if (!anyKnown) {
      synthCounter++;
      const sid = `__synthetic_${synthCounter}`;
      comp.forEach((m) => {
        if (!parentsAug.has(m)) parentsAug.set(m, new Set());
        parentsAug.get(m).add(sid);
      });
    }
  }
  return parentsAug;
}

// BFS вверх по родителям с запоминанием расстояния И пути (via —
// «через какого ребёнка этого предка мы сюда пришли», нужно для
// восстановления цепочки родства текстом).
function ancestorsWithPath(id, parentsOf) {
  const dist = new Map([[id, 0]]);
  const via = new Map(); // ancestorId -> id его потомка на пути к исходному id
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    for (const par of parentsOf.get(cur) || []) {
      const nd = dist.get(cur) + 1;
      if (!dist.has(par) || nd < dist.get(par)) {
        dist.set(par, nd);
        via.set(par, cur);
        queue.push(par);
      }
    }
  }
  return { dist, via };
}

function label(gX, gY) {
  if (gX === 0 && gY === 0) return "Это вы";
  if (gY === 0) {
    const names = ["", "родитель", "бабушка/дедушка", "прабабушка/прадедушка", "прапрабабушка/прапрадедушка", "прапрапрабабушка/прапрапрадедушка"];
    return names[gX] || `предок (${gX}-е колено)`;
  }
  if (gX === 0) {
    const names = ["", "ребёнок", "внук/внучка", "правнук/правнучка"];
    return names[gY] || `потомок (${gY}-е колено)`;
  }
  const mn = Math.min(gX, gY), mx = Math.max(gX, gY), removed = mx - mn, deg = mn - 1;
  const baseNames = { 0: removed === 0 ? "родной(ая) брат/сестра" : "брат/сестра", 1: "двоюродный(ая) брат/сестра", 2: "троюродный(ая) брат/сестра", 3: "четвероюродный(ая) брат/сестра" };
  const base = baseNames[deg] || `${deg + 1}-юродный(ая) брат/сестра`;
  if (removed === 0) return base;
  const older = gX > gY;
  if (deg === 0 && removed === 1) return older ? "тётя/дядя" : "племянник/племянница";
  if (deg === 0 && removed === 2) return older ? "двоюродный(ая) дед/бабушка" : "внучатый(ая) племянник/-ца";
  const direction = older ? "старше" : "младше";
  const kind = older ? "дяди/тёти" : "племянника/-цы";
  return `${base} (на ${removed} поколени${removed === 1 ? "е" : "я"} ${direction}, по типу ${kind})`;
}

// generationOffsetRelativeTo — для страницы «Схема»: offset (для стороны
// верх/низ) и ring = суммарное число шагов до общего предка и обратно
// (степень родства, используется как радиус).
export function generationOffsetRelativeTo(rootId, persons, relationships) {
  const parentsAug = buildAugmentedParents(relationships);
  const { dist: ancRoot } = ancestorsWithPath(rootId, parentsAug);
  const out = new Map();
  persons.forEach((p) => {
    if (p.id === rootId) { out.set(p.id, { offset: 0, ring: 0 }); return; }
    const { dist: ancX } = ancestorsWithPath(p.id, parentsAug);
    let best = null, bestSum = Infinity;
    ancRoot.forEach((gX, a) => { if (ancX.has(a)) { const sum = gX + ancX.get(a); if (sum < bestSum) { bestSum = sum; best = a; } } });
    if (best === null) return;
    const gX = ancRoot.get(best), gY = ancX.get(best);
    out.set(p.id, { offset: gX - gY, ring: gX + gY });
  });
  return out;
}

export function computeAllRelations(persons, relationships, marinaId, husbandId) {
  const parentsAug = buildAugmentedParents(relationships);
  const { dist: ancMarina } = ancestorsWithPath(marinaId, parentsAug);

  // определяем, кто из прямых родителей Марины — отец, а кто — мать
  // (по полу), и строим два отдельных набора предков для каждой линии,
  // чтобы каждого кровного родственника можно было покрасить верно.
  const marinaParentIds = [...(parentsAug.get(marinaId) || [])];
  const personById = new Map(persons.map((p) => [p.id, p]));
  const fatherId = marinaParentIds.find((id) => personById.get(id)?.gender === "male");
  const motherId = marinaParentIds.find((id) => personById.get(id)?.gender === "female");
  const ancFatherLine = fatherId ? ancestorsWithPath(fatherId, parentsAug).dist : new Map();
  const ancMotherLine = motherId ? ancestorsWithPath(motherId, parentsAug).dist : new Map();

  const sideOfAncestor = (ancestorId) => {
    if (ancestorId === fatherId || ancFatherLine.has(ancestorId)) return "father";
    if (ancestorId === motherId || ancMotherLine.has(ancestorId)) return "mother";
    return null;
  };

  const result = new Map();

  persons.forEach((p) => {
    if (p.id === marinaId) { result.set(p.id, { generation: 0, side: null, relationToMarina: "Это вы — Марина" }); return; }
    if (husbandId && p.id === husbandId) { result.set(p.id, { generation: 0, side: "husband", relationToMarina: "супруг Марины" }); return; }
    const { dist: ancX } = ancestorsWithPath(p.id, parentsAug);
    let best = null, bestSum = Infinity;
    ancMarina.forEach((gX, a) => { if (ancX.has(a)) { const sum = gX + ancX.get(a); if (sum < bestSum) { bestSum = sum; best = a; } } });
    if (best === null) { result.set(p.id, { generation: null, side: null, relationToMarina: "родство не установлено" }); return; }
    const gX = ancMarina.get(best), gY = ancX.get(best);
    const side = gX > 0 ? sideOfAncestor(best) : null;
    result.set(p.id, { generation: gX - gY, side, relationToMarina: label(gX, gY) });
  });

  if (husbandId) {
    const { dist: ancHusband } = ancestorsWithPath(husbandId, parentsAug);
    persons.forEach((p) => {
      if (p.id === marinaId || p.id === husbandId) return;
      const cur = result.get(p.id);
      if (cur && cur.relationToMarina === "родство не установлено") {
        const { dist: ancX } = ancestorsWithPath(p.id, parentsAug);
        let connected = false;
        ancHusband.forEach((_, a) => { if (ancX.has(a)) connected = true; });
        if (connected) result.set(p.id, { generation: null, side: "husband", relationToMarina: "родня со стороны мужа" });
      }
    });
  }
  return result;
}

// relationPathToMarina — восстанавливает саму цепочку: массив id людей
// от Марины до personId включительно (напр. [Марина, мать, бабушка,
// дядя, кузен]). Используется для «хлебных крошек» на карточке.
export function relationPathToMarina(personId, persons, relationships, marinaId) {
  if (personId === marinaId) return [marinaId];
  const parentsAug = buildAugmentedParents(relationships);
  const { dist: ancMarina, via: viaMarina } = ancestorsWithPath(marinaId, parentsAug);
  const { dist: ancX, via: viaX } = ancestorsWithPath(personId, parentsAug);

  let best = null, bestSum = Infinity;
  ancMarina.forEach((gX, a) => { if (ancX.has(a)) { const sum = gX + ancX.get(a); if (sum < bestSum) { bestSum = sum; best = a; } } });
  if (best === null) return null;

  // вверх: common ancestor -> ... -> Марина (через viaMarina), затем разворачиваем
  const upChain = [];
  let cur = best;
  while (cur !== undefined) { upChain.push(cur); if (cur === marinaId) break; cur = viaMarina.get(cur); }
  const marinaToAncestor = upChain.slice().reverse(); // Марина ... common

  // вниз: common ancestor -> ... -> personId (через viaX)
  const downChain = [];
  cur = best;
  while (cur !== undefined) { downChain.push(cur); if (cur === personId) break; cur = viaX.get(cur); }

  const full = [...marinaToAncestor, ...downChain.slice(1)];
  // синтетические узлы (неизвестный общий предок) не показываем как людей
  return full.filter((id) => !String(id).startsWith("__synthetic_"));
}
