// relations.js — «кем приходится Марине» для любого человека в дереве.
// Пересчитывается на лету при каждом изменении, поэтому если Марина
// добавляет нового человека и связь к нему — родство подписывается
// сразу, без ручного ввода.

function ancestorsWithDist(id, parentsOf) {
  const dist = new Map([[id, 0]]);
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    for (const par of parentsOf.get(cur) || []) {
      const nd = dist.get(cur) + 1;
      if (!dist.has(par) || nd < dist.get(par)) {
        dist.set(par, nd);
        queue.push(par);
      }
    }
  }
  return dist;
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

// generationOffsetRelativeTo — то же самое дерево связей, но радиус
// считается от произвольного выбранного человека (для страницы «Схема»),
// а не всегда от Марины.
export function generationOffsetRelativeTo(rootId, persons, relationships) {
  const parentsOf = new Map();
  const sibGraph = new Map();
  const add = (map, k, v) => { if (!map.has(k)) map.set(k, new Set()); map.get(k).add(v); };
  relationships.forEach((r) => {
    if (r.type === "parent") add(parentsOf, r.b, r.a);
    if (r.type === "sibling") { add(sibGraph, r.a, r.b); add(sibGraph, r.b, r.a); }
  });
  const parentsAug = new Map();
  parentsOf.forEach((v, k) => parentsAug.set(k, new Set(v)));
  const visited = new Set();
  let synthCounter = 0;
  const component = (start) => {
    const comp = new Set([start]); const q = [start];
    while (q.length) { const cur = q.shift(); for (const nb of sibGraph.get(cur) || []) if (!comp.has(nb)) { comp.add(nb); q.push(nb); } }
    return comp;
  };
  for (const node of sibGraph.keys()) {
    if (visited.has(node)) continue;
    const comp = component(node);
    comp.forEach((m) => visited.add(m));
    let unionParents = new Set();
    comp.forEach((m) => (parentsOf.get(m) || []).forEach((p) => unionParents.add(p)));
    if (unionParents.size) comp.forEach((m) => { if (!parentsOf.get(m) || !parentsOf.get(m).size) { if (!parentsAug.has(m)) parentsAug.set(m, new Set()); unionParents.forEach((p) => parentsAug.get(m).add(p)); } });
    const anyKnown = [...comp].some((m) => parentsOf.get(m) && parentsOf.get(m).size);
    if (!anyKnown) { synthCounter++; const sid = `__syn_${synthCounter}`; comp.forEach((m) => { if (!parentsAug.has(m)) parentsAug.set(m, new Set()); parentsAug.get(m).add(sid); }); }
  }
  const ancRoot = ancestorsWithDist(rootId, parentsAug);
  const out = new Map();
  persons.forEach((p) => {
    if (p.id === rootId) { out.set(p.id, { offset: 0, ring: 0 }); return; }
    const ancX = ancestorsWithDist(p.id, parentsAug);
    let best = null, bestSum = Infinity;
    ancRoot.forEach((gX, a) => { if (ancX.has(a)) { const sum = gX + ancX.get(a); if (sum < bestSum) { bestSum = sum; best = a; } } });
    if (best === null) return;
    const gX = ancRoot.get(best), gY = ancX.get(best);
    out.set(p.id, { offset: gX - gY, ring: gX + gY });
  });
  return out;
}
export function computeAllRelations(persons, relationships, marinaId, husbandId) {
  const parentsOf = new Map();
  const sibGraph = new Map();
  const add = (map, k, v) => { if (!map.has(k)) map.set(k, new Set()); map.get(k).add(v); };

  relationships.forEach((r) => {
    if (r.type === "parent") add(parentsOf, r.b, r.a);
    if (r.type === "sibling") { add(sibGraph, r.a, r.b); add(sibGraph, r.b, r.a); }
  });

  // sibling-augmentation: fill in parents for people who only have a sibling edge
  const visited = new Set();
  const parentsAug = new Map();
  parentsOf.forEach((v, k) => parentsAug.set(k, new Set(v)));
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

  const ancMarina = ancestorsWithDist(marinaId, parentsAug);
  const result = new Map();

  persons.forEach((p) => {
    if (p.id === marinaId) {
      result.set(p.id, { generation: 0, side: null, relationToMarina: "Это вы — Марина" });
      return;
    }
    if (husbandId && p.id === husbandId) {
      result.set(p.id, { generation: 0, side: "husband", relationToMarina: "супруг Марины" });
      return;
    }
    const ancX = ancestorsWithDist(p.id, parentsAug);
    let best = null, bestSum = Infinity;
    ancMarina.forEach((gX, a) => {
      if (ancX.has(a)) {
        const sum = gX + ancX.get(a);
        if (sum < bestSum) { bestSum = sum; best = a; }
      }
    });
    if (best === null) {
      result.set(p.id, { generation: null, side: null, relationToMarina: "родство не установлено" });
      return;
    }
    const gX = ancMarina.get(best), gY = ancX.get(best);
    result.set(p.id, { generation: gX - gY, side: null, relationToMarina: label(gX, gY) });
  });

  // mark husband's own blood relatives ("родня со стороны мужа")
  if (husbandId) {
    const ancHusband = ancestorsWithDist(husbandId, parentsAug);
    persons.forEach((p) => {
      if (p.id === marinaId || p.id === husbandId) return;
      const cur = result.get(p.id);
      if (cur && cur.relationToMarina === "родство не установлено") {
        const ancX = ancestorsWithDist(p.id, parentsAug);
        let connected = false;
        ancHusband.forEach((_, a) => { if (ancX.has(a)) connected = true; });
        if (connected) result.set(p.id, { generation: null, side: "husband", relationToMarina: "родня со стороны мужа" });
      }
    });
  }

  return result;
}
