import { guessSurnameOrigin, sideLabelForOrigin, stripGenderSuffix } from "./surname-rules.js";
import { DB } from "./db.js";
import { generationOffsetRelativeTo, relationPathToMarina } from "./relations.js";
import { computeGaps, GAP_LABELS, STATUS_LABELS, gapStatusColor } from "./gaps.js";

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
function deathYear(p) {
  const d = p?.death;
  if (!d || p.isLiving) return null;
  if (d.exact) { const m = String(d.exact).match(/\d{4}/); if (m) return Number(m[0]); }
  if (d.year) return Number(d.year);
  if (d.from) return Number(d.from);
  return null;
}
function branchClass(p) {
  if (p._meta?.side === "father") return "father";
  if (p._meta?.side === "mother") return "mother";
  if (p._meta?.side === "husband") return "husband";
  return "plain";
}
function personPhotos(p) {
  if (Array.isArray(p.photos) && p.photos.length) return p.photos;
  return p.photo ? [p.photo] : [];
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
const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// -------------------------------------------------------------- router

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [view, id] = hash.split("/");
  return { view: view || "home", id };
}

// Пока идёт ввод в любую форму (например, Марина заполняет карточку
// нового человека), фоновая проверка обновлений НЕ должна перерисовывать
// страницу — иначе введённый текст физически стирается вместе со всей
// формой. formDirty взводится при первом же вводе и сбрасывается при
// любой намеренной перерисовке (переход по ссылке, клик по вкладке,
// собственное сохранение) — то есть блокирует только фоновый, незаметный
// для пользователя триггер.
let formDirty = false;
document.addEventListener("input", (e) => {
  if (e.target.closest && e.target.closest("[data-form]")) formDirty = true;
});

window.addEventListener("hashchange", render);
DB.onChange(() => { if (!formDirty) render(); });

const NAV = [["home", "Главная"], ["tree", "Дерево"], ["scheme", "Схема"], ["investigation", "Расследование"], ["timeline", "Хронология"], ["dates", "Даты"], ["people", "Люди"], ["origins", "Фамилии"], ["geography", "География"], ["admin", "Админка"]];

function renderShell() {
  app.innerHTML = `
    <header class="topbar">
      <a href="#/home" class="brand"><span class="brand-seal">СК</span> Скрябины</a>
      <nav class="topnav">${NAV.map(([k, l]) => `<a href="#/${k}" data-nav="${k}">${l}</a>`).join("")}</nav>
    </header>
    <main id="route-outlet"></main>
    <p class="footer-note">Семейный архив Скрябиных — общие данные для всех, кто заходит на сайт. Не является официальным генеалогическим документом.</p>
  `;
}
function updateNavActive(view) {
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === view));
}

function loadingScreen() {
  return `<div class="loading-screen"><div class="loading-dot"></div><p class="muted">Загружаем семейный архив…</p></div>`;
}

let lastView = null;
function setOutlet(html, view, afterInsert) {
  const outlet = document.getElementById("route-outlet");
  const viewChanged = view !== lastView;
  lastView = view;
  if (!viewChanged || prefersReducedMotion) {
    outlet.innerHTML = html;
    if (afterInsert) afterInsert();
    return;
  }
  outlet.classList.add("route-fade-out");
  setTimeout(() => {
    outlet.innerHTML = html;
    outlet.classList.remove("route-fade-out");
    outlet.classList.add("route-fade-in");
    if (afterInsert) afterInsert();
    setTimeout(() => outlet.classList.remove("route-fade-in"), 260);
  }, 110);
}

// -------------------------------------------------------------- starfield

function initStarfield() {
  const canvas = document.getElementById("starfield");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let w, h, stars;
  let mouseX = 0.5, mouseY = 0.5;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    const count = Math.min(160, Math.floor((w * h) / 9000));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: Math.random() * 1.4 + 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.8,
      depth: Math.random() * 0.6 + 0.2,
    }));
  }
  window.addEventListener("resize", resize);
  window.addEventListener("mousemove", (e) => { mouseX = e.clientX / window.innerWidth; mouseY = e.clientY / window.innerHeight; });
  resize();

  if (prefersReducedMotion) {
    ctx.clearRect(0, 0, w, h);
    stars.forEach((s) => { ctx.beginPath(); ctx.fillStyle = "rgba(245,244,251,0.5)"; ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); });
    return;
  }

  let t = 0;
  function frame() {
    t += 0.016;
    ctx.clearRect(0, 0, w, h);
    const px = (mouseX - 0.5) * 18, py = (mouseY - 0.5) * 18;
    stars.forEach((s) => {
      const twinkle = 0.45 + 0.55 * Math.sin(t * s.speed + s.phase);
      ctx.beginPath();
      ctx.fillStyle = `rgba(245, 244, 251, ${(0.15 + 0.55 * twinkle).toFixed(2)})`;
      ctx.arc(s.x + px * s.depth, s.y + py * s.depth, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// -------------------------------------------------------------- count-up

function animateCountUp(root) {
  const els = root.querySelectorAll("[data-count]");
  if (!els.length) return;
  els.forEach((el) => {
    const target = Number(el.dataset.count) || 0;
    if (prefersReducedMotion) { el.textContent = target; return; }
    const start = performance.now();
    const dur = 900;
    function step(now) {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(eased * target);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
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
            <a class="btn" href="#/timeline">Хронология семьи</a>
          </div>
          <div class="hero-stats">
            <div class="hero-stat"><strong data-count="${stats.persons}">0</strong><span>человек в архиве</span></div>
            <div class="hero-stat"><strong data-count="${stats.generations}">0</strong><span>поколений</span></div>
            <div class="hero-stat"><strong data-count="${stats.photos}">0</strong><span>фотографий добавлено</span></div>
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
  const slotId = `surname-ai-${stripGenderSuffix(o.surname).toLowerCase().replace(/[^a-zа-я]/gi, "")}`;
  return `
    <div class="origin-card ${cls}">
      <div class="side-tag">${esc(o.side)}</div>
      <div class="surname">${esc(o.surname)}</div>
      <p>${esc(o.origin)}</p>
      ${o.note ? `<p class="muted" style="font-size:0.85rem">${esc(o.note)}</p>` : ""}
      ${o.auto ? `<span class="uncertain-tag auto-tag">⚙ автоматически по общим правилам, не проверено</span>` : o.uncertain ? `<span class="uncertain-tag">версия не окончательная</span>` : ""}
      ${DB.hasSession() ? `<div style="margin-top:10px"><button class="btn btn-small" data-action="ai-surname" data-surname="${esc(o.surname)}" data-slot="${slotId}">🤖 Уточнить через ИИ</button></div>` : ""}
      <div id="${slotId}"></div>
    </div>
  `;
}

// собираем фамилии, которых нет в кураторском списке (window.SURNAME_ORIGINS),
// и достраиваем для них черновик по типовым правилам ономастики — честно
// помеченный как автоматический, не факт (см. js/surname-rules.js)
function collectSurnameCards() {
  const curated = window.SURNAME_ORIGINS;
  const curatedKeys = new Set(curated.map((o) => stripGenderSuffix(o.surname).toLowerCase()));
  const db = DB.get();
  const groups = new Map(); // normalizedKey -> { lastName, sides:Set }
  db.persons.forEach((p) => {
    if (!p.lastName) return;
    const key = stripGenderSuffix(p.lastName).toLowerCase();
    if (curatedKeys.has(key)) return;
    if (!groups.has(key)) groups.set(key, { lastName: p.lastName, sides: new Set() });
    if (p._meta?.side) groups.get(key).sides.add(p._meta.side);
  });
  const autoCards = [];
  groups.forEach(({ lastName, sides }) => {
    const guess = guessSurnameOrigin(lastName);
    if (!guess) return;
    const side = sides.has("father") ? "father" : sides.has("mother") ? "mother" : sides.has("husband") ? "husband" : null;
    autoCards.push({ surname: lastName, side: sideLabelForOrigin(side), origin: guess.origin, auto: true });
  });
  autoCards.sort((a, b) => a.surname.localeCompare(b.surname, "ru"));
  return autoCards;
}

function viewOrigins() {
  const autoCards = collectSurnameCards();
  return `
    <div class="page-narrow">
      <div class="page-head"><div><span class="eyebrow">Ономастика рода</span><h1>Откуда взялись фамилии</h1>
      <p class="lede">Общепринятые версии происхождения фамилий, встречающихся в дереве — не архивные факты именно о вашей семье, а сведения об именослове вообще. Где версия не окончательная, это указано.</p></div></div>
      <div class="origin-grid">${window.SURNAME_ORIGINS.map(originCard).join("")}</div>
      ${autoCards.length ? `
      <div class="block-head" style="margin-top:40px">
        <span class="eyebrow">Новые фамилии в дереве</span>
        <h2>Пока без проверенной статьи</h2>
        <p class="lede">Эти фамилии появились в архиве, но для них ещё нет отдельно изученной версии — ниже черновик по общим правилам русской ономастики, не факт. Уточните вручную, если знаете точнее.</p>
      </div>
      <div class="origin-grid">${autoCards.map(originCard).join("")}</div>` : ""}
    </div>
  `;
}

// -------------------------------------------------------------- investigation (kanban)

const KANBAN_COLUMNS = [
  ["to_check", "Нужно проверить"],
  ["searching", "Ищу"],
  ["candidate", "Потенциальные родственники"],
  ["confirmed", "Подтверждено"],
  ["rejected", "Отклонено"],
];

const MATCH_LABELS = { strong: "сильное совпадение", possible: "возможное совпадение", weak: "слабое совпадение" };
const MATCH_CLASS = { strong: "match-strong", possible: "match-possible", weak: "match-weak" };

function candidateCard(c) {
  const anchor = c.personId ? DB.getPerson(c.personId) : null;
  return `
    <div class="cand-card">
      <div class="cand-card-name">${esc(c.name)}</div>
      <div class="muted-small">${esc(c.birthYear || "?")}${c.deathYear ? "–" + esc(c.deathYear) : ""} ${c.place ? "· " + esc(c.place) : ""}</div>
      ${anchor ? `<div class="muted-small">к: <a href="#/person/${anchor.id}">${esc(fullName(anchor))}</a> ${c.assumedRelation ? "(" + esc(c.assumedRelation) + ")" : ""}</div>` : ""}
      ${c.foundInfo ? `<p class="muted-small">${esc(c.foundInfo)}</p>` : ""}
      ${c.matchStrength ? `<span class="match-badge ${MATCH_CLASS[c.matchStrength]}">${esc(MATCH_LABELS[c.matchStrength])}</span>` : ""}
      ${c.matchingFacts && c.matchingFacts.length ? `<ul class="reasons">${c.matchingFacts.map((f) => `<li class="reason-pos">+ ${esc(f)}</li>`).join("")}</ul>` : ""}
      ${c.contradictions && c.contradictions.length ? `<ul class="reasons">${c.contradictions.map((f) => `<li class="reason-neg">− ${esc(f)}</li>`).join("")}</ul>` : ""}
      ${c.aiExplanation ? `<p class="muted-small">${esc(c.aiExplanation)}</p>` : ""}
      ${c.sourceUrl ? `<a class="muted-small" href="${esc(c.sourceUrl)}" target="_blank" rel="noopener">источник →</a>` : ""}
      ${DB.hasSession() ? `
        <div class="cand-actions">
          ${c.status !== "confirmed" && c.status !== "rejected" ? `<button class="btn btn-small" data-action="cand-ai-compare" data-id="${c.id}">🤖 Сравнить</button>` : ""}
          ${c.status === "confirmed" || c.status === "rejected" ? "" : `<button class="btn btn-small btn-primary" data-action="cand-confirm" data-id="${c.id}">Добавить в дерево</button>
          <button class="btn btn-small btn-danger" data-action="cand-reject" data-id="${c.id}">Отклонить</button>
          <button class="btn btn-small" data-action="cand-continue" data-id="${c.id}">Продолжить поиск</button>`}
        </div>` : ""}
    </div>
  `;
}

function viewInvestigation() {
  const all = DB.candidates();
  return `
    <div class="page">
      <div class="page-head"><div><span class="eyebrow">Расследование</span><h1>Потенциальные родственники</h1>
      <p class="lede">Кандидаты появляются здесь, когда вы сохраняете найденного человека через кнопку «🤖 Искать» на точке расследования. Отклонённые не удаляются — чтобы не предлагать их снова.</p></div></div>
      <div class="kanban">
        ${KANBAN_COLUMNS.map(([key, title]) => {
          const items = all.filter((c) => c.status === key);
          return `<div class="kanban-col"><h3>${title} <span class="muted-small">(${items.length})</span></h3>
            <div class="kanban-items">${items.length === 0 ? `<p class="muted-small">пусто</p>` : items.map(candidateCard).join("")}</div>
          </div>`;
        }).join("")}
      </div>
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
        <div style="display:flex;gap:8px">
          <button class="btn" data-action="print-page">Печать</button>
          ${gapToggleButton()}
          ${DB.hasSession() ? `<a class="btn btn-primary" href="#/admin">+ Добавить человека</a>` : ""}
        </div>
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
  const photos = personPhotos(p);
  const photo = photos.length ? `<img class="person-photo" src="${photos[0]}" alt="">` : `<div class="person-photo-placeholder avatar-${branch}">${esc((p.firstName || "?")[0])}</div>`;
  const gaps = window.__showGaps ? computeGaps(p, DB) : [];
  return `
    <a class="person-card branch-${branch}" href="#/person/${p.id}">
      ${p.isLiving ? `<span class="living-dot" title="жив(а)"></span>` : ""}
      ${gaps.length ? `<span class="gap-marker" title="${gaps.length} ${gaps.length === 1 ? "точка расследования" : "точки расследования"}">?</span>` : ""}
      ${photo}
      <div class="person-name">${esc(fullName(p))}</div>
      <div class="person-dates">${esc(shortDates(p))}</div>
      <div class="person-relation">${esc(p._meta.relationToMarina)}</div>
    </a>
  `;
}

function gapToggleButton() {
  const on = !!window.__showGaps;
  return `<button class="btn ${on ? "btn-primary" : ""}" data-action="toggle-gaps">🔎 ${on ? "Скрыть" : "Показать"} точки расследования</button>`;
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
        <div style="display:flex;gap:8px">
          ${gapToggleButton()}
          ${DB.hasSession() ? `<a class="btn btn-primary" href="#/admin">+ Добавить человека</a>` : ""}
        </div>
      </div>
      <input class="search-box" type="search" placeholder="Найти по имени…" value="${esc(window.__peopleQ || "")}" data-action="people-search">
      <div class="filter-row">${sides.map(([k, l]) => `<button class="chip ${sideFilter === k ? "active" : ""}" data-action="people-side" data-side="${k}">${l}</button>`).join("")}</div>
      ${list.length === 0 ? emptyState("Никого не найдено", "Попробуйте другой запрос или фильтр.") : `<div class="directory-grid">${list.map(personCard).join("")}</div>`}
    </div>
  `;
}

// -------------------------------------------------------------- person detail

function investigationSection(p) {
  const gaps = computeGaps(p, DB);
  return `
    <div class="panel" id="investigation-panel">
      <h4 class="eyebrow">🔎 Точки расследования</h4>
      ${gaps.length === 0 ? `<p class="muted-small">Явных пробелов не обнаружено.</p>` : `<div class="gap-list">${gaps.map((g) => gapCard(p, g)).join("")}</div>`}
    </div>
  `;
}

function closeLabel(type) {
  return { children: "детей не было", spouse: "брака не было", siblings: "братьев/сестёр не было",
    father: "отец неизвестен окончательно", mother: "мать неизвестна окончательно", parents: "родители неизвестны окончательно",
    maidenName: "не применимо", dates: "не применимо", places: "не применимо" }[type] || "закрыть точку";
}

function gapCard(p, g) {
  return `
    <div class="gap-card">
      <div class="gap-card-head">
        <span class="gap-dot ${gapStatusColor(g.status)}"></span>
        <strong>${esc(g.label)}</strong>
        <span class="gap-status-label">${esc(STATUS_LABELS[g.status])}</span>
      </div>
      ${DB.hasSession() ? `
        <div class="gap-actions">
          <button class="btn btn-small" data-action="quick-add-open" data-id="${p.id}">Добавить родственника</button>
          <button class="btn btn-small" data-action="gap-search" data-id="${p.id}" data-gap="${g.type}">🤖 Искать</button>
          <button class="btn btn-small" data-action="gap-status" data-id="${p.id}" data-gap="${g.type}" data-status="researching">Отметить как исследуемое</button>
          <button class="btn btn-small btn-danger" data-action="gap-status" data-id="${p.id}" data-gap="${g.type}" data-status="closed_manually">Закрыть: ${esc(closeLabel(g.type))}</button>
        </div>
        <div id="gap-slot-${p.id}-${g.type}"></div>
        ${notesSection("investigation", `${p.id}:${g.type}`, true)}
      ` : ""}
    </div>
  `;
}

const NOTE_TYPE_LABELS = { memory: "семейное воспоминание", told_by_relative: "со слов родственника", hypothesis: "гипотеза", to_verify: "нужно проверить", general: "обычная заметка" };

function notesSection(targetType, targetId, compact) {
  const notes = DB.notesFor(targetType, targetId);
  return `
    <div class="${compact ? "notes-mini" : "panel"}">
      ${compact ? "" : `<h4 class="eyebrow">Заметки</h4>`}
      ${notes.length === 0 ? (compact ? "" : `<p class="muted-small">пока нет заметок</p>`) : `<ul class="note-list">${notes.map((n) => `
        <li class="note-item">
          <span class="note-type-badge">${esc(NOTE_TYPE_LABELS[n.noteType] || n.noteType)}</span>
          <p>${esc(n.text)}</p>
          <span class="muted" style="font-size:0.72rem">${new Date(n.createdAt).toLocaleDateString("ru-RU")}</span>
          ${DB.hasSession() ? `<button class="btn btn-small btn-danger" data-action="delete-note" data-id="${n.id}">✕</button>` : ""}
        </li>`).join("")}</ul>`}
      ${DB.hasSession() ? `<button class="btn btn-small" data-action="open-note-form" data-target-type="${targetType}" data-target-id="${targetId}">+ Добавить заметку</button>
      <div id="note-form-slot-${targetType}-${targetId}"></div>` : ""}
    </div>
  `;
}

function noteForm(targetType, targetId) {
  return `
    <form data-form="add-note" data-target-type="${targetType}" data-target-id="${targetId}" style="margin-top:10px">
      <select class="input" name="noteType" style="margin-bottom:8px">
        <option value="memory">семейное воспоминание</option>
        <option value="told_by_relative">со слов родственника</option>
        <option value="hypothesis">гипотеза</option>
        <option value="to_verify">нужно проверить</option>
        <option value="general" selected>обычная заметка</option>
      </select>
      <textarea class="input" name="text" rows="2" placeholder="Например: бабушка говорила, что у него был брат, который жил в Ленинграде" required></textarea>
      <div style="margin-top:8px;display:flex;gap:8px">
        <button class="btn btn-small btn-primary" type="submit">Сохранить</button>
        <button class="btn btn-small" type="button" data-action="close-note-form" data-target-type="${targetType}" data-target-id="${targetId}">Отмена</button>
      </div>
    </form>
  `;
}

function aiErrorBox(err) {
  if (err.code === "ai_not_configured") return `<p class="muted-small" style="color:var(--gold)">ИИ пока не настроен на сервере — нужно задать переменную окружения <code>DEEPSEEK_API_KEY</code>.</p>`;
  return `<p class="muted-small" style="color:var(--coral)">Не удалось получить ответ ИИ: ${esc(err.message)}</p>`;
}

function searchStrategiesBlock(personId, gapType, result) {
  return `
    <div class="ai-result">
      <p class="muted-small">${esc(result.strategyNotes || "")}</p>
      <ul class="query-list">${(result.queries || []).map((q) => `<li><code>${esc(q)}</code></li>`).join("")}</ul>
      <button class="btn btn-small btn-primary" data-action="open-candidate-form" data-id="${personId}" data-gap="${gapType}">Сохранить найденного кандидата</button>
      <div id="candidate-form-slot-${personId}-${gapType}"></div>
    </div>
  `;
}

function candidateForm(personId, gapType) {
  return `
    <form data-form="add-candidate" data-person="${personId}" data-gap="${gapType}" class="form-grid" style="margin-top:10px">
      <label>ФИО кандидата <input class="input" name="name" required></label>
      <label>Год рождения <input class="input input-narrow" name="birthYear" type="number"></label>
      <label>Год смерти <input class="input input-narrow" name="deathYear" type="number"></label>
      <label>Место <input class="input" name="place"></label>
      <label>Предполагаемая связь <input class="input" name="assumedRelation" placeholder="напр. брат отца"></label>
      <label class="block">Что удалось найти <textarea class="input" name="foundInfo" rows="2"></textarea></label>
      <label>Ссылка на источник <input class="input" name="sourceUrl" type="url"></label>
      <button class="btn btn-small btn-primary" type="submit">Добавить в «Расследование»</button>
    </form>
  `;
}
function relationChain(id) {
  const db = DB.get();
  const chain = relationPathToMarina(id, db.persons, db.relationships, db.marinaId);
  if (!chain || chain.length < 2) return "";
  const parts = chain.map((pid, i) => {
    const person = DB.getPerson(pid);
    const isLast = i === chain.length - 1;
    const label = pid === db.marinaId ? "Марина" : fullName(person);
    return isLast ? `<span class="current">${esc(label)}</span>` : `<a href="#/person/${pid}">${esc(label)}</a>`;
  });
  return `<nav class="relation-path" aria-label="Цепочка родства">${parts.join('<span class="sep">→</span>')}</nav>`;
}

function viewPerson(id) {
  const p = DB.getPerson(id);
  if (!p) return `<div class="page">${emptyState("Человек не найден", "Возможно, запись была удалена.")}</div>`;
  const parents = DB.parentsOf(id), spouses = DB.spousesOf(id), children = DB.childrenOf(id), siblings = DB.siblingsOf(id);
  const branch = branchClass(p);
  const photos = personPhotos(p);

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
      ${relationChain(id)}
      <div class="person-hero">
        ${photos.length ? `<img class="person-hero-photo" src="${photos[0]}" alt="" data-action="open-lightbox" data-photos='${esc(JSON.stringify(photos))}' data-index="0" style="cursor:zoom-in">` : `<div class="person-hero-photo-placeholder avatar-${branch}">${esc((p.firstName || "?")[0])}</div>`}
        <div>
          <span class="relation-badge">${esc(p._meta.relationToMarina)}</span>
          <h1>${esc(fullName(p))}</h1>
          <p class="muted">${esc(shortDates(p))} ${p.birthPlace ? "· " + esc(p.birthPlace) : ""}</p>
          ${DB.hasSession() ? `<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap"><button class="btn btn-small" data-action="edit-person" data-id="${p.id}">Редактировать</button><button class="btn btn-small" data-action="quick-add-open" data-id="${p.id}">+ Родственник</button><button class="btn btn-small" data-action="ai-dossier" data-id="${p.id}">🤖 Создать досье</button></div>` : ""}
        </div>
      </div>

      <div id="dossier-slot"></div>

      ${photos.length > 1 ? `<div class="person-gallery">${photos.map((src, i) => `<img src="${src}" data-action="open-lightbox" data-photos='${esc(JSON.stringify(photos))}' data-index="${i}" alt="">`).join("")}</div>` : ""}

      <div class="info-grid">
        ${p.occupation ? infoItem("Род занятий", p.occupation) : ""}
        ${p.deathPlace && !p.isLiving ? infoItem("Место смерти", p.deathPlace) : ""}
        ${p.maidenName ? infoItem("Девичья фамилия", p.maidenName) : ""}
        ${(p.nameVariants || []).length ? infoItem("Варианты имени", p.nameVariants.join(", ")) : ""}
      </div>

      ${p.bio ? `<div class="panel"><h4 class="eyebrow">Чем известен(на) / жизненный путь</h4><p>${esc(p.bio)}</p></div>` : ""}
      ${p.notes ? `<div class="panel"><h4 class="eyebrow">Заметки (старое поле)</h4><p>${esc(p.notes)}</p></div>` : ""}

      ${investigationSection(p)}
      ${notesSection("person", p.id)}

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

// -------------------------------------------------------------- lightbox

function openLightbox(photos, index) {
  window.__lightbox = { photos, index };
  renderLightbox();
}
function closeLightbox() {
  window.__lightbox = null;
  const el = document.getElementById("lightbox");
  el.hidden = true;
  el.innerHTML = "";
}
function renderLightbox() {
  const state = window.__lightbox;
  const el = document.getElementById("lightbox");
  if (!state) { el.hidden = true; return; }
  el.hidden = false;
  const { photos, index } = state;
  el.innerHTML = `
    <button class="lightbox-close" data-action="lightbox-close" aria-label="Закрыть">✕</button>
    ${photos.length > 1 ? `<button class="lightbox-nav lightbox-prev" data-action="lightbox-prev" aria-label="Предыдущее фото">‹</button>` : ""}
    <img class="lightbox-img" src="${photos[index]}" alt="">
    ${photos.length > 1 ? `<button class="lightbox-nav lightbox-next" data-action="lightbox-next" aria-label="Следующее фото">›</button>` : ""}
    ${photos.length > 1 ? `<div class="lightbox-counter">${index + 1} / ${photos.length}</div>` : ""}
  `;
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (btn && btn.dataset.action === "open-lightbox") {
    openLightbox(JSON.parse(btn.dataset.photos), Number(btn.dataset.index));
    return;
  }
  const lb = document.getElementById("lightbox");
  if (!lb || lb.hidden) return;
  if (e.target === lb) { closeLightbox(); return; }
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action === "lightbox-close") closeLightbox();
  if (action === "lightbox-prev") { window.__lightbox.index = (window.__lightbox.index - 1 + window.__lightbox.photos.length) % window.__lightbox.photos.length; renderLightbox(); }
  if (action === "lightbox-next") { window.__lightbox.index = (window.__lightbox.index + 1) % window.__lightbox.photos.length; renderLightbox(); }
});
document.addEventListener("keydown", (e) => {
  if (!window.__lightbox) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") { window.__lightbox.index = (window.__lightbox.index - 1 + window.__lightbox.photos.length) % window.__lightbox.photos.length; renderLightbox(); }
  if (e.key === "ArrowRight") { window.__lightbox.index = (window.__lightbox.index + 1) % window.__lightbox.photos.length; renderLightbox(); }
});

// -------------------------------------------------------------- scheme (radial diagram, zoom/pan/minimap)

function buildSchemeGeometry(root, db) {
  const offsets = generationOffsetRelativeTo(root.id, db.persons, db.relationships);
  const ringGap = 72;
  const nodesByRing = new Map();
  let maxRing = 0;
  db.persons.forEach((p) => {
    if (!offsets.has(p.id)) return;
    const { offset, ring } = offsets.get(p.id);
    maxRing = Math.max(maxRing, ring);
    if (!nodesByRing.has(ring)) nodesByRing.set(ring, []);
    nodesByRing.get(ring).push({ p, offset });
  });
  const w = Math.max(900, (maxRing + 1) * ringGap * 2 + 200);
  const h = w;
  const cx = w / 2, cy = h / 2;
  const positions = new Map();
  positions.set(root.id, { x: cx, y: cy });
  nodesByRing.forEach((list, ring) => {
    if (ring === 0) return;
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
    place(ancestors, 195, 345);
    place(descendants, 15, 165);
    if (sameGen.length) {
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
  return { positions, w, h, cx, cy, maxRing, ringGap, offsets };
}

function viewScheme() {
  const db = DB.get();
  if (db.persons.length === 0) return `<div class="page">${emptyState("Пока пусто", "Добавьте людей через админку.")}</div>`;
  const rootId = window.__schemeRoot || db.marinaId;
  const root = DB.getPerson(rootId) || db.persons[0];
  const geo = buildSchemeGeometry(root, db);
  const { positions, w, h, cx, cy, maxRing, ringGap, offsets } = geo;

  let svg = `<svg class="scheme-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
  for (let r = 1; r <= maxRing; r++) {
    svg += `<circle cx="${cx}" cy="${cy}" r="${r * ringGap}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1" />`;
    svg += `<text class="scheme-ring-label" x="${cx + r * ringGap + 6}" y="${cy - 4}">${r} шаг${r === 1 ? "" : r < 5 ? "а" : "ов"} родства</text>`;
  }
  db.relationships.forEach((r) => {
    const a = positions.get(r.a), b = positions.get(r.b);
    if (!a || !b) return;
    if (r.type === "parent") svg += `<line class="scheme-edge-blood" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`;
    if (r.type === "spouse") svg += `<line class="scheme-edge-spouse" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`;
  });
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

  return `
    <div class="page">
      <div class="page-head"><div><span class="eyebrow">Наглядная схема</span><h1>Схема родства</h1>
      <p class="lede">Расстояние до центра — степень родства. Предки — сверху, потомки — снизу, ровесники (братья, кузены) — по бокам. Колесо мыши или щипок — масштаб, перетаскивание — перемещение.</p></div></div>

      <div class="scheme-toolbar">
        <label style="display:flex;align-items:center;gap:8px;font-size:0.88rem;color:var(--ink-soft)">Центр схемы:
          <select class="input" data-action="scheme-root-select" style="width:auto">
            ${db.persons.filter((p) => offsets.has(p.id) || p.id === root.id).sort((a, b) => fullName(a).localeCompare(fullName(b), "ru")).map((p) => `<option value="${p.id}" ${p.id === root.id ? "selected" : ""}>${esc(fullName(p))}</option>`).join("")}
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
      <div class="scheme-canvas-wrap" id="scheme-wrap">
        <div class="scheme-transform-layer" id="scheme-layer">${svg}</div>
        <svg class="scheme-minimap" id="scheme-minimap" viewBox="0 0 ${w} ${h}"></svg>
        <div class="scheme-zoom-controls">
          <button data-action="scheme-zoom-in" aria-label="Приблизить">+</button>
          <button data-action="scheme-zoom-out" aria-label="Отдалить">−</button>
          <button data-action="scheme-zoom-reset" aria-label="Сбросить масштаб">⤢</button>
        </div>
      </div>
    </div>
  `;
}

function initSchemeInteraction() {
  const wrap = document.getElementById("scheme-wrap");
  const layer = document.getElementById("scheme-layer");
  const minimap = document.getElementById("scheme-minimap");
  if (!wrap || !layer) return;
  const svgEl = layer.querySelector("svg");
  const contentW = Number(svgEl.getAttribute("width"));
  const contentH = Number(svgEl.getAttribute("height"));

  let scale = 1, tx = 0, ty = 0;

  function fitToView() {
    const rect = wrap.getBoundingClientRect();
    scale = Math.min(rect.width / contentW, rect.height / contentH) * 0.92;
    tx = (rect.width - contentW * scale) / 2;
    ty = (rect.height - contentH * scale) / 2;
    apply();
  }

  function apply() {
    layer.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    updateMinimap();
  }

  function updateMinimap() {
    if (!minimap) return;
    const rect = wrap.getBoundingClientRect();
    const vx = -tx / scale, vy = -ty / scale, vw = rect.width / scale, vh = rect.height / scale;
    let dots = "";
    svgEl.querySelectorAll("circle.node-visible").forEach((c) => {
      dots += `<circle cx="${c.getAttribute("cx")}" cy="${c.getAttribute("cy")}" r="5" />`;
    });
    minimap.innerHTML = `${dots}<rect class="viewport-rect" x="${vx}" y="${vy}" width="${vw}" height="${vh}" />`;
  }

  wrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const prevScale = scale;
    scale = Math.min(4, Math.max(0.25, scale * (e.deltaY < 0 ? 1.1 : 0.9)));
    tx = mx - ((mx - tx) / prevScale) * scale;
    ty = my - ((my - ty) / prevScale) * scale;
    apply();
  }, { passive: false });

  let dragging = false, lastX = 0, lastY = 0;
  wrap.addEventListener("pointerdown", (e) => {
    if (e.target.closest("[data-action='scheme-node-click']") || e.target.closest(".scheme-zoom-controls") || e.target.closest(".scheme-minimap")) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    wrap.classList.add("grabbing");
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    tx += e.clientX - lastX; ty += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    apply();
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => wrap.addEventListener(ev, () => { dragging = false; wrap.classList.remove("grabbing"); }));

  const touches = new Map();
  wrap.addEventListener("touchstart", (e) => { for (const t of e.changedTouches) touches.set(t.identifier, t); }, { passive: true });
  wrap.addEventListener("touchmove", (e) => {
    if (e.touches.length < 2) return;
    e.preventDefault();
    const [t1, t2] = e.touches;
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    if (wrap.__pinchDist) {
      const factor = dist / wrap.__pinchDist;
      scale = Math.min(4, Math.max(0.25, scale * factor));
      apply();
    }
    wrap.__pinchDist = dist;
  }, { passive: false });
  wrap.addEventListener("touchend", () => { wrap.__pinchDist = null; });

  document.querySelectorAll("[data-action='scheme-zoom-in']").forEach((b) => b.addEventListener("click", () => { scale = Math.min(4, scale * 1.25); apply(); }));
  document.querySelectorAll("[data-action='scheme-zoom-out']").forEach((b) => b.addEventListener("click", () => { scale = Math.max(0.25, scale * 0.8); apply(); }));
  document.querySelectorAll("[data-action='scheme-zoom-reset']").forEach((b) => b.addEventListener("click", fitToView));

  fitToView();
  window.addEventListener("resize", fitToView, { once: false });
}

// -------------------------------------------------------------- timeline

function viewTimeline() {
  const db = DB.get();
  const events = [];
  db.persons.forEach((p) => {
    const by = birthYear(p);
    if (by) events.push({ year: by, type: "birth", p });
    const dy = deathYear(p);
    if (dy) events.push({ year: dy, type: "death", p });
  });
  if (events.length === 0) return `<div class="page">${emptyState("Пока нет дат", "Добавьте людям даты рождения через админку.")}</div>`;
  events.sort((a, b) => a.year - b.year);
  const minYear = Math.floor(events[0].year / 10) * 10;
  const maxYear = Math.ceil(events[events.length - 1].year / 10) * 10;
  const pxPerYear = 26;
  const trackWidth = (maxYear - minYear) * pxPerYear + 160;

  const decades = [];
  for (let y = minYear; y <= maxYear; y += 10) decades.push(y);

  const xFor = (year) => 80 + (year - minYear) * pxPerYear;

  let html = `<div class="timeline-track" style="width:${trackWidth}px">`;
  html += `<div class="timeline-line"></div>`;
  decades.forEach((y) => {
    html += `<div class="timeline-tick" style="left:${xFor(y)}px"></div><div class="timeline-decade" style="left:${xFor(y)}px">${y}</div>`;
  });
  events.forEach((ev, i) => {
    const branch = branchClass(ev.p);
    const color = branch === "father" ? "var(--violet)" : branch === "mother" ? "var(--teal)" : branch === "husband" ? "var(--coral)" : "var(--gold)";
    const side = i % 2 === 0 ? "above" : "below";
    const verb = ev.type === "birth" ? "родил" + (ev.p.gender === "female" ? "ась" : "ся") : "умер" + (ev.p.gender === "female" ? "ла" : "");
    html += `<div class="timeline-event ${side}" style="left:${xFor(ev.year)}px" data-action="scheme-node-click" data-id="${ev.p.id}">
      ${side === "below" ? `<div class="dot" style="background:${color};color:${color}"></div>` : ""}
      <div class="tcard"><strong>${esc(ev.year)}</strong>${esc(fullName(ev.p))}<br>${verb}</div>
      ${side === "above" ? `<div class="dot" style="background:${color};color:${color}"></div>` : ""}
    </div>`;
  });
  html += `</div>`;

  return `
    <div class="page">
      <div class="page-head"><div><span class="eyebrow">Хронология</span><h1>Семья во времени</h1>
      <p class="lede">Все известные даты рождения и смерти на одной шкале — от ${minYear} до наших дней. Листайте по горизонтали.</p></div></div>
      <div class="timeline-legend">
        <span><span class="legend-dot" style="background:var(--violet)"></span>линия отца</span>
        <span><span class="legend-dot" style="background:var(--teal)"></span>линия матери</span>
        <span><span class="legend-dot" style="background:var(--coral)"></span>родня мужа</span>
        <span><span class="legend-dot" style="background:var(--gold)"></span>родство не установлено</span>
      </div>
      <div class="timeline-wrap">${html}</div>
    </div>
  `;
}

// -------------------------------------------------------------- dates (birthdays + memorial calendar)

const RU_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const RU_MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function ruPlural(n, forms) {
  const abs = Math.abs(n) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}

function buildDateSchedule(persons, field) {
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const items = [];
  persons.forEach((p) => {
    const d = p[field];
    if (!d || d.mode !== "exact" || !d.exact) return;
    const parsed = new Date(d.exact + "T00:00:00");
    if (isNaN(parsed.getTime())) return;
    const month = parsed.getMonth(), day = parsed.getDate(), origYear = parsed.getFullYear();
    let candidate = new Date(todayMidnight.getFullYear(), month, day);
    if (candidate < todayMidnight) candidate = new Date(todayMidnight.getFullYear() + 1, month, day);
    const daysUntil = Math.round((candidate - todayMidnight) / 86400000);
    const years = candidate.getFullYear() - origYear;
    items.push({ p, month, day, daysUntil, years });
  });
  items.sort((a, b) => a.daysUntil - b.daysUntil);
  return items;
}

function dateBadge(daysUntil) {
  if (daysUntil === 0) return `<span class="date-badge today">сегодня</span>`;
  if (daysUntil === 1) return `<span class="date-badge soon">завтра</span>`;
  if (daysUntil <= 7) return `<span class="date-badge soon">через ${daysUntil} ${ruPlural(daysUntil, ["день", "дня", "дней"])}</span>`;
  return `<span class="date-badge">через ${daysUntil} ${ruPlural(daysUntil, ["день", "дня", "дней"])}</span>`;
}

function dateRow(item, kind) {
  const { p, month, day, years } = item;
  const branch = branchClass(p);
  const photos = personPhotos(p);
  const avatar = photos.length ? `<img class="calendar-avatar" src="${photos[0]}" alt="">` : `<div class="calendar-avatar-placeholder avatar-${branch}">${esc((p.firstName || "?")[0])}</div>`;
  const sub = kind === "birthday"
    ? `исполнится ${years} ${ruPlural(years, ["год", "года", "лет"])}`
    : `${years} ${ruPlural(years, ["год", "года", "лет"])} со дня памяти`;
  return `
    <a class="calendar-row" href="#/person/${p.id}">
      <div class="calendar-date"><span class="cal-day">${day}</span><span class="cal-month">${RU_MONTHS_SHORT[month]}</span></div>
      ${avatar}
      <div class="calendar-info"><div class="calendar-name">${esc(fullName(p))}</div><div class="calendar-sub muted">${esc(sub)}</div></div>
      ${dateBadge(item.daysUntil)}
    </a>
  `;
}

function viewDates() {
  const db = DB.get();
  const living = db.persons.filter((p) => p.isLiving);
  const deceased = db.persons.filter((p) => !p.isLiving);
  const birthdays = buildDateSchedule(living, "birth");
  const memorials = buildDateSchedule(deceased, "death");
  const livingMissing = living.length - birthdays.length;
  const deceasedMissing = deceased.length - memorials.length;

  return `
    <div class="page">
      <div class="page-head"><div><span class="eyebrow">Семейный календарь</span><h1>Даты</h1>
      <p class="lede">Дни рождения живых родственников и дни памяти ушедших — по точным датам, какие есть в архиве. Отсортировано по ближайшей дате от сегодняшнего дня.</p></div></div>

      <div class="dates-columns">
        <section>
          <h2><span class="legend-dot" style="background:var(--teal)"></span>Дни рождения</h2>
          ${birthdays.length === 0 ? emptyState("Пока пусто", "Ни у кого из живых родственников нет точной даты рождения в архиве.") : `
            <div class="calendar-list">${birthdays.map((i) => dateRow(i, "birthday")).join("")}</div>`}
          ${livingMissing > 0 ? `<p class="muted" style="font-size:0.85rem;margin-top:14px">Ещё у ${livingMissing} ${ruPlural(livingMissing, ["живого родственника", "живых родственников", "живых родственников"])} нет точной даты рождения — как только она появится в карточке, человек попадёт в это расписание.</p>` : ""}
        </section>

        <section>
          <h2><span class="legend-dot" style="background:var(--ink-faint)"></span>Дни памяти</h2>
          ${memorials.length === 0 ? emptyState("Пока пусто", "Ни у кого из ушедших родственников нет точной даты в архиве.") : `
            <div class="calendar-list">${memorials.map((i) => dateRow(i, "memorial")).join("")}</div>`}
          ${deceasedMissing > 0 ? `<p class="muted" style="font-size:0.85rem;margin-top:14px">Ещё у ${deceasedMissing} ${ruPlural(deceasedMissing, ["человека", "человек", "человек"])} нет точной даты кончины в архиве.</p>` : ""}
        </section>
      </div>
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

function photoThumb(src, i) {
  return `<div class="photo-thumb"><img src="${src}" alt=""><button type="button" class="photo-remove" data-action="photo-remove" data-index="${i}">✕</button></div>`;
}

function personFormFields(p = {}) {
  const photos = personPhotos(p);
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
    <label class="block">Чем жил, кем работал, чем известен(на) — жизненный путь, если что-то известно
      <textarea class="input" name="bio" rows="4" placeholder="Например: работала учительницей русского языка; была известна как хорошая портниха на всю деревню; воевала в 1943–1945…">${esc(p.bio)}</textarea>
    </label>
    <label class="block">Заметки <textarea class="input" name="notes" rows="2">${esc(p.notes)}</textarea></label>
    <label class="block">Фотографии (можно несколько)
      <input type="file" accept="image/*" multiple data-action="photos-input">
      <div class="photo-grid" data-photos-target>${photos.map((src, i) => photoThumb(src, i)).join("")}</div>
    </label>
    <input type="hidden" name="photos" value='${esc(JSON.stringify(photos))}'>
  `;
}

function readPersonForm(form) {
  const fd = new FormData(form);
  const photos = JSON.parse(fd.get("photos") || "[]");
  return {
    lastName: fd.get("lastName")?.trim() || "", firstName: fd.get("firstName")?.trim() || "",
    middleName: fd.get("middleName")?.trim() || "", maidenName: fd.get("maidenName")?.trim() || "",
    gender: fd.get("gender") || "unknown", isLiving: fd.get("isLiving") === "on",
    birth: readDateField(form, "birth"), death: readDateField(form, "death"),
    birthPlace: fd.get("birthPlace")?.trim() || "", deathPlace: fd.get("deathPlace")?.trim() || "",
    occupation: fd.get("occupation")?.trim() || "", bio: fd.get("bio")?.trim() || "", notes: fd.get("notes")?.trim() || "",
    photos, photo: photos[0] || "",
  };
}

function normalizeNameForDedup(s) {
  return (s || "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]/gi, "");
}
function findPossibleDuplicate(lastName, firstName, byYear) {
  const target = normalizeNameForDedup(lastName) + normalizeNameForDedup(firstName);
  if (!target) return null;
  return DB.get().persons.find((p) => {
    const key = normalizeNameForDedup(p.lastName) + normalizeNameForDedup(p.firstName);
    if (key !== target) return false;
    if (byYear) { const existingYear = birthYear(p); if (existingYear && Math.abs(existingYear - byYear) > 2) return false; }
    return true;
  }) || null;
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

function personCompleteness(p) {
  const core = [];
  if (!p.birth || p.birth.mode === "unknown") core.push("дата рождения");
  if (!p.birthPlace) core.push("место рождения");
  if (!p.occupation && !p.bio) core.push("чем известен / род занятий");
  if (p._meta?.relationToMarina === "родство не установлено") core.push("родство не определено");
  const nice = [];
  if (!personPhotos(p).length) nice.push("фото");
  return { core, nice, missing: [...core, ...nice] };
}

function adminPeopleTab(db) {
  const onlyIncomplete = window.__adminIncompleteOnly;
  let list = db.persons.map((p) => ({ p, ...personCompleteness(p) }));
  const incompleteCount = list.filter((x) => x.core.length > 0).length;
  if (onlyIncomplete) list = list.filter((x) => x.core.length > 0);
  list.sort((a, b) => b.core.length - a.core.length || fullName(a.p).localeCompare(fullName(b.p), "ru"));

  return `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        <p class="muted" style="margin:0">Не хватает ключевых сведений: <strong style="color:var(--gold)">${incompleteCount}</strong> из ${db.persons.length} (фото не считаем «пробелом» — это отдельно, отмечено серым)</p>
        <label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;color:var(--ink-soft);cursor:pointer">
          <input type="checkbox" data-action="toggle-incomplete-filter" ${onlyIncomplete ? "checked" : ""}> показывать только неполные
        </label>
      </div>
      <table class="admin-table">
        <thead><tr><th>Имя</th><th>Родство</th><th>Годы</th><th>Чего не хватает</th><th></th></tr></thead>
        <tbody>${list.map(({ p, core, nice }) => `
          <tr class="${core.length ? "row-incomplete" : ""}">
            <td><a href="#/person/${p.id}">${esc(fullName(p))}</a></td>
            <td class="muted">${esc(p._meta.relationToMarina)}</td>
            <td class="muted">${esc(shortDates(p))}</td>
            <td>
              ${core.length ? `<span class="missing-badge">${core.length}</span> <span class="muted" style="font-size:0.78rem">${esc(core.join(", "))}</span>` : `<span class="badge living" style="opacity:0.8">полная</span>`}
              ${nice.length ? `<span class="muted" style="font-size:0.75rem;display:block;margin-top:2px">+ нет фото</span>` : ""}
            </td>
            <td><button class="btn btn-small btn-danger" data-action="admin-delete-person" data-id="${p.id}">Удалить</button></td>
          </tr>`).join("")}</tbody>
      </table>
    </div>
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
  formDirty = false;
  if (!document.getElementById("route-outlet")) renderShell();
  if (!DB.isReady()) { setOutlet(loadingScreen(), "__loading"); return; }
  const { view, id } = currentRoute();
  let inner, after = null;
  if (view === "tree") inner = viewTree();
  else if (view === "scheme") { inner = viewScheme(); after = initSchemeInteraction; }
  else if (view === "investigation") inner = viewInvestigation();
  else if (view === "timeline") inner = viewTimeline();
  else if (view === "dates") inner = viewDates();
  else if (view === "people") inner = viewPeople();
  else if (view === "person") inner = viewPerson(id);
  else if (view === "origins") inner = viewOrigins();
  else if (view === "geography") inner = viewGeography();
  else if (view === "admin") inner = viewAdmin();
  else { inner = viewHome(); after = (root) => animateCountUp(root); }
  updateNavActive(view);
  setOutlet(inner, view, () => { if (after) after(document.getElementById("route-outlet")); });
}

// -------------------------------------------------------------- events

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === "people-side") { window.__peopleSide = btn.dataset.side; render(); }
  if (action === "admin-tab") { window.__adminTab = btn.dataset.tab; render(); }
  if (action === "admin-logout") { DB.setPassword(null); render(); }
  if (action === "scheme-node-click") { location.hash = "#/person/" + btn.dataset.id; }
  if (action === "print-page") window.print();

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

  if (action === "photo-remove") {
    const form = btn.closest("form");
    const hidden = form.querySelector("input[name='photos']");
    const arr = JSON.parse(hidden.value || "[]");
    arr.splice(Number(btn.dataset.index), 1);
    hidden.value = JSON.stringify(arr);
    form.querySelector("[data-photos-target]").innerHTML = arr.map((src, i) => photoThumb(src, i)).join("");
  }

  if (action === "export-backup") download("skryabin-family-backup.json", DB.exportJSON(), "application/json");
  if (action === "reset-overlay") {
    if (confirm("Все правки будут удалены для всех посетителей, останутся только исходные данные. Продолжить?")) guarded(() => DB.resetOverlay());
  }

  // ------------------------------------------------------ точки расследования
  if (action === "toggle-gaps") { window.__showGaps = !window.__showGaps; render(); }

  if (action === "gap-status") {
    guarded(() => DB.setInvestigationStatus(btn.dataset.id, btn.dataset.gap, btn.dataset.status));
  }

  if (action === "gap-search") {
    const personId = btn.dataset.id, gapType = btn.dataset.gap;
    const slot = document.getElementById(`gap-slot-${personId}-${gapType}`);
    if (slot) slot.innerHTML = `<p class="muted-small">🤖 Спрашиваем ИИ про стратегию поиска…</p>`;
    DB.aiSearchStrategies(personId).then((result) => {
      if (slot) slot.innerHTML = searchStrategiesBlock(personId, gapType, result);
    }).catch((err) => { if (slot) slot.innerHTML = aiErrorBox(err); });
  }

  if (action === "open-candidate-form") {
    const slot = document.getElementById(`candidate-form-slot-${btn.dataset.id}-${btn.dataset.gap}`);
    if (slot) slot.innerHTML = candidateForm(btn.dataset.id, btn.dataset.gap);
  }

  // ------------------------------------------------------------------ заметки
  if (action === "open-note-form" || action === "gap-note-open") {
    const targetType = btn.dataset.targetType || "investigation";
    const targetId = btn.dataset.targetId || `${btn.dataset.id}:${btn.dataset.gap}`;
    const slot = document.getElementById(`note-form-slot-${targetType}-${targetId}`);
    if (slot) slot.innerHTML = noteForm(targetType, targetId);
  }
  if (action === "close-note-form") {
    const slot = document.getElementById(`note-form-slot-${btn.dataset.targetType}-${btn.dataset.targetId}`);
    if (slot) slot.innerHTML = "";
  }
  if (action === "delete-note") {
    if (confirm("Удалить заметку?")) guarded(() => DB.deleteNote(btn.dataset.id));
  }

  // ---------------------------------------------------------------- кандидаты
  if (action === "cand-reject") guarded(() => DB.updateCandidate(btn.dataset.id, { status: "rejected" }));
  if (action === "cand-continue") guarded(() => DB.updateCandidate(btn.dataset.id, { status: "searching" }));

  if (action === "cand-ai-compare") {
    const c = DB.candidates().find((x) => x.id === btn.dataset.id);
    if (!c || !c.personId) return;
    btn.disabled = true; btn.textContent = "Сравниваем…";
    DB.aiCompareCandidate(c.personId, c, c.id).then(() => DB.refresh()).catch((err) => {
      toast(err.code === "ai_not_configured" ? "ИИ не настроен на сервере." : "Не удалось сравнить: " + err.message, true);
    }).finally(() => { btn.disabled = false; btn.textContent = "🤖 Сравнить"; });
  }

  if (action === "cand-confirm") {
    const c = DB.candidates().find((x) => x.id === btn.dataset.id);
    if (!c) return;
    const dup = findPossibleDuplicate(c.name.split(/\s+/)[0], c.name.split(/\s+/)[1], c.birthYear ? Number(c.birthYear) : null);
    if (dup && !confirm(`Похожий человек уже есть в архиве: «${fullName(dup)}». Всё равно добавить нового?`)) return;
    guarded(async () => {
      const parts = c.name.split(/\s+/);
      const created = await DB.addPerson({
        lastName: parts.length > 1 ? parts[0] : "", firstName: parts.length > 1 ? parts[1] : parts[0], middleName: parts[2] || "",
        birth: c.birthYear ? { mode: "year", year: c.birthYear } : { mode: "unknown" },
        death: c.deathYear ? { mode: "year", year: c.deathYear } : { mode: "unknown" },
        birthPlace: c.place || "", bio: c.foundInfo || "",
      });
      if (c.personId && c.gapType) {
        const relMap = { father: ["up", "parent"], mother: ["up", "parent"], parents: ["up", "parent"], spouse: ["side", "spouse"], children: ["down", "parent"], siblings: ["side", "sibling"] };
        const [dir, type] = relMap[c.gapType] || ["side", "sibling"];
        if (type === "parent") await (dir === "up" ? DB.addRelationship(created.id, c.personId, "parent") : DB.addRelationship(c.personId, created.id, "parent"));
        else await DB.addRelationship(c.personId, created.id, type);
      }
      await DB.updateCandidate(c.id, { status: "confirmed" });
      toast("Добавлено в дерево.");
    });
  }

  // --------------------------------------------------------------------- AI
  if (action === "ai-dossier") {
    const personId = btn.dataset.id;
    const slot = document.getElementById("dossier-slot");
    btn.disabled = true; btn.textContent = "Собираем…";
    DB.aiDossier(personId, "factual").then((d) => {
      slot.innerHTML = `
        <div class="panel">
          <h4 class="eyebrow">🤖 Досье (по имеющимся данным)</h4>
          ${d.basics ? `<p><strong>Основное:</strong> ${esc(d.basics)}</p>` : ""}
          ${d.parents ? `<p><strong>Родители:</strong> ${esc(d.parents)}</p>` : ""}
          ${d.family ? `<p><strong>Семья:</strong> ${esc(d.family)}</p>` : ""}
          ${d.children ? `<p><strong>Дети:</strong> ${esc(d.children)}</p>` : ""}
          ${d.places ? `<p><strong>Места:</strong> ${esc(d.places)}</p>` : ""}
          ${d.events ? `<p><strong>События:</strong> ${esc(d.events)}</p>` : ""}
          ${d.known ? `<p class="muted-small"><strong>Известно точно:</strong> ${esc(d.known)}</p>` : ""}
          ${d.unknown ? `<p class="muted-small"><strong>Остаётся неизвестным:</strong> ${esc(d.unknown)}</p>` : ""}
        </div>`;
    }).catch((err) => { slot.innerHTML = `<div class="panel">${aiErrorBox(err)}</div>`; })
      .finally(() => { btn.disabled = false; btn.textContent = "🤖 Создать досье"; });
  }

  if (action === "ai-surname") {
    const surname = btn.dataset.surname, slotId = btn.dataset.slot;
    const slot = document.getElementById(slotId);
    btn.disabled = true; btn.textContent = "Спрашиваем ИИ…";
    const members = DB.get().persons.filter((p) => stripGenderSuffix(p.lastName).toLowerCase() === stripGenderSuffix(surname).toLowerCase()).map(fullName).join(", ");
    DB.aiSurname(surname, members).then((r) => {
      slot.innerHTML = `
        <div class="ai-result">
          <p>${esc(r.etymology || "")}</p>
          ${r.variants && r.variants.length ? `<p class="muted-small">Варианты написания: ${r.variants.map(esc).join(", ")}</p>` : ""}
          ${r.historicalDistribution ? `<p class="muted-small">${esc(r.historicalDistribution)}</p>` : ""}
          ${r.regions ? `<p class="muted-small">Регионы: ${esc(r.regions)}</p>` : ""}
          ${r.additionalNotes ? `<p class="muted-small">${esc(r.additionalNotes)}</p>` : ""}
          <p class="uncertain-tag auto-tag" style="display:inline-block">${esc(r.disclaimer || "Общие сведения об ономастике, не доказанная история семьи")}</p>
        </div>`;
    }).catch((err) => { slot.innerHTML = aiErrorBox(err); })
      .finally(() => { btn.disabled = false; btn.textContent = "🤖 Уточнить через ИИ"; });
  }
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.matches("[data-action='scheme-root-select']")) { window.__schemeRoot = el.value; render(); }
  if (el.matches("[data-action='toggle-incomplete-filter']")) { window.__adminIncompleteOnly = el.checked; render(); }
  if (el.name && el.name.endsWith("_mode")) {
    const fs = el.closest("[data-datefield]");
    fs.querySelectorAll(".date-inputs").forEach((s) => { s.style.display = s.dataset.mode === el.value ? "inline-flex" : "none"; });
  }
  if (el.matches("[data-action='photos-input']")) {
    const files = Array.from(el.files || []);
    if (!files.length) return;
    const form = el.closest("form");
    const hidden = form.querySelector("input[name='photos']");
    let pending = files.length;
    const results = [];
    files.forEach((file, idx) => {
      resizeImageFile(file, 900, (dataUrl) => {
        results[idx] = dataUrl;
        pending--;
        if (pending === 0) {
          const arr = JSON.parse(hidden.value || "[]").concat(results);
          hidden.value = JSON.stringify(arr);
          form.querySelector("[data-photos-target]").innerHTML = arr.map((src, i) => photoThumb(src, i)).join("");
        }
      });
    });
  }
});

document.addEventListener("input", (e) => {
  if (e.target.matches("[data-action='people-search']")) {
    window.__peopleQ = e.target.value;
    render();
    const box = document.querySelector("[data-action='people-search']");
    if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  }
});

// Enter в текстовом поле многополевой формы раньше отправлял её сразу —
// человек ещё печатает следующее поле, а форма уже ушла и "слетает" на
// новую страницу с неполными данными. Разрешаем отправку по Enter только
// из последнего поля формы (или явным кликом на кнопку) — в остальных
// полях Enter просто переводит фокус на следующее поле, как Tab.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const el = e.target;
  if (el.tagName !== "INPUT") return;
  const form = el.closest("[data-form]");
  if (!form) return;
  const fields = [...form.querySelectorAll("input:not([type=hidden]):not([type=file]), select")];
  const idx = fields.indexOf(el);
  const isLast = idx === -1 || idx === fields.length - 1;
  if (isLast) return; // из последнего поля Enter отправляет форму как обычно
  e.preventDefault();
  const next = fields[idx + 1];
  if (next) next.focus();
});

function withSubmitLoading(form, loadingLabel, fn) {
  const btn = form.querySelector("button[type=submit]");
  const original = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = loadingLabel; }
  const restore = () => { if (btn) { btn.disabled = false; btn.textContent = original; } };
  const result = fn();
  if (result && typeof result.finally === "function") result.finally(restore);
  else restore();
  return result;
}

document.addEventListener("submit", (e) => {
  const form = e.target;
  if (!form.matches("[data-form]")) return;
  e.preventDefault();
  const kind = form.dataset.form;

  if (kind === "admin-login") {
    withSubmitLoading(form, "Входим…", () => DB.checkPassword(form.password.value).then((ok) => {
      if (ok) render();
      else toast("Неверный пароль.", true);
    }).catch(() => toast("Не удалось связаться с сервером.", true)));
  }

  if (kind === "new-person") {
    const data = readPersonForm(form);
    const dup = findPossibleDuplicate(data.lastName, data.firstName, birthYear(data));
    if (dup && !confirm(`Похожий человек уже есть в архиве: «${fullName(dup)}» (${shortDates(dup)}). Всё равно создать нового?`)) return;
    withSubmitLoading(form, "Сохраняем…", () => guarded(async () => { const created = await DB.addPerson(data); location.hash = "#/person/" + created.id; }));
  }

  if (kind === "edit-person") {
    withSubmitLoading(form, "Сохраняем…", () => guarded(async () => { await DB.updatePerson(form.dataset.id, readPersonForm(form)); document.getElementById("edit-person-slot").innerHTML = ""; toast("Сохранено."); }));
  }

  if (kind === "quick-add") {
    const personId = form.dataset.person, key = form.dataset.key;
    const def = QUICK_ADD_DEFS.find((q) => q.key === key);
    withSubmitLoading(form, "Добавляем…", () => guarded(async () => {
      let otherId;
      if (form.mode.value === "existing") {
        otherId = form.existingId.value;
        if (!otherId) { toast("Выберите человека из списка.", true); return; }
      } else {
        const raw = (form.newName.value || "").trim();
        if (!raw) { toast("Введите имя.", true); return; }
        const parts = raw.split(/\s+/);
        const dup = findPossibleDuplicate(parts.length > 1 ? parts[0] : "", parts.length > 1 ? parts[1] : parts[0], null);
        if (dup && !confirm(`Похожий человек уже есть в архиве: «${fullName(dup)}». Всё равно создать нового?`)) return;
        const created = await DB.addPerson({ lastName: parts.length > 1 ? parts[0] : "", firstName: parts.length > 1 ? parts[1] : parts[0], middleName: parts[2] || "", gender: def.gender || "unknown" });
        otherId = created.id;
      }
      if (def.type === "parent") await (def.dir === "up" ? DB.addRelationship(otherId, personId, "parent") : DB.addRelationship(personId, otherId, "parent"));
      else if (def.type === "spouse") await DB.addRelationship(personId, otherId, "spouse");
      else if (def.type === "sibling") await DB.addRelationship(personId, otherId, "sibling");
      document.getElementById("quick-add-slot").innerHTML = "";
      toast("Добавлено.");
    }));
  }

  if (kind === "add-note") {
    const targetType = form.dataset.targetType, targetId = form.dataset.targetId;
    withSubmitLoading(form, "Сохраняем…", () => guarded(async () => {
      await DB.addNote(targetType, targetId, form.noteType.value, form.text.value.trim());
      const slot = document.getElementById(`note-form-slot-${targetType}-${targetId}`);
      if (slot) slot.innerHTML = "";
      toast("Заметка сохранена.");
    }));
  }

  if (kind === "add-candidate") {
    const personId = form.dataset.person, gapType = form.dataset.gap;
    const fd = new FormData(form);
    const sourceUrl = fd.get("sourceUrl")?.trim();
    withSubmitLoading(form, "Сохраняем…", () => guarded(async () => {
      await DB.addCandidate({
        personId, gapType,
        name: fd.get("name")?.trim() || "", birthYear: fd.get("birthYear") || "", deathYear: fd.get("deathYear") || "",
        place: fd.get("place")?.trim() || "", assumedRelation: fd.get("assumedRelation")?.trim() || "",
        foundInfo: fd.get("foundInfo")?.trim() || "", sourceUrl: sourceUrl || "",
        sources: sourceUrl ? [{ url: sourceUrl }] : [],
      });
      await DB.setInvestigationStatus(personId, gapType, "candidate_found");
      const slot = document.getElementById(`candidate-form-slot-${personId}-${gapType}`);
      if (slot) slot.innerHTML = "";
      toast("Кандидат добавлен в «Расследование».");
    }));
  }
});

// -------------------------------------------------------------------- boot

renderShell();
initStarfield();
render();
DB.ready().then(render);
