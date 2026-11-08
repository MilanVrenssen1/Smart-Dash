// Device tiles. Rendered once, then patched in place so CSS transitions play.

import { icon } from './icons.js';
import { esc } from './util.js';
import { store } from './store.js';
import { typeDef, devIcon, isActive, statusText, glowColor } from './devices.js';

function parts(d) {
  const def = typeDef(d);
  const s = d.state;
  const active = isActive(d);
  const offline = d.attrs?.available === false;
  return {
    def, s, active, offline,
    icon: devIcon(d),
    status: offline ? 'Unavailable' : statusText(d),
    glow: glowColor(d),
    level: def.level ? def.level(s) : null,
    big: def.big ? def.big(s) : null,
    actionIcon: def.actionIcon ? def.actionIcon(s) : null,
  };
}

export function cardHTML(d, { showRoom = true, index = 0 } = {}) {
  const p = parts(d);
  const room = showRoom ? store.room(d.roomId)?.name : null;
  let ctl = '';
  if (p.def.toggle) {
    ctl = `<button class="tgl ${p.s.on ? 'on' : ''}" role="switch" aria-checked="${!!p.s.on}" aria-label="Turn ${esc(d.name)} ${p.s.on ? 'off' : 'on'}"><i></i></button>`;
  } else if (p.def.action) {
    ctl = `<button class="dc-act" aria-label="Quick action for ${esc(d.name)}">${icon(p.actionIcon)}</button>`;
  } else if (p.big != null) {
    ctl = `<span class="dc-big">${esc(p.big)}</span>`;
  }
  return `<article class="dcard t-${d.type} ${p.active ? 'on' : ''} ${p.offline ? 'offline' : ''}" data-id="${esc(d.id)}"
      style="--glow:${p.glow};--level:${p.level ?? 0};--i:${index}" tabindex="0" role="button" aria-label="${esc(d.name)}, ${esc(p.status)}">
    <div class="dc-top">
      <span class="dc-icon">${icon(p.icon)}</span>
      ${ctl}
    </div>
    <div class="dc-text">
      <h3 class="dc-name">${d.favorite ? `<span class="dc-fav">${icon('star')}</span>` : ''}${esc(d.name)}</h3>
      <p class="dc-status"><span class="dc-room">${room ? esc(room) + ' · ' : ''}</span><span class="dc-st">${esc(p.status)}</span></p>
    </div>
    ${p.level != null ? '<div class="dc-bar"><i></i></div>' : ''}
  </article>`;
}

export function updateCard(el, d) {
  const p = parts(d);
  el.classList.toggle('on', p.active);
  el.classList.toggle('offline', p.offline);
  el.style.setProperty('--glow', p.glow);
  if (p.level != null) el.style.setProperty('--level', p.level);
  const ic = el.querySelector('.dc-icon');
  if (ic.dataset.n !== p.icon) {
    ic.dataset.n = p.icon;
    ic.innerHTML = icon(p.icon);
  }
  el.querySelector('.dc-st').textContent = p.status;
  el.setAttribute('aria-label', `${d.name}, ${p.status}`);
  const tgl = el.querySelector('.tgl');
  if (tgl) {
    tgl.classList.toggle('on', !!p.s.on);
    tgl.setAttribute('aria-checked', !!p.s.on);
  }
  const act = el.querySelector('.dc-act');
  if (act && act.dataset.n !== p.actionIcon) {
    act.dataset.n = p.actionIcon;
    act.innerHTML = icon(p.actionIcon);
  }
  const big = el.querySelector('.dc-big');
  if (big && p.big != null && big.textContent !== p.big) {
    big.textContent = p.big;
    big.classList.remove('tick');
    void big.offsetWidth;
    big.classList.add('tick');
  }
}

export function refreshCards(id) {
  const d = store.device(id);
  if (!d) return;
  document.querySelectorAll(`.dcard[data-id="${CSS.escape(id)}"]`).forEach((el) => updateCard(el, d));
}
