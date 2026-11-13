import { $, $$, h, fmtTimer, fmtDuration, debounce, uid } from './util.js';
import { icon } from './icons.js';
import { load, save, loadSettings, PRESETS, DEFAULT_SETTINGS, clientId, addSession, statsSummary } from './store.js';
import { quoteOfTheDay } from './quotes.js';
import { Timer } from './timer.js';
import { sound, SOUND_LIST, SOUND_PRESETS, ALERTS } from './sounds.js';
import { SceneRenderer, CANVAS_SCENES, PHOTO_SCENES } from './scenes.js';
import { Room, newRoomCode, parseRoomCode, roomSupported } from './room.js';

/* ================= state ================= */
const S = loadSettings();
const persist = debounce(() => save('settings', S), 250);
let tasks = load('tasks', []);
const saveTasks = () => save('tasks', tasks);
let customScenes = load('customScenes', []);
const CID = clientId();
const myColor = `hsl(${[...CID].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360} 85% 78%)`;

const timer = new Timer(() => S);
const scenes = new SceneRenderer($('#scene-canvas'), $('#scene-img'));
const room = new Room({ clientId: CID, hello: () => ({ name: S.name || 'Friend', color: myColor }) });

const PHASE_NAMES = { focus: 'Focus', short: 'Short break', long: 'Long break', countdown: 'Countdown', stopwatch: 'Stopwatch' };
const TALLY = { dot: '●', tomato: '🍅', star: '★', heart: '♥' };
const firstName = () => (room.friend?.name || 'Your friend').split(' ')[0];
const currentTask = () => tasks.find((t) => !t.done);

/* ================= small UI helpers ================= */
$$('[data-icon]').forEach((b) => b.insertAdjacentHTML('afterbegin', icon(b.dataset.icon)));
$('#t-reset').innerHTML = icon('rotate-ccw');
$('#t-skip').innerHTML = icon('skip-forward');
$('#mf-check').innerHTML = icon('check');

function toast(msg, { action, timeout = 4200 } = {}) {
  const el = h('div', { class: 'toast' }, h('span', { text: msg }));
  if (action) el.append(h('button', { class: 'btn', text: action.label, onclick: () => { action.fn(); dismiss(); } }));
  const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), 320); };
  $('#toasts').append(el);
  while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
  setTimeout(dismiss, timeout);
  return el;
}

function floatEmoji(emoji, n = 6) {
  for (let i = 0; i < n; i++) {
    const f = h('div', { class: 'floater', text: emoji });
    f.style.left = `${15 + Math.random() * 70}%`;
    f.style.setProperty('--dx', `${(Math.random() - 0.5) * 30}vw`);
    f.style.animationDelay = `${i * 0.14}s`;
    f.style.fontSize = `${32 + Math.random() * 26}px`;
    $('#floaters').append(f);
    setTimeout(() => f.remove(), 3800 + i * 140);
  }
}

function rangeFill(input) { input.style.setProperty('--p', `${(input.value / (input.max || 1)) * 100}%`); }

function panelHead(title, id) {
  return h('div', { class: 'panel-head' },
    h('h2', { text: title }),
    h('button', { class: 'x', title: 'Close (Esc)', html: icon('x'), onclick: () => openPanel(null) }));
}

function toggleEl(checked, onchange) {
  const input = h('input', { type: 'checkbox' });
  input.checked = !!checked;
  input.addEventListener('change', () => onchange(input.checked));
  return h('span', { class: 'toggle' }, input, h('i'));
}

/* ================= modes ================= */
function setMode(m) {
  S.mode = m; persist();
  document.body.classList.remove('mode-home', 'mode-focus', 'mode-ambient');
  document.body.classList.add(`mode-${m}`);
  $('#home-view').classList.toggle('show', m === 'home');
  $('#focus-view').classList.toggle('show', m === 'focus');
  $$('#mode-switch button').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  updateMini();
  sendStatusSoon();
  poke();
}
$$('#mode-switch button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('#mini-timer').addEventListener('click', () => setMode('focus'));

/* ================= clock / greeting / quote ================= */
const clockEl = $('#clock');
function renderClock() {
  const d = new Date();
  let hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  let ampm = '';
  if (!S.clock24) { ampm = hh >= 12 ? 'PM' : 'AM'; hh = hh % 12 || 12; }
  const sec = S.showSeconds ? `<span class="sec">${String(d.getSeconds()).padStart(2, '0')}</span>` : '';
  const html = `${S.clock24 ? String(hh).padStart(2, '0') : hh}:${mm}${sec}${ampm ? `<span class="ampm">${ampm}</span>` : ''}`;
  if (clockEl._h !== html) { clockEl.innerHTML = html; clockEl._h = html; }
  const H = d.getHours();
  $('#greet-word').textContent = H < 5 ? 'Hello, night owl' : H < 12 ? 'Good morning' : H < 17 ? 'Good afternoon' : H < 22 ? 'Good evening' : 'Good night';
}

// the greeting's name is an inline input; nameEl.textContent setter keeps other code simple
const nameInput = $('#greet-name');
const fitName = () => { if (!CSS.supports('field-sizing', 'content')) nameInput.size = Math.max(2, (nameInput.value || nameInput.placeholder).length); };
const nameEl = { set textContent(v) { if (nameInput !== document.activeElement) { nameInput.value = v; fitName(); } } };
nameEl.textContent = S.name;
const announceName = debounce(() => room.updateHello(), 600);
nameInput.addEventListener('input', () => {
  S.name = nameInput.value.replace(/\s+/g, ' ').trim().slice(0, 30);
  fitName(); persist(); announceName();
  for (const id of ['#room-name', '#room-name-live']) { const el = $(id); if (el && el !== document.activeElement) el.value = S.name; }
});
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); } });
nameInput.addEventListener('blur', () => { nameInput.value = S.name; fitName(); });

let quoteOffset = 0;
function renderQuote() {
  const q = quoteOfTheDay(quoteOffset);
  $('#quote-text').textContent = `“${q.text}”`;
  $('#quote-author').textContent = q.author;
  $('#quote').hidden = !S.showQuote;
}
$('#quote').addEventListener('click', () => {
  $('#quote').style.opacity = 0;
  setTimeout(() => { quoteOffset++; renderQuote(); $('#quote').style.opacity = 1; }, 300);
});

/* ================= main focus (home) ================= */
function renderMainFocus() {
  const cur = currentTask();
  $('#mf-input').hidden = !!cur;
  $('#mf-current').hidden = !cur;
  $('#mf-label').textContent = cur ? 'Today’s focus' : 'What’s your main focus today?';
  if (cur) $('#mf-text').textContent = cur.text;
  $('#focus-task-text').textContent = cur ? cur.text : 'Pick a task to focus on';
}
$('#mf-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    addTask(e.target.value.trim(), 1, true);
    e.target.value = '';
    e.target.blur();
  }
});
$('#mf-check').addEventListener('click', () => { const c = currentTask(); if (c) toggleTask(c.id); });
$('#focus-task').addEventListener('click', () => openPanel('tasks'));

/* ================= tasks ================= */
function addTask(text, est = 1, top = false) {
  const t = { id: uid(8), text: text.slice(0, 200), done: false, est, spent: 0 };
  if (top) tasks.unshift(t); else tasks.push(t);
  saveTasks(); renderTasks();
}

function toggleTask(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  if (t.done) {
    // move finished tasks below the active ones
    tasks = [...tasks.filter((x) => !x.done), ...tasks.filter((x) => x.done)];
    floatEmoji('✨', 4);
    toast(`Nice work — “${t.text.slice(0, 40)}” done`);
    if (room.connected) room.send({ t: 'event', kind: 'task', text: t.text });
  }
  saveTasks(); renderTasks();
}

let dragId = null;
function renderTasks() {
  renderMainFocus();
  const list = $('#task-list');
  if (!list) return;
  list.innerHTML = '';
  const cur = currentTask();
  if (!tasks.length) list.append(h('li', { class: 'empty', text: 'No tasks yet. Add one above — the top task becomes your focus.' }));
  for (const t of tasks) {
    const textEl = h('span', { class: 't-text', text: t.text, title: 'Double-click to edit' });
    textEl.addEventListener('dblclick', () => {
      textEl.contentEditable = 'plaintext-only';
      textEl.focus();
      document.getSelection().selectAllChildren(textEl);
    });
    const commit = () => {
      textEl.contentEditable = 'false';
      const v = textEl.textContent.trim();
      if (v && v !== t.text) { t.text = v; saveTasks(); renderMainFocus(); sendStatusSoon(); } else textEl.textContent = t.text;
    };
    textEl.addEventListener('blur', commit);
    textEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); textEl.blur(); } });

    const li = h('li', { class: `task${t.done ? ' done' : ''}${t === cur ? ' current' : ''}`, draggable: 'true', 'data-id': t.id },
      h('span', { class: 'grip', html: icon('grip-vertical') }),
      h('button', { class: 'tick', html: icon('check'), title: t.done ? 'Mark not done' : 'Mark done', onclick: () => toggleTask(t.id) }),
      textEl,
      t === cur ? h('span', { class: 'now', text: 'Now' }) : null,
      h('span', { class: 't-meta', title: 'Focus sessions done / estimated', html: `${icon('timer')}${t.spent}/${t.est}` }),
      h('button', { class: 'icon-btn del', html: icon('trash-2'), title: 'Delete', onclick: () => { tasks = tasks.filter((x) => x.id !== t.id); saveTasks(); renderTasks(); sendStatusSoon(); } }),
    );
    li.addEventListener('dragstart', (e) => { dragId = t.id; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    li.addEventListener('dragend', () => { dragId = null; renderTasks(); });
    li.addEventListener('dragover', (e) => { e.preventDefault(); $$('.task', list).forEach((x) => x.classList.remove('drop-above')); li.classList.add('drop-above'); });
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragId || dragId === t.id) return;
      const moving = tasks.find((x) => x.id === dragId);
      tasks = tasks.filter((x) => x.id !== dragId);
      tasks.splice(tasks.findIndex((x) => x.id === t.id), 0, moving);
      saveTasks(); sendStatusSoon();
    });
    list.append(li);
  }
  const done = tasks.filter((t) => t.done).length;
  $('#task-count').textContent = tasks.length ? `${done} of ${tasks.length} done` : '';
  $('#task-clear').hidden = !done;
  sendStatusSoon();
}

function buildTasksPanel() {
  const p = $('#panel-tasks');
  const input = h('input', { class: 'field', placeholder: 'Add a task…', maxlength: 200, id: 'task-input' });
  const est = h('select', { class: 'field', title: 'Estimated focus sessions' },
    ...[1, 2, 3, 4, 5, 6, 8].map((n) => h('option', { value: n, text: `${n}×` })));
  const add = () => { if (input.value.trim()) { addTask(input.value.trim(), Number(est.value)); input.value = ''; input.focus(); } };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  p.append(
    panelHead('Tasks'),
    h('div', { class: 'task-add' }, input, est, h('button', { class: 'btn solid', html: icon('plus'), title: 'Add', onclick: add })),
    h('ul', { class: 'task-list', id: 'task-list' }),
    h('div', { class: 'row between', style: { marginTop: '12px', fontSize: '13px', color: 'var(--muted)' } },
      h('span', { id: 'task-count' }),
      h('button', { class: 'btn small', id: 'task-clear', text: 'Clear completed', onclick: () => { tasks = tasks.filter((t) => !t.done); saveTasks(); renderTasks(); } })),
    h('p', { class: 'note', text: 'Drag to reorder. Your top unfinished task is your current focus, and completed focus sessions are counted against it.' }),
  );
}

/* ================= timer ================= */
const timerEl = $('#timer');
function renderTimer() {
  const st = timer.state;
  const v = timer.value();
  const txt = fmtTimer(v);
  if (timerEl.textContent !== txt) timerEl.textContent = txt;
  $('#phase-tabs').hidden = st.type !== 'pomodoro';
  $('#type-label').hidden = st.type === 'pomodoro';
  $('#type-label').textContent = PHASE_NAMES[st.type];
  $$('#phase-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.phase === st.phase));
  const started = st.type === 'stopwatch' ? v > 0 : st.remainingMs < st.totalMs;
  $('#t-toggle').textContent = st.running ? 'Pause' : started ? 'Resume' : 'Start';
  $('#t-skip').hidden = st.type !== 'pomodoro';
  $('#t-reset').title = st.type === 'stopwatch' ? 'Stop & save (R)' : 'Reset (R)';
  const tally = $('#tally');
  if (st.type === 'pomodoro') {
    const n = Math.max(1, S.longEvery);
    const key = `${n}:${st.cycle}:${S.tally}`;
    if (tally._k !== key) {
      tally._k = key;
      tally.innerHTML = '';
      for (let i = 0; i < n; i++) tally.append(h('span', { class: i < st.cycle ? 'on' : '', text: TALLY[S.tally] || '●' }));
    }
  } else { tally.innerHTML = ''; tally._k = ''; }
  $('#mini-phase').textContent = PHASE_NAMES[st.phase];
  $('#mini-time').textContent = txt;
  document.title = st.running ? `${txt} · ${PHASE_NAMES[st.phase]} — focusroom` : 'focusroom';
}

function updateMini() {
  document.body.classList.toggle('show-mini', S.mode === 'home' && timer.state.running);
}

$('#t-toggle').addEventListener('click', () => { sound.ensure(); timer.toggle(); });
$('#t-reset').addEventListener('click', () => {
  const swMin = timer.reset();
  if (swMin >= 1) { addSession(swMin, currentTask()?.text); toast(`Saved ${fmtDuration(swMin)} of focus`); renderStats(); }
});
$('#t-skip').addEventListener('click', () => timer.skip());
$$('#phase-tabs button').forEach((b) => b.addEventListener('click', () => timer.setPhase(b.dataset.phase)));

timer.on('complete', ({ phase, minutes, type }) => {
  sound.alert(S.alert, S.alertVolume);
  const cur = currentTask();
  if (phase === 'focus' || type === 'countdown') {
    addSession(minutes, cur?.text);
    if (cur && type === 'pomodoro') { cur.spent += 1; saveTasks(); renderTasks(); }
    toast(`Focus session complete — ${fmtDuration(minutes)} logged. Take a breather ☕`, { timeout: 6000 });
    notify('Focus session complete', 'Time for a break.');
    floatEmoji('🎉', 5);
    room.send({ t: 'event', kind: 'complete', minutes });
  } else {
    toast('Break’s over — ready to focus?', { timeout: 6000 });
    notify('Break’s over', 'Ready for another focus session?');
  }
  renderStats();
});
timer.on('partial', ({ minutes }) => {
  addSession(minutes, currentTask()?.text);
  toast(`Logged ${fmtDuration(minutes)} of focus`);
  renderStats();
});
timer.on('change', ({ source, action }) => {
  renderTimer(); updateMini();
  if (source === 'local' && syncOn && room.connected) {
    // after a natural finish, the room host is the source of truth for what comes next
    if (!(action === 'complete' && room.role !== 'host')) room.send({ t: 'timer', snap: timer.snapshot(), action });
  }
  sendStatusSoon();
  poke();
});

function notify(title, body) {
  if (!S.notify || !('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  try { new Notification(title, { body, icon: 'favicon.svg', silent: true }); } catch { /* noop */ }
}

/* ================= sounds ================= */
let soundCat = 'All';
function buildSoundsPanel() {
  const p = $('#panel-sounds');
  const master = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: S.masterVolume });
  rangeFill(master);
  master.addEventListener('input', () => { S.masterVolume = Number(master.value); sound.setMaster(S.masterVolume); rangeFill(master); persist(); });
  const cats = ['All', ...new Set(SOUND_LIST.map((s) => s.cat))];
  p.append(
    panelHead('Ambient sounds'),
    h('div', { class: 'row', style: { gap: '12px' } }, h('span', { html: icon('volume-2') }), master),
    h('h3', { text: 'Soundscapes' }),
    h('div', { class: 'chips', id: 'sound-presets' }, ...SOUND_PRESETS.map((pr) => h('button', { text: pr.name, onclick: () => applyMix(pr.mix) }))),
    h('h3', { text: 'Layer your own' }),
    h('div', { class: 'chips', id: 'sound-cats', style: { marginBottom: '10px' } }, ...cats.map((c) => h('button', { text: c, 'data-cat': c, onclick: () => { soundCat = c; renderSounds(); } }))),
    h('div', { class: 'sound-grid', id: 'sound-grid' }),
    h('div', { class: 'row between', style: { marginTop: '12px' } },
      h('p', { class: 'note', id: 'binaural-note', text: 'Binaural beats need headphones.' }),
      h('button', { class: 'btn small', text: 'Stop all', onclick: () => applyMix({}) })),
  );
  renderSounds();
}

function applyMix(mix) {
  for (const id of Object.keys(S.sounds)) if (!(id in mix)) sound.set(id, 0);
  S.sounds = { ...mix };
  for (const [id, v] of Object.entries(mix)) sound.set(id, v);
  persist(); renderSounds();
}

function renderSounds() {
  const grid = $('#sound-grid');
  if (!grid) return;
  $$('#sound-cats button').forEach((b) => b.classList.toggle('on', b.dataset.cat === soundCat));
  grid.innerHTML = '';
  for (const s of SOUND_LIST.filter((x) => soundCat === 'All' || x.cat === soundCat)) {
    const on = (S.sounds[s.id] || 0) > 0;
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: S.sounds[s.id] || 0.5, title: 'Volume' });
    rangeFill(vol);
    vol.addEventListener('click', (e) => e.stopPropagation());
    vol.addEventListener('input', () => {
      const v = Math.max(0.01, Number(vol.value));
      S.sounds[s.id] = v; sound.set(s.id, v); rangeFill(vol); persist();
    });
    const tile = h('div', { class: `sound${on ? ' on' : ''}`, role: 'button', tabindex: 0, 'aria-pressed': String(on) },
      h('div', { class: 'top', html: `${icon(s.icon)}<span>${s.name}</span>` }), vol);
    const flip = () => {
      if (S.sounds[s.id] > 0) { delete S.sounds[s.id]; sound.set(s.id, 0); } else { S.sounds[s.id] = 0.5; sound.set(s.id, 0.5); }
      persist(); renderSounds();
    };
    tile.addEventListener('click', flip);
    tile.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    grid.append(tile);
  }
  const anyBinaural = Object.keys(S.sounds).some((id) => SOUND_LIST.find((s) => s.id === id)?.beat);
  $('#binaural-note').style.visibility = anyBinaural ? 'visible' : 'hidden';
  $$('#sound-presets button').forEach((b, i) => {
    const mix = SOUND_PRESETS[i].mix;
    const same = Object.keys(mix).length === Object.keys(S.sounds).length && Object.keys(mix).every((k) => S.sounds[k] > 0);
    b.classList.toggle('on', same);
  });
}

// browsers only allow audio after a user gesture: resume saved sounds on the first one
function resumeAudioOnce() {
  sound.ensure();
  sound.setMaster(S.masterVolume);
  for (const [id, v] of Object.entries(S.sounds)) if (v > 0) sound.set(id, v);
  removeEventListener('pointerdown', resumeAudioOnce, true);
  removeEventListener('keydown', resumeAudioOnce, true);
}
addEventListener('pointerdown', resumeAudioOnce, true);
addEventListener('keydown', resumeAudioOnce, true);

/* ================= music ================= */
// Lofi Girl live streams (verified Nov 2026 — stream IDs occasionally change; paste a new link if one goes offline)
const MUSIC = [
  { kind: 'youtube', id: 'rFZHOHl-L8A', title: 'Lofi hip hop radio', sub: 'YouTube · live · beats to relax/study to' },
  { kind: 'youtube', id: 'E2vONfzoyRI', title: 'Jazz lofi radio', sub: 'YouTube · live' },
  { kind: 'youtube', id: 'N0snMcR6aaA', title: 'Relaxing piano radio', sub: 'YouTube · live' },
  { kind: 'youtube', id: 'jXAEIWcGXwE', title: 'Classical music radio', sub: 'YouTube · live' },
  { kind: 'youtube', id: '4xDzrJKXOOY', title: 'Synthwave radio', sub: 'YouTube · live' },
  { kind: 'spotify', id: 'playlist/37i9dQZF1DWZeKCadgRdKQ', title: 'Deep Focus', sub: 'Spotify playlist' },
  { kind: 'spotify', id: 'playlist/37i9dQZF1DWWQRwui0ExPn', title: 'Lofi Beats', sub: 'Spotify playlist' },
];

function parseMusic(url) {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return { kind: 'youtube', id: u.pathname.slice(1).split('/')[0] };
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      if (u.searchParams.get('list') && !u.searchParams.get('v')) return { kind: 'youtube-list', id: u.searchParams.get('list') };
      if (u.searchParams.get('v')) return { kind: 'youtube', id: u.searchParams.get('v') };
      const m = u.pathname.match(/\/(?:embed|live|shorts)\/([\w-]{6,})/);
      if (m) return { kind: 'youtube', id: m[1] };
    }
    if (host === 'open.spotify.com') {
      const m = u.pathname.match(/(?:\/intl-[a-z-]+)?\/(?:embed\/)?(playlist|album|track|episode|show|artist)\/([A-Za-z0-9]+)/);
      if (m) return { kind: 'spotify', id: `${m[1]}/${m[2]}` };
    }
  } catch { /* not a url */ }
  return null;
}

function musicSrc(m, autoplay) {
  if (m.kind === 'youtube') return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(m.id)}?autoplay=${autoplay ? 1 : 0}&rel=0&modestbranding=1`;
  if (m.kind === 'youtube-list') return `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(m.id)}&autoplay=${autoplay ? 1 : 0}`;
  if (m.kind === 'spotify') return `https://open.spotify.com/embed/${m.id}?utm_source=generator&theme=0`;
  return '';
}

function playMusic(m, autoplay = true) {
  S.music = m; persist();
  const player = $('#player');
  player.innerHTML = '';
  player.append(h('iframe', {
    src: musicSrc(m, autoplay), height: m.kind === 'spotify' ? 152 : 210, loading: 'lazy', title: m.title || 'Music player',
    allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture', referrerpolicy: 'strict-origin-when-cross-origin',
  }));
  player.hidden = false;
  $('#music-stop').hidden = false;
  renderMusicList();
}

function renderMusicList() {
  const list = $('#music-list');
  list.innerHTML = '';
  for (const m of MUSIC) {
    const on = S.music && S.music.kind === m.kind && S.music.id === m.id;
    list.append(h('button', { class: `music-item${on ? ' on' : ''}`, onclick: () => playMusic(m) },
      h('span', { html: icon(on ? 'volume-2' : 'play') }),
      h('span', { class: 'stack', style: { gap: '2px' } }, h('span', { text: m.title }), h('span', { class: 'src', text: m.sub }))));
  }
}

let musicBuilt = false;
function buildMusicPanel() {
  const p = $('#panel-music');
  const url = h('input', { class: 'field', placeholder: 'Paste a YouTube or Spotify link' });
  const go = () => {
    const m = parseMusic(url.value);
    if (!m) { toast('That link doesn’t look like a YouTube or Spotify link'); return; }
    playMusic({ ...m, title: 'Your link' });
    url.value = '';
  };
  url.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  p.append(
    panelHead('Music'),
    h('div', { class: 'music-list', id: 'music-list' }),
    h('h3', { text: 'Your own playlist' }),
    h('div', { class: 'row' }, url, h('button', { class: 'btn solid', text: 'Play', onclick: go })),
    h('div', { class: 'player', id: 'player', hidden: true }),
    h('div', { class: 'row between', style: { marginTop: '10px' } },
      h('p', { class: 'note', text: 'Music keeps playing when you close this panel. Spotify plays full tracks when you’re signed in to Spotify in this browser.' }),
      h('button', { class: 'btn small', id: 'music-stop', hidden: true, text: 'Stop', onclick: () => { $('#player').innerHTML = ''; $('#player').hidden = true; S.music = null; persist(); $('#music-stop').hidden = true; renderMusicList(); } })),
  );
  renderMusicList();
}
function ensureMusicPlayer() {
  if (musicBuilt) return;
  musicBuilt = true;
  if (S.music) playMusic(S.music, false);
}

/* ================= themes ================= */
const allScenes = () => [...CANVAS_SCENES, ...PHOTO_SCENES, ...customScenes.map((c) => ({ ...c, kind: 'photo', custom: true }))];
function setScene(id, { quiet } = {}) {
  const def = allScenes().find((s) => s.id === id) || CANVAS_SCENES[0];
  scenes.set(def);
  S.scene = def.id; persist();
  document.body.classList.toggle('tone-light', def.tone === 'light');
  document.body.classList.toggle('photo', def.kind === 'photo');
  $$('.theme').forEach((t) => t.classList.toggle('on', t.dataset.id === def.id));
  if (!quiet) sendStatusSoon();
}

let thumbsMade = false;
function buildThemesPanel() {
  const p = $('#panel-themes');
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  file.addEventListener('change', () => { if (file.files[0]) addCustomImage(file.files[0]); file.value = ''; });
  const url = h('input', { class: 'field', placeholder: 'Or paste an image URL' });
  const addUrl = () => {
    const v = url.value.trim();
    if (!/^https?:\/\//i.test(v)) { toast('Paste a full image link starting with https://'); return; }
    const c = { id: `c${uid(6)}`, name: 'My image', url: v };
    customScenes.push(c); save('customScenes', customScenes); url.value = '';
    renderThemeGrids(); setScene(c.id);
  };
  url.addEventListener('keydown', (e) => { if (e.key === 'Enter') addUrl(); });
  p.append(
    panelHead('Themes'),
    h('h3', { text: 'Animated scenes' }), h('div', { class: 'theme-grid', id: 'grid-canvas' }),
    h('h3', { text: 'Photos' }), h('div', { class: 'theme-grid', id: 'grid-photo' }),
    h('h3', { text: 'Your own' }), h('div', { class: 'theme-grid', id: 'grid-custom' }),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn', html: `${icon('upload')}Upload`, onclick: () => file.click() }), url,
      h('button', { class: 'btn', text: 'Add', onclick: addUrl }), file),
  );
}

function themeTile(def, bg) {
  const t = h('button', { class: `theme${def.id === S.scene ? ' on' : ''}`, 'data-id': def.id, title: def.name, onclick: () => setScene(def.id) }, h('span', { text: def.name }));
  t.style.backgroundImage = `url("${bg}")`;
  if (def.custom) {
    t.append(h('span', {
      class: 'rm', html: icon('x'), title: 'Remove',
      onclick: (e) => {
        e.stopPropagation();
        customScenes = customScenes.filter((c) => c.id !== def.id); save('customScenes', customScenes);
        if (S.scene === def.id) setScene(CANVAS_SCENES[0].id);
        renderThemeGrids();
      },
    }));
  }
  return t;
}

const thumbCache = {};
function renderThemeGrids() {
  const gc = $('#grid-canvas'), gp = $('#grid-photo'), gu = $('#grid-custom');
  if (!gc) return;
  gc.innerHTML = ''; gp.innerHTML = ''; gu.innerHTML = '';
  for (const s of CANVAS_SCENES) gc.append(themeTile(s, thumbCache[s.id] ||= SceneRenderer.thumbnail(s)));
  for (const s of PHOTO_SCENES) gp.append(themeTile(s, s.thumb));
  for (const c of customScenes) gu.append(themeTile({ ...c, custom: true }, c.url));
  if (!customScenes.length) gu.append(h('p', { class: 'note', style: { gridColumn: '1 / -1' }, text: 'Upload a photo or paste an image link to make it your background.' }));
}

function addCustomImage(f) {
  const img = new Image();
  const reader = new FileReader();
  reader.onload = () => { img.src = reader.result; };
  img.onload = () => {
    const max = 2400;
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    let q = 0.85, data = c.toDataURL('image/jpeg', q);
    while (data.length > 1.6e6 && q > 0.4) { q -= 0.1; data = c.toDataURL('image/jpeg', q); }
    const entry = { id: `c${uid(6)}`, name: f.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'My photo', url: data };
    customScenes.push(entry);
    if (!save('customScenes', customScenes)) {
      customScenes.pop();
      toast('That image is too big to keep — try a smaller one');
      return;
    }
    renderThemeGrids(); setScene(entry.id);
  };
  reader.readAsDataURL(f);
}

/* ================= stats ================= */
function buildStatsPanel() {
  $('#panel-stats').append(panelHead('Focus stats'), h('div', { id: 'stats-body' }));
}

function renderStats() {
  const body = $('#stats-body');
  if (!body || !$('#panel-stats').classList.contains('open')) return;
  const s = statsSummary();
  const max = Math.max(30, ...s.last7.map((d) => d.min));
  const today = s.last7[6].day;
  body.innerHTML = '';
  body.append(
    h('div', { class: 'stat-tiles' },
      h('div', { class: 'tile' }, h('b', { text: fmtDuration(s.todayMin) }), h('span', { text: 'Focused today' })),
      h('div', { class: 'tile' }, h('b', { text: String(s.todaySessions) }), h('span', { text: 'Sessions today' })),
      h('div', { class: 'tile' }, h('b', { text: fmtDuration(s.weekMin) }), h('span', { text: 'Last 7 days' })),
      h('div', { class: 'tile' }, h('b', { text: `${s.streak} ${s.streak === 1 ? 'day' : 'days'}` }), h('span', { text: 'Streak' })),
    ),
    h('h3', { text: 'This week' }),
    h('div', { class: 'bars' }, ...s.last7.map((d) => h('div', { class: `bar${d.day === today ? ' today' : ''}`, title: `${d.label}: ${fmtDuration(d.min)}` },
      h('i', { style: { height: `${Math.max(2, (d.min / max) * 100)}%` }, 'data-v': d.min ? fmtDuration(d.min) : null }), h('span', { text: d.label })))),
    h('div', { class: 'row between', style: { marginTop: '16px', fontSize: '13.5px', color: 'var(--muted)' } },
      h('span', { text: `This month: ${fmtDuration(s.monthMin)}` }), h('span', { text: `All time: ${fmtDuration(s.totalMin)}` })),
    h('h3', { text: 'Recent sessions' }),
    s.recent.length
      ? h('ul', { class: 'log-list' }, ...s.recent.map((r) => h('li', {},
        h('span', {}, h('b', { text: fmtDuration(r.min) }), r.task ? ` · ${r.task.slice(0, 34)}` : ''),
        h('span', { text: new Date(r.ts).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) }))))
      : h('p', { class: 'empty', text: 'Finish a focus session and it will show up here.' }),
  );
  if (room.connected && friendStatus) {
    body.append(h('p', { class: 'note', style: { marginTop: '14px' }, text: `${firstName()} has focused ${fmtDuration(friendStatus.todayMin || 0)} today across ${friendStatus.sessions || 0} ${friendStatus.sessions === 1 ? 'session' : 'sessions'}.` }));
  }
}

/* ================= settings ================= */
function buildSettingsPanel() {
  const p = $('#panel-settings');
  const row = (label, control, sub) => h('div', { class: 'set-row' }, h('label', {}, label, sub ? h('span', { class: 'sub', text: sub }) : null), control);
  const sel = (key, opts, after) => {
    const s = h('select', { class: 'field' }, ...opts.map(([v, t]) => h('option', { value: v, text: t })));
    s.value = S[key];
    s.addEventListener('change', () => { S[key] = s.value; persist(); after?.(s.value); });
    return s;
  };
  const tog = (key, after) => toggleEl(S[key], (v) => { S[key] = v; persist(); after?.(v); });
  const num = (key, min, max, after) => {
    const n = h('input', { type: 'number', class: 'field', min, max, value: S[key] });
    n.addEventListener('change', () => {
      const v = Math.min(max, Math.max(min, Math.round(Number(n.value) || S[key])));
      n.value = v; S[key] = v; persist(); after?.();
    });
    return n;
  };
  const durInputs = {};
  const onDur = () => { S.preset = 'custom'; presetSel.value = 'custom'; timer.refreshDurations(); renderTimer(); };
  const presetSel = sel('preset', Object.entries(PRESETS).map(([k, v]) => [k, v.label]), (k) => {
    const pr = PRESETS[k];
    if (pr.focusMin) { for (const key of ['focusMin', 'shortMin', 'longMin']) { S[key] = pr[key]; durInputs[key].value = pr[key]; } persist(); timer.refreshDurations(); renderTimer(); }
  });
  for (const key of ['focusMin', 'shortMin', 'longMin']) durInputs[key] = num(key, 1, 180, onDur);

  const name = h('input', { class: 'field', value: S.name, placeholder: 'Your name', maxlength: 30, style: { width: '160px' } });
  name.addEventListener('input', () => { S.name = name.value.trim(); nameEl.textContent = S.name; persist(); announceName(); });

  const alertTest = h('button', { class: 'btn small', text: 'Test', onclick: () => sound.alert(S.alert, S.alertVolume) });
  const alertVol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: S.alertVolume, style: { width: '140px' } });
  rangeFill(alertVol);
  alertVol.addEventListener('input', () => { S.alertVolume = Number(alertVol.value); rangeFill(alertVol); persist(); });

  const fileIn = h('input', { type: 'file', accept: 'application/json', hidden: true });
  fileIn.addEventListener('change', async () => {
    try {
      const data = JSON.parse(await fileIn.files[0].text());
      if (data.settings) save('settings', data.settings);
      if (data.tasks) save('tasks', data.tasks);
      if (data.log) save('log', data.log);
      if (data.customScenes) save('customScenes', data.customScenes);
      location.reload();
    } catch { toast('That file isn’t a focusroom backup'); }
  });

  p.append(
    panelHead('Settings'),
    h('h3', { text: 'General' }),
    row('Your name', name),
    row('24-hour clock', tog('clock24', renderClock)),
    row('Show seconds', tog('showSeconds', renderClock)),
    row('Show quote', tog('showQuote', renderQuote)),
    row('Auto-hide controls', tog('autoHide'), 'In ambient mode and while a timer runs'),
    h('h3', { text: 'Timer' }),
    row('Timer type', sel('timerType', [['pomodoro', 'Pomodoro'], ['countdown', 'Countdown'], ['stopwatch', 'Stopwatch']], (v) => { timer.setType(v); renderTimer(); })),
    row('Preset', presetSel),
    h('div', { class: 'grid-3', style: { margin: '8px 0' } },
      h('label', {}, 'Focus (min)', durInputs.focusMin), h('label', {}, 'Short break', durInputs.shortMin), h('label', {}, 'Long break', durInputs.longMin)),
    row('Long break every', num('longEvery', 1, 12, () => { renderTimer(); }), 'focus sessions'),
    row('Countdown length', num('countdownMin', 1, 600, () => { timer.refreshDurations(); renderTimer(); }), 'minutes'),
    row('Auto-start breaks', tog('autoBreaks')),
    row('Auto-start focus', tog('autoFocus')),
    row('Session tally', sel('tally', [['dot', '● Dots'], ['tomato', '🍅 Tomatoes'], ['star', '★ Stars'], ['heart', '♥ Hearts']], renderTimer)),
    h('h3', { text: 'Alerts' }),
    row('Alert sound', h('span', { class: 'row' }, sel('alert', ALERTS), alertTest)),
    row('Alert volume', alertVol),
    row('Desktop notification', tog('notify', async (v) => {
      if (v && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    }), 'When the tab is in the background'),
    h('h3', { text: 'Study room' }),
    row('Sync timers by default', tog('roomSyncDefault'), 'When your friend joins'),
    h('h3', { text: 'Your data' }),
    h('p', { class: 'note', text: 'Everything is saved in this browser only. Back it up to move it to another device.' }),
    h('div', { class: 'row', style: { flexWrap: 'wrap' } },
      h('button', {
        class: 'btn small', text: 'Export backup', onclick: () => {
          const blob = new Blob([JSON.stringify({ settings: S, tasks, log: load('log', []), customScenes }, null, 1)], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: `focusroom-backup-${new Date().toISOString().slice(0, 10)}.json` });
          a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        },
      }),
      h('button', { class: 'btn small', text: 'Import backup', onclick: () => fileIn.click() }), fileIn,
      h('button', {
        class: 'btn small danger', text: 'Reset everything', onclick: () => {
          if (!confirm('Erase all settings, tasks and stats in this browser?')) return;
          Object.keys(localStorage).filter((k) => k.startsWith('focusroom:')).forEach((k) => localStorage.removeItem(k));
          location.reload();
        },
      })),
    h('p', { class: 'note', style: { marginTop: '14px' }, html: 'Shortcuts: <b>Space</b> start/pause · <b>R</b> reset · <b>N</b> skip · <b>1 2 3</b> modes · <b>T</b> tasks · <b>S</b> sounds · <b>M</b> music · <b>B</b> themes · <b>G</b> room · <b>F</b> full screen' }),
  );
}

/* ================= study room ================= */
let syncOn = false;
let negotiated = false;
let friendStatus = null;
let unread = 0;
const chatLog = [];

function friendValue(fs) {
  const age = Date.now() - fs.at + room.latency;
  if (fs.type === 'stopwatch') return fs.value + (fs.running ? age : 0);
  return fs.running ? Math.max(0, fs.value - age) : fs.value;
}

function friendActivity(fs) {
  if (!fs) return ['Saying hello…', ''];
  const v = friendValue(fs);
  if (fs.type === 'stopwatch') return fs.running ? ['Focusing', fmtTimer(v)] : ['Taking it easy', ''];
  if (fs.running) {
    if (fs.phase === 'focus' || fs.type === 'countdown') return ['Focusing', fmtTimer(v)];
    return [fs.phase === 'long' ? 'On a long break' : 'On a short break', fmtTimer(v)];
  }
  if (fs.value < fs.totalMs) return [`Paused · ${PHASE_NAMES[fs.phase]}`, fmtTimer(v)];
  return [fs.mode === 'ambient' ? 'Relaxing in ambient mode' : 'Taking it easy', ''];
}

function statusPayload() {
  const st = timer.state;
  const sum = statsSummary();
  return {
    t: 'status', mode: S.mode, type: st.type, phase: st.phase, running: st.running, value: timer.value(), totalMs: st.totalMs,
    task: currentTask()?.text || '', todayMin: sum.todayMin, sessions: sum.todaySessions,
  };
}
function sendStatus() { if (room.connected) room.send(statusPayload()); }
const sendStatusSoon = debounce(sendStatus, 250);
setInterval(sendStatus, 10000);

function setSync(on, { announce = true, snap } = {}) {
  syncOn = on;
  if (announce && room.connected) room.send({ t: 'sync', on, snap: on ? (snap || timer.snapshot()) : undefined });
  renderRoom();
}

function negotiateSync() {
  // only the room's anchor (host) decides, once per connection
  if (room.role !== 'host' || negotiated || !friendStatus) return;
  negotiated = true;
  if (!S.roomSyncDefault) { setSync(false); return; }
  if (!timer.state.running && friendStatus.running) {
    syncOn = true;
    room.send({ t: 'sync', on: true, lead: 'you' }); // friend's running timer wins
    renderRoom();
  } else setSync(true);
}

function addChat(entry) {
  chatLog.push(entry);
  if (chatLog.length > 200) chatLog.shift();
  renderChat();
}

room.on('state', (st) => {
  if (st !== 'connected') { negotiated = false; }
  renderRoom(); updateChip();
});
room.on('friend', (f, first) => {
  if (first) {
    toast(`${f.name} joined your room 👋`);
    addChat({ sys: `${f.name} joined` });
    floatEmoji('👋', 3);
  }
  sendStatus();
  renderRoom(); updateChip();
});
room.on('friend-left', (reason) => {
  const n = firstName();
  friendStatus = null;
  negotiated = false;
  if (reason === 'left') { toast(`${n} left the room`); addChat({ sys: `${n} left` }); }
  else toast(`Lost connection to ${n} — reconnecting…`);
  renderRoom(); updateChip();
});
room.on('message', (msg) => {
  switch (msg.t) {
    case 'status':
      friendStatus = { ...msg, at: Date.now() };
      negotiateSync();
      updateFriendCard(); updateChip();
      break;
    case 'sync':
      syncOn = !!msg.on;
      if (msg.snap) timer.apply(msg.snap, room.latency);
      if (msg.lead === 'you') room.send({ t: 'timer', snap: timer.snapshot(), action: 'sync' });
      if (negotiated || room.role === 'guest') toast(syncOn ? `Timers synced with ${firstName()}` : `${firstName()} turned timer sync off`);
      negotiated = true;
      renderRoom();
      break;
    case 'timer':
      if (!syncOn) break;
      timer.apply(msg.snap, room.latency);
      if (['start', 'pause', 'skip', 'reset', 'phase', 'type'].includes(msg.action)) {
        const verb = { start: 'started', pause: 'paused', skip: 'skipped to the next session on', reset: 'reset', phase: 'switched', type: 'changed' }[msg.action];
        toast(`${firstName()} ${verb} the timer`, { timeout: 2600 });
      }
      break;
    case 'chat': {
      const text = String(msg.text || '').slice(0, 500);
      addChat({ who: 'them', text });
      if (!$('#panel-room').classList.contains('open')) {
        unread++;
        toast(`${firstName()}: ${text.slice(0, 80)}`, { action: { label: 'Reply', fn: () => openPanel('room') } });
      }
      updateRoomDot();
      break;
    }
    case 'react':
      if (typeof msg.emoji === 'string' && msg.emoji.length <= 8) { floatEmoji(msg.emoji, 6); toast(`${firstName()} sent ${msg.emoji}`, { timeout: 2600 }); }
      break;
    case 'event':
      if (msg.kind === 'complete') { toast(`🎉 ${firstName()} finished a ${fmtDuration(msg.minutes || 0)} focus session`); floatEmoji('🎉', 3); }
      if (msg.kind === 'task') toast(`✅ ${firstName()} finished “${String(msg.text || '').slice(0, 40)}”`);
      break;
    case 'scene': {
      const def = allScenes().find((s) => s.id === msg.id);
      if (def) toast(`${firstName()} shared the “${def.name}” theme`, { action: { label: 'Use it', fn: () => setScene(def.id) }, timeout: 8000 });
      else if (typeof msg.url === 'string' && /^https:\/\//.test(msg.url)) {
        toast(`${firstName()} shared a background`, {
          timeout: 8000,
          action: { label: 'Use it', fn: () => { const c = { id: `c${uid(6)}`, name: msg.name || 'Shared', url: msg.url }; customScenes.push(c); save('customScenes', customScenes); renderThemeGrids(); setScene(c.id); } },
        });
      }
      break;
    }
  }
});

function inviteLink() {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('room', room.code);
  return u.toString();
}

function setUrlRoom(code) {
  const u = new URL(location.href);
  if (code) u.searchParams.set('room', code); else u.searchParams.delete('room');
  history.replaceState(null, '', u);
}

function joinRoom(code) {
  if (!code) return;
  friendStatus = null; negotiated = false; syncOn = false; chatLog.length = 0; unread = 0;
  room.join(code);
  save('lastRoom', code);
  setUrlRoom(code);
  renderRoom(); renderChat();
}

function leaveRoom() {
  room.leave();
  friendStatus = null; syncOn = false;
  setUrlRoom('');
  renderRoom(); updateChip();
}

function buildRoomPanel() {
  const p = $('#panel-room');
  const nameIn = h('input', { class: 'field', id: 'room-name', placeholder: 'Your name', maxlength: 30, value: S.name });
  nameIn.addEventListener('input', () => { S.name = nameIn.value.trim(); nameEl.textContent = S.name; persist(); announceName(); });
  const codeIn = h('input', { class: 'field', placeholder: 'Room code or invite link', id: 'room-code-in' });
  const doJoin = () => {
    const c = parseRoomCode(codeIn.value);
    if (c.length < 4) { toast('Enter the room code or paste the invite link'); return; }
    codeIn.value = ''; joinRoom(c);
  };
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

  const idle = h('div', { id: 'room-idle' },
    h('div', { class: 'room-hero' },
      h('div', { class: 'emoji', text: '🫶' }),
      h('h4', { text: 'Study with a friend' }),
      h('p', { class: 'note', text: 'Open a private room for you and one friend. Run the same timer, see what each other is working on, and cheer each other on.' })),
    h('h3', { text: 'Your name' }), nameIn,
    h('button', { class: 'btn solid', style: { width: '100%', marginTop: '12px', padding: '12px' }, html: `${icon('sparkles')}Create a room`, onclick: () => joinRoom(newRoomCode()) }),
    h('h3', { text: 'Have an invite?' }),
    h('div', { class: 'row' }, codeIn, h('button', { class: 'btn', text: 'Join', onclick: doJoin })),
    h('button', { class: 'btn small', id: 'room-rejoin', style: { marginTop: '10px' }, hidden: true, onclick: () => joinRoom(load('lastRoom', '')) }),
    h('p', { class: 'note', id: 'room-unsupported', hidden: true, text: 'Rooms need a browser with WebRTC (recent Chrome, Edge, Firefox or Safari).' }),
    h('p', { class: 'note', style: { marginTop: '14px' }, text: 'Rooms are peer-to-peer: your timer, status and messages go straight to your friend’s browser and aren’t stored on a server.' }),
  );

  const syncTog = h('span', { id: 'sync-toggle' });
  const chatIn = h('input', { class: 'field', placeholder: 'Say something nice…', maxlength: 500, id: 'chat-in' });
  const sendChat = () => {
    const t = chatIn.value.trim();
    if (!t) return;
    if (!room.send({ t: 'chat', text: t })) { toast('Your friend isn’t connected right now'); return; }
    addChat({ who: 'me', text: t });
    chatIn.value = '';
  };
  chatIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  const live = h('div', { id: 'room-live', hidden: true },
    h('div', { class: 'room-code' },
      h('span', { html: icon('link') }), h('code', { id: 'room-code-text' }),
      h('button', { class: 'btn small', html: `${icon('copy')}Copy link`, id: 'room-copy', onclick: copyInvite })),
    h('div', { class: 'room-status', id: 'room-status' }, h('i', { class: 'pulse' }), h('span', { id: 'room-status-text' })),
    h('div', { id: 'friend-slot' }),
    h('div', { class: 'set-row', id: 'sync-row' }, h('label', {}, 'Sync our timers', h('span', { class: 'sub', text: 'Start, pause and skip together' })), syncTog),
    h('div', { class: 'reacts', id: 'reacts' }, ...['👋', '🔥', '💪', '☕', '🎉', '❤️'].map((e) => h('button', {
      text: e, title: `Send ${e}`, onclick: () => {
        if (room.send({ t: 'react', emoji: e })) floatEmoji(e, 2); else toast('Your friend isn’t connected right now');
      },
    }))),
    h('div', { class: 'chat' },
      h('div', { class: 'chat-log', id: 'chat-log' }),
      h('div', { class: 'chat-form' }, chatIn, h('button', { class: 'icon-btn', html: icon('send'), title: 'Send', onclick: sendChat }))),
    h('div', { class: 'row between', style: { marginTop: '12px' } },
      h('button', {
        class: 'btn small', html: `${icon('image')}Share my theme`, onclick: () => {
          const def = allScenes().find((s) => s.id === S.scene);
          if (!room.connected) { toast('Your friend isn’t connected right now'); return; }
          if (def?.custom && def.url.startsWith('data:')) { toast('Uploaded photos stay on your device — share a built-in theme or an image link'); return; }
          room.send({ t: 'scene', id: def.custom ? null : def.id, url: def.custom ? def.url : undefined, name: def.name });
          toast('Theme sent');
        },
      }),
      h('button', { class: 'btn small danger', html: `${icon('log-out')}Leave room`, onclick: leaveRoom })),
    h('div', { class: 'row', style: { marginTop: '12px', fontSize: '13px', color: 'var(--muted)' } }, 'You’re ',
      h('input', { class: 'field', id: 'room-name-live', value: S.name, placeholder: 'your name', maxlength: 30, style: { width: '140px', padding: '5px 9px' }, oninput: (e) => { S.name = e.target.value.trim(); nameEl.textContent = S.name; persist(); announceName(); } })),
  );

  const full = h('div', { id: 'room-full', hidden: true },
    h('div', { class: 'room-hero' }, h('div', { class: 'emoji', text: '🚪' }), h('h4', { text: 'This room is full' }),
      h('p', { class: 'note', text: 'Rooms are for two. Ask your friend for a new link, or create your own room.' })),
    h('button', { class: 'btn solid', style: { width: '100%' }, text: 'Back', onclick: leaveRoom }));

  p.append(panelHead('Study room'), idle, live, full);
  renderRoom();
}

async function copyInvite() {
  const link = inviteLink();
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: 'Study with me on focusroom', text: 'Join my focus room:', url: link }); return; } catch { /* fall through */ }
  }
  try { await navigator.clipboard.writeText(link); toast('Invite link copied — send it to your friend'); }
  catch { prompt('Copy this invite link:', link); }
}

const STATUS_TEXT = {
  connecting: 'Opening the room…',
  waiting: 'Waiting for your friend — send them the link',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  error: 'Couldn’t connect',
};

function renderRoom() {
  if (!$('#room-idle')) return;
  const st = room.state;
  const inRoom = !['idle', 'full'].includes(st);
  $('#room-idle').hidden = st !== 'idle';
  $('#room-live').hidden = !inRoom;
  $('#room-full').hidden = st !== 'full';
  const last = load('lastRoom', '');
  $('#room-rejoin').hidden = !last || st !== 'idle';
  $('#room-rejoin').textContent = `Rejoin last room (${last})`;
  $('#room-unsupported').hidden = roomSupported();
  if (inRoom) {
    $('#room-code-text').textContent = room.code;
    const status = $('#room-status');
    status.classList.toggle('ok', st === 'connected');
    status.classList.toggle('bad', st === 'error');
    $('#room-status-text').textContent = st === 'connected' ? `Connected with ${room.friend?.name || 'your friend'}` : STATUS_TEXT[st] || st;
    const sync = $('#sync-toggle');
    sync.innerHTML = '';
    sync.append(toggleEl(syncOn, (v) => {
      if (!room.connected) { toast('Your friend isn’t connected right now'); renderRoom(); return; }
      setSync(v); toast(v ? `Timers synced with ${firstName()}` : 'Timer sync off');
    }));
    $('#sync-row').style.opacity = room.connected ? 1 : 0.5;
    const rnl = $('#room-name-live'); if (rnl !== document.activeElement) rnl.value = S.name;
  }
  updateFriendCard();
  updateSyncBadge();
  updateRoomDot();
}

function updateFriendCard() {
  const slot = $('#friend-slot');
  if (!slot) return;
  if (!room.friend || room.state === 'idle') { slot.innerHTML = ''; return; }
  const f = room.friend;
  const [what, time] = friendActivity(room.connected ? friendStatus : null);
  const card = slot.firstChild?.classList?.contains('friend-card') ? slot.firstChild : null;
  const html = '<div class="avatar lg"></div><div class="who"><div class="name"></div><div class="what"></div><div class="task-line"></div></div><div class="ftime"></div>';
  let el = card;
  if (!el) { el = h('div', { class: 'friend-card', html }); slot.innerHTML = ''; slot.append(el); }
  el.classList.toggle('offline', !room.connected);
  $('.avatar', el).style.setProperty('--c', f.color || '#b9adff');
  $('.avatar', el).textContent = (f.name || '?').trim()[0]?.toUpperCase() || '?';
  $('.name', el).textContent = f.name;
  $('.what', el).textContent = room.connected ? what : 'Offline — they’ll reconnect when they’re back';
  $('.task-line', el).innerHTML = '';
  if (room.connected && friendStatus?.task) $('.task-line', el).append(h('em', { text: 'Working on ' }), friendStatus.task);
  $('.ftime', el).textContent = room.connected ? time : '';
}

function updateChip() {
  const chip = $('#friend-chip');
  const st = room.state;
  if (st === 'idle' || st === 'full' || st === 'error') { chip.hidden = true; return; }
  chip.hidden = false;
  const f = room.friend;
  if (room.connected && f) {
    const [what, time] = friendActivity(friendStatus);
    const html = '<span class="avatar sm"></span><span class="live"></span><span class="t"></span>';
    if (!chip._live) { chip.innerHTML = html; chip._live = true; }
    $('.avatar', chip).textContent = (f.name || '?')[0].toUpperCase();
    $('.avatar', chip).style.setProperty('--c', f.color || '#b9adff');
    $('.t', chip).innerHTML = '';
    $('.t', chip).append(h('b', { text: f.name.split(' ')[0] }), h('span', { class: 'muted', text: ` · ${what}${time ? ` ${time}` : ''}` }));
  } else {
    chip._live = false;
    chip.innerHTML = '';
    chip.append(h('span', { html: icon('users'), style: { display: 'grid', placeItems: 'center', width: '28px' } }),
      h('span', { class: 'muted', text: st === 'waiting' ? 'Room open · waiting for your friend' : st === 'reconnecting' ? 'Reconnecting to your friend…' : 'Opening room…' }));
  }
}
$('#friend-chip').addEventListener('click', () => openPanel('room'));

function updateSyncBadge() {
  const b = $('#sync-badge');
  const show = syncOn && room.connected;
  b.hidden = !show;
  if (show) { b.innerHTML = icon('refresh-cw'); b.append(h('span', { text: `Timer synced with ${firstName()}` })); }
}

function updateRoomDot() {
  const dot = $('#room-dot');
  const active = room.state !== 'idle' && room.state !== 'full';
  dot.hidden = !active && !unread;
  dot.classList.toggle('unread', unread > 0);
}

function renderChat() {
  const log = $('#chat-log');
  if (!log) return;
  log.innerHTML = '';
  if (!chatLog.length) log.append(h('div', { class: 'sys', text: 'Messages go straight to your friend and disappear when you leave.' }));
  for (const m of chatLog) {
    if (m.sys) log.append(h('div', { class: 'sys', text: m.sys }));
    else log.append(h('div', { class: `msg ${m.who}`, text: m.text }));
  }
  log.scrollTop = log.scrollHeight;
}

/* ================= panels ================= */
let openId = null;
const builders = { tasks: buildTasksPanel, sounds: buildSoundsPanel, music: buildMusicPanel, themes: buildThemesPanel, stats: buildStatsPanel, settings: buildSettingsPanel, room: buildRoomPanel };
const built = new Set();
function ensurePanel(id) {
  if (built.has(id)) return;
  built.add(id);
  builders[id]();
  if (id === 'tasks') renderTasks();
  if (id === 'room') renderChat();
}

function openPanel(id) {
  if (id && openId === id) id = null;
  openId = id;
  if (id) ensurePanel(id);
  $$('.panel').forEach((p) => p.classList.toggle('open', p.id === `panel-${id}`));
  $$('#dock [data-panel]').forEach((b) => b.classList.toggle('active', b.dataset.panel === id));
  if (id === 'stats') renderStats();
  if (id === 'themes' && !thumbsMade) { thumbsMade = true; renderThemeGrids(); }
  if (id === 'music') ensureMusicPlayer();
  if (id === 'room') { unread = 0; updateRoomDot(); renderChat(); setTimeout(() => (room.connected ? $('#chat-in') : null)?.focus({ preventScroll: true }), 50); }
  if (id === 'tasks') setTimeout(() => $('#task-input')?.focus({ preventScroll: true }), 50);
  poke();
}
$$('#dock [data-panel]').forEach((b) => b.addEventListener('click', () => openPanel(b.dataset.panel)));
document.addEventListener('pointerdown', (e) => {
  if (!openId) return;
  if (e.target.closest('.panel, #dock, #toasts, #friend-chip, #focus-task, .mode-switch')) return;
  openPanel(null);
});

/* ================= fullscreen, idle, keys ================= */
const fsBtn = $('#fullscreen-btn');
fsBtn.addEventListener('click', toggleFullscreen);
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
document.addEventListener('fullscreenchange', () => { fsBtn.innerHTML = icon(document.fullscreenElement ? 'minimize' : 'maximize'); });
if (!document.documentElement.requestFullscreen) fsBtn.hidden = true;

let idleT;
function poke() {
  document.body.classList.remove('idle');
  clearTimeout(idleT);
  idleT = setTimeout(() => {
    if (S.autoHide && !openId && (S.mode === 'ambient' || (S.mode === 'focus' && timer.state.running))) document.body.classList.add('idle');
  }, 4500);
}
['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((ev) => addEventListener(ev, poke, { passive: true }));

// mouse clicks shouldn't leave buttons focused (Space would re-trigger them)
addEventListener('click', (e) => { const b = e.target.closest?.('button'); if (b && e.detail > 0) b.blur(); });
addEventListener('keydown', (e) => {
  const t = e.target;
  if (t.closest?.('button, [role="button"]') && (e.key === ' ' || e.key === 'Enter')) return;
  if (t.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) {
    if (e.key === 'Escape') t.blur();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const map = {
    ' ': () => { timer.toggle(); if (S.mode === 'home') setMode('focus'); },
    r: () => $('#t-reset').click(), n: () => timer.state.type === 'pomodoro' && timer.skip(),
    1: () => setMode('ambient'), 2: () => setMode('home'), 3: () => setMode('focus'),
    t: () => openPanel('tasks'), s: () => openPanel('sounds'), m: () => openPanel('music'), b: () => openPanel('themes'), g: () => openPanel('room'),
    f: toggleFullscreen, escape: () => openPanel(null),
  };
  if (map[k]) { e.preventDefault(); map[k](); }
});

/* ================= main loop ================= */
let lastSec = 0;
function loop() {
  timer.tick();
  if (document.hidden) { renderTitleOnly(); return; }
  renderTimer();
  const sec = Math.floor(Date.now() / 1000);
  if (sec !== lastSec) {
    lastSec = sec;
    renderClock();
    if (room.state !== 'idle') { updateChip(); updateFriendCard(); }
  }
}
function renderTitleOnly() {
  const st = timer.state;
  document.title = st.running ? `${fmtTimer(timer.value())} · ${PHASE_NAMES[st.phase]} — focusroom` : 'focusroom';
}
// a worker keeps ticking when the tab is in the background (timers there get throttled)
try {
  const w = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),250)'], { type: 'text/javascript' })));
  w.onmessage = loop;
} catch { setInterval(loop, 250); }

/* ================= boot ================= */
setScene(S.scene, { quiet: true });
setMode(['home', 'focus', 'ambient'].includes(S.mode) ? S.mode : 'home');
renderClock(); renderQuote(); renderMainFocus(); renderTimer(); updateRoomDot();
sound.master = S.masterVolume;

// open the invite link straight into the room
const startCode = parseRoomCode(new URLSearchParams(location.search).get('room') || '');
function bootRoom() {
  if (!startCode) return;
  joinRoom(startCode);
  openPanel('room');
  if (!S.name) setTimeout(() => $('#room-name-live')?.focus(), 200);
}
if (window.Peer) bootRoom(); else addEventListener('load', bootRoom);

// expose for debugging / tests
window.focusroom = { timer, room, sound, S, get syncOn() { return syncOn; }, get friendStatus() { return friendStatus; }, DEFAULT_SETTINGS };
