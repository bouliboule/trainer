import { TYPES, typeById, generate, stats, zoneOf, watts, durStr, ZONES } from './workouts.js';
import { workoutToFit, fitFileName } from './fit.js';
import { suggest, dayKey } from './suggest.js';

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
};
const zoneColor = (pct) => `var(--${zoneOf(pct).id})`;
const TYPE_PCT = { recovery: 0.5, endurance: 0.68, tempo: 0.83, sweetspot: 0.9, threshold: 1, vo2max: 1.15, anaerobic: 1.4 };
const LEVELS = ['Easy', 'Mod.', 'Medium', 'Hard', 'V. hard'];

// ---------- storage ----------
const DEFAULTS = { ftp: 200, targetMode: 'watts', warmupMin: 10, cooldownMin: 5, weekdayMinutes: 60, weekendMinutes: 90, weeklyTss: 400 };
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let settings = { ...DEFAULTS, ...load('settings', {}) };
let history = load('history', []);

const isWeekend = [0, 6].includes(new Date().getDay());
const state = {
  type: 'sweetspot',
  minutes: isWeekend ? settings.weekendMinutes : settings.weekdayMinutes,
  level: 3,
  seed: Math.floor(Math.random() * 1e9),
  workout: null,
};

// ---------- workout view ----------
function renderPickers() {
  const tp = $('#typePicker');
  tp.replaceChildren(
    ...TYPES.map((t) =>
      el('button', { class: 'chip' + (t.id === state.type ? ' active' : ''), type: 'button', onclick: () => { state.type = t.id; newSeed(); update(); } },
        el('span', { class: 'dot', style: `background:${zoneColor(TYPE_PCT[t.id])}` }), t.label),
    ),
  );
  $('#typeBlurb').textContent = typeById(state.type).blurb;

  $('#duration').value = state.minutes;
  $('#durationLabel').textContent = fmtMinutes(state.minutes);
  $('#durationChips').replaceChildren(
    ...[30, 45, 60, 75, 90, 120].map((m) =>
      el('button', { class: 'chip' + (m === state.minutes ? ' active' : ''), type: 'button', onclick: () => { state.minutes = m; update(); } }, fmtMinutes(m)),
    ),
  );
  $('#levelPicker').replaceChildren(
    ...LEVELS.map((l, i) =>
      el('button', { class: i + 1 === state.level ? 'active' : '', type: 'button', onclick: () => { state.level = i + 1; update(); } }, l),
    ),
  );
}

const fmtMinutes = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`);
const fmtClock = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
const newSeed = () => { state.seed = Math.floor(Math.random() * 1e9); };

function renderPreview() {
  const w = state.workout;
  const st = stats(w, settings.ftp);
  $('#wName').textContent = w.name;
  $('#wMeta').textContent = `${typeById(w.type).label} · ${LEVELS[w.level - 1]} · FTP ${settings.ftp} W`;
  $('#wStats').replaceChildren(
    ...[
      [fmtClock(st.duration), 'Duration'],
      [st.tss, 'TSS'],
      [st.if.toFixed(2), 'IF'],
      [`${st.kj}`, 'kJ'],
    ].map(([v, l]) => el('div', { class: 'stat' }, el('b', {}, String(v)), el('span', {}, l))),
  );
  $('#chart').innerHTML = chartSvg(w);
  renderSteps(w);
}

function chartSvg(w) {
  const steps = [];
  for (const it of w.items) if (it.repeat) for (let i = 0; i < it.repeat; i++) steps.push(...it.steps); else steps.push(it);
  const total = steps.reduce((t, s) => t + s.dur, 0);
  const maxPct = Math.max(1.3, ...steps.map((s) => s.pct)) * 1.05;
  const W = 1000, H = 170, top = 6, bottom = 18;
  const y = (p) => top + (H - top - bottom) * (1 - p / maxPct);
  let x = 0;
  const rects = steps.map((s) => {
    const x0 = (x / total) * W;
    x += s.dur;
    const x1 = (x / total) * W;
    return `<rect x="${x0.toFixed(2)}" y="${y(s.pct).toFixed(1)}" width="${Math.max(0.6, x1 - x0 - 0.6).toFixed(2)}" height="${(H - bottom - y(s.pct)).toFixed(1)}" fill="${zoneColor(s.pct)}" rx="1"><title>${s.name} · ${durStr(s.dur)} · ${watts(s.pct, settings.ftp)} W</title></rect>`;
  });
  const labels = [];
  const ticks = [];
  const tickEvery = total > 5400 ? 1800 : 900;
  for (let t = tickEvery; t < total; t += tickEvery) {
    const tx = (t / total) * W;
    ticks.push(`<line class="grid" x1="${tx}" x2="${tx}" y1="${top}" y2="${H - bottom}" vector-effect="non-scaling-stroke" opacity=".6"/>`);
    labels.push(`<span class="tick" style="left:${(t / total) * 100}%">${t / 60}'</span>`);
  }
  labels.push(`<span class="ftp-lbl" style="top:${(y(1) / H) * 100}%">FTP ${settings.ftp} W</span>`);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Workout power profile">
    ${ticks.join('')}
    ${rects.join('')}
    <line class="ftp" x1="0" x2="${W}" y1="${y(1)}" y2="${y(1)}" vector-effect="non-scaling-stroke"/>
  </svg>${labels.join('')}`;
}

function renderSteps(w) {
  const row = (s, inRep) =>
    el('li', { class: inRep ? 'in-rep' : '' },
      el('span', { class: 'sw', style: `background:${zoneColor(s.pct)}` }),
      el('span', { class: 'd' }, durStr(s.dur)),
      el('span', {}, s.name),
      el('span', { class: 'w' }, `${watts(s.pct, settings.ftp)} W `, el('small', {}, `${Math.round(s.pct * 100)}%`)),
    );
  const out = [];
  for (const it of w.items) {
    if (it.repeat) {
      out.push(el('li', { class: 'rep' }, `${it.repeat} ×`));
      out.push(...it.steps.map((s) => row(s, true)));
    } else out.push(row(it, false));
  }
  $('#steps').replaceChildren(...out);
}

function renderSuggestions() {
  const list = suggest(history, settings);
  $('#suggestions').replaceChildren(
    ...list.map((s) =>
      el('button', {
        class: 'suggestion', type: 'button',
        onclick: () => { Object.assign(state, { type: s.type, minutes: s.minutes, level: s.level }); newSeed(); update(); $('#preview').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
      },
        el('span', { class: 'bar', style: `background:${zoneColor(TYPE_PCT[s.type])}` }),
        el('span', {}, el('div', { class: 't' }, `${typeById(s.type).label} · ${fmtMinutes(s.minutes)} · ${LEVELS[s.level - 1]}`), el('div', { class: 'why' }, s.why)),
        el('span', { class: 'go' }, 'Use →'),
      ),
    ),
  );
}

function update() {
  state.workout = generate({ ...state, warmupMin: settings.warmupMin, cooldownMin: settings.cooldownMin });
  renderPickers();
  renderPreview();
}

function fitFile() {
  const w = state.workout;
  const bytes = workoutToFit(w, { ftp: settings.ftp, targetMode: settings.targetMode });
  return new File([bytes], fitFileName(w), { type: 'application/vnd.ant.fit' });
}

function logWorkout() {
  const w = state.workout;
  const st = stats(w, settings.ftp);
  const today = dayKey(new Date());
  // Re-downloading the same workout on the same day shouldn't double-count.
  history = history.filter((h) => !(h.date === today && h.name === w.name && h.seed === w.seed));
  history.unshift({ id: crypto.randomUUID?.() ?? String(Date.now()), date: today, type: w.type, level: w.level, minutes: w.minutes, seed: w.seed, name: w.name, tss: st.tss, if: +st.if.toFixed(2) });
  save('history', history);
  renderSuggestions();
  renderHistory();
}

$('#download').addEventListener('click', () => {
  const f = fitFile();
  const url = URL.createObjectURL(f);
  const a = el('a', { href: url, download: f.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  logWorkout();
});

if (navigator.canShare?.({ files: [new File([new Uint8Array(1)], 'x.fit', { type: 'application/vnd.ant.fit' })] })) {
  $('#share').hidden = false;
  $('#share').addEventListener('click', async () => {
    try {
      await navigator.share({ files: [fitFile()], title: state.workout.name });
      logWorkout();
    } catch {}
  });
}

$('#regen').addEventListener('click', () => { newSeed(); update(); });
$('#duration').addEventListener('input', (e) => { state.minutes = +e.target.value; update(); });

// ---------- history view ----------
function renderHistory() {
  const todayKey = dayKey(new Date());
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d; });
  const perDay = days.map((d) => history.filter((h) => h.date === dayKey(d)).reduce((t, h) => t + h.tss, 0));
  const tss7 = perDay.reduce((a, b) => a + b, 0);
  const rides7 = history.filter((h) => days.some((d) => dayKey(d) === h.date)).length;
  const min7 = history.filter((h) => days.some((d) => dayKey(d) === h.date)).reduce((t, h) => t + h.minutes, 0);
  $('#weekStats').replaceChildren(
    ...[[tss7, 'TSS'], [`${settings.weeklyTss}`, 'Target'], [rides7, 'Rides'], [fmtMinutes(min7), 'Time']].map(([v, l]) =>
      el('div', { class: 'stat' }, el('b', {}, String(v)), el('span', {}, l))),
  );
  const max = Math.max(100, ...perDay);
  $('#weekBars').replaceChildren(
    ...days.map((d, i) => el('div', { class: 'col' },
      el('span', {}, perDay[i] ? String(perDay[i]) : ''),
      el('div', { class: 'b', style: `height:${(perDay[i] / max) * 80}%` }),
      el('span', {}, dayKey(d) === todayKey ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' })),
    )),
  );

  const ul = $('#historyList');
  if (!history.length) return ul.replaceChildren(el('li', { class: 'empty' }, 'Nothing yet — download a workout to log it.'));
  ul.replaceChildren(
    ...history.slice(0, 60).map((h) =>
      el('li', {},
        el('span', { class: 'bar', style: `background:${zoneColor(TYPE_PCT[h.type])}` }),
        el('span', {}, el('div', { class: 'n' }, h.name), el('div', { class: 'm' }, `${new Date(h.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtMinutes(h.minutes)} · ${h.tss} TSS`)),
        el('button', { class: 'redo', title: 'Load this workout', onclick: () => { Object.assign(state, { type: h.type, minutes: h.minutes, level: h.level, seed: h.seed }); update(); show('workout'); } }, 'Load'),
        el('button', { title: 'Delete', 'aria-label': 'Delete', onclick: () => { history = history.filter((x) => x.id !== h.id); save('history', history); renderHistory(); renderSuggestions(); } }, '×'),
      ),
    ),
  );
}

// ---------- settings view ----------
const form = $('#settingsForm');
function renderSettings() {
  for (const [k, v] of Object.entries(settings)) if (form.elements[k]) form.elements[k].value = v;
  $('#ftpBadge').textContent = `FTP ${settings.ftp} W`;
  const lo = [0, ...ZONES.map((z) => z.max)];
  $('#zonesTable').textContent = ZONES.map((z, i) => `${z.label} ${Math.round(lo[i] * settings.ftp)}${z.max === Infinity ? '+' : '–' + (Math.round(z.max * settings.ftp) - 1)} W`).join(' · ');
}
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  for (const k of Object.keys(DEFAULTS)) {
    const v = fd.get(k);
    if (v == null || v === '') continue;
    settings[k] = typeof DEFAULTS[k] === 'number' ? +v : v;
  }
  save('settings', settings);
  renderSettings();
  update();
  renderSuggestions();
  renderHistory();
  $('#savedMsg').hidden = false;
  setTimeout(() => ($('#savedMsg').hidden = true), 1500);
});

// ---------- tabs ----------
function show(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

// ---------- boot ----------
// First suggestion pre-fills the builder.
const first = suggest(history, settings)[0];
if (first) Object.assign(state, { type: first.type, minutes: first.minutes, level: first.level });
renderSettings();
renderSuggestions();
renderHistory();
update();
if (!localStorage.getItem('settings')) show('settings'); // first run: set FTP

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
