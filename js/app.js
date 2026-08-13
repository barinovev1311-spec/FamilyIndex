import { DB } from "./db.js";
import { generationOffsetRelativeTo } from "./relations.js";

const app = document.getElementById("app");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fullName(p) {
  if (!p) return "—";
  return [p.lastName, p.firstName, p.middleName].filter(Boolean).join(" ") || "(без имени)";
}
function dateLabel(d) {
  if (!d) return "";
  if (d.mode === "exact" && d.exact) return d.exact.split("-").reverse().join(".");
  if (d.mode === "year" && d.year) return d.year;
  if (d.mode === "approx" && d.year) return `ок. ${d.year}`;
  if (d.mode === "range" && (d.from || d.to)) return `${d.from || "?"}–${d.to || "?"}`;
  return "";
}
function shortDates(p) {
  const b = dateLabel(p.birth);
  if (p.isLiving) return b ? `${b} — н.в.` : "";
  const d = dateLabel(p.death);
  if (!b && !d) return "";
  return `${b || "?"} — ${d || "?"}`;
}
function birthYear(p) {
  const b = p?.birth;
  if (!b) return null;
  if (b.exact) { const m = String(b.exact).match(/\d{4}/); if (m) return Number(m[0]); }
  if (b.year) return Number(b.year);
  if (b.from) return Number(b.from);
  return null;
}
function branchClass(p) {
  if (p._meta?.side === "father") return "father";
  if (p._meta?.side === "mother") return "mother";
  if (p._meta?.side === "husband") return "husband";
  return "plain";
}
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function toast(msg, isError) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
async function guarded(fn) {
  try { await fn(); }
  catch (e) {
    if (e.message === "unauthorized") {
      toast("Сессия истекла или неверный пароль — войдите заново.", true);
      DB.setPassword(null);
      location.hash = "#/admin";
    } else {
      toast("Не удалось сохранить: " + e.message, true);
    }
  }
}

// -------------------------------------------------------------- router

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [view, id] = hash.split("/");
  return { view: view || "home", id };
}
window.addEventListener("hashchange", render);
DB.onChange(render);

const NAV = [["home", "Главная"], ["tree", "Дерево"], ["scheme", "Схема"], ["people", "Люди"], ["origins", "Фамилии"], ["geography", "География"], ["admin", "Админка"]];

function layout(view, inner) {
  return `
    <header class="topbar">
      <a href="#/home" class="brand"><span class="brand-seal">СК</span> Скрябины</a>
      <nav class="topnav">${NAV.map(([k, l]) => `<a href="#/${k}" class="${view === k ? "active" : ""}">${l}</a>`).join("")}</nav>
    </header>
    ${inner}
    <p class="footer-note">Семейный архив Скрябиных — общие данные для всех, кто заходит на сайт. Не является официальным генеалогическим документом.</p>
  `;
}

function loadingScreen() {
  return `<div class="loading-screen"><div class="loading-dot"></div><p class="muted">Загружаем семейный архив…</p></div>`;
}

// -------------------------------------------------------------- home

function constellationHeroSVG() {
  const places = window.FAMILY_PLACES;
  const w = 640, h = 380;
  const positions = [{ x: 120, y: 100 }, { x: 185, y: 145 }, { x: 480, y: 235 }, { x: 260, y: 305 }, { x: 500, y: 95 }];
  let svg = `<svg class="constellation-map" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Карта мест, где жила семья">`;
  svg += `<path class="link-line" d="M 40 60 C 150 110, 180 180, 260 220 S 420 260, 600 320" />`;
  svg += `<path class="link-line" d="M 420 40 C 460 100, 440 180, 470 230" />`;
  places.forEach((pl, i) => {
    const pos = positions[i] || { x: 300, y: 200 };
    const delay = (i * 0.12).toFixed(2);
    const labelRight = pos.x < w - 140;
    const tx = labelRight ? pos.x + 12 : pos.x - 12;
    const anchor = labelRight ? "start" : "end";
    svg += `<g class="twinkle" style="animation-delay:${delay}s">
      <circle class="node-dot ${pl.status}" cx="${pos.x}" cy="${pos.y}" r="7" />
      <text class="node-label" text-anchor="${anchor}" x="${tx}" y="${pos.y + 4}">${esc(pl.mapLabel || pl.name)}</text>
      <text class="node-status" text-anchor="${anchor}" x="${tx}" y="${pos.y + 17}">${pl.status === "vanished" ? "исчезла" : pl.status === "existing" ? "существует" : "статус неизвестен"}</text>
    </g>`;
  });
  svg += `</svg>`;
  return svg;
}

function viewHome() {
  const stats = DB.stats();
  const origins = window.SURNAME_ORIGINS.slice(0, 3);
  return `
    <section class="hero">
      <div class="hero-inner">
        <div class="hero-text">
          <span class="eyebrow">Семейный архив · Костромская и Вологодская земля</span>
          <h1>Семь поколений.<br><span class="grad">Три исчезнувшие деревни.</span><br>Одна фамилия.</h1>
          <p class="lede">Скрябины, Замышляевы, Каретниковы, Ванчиковы — род из деревень Никольского уезда и города Костромы. Часть деревень, где они жили, официально больше не существует. Этот сайт — попытка удержать то, что ещё можно удержать.</p>
          <div class="hero-cta">
            <a class="btn btn-primary" href="#/scheme">Смотреть схему рода</a>
            <a class="btn" href="#/tree">Дерево по поколениям</a>
          </div>
          <div class="hero-stats">
            <div class="hero-stat"><strong>${stats.persons}</strong><span>человек в архиве</span></div>
            <div class="hero-stat"><strong>${stats.generations}</strong><span>поколений</span></div>
            <div class="hero-stat"><strong>${stats.photos}</strong><span>фотографий добавлено</span></div>
          </div>
        </div>
        <div class="constellation-wrap">${constellationHeroSVG()}</div>
      </div>
    </section>

    <section class="block">
      <div class="block-inner">
        <div class="block-head"><span class="eyebrow">Откуда фамилии</span><h2>Каждая фамилия — это когда-то было прозвище, ремесло или имя отца</h2></div>
        <div class="origin-grid">${origins.map(originCard).join("")}</div>
        <p style="margin-top:22px"><a href="#/origins">Читать про все фамилии рода →</a></p>
      </div>
    </section>

    <section class="block tinted">
      <div class="block-inner">
        <div class="block-head">
          <span class="eyebrow">Общий, живой архив</span>
          <h2>Этот сайт растёт вместе с семьёй</h2>
          <p class="lede">Марина Алексеевна входит в «Админку» и добавляет новых родственников, фотографии, уточнения — и это сразу видят все, кто открывает сайт, а не только она сама.</p>
        </div>
        <a class="btn btn-primary" href="#/admin">Войти как Марина</a>
      </div>
    </section>
  `;
}

function originCard(o) {
  const cls = o.side.includes("отца") ? "side-father" : o.side.includes("матери") ? "side-mother" : "side-other";
  return `
    <div class="origin-card ${cls}">
      <div class="side-tag">${esc(o.side)}</div>
      <div class="surname">${esc(o.surname)}</div>
      <p>${esc(o.origin)}</p>
      ${o.note ? `<p class="muted" style="font-size:0.85rem">${esc(o.note)}</p>` : ""}
      ${o.uncertain ? `<span class="uncertain-tag">версия не окончательная</span>` : ""}
    </div>
  `;
}

function viewOrigins() {
  return `
    <div class="page-narrow">
      <div class="page-head"><div><span class="eyebrow">Ономастика рода</span><h1>Откуда взялись фамилии</h1>
      <p class="lede">Общепринятые версии происхождения фамилий, встречающихся в дереве — не архивные факты именно о вашей семье, а сведения об именослове вообще. Где версия не окончательная, это указано.</p></div></div>
      <div class="origin-grid">${window.SURNAME_ORIGINS.map(originCard).join("")}</div>
    </div>
  `;
}

function viewGeography() {
  return `
    <div class="page-narrow">
      <div class="page-head"><div><span class="eyebrow">География рода</span><h1>Места, где жила семья</h1>
      <p class="lede">Основано на месте рождения из карточек людей. Статус — по официальным данным об упразднённых населённых пунктах.</p></div></div>
      ${constellationHeroSVG()}
      <div class="place-list" style="margin-top:34px">
        ${window.FAMILY_PLACES.map((pl) => `
          <div class="place-row">
            <div class="place-name">${esc(pl.name)}<div class="muted" style="font-size:0.8rem;font-weight:400">${esc(pl.region)}</div></div>
            <span class="status-pill ${pl.status}">${pl.status === "vanished" ? "исчезла" : pl.status === "existing" ? "существует" : "статус неизвестен"}</span>
            <p>${esc(pl.note)}</p>
          </div>`).join("")}
      </div>
    </div>
  `;
}

// -------------------------------------------------------------- tree

function romanNumeral(n) {
  const map = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let res = "", num = n;
  for (const [val, sym] of map) while (num >= val) { res += sym; num -= val; }
  return res || "0";
}

function viewTree() {
  const db = DB.get();
  const resolved = db.persons.filter((p) => p._meta.generation !== null);
  if (resolved.length === 0) return `<div class="page">${emptyState("Дерево пока пустое", "Добавьте первого человека через админку.")}</div>`;
  const maxOff = Math.max(...resolved.map((p) => p._meta.generation));
  const byGen = new Map();
  resolved.forEach((p) => {
    const g = maxOff - p._meta.generation + 1;
    if (!byGen.has(g)) byGen.set(g, []);
    byGen.get(g).push(p);
  });
  const gens = [...byGen.keys()].sort((a, b) => a - b);
  return `
    <div class="page">
      <div class="page-head">
        <div><span class="eyebrow">Родословная</span><h1>Дерево рода</h1></div>
        ${DB.hasSession() ? `<a class="btn btn-primary" href="#/admin">+ Добавить человека</a>` : ""}
      </div>
      ${gens.map((g) => {
        const people = byGen.get(g).sort((a, b) => (birthYear(a) || 9999) - (birthYear(b) || 9999));
        return `<div class="gen-row"><div class="gen-label"><span class="gen-numeral">${romanNumeral(g)}</span><span class="gen-title">поколение ${g} · ${people.length} чел.</span></div><div class="gen-people">${people.map(personCard).join("")}</div></div>`;
      }).join("")}
    </div>
  `;
}

function personCard(p) {
  const branch = branchClass(p);
  const photo = p.photo ? `<img class="person-photo" src="${p.photo}" alt="">` : `<div class="person-photo-placeholder avatar-${branch}">${esc((p.firstName || "?")[0])}</div>`;
  return `
    <a class="person-card branch-${branch}" href="#/person/${p.id}">
      ${p.isLiving ? `<span class="living-dot" title="жив(а)"></span>` : ""}
      ${photo}
      <div class="person-name">${esc(fullName(p))}</div>
      <div class="person-dates">${esc(shortDates(p))}</div>
      <div class="person-relation">${esc(p._meta.relationToMarina)}</div>
    </a>
  `;
}

function emptyState(title, body) {
  return `<div class="empty-state"><h3>${esc(title)}</h3><p class="muted">${esc(body)}</p></div>`;
}

// -------------------------------------------------------------- people

function viewPeople() {
  const db = DB.get();
  const q = (window.__peopleQ || "").toLowerCase();
  const sideFilter = window.__peopleSide || "all";
  let list = db.persons.slice();
  if (q) list = list.filter((p) => fullName(p).toLowerCase().includes(q));
  if (sideFilter !== "all") list = list.filter((p) => p._meta.side === sideFilter);
  list.sort((a, b) => fullName(a).localeCompare(fullName(b), "ru"));
  const sides = [["all", "все"], ["father", "линия отца"], ["mother", "линия матери"], ["husband", "родня мужа"]];
  return `
    <div class="page">
      <div class="page-head">
        <div><span class="eyebrow">${db.persons.length} человек</span><h1>Все люди в архиве</h1></div>
        ${DB.hasSession() ? `<a class="btn btn-primary" href="#/admin">+ Добавить человека</a>` : ""}
      </div>
      <input class="search-box" type="search" placeholder="Найти по имени…" value="${esc(window.__peopleQ || "")}" data-action="people-search">
      <div class="filter-row">${sides.map(([k, l]) => `<button class="chip ${sideFilter === k ? "active" : ""}" data-action="people-side" data-side="${k}">${l}</button>`).join("")}</div>
      ${list.length === 0 ? emptyState("Никого не найдено", "Попробуйте другой запрос или фильтр.") : `<div class="directory-grid">${list.map(personCard).join("")}</div>`}
    </div>
  `;
}

// -------------------------------------------------------------- person detail

function viewPerson(id) {
  const p = DB.getPerson(id);
  if (!p) return `<div class="page">${emptyState("Человек не найден", "Возможно, запись была удалена.")}</div>`;
  const parents = DB.parentsOf(id), spouses = DB.spousesOf(id), children = DB.childrenOf(id), siblings = DB.siblingsOf(id);
  const branch = branchClass(p);

  const relGroup = (title, arr, relType) => arr.length ? `
    <div class="rel-group"><h4>${title}</h4><ul class="rel-list">
      ${arr.map((x) => `<li>
        <a href="#/person/${x.id}">${esc(fullName(x))}</a> <span class="muted" style="font-size:0.8rem">${esc(shortDates(x))}</span>
        ${DB.hasSession() ? `<button class="btn btn-small btn-danger" style="padding:1px 8px;font-size:0.7rem;margin-left:6px" data-action="remove-relation" data-a="${p.id}" data-b="${x.id}" data-type="${relType}" title="Убрать эту связь">✕</button>` : ""}
      </li>`).join("")}
    </ul></div>` : "";

  return `
    <div class="page">
      <p style="margin-top:26px"><a href="#/people">← Все люди</a></p>
      <div class="person-hero">
        ${p.photo ? `<img class="person-hero-photo" src="${p.photo}" alt="">` : `<div class="person-hero-photo-placeholder avatar-${branch}">${esc((p.firstName || "?")[0])}</div>`}
        <div>
          <span class="relation-badge">${esc(p._meta.relationToMarina)}</span>
          <h1>${esc(fullName(p))}</h1>
          <p class="muted">${esc(shortDates(p))} ${p.birthPlace ? "· " + esc(p.birthPlace) : ""}</p>
          ${DB.hasSession() ? `<div style="display:flex;gap:8px;margin-top:16px"><button class="btn btn-small" data-action="edit-person" data-id="${p.id}">Редактировать</button><button class="btn btn-small" data-action="quick-add-open" data-id="${p.id}">+ Родственник</button></div>` : ""}
        </div>
      </div>

      <div class="info-grid">
        ${p.occupation ? infoItem("Род занятий", p.occupation) : ""}
        ${p.deathPlace && !p.isLiving ? infoItem("Место смерти", p.deathPlace) : ""}
        ${p.maidenName ? infoItem("Девичья фамилия", p.maidenName) : ""}
        ${(p.nameVariants || []).length ? infoItem("Варианты имени", p.nameVariants.join(", ")) : ""}
      </div>

      ${p.bio ? `<div class="panel"><h4 class="eyebrow">Биография</h4><p>${esc(p.bio)}</p></div>` : ""}
      ${p.notes ? `<div class="panel"><h4 class="eyebrow">Заметки</h4><p>${esc(p.notes)}</p></div>` : ""}

      <div id="quick-add-slot"></div>
      <div id="edit-person-slot"></div>

      <div class="rel-groups">
        ${relGroup("Родители", parents, "parent-of-them")}
        ${relGroup("Супруги", spouses, "spouse")}
        ${relGroup("Дети", children, "parent-of-me")}
        ${relGroup("Братья и сёстры", siblings, "sibling")}
      </div>
    </div>
  `;
}

function infoItem(label, value) {
  return `<div class="info-item"><div class="info-label">${esc(label)}</div><div class="info-value">${esc(value)}</div></div>`;
}

// -------------------------------------------------------------- scheme (orbital diagram)

function viewScheme() {
  const db = DB.get();
  if (db.persons.length === 0) return `<div class="page">${emptyState("Пока пусто", "Добавьте людей через админку.")}</div>`;
  const rootId = window.__schemeRoot || db.marinaId;
  const root = DB.getPerson(rootId) || db.persons[0];
  const offsets = generationOffsetRelativeTo(root.id, db.persons, db.relationships);

  const w = 1200, ringGap = 72;
  const nodesByRing = new Map();
  let maxRing = 0;
  db.persons.forEach((p) => {
    if (!offsets.has(p.id)) return;
    const { offset, ring } = offsets.get(p.id);
    maxRing = Math.max(maxRing, ring);
    if (!nodesByRing.has(ring)) nodesByRing.set(ring, []);
    nodesByRing.get(ring).push({ p, offset });
  });

  const h = Math.max(560, (maxRing + 1) * ringGap * 2 + 140);
  const cx = w / 2, cy = h / 2;
  const positions = new Map();
  positions.set(root.id, { x: cx, y: cy });

  nodesByRing.forEach((list, ring) => {
    if (ring === 0) return; // сам корень уже размещён
    const ancestors = list.filter((n) => n.offset > 0).sort((a, b) => (birthYear(a.p) || 9999) - (birthYear(b.p) || 9999));
    const sameGen = list.filter((n) => n.offset === 0);
    const descendants = list.filter((n) => n.offset < 0);
    const r = ringGap * ring;
    const place = (arr, startDeg, endDeg) => {
      const span = ((endDeg - startDeg) * Math.PI) / 180;
      arr.forEach((n, i) => {
        const t = arr.length === 1 ? 0.5 : i / (arr.length - 1);
        const theta = (startDeg * Math.PI) / 180 + t * span;
        positions.set(n.p.id, { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
      });
    };
    // предки — верхняя дуга, потомки — нижняя, ровесники (кузены) — по бокам
    place(ancestors, 195, 345);
    place(descendants, 15, 165);
    if (sameGen.length) {
      // ровесники: половина слева, половина справа, вертикально по центру кольца
      const left = sameGen.slice(0, Math.ceil(sameGen.length / 2));
      const right = sameGen.slice(Math.ceil(sameGen.length / 2));
      const placeSide = (arr, baseDeg, spread) => arr.forEach((n, i) => {
        const t = arr.length === 1 ? 0.5 : i / (arr.length - 1);
        const theta = ((baseDeg - spread / 2 + t * spread) * Math.PI) / 180;
        positions.set(n.p.id, { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
      });
      placeSide(left, 180, 30);
      placeSide(right, 0, 30);
    }
  });

  let svg = `<svg class="scheme-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
  for (let r = 1; r <= maxRing; r++) {
    svg += `<circle cx="${cx}" cy="${cy}" r="${r * ringGap}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1" />`;
    svg += `<text class="scheme-ring-label" x="${cx + r * ringGap + 6}" y="${cy - 4}">${r} шаг${r === 1 ? "" : r < 5 ? "а" : "ов"} родства</text>`;
  }

  // рёбра
  db.relationships.forEach((r) => {
    const a = positions.get(r.a), b = positions.get(r.b);
    if (!a || !b) return;
    if (r.type === "parent") svg += `<line class="scheme-edge-blood" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`;
    if (r.type === "spouse") svg += `<line class="scheme-edge-spouse" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`;
  });

  // узлы
  db.persons.forEach((p) => {
    const pos = positions.get(p.id);
    if (!pos) return;
    const branch = branchClass(p);
    const color = branch === "father" ? "var(--violet)" : branch === "mother" ? "var(--teal)" : branch === "husband" ? "var(--coral)" : "var(--ink-faint)";
    const isRoot = p.id === root.id;
    svg += `<g class="scheme-node" style="color:${color}" data-action="scheme-node-click" data-id="${p.id}">
      <circle cx="${pos.x}" cy="${pos.y}" r="16" fill="transparent" />
      <circle cx="${pos.x}" cy="${pos.y}" r="${isRoot ? 12 : 7}" class="node-visible" fill="${color}" stroke="${isRoot ? "#fff" : "none"}" stroke-width="2" style="pointer-events:none" />
      <text x="${pos.x}" y="${pos.y - (isRoot ? 18 : 12)}" text-anchor="middle">${esc(p.lastName)} ${esc((p.firstName || "")[0] || "")}.</text>
      <text class="node-sub" x="${pos.x}" y="${pos.y + (isRoot ? 24 : 18)}" text-anchor="middle">${esc(birthYear(p) || "")}</text>
    </g>`;
  });
  svg += `</svg>`;

  const db2 = db;
  return `
    <div class="page">
      <div class="page-head"><div><span class="eyebrow">Наглядная схема</span><h1>Схема родства</h1>
      <p class="lede">Расстояние до центра — степень родства (шагов по дереву до общего предка и обратно). Предки — сверху, потомки — снизу, ровесники по поколению (братья, кузены) — по бокам. Нажмите на точку, чтобы открыть карточку.</p></div></div>

      <div class="scheme-toolbar">
        <label style="display:flex;align-items:center;gap:8px;font-size:0.88rem;color:var(--ink-soft)">Центр схемы:
          <select class="input" data-action="scheme-root-select" style="width:auto">
            ${db2.persons.filter((p) => offsets.has(p.id) || p.id === root.id).sort((a, b) => fullName(a).localeCompare(fullName(b), "ru")).map((p) => `<option value="${p.id}" ${p.id === root.id ? "selected" : ""}>${esc(fullName(p))}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="scheme-legend">
        <span><span class="legend-dot" style="background:var(--violet)"></span>линия отца</span>
        <span><span class="legend-dot" style="background:var(--teal)"></span>линия матери</span>
        <span><span class="legend-dot" style="background:var(--coral)"></span>родня мужа</span>
        <span>— сплошная линия: кровное родство</span>
        <span>┄ пунктир: брак</span>
      </div>
      <div class="scheme-canvas-wrap">${svg}</div>
    </div>
  `;
}

// -------------------------------------------------------------- admin: shared form pieces

function dateFieldset(prefix, label, d = { mode: "unknown" }) {
  const mode = d.mode || "unknown";
  const show = (m) => (mode === m ? "inline-flex" : "none");
  return `
    <fieldset class="date-fieldset" data-datefield="${prefix}">
      <legend>${label}</legend>
      <select class="input" name="${prefix}_mode">
        <option value="unknown" ${mode === "unknown" ? "selected" : ""}>неизвестно</option>
        <option value="exact" ${mode === "exact" ? "selected" : ""}>точная дата</option>
        <option value="year" ${mode === "year" ? "selected" : ""}>только год</option>
        <option value="approx" ${mode === "approx" ? "selected" : ""}>примерно</option>
        <option value="range" ${mode === "range" ? "selected" : ""}>диапазон</option>
      </select>
      <span class="date-inputs" data-mode="exact" style="display:${show("exact")}"><input class="input" type="date" name="${prefix}_exact" value="${esc(d.exact)}"></span>
      <span class="date-inputs" data-mode="year" style="display:${show("year")}"><input class="input input-narrow" type="number" name="${prefix}_year" value="${esc(d.year)}" placeholder="1921"></span>
      <span class="date-inputs" data-mode="approx" style="display:${show("approx")}"><input class="input input-narrow" type="number" name="${prefix}_year_approx" value="${esc(d.year)}" placeholder="1921"><span class="muted">±</span><input class="input input-narrow" type="number" name="${prefix}_spread" value="${esc(d.approxSpread || 2)}"></span>
      <span class="date-inputs" data-mode="range" style="display:${show("range")}"><input class="input input-narrow" type="number" name="${prefix}_from" value="${esc(d.from)}" placeholder="от"><input class="input input-narrow" type="number" name="${prefix}_to" value="${esc(d.to)}" placeholder="до"></span>
    </fieldset>`;
}

function readDateField(form, prefix) {
  const mode = form.elements[`${prefix}_mode`].value;
  const out = { mode };
  if (mode === "exact") out.exact = form.elements[`${prefix}_exact`].value;
  if (mode === "year") out.year = form.elements[`${prefix}_year`].value;
  if (mode === "approx") { out.year = form.elements[`${prefix}_year_approx`].value; out.approxSpread = form.elements[`${prefix}_spread`].value; }
  if (mode === "range") { out.from = form.elements[`${prefix}_from`].value; out.to = form.elements[`${prefix}_to`].value; }
  return out;
}

function personFormFields(p = {}) {
  return `
    <div class="form-grid">
      <label>Фамилия <input class="input" name="lastName" value="${esc(p.lastName)}"></label>
      <label>Имя <input class="input" name="firstName" value="${esc(p.firstName)}"></label>
      <label>Отчество <input class="input" name="middleName" value="${esc(p.middleName)}"></label>
      <label>Девичья фамилия <input class="input" name="maidenName" value="${esc(p.maidenName)}"></label>
      <label>Пол <select class="input" name="gender">
        <option value="unknown" ${!p.gender || p.gender === "unknown" ? "selected" : ""}>не указан</option>
        <option value="male" ${p.gender === "male" ? "selected" : ""}>мужской</option>
        <option value="female" ${p.gender === "female" ? "selected" : ""}>женский</option>
      </select></label>
      <label class="checkbox-row"><input type="checkbox" name="isLiving" ${p.isLiving ? "checked" : ""}> жив(а)</label>
    </div>
    ${dateFieldset("birth", "Рождение", p.birth)}
    ${dateFieldset("death", "Смерть", p.death)}
    <div class="form-grid">
      <label>Место рождения <input class="input" name="birthPlace" value="${esc(p.birthPlace)}"></label>
      <label>Место смерти <input class="input" name="deathPlace" value="${esc(p.deathPlace)}"></label>
      <label>Род занятий <input class="input" name="occupation" value="${esc(p.occupation)}"></label>
    </div>
    <label class="block">Биография <textarea class="input" name="bio" rows="3">${esc(p.bio)}</textarea></label>
    <label class="block">Заметки <textarea class="input" name="notes" rows="2">${esc(p.notes)}</textarea></label>
    <label class="block">Фотография
      <input type="file" accept="image/*" data-action="photo-input">
      <div class="photo-target">${p.photo ? `<img class="photo-preview" src="${p.photo}">` : ""}</div>
    </label>
    <input type="hidden" name="photo" value="${esc(p.photo || "")}">
  `;
}

function readPersonForm(form) {
  const fd = new FormData(form);
  return {
    lastName: fd.get("lastName")?.trim() || "", firstName: fd.get("firstName")?.trim() || "",
    middleName: fd.get("middleName")?.trim() || "", maidenName: fd.get("maidenName")?.trim() || "",
    gender: fd.get("gender") || "unknown", isLiving: fd.get("isLiving") === "on",
    birth: readDateField(form, "birth"), death: readDateField(form, "death"),
    birthPlace: fd.get("birthPlace")?.trim() || "", deathPlace: fd.get("deathPlace")?.trim() || "",
    occupation: fd.get("occupation")?.trim() || "", bio: fd.get("bio")?.trim() || "", notes: fd.get("notes")?.trim() || "",
    photo: fd.get("photo") || "",
  };
}

function resizeImageFile(file, maxW, cb) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      cb(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

const QUICK_ADD_DEFS = [
  { key: "father", label: "Отец", type: "parent", dir: "up", gender: "male" },
  { key: "mother", label: "Мать", type: "parent", dir: "up", gender: "female" },
  { key: "spouse", label: "Супруг(а)", type: "spouse", dir: "side", gender: "" },
  { key: "son", label: "Сын", type: "parent", dir: "down", gender: "male" },
  { key: "daughter", label: "Дочь", type: "parent", dir: "down", gender: "female" },
  { key: "brother", label: "Брат", type: "sibling", dir: "side", gender: "male" },
  { key: "sister", label: "Сестра", type: "sibling", dir: "side", gender: "female" },
];

function quickAddPanel() {
  return `
    <div class="panel">
      <h4 class="eyebrow">Быстро добавить родственника</h4>
      <div class="filter-row">${QUICK_ADD_DEFS.map((q) => `<button class="chip" data-action="quick-add-pick" data-key="${q.key}">${q.label}</button>`).join("")}</div>
      <div id="quick-add-form-slot"></div>
    </div>
  `;
}

function quickAddForm(personId, key) {
  const def = QUICK_ADD_DEFS.find((q) => q.key === key);
  const others = DB.get().persons.filter((x) => x.id !== personId);
  return `
    <form data-form="quick-add" data-person="${personId}" data-key="${key}" style="margin-top:12px">
      <p><strong>${def.label}</strong></p>
      <label class="radio-row"><input type="radio" name="mode" value="new" checked> новый человек: <input class="input" name="newName" placeholder="Имя Фамилия" style="width:auto"></label>
      <label class="radio-row" style="margin-top:8px"><input type="radio" name="mode" value="existing"> уже есть в архиве: <select class="input" name="existingId" style="width:auto">
        <option value="">— выбрать —</option>${others.map((o) => `<option value="${o.id}">${esc(fullName(o))}</option>`).join("")}
      </select></label>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="btn btn-small btn-primary" type="submit">Добавить</button>
        <button class="btn btn-small" type="button" data-action="quick-add-close">Отмена</button>
      </div>
    </form>`;
}

// -------------------------------------------------------------- admin

function viewAdmin() {
  if (!DB.hasSession()) {
    return `
      <div class="page-narrow">
        <div class="admin-gate">
          <div class="brand-seal">СК</div>
          <h1>Вход для Марины</h1>
          <p class="muted">Здесь можно добавлять родственников, фотографии и уточнять сведения — правки видят все посетители сайта. Это простая защита паролем для семьи, не банковский уровень безопасности.</p>
          <form data-form="admin-login" style="margin-top:22px;display:flex;flex-direction:column;gap:12px;align-items:center">
            <input class="input" type="password" name="password" placeholder="Пароль" style="max-width:260px" autofocus>
            <button class="btn btn-primary" type="submit">Войти</button>
          </form>
        </div>
      </div>`;
  }
  const tab = window.__adminTab || "people";
  const db = DB.get();
  return `
    <div class="page">
      <div class="page-head"><div><span class="eyebrow">Режим редактирования</span><h1>Админка</h1></div><button class="btn" data-action="admin-logout">Выйти</button></div>
      <div class="tab-row">
        <button class="tab-btn ${tab === "people" ? "active" : ""}" data-action="admin-tab" data-tab="people">Люди</button>
        <button class="tab-btn ${tab === "add" ? "active" : ""}" data-action="admin-tab" data-tab="add">+ Новый человек</button>
        <button class="tab-btn ${tab === "backup" ? "active" : ""}" data-action="admin-tab" data-tab="backup">Резервная копия</button>
      </div>
      ${tab === "people" ? adminPeopleTab(db) : ""}
      ${tab === "add" ? adminAddTab() : ""}
      ${tab === "backup" ? adminBackupTab() : ""}
    </div>
  `;
}

function adminPeopleTab(db) {
  const list = [...db.persons].sort((a, b) => fullName(a).localeCompare(fullName(b), "ru"));
  return `
    <div class="panel"><table class="admin-table">
      <thead><tr><th>Имя</th><th>Родство</th><th>Годы</th><th></th></tr></thead>
      <tbody>${list.map((p) => `
        <tr><td><a href="#/person/${p.id}">${esc(fullName(p))}</a></td><td class="muted">${esc(p._meta.relationToMarina)}</td><td class="muted">${esc(shortDates(p))}</td>
        <td><button class="btn btn-small btn-danger" data-action="admin-delete-person" data-id="${p.id}">Удалить</button></td></tr>`).join("")}</tbody>
    </table></div>
  `;
}

function adminAddTab() {
  return `
    <form data-form="new-person" class="panel">${personFormFields({})}<button class="btn btn-primary" type="submit">Создать человека</button></form>
    <p class="muted">После создания откройте карточку нового человека и кнопкой «+ Родственник» свяжите его с семьёй — иначе он останется без родства и не попадёт в дерево и схему.</p>
  `;
}

function adminBackupTab() {
  return `
    <div class="panel">
      <h3>Резервная копия</h3>
      <p class="muted">Данные хранятся на сервере и общие для всех посетителей. Резервная копия — на случай, если понадобится перенести архив или он будет пересобран (см. README о постоянном диске).</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
        <button class="btn btn-primary" data-action="export-backup">Скачать резервную копию</button>
        <button class="btn btn-danger" data-action="reset-overlay">Сбросить все правки к исходным данным</button>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------- render

function render() {
  if (!DB.isReady()) { app.innerHTML = loadingScreen(); return; }
  const { view, id } = currentRoute();
  let inner;
  if (view === "tree") inner = viewTree();
  else if (view === "scheme") inner = viewScheme();
  else if (view === "people") inner = viewPeople();
  else if (view === "person") inner = viewPerson(id);
  else if (view === "origins") inner = viewOrigins();
  else if (view === "geography") inner = viewGeography();
  else if (view === "admin") inner = viewAdmin();
  else inner = viewHome();
  app.innerHTML = layout(view, inner);
}

// -------------------------------------------------------------- events

app.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === "people-side") { window.__peopleSide = btn.dataset.side; render(); }
  if (action === "admin-tab") { window.__adminTab = btn.dataset.tab; render(); }
  if (action === "admin-logout") { DB.setPassword(null); render(); }
  if (action === "scheme-node-click") { location.hash = "#/person/" + btn.dataset.id; }

  if (action === "admin-delete-person") {
    if (confirm("Удалить эту запись из архива? Это увидят все посетители сайта.")) guarded(() => DB.deletePerson(btn.dataset.id));
  }
  if (action === "remove-relation") {
    if (confirm("Убрать эту связь? Это увидят все посетители сайта.")) guarded(() => DB.removeRelationBetween(btn.dataset.a, btn.dataset.b, btn.dataset.type));
  }

  if (action === "quick-add-open") document.getElementById("quick-add-slot").innerHTML = quickAddPanel();
  if (action === "quick-add-pick") {
    const personId = currentRoute().id;
    document.getElementById("quick-add-form-slot").innerHTML = quickAddForm(personId, btn.dataset.key);
  }
  if (action === "quick-add-close") document.getElementById("quick-add-slot").innerHTML = "";

  if (action === "edit-person") {
    const p = DB.getPerson(btn.dataset.id);
    document.getElementById("edit-person-slot").innerHTML = `
      <form data-form="edit-person" data-id="${p.id}" class="panel"><h4 class="eyebrow">Редактирование</h4>${personFormFields(p)}<button class="btn btn-primary" type="submit">Сохранить</button></form>`;
  }

  if (action === "export-backup") download("skryabin-family-backup.json", DB.exportJSON(), "application/json");
  if (action === "reset-overlay") {
    if (confirm("Все правки будут удалены для всех посетителей, останутся только исходные данные. Продолжить?")) guarded(() => DB.resetOverlay());
  }
});

app.addEventListener("change", (e) => {
  const el = e.target;
  if (el.matches("[data-action='scheme-root-select']")) { window.__schemeRoot = el.value; render(); }
  if (el.name && el.name.endsWith("_mode")) {
    const fs = el.closest("[data-datefield]");
    fs.querySelectorAll(".date-inputs").forEach((s) => { s.style.display = s.dataset.mode === el.value ? "inline-flex" : "none"; });
  }
  if (el.matches("[data-action='photo-input']")) {
    const file = el.files[0];
    if (!file) return;
    resizeImageFile(file, 480, (dataUrl) => {
      const form = el.closest("form");
      form.querySelector("input[name='photo']").value = dataUrl;
      form.querySelector(".photo-target").innerHTML = `<img class="photo-preview" src="${dataUrl}">`;
    });
  }
});

app.addEventListener("input", (e) => {
  if (e.target.matches("[data-action='people-search']")) {
    window.__peopleQ = e.target.value;
    render();
    const box = document.querySelector("[data-action='people-search']");
    if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  }
});

app.addEventListener("submit", (e) => {
  const form = e.target;
  if (!form.matches("[data-form]")) return;
  e.preventDefault();
  const kind = form.dataset.form;

  if (kind === "admin-login") {
    const pass = form.password.value;
    DB.checkPassword(pass).then((ok) => {
      if (ok) render();
      else toast("Неверный пароль.", true);
    }).catch(() => toast("Не удалось связаться с сервером.", true));
  }

  if (kind === "new-person") {
    guarded(async () => { const created = await DB.addPerson(readPersonForm(form)); location.hash = "#/person/" + created.id; });
  }

  if (kind === "edit-person") {
    guarded(async () => { await DB.updatePerson(form.dataset.id, readPersonForm(form)); document.getElementById("edit-person-slot").innerHTML = ""; toast("Сохранено."); });
  }

  if (kind === "quick-add") {
    const personId = form.dataset.person, key = form.dataset.key;
    const def = QUICK_ADD_DEFS.find((q) => q.key === key);
    guarded(async () => {
      let otherId;
      if (form.mode.value === "existing") {
        otherId = form.existingId.value;
        if (!otherId) { toast("Выберите человека из списка.", true); return; }
      } else {
        const raw = (form.newName.value || "").trim();
        if (!raw) { toast("Введите имя.", true); return; }
        const parts = raw.split(/\s+/);
        const created = await DB.addPerson({ lastName: parts.length > 1 ? parts[0] : "", firstName: parts.length > 1 ? parts[1] : parts[0], middleName: parts[2] || "", gender: def.gender || "unknown" });
        otherId = created.id;
      }
      if (def.type === "parent") await (def.dir === "up" ? DB.addRelationship(otherId, personId, "parent") : DB.addRelationship(personId, otherId, "parent"));
      else if (def.type === "spouse") await DB.addRelationship(personId, otherId, "spouse");
      else if (def.type === "sibling") await DB.addRelationship(personId, otherId, "sibling");
      document.getElementById("quick-add-slot").innerHTML = "";
      toast("Добавлено.");
    });
  }
});

// -------------------------------------------------------------------- boot

render();
DB.ready().then(render);
