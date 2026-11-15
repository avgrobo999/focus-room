import { $, $$, h, fmtTimer, fmtDuration, debounce, uid } from './util.js?v=20261116b';
import { icon } from './icons.js?v=20261116b';
import { load, save, loadSettings, PRESETS, DEFAULT_SETTINGS, addSession, statsSummary } from './store.js?v=20261116b';
import { quoteOfTheDay } from './quotes.js?v=20261116b';
import { Timer } from './timer.js?v=20261116b';
import { sound, SOUND_LIST, SOUND_PRESETS, ALERTS } from './sounds.js?v=20261116b';
import { SceneRenderer, CANVAS_SCENES, PHOTO_SCENES } from './scenes.js?v=20261116b';
import { Room, newRoom, parseInvite, roomSupported, MAX_PEOPLE } from './room.js?v=20261116b';
import { Voice, voiceSupported } from './voice.js?v=20261116b';
import { authConfigured, verifyIdToken, renderSignIn, promptSignIn, signOut, decodeJwt, tokenTtl, profileFromToken, roomNonceInput } from './auth.js?v=20261116b';
import { sha256b64u } from './crypto.js?v=20261116b';

// Refuse to run inside someone else's frame (clickjacking)
if (window.top !== window.self) {
  document.body.innerHTML = '';
  const a = document.createElement('a');
  a.href = location.href; a.target = '_top'; a.textContent = 'Open focusroom';
  a.style.cssText = 'color:#fff;font:600 18px sans-serif;position:fixed;inset:0;display:grid;place-items:center';
  document.body.append(a);
  throw new Error('focusroom refuses to run in a frame');
}

/* ================= state ================= */
const S = loadSettings();
const persist = debounce(() => save('settings', S), 250);
let tasks = load('tasks', []);
const saveTasks = () => save('tasks', tasks);
let customScenes = load('customScenes', []);

const timer = new Timer(() => S);
const scenes = new SceneRenderer($('#scene-canvas'), $('#scene-img'));
const room = new Room({ verifyPeer: () => Promise.reject(new Error('not ready')), getToken: () => null });

const PHASE_NAMES = { focus: 'Focus', short: 'Short break', long: 'Long break', countdown: 'Countdown', stopwatch: 'Stopwatch' };
const TALLY = { dot: '●', tomato: '🍅', star: '★', heart: '♥' };
const nameOf = (m) => (m?.givenName || m?.name || 'Your friend').trim().split(/\s+/)[0];
/** "Ana", "Ana and Ben", "Ana, Ben and Cy" */
const listNames = (names) => (names.length < 2 ? names[0] || '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
const roomNames = () => (room.friends.length > 2 ? 'the room' : listNames(room.friends.map(nameOf)) || 'your friend');
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
const announceName = () => {}; // room names now come from the verified Google account
nameInput.addEventListener('input', () => {
  S.name = nameInput.value.replace(/\s+/g, ' ').trim().slice(0, 30);
  fitName(); persist(); announceName();
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
  if (room.connected) {
    for (const f of room.friends) {
      const fs = statuses.get(f.mid);
      if (fs) body.append(h('p', { class: 'note', style: { marginTop: '10px' }, text: `${nameOf(f)} has focused ${fmtDuration(fs.todayMin || 0)} today across ${fs.sessions || 0} ${fs.sessions === 1 ? 'session' : 'sessions'}.` }));
    }
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
    row('Sync timers by default', tog('roomSyncDefault'), 'When friends join your room'),
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
    h('p', { class: 'note', style: { marginTop: '14px' }, html: 'Shortcuts: <b>Space</b> start/pause · <b>R</b> reset · <b>N</b> skip · <b>1 2 3</b> modes · <b>T</b> tasks · <b>S</b> sounds · <b>M</b> music · <b>B</b> themes · <b>G</b> room · <b>V</b> mute · <b>D</b> deafen (in a call) · <b>F</b> full screen' }),
  );
}

/* ================= study room ================= */
let syncOn = false;
let negotiated = false;
const statuses = new Map(); // member id -> their latest status
let unread = 0;
const chatLog = [];
let myToken = null;   // our Google ID token for the current room (bound to it by nonce)
let pending = null;   // {code, secret} waiting for sign-in
let roomAllow = [];   // optional: only these Google accounts may join
let roomNonce = '';
let needReauth = false;
const MAX_LOCK = 5;

/* ---- voice ---- */
const volumes = load('voiceVolumes', {}); // Google sub -> 0…1
const volumeOf = (mid) => { const m = room.members.get(mid); const v = m && Object.hasOwn(volumes, m.sub) ? volumes[m.sub] : 1; return typeof v === 'number' && v >= 0 && v <= 1 ? v : 1; };
const voice = new Voice(room, { getVolume: volumeOf });
const saveVolumes = debounce(() => save('voiceVolumes', volumes), 400);

/* ---- strict validation of everything a friend sends ---- */
const PHASES = new Set(['focus', 'short', 'long', 'countdown', 'stopwatch']);
const TYPES = new Set(['pomodoro', 'countdown', 'stopwatch']);
const MODES = new Set(['home', 'focus', 'ambient']);
const REACTS = ['👋', '🔥', '💪', '☕', '🎉', '❤️'];
const MAX_MS = 24 * 3600e3;
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
// one budget per person, so one chatty friend can't use up everyone else's
const throttle = (ms) => { const last = new Map(); return (key = '') => { const n = Date.now(); if (n - (last.get(key) || 0) < ms) return false; last.set(key, n); return true; }; };
const allowReact = throttle(600), allowEvent = throttle(1500), allowChat = throttle(250), allowTimerToast = throttle(1200), allowScene = throttle(5000), allowLostToast = throttle(8000), allowVoiceToast = throttle(4000);

function cleanSnap(s) {
  if (!s || typeof s !== 'object' || !TYPES.has(s.type) || !PHASES.has(s.phase)) return null;
  if (s.type === 'pomodoro' ? !['focus', 'short', 'long'].includes(s.phase) : s.phase !== s.type) return null;
  const totalMs = num(s.totalMs, 0, MAX_MS), remainingMs = num(s.remainingMs, 0, MAX_MS), sw = num(s.swElapsedMs, 0, MAX_MS);
  if (totalMs == null || remainingMs == null || sw == null) return null;
  return { type: s.type, phase: s.phase, running: s.running === true, totalMs, remainingMs: Math.min(remainingMs, totalMs || remainingMs), swElapsedMs: sw, cycle: (num(s.cycle, 0, 12) ?? 0) | 0 };
}

function cleanStatus(m) {
  if (!TYPES.has(m.type) || !PHASES.has(m.phase)) return null;
  const totalMs = num(m.totalMs, 0, MAX_MS), value = num(m.value, 0, MAX_MS);
  if (totalMs == null || value == null) return null;
  return {
    mode: MODES.has(m.mode) ? m.mode : 'home', type: m.type, phase: m.phase, running: m.running === true, value, totalMs,
    task: str(m.task, 200), todayMin: num(m.todayMin, 0, 1440) ?? 0, sessions: (num(m.sessions, 0, 500) ?? 0) | 0, at: Date.now(),
  };
}

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
function sendStatus(to) { if (room.connected) room.send(statusPayload(), to); }
const sendStatusSoon = debounce(() => sendStatus(), 250);
setInterval(() => sendStatus(), 10000);

function setSync(on, { announce = true, snap, quiet } = {}) {
  syncOn = on;
  if (announce && room.connected) room.send({ t: 'sync', on, snap: on ? (snap || timer.snapshot()) : undefined, quiet: quiet || undefined });
  renderRoom();
}

/** the room's anchor settles timer sync: once with the first person in, then brings each newcomer up to date */
function negotiateSync(mid) {
  if (room.role !== 'host' || !room.members.has(mid)) return;
  if (negotiated) {
    room.send(syncOn ? { t: 'sync', on: true, snap: timer.snapshot() } : { t: 'sync', on: false, quiet: true }, mid);
    return;
  }
  const fs = statuses.get(mid);
  if (!fs) return; // wait for their first status
  negotiated = true;
  if (syncOn) { setSync(true); return; } // we just took over as anchor: keep the room as it was
  if (!S.roomSyncDefault) { setSync(false, { quiet: true }); return; }
  if (!timer.state.running && fs.running) {
    // they're mid-session and we're not: follow their timer
    syncOn = true;
    room.send({ t: 'sync', on: true, lead: mid });
    renderRoom();
  } else setSync(true);
}

function addChat(entry) {
  chatLog.push(entry);
  if (chatLog.length > 200) chatLog.shift();
  renderChat();
}

/* when timers are synced everyone finishes at once: collect those into one toast */
const doneBatch = [];
let doneT = null;
function friendFinished(name, minutes) {
  if (!doneBatch.includes(name)) doneBatch.push(name);
  clearTimeout(doneT);
  doneT = setTimeout(() => {
    toast(`🎉 ${listNames(doneBatch.splice(0))} finished a ${fmtDuration(minutes)} focus session`);
    floatEmoji('🎉', 3);
  }, 1500);
}

/* ---- Google sign-in, bound to one room ---- */
const tokenKey = (code) => `focusroom:token:${code}`;
function tokenFor(code, nonce) {
  let t = myToken;
  if (!t) { try { t = sessionStorage.getItem(tokenKey(code)); } catch { t = null; } }
  try { if (t && tokenTtl(t) > 60 && decodeJwt(t).payload.nonce === nonce) return t; } catch { /* bad token */ }
  return null;
}
const me = () => (myToken ? profileFromToken(myToken) : null);

room.getToken = () => (myToken && tokenTtl(myToken) > 30 ? myToken : null);
room.verifyPeer = (token) => verifyIdToken(token, { nonce: roomNonce, allow: roomAllow });

function onSignedIn(token) {
  try { if (decodeJwt(token).payload.nonce !== roomNonce) { toast('That sign-in was for a different room — please try again'); return; } } catch { return; }
  myToken = token;
  try { sessionStorage.setItem(tokenKey(pending?.code || room.code), token); } catch { /* private mode */ }
  if (pending) { const p = pending; pending = null; enterRoom(p.code, p.secret); }
  else if (needReauth) { needReauth = false; room.setToken(); }
  renderRoom();
}

async function mountSignIn(el) {
  if (!el) return;
  try { await renderSignIn(el, roomNonce, onSignedIn); } catch (e) {
    el.innerHTML = '';
    el.append(h('p', { class: 'note', text: e.message || 'Google sign-in couldn’t load. Check your connection and try again.' }));
  }
}

async function startRoom(code, secret) {
  if (!authConfigured()) { toast('Google sign-in isn’t set up yet, so rooms are off'); openPanel('room'); return; }
  voice.reset();
  room.leave(true);
  roomNonce = await sha256b64u(roomNonceInput(code, secret));
  const saved = load('lastRoom', null);
  roomAllow = saved && saved.code === code && Array.isArray(saved.allow) ? saved.allow.filter((e) => typeof e === 'string').slice(0, MAX_LOCK) : [];
  save('lastRoom', { code, secret, allow: roomAllow });
  setUrlInvite(code, secret);
  const t = tokenFor(code, roomNonce);
  if (t) { myToken = t; enterRoom(code, secret); return; }
  myToken = null;
  pending = { code, secret };
  if (openId !== 'room') openPanel('room');
  renderRoom();
}

function enterRoom(code, secret) {
  statuses.clear(); negotiated = false; syncOn = false; chatLog.length = 0; unread = 0; needReauth = false;
  room.join(code, secret);
  renderRoom(); renderChat();
}

function leaveRoom() {
  voice.reset();
  room.leave();
  pending = null; statuses.clear(); syncOn = false; needReauth = false;
  setUrlInvite('');
  renderRoom(); updateChip();
}

function signOutGoogle() {
  leaveRoom();
  myToken = null;
  try { Object.keys(sessionStorage).filter((k) => k.startsWith('focusroom:token:')).forEach((k) => sessionStorage.removeItem(k)); } catch { /* noop */ }
  signOut();
  toast('Signed out of Google on focusroom');
}

function inviteLink() {
  return `${location.origin}${location.pathname}#r=${room.code || pending?.code}.${room.secret || pending?.secret}`;
}

function setUrlInvite(code, secret) {
  const u = new URL(location.href);
  u.searchParams.delete('room'); // links from the old, unencrypted version
  u.hash = code ? `r=${code}.${secret}` : '';
  history.replaceState(null, '', u.pathname + u.search + u.hash);
}

/* ---- room events ---- */
let stateSince = Date.now();
function updateRoomHint() {
  const el = $('#room-hint');
  if (!el) return;
  const waiting = ['connecting', 'reconnecting', 'verifying'].includes(room.state);
  const blocked = waiting && room.linkFails >= 2;
  el.hidden = !(blocked || (waiting && Date.now() - stateSince > 15000));
  el.textContent = blocked
    ? 'Found the room, but this network won’t let your devices connect directly (common on Wi-Fi with “client isolation”, guest, office or campus networks). Try mobile data, or turn off a VPN or ad-blocker’s “WebRTC protection” for this site.'
    : 'Taking a while? A VPN (including Opera’s built-in one), an ad-blocker’s “WebRTC protection”, or a strict network can block rooms. Turn those off for this site, or try Edge or Chrome.';
}
room.on('linkfail', () => updateRoomHint());
room.on('state', (st) => {
  stateSince = Date.now();
  if (st !== 'connected') negotiated = false;
  renderRoom(); updateChip();
});
room.on('member', (m, first) => {
  if (first) {
    toast(`${nameOf(m)} joined · verified Google account 🔒`);
    addChat({ sys: `${m.name} joined` });
    floatEmoji('👋', 3);
  }
  sendStatus(m.mid);
  if (negotiated) negotiateSync(m.mid);
  renderRoom(); updateChip();
});
room.on('member-left', (m, reason) => {
  statuses.delete(m.mid);
  if (!room.members.size) negotiated = false;
  // we left, the room stopped, or we removed them ourselves: nothing to announce
  if (['left-room', 'stopped', 'denied', 'replaced'].includes(reason)) { renderRoom(); updateChip(); return; }
  if (reason === 'left') { toast(`${nameOf(m)} left the room`); addChat({ sys: `${m.name} left` }); }
  else if (allowLostToast()) toast(room.state === 'connected' ? `Lost connection to ${nameOf(m)}` : 'Lost the connection — reconnecting…');
  renderRoom(); updateChip();
});
room.on('need-token', () => {
  needReauth = true;
  toast('Your Google sign-in expired — sign in again to reconnect');
  promptSignIn(roomNonce, onSignedIn).catch(() => {});
  if (openId !== 'room') openPanel('room');
  renderRoom();
});
const REJECT_TEXT = {
  badkey: 'Blocked a connection that didn’t have your full invite link',
  'not-allowed': 'Blocked someone who isn’t on your room lock',
};
room.on('rejected', (reason) => {
  if (String(reason).startsWith('by-peer-')) { toast('The other person’s room settings didn’t let you in'); return; }
  toast(REJECT_TEXT[reason] || 'Blocked a connection that failed the Google sign-in check');
});

const TIMER_VERBS = { start: 'started', pause: 'paused', skip: 'skipped to the next session on', reset: 'reset', phase: 'switched', type: 'changed' };
room.on('message', (msg, from) => {
  if (!from) return;
  const who = nameOf(from);
  switch (msg.t) {
    case 'status': {
      const c = cleanStatus(msg);
      if (!c) return;
      const firstStatus = !statuses.has(from.mid);
      statuses.set(from.mid, c);
      if (firstStatus && !negotiated) negotiateSync(from.mid);
      updateFriendCard(); updateChip();
      break;
    }
    case 'sync': {
      if (typeof msg.on !== 'boolean') return;
      const snap = msg.snap === undefined ? null : cleanSnap(msg.snap);
      if (msg.snap !== undefined && !snap) return;
      const was = syncOn;
      syncOn = msg.on;
      if (snap && syncOn) timer.apply(snap, room.latency);
      if (msg.lead === room.mid && syncOn) room.send({ t: 'timer', snap: timer.snapshot(), action: 'sync' });
      const announce = (negotiated || room.role === 'guest') && !(msg.quiet && !syncOn) && was !== syncOn;
      if (announce) toast(syncOn ? `Timers synced with ${room.friends.length > 1 ? 'the room' : who}` : `${who} turned timer sync off`);
      negotiated = true;
      renderRoom();
      break;
    }
    case 'timer': {
      if (!syncOn) break;
      const snap = cleanSnap(msg.snap);
      if (!snap) break;
      timer.apply(snap, room.latency);
      if (TIMER_VERBS[msg.action] && Object.hasOwn(TIMER_VERBS, msg.action) && allowTimerToast()) toast(`${who} ${TIMER_VERBS[msg.action]} the timer`, { timeout: 2600 });
      break;
    }
    case 'chat': {
      const text = str(msg.text, 500).trim();
      if (!text || !allowChat(from.mid)) break;
      addChat({ who: 'them', name: who, mid: from.mid, text });
      if (!$('#panel-room').classList.contains('open')) {
        unread++;
        toast(`${who}: ${text.slice(0, 80)}`, { action: { label: 'Reply', fn: () => openPanel('room') } });
      }
      updateRoomDot();
      break;
    }
    case 'react':
      if (REACTS.includes(msg.emoji) && allowReact(from.mid)) { floatEmoji(msg.emoji, 6); toast(`${who} sent ${msg.emoji}`, { timeout: 2600 }); }
      break;
    case 'event':
      if (!allowEvent(from.mid)) break;
      if (msg.kind === 'complete') friendFinished(who, num(msg.minutes, 0, 600) ?? 0);
      if (msg.kind === 'task') toast(`✅ ${who} finished “${str(msg.text, 40)}”`);
      break;
    case 'scene': {
      if (!allowScene(from.mid)) break;
      const builtIn = typeof msg.id === 'string' ? [...CANVAS_SCENES, ...PHOTO_SCENES].find((s) => s.id === msg.id) : null;
      if (builtIn) { toast(`${who} shared the “${builtIn.name}” theme`, { action: { label: 'Use it', fn: () => setScene(builtIn.id) }, timeout: 8000 }); break; }
      const url = str(msg.url, 2048);
      if (/^https:\/\/[^\s"'()\\<>]+$/.test(url)) {
        let host = '';
        try { host = new URL(url).hostname; } catch { break; }
        toast(`${who} shared a background from ${host}`, {
          timeout: 8000,
          action: { label: 'Use it', fn: () => { const c = { id: `c${uid(6)}`, name: str(msg.name, 30) || 'Shared', url }; customScenes.push(c); save('customScenes', customScenes); renderThemeGrids(); setScene(c.id); } },
        });
      }
      break;
    }
    case 'voice': {
      const before = voice.remote.get(from.mid)?.on === true;
      voice.handle(msg, from);
      if (msg.on === true && !before && !voice.inCall && !voice.joining && allowVoiceToast(from.mid)) {
        toast(`🎙️ ${who} joined voice`, { action: { label: 'Join', fn: joinVoice }, timeout: 7000 });
      }
      break;
    }
    case 'rtc':
      voice.handle(msg, from);
      break;
  }
});

/* ---- voice events ---- */
const VOICE_ERR = {
  'mic-denied': 'Microphone blocked — allow it in the address bar, then try again',
  'mic-missing': 'No microphone found',
};
voice.on('error', (code, message) => toast(VOICE_ERR[code] || `Couldn’t start voice${message ? ` — ${message}` : ''}`, { timeout: 6000 }));
voice.on('change', () => { renderVoice(); updateFriendCard(); });
voice.on('speaking', (key, on) => {
  $$(`[data-voice="${key === 'me' ? 'me' : CSS.escape(key)}"]`).forEach((el) => el.classList.toggle('speaking', on));
});

function joinVoice() {
  if (!room.connected) { toast('Nobody else is in the room right now'); return; }
  if (!voiceSupported()) { toast('This browser can’t do voice calls'); return; }
  voice.join();
}

/* ---- room panel ---- */
function buildRoomPanel() {
  const p = $('#panel-room');
  const codeIn = h('input', { class: 'field', placeholder: 'Paste the invite link', id: 'room-code-in', autocomplete: 'off' });
  const doJoin = () => {
    const inv = parseInvite(codeIn.value);
    if (!inv) { toast('Paste the whole invite link — it contains the room’s secret key'); return; }
    codeIn.value = ''; startRoom(inv.code, inv.secret);
  };
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

  const idle = h('div', { id: 'room-idle' },
    h('div', { class: 'room-hero' },
      h('div', { class: 'emoji', text: '🫶' }),
      h('h4', { text: 'Study with friends' }),
      h('p', { class: 'note', text: `A private room for you and up to ${MAX_PEOPLE - 1} friends: run the same timer, hop on a voice call, see what everyone is working on, and cheer each other on.` })),
    h('ul', { class: 'sec-list' },
      h('li', { html: `${icon('check')}<span><b>Google sign-in</b> — everyone sees each other’s verified Google name and photo</span>` }),
      h('li', { html: `${icon('check')}<span><b>End-to-end encrypted</b> — the key lives only in your invite link</span>` }),
      h('li', { html: `${icon('check')}<span><b>Voice calls browser to browser</b> — no call server, nothing recorded or stored</span>` })),
    h('p', { class: 'note', id: 'room-noauth', hidden: true, text: 'Rooms are turned off until Google sign-in is configured for this site.' }),
    h('button', { class: 'btn solid', id: 'room-create', style: { width: '100%', marginTop: '6px', padding: '12px' }, html: `${icon('sparkles')}Create a room`, onclick: () => { const r = newRoom(); startRoom(r.code, r.secret); } }),
    h('h3', { text: 'Have an invite?' }),
    h('div', { class: 'row' }, codeIn, h('button', { class: 'btn', id: 'room-join', text: 'Join', onclick: doJoin })),
    h('button', { class: 'btn small', id: 'room-rejoin', style: { marginTop: '10px' }, hidden: true, onclick: () => { const l = load('lastRoom', null); if (l?.code && l?.secret) startRoom(l.code, l.secret); } }),
    h('p', { class: 'note', id: 'room-unsupported', hidden: true, text: 'Rooms need a recent browser (Chrome, Edge, Firefox or Safari).' }),
  );

  const signin = h('div', { id: 'room-signin', hidden: true },
    h('div', { class: 'room-hero' },
      h('div', { class: 'emoji', text: '🔐' }),
      h('h4', { text: 'Sign in to enter the room' }),
      h('p', { class: 'note', text: 'Everyone in the room will see your Google name, email address and profile photo — nothing else from your Google account. Your sign-in only works for this one room.' })),
    h('div', { class: 'gsi-slot', id: 'room-signin-btn' }),
    h('button', { class: 'btn small', style: { marginTop: '12px' }, text: 'Cancel', onclick: leaveRoom }),
  );

  const syncTog = h('span', { id: 'sync-toggle' });
  const chatIn = h('input', { class: 'field', placeholder: 'Say something nice…', maxlength: 500, id: 'chat-in' });
  const sendChat = () => {
    const t = chatIn.value.trim();
    if (!t) return;
    if (!room.send({ t: 'chat', text: t })) { toast('Nobody else is connected right now'); return; }
    addChat({ who: 'me', text: t });
    chatIn.value = '';
  };
  chatIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  const lockIn = h('input', { class: 'field', type: 'text', id: 'lock-in', placeholder: 'friend@gmail.com, other@gmail.com', autocomplete: 'off', style: { padding: '7px 10px' } });
  const applyLock = () => {
    const list = [...new Set(lockIn.value.split(/[\s,;]+/).map((v) => v.trim().toLowerCase()).filter(Boolean))];
    if (!list.length || list.some((v) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) { toast('Enter your friends’ Google email addresses, separated by commas'); return; }
    if (list.length > MAX_LOCK) { toast(`You can lock the room to at most ${MAX_LOCK} accounts`); return; }
    roomAllow = list;
    save('lastRoom', { ...load('lastRoom', {}), allow: roomAllow });
    lockIn.value = '';
    const out = room.friends.filter((f) => !roomAllow.includes(f.email));
    // remove whoever we verified ourselves and isn't on the list (the anchor enforces its own lock for everyone else)
    const mine = out.filter((f) => room.role === 'host' || f.mid === room.hostMid);
    mine.forEach((f) => room.kick('not-allowed', f.mid));
    if (mine.length) toast(`Room locked — removed ${listNames(mine.map(nameOf))}`);
    else toast(`Room locked to ${roomAllow.join(', ')}`);
    renderRoom();
  };
  lockIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyLock(); });

  const live = h('div', { id: 'room-live', hidden: true },
    h('div', { class: 'room-code' },
      h('span', { html: icon('link') }), h('code', { id: 'room-code-text' }),
      h('button', { class: 'btn small', html: `${icon('copy')}Copy invite`, id: 'room-copy', onclick: copyInvite })),
    h('div', { class: 'e2e-line', html: `${icon('check')}<span>End-to-end encrypted · only people with this exact link and a Google sign-in can join · up to ${MAX_PEOPLE} people</span>` }),
    h('div', { class: 'room-status', id: 'room-status' }, h('i', { class: 'pulse' }), h('span', { id: 'room-status-text' })),
    h('p', { class: 'note hint', id: 'room-hint', hidden: true, text: 'Taking a while? A VPN (including Opera’s built-in one), an ad-blocker’s “WebRTC protection”, or a strict network can block rooms. Turn those off for this site, or try Edge or Chrome.' }),
    h('div', { id: 'room-reauth', hidden: true },
      h('p', { class: 'note', text: 'Your Google sign-in expired. Sign in again to reconnect:' }),
      h('div', { class: 'gsi-slot', id: 'room-reauth-btn' })),
    h('div', { class: 'voice-box', id: 'voice-box' }),
    h('div', { id: 'friend-slot', class: 'friend-list' }),
    h('h3', { text: 'Who can join' }),
    h('div', { id: 'lock-state', class: 'note' }),
    h('div', { class: 'row', id: 'lock-form' }, lockIn, h('button', { class: 'btn small', text: 'Lock', onclick: applyLock })),
    h('div', { class: 'set-row', id: 'sync-row' }, h('label', {}, 'Sync our timers', h('span', { class: 'sub', text: 'Start, pause and skip together' })), syncTog),
    h('div', { class: 'reacts', id: 'reacts' }, ...REACTS.map((e) => h('button', {
      text: e, title: `Send ${e}`, onclick: () => {
        if (room.send({ t: 'react', emoji: e })) floatEmoji(e, 2); else toast('Nobody else is connected right now');
      },
    }))),
    h('div', { class: 'chat' },
      h('div', { class: 'chat-log', id: 'chat-log' }),
      h('div', { class: 'chat-form' }, chatIn, h('button', { class: 'icon-btn', html: icon('send'), title: 'Send', onclick: sendChat }))),
    h('div', { class: 'row between', style: { marginTop: '14px' } },
      h('button', {
        class: 'btn small', html: `${icon('image')}Share my theme`, onclick: () => {
          const def = allScenes().find((s) => s.id === S.scene);
          if (!room.connected) { toast('Nobody else is connected right now'); return; }
          if (def?.custom && def.url.startsWith('data:')) { toast('Uploaded photos stay on your device — share a built-in theme or an image link'); return; }
          room.send(def.custom ? { t: 'scene', url: def.url, name: def.name } : { t: 'scene', id: def.id });
          toast('Theme sent');
        },
      }),
      h('button', { class: 'btn small danger', html: `${icon('log-out')}Leave room`, onclick: leaveRoom })),
    h('div', { class: 'row between', id: 'me-line', style: { marginTop: '12px', fontSize: '13px', color: 'var(--muted)' } }),
  );

  const stopped = h('div', { id: 'room-stopped', hidden: true },
    h('div', { class: 'room-hero' }, h('div', { class: 'emoji', id: 'stopped-emoji' }), h('h4', { id: 'stopped-title' }), h('p', { class: 'note', id: 'stopped-text' })),
    h('button', { class: 'btn solid', style: { width: '100%' }, text: 'Back', onclick: leaveRoom }));

  p.append(panelHead('Study room'), idle, signin, live, stopped);
  renderRoom();
}

async function copyInvite() {
  const link = inviteLink();
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: 'Study with me on focusroom', text: 'Join my focus room (sign in with Google):', url: link }); return; } catch { /* fall through */ }
  }
  try { await navigator.clipboard.writeText(link); toast('Invite link copied — send it privately to your friends'); }
  catch { prompt('Copy this invite link and send it privately:', link); }
}

const STATUS_TEXT = {
  connecting: 'Opening the room…',
  waiting: 'Waiting for your friends — send them the invite link',
  verifying: 'Checking the invite key and Google sign-in…',
  reconnecting: 'Reconnecting…',
  error: 'Couldn’t connect',
};
const STOPPED = {
  full: ['🚪', 'This room is full', `Rooms fit ${MAX_PEOPLE} people. Ask your friends for a new link, or create your own room.`],
  badkey: ['🔑', 'Couldn’t verify this room', 'The invite link may be incomplete or out of date — or someone else is using this room code. Ask your friend for a fresh link.'],
  error: ['⚠️', 'Couldn’t open the room', ''],
};
const DENIED_TEXT = {
  'not-allowed': 'This room is locked to different Google accounts.',
  'wrong-room': 'Your Google sign-in didn’t match this room. Leave and try the invite link again.',
  'peer-not-allowed': 'You locked this room to different Google accounts than the person hosting it.',
  'old-version': 'Someone in the room is on a newer version of focusroom. Reload this page to update, then join again.',
  'peer-old-version': 'The person hosting the room is on an older version of focusroom. Ask them to reload the page.',
  duplicate: 'You joined this room from another tab, so this one was disconnected.',
};

function renderRoom() {
  if (!$('#room-idle')) { renderVoice(); return; }
  const st = room.state;
  const stopped = ['full', 'badkey', 'denied', 'error'].includes(st);
  const inRoom = !['idle', ...['full', 'badkey', 'denied', 'error']].includes(st);
  const signingIn = st === 'idle' && !!pending;
  $('#room-idle').hidden = st !== 'idle' || signingIn;
  $('#room-signin').hidden = !signingIn;
  $('#room-live').hidden = !inRoom;
  $('#room-stopped').hidden = !stopped;

  const configured = authConfigured();
  $('#room-noauth').hidden = configured;
  $('#room-create').disabled = !configured;
  $('#room-join').disabled = !configured;
  const last = load('lastRoom', null);
  $('#room-rejoin').hidden = !configured || !last?.code || !last?.secret || st !== 'idle';
  if (last?.code) $('#room-rejoin').textContent = `Rejoin last room (${last.code})`;
  $('#room-unsupported').hidden = roomSupported();

  if (signingIn) {
    const slot = $('#room-signin-btn');
    if (slot._nonce !== roomNonce) { slot._nonce = roomNonce; mountSignIn(slot); }
  }

  if (stopped) {
    let [emoji, title, text] = STOPPED[st] || ['🔒', 'You weren’t let in', ''];
    if (st === 'denied') {
      const d = String(room.stateDetail || '');
      text = DENIED_TEXT[d] || (d.startsWith('peer-') ? 'The other person’s Google sign-in couldn’t be verified, so you weren’t connected.' : 'The room host’s browser couldn’t verify your Google sign-in.');
    }
    if (st === 'error') text = room.stateDetail || 'Something went wrong. Try again in a moment.';
    $('#stopped-emoji').textContent = emoji; $('#stopped-title').textContent = title; $('#stopped-text').textContent = text;
  }

  if (inRoom) {
    $('#room-code-text').textContent = room.code;
    const status = $('#room-status');
    status.classList.toggle('ok', room.connected);
    $('#room-status-text').textContent = room.connected
      ? `Connected with ${listNames(room.friends.map((f) => f.name))} · verified & encrypted`
      : st === 'connected' ? STATUS_TEXT.waiting : STATUS_TEXT[st] || st;
    const reauth = $('#room-reauth');
    reauth.hidden = !needReauth;
    if (needReauth) { const slot = $('#room-reauth-btn'); if (slot._nonce !== roomNonce + needReauth) { slot._nonce = roomNonce + needReauth; mountSignIn(slot); } }
    const sync = $('#sync-toggle');
    sync.innerHTML = '';
    sync.append(toggleEl(syncOn, (v) => {
      if (!room.connected) { toast('Nobody else is connected right now'); renderRoom(); return; }
      setSync(v); toast(v ? `Timers synced with ${roomNames()}` : 'Timer sync off');
    }));
    $('#sync-row').style.opacity = room.connected ? 1 : 0.5;
    const lockState = $('#lock-state');
    lockState.innerHTML = '';
    if (roomAllow.length) {
      lockState.append(`🔒 Only ${roomAllow.join(', ')} can join through you. `, h('button', {
        class: 'btn small', text: 'Unlock', onclick: () => { roomAllow = []; save('lastRoom', { ...load('lastRoom', {}), allow: [] }); renderRoom(); toast('Room unlocked'); },
      }));
    } else {
      lockState.textContent = 'Anyone with this invite link who signs in with Google. ';
      const here = room.connected ? [...new Set(room.friends.map((f) => f.email).filter(Boolean))].slice(0, MAX_LOCK) : [];
      if (here.length) {
        lockState.append(h('button', {
          class: 'btn small', id: 'lock-friend', text: here.length === 1 ? `🔒 Lock to ${here[0]}` : `🔒 Lock to everyone here (${here.length})`,
          title: here.join(', '), onclick: () => {
            roomAllow = here;
            save('lastRoom', { ...load('lastRoom', {}), allow: roomAllow });
            toast(`Room locked to ${roomAllow.join(', ')} — nobody else can join through you, even with the link`);
            renderRoom();
          },
        }));
      } else lockState.append(`Lock it to up to ${MAX_LOCK} accounts:`);
    }
    $('#lock-form').hidden = roomAllow.length > 0 || !!(room.connected && room.friends.some((f) => f.email));
    const meLine = $('#me-line');
    meLine.innerHTML = '';
    const p = me();
    if (p) meLine.append(h('span', { text: `Signed in as ${p.email}` }), h('button', { class: 'btn small', text: 'Sign out', onclick: signOutGoogle }));
  }
  updateFriendCard();
  updateSyncBadge();
  updateRoomDot();
  renderVoice();
}

function avatarEl(f, cls) {
  const a = h('div', { class: `avatar ${cls}` });
  if (f.picture) a.append(h('img', { src: f.picture, alt: '', referrerpolicy: 'no-referrer', onerror: (e) => { e.target.remove(); a.textContent = (f.name || '?')[0].toUpperCase(); } }));
  else a.textContent = (f.name || '?').trim()[0]?.toUpperCase() || '?';
  return a;
}

/** avatar wrapped in a ring that lights up while that person talks */
function voiceAvatar(f, key, cls) {
  const w = h('div', { class: 'vav', 'data-voice': key }, avatarEl(f, cls));
  if (voice.speaking.get(key)) w.classList.add('speaking');
  return w;
}

function voiceBadge(mid) {
  const r = voice.remote.get(mid);
  if (!r?.on) return null;
  const ic = r.deaf ? 'headphone-off' : r.muted ? 'mic-off' : 'mic';
  const title = r.deaf ? 'In voice · deafened' : r.muted ? 'In voice · muted' : 'In voice';
  return h('span', { class: `vbadge${r.muted || r.deaf ? ' off' : ''}`, title, html: icon(ic) });
}

function updateFriendCard() {
  const slot = $('#friend-slot');
  if (!slot) return;
  if (!room.friends.length || ['idle', 'full', 'badkey', 'denied', 'error'].includes(room.state)) { slot.innerHTML = ''; slot._key = ''; return; }
  const friends = room.friends;
  const key = friends.map((f) => f.mid).join(',');
  if (slot._key !== key) {
    slot._key = key;
    slot.innerHTML = '';
    for (const f of friends) {
      slot.append(h('div', { class: 'friend-card', 'data-mid': f.mid },
        voiceAvatar(f, f.mid, 'lg'),
        h('div', { class: 'who' },
          h('div', { class: 'name' }, h('span', { class: 'nm' }), h('span', { class: 'verified', title: 'Verified Google account', html: icon('circle-check') }), h('span', { class: 'vslot' })),
          h('div', { class: 'email' }), h('div', { class: 'what' }), h('div', { class: 'task-line' }),
          h('div', { class: 'vol', hidden: true }, h('span', { html: icon('volume-2') }), h('input', { type: 'range', min: 0, max: 1, step: 0.05, title: 'Their volume (only for you)' }))),
        h('div', { class: 'ftime' })));
      const range = $('.vol input', slot.lastChild);
      range.value = volumeOf(f.mid);
      rangeFill(range);
      range.addEventListener('input', () => {
        const v = Number(range.value);
        volumes[f.sub] = v; saveVolumes(); voice.setVolume(f.mid, v); rangeFill(range);
      });
    }
  }
  for (const f of friends) {
    const el = slot.querySelector(`.friend-card[data-mid="${CSS.escape(f.mid)}"]`);
    if (!el) continue;
    const fs = statuses.get(f.mid);
    const [what, time] = friendActivity(fs);
    $('.nm', el).textContent = f.name;
    $('.email', el).textContent = f.email;
    $('.what', el).textContent = what;
    const tl = $('.task-line', el);
    tl.innerHTML = '';
    if (fs?.task) tl.append(h('em', { text: 'Working on ' }), fs.task);
    $('.ftime', el).textContent = time;
    const vs = $('.vslot', el);
    vs.innerHTML = '';
    const b = voiceBadge(f.mid);
    if (b) vs.append(b);
    if (voice.inCall && voice.remote.get(f.mid)?.on && voice.linkState(f.mid) !== 'connected') vs.append(h('span', { class: 'vlink', text: voice.linkState(f.mid) === 'failed' ? 'audio failed' : 'connecting audio…' }));
    $('.vol', el).hidden = !(voice.inCall && voice.remote.get(f.mid)?.on);
  }
}

/* ---- voice controls: in the room panel and a small call bar on screen ---- */
function voiceButtons() {
  return [
    h('button', { class: `vbtn${voice.muted ? ' off' : ''}`, title: `${voice.muted ? 'Unmute' : 'Mute'} (V)`, 'aria-pressed': String(voice.muted), html: icon(voice.muted ? 'mic-off' : 'mic'), onclick: () => voice.toggleMute() }),
    h('button', { class: `vbtn${voice.deaf ? ' off' : ''}`, title: `${voice.deaf ? 'Undeafen' : 'Deafen'} (D)`, 'aria-pressed': String(voice.deaf), html: icon(voice.deaf ? 'headphone-off' : 'headphones'), onclick: () => voice.toggleDeaf() }),
    h('button', { class: 'vbtn hang', title: 'Leave voice', html: icon('phone-off'), onclick: () => voice.leave() }),
  ];
}

function inVoiceAvatars(size) {
  const list = [];
  if (voice.inCall) { const p = me(); if (p) list.push(voiceAvatar({ name: p.name || S.name || 'You', picture: p.picture }, 'me', size)); }
  for (const mid of voice.others) { const f = room.members.get(mid); if (f) list.push(voiceAvatar(f, mid, size)); }
  return list;
}

function renderVoice() {
  const inRoom = room.connected;
  const others = voice.others;

  const box = $('#voice-box');
  if (box) {
    box.innerHTML = '';
    box.hidden = !inRoom && !voice.inCall;
    if (!box.hidden) {
      if (voice.inCall) {
        box.append(
          h('div', { class: 'vhead' }, h('span', { class: 'vlive' }), h('b', { text: 'Voice' }), h('span', { class: 'muted', text: others.length ? ` · ${listNames(others.map((m) => nameOf(room.members.get(m))))}` : ' · waiting for others to join' })),
          h('div', { class: 'vrow' }, h('div', { class: 'vavs' }, ...inVoiceAvatars('sm')), h('div', { class: 'vctl' }, ...voiceButtons())),
          h('p', { class: 'note', text: 'Tip: wear headphones so others don’t hear an echo. V mutes, D deafens.' }));
      } else {
        box.append(
          h('div', { class: 'vrow' },
            h('div', {}, h('b', { text: others.length ? `${others.length} in voice` : 'Voice call' }),
              h('div', { class: 'muted', text: others.length ? listNames(others.map((m) => nameOf(room.members.get(m)))) : 'Talk while you study — browser to browser, encrypted' })),
            h('button', { class: 'btn solid small', html: `${icon('phone')}${voice.joining ? 'Joining…' : 'Join voice'}`, disabled: voice.joining || !voiceSupported(), onclick: joinVoice })));
      }
    }
  }

  const bar = $('#call-bar');
  if (!bar) return;
  const show = voice.inCall || (inRoom && others.length > 0);
  bar.hidden = !show;
  bar.innerHTML = '';
  if (!show) return;
  if (voice.inCall) bar.append(h('div', { class: 'vavs' }, ...inVoiceAvatars('sm')), ...voiceButtons());
  else bar.append(h('div', { class: 'vavs' }, ...inVoiceAvatars('sm')), h('button', { class: 'btn solid small', html: `${icon('phone')}${voice.joining ? 'Joining…' : 'Join voice'}`, disabled: voice.joining, onclick: joinVoice }));
}

function updateChip() {
  const chip = $('#friend-chip');
  const st = room.state;
  if (['idle', 'full', 'badkey', 'denied', 'error'].includes(st)) { chip.hidden = true; chip._key = null; return; }
  chip.hidden = false;
  const friends = room.friends;
  if (room.connected) {
    const key = friends.map((f) => f.mid).join(',');
    if (chip._key !== key) {
      chip._key = key;
      chip.innerHTML = '';
      chip.append(h('span', { class: 'stack' }, ...friends.map((f) => avatarEl(f, 'sm'))), h('span', { class: 'live' }), h('span', { class: 't' }));
    }
    const t = $('.t', chip);
    t.innerHTML = '';
    if (friends.length === 1) {
      const [what, time] = friendActivity(statuses.get(friends[0].mid));
      t.append(h('b', { text: nameOf(friends[0]) }), h('span', { class: 'muted', text: ` · ${what}${time ? ` ${time}` : ''}` }));
    } else {
      const focusing = friends.filter((f) => { const s = statuses.get(f.mid); return s?.running && (s.phase === 'focus' || s.type !== 'pomodoro'); }).length;
      t.append(h('b', { text: listNames(friends.map(nameOf)) }), h('span', { class: 'muted', text: focusing ? ` · ${focusing} focusing` : '' }));
    }
  } else {
    chip._key = null;
    chip.innerHTML = '';
    chip.append(h('span', { html: icon('users'), style: { display: 'grid', placeItems: 'center', width: '28px' } }),
      h('span', { class: 'muted', text: st === 'waiting' || st === 'connected' ? 'Room open · waiting for friends' : st === 'verifying' ? 'Verifying…' : st === 'reconnecting' ? 'Reconnecting to the room…' : 'Opening room…' }));
  }
}
$('#friend-chip').addEventListener('click', () => openPanel('room'));

function updateSyncBadge() {
  const b = $('#sync-badge');
  const show = syncOn && room.connected;
  b.hidden = !show;
  if (show) { b.innerHTML = icon('refresh-cw'); b.append(h('span', { text: `Timer synced with ${roomNames()}` })); }
}

function updateRoomDot() {
  const dot = $('#room-dot');
  const active = !['idle', 'full', 'badkey', 'denied', 'error'].includes(room.state);
  dot.hidden = !active && !unread;
  dot.classList.toggle('unread', unread > 0);
}

function renderChat() {
  const log = $('#chat-log');
  if (!log) return;
  log.innerHTML = '';
  if (!chatLog.length) log.append(h('div', { class: 'sys', text: 'Messages are end-to-end encrypted and disappear when you leave.' }));
  const names = chatNamesOn();
  let prev = null;
  for (const m of chatLog) {
    if (m.sys) { log.append(h('div', { class: 'sys', text: m.sys })); prev = null; continue; }
    const el = h('div', { class: `msg ${m.who}` });
    // in a group, label who said what (once per run of messages)
    if (m.who === 'them' && names && prev !== m.mid) el.append(h('span', { class: 'from', text: m.name }));
    el.append(document.createTextNode(m.text));
    log.append(el);
    prev = m.who === 'them' ? m.mid : 'me';
  }
  log.scrollTop = log.scrollHeight;
}
const chatNamesOn = () => new Set(chatLog.filter((m) => m.who === 'them').map((m) => m.mid)).size > 1 || room.friends.length > 1;

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
  if (e.target.closest('.panel, #dock, #toasts, #friend-chip, #call-bar, #focus-task, .mode-switch')) return;
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
    ...(voice.inCall ? { v: () => voice.toggleMute(), d: () => voice.toggleDeaf() } : {}),
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
    if (room.state !== 'idle') { updateChip(); updateFriendCard(); updateRoomHint(); }
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

// open an invite link (#r=code.secret) straight into the room
function bootRoom() {
  if (new URLSearchParams(location.search).has('room')) {
    setUrlInvite('');
    toast('That invite is from an older version of focusroom — ask your friend for a new link', { timeout: 8000 });
    return;
  }
  const inv = parseInvite(location.hash);
  if (inv) startRoom(inv.code, inv.secret);
}
bootRoom();
addEventListener('hashchange', () => {
  const inv = parseInvite(location.hash);
  if (inv && inv.code !== room.code && inv.code !== pending?.code) startRoom(inv.code, inv.secret);
});

// debugging handle (local development only)
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  window.focusroom = { timer, room, sound, S, get syncOn() { return syncOn; }, voice, statuses, get myToken() { return myToken; }, DEFAULT_SETTINGS };
}
