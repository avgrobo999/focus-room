/**
 * Your buddy: a little girl who runs in when a focus session ends to blow you a kiss, give you
 * a hug or wink at you (picked at random), and brings you a glass of water every 15–20 minutes.
 * Snooze the water and she's sad; tick it off and she jumps for joy.
 *
 * She shows on the page, where you can drag her anywhere, and in the pop-out timer when it's open
 * (so you still see her while the pop-out sits on top of your other apps).
 */
import { h, pick, rand, clamp, dayKey } from './util.js?v=20261121b';
import { load, save } from './store.js?v=20261121b';

const MIN = 60000;
const SNOOZE_MIN = 5;
const IGNORE_MS = 150000; // left unanswered this long, she gives up for now
const nextWaterIn = () => rand(15, 20) * MIN;

const CHEERS = {
  kiss: ['Mwah! Great focus 😘', 'Sending you a kiss for that one 😘', 'So proud of you! 😘'],
  hug: ['Big hug! You did it 🤗', 'Come here, you earned a hug 🤗', 'Hug time! Well done 🤗'],
  wink: ['Nailed it 😉', 'Another one done 😉', 'Look at you go 😉'],
};
const ASKS = ['Time for a sip of water 💧', 'I brought you some water 💧', 'Water break! Have a few sips 💧'];
const HEARTS = ['💖', '💗', '💕', '❤️', '💞'];

// 120 × 172, feet on the ground at y≈162
const SVG = `<svg class="bd-svg f-smile p-rest" viewBox="0 0 120 172" aria-hidden="true">
<ellipse class="shadow" cx="60" cy="165" rx="22" ry="4.2" fill="rgba(0,0,0,.22)"/>
<g class="bob">
  <g class="legL"><path d="M54 122V156" stroke="#ffd2ba" stroke-width="6.5" stroke-linecap="round"/><path d="M54 150V154" stroke="#fff" stroke-width="6.6"/><ellipse cx="52.5" cy="158.5" rx="6.4" ry="3.8" fill="#7b55d9"/></g>
  <g class="legR"><path d="M66 122V156" stroke="#ffd2ba" stroke-width="6.5" stroke-linecap="round"/><path d="M66 150V154" stroke="#fff" stroke-width="6.6"/><ellipse cx="67.5" cy="158.5" rx="6.4" ry="3.8" fill="#7b55d9"/></g>
  <path d="M47 86Q60 80 73 86L85 125Q60 134 35 125Z" fill="#ff6f9f"/>
  <path d="M38.5 117Q60 125 81.5 117L85 125Q60 134 35 125Z" fill="#ff8fb4"/>
  <path d="M60 110c-3.6-2.6-6-4.4-6-6.8a3 3 0 0 1 6-.9a3 3 0 0 1 6 .9c0 2.4-2.4 4.2-6 6.8z" fill="#fff" opacity=".9"/>
  <rect x="56.5" y="76" width="7" height="8" fill="#ffd2ba"/>
  <path d="M51 84.5Q55.5 91 60 86.5Q64.5 91 69 84.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
  <g class="head">
    <ellipse cx="25.5" cy="64" rx="9.5" ry="14" fill="#5a3726" transform="rotate(14 25.5 64)"/>
    <ellipse cx="94.5" cy="64" rx="9.5" ry="14" fill="#5a3726" transform="rotate(-14 94.5 64)"/>
    <circle cx="33" cy="51" r="4.2" fill="#ff6f9f"/><circle cx="87" cy="51" r="4.2" fill="#ff6f9f"/>
    <circle cx="60" cy="50" r="30" fill="#5a3726"/>
    <circle cx="60" cy="55" r="26" fill="#ffdcc6"/>
    <path d="M33.5 54Q32 25 60 23.5Q88 25 86.5 54Q83 41 74 38Q69 45 61 40.5Q55 46.5 47 40.5Q38.5 43 33.5 54Z" fill="#5a3726"/>
    <path d="M77 27l-9-6v12zM77 27l9-6v12z" fill="#ff6f9f"/><circle cx="77" cy="27" r="2.8" fill="#ff4f88"/>
    <g fill="#2b1d3a">
      <g class="eye eyeL"><ellipse cx="50" cy="59" rx="3.4" ry="4.4"/><circle cx="51.3" cy="57.3" r="1.3" fill="#fff"/></g>
      <g class="eye eyeR"><ellipse cx="70" cy="59" rx="3.4" ry="4.4"/><circle cx="71.3" cy="57.3" r="1.3" fill="#fff"/></g>
    </g>
    <g fill="none" stroke="#2b1d3a" stroke-width="2.4" stroke-linecap="round">
      <path class="arcL" d="M46 60Q50 54.5 54 60"/><path class="arcR" d="M66 60Q70 54.5 74 60"/>
      <path class="brows" d="M45 51.5L54 48.5M66 48.5L75 51.5" stroke="#5a3726" stroke-width="2"/>
    </g>
    <ellipse cx="43" cy="67" rx="4.6" ry="2.7" fill="#ff9fb8" opacity=".75"/><ellipse cx="77" cy="67" rx="4.6" ry="2.7" fill="#ff9fb8" opacity=".75"/>
    <path class="m-smile" d="M54.5 67.5Q60 73 65.5 67.5" fill="none" stroke="#c23b62" stroke-width="2.2" stroke-linecap="round"/>
    <path class="m-open" d="M53.5 66.5Q60 77.5 66.5 66.5Z" fill="#c23b62"/>
    <path class="m-kiss" d="M59 65.5q4.2 1.7 0 3.4q4.2 1.7 0 3.4" fill="none" stroke="#c23b62" stroke-width="2.1" stroke-linecap="round"/>
    <path class="m-sad" d="M55 72Q60 67 65 72" fill="none" stroke="#c23b62" stroke-width="2.2" stroke-linecap="round"/>
    <path class="tear" d="M73.5 63.5q-2.6 4.2 0 5.6q2.6-1.4 0-5.6z" fill="#8fd3ff"/>
  </g>
  <g class="armL"><path d="M48 90V113" stroke="#e8a588" stroke-width="8.4" stroke-linecap="round"/><path d="M48 90V113" stroke="#ffd2ba" stroke-width="6.2" stroke-linecap="round"/><circle cx="48" cy="115" r="4.1" fill="#ffd2ba" stroke="#e8a588" stroke-width="1.1"/><circle cx="48" cy="90" r="6.4" fill="#ff6f9f"/></g>
  <g class="armR"><g class="wv">
    <path d="M72 90V113" stroke="#e8a588" stroke-width="8.4" stroke-linecap="round"/><path d="M72 90V113" stroke="#ffd2ba" stroke-width="6.2" stroke-linecap="round"/>
    <g class="cup"><path d="M65.5 101.5H78.5L76.8 121H67.2Z" fill="rgba(215,240,255,.5)" stroke="#fff" stroke-width="1.1"/><path d="M66.2 108.5H77.8L76.8 121H67.2Z" fill="#62bff8"/><path d="M68 104V118" stroke="#fff" stroke-width="1.2" opacity=".7" stroke-linecap="round"/></g>
    <circle cx="72" cy="115" r="4.1" fill="#ffd2ba" stroke="#e8a588" stroke-width="1.1"/><circle cx="72" cy="90" r="6.4" fill="#ff6f9f"/>
  </g></g>
</g>
</svg>`;

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

const CSS = `
.bd{position:fixed;z-index:9;left:0;top:0;transform:translate(-50%,-100%);pointer-events:none;
  --h:clamp(110px,21vh,190px);font:500 14px/1.35 'Outfit',system-ui,sans-serif;color:#2a1d3f}
.bd.gone{visibility:hidden}
.bd-move{position:relative;width:calc(var(--h) * .6977);height:var(--h);transition:transform 1.1s linear}
.bd.away .bd-move{transform:translateX(var(--off,120vw))}
.bd.m-walk .bd-move{transition-duration:2.1s}
.bd.notrans .bd-move,.bd.notrans .bd-girl{transition:none}
.bd-girl{position:absolute;inset:0;pointer-events:auto;cursor:grab;touch-action:none;transform-origin:50% 96%;
  transition:transform .45s cubic-bezier(.3,1.5,.5,1)}
.bd.m-in .bd-girl{transform:rotate(calc(var(--sgn,1) * -8deg))}
.bd.m-out .bd-girl{transform:rotate(calc(var(--sgn,1) * 8deg))}
.bd.m-walk .bd-girl{transform:rotate(calc(var(--sgn,1) * 3deg))}
.bd-girl.big{transform:scale(1.28)}
.bd.dragging .bd-girl{cursor:grabbing;transform:rotate(-5deg) translateY(-8px);transition:transform .2s}
.bd.land .bd-girl{animation:bdLand .45s cubic-bezier(.3,1.6,.5,1)}
.bd-svg{width:100%;height:100%;display:block;overflow:visible;filter:drop-shadow(0 8px 16px rgba(0,0,0,.25))}
.bd.flip .bd-svg{transform:scaleX(-1)}
.bd.dragging .shadow{opacity:0}
.bd-fx{position:absolute;inset:0;pointer-events:none}

.bd-say{position:absolute;bottom:60%;left:calc(100% - 4px);width:max-content;max-width:var(--sayw,240px);padding:10px 14px;
  border-radius:16px 16px 16px 4px;background:#fff;color:#2a1d3f;box-shadow:0 10px 30px rgba(0,0,0,.28);pointer-events:auto;
  animation:bdPop .35s cubic-bezier(.3,1.5,.5,1);text-align:left}
.bd.say-l .bd-say{left:auto;right:calc(100% - 4px);border-radius:16px 16px 4px 16px}
.bd.say-low .bd-say{bottom:auto;top:12%}
.bd-say[hidden]{display:none}
.bd-say p{margin:0}
.bd-btns{display:flex;gap:7px;margin-top:9px;flex-wrap:wrap}
.bd-btns button{font:inherit;font-weight:600;font-size:13px;border:0;border-radius:999px;padding:7px 12px;cursor:pointer;
  display:inline-flex;align-items:center;gap:5px;line-height:1.1}
.bd-btns svg{width:15px;height:15px}
.bd-yes{background:#22b466;color:#fff}
.bd-yes:hover{background:#1c9e59}
.bd-no{background:#efe9f7;color:#4a3d63}
.bd-no:hover{background:#e3daf2}

.bd.pip{inset:0;transform:none;--h:min(80vh,58vw)}
.bd.pip::before{content:'';position:absolute;inset:0;background:rgba(14,10,28,.6);transition:opacity .4s}
.bd.pip.gone::before{opacity:0}
.bd.pip .bd-move{position:absolute;left:3%;bottom:3%}
.bd.pip.away .bd-move{transform:translateX(105vw)}
.bd.pip .bd-say{bottom:34%;width:calc(92vw - var(--h) * .7);max-width:none;padding:8px 10px;font-size:clamp(11px,4.6vw,15px)}
.bd.pip .bd-btns{margin-top:6px;gap:5px}
.bd.pip .bd-btns button{font-size:clamp(10px,4vw,13px);padding:5px 9px}

.bd-svg *{transform-box:view-box}
.bd-svg .armL{transform-origin:48px 90px;transform:rotate(var(--l,12deg));transition:transform .45s cubic-bezier(.4,1.35,.5,1)}
.bd-svg .armR{transform-origin:72px 90px;transform:rotate(var(--r,-12deg));transition:transform .45s cubic-bezier(.4,1.35,.5,1)}
.bd-svg .wv{transform-origin:72px 90px}
.bd-svg .cup{display:none;transform-origin:72px 115px;transform:rotate(calc(var(--r,-12deg) * -1));transition:transform .45s cubic-bezier(.4,1.35,.5,1)}
.bd-svg.cup .cup{display:inline}
.bd-svg .legL{transform-origin:54px 124px}
.bd-svg .legR{transform-origin:66px 124px}
.bd-svg .head{transform-origin:60px 82px;transition:transform .5s ease}
.bd-svg .bob{transform-origin:60px 162px}
.bd-svg .shadow{transform-origin:60px 165px;transition:opacity .2s}
.bd-svg .eye{transform-box:fill-box;transform-origin:center;animation:bdBlink 4.4s infinite}
.bd-svg .arcL,.bd-svg .arcR,.bd-svg .brows,.bd-svg .m-open,.bd-svg .m-kiss,.bd-svg .m-sad,.bd-svg .tear{display:none}
.f-happy .eyeL,.f-happy .eyeR,.f-kiss .eyeL,.f-kiss .eyeR,.f-wink .eyeR{display:none}
.f-happy .arcL,.f-happy .arcR,.f-kiss .arcL,.f-kiss .arcR,.f-wink .arcR{display:inline}
.f-open .m-smile,.f-happy .m-smile,.f-kiss .m-smile,.f-sad .m-smile{display:none}
.f-open .m-open,.f-happy .m-open,.f-kiss .m-kiss,.f-sad .m-sad,.f-sad .brows,.f-sad .tear{display:inline}
.f-sad .head{transform:rotate(-7deg)}
.bd-svg .tear{animation:bdTear 1.5s ease-in infinite}

.p-kiss1{--r:170deg}
.p-kiss2{--r:235deg}
.p-open{--l:112deg;--r:-112deg}
.p-hug{--l:-58deg;--r:58deg}
.p-wave{--r:232deg}
.p-wave .wv{animation:bdWave .42s ease-in-out infinite alternate}
.p-water{--r:-72deg}
.p-cheer{--l:158deg;--r:-162deg}
.p-droop{--l:4deg;--r:-24deg}
.held{--l:150deg;--r:-150deg}
.held.cup{--r:-80deg}

.run .legL{animation:bdLeg .3s ease-in-out infinite alternate}
.run .legR{animation:bdLeg .3s ease-in-out infinite alternate-reverse}
.run .armL{animation:bdArm .3s ease-in-out infinite alternate-reverse}
.run:not(.cup) .armR{animation:bdArm .3s ease-in-out infinite alternate}
.run .bob{animation:bdBob .15s ease-in-out infinite alternate}
.walk .legL{animation:bdStep .52s ease-in-out infinite alternate}
.walk .legR{animation:bdStep .52s ease-in-out infinite alternate-reverse}
.walk .bob{animation:bdBob .26s ease-in-out infinite alternate}
.jump .bob{animation:bdJump .55s cubic-bezier(.3,.7,.4,1) infinite}
.jump .shadow{animation:bdShadow .55s cubic-bezier(.3,.7,.4,1) infinite}
.held .legL{animation:bdDangle .5s ease-in-out infinite alternate}
.held .legR{animation:bdDangle .5s ease-in-out infinite alternate-reverse}

.bd-fx span{position:absolute;line-height:1;font-size:calc(var(--h) * .14);transform:translate(-50%,-50%);opacity:0;
  animation:bdHeart 2.2s ease-out forwards}
.bd-fx .kiss{font-size:calc(var(--h) * .16);animation:bdKiss 1.8s cubic-bezier(.2,.6,.3,1) forwards}
.bd-fx .spark{font-size:calc(var(--h) * .12);animation:bdSpark .8s ease-out 3 forwards}

@keyframes bdLeg{from{transform:rotate(-30deg)}to{transform:rotate(30deg)}}
@keyframes bdStep{from{transform:rotate(-14deg)}to{transform:rotate(14deg)}}
@keyframes bdArm{from{transform:rotate(-40deg)}to{transform:rotate(40deg)}}
@keyframes bdBob{to{transform:translateY(-4px)}}
@keyframes bdWave{from{transform:rotate(-18deg)}to{transform:rotate(18deg)}}
@keyframes bdJump{0%,100%{transform:translateY(0) scale(1.04,.95)}45%{transform:translateY(-24px) scale(.97,1.04)}}
@keyframes bdShadow{0%,100%{transform:scale(1)}45%{transform:scale(.6);opacity:.5}}
@keyframes bdDangle{from{transform:rotate(-14deg)}to{transform:rotate(14deg)}}
@keyframes bdBlink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes bdTear{0%{transform:translateY(0);opacity:0}20%{opacity:1}100%{transform:translateY(12px);opacity:0}}
@keyframes bdLand{0%{transform:scale(1.08,.9)}60%{transform:scale(.97,1.04)}100%{transform:none}}
@keyframes bdPop{from{opacity:0;transform:scale(.85)}}
@keyframes bdHeart{0%{opacity:0;transform:translate(-50%,-50%) scale(.3)}15%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}
  100%{opacity:0;transform:translate(calc(-50% + var(--dx,0px)),calc(-50% - var(--dy,120px))) scale(.8)}}
@keyframes bdKiss{0%{opacity:0;transform:translate(-50%,-50%) scale(.3)}15%{opacity:1}
  100%{opacity:0;transform:translate(calc(-50% + var(--dx,0px)),calc(-50% - 90px)) scale(4.5)}}
@keyframes bdSpark{0%{opacity:0;transform:translate(-50%,-50%) scale(.2) rotate(0)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.2) rotate(20deg)}100%{opacity:0;transform:translate(-50%,-50%) scale(.4) rotate(40deg)}}

@media (prefers-reduced-motion:reduce){
  .bd-move{transition:opacity .4s!important}
  .bd.away .bd-move{transform:none;opacity:0}
  .bd-girl{transition:none!important}
  .bd-svg *{animation:none!important;transition:none!important}
}
`;

function injectCss(doc) {
  if (doc.getElementById('bd-css')) return;
  const s = doc.createElement('style');
  s.id = 'bd-css';
  s.textContent = CSS;
  doc.head.append(s);
}

/** One drawing of her: on the page, or in the pop-out window. */
class Actor {
  constructor(buddy, doc, pip) {
    this.buddy = buddy;
    this.doc = doc;
    this.pip = pip;
    this.held = false;
    injectCss(doc);
    this.girl = h('div', { class: 'bd-girl', html: SVG, title: pip ? null : 'Drag me anywhere' });
    this.svg = this.girl.firstElementChild;
    this.fx = h('div', { class: 'bd-fx' });
    this.say = h('div', { class: 'bd-say', hidden: true });
    this.root = h('div', { class: `bd gone${pip ? ' pip' : ''}`, role: 'status' }, h('div', { class: 'bd-move' }, this.girl, this.fx, this.say));
    doc.body.append(this.root);
    if (!pip) this._draggable();
  }

  /** on the page she stands at a spot you choose: feet at (x, y) */
  place() {
    if (this.pip) return;
    const b = this.buddy;
    const { x, y } = b.pos();
    const w = b.size().w, hh = b.size().h;
    const r = this.root;
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    const room = { l: x - w / 2, r: innerWidth - x - w / 2 };
    const left = room.l > room.r; // the speech bubble goes on the roomier side, and she faces that way
    r.classList.toggle('say-l', left);
    r.classList.toggle('flip', left);
    r.classList.toggle('say-low', y - hh < 110);
    r.style.setProperty('--sayw', `${clamp((left ? room.l : room.r) - 14, 130, 290)}px`);
    const fromRight = x > innerWidth / 2;
    r.style.setProperty('--off', `${fromRight ? innerWidth - x + w : -(x + w)}px`);
    r.style.setProperty('--sgn', fromRight ? 1 : -1);
  }

  render(st) {
    const r = this.root;
    const stay = !this.pip && this.buddy.S.buddyStay;
    const shown = st.on || stay;
    const away = st.away && !stay;
    const move = stay ? '' : st.move;
    if (shown && r.classList.contains('gone')) {
      // appear where she starts, without animating there
      this.place();
      r.classList.add('notrans');
      r.classList.remove('gone');
      r.classList.toggle('away', away);
      void r.offsetWidth;
      r.classList.remove('notrans');
    } else {
      r.classList.toggle('gone', !shown);
      r.classList.toggle('away', away);
    }
    ['m-in', 'm-out', 'm-walk'].forEach((c) => r.classList.toggle(c, move === c.slice(2)));
    const held = this.held;
    const cls = ['bd-svg', `f-${held ? 'open' : st.face}`, `p-${held ? 'rest' : st.pose}`];
    if (held) cls.push('held');
    else if (move === 'walk') cls.push('walk');
    else if (move) cls.push('run');
    if (st.glass) cls.push('cup');
    if (st.jump && !held) cls.push('jump');
    this.svg.setAttribute('class', cls.join(' '));
    this.girl.classList.toggle('big', st.big && !held);
    if (this.sayFor !== st.say) {
      this.sayFor = st.say;
      this._renderSay(st.say);
    }
  }

  _renderSay(say) {
    const el = this.say;
    el.innerHTML = '';
    el.hidden = !say;
    if (!say) return;
    el.append(h('p', { text: say.text }));
    const reply = (v) => this.buddy.reply(v);
    if (say.water) {
      el.append(h('div', { class: 'bd-btns' },
        h('button', { class: 'bd-yes', html: `${CHECK}<span>I drank water</span>`, onclick: () => reply('drank') }),
        h('button', { class: 'bd-no', text: `Snooze ${SNOOZE_MIN} min`, onclick: () => reply('snooze') })));
    } else if (say.done) {
      el.append(h('div', { class: 'bd-btns' }, h('button', { class: 'bd-yes', html: `${CHECK}<span>Done</span>`, onclick: () => reply('done') })));
    }
  }

  /** little bursts: 'kiss' (a heart blown from her hand), 'hearts', 'sparkle' (by her wink) */
  burst(kind, n = 8) {
    const flip = this.root.classList.contains('flip');
    const at = (x, y, cls, text, vars = {}, delay = 0) => {
      const s = h('span', { class: cls, text });
      s.style.left = `${flip ? 100 - x : x}%`;
      s.style.top = `${y}%`;
      s.style.animationDelay = `${delay}s`;
      for (const [k, v] of Object.entries(vars)) s.style.setProperty(k, v);
      this.fx.append(s);
      setTimeout(() => s.remove(), 3200 + delay * 1000);
    };
    const toward = flip ? -1 : 1; // toward the middle of the screen
    if (kind === 'kiss') {
      at(80, 44, 'kiss', '💗', { '--dx': `${toward * 110}px` });
      for (let i = 0; i < 3; i++) at(78, 46, '', pick(HEARTS), { '--dx': `${toward * rand(40, 120)}px`, '--dy': `${rand(60, 140)}px` }, 0.25 + i * 0.18);
    } else if (kind === 'sparkle') {
      at(73, 30, 'spark', '✨');
      at(84, 22, 'spark', '✨', {}, 0.3);
    } else {
      for (let i = 0; i < n; i++) {
        at(rand(15, 85), rand(25, 60), '', pick(HEARTS), { '--dx': `${rand(-70, 70)}px`, '--dy': `${rand(70, 170)}px` }, i * 0.12);
      }
    }
  }

  _draggable() {
    const g = this.girl;
    g.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      const p = this.buddy.pos();
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      this.held = true;
      this.root.classList.add('dragging');
      this.buddy.render();
      const move = (ev) => {
        this.root.style.left = `${ev.clientX - dx}px`;
        this.root.style.top = `${ev.clientY - dy}px`;
      };
      const up = (ev) => {
        g.removeEventListener('pointermove', move);
        g.removeEventListener('pointerup', up);
        g.removeEventListener('pointercancel', up);
        this.held = false;
        this.root.classList.remove('dragging');
        this.buddy.drop(ev.clientX - dx, ev.clientY - dy);
        this.root.classList.add('land');
        setTimeout(() => this.root.classList.remove('land'), 500);
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', up);
      g.addEventListener('pointercancel', up);
    });
  }
}

const REST = { face: 'smile', pose: 'rest', glass: false, big: false, jump: false, say: null, move: '' };

export class Buddy {
  /** S: settings (buddyCheer, waterRemind, buddyStay, buddyPos); pipDoc(): the pop-out's document or null */
  constructor({ S, persist, pipDoc, chime, notify }) {
    this.S = S;
    this.persist = persist;
    this.pipDoc = pipDoc;
    this.chime = chime;
    this.notify = notify;
    this.st = { on: false, away: true, ...REST };
    this.main = new Actor(this, document, false);
    this.pipActor = null;
    this.chain = Promise.resolve();
    this.busy = false;
    this.answer = null;
    this.nextWater = 0;
    this.waterWaiting = false;
    addEventListener('resize', () => this.main.place());
    this.render();
  }

  /* ---------- where she stands ---------- */
  size() {
    const hh = this.main.girl.offsetHeight || clamp(innerHeight * 0.21, 110, 190);
    return { w: hh * 0.6977, h: hh };
  }
  pos() {
    const { w, h: hh } = this.size();
    const p = this.S.buddyPos;
    const x = p ? p.x * innerWidth : innerWidth - Math.max(90, innerWidth * 0.1);
    const y = p ? p.y * innerHeight : innerHeight - (innerWidth <= 760 ? 140 : 100);
    return { x: clamp(x, w / 2 + 6, innerWidth - w / 2 - 6), y: clamp(y, hh + 6, innerHeight - 4) };
  }
  drop(x, y) {
    this.S.buddyPos = { x: x / innerWidth, y: y / innerHeight };
    const p = this.pos(); // kept inside the window
    this.S.buddyPos = { x: p.x / innerWidth, y: p.y / innerHeight };
    this.persist();
    this.main.place();
    this.render();
  }

  /* ---------- drawing ---------- */
  set(patch) { Object.assign(this.st, patch); this.render(); }
  render() {
    const doc = this.pipDoc();
    if (this.pipActor && this.pipActor.doc !== doc) { this.pipActor.root.remove(); this.pipActor = null; }
    if (doc && !this.pipActor && this.st.on) this.pipActor = new Actor(this, doc, true);
    this.main.render(this.st);
    this.pipActor?.render(this.st);
  }
  burst(kind, n) { this.main.burst(kind, n); this.pipActor?.burst(kind, n); }

  /** timers from the pop-out window when it's open: a hidden tab's own timers get slowed right down */
  sleep(ms) {
    const w = this.pipDoc()?.defaultView || window;
    return new Promise((r) => {
      w.setTimeout(r, ms);
      if (w !== window) setTimeout(r, ms + 1000); // in case the pop-out closes meanwhile
    });
  }
  async whileHeld() { while (this.main.held) await this.sleep(200); }

  queue(fn) {
    const run = async () => {
      this.busy = true;
      try { await fn(); } catch (e) { console.error(e); } finally { this.busy = false; }
    };
    this.chain = this.chain.then(run);
    return this.chain;
  }
  reply(v) { this.answer?.(v); }
  waitReply(ms) {
    return new Promise((res) => {
      const t = ms ? setTimeout(() => res('ignored'), ms) : 0;
      this.answer = (v) => { clearTimeout(t); this.answer = null; res(v); };
    });
  }

  async enter(extra = {}) {
    this.set({ on: true, away: true, ...REST, ...extra });
    await this.sleep(60);
    this.set({ away: false, move: 'in' });
    await this.sleep(1100);
    this.set({ move: '' });
  }
  async leave(walk = false) {
    await this.whileHeld();
    this.set({ say: null, big: false, jump: false, away: true, move: walk ? 'walk' : 'out' });
    await this.sleep(walk ? 2200 : 1150);
    this.set({ on: false, ...REST });
  }

  /* ---------- a finished focus session ---------- */
  cheer(kind = pick(Object.keys(CHEERS))) { return this.queue(() => this._cheer(kind)); }
  async _cheer(kind) {
    await this.enter();
    const say = { text: pick(CHEERS[kind]) };
    if (kind === 'kiss') {
      this.set({ face: 'kiss', pose: 'kiss1', say });
      await this.sleep(750);
      this.set({ face: 'wink', pose: 'kiss2' });
      this.burst('kiss');
      await this.sleep(2000);
    } else if (kind === 'hug') {
      this.set({ face: 'open', pose: 'open', say });
      await this.sleep(750);
      this.set({ face: 'happy', pose: 'hug', big: true });
      this.burst('hearts', 5);
      await this.sleep(2100);
    } else {
      this.set({ face: 'wink', pose: 'wave', say });
      this.burst('sparkle');
      await this.sleep(2600);
    }
    this.set({ face: 'smile', pose: 'rest', big: false });
    await this.sleep(350);
    await this.leave();
  }

  /* ---------- water ---------- */
  /** call often (the app's main loop) */
  tick() {
    this.render();
    if (!this.S.waterRemind) return;
    const now = Date.now();
    if (!this.nextWater) this.nextWater = now + nextWaterIn();
    if (now >= this.nextWater && !this.busy) this.water();
  }
  setWater(on) { this.nextWater = on ? Date.now() + nextWaterIn() : 0; }
  water() {
    if (this.waterWaiting) return this.chain;
    this.nextWater = Infinity;
    this.waterWaiting = true;
    return this.queue(() => this._water());
  }
  async _water() {
    if (document.hidden && !this.pipDoc()) this.notify?.('Time for some water 💧', 'Your buddy brought you a glass.');
    this.chime?.();
    await this.enter({ glass: true, pose: 'water' });
    this.set({ say: { text: pick(ASKS), water: true } });
    const ans = await this.waitReply(IGNORE_MS);
    this.waterWaiting = false;
    if (ans === 'drank') {
      this.nextWater = Date.now() + nextWaterIn();
      const n = this.countGlass();
      this.set({ face: 'happy', pose: 'cheer', jump: true, say: { text: n > 1 ? `Yay! That’s glass #${n} today 💖` : 'Yay! First glass today 💖' } });
      this.burst('hearts', 14);
      await this.sleep(2800);
      this.set({ jump: false, face: 'smile', pose: 'water' });
      await this.sleep(300);
      await this.leave();
    } else {
      this.nextWater = Date.now() + (ans === 'snooze' ? SNOOZE_MIN * MIN : nextWaterIn());
      this.set({ face: 'sad', pose: 'droop', say: { text: ans === 'snooze' ? `Okay… I’ll come back in ${SNOOZE_MIN} minutes 🥺` : 'I’ll come back later… don’t forget your water 🥺' } });
      await this.sleep(2800);
      await this.leave(true);
    }
  }
  countGlass() {
    const today = dayKey();
    const w = load('water', null);
    const n = (w?.day === today ? w.n : 0) + 1;
    save('water', { day: today, n });
    return n;
  }

  /** bring her out so you can drag her where you want her */
  placeHer() {
    return this.queue(async () => {
      await this.enter();
      this.set({ face: 'open', say: { text: 'Drag me anywhere you like', done: true } });
      await this.waitReply(0);
      this.set({ face: 'happy', say: null });
      await this.sleep(500);
      await this.leave();
    });
  }
}
