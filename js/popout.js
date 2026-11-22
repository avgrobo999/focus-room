/**
 * The timer in a small always-on-top window (Document Picture-in-Picture, Chrome/Edge desktop),
 * so it stays in view after you switch tabs or minimise the browser.
 *
 * It opens from a click, or by itself when you switch to another tab, if Chrome allows it:
 * during a voice call, or when "Automatic picture-in-picture" is allowed in the site settings.
 */
import { icon } from './icons.js?v=20261121b';

export const popoutSupported = () => 'documentPictureInPicture' in window && window.isSecureContext;

const CSS = `
*{box-sizing:border-box;margin:0}
html,body{height:100%}
body{display:grid;place-items:center;overflow:hidden;color:#fff;background:#1c1433 center/cover no-repeat;
  font:500 16px/1.2 'Outfit',system-ui,sans-serif;user-select:none;-webkit-user-select:none}
body::before{content:'';position:fixed;inset:0;background:rgba(14,10,28,.5)}
main{position:relative;display:flex;flex-direction:column;align-items:center;gap:min(2.2vh,10px);padding:8px;max-width:100%;text-align:center}
.phase{font-size:clamp(11px,min(5vw,8vh),20px);color:rgba(255,255,255,.82);letter-spacing:.02em}
.time{font-weight:650;line-height:.95;letter-spacing:-.035em;font-variant-numeric:tabular-nums;
  font-size:clamp(24px,min(24vw,40vh),220px);text-shadow:0 4px 30px rgba(0,0,0,.35)}
.eta{font-size:clamp(10px,min(3.6vw,6vh),17px);color:rgba(255,255,255,.8);font-variant-numeric:tabular-nums;min-height:1.2em}
.row{display:flex;align-items:center;gap:min(3vw,12px)}
button{font:inherit;color:inherit;border:0;cursor:pointer;display:grid;place-items:center}
.rnd{width:clamp(28px,min(11vw,17vh),46px);aspect-ratio:1;border-radius:50%;background:rgba(255,255,255,.14)}
.rnd:hover{background:rgba(255,255,255,.24)}
.rnd .ic{width:48%;height:48%}
.go{height:clamp(28px,min(11vw,17vh),46px);padding:0 1.3em;border-radius:999px;background:#fff;color:#1a1530;font-weight:600;
  font-size:clamp(12px,min(4.4vw,7vh),18px)}
[hidden]{display:none!important}
.task{max-width:92vw;font-size:clamp(10px,min(3.6vw,6vh),15px);color:rgba(255,255,255,.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (max-height:150px){.task,.eta{display:none}}
@media (max-height:110px){.phase,.row{display:none}.time{font-size:min(26vw,70vh)}}
`;

export class Popout {
  /** actions: {toggle, reset, skip} */
  constructor(actions) {
    this.actions = actions;
    this.win = null;
    this.els = null;
    this.last = {};
    this.opening = null;
  }

  get open() { return !!this.win && !this.win.closed; }
  get doc() { return this.open && this.els ? this.win.document : null; }

  async show() {
    if (this.open) { this.win.focus?.(); return true; }
    if (!popoutSupported()) return false;
    if (this.opening) return this.opening;
    this.opening = (async () => {
      try {
        const win = await documentPictureInPicture.requestWindow({ width: 300, height: 220 });
        this._build(win);
        return true;
      } catch (e) {
        console.warn('pop-out failed', e);
        return false;
      } finally { this.opening = null; }
    })();
    return this.opening;
  }

  close() { if (this.open) this.win.close(); }

  _build(win) {
    const d = win.document;
    d.title = 'focusroom timer';
    const font = d.createElement('link');
    font.rel = 'stylesheet';
    font.href = new URL('fonts/fonts.css', location.href).href;
    const style = d.createElement('style');
    style.textContent = CSS;
    d.head.append(font, style);

    const el = (tag, cls, html = '') => { const e = d.createElement(tag); if (cls) e.className = cls; e.innerHTML = html; return e; };
    const main = el('main');
    const phase = el('div', 'phase');
    const time = el('div', 'time');
    const eta = el('div', 'eta');
    const reset = el('button', 'rnd', icon('rotate-ccw'));
    const toggle = el('button', 'go');
    const skip = el('button', 'rnd', icon('skip-forward'));
    const task = el('div', 'task');
    const row = el('div', 'row');
    row.append(reset, toggle, skip);
    main.append(phase, time, eta, row, task);
    d.body.append(main);

    reset.onclick = () => this.actions.reset();
    toggle.onclick = () => this.actions.toggle();
    skip.onclick = () => this.actions.skip();
    win.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); this.actions.toggle(); }
      else if (k === 'r') this.actions.reset();
      else if (k === 'n') this.actions.skip();
    });
    win.addEventListener('pagehide', () => { if (this.win === win) { this.win = null; this.els = null; } });

    this.win = win;
    this.els = { body: d.body, phase, time, eta, reset, toggle, skip, task };
    this.last = {};
  }

  /** s: {phase, time, eta, toggleLabel, resetTitle, showSkip, task, bg} */
  render(s) {
    if (!this.open || !this.els) return;
    const e = this.els;
    const set = (k, v, fn) => { if (this.last[k] !== v) { this.last[k] = v; fn(v); } };
    set('phase', s.phase, (v) => { e.phase.textContent = v; });
    set('time', s.time, (v) => { e.time.textContent = v; });
    set('eta', s.eta, (v) => { e.eta.textContent = v; });
    set('toggle', s.toggleLabel, (v) => { e.toggle.textContent = v; });
    set('reset', s.resetTitle, (v) => { e.reset.title = v; });
    set('skip', s.showSkip, (v) => { e.skip.hidden = !v; });
    set('task', s.task, (v) => { e.task.textContent = v; e.task.hidden = !v; });
    set('bg', s.bg, (v) => { e.body.style.backgroundImage = v || 'none'; });
  }
}
