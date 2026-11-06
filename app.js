/* Marathon Manager — gerenciamento de salas em maratonas de programação.
 * Tudo roda no navegador; os dados ficam salvos no localStorage.
 * Abas diferentes do mesmo navegador ficam sincronizadas automaticamente. */

const KEY = 'marathon-manager:v1';
const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00',
  '#ec407a', '#00acc1', '#ffffff', '#6d4c41', '#9e9e9e', '#c0ca33', '#3949ab', '#26a69a'];

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const textOn = hex => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) > 150 ? '#000' : '#fff';
};
const fmtTime = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ======================== estado ======================== */

function defaultState() {
  return {
    problems: 'ABCDEFGH'.split('').map((l, i) => ({ id: uid(), letter: l, name: '', color: COLORS[i] })),
    rooms: [],   // { id, name, rows, cols, blocked: ['r,c'], seats: { 'r,c': teamId } }
    teams: [],   // { id, name }
    solves: [],  // { id, teamId, problemId, time, delivered, deliveredAt }
    podium: [],  // { teamId, solved, penalty }
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.problems)) { s.podium ??= []; return s; }
  } catch { /* dados corrompidos: recomeça */ }
  return defaultState();
}

let state = load();
const ui = { view: 'rooms', roomId: null, edit: false, balloonRoom: '', modal: null, intro: true };

function persist() { localStorage.setItem(KEY, JSON.stringify(state)); }
function save() { persist(); render(); }

/* Rastreia o que já foi desenhado, para animar só o que é novo. */
const seen = new Set();
const fresh = key => !seen.has(key) && (seen.add(key), true);
function primeSeen() {
  for (const s of state.solves) { seen.add('dot:' + s.id); seen.add(`bl:${s.id}:${!!s.delivered}`); }
  for (const r of state.rooms) for (const [k, t] of Object.entries(r.seats)) seen.add(`seat:${r.id}:${k}:${t}`);
}

/* ======================== helpers ======================== */

const teamById = id => state.teams.find(t => t.id === id);
const problemById = id => state.problems.find(p => p.id === id);
const roomById = id => state.rooms.find(r => r.id === id);
const solveOf = (teamId, problemId) => state.solves.find(s => s.teamId === teamId && s.problemId === problemId);
const isFirst = s => !state.solves.some(o => o.problemId === s.problemId && o.time < s.time);
const seatLabel = k => { const [r, c] = k.split(',').map(Number); return `F${r + 1} · M${c + 1}`; };

function locate(teamId) {
  for (const room of state.rooms)
    for (const [k, v] of Object.entries(room.seats))
      if (v === teamId) return { room, key: k };
  return null;
}
const where = teamId => {
  const loc = locate(teamId);
  return loc ? `${loc.room.name} · ${seatLabel(loc.key)}` : 'sem lugar';
};

function unseat(teamId) {
  const loc = locate(teamId);
  if (loc) delete loc.room.seats[loc.key];
}

function deleteTeam(teamId) {
  unseat(teamId);
  state.teams = state.teams.filter(x => x.id !== teamId);
  state.solves = state.solves.filter(s => s.teamId !== teamId);
  state.podium = state.podium.filter(e => e.teamId !== teamId);
}

const solvedCount = teamId => state.solves.filter(s => s.teamId === teamId).length;

/** Classificação estilo maratona: mais resolvidos, depois menor penalidade. Empates dividem a posição. */
function ranking() {
  const rows = state.podium
    .filter(e => teamById(e.teamId))
    .map(e => ({ ...e, team: teamById(e.teamId) }))
    .sort((a, b) => b.solved - a.solved || a.penalty - b.penalty || a.team.name.localeCompare(b.team.name));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.pos = prev && prev.solved === r.solved && prev.penalty === r.penalty ? prev.pos : i + 1;
  });
  return rows;
}

function firstFreeSeat(room) {
  for (let r = 0; r < room.rows; r++)
    for (let c = 0; c < room.cols; c++) {
      const k = `${r},${c}`;
      if (!room.blocked.includes(k) && !room.seats[k]) return k;
    }
  return null;
}

/** Marca/desmarca um problema. Retorna o acerto criado (ou null). */
async function toggleSolve(teamId, problemId) {
  const s = solveOf(teamId, problemId);
  if (s) {
    const p = problemById(problemId);
    if (!await ask(`Desmarcar o problema ${p.letter}? O balão será removido da fila.`, { ok: 'Desmarcar' })) return null;
    state.solves = state.solves.filter(x => x !== s);
    save();
    return null;
  }
  const solve = { id: uid(), teamId, problemId, time: Date.now(), delivered: false };
  state.solves.push(solve);
  save();
  return solve;
}

/** Feedback visual de um novo acerto: balões subindo + notificação. */
function celebrate(solve, originEl) {
  const t = teamById(solve.teamId), p = problemById(solve.problemId);
  if (!t || !p) return;
  const first = isFirst(solve);
  launchBalloons(originEl, p.color, first ? 5 : 1);
  toast(`<b>${esc(t.name)}</b> resolveu <b>${esc(p.letter)}</b>${first ? ' — primeiro!' : ''}<br>
    <small class="muted">${esc(where(t.id))}</small>`, p.color);
}

async function setDelivered(solveId, delivered, rowEl) {
  const s = state.solves.find(x => x.id === solveId);
  if (!s) return;
  if (rowEl && !reducedMotion) { rowEl.classList.add('leaving'); await sleep(200); }
  s.delivered = delivered;
  s.deliveredAt = delivered ? Date.now() : null;
  save();
}

/* ======================== efeitos ======================== */

const fx = $('#fx');
/** Traz a camada de efeitos para o topo (acima de modais abertos). */
function raiseFx() {
  if (!fx.showPopover) return;
  try {
    if (fx.matches(':popover-open')) fx.hidePopover();
    fx.showPopover();
  } catch { /* navegador sem suporte a popover */ }
}

function launchBalloons(el, color, count = 1) {
  if (reducedMotion || !el) return;
  const r = el.getBoundingClientRect();
  for (let i = 0; i < count; i++) {
    const b = document.createElement('div');
    b.className = 'float-balloon';
    const spread = count > 1 ? Math.max(30, Math.min(r.width / 2, 80)) : 0;
    b.style.left = `${r.left + r.width / 2 - 14 + (Math.random() * 2 - 1) * spread}px`;
    b.style.top = `${r.top + r.height / 2 - 17}px`;
    b.style.setProperty('--c', color);
    b.style.setProperty('--sway', `${Math.random() * 90 - 45}px`);
    b.style.setProperty('--rot', `${Math.random() * 24 - 12}deg`);
    b.style.setProperty('--delay', `${i * 0.12}s`);
    b.addEventListener('animationend', () => b.remove());
    fx.append(b);
  }
}

function toast(html, color) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = (color ? `<i style="background:${color}"></i>` : '') + `<span>${html}</span>`;
  $('#toasts').append(t);
  setTimeout(() => {
    t.classList.add('out');
    t.addEventListener('animationend', () => t.remove());
    if (reducedMotion) t.remove();
  }, 3500);
}

/* ======================== diálogos ======================== */

async function closeDialog(d) {
  if (!d.open || d.dataset.closing) return;
  d.dataset.closing = '1';
  if (!reducedMotion) { d.classList.add('closing'); await sleep(150); d.classList.remove('closing'); }
  d.close();
  delete d.dataset.closing;
}

function openDialog(d) {
  if (!d.open) { d.showModal(); raiseFx(); }
}

/** Substitui o confirm() nativo. Resolve true/false. */
function ask(message, { ok = 'Confirmar', danger = true } = {}) {
  const d = $('#confirm');
  return new Promise(resolve => {
    $('#confirm-msg').textContent = message;
    const yes = $('#confirm-yes');
    yes.textContent = ok;
    yes.className = 'btn ' + (danger ? 'danger-solid' : 'primary');
    const done = v => { closeDialog(d); resolve(v); };
    yes.onclick = () => done(true);
    $('#confirm-no').onclick = () => done(false);
    d.oncancel = e => { e.preventDefault(); done(false); };
    openDialog(d);
    yes.focus();
  });
}

const dialog = $('#modal');
function showModal(html, bind) {
  dialog.classList.remove('stage-dialog');
  $('#modal-body').innerHTML = html;
  bind?.($('#modal-body'));
  openDialog(dialog);
}
const closeModal = () => closeDialog(dialog);
dialog.addEventListener('close', () => { ui.modal = null; dialog.classList.remove('stage-dialog'); });
dialog.addEventListener('cancel', e => { e.preventDefault(); closeModal(); });
dialog.addEventListener('mousedown', e => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) closeModal();
  }
});
dialog.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });

/* ======================== render ======================== */

let lastPending = null;

function render() {
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.view === ui.view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + ui.view));

  const pending = state.solves.filter(s => !s.delivered).length;
  const badge = $('#badge');
  badge.textContent = pending || '';
  if (lastPending !== null && pending > lastPending) {
    badge.classList.remove('bump');
    void badge.offsetWidth; // reinicia a animação
    badge.classList.add('bump');
  }
  lastPending = pending;
  document.title = (pending ? `(${pending}) ` : '') + 'Marathon Manager';

  if (ui.view === 'rooms') renderRooms();
  else if (ui.view === 'balloons') renderBalloons();
  else if (ui.view === 'podium') renderPodium();
  else renderSetup();
  ui.intro = false;
}

/* ---- salas / espelho ---- */

function renderRooms() {
  if (!roomById(ui.roomId)) ui.roomId = state.rooms[0]?.id ?? null;

  $('#room-list').innerHTML = state.rooms.map(r => {
    const ids = Object.values(r.seats);
    const pend = state.solves.filter(s => !s.delivered && ids.includes(s.teamId)).length;
    return `<li class="${r.id === ui.roomId ? 'active' : ''}" data-id="${r.id}" title="${ids.length} equipes${pend ? `, ${pend} balões pendentes` : ''}">
      <span>${esc(r.name)}</span>
      <span class="meta">${ids.length}${pend ? `<span class="pill">${pend}</span>` : ''}</span></li>`;
  }).join('') || '<li class="muted" style="cursor:default">Nenhuma sala</li>';

  const room = roomById(ui.roomId);
  const panel = $('#room-panel');
  if (!room) {
    panel.innerHTML = `<div class="empty">
      <div class="art">◯</div>
      <p>Nenhuma sala criada ainda.</p>
      <button class="btn primary" data-act="new-room">+ Nova sala</button></div>`;
    return;
  }

  const teamIds = Object.values(room.seats);
  const solved = state.solves.filter(s => teamIds.includes(s.teamId)).length;
  let cells = '', i = 0;
  for (let r = 0; r < room.rows; r++) {
    for (let c = 0; c < room.cols; c++, i++) {
      const k = `${r},${c}`;
      const team = teamById(room.seats[k]);
      if (room.blocked.includes(k)) {
        cells += `<div class="cell aisle" data-k="${k}" style="--i:${i}"></div>`;
      } else if (team) {
        let pending = false;
        const dots = state.problems.map(p => {
          const s = solveOf(team.id, p.id);
          if (!s) return '';
          if (!s.delivered) pending = true;
          const anim = fresh('dot:' + s.id) && !ui.intro ? ' enter' : '';
          return `<i class="dot${s.delivered ? '' : ' pending'}${anim}" data-solve="${s.id}"
            style="background:${p.color};color:${textOn(p.color)}"
            title="${esc(p.letter)}${s.delivered ? ' — entregue' : ' — balão pendente (clique para marcar como entregue)'}">${esc(p.letter)}</i>`;
        }).join('');
        const anim = fresh(`seat:${room.id}:${k}:${team.id}`) && !ui.intro ? ' enter' : '';
        cells += `<div class="cell team${pending ? ' has-pending' : ''}${anim}" draggable="${!ui.edit}" data-k="${k}" data-team="${team.id}" style="--i:${i}">
          <span class="seat">${seatLabel(k)}</span>
          <span class="name">${esc(team.name)}</span>
          <span class="dots">${dots}</span></div>`;
      } else {
        cells += `<div class="cell free" data-k="${k}" style="--i:${i}"><span class="seat">${seatLabel(k)}</span>
          <span class="plus">${ui.edit ? '' : '+'}</span></div>`;
      }
    }
  }

  panel.innerHTML = `
    <div class="room-head">
      <input class="title-input" id="room-name" value="${esc(room.name)}" spellcheck="false" title="Clique para renomear">
      <span class="spacer"></span>
      <span class="muted">${teamIds.length} equipes · ${solved} balões</span>
      <button class="btn ${ui.edit ? 'on' : ''}" data-act="toggle-edit">${ui.edit ? 'Concluir edição' : 'Editar layout'}</button>
    </div>
    ${ui.edit ? `<div class="edit-bar">
      Fileiras <input type="number" id="rows" min="1" max="40" value="${room.rows}">
      Mesas por fileira <input type="number" id="cols" min="1" max="40" value="${room.cols}">
      <span class="muted">Clique numa mesa vazia para transformá-la em corredor (e vice-versa).</span>
      <span class="spacer"></span>
      <button class="btn danger" data-act="del-room">Excluir sala</button>
    </div>` : ''}
    <div class="front">FRENTE DA SALA</div>
    <div class="grid-wrap">
      <div class="grid${ui.edit ? ' editing' : ''}${ui.intro ? ' intro' : ''}" style="grid-template-columns:repeat(${room.cols}, minmax(108px, 1fr))">${cells}</div>
    </div>
    ${ui.edit ? '' : `<p class="hint">Clique numa mesa para adicionar uma equipe ou marcar problemas · arraste para trocar de lugar
      (ou solte sobre outra sala) · clique num balão piscando para marcá-lo como entregue · atalhos <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd></p>`}`;
}

async function resizeRoom(room, rows, cols) {
  rows = Math.max(1, Math.min(40, rows || 1));
  cols = Math.max(1, Math.min(40, cols || 1));
  const inside = k => { const [r, c] = k.split(',').map(Number); return r < rows && c < cols; };
  const out = Object.keys(room.seats).filter(k => !inside(k));
  if (out.length && !await ask(`${out.length} equipe(s) ficarão sem lugar. Continuar?`, { ok: 'Redimensionar' })) return render();
  out.forEach(k => delete room.seats[k]);
  room.blocked = room.blocked.filter(inside);
  room.rows = rows;
  room.cols = cols;
  save();
}

/* ---- balões ---- */

function renderBalloons() {
  const inRoom = s => !ui.balloonRoom || locate(s.teamId)?.room.id === ui.balloonRoom;
  const valid = s => teamById(s.teamId) && problemById(s.problemId);
  const pend = state.solves.filter(s => !s.delivered && valid(s) && inRoom(s)).sort((a, b) => a.time - b.time);
  const done = state.solves.filter(s => s.delivered && valid(s) && inRoom(s)).sort((a, b) => b.deliveredAt - a.deliveredAt);

  const item = (s, i) => {
    const t = teamById(s.teamId), p = problemById(s.problemId);
    const anim = fresh(`bl:${s.id}:${!!s.delivered}`) && !ui.intro ? ' enter' : '';
    return `<li class="balloon${s.delivered ? ' done' : ''}${anim}" style="--i:${i}">
      <span class="bdot" style="background-color:${p.color};color:${textOn(p.color)}">${esc(p.letter)}</span>
      <div class="binfo">
        <div><b>${esc(t.name)}</b>${isFirst(s) ? '<span class="first">primeiro</span>' : ''}</div>
        <small>${esc(where(t.id))} · resolvido às ${fmtTime(s.time)}</small>
      </div>
      <button class="btn${s.delivered ? '' : ' primary'}" data-deliver="${s.id}" data-to="${!s.delivered}">${s.delivered ? 'Desfazer' : 'Entregue ✓'}</button>
    </li>`;
  };

  const summary = state.problems.map(p => {
    const n = state.solves.filter(s => s.problemId === p.id).length;
    return `<span title="${esc(p.name)}"><i style="background:${p.color}"></i>${esc(p.letter)} ${n}</span>`;
  }).join('');

  const teams = [...state.teams].sort((a, b) => a.name.localeCompare(b.name));
  const intro = ui.intro ? ' intro' : '';
  $('#balloon-panel').innerHTML = `
    <div class="summary">${summary}</div>
    <div class="quick">
      <span class="muted">Registrar acerto</span>
      <select id="q-team"><option value="">Equipe…</option>${teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
      <select id="q-prob">${state.problems.map(p => `<option value="${p.id}">${esc(p.letter)}${p.name ? ' — ' + esc(p.name) : ''}</option>`).join('')}</select>
      <button class="btn primary" data-act="quick-solve">Registrar</button>
      <span class="spacer"></span>
      <span class="muted">Sala</span>
      <select id="b-room"><option value="">Todas</option>${state.rooms.map(r => `<option value="${r.id}" ${r.id === ui.balloonRoom ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
    </div>
    <div class="split">
      <div><h2>Pendentes <span class="muted">${pend.length}</span></h2>
        <ul class="blist${intro}">${pend.map(item).join('') || '<li class="muted">Nenhum balão pendente.</li>'}</ul></div>
      <div><h2>Entregues <span class="muted">${done.length}</span></h2>
        <ul class="blist${intro}">${done.map(item).join('') || '<li class="muted">Nada entregue ainda.</li>'}</ul></div>
    </div>`;
}

/* ---- pódio ---- */

const PLACE_COLORS = { 1: '#e6c35c', 2: '#c9d1d6', 3: '#d08a55' };

/** Degraus na ordem visual 2º · 1º · 3º. `veiled` esconde os nomes (modo apresentação). */
function podiumSteps(rows, { veiled = false, animate = false } = {}) {
  return [2, 1, 3].map(place => {
    const r = rows[place - 1];
    if (!r) return `<div class="step p${place} vacant"><div class="who"></div><div class="block">${place}º</div></div>`;
    const pop = animate && fresh(`top:${place}:${r.teamId}`) ? ' enter' : '';
    return `<div class="step p${place}${veiled ? ' veiled' : ''}" data-place="${place}">
      <div class="who${pop}"><b>${esc(r.team.name)}</b>
        <small>${r.solved} ${r.solved === 1 ? 'problema' : 'problemas'} · ${r.penalty} min</small></div>
      <div class="block">${r.pos}º</div></div>`;
  }).join('');
}

function renderPodium() {
  const rows = ranking();
  const avail = state.teams.filter(t => !state.podium.some(e => e.teamId === t.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const list = rows.map(r => `
    <div class="rank-row${fresh('pd:' + r.teamId) && !ui.intro ? ' enter' : ''}" data-team="${r.teamId}">
      <span class="pos pos-${r.pos}">${r.pos}º</span>
      <span class="tname">${esc(r.team.name)}<small>${esc(where(r.teamId))} · ${solvedCount(r.teamId)} acerto(s) registrado(s)</small></span>
      <input type="number" min="0" data-pd="solved" data-fk="s:${r.teamId}" value="${r.solved}" aria-label="Problemas resolvidos">
      <input type="number" min="0" data-pd="penalty" data-fk="p:${r.teamId}" value="${r.penalty}" aria-label="Penalidade em minutos">
      <button class="icon" data-pd-del="${r.teamId}" title="Remover do pódio">×</button>
    </div>`).join('');

  $('#podium-panel').innerHTML = `
    <div class="podium${ui.intro ? ' intro' : ''}">${podiumSteps(rows, { animate: !ui.intro })}</div>
    <div class="quick">
      <span class="muted">Adicionar equipe</span>
      <select id="pd-team"><option value="">Equipe…</option>${avail.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
      <button class="btn primary" data-act="pd-add">Adicionar</button>
      <button class="btn" data-act="pd-add-all" ${avail.length ? '' : 'disabled'}>Adicionar todas</button>
      <span class="spacer"></span>
      <button class="btn" data-act="pd-sync" ${rows.length ? '' : 'disabled'} title="Preenche “resolvidos” com os acertos marcados no app">Sincronizar acertos</button>
      <button class="btn" data-act="present" ${rows.length ? '' : 'disabled'}>Apresentar ▸</button>
    </div>
    <div class="ranking">
      <div class="rank-row head"><span>#</span><span>Equipe</span><span>Resolvidos</span><span>Penalidade (min)</span><span></span></div>
      ${list || '<p class="muted">Adicione equipes para montar o pódio.</p>'}
    </div>
    <p class="hint">Ordenação: mais problemas resolvidos; no empate, menor penalidade. Equipes com os mesmos valores dividem a posição.</p>`;
}

/** Re-renderiza animando as linhas do ranking até a nova posição (técnica FLIP). */
function withFlip(fn) {
  const before = new Map($$('.rank-row[data-team]').map(el => [el.dataset.team, el.getBoundingClientRect().top]));
  fn();
  if (reducedMotion) return;
  for (const el of $$('.rank-row[data-team]')) {
    const top = before.get(el.dataset.team);
    if (top == null) continue;
    const dy = top - el.getBoundingClientRect().top;
    if (Math.abs(dy) > 1)
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}

/** Revela 3º, 2º e 1º lugares um de cada vez — ideal para a premiação no projetor. */
function openPresentation() {
  const rows = ranking();
  const order = [3, 2, 1].filter(p => rows[p - 1]);
  let step = 0;
  ui.modal = { type: 'stage' };
  showModal(`
    <div class="stage-title">Pódio</div>
    <div class="podium stage">${podiumSteps(rows, { veiled: true })}</div>
    <div class="modal-foot">
      <button class="btn" data-close>Fechar</button>
      <span class="spacer"></span>
      <button class="btn primary" id="st-next" autofocus>Revelar ${order[0]}º lugar</button>
    </div>`, root => {
    $('#st-next', root).onclick = () => {
      if (step >= order.length) return closeModal();
      const place = order[step++];
      const el = $(`.step[data-place="${place}"]`, root);
      el.classList.remove('veiled');
      el.classList.add('reveal');
      launchBalloons($('.block', el), PLACE_COLORS[place], place === 1 ? 10 : 4);
      $('#st-next', root).textContent = step < order.length ? `Revelar ${order[step]}º lugar` : 'Encerrar';
    };
  });
  dialog.classList.add('stage-dialog');
}

/* ---- configuração ---- */

function renderSetup() {
  const probs = state.problems.map(p => `
    <div class="row${fresh('prob:' + p.id) && !ui.intro ? ' enter' : ''}" data-pid="${p.id}">
      <input type="color" data-f="color" value="${p.color}" title="Cor do balão">
      <input class="letter" data-f="letter" value="${esc(p.letter)}" maxlength="3">
      <input class="grow" data-f="name" value="${esc(p.name)}" placeholder="Nome do problema (opcional)">
      <span class="muted" style="width:40px;text-align:right" title="Acertos">${state.solves.filter(s => s.problemId === p.id).length}</span>
      <button class="icon" data-del-prob="${p.id}" title="Remover">×</button>
    </div>`).join('');

  const teams = [...state.teams].sort((a, b) => a.name.localeCompare(b.name)).map(t => `
    <div class="row${fresh('team:' + t.id) && !ui.intro ? ' enter' : ''}">
      <input class="grow" data-team-name="${t.id}" value="${esc(t.name)}">
      <span class="muted" style="font-size:12px">${esc(where(t.id))} · ${state.solves.filter(s => s.teamId === t.id).length} AC</span>
      <button class="icon" data-del-team="${t.id}" title="Excluir">×</button>
    </div>`).join('');

  $('#setup-panel').innerHTML = `
    <div class="setup">
      <div>
        <h2>Problemas e cores dos balões</h2>
        <div class="list">${probs}</div>
        <div class="row" style="margin-top:12px"><button class="btn" data-act="add-prob">+ Problema</button></div>

        <h2 style="margin-top:40px">Dados</h2>
        <div class="row">
          <button class="btn" data-act="export">Exportar JSON</button>
          <button class="btn" data-act="import">Importar JSON</button>
          <button class="btn danger" data-act="reset-solves">Zerar balões</button>
          <button class="btn danger" data-act="reset-all">Apagar tudo</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
        </div>
        <p class="hint">Os dados ficam salvos neste navegador. Abra o app em outra aba (ex.: no projetor) e ela atualiza sozinha.</p>
      </div>
      <div>
        <h2>Equipes <span class="muted">${state.teams.length}</span></h2>
        <textarea id="bulk-teams" placeholder="Adicionar equipes — uma por linha"></textarea>
        <div class="row" style="margin:8px 0 20px">
          <select id="bulk-room"><option value="">Não colocar em sala</option>${state.rooms.map(r => `<option value="${r.id}">Distribuir em: ${esc(r.name)}</option>`).join('')}</select>
          <button class="btn primary" data-act="bulk-add">Adicionar</button>
        </div>
        <div class="list">${teams || '<span class="muted">Nenhuma equipe.</span>'}</div>
      </div>
    </div>`;
}

/* ======================== modais ======================== */

function openNewRoom() {
  ui.modal = { type: 'room' };
  showModal(`
    <h2>Nova sala</h2>
    <label>Nome</label><input id="nr-name" style="width:100%" value="Sala ${state.rooms.length + 1}">
    <div class="row" style="margin-top:12px">
      <span class="muted">Fileiras</span><input type="number" id="nr-rows" min="1" max="40" value="5">
      <span class="muted">Mesas por fileira</span><input type="number" id="nr-cols" min="1" max="40" value="6">
    </div>
    <div class="modal-foot"><span class="spacer"></span>
      <button class="btn" data-close>Cancelar</button>
      <button class="btn primary" id="nr-ok">Criar</button></div>`, root => {
    const ok = () => {
      const room = {
        id: uid(), name: $('#nr-name', root).value.trim() || 'Sala',
        rows: Math.max(1, Math.min(40, +$('#nr-rows', root).value || 5)),
        cols: Math.max(1, Math.min(40, +$('#nr-cols', root).value || 6)),
        blocked: [], seats: {},
      };
      state.rooms.push(room);
      Object.assign(ui, { roomId: room.id, view: 'rooms', edit: false, intro: true });
      closeModal();
      save();
    };
    $('#nr-ok', root).onclick = ok;
    root.onkeydown = e => { if (e.key === 'Enter') ok(); };
    setTimeout(() => $('#nr-name', root).select());
  });
}

function openAssign(room, key) {
  ui.modal = { type: 'assign' };
  const free = state.teams.filter(t => !locate(t.id)).sort((a, b) => a.name.localeCompare(b.name));
  showModal(`
    <h2>${esc(room.name)} · ${seatLabel(key)}</h2>
    <label>Nova equipe</label>
    <div class="row"><input id="as-name" placeholder="Nome da equipe" style="flex:1">
      <button class="btn primary" id="as-ok">Adicionar</button></div>
    ${free.length ? `<label>Ou escolha uma equipe sem lugar</label>
      <div class="chips">${free.map(t => `<button class="chip" data-team="${t.id}">${esc(t.name)}</button>`).join('')}</div>` : ''}
    <div class="modal-foot"><span class="spacer"></span><button class="btn" data-close>Cancelar</button></div>`, root => {
    const place = id => { room.seats[key] = id; closeModal(); save(); };
    const create = () => {
      const name = $('#as-name', root).value.trim();
      if (!name) return $('#as-name', root).focus();
      const t = { id: uid(), name };
      state.teams.push(t);
      place(t.id);
    };
    $('#as-ok', root).onclick = create;
    $('#as-name', root).onkeydown = e => { if (e.key === 'Enter') create(); };
    $$('[data-team]', root).forEach(b => b.onclick = () => place(b.dataset.team));
    setTimeout(() => $('#as-name', root).focus());
  });
}

function openTeam(teamId, popProblem) {
  const t = teamById(teamId);
  if (!t) return closeModal();
  ui.modal = { type: 'team', id: teamId };
  const loc = locate(teamId);
  const probs = state.problems.map(p => {
    const s = solveOf(teamId, p.id);
    const info = s ? `${fmtTime(s.time)}${isFirst(s) ? ' ★' : ''}${s.delivered ? ' ✓' : ''}` : '—';
    return `<button class="prob${s ? ' solved' : ''}${p.id === popProblem ? ' pop' : ''}" data-p="${p.id}"
      title="${esc(p.name || p.letter)}${s ? (s.delivered ? ' — balão entregue' : ' — balão pendente') : ''}"
      style="--c:${p.color};--t:${textOn(p.color)}"><b>${esc(p.letter)}</b><small>${info}</small></button>`;
  }).join('');

  showModal(`
    <input class="title-input" id="tm-name" value="${esc(t.name)}" spellcheck="false" title="Clique para renomear">
    <div class="muted">${esc(where(teamId))}</div>
    <label>Problemas — clique para marcar como resolvido</label>
    <div class="probs">${probs}</div>
    <div class="modal-foot">
      <button class="btn danger" id="tm-del">Excluir</button>
      ${loc ? '<button class="btn" id="tm-unseat">Tirar do lugar</button>' : ''}
      <span class="spacer"></span>
      <button class="btn" data-close autofocus>Fechar</button>
    </div>`, root => {
    $('#tm-name', root).onchange = e => {
      const v = e.target.value.trim();
      if (v) { t.name = v; save(); }
    };
    $$('[data-p]', root).forEach(b => b.onclick = async () => {
      const solve = await toggleSolve(teamId, b.dataset.p);
      if (!dialog.open) return;
      openTeam(teamId, solve ? b.dataset.p : null);
      if (solve) celebrate(solve, $(`[data-p="${b.dataset.p}"]`, root));
    });
    $('#tm-del', root).onclick = async () => {
      if (!await ask(`Excluir a equipe "${t.name}" e todos os seus balões?`, { ok: 'Excluir' })) return;
      deleteTeam(teamId);
      closeModal();
      save();
    };
    const un = $('#tm-unseat', root);
    if (un) un.onclick = () => { unseat(teamId); closeModal(); save(); };
  });
}

/* ======================== eventos ======================== */

function setView(view) {
  if (ui.view === view) return;
  Object.assign(ui, { view, edit: false, intro: true });
  render();
}

$('nav').addEventListener('click', e => {
  const b = e.target.closest('button[data-view]');
  if (b) setView(b.dataset.view);
});

document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
  if (e.target.closest('input, textarea, select')) return;
  const view = { 1: 'rooms', 2: 'balloons', 3: 'podium', 4: 'setup' }[e.key];
  if (view) setView(view);
});

$('#add-room').onclick = openNewRoom;

const roomList = $('#room-list');
roomList.addEventListener('click', e => {
  const li = e.target.closest('li[data-id]');
  if (!li || li.dataset.id === ui.roomId) return;
  Object.assign(ui, { roomId: li.dataset.id, edit: false, intro: true });
  render();
});

// painel da sala
const roomPanel = $('#room-panel');
roomPanel.addEventListener('click', async e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  const room = roomById(ui.roomId);
  if (act === 'new-room') return openNewRoom();
  if (act === 'toggle-edit') { ui.edit = !ui.edit; return render(); }
  if (act === 'del-room') {
    const n = Object.keys(room.seats).length;
    if (!await ask(`Excluir "${room.name}"?${n ? ` ${n} equipe(s) ficarão sem lugar (não serão apagadas).` : ''}`, { ok: 'Excluir sala' })) return;
    state.rooms = state.rooms.filter(r => r !== room);
    Object.assign(ui, { edit: false, intro: true });
    return save();
  }

  // clicar num balão pendente marca como entregue
  const dot = e.target.closest('.dot.pending');
  if (dot && !ui.edit) return setDelivered(dot.dataset.solve, true);

  const cell = e.target.closest('.cell');
  if (!cell || !room) return;
  const k = cell.dataset.k;
  if (ui.edit) {
    if (room.seats[k]) return;
    room.blocked = room.blocked.includes(k) ? room.blocked.filter(x => x !== k) : [...room.blocked, k];
    return save();
  }
  if (room.blocked.includes(k)) return;
  if (room.seats[k]) openTeam(room.seats[k]);
  else openAssign(room, k);
});
roomPanel.addEventListener('change', e => {
  const room = roomById(ui.roomId);
  if (!room) return;
  if (e.target.id === 'room-name') { room.name = e.target.value.trim() || room.name; save(); }
  if (e.target.id === 'rows' || e.target.id === 'cols')
    resizeRoom(room, +$('#rows').value, +$('#cols').value);
});
roomPanel.addEventListener('keydown', e => {
  if (e.target.id === 'room-name' && e.key === 'Enter') e.target.blur();
});

// arrastar e soltar
let drag = null;
roomPanel.addEventListener('dragstart', e => {
  const cell = e.target.closest('.cell.team');
  if (!cell || ui.edit) return;
  drag = { roomId: ui.roomId, key: cell.dataset.k };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', drag.key);
  requestAnimationFrame(() => cell.classList.add('dragging'));
});
document.addEventListener('dragend', () => {
  drag = null;
  $$('.dragging, .over, .drop').forEach(el => el.classList.remove('dragging', 'over', 'drop'));
});
roomPanel.addEventListener('dragover', e => {
  const cell = e.target.closest('.cell:not(.aisle)');
  if (!drag || !cell) return;
  e.preventDefault();
  $$('.over').forEach(el => el !== cell && el.classList.remove('over'));
  if (cell.dataset.k !== drag.key) cell.classList.add('over');
});
roomPanel.addEventListener('dragleave', e => {
  const cell = e.target.closest('.cell');
  if (cell && !cell.contains(e.relatedTarget)) cell.classList.remove('over');
});
roomPanel.addEventListener('drop', e => {
  const cell = e.target.closest('.cell:not(.aisle)');
  if (!drag || !cell) return;
  e.preventDefault();
  const room = roomById(ui.roomId);
  const from = drag.key, to = cell.dataset.k;
  drag = null;
  if (from === to) return;
  const a = room.seats[from], b = room.seats[to];
  room.seats[to] = a;
  if (b) room.seats[from] = b; else delete room.seats[from];
  save();
});
roomList.addEventListener('dragover', e => {
  const li = e.target.closest('li[data-id]');
  if (!drag || !li || li.dataset.id === drag.roomId) return;
  e.preventDefault();
  $$('.drop').forEach(el => el !== li && el.classList.remove('drop'));
  li.classList.add('drop');
});
roomList.addEventListener('dragleave', e => {
  const li = e.target.closest('li');
  if (li && !li.contains(e.relatedTarget)) li.classList.remove('drop');
});
roomList.addEventListener('drop', e => {
  const li = e.target.closest('li[data-id]');
  if (!drag || !li || li.dataset.id === drag.roomId) return;
  e.preventDefault();
  const src = roomById(drag.roomId), dst = roomById(li.dataset.id);
  const teamId = src.seats[drag.key];
  drag = null;
  const seat = firstFreeSeat(dst);
  if (!seat) return toast(`<b>${esc(dst.name)}</b> está cheia.`);
  dst.seats[seat] = teamId;
  delete src.seats[Object.keys(src.seats).find(k => src.seats[k] === teamId)];
  save();
  toast(`<b>${esc(teamById(teamId).name)}</b> movida para ${esc(dst.name)} · ${seatLabel(seat)}`);
});

// balões
const balloonPanel = $('#balloon-panel');
balloonPanel.addEventListener('click', async e => {
  const btn = e.target.closest('[data-deliver]');
  if (btn) return setDelivered(btn.dataset.deliver, btn.dataset.to === 'true', btn.closest('.balloon'));
  const quick = e.target.closest('[data-act="quick-solve"]');
  if (quick) {
    const teamId = $('#q-team').value, problemId = $('#q-prob').value;
    if (!teamId) return $('#q-team').focus();
    if (!problemId) return;
    if (solveOf(teamId, problemId)) return toast('Essa equipe já resolveu esse problema.');
    const solve = await toggleSolve(teamId, problemId);
    if (solve) celebrate(solve, $('[data-act="quick-solve"]'));
  }
});
balloonPanel.addEventListener('change', e => {
  if (e.target.id === 'b-room') { ui.balloonRoom = e.target.value; ui.intro = true; render(); }
});

// pódio
const podiumPanel = $('#podium-panel');
podiumPanel.addEventListener('click', async e => {
  const del = e.target.closest('[data-pd-del]')?.dataset.pdDel;
  if (del) return withFlip(() => { state.podium = state.podium.filter(x => x.teamId !== del); save(); });

  const act = e.target.closest('[data-act]')?.dataset.act;
  const add = id => state.podium.push({ teamId: id, solved: solvedCount(id), penalty: 0 });
  if (act === 'pd-add') {
    const id = $('#pd-team').value;
    if (!id) return $('#pd-team').focus();
    withFlip(() => { add(id); save(); });
  } else if (act === 'pd-add-all') {
    withFlip(() => {
      state.teams.filter(t => !state.podium.some(x => x.teamId === t.id)).forEach(t => add(t.id));
      save();
    });
  } else if (act === 'pd-sync') {
    if (!await ask('Substituir os “resolvidos” de cada equipe pela quantidade de acertos marcados no app? As penalidades não mudam.', { ok: 'Sincronizar', danger: false })) return;
    withFlip(() => { state.podium.forEach(x => { x.solved = solvedCount(x.teamId); }); save(); });
  } else if (act === 'present') {
    openPresentation();
  }
});
podiumPanel.addEventListener('change', e => {
  const field = e.target.dataset.pd;
  if (!field) return;
  const entry = state.podium.find(x => x.teamId === e.target.closest('[data-team]').dataset.team);
  entry[field] = Math.max(0, Math.floor(+e.target.value || 0));
  persist();
  // espera o foco ir para o próximo campo, re-renderiza com animação e devolve o foco
  requestAnimationFrame(() => {
    const fk = document.activeElement?.dataset?.fk;
    withFlip(render);
    if (fk) $(`[data-fk="${fk}"]`)?.focus();
  });
});
podiumPanel.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.pd) e.target.blur();
});

// configuração
const setupPanel = $('#setup-panel');
setupPanel.addEventListener('change', async e => {
  const row = e.target.closest('[data-pid]');
  if (row && e.target.dataset.f) {
    const p = problemById(row.dataset.pid);
    const f = e.target.dataset.f;
    p[f] = f === 'name' ? e.target.value : (e.target.value.trim() || p[f]);
    return persist();
  }
  const tid = e.target.dataset.teamName;
  if (tid) {
    const v = e.target.value.trim();
    if (v) { teamById(tid).name = v; persist(); }
    return;
  }
  if (e.target.id === 'import-file') {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
      if (!['problems', 'rooms', 'teams', 'solves'].every(k => Array.isArray(data[k]))) throw new Error();
    } catch { return toast('Arquivo inválido.'); }
    if (!await ask('Substituir todos os dados atuais pelo arquivo importado?', { ok: 'Importar' })) return;
    data.podium = Array.isArray(data.podium) ? data.podium : [];
    state = data;
    ui.intro = true;
    save();
    toast('Dados importados.');
  }
});
setupPanel.addEventListener('click', async e => {
  const delProb = e.target.closest('[data-del-prob]')?.dataset.delProb;
  if (delProb) {
    const p = problemById(delProb);
    const n = state.solves.filter(s => s.problemId === delProb).length;
    if (!await ask(`Remover o problema ${p.letter}?${n ? ` ${n} acerto(s) serão apagados.` : ''}`, { ok: 'Remover' })) return;
    state.problems = state.problems.filter(x => x !== p);
    state.solves = state.solves.filter(s => s.problemId !== delProb);
    return save();
  }
  const delTeam = e.target.closest('[data-del-team]')?.dataset.delTeam;
  if (delTeam) {
    const t = teamById(delTeam);
    if (!await ask(`Excluir a equipe "${t.name}"?`, { ok: 'Excluir' })) return;
    deleteTeam(delTeam);
    return save();
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'add-prob') {
    const last = state.problems.at(-1)?.letter ?? '@';
    const letter = last.length === 1 && last < 'Z' ? String.fromCharCode(last.charCodeAt(0) + 1) : '?';
    state.problems.push({ id: uid(), letter, name: '', color: COLORS[state.problems.length % COLORS.length] });
    save();
  } else if (act === 'bulk-add') {
    const names = $('#bulk-teams').value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!names.length) return $('#bulk-teams').focus();
    const room = roomById($('#bulk-room').value);
    let skipped = 0;
    for (const name of names) {
      const t = { id: uid(), name };
      state.teams.push(t);
      if (room) {
        const seat = firstFreeSeat(room);
        if (seat) room.seats[seat] = t.id; else skipped++;
      }
    }
    save();
    toast(`${names.length} equipe(s) adicionada(s).${skipped ? ` A sala lotou: ${skipped} ficaram sem lugar.` : ''}`);
  } else if (act === 'export') {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `maratona-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } else if (act === 'import') {
    $('#import-file').click();
  } else if (act === 'reset-solves') {
    if (await ask('Apagar todos os acertos e balões? Salas e equipes são mantidas.', { ok: 'Zerar' })) { state.solves = []; save(); }
  } else if (act === 'reset-all') {
    if (await ask('Apagar TODOS os dados (salas, equipes, problemas e balões)?', { ok: 'Apagar tudo' })) {
      state = defaultState();
      ui.intro = true;
      save();
    }
  }
});

// sincronização entre abas: anima acertos que chegaram de outra aba
window.addEventListener('storage', e => {
  if (e.key !== KEY) return;
  const before = new Set(state.solves.map(s => s.id));
  state = load();
  render();
  if (ui.modal?.type === 'team') openTeam(ui.modal.id);
  for (const s of state.solves.filter(s => !before.has(s.id))) {
    const cell = $(`.cell[data-team="${s.teamId}"]`);
    celebrate(s, cell || $('#badge'));
  }
});

// relógio
const clock = $('#clock');
const tick = () => { clock.textContent = new Date().toLocaleTimeString('pt-BR'); };
tick();
setInterval(tick, 1000);

primeSeen();
raiseFx();
render();
