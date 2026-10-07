/* ═══════════════ app.js — Controlador de la interfaz ═══════════════ */
import { store, SOURCE_META, computeGraph, norm, backlinksOf } from './store.js';
import { renderMarkdown, outline, conversationToMarkdown, escapeHtml } from './md.js';
import { parseAuto, parseGenericText, FORMAT_LABEL } from './importers.js';
import { seedSamples } from './samples.js';
import { Graph3D, NEON } from './graph3d.js';
import { syncState, connectFolder, scanNow, tryRestore, reconnect, disconnect, isSupported } from './sync.js';

/* ── Helpers ─────────────────────────────────────────── */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg, icon = '✅') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 3200);
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts > 1e12 ? ts : ts * 1000);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}
function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts > 1e12 ? ts : ts * 1000).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}
function snippet(n, max = 70) {
  const t = (n.content || (n.messages ? n.messages[n.messages.length - 1]?.text : '') || '').replace(/[#*>\[\]`|_-]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/* ── Estado ──────────────────────────────────────────── */
const state = {
  view: 'notes',
  noteId: null,
  chatId: null,
  editorMode: 'split',
  graph: null,
  graphData: null,
  filters: new Set(['manual', 'chatgpt', 'gemini', 'whatsapp', 'facebook', 'generic', 'person']),
  showMentions: true,
  pendingImport: null,
};

/* ── Navegación por vistas ───────────────────────────── */
function setView(name) {
  state.view = name;
  $$('.rail-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $$('.panel-view').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  const labels = { notes: '📝 Notas', chats: '💬 Conversaciones', graph: '🧠 Red neuronal 3D', import: '📥 Importar conversaciones', sync: '🔌 Conexiones automáticas' };
  if (name === 'sync') renderSyncStatus();
  let crumb = labels[name] || '';
  if (name === 'notes' && state.noteId) {
    const n = store.get(state.noteId);
    crumb = `📝 Notas / <b>${escapeHtml(n?.title || '')}</b>`;
  }
  if (name === 'chats' && state.chatId) {
    const n = store.get(state.chatId);
    crumb = `💬 Conversaciones / <b>${escapeHtml(n?.title || '')}</b>`;
  }
  $('#breadcrumb').innerHTML = crumb;

  if (name === 'graph') {
    ensureGraph();
    refreshGraph();
    state.graph?.start();
  } else {
    state.graph?.stop();
    state.graph?.clearSelection();
    const feed = $('#hud-feed'); if (feed) feed.innerHTML = '';
  }
}

/* ── Listas del panel ────────────────────────────────── */
function renderNotesList() {
  const q = norm($('#notes-search').value);
  const notes = store.plainNotes()
    .filter(n => !q || norm(n.title).includes(q) || norm(n.content).includes(q))
    .sort((a, b) => b.updated - a.updated);
  const el = $('#notes-list');
  if (!notes.length) {
    el.innerHTML = `<div class="list-empty">${q ? 'Sin resultados 🔍' : 'Aún no hay notas.<br>Pulsa <b>＋</b> para crear la primera.'}</div>`;
    return;
  }
  el.innerHTML = notes.map(n => `
    <button class="item ${n.id === state.noteId ? 'active' : ''}" data-id="${n.id}">
      <span class="item-icon" style="background:${SOURCE_META.manual.color}">📝</span>
      <span class="item-body">
        <span class="item-title">${escapeHtml(n.title)}</span>
        <span class="item-sub">${escapeHtml(snippet(n, 42)) || fmtDate(n.updated)}</span>
      </span>
    </button>`).join('');
  el.querySelectorAll('.item').forEach(b => b.onclick = () => openNote(b.dataset.id));
}

function renderChatsList() {
  const q = norm($('#chats-search').value);
  const convs = store.conversations()
    .filter(n => !q || norm(n.title).includes(q) || norm(store.searchText(n)).includes(q))
    .sort((a, b) => (b.created || 0) - (a.created || 0));
  const el = $('#chats-list');
  if (!convs.length) {
    el.innerHTML = `<div class="list-empty">${q ? 'Sin resultados 🔍' : 'Sin conversaciones todavía.<br>Importa tus chats desde <b>📥 Importar</b>.'}</div>`;
    return;
  }
  const groups = {};
  for (const c of convs) (groups[c.source] = groups[c.source] || []).push(c);
  let html = '';
  for (const src of ['chatgpt', 'gemini', 'whatsapp', 'facebook', 'generic']) {
    if (!groups[src]) continue;
    const meta = SOURCE_META[src];
    html += `<div class="list-group-title"><span class="dot ${src}"></span>${meta.label} · ${groups[src].length}</div>`;
    for (const c of groups[src]) {
      html += `
      <button class="item ${c.id === state.chatId ? 'active' : ''}" data-id="${c.id}">
        <span class="item-icon" style="background:${meta.color};${src === 'facebook' ? 'color:#fff' : ''}">${meta.icon}</span>
        <span class="item-body">
          <span class="item-title">${escapeHtml(c.title)}</span>
          <span class="item-sub">${c.messages?.length || 0} mensajes · ${fmtDate(c.created)}${c.auto ? ' · ⚡auto' : ''}</span>
        </span>
      </button>`;
    }
  }
  el.innerHTML = html;
  el.querySelectorAll('.item').forEach(b => b.onclick = () => openConversation(b.dataset.id));
}

function renderLegend() {
  const rows = Object.entries(NEON); // [clave, {color, label}]
  const dot = c => `<span class="dot" style="background:${c};color:${c}"></span>`;
  $('#graph-legend').innerHTML = rows.map(([k, m]) =>
    `<div class="legend-row">${dot(m.color)}${m.label}</div>`).join('')
    + '<div class="legend-row" style="margin-top:6px;color:var(--text-faint)">🌈 Los colores rotan solos, en bucle infinito</div>';
  $('#help-legend').innerHTML = rows.map(([k, m]) =>
    `<li><span class="dot" style="display:inline-block;margin-right:8px;background:${m.color};color:${m.color}"></span>${m.label}</li>`).join('');
  $('#graph-filters').innerHTML = rows.map(([k, m]) =>
    `<button class="chip on" data-type="${k}">${dot(m.color)}${m.label}</button>`).join('');
  $('#graph-filters').querySelectorAll('.chip').forEach(ch => ch.onclick = () => {
    ch.classList.toggle('on');
    const t = ch.dataset.type;
    if (ch.classList.contains('on')) state.filters.add(t); else state.filters.delete(t);
    state.graph?.setFilter(state.filters, state.showMentions);
  });
}

function renderStatus() {
  const notes = store.plainNotes().length;
  const convs = store.conversations().length;
  const g = state.graphData || computeGraph({ mentionLinks: state.showMentions });
  const people = g.nodes.filter(n => n.kind === 'person').length;
  $('#sb-counts').textContent = `${notes} notas · ${convs} conversaciones · ${people} personas · ${g.edges.length} conexiones`;
  const kb = Math.round(store.storageSize() / 1024);
  $('#sb-storage').textContent = `💾 ${kb} KB guardados localmente`;
}

function renderAll() {
  renderNotesList(); renderChatsList(); renderStatus();
}

/* ── Editor de notas ─────────────────────────────────── */
let saveTimer = null;

function openNote(id) {
  const n = store.get(id);
  if (!n) return;
  state.noteId = id;
  if (n.type === 'conversation') return openConversation(id);
  $('#editor-empty').classList.add('hidden');
  $('#editor').classList.remove('hidden');
  $('#ed-title').value = n.title;
  $('#ed-content').value = n.content || '';
  $('#ed-tags').value = (n.tags || []).map(t => '#' + t).join(' ');
  setEditorMode(state.editorMode);
  renderPreview(); renderBacklinks(); renderOutline(); renderEditorInfo();
  renderNotesList();
  if (state.view !== 'notes') setView('notes'); else $('#breadcrumb').innerHTML = `📝 Notas / <b>${escapeHtml(n.title)}</b>`;
}

function currentNote() { return store.get(state.noteId); }

function saveEditor(silent = false) {
  const n = currentNote();
  if (!n) return;
  const title = $('#ed-title').value.trim() || 'Sin título';
  const content = $('#ed-content').value;
  const tags = $('#ed-tags').value.split(/[,\s]+/).map(t => t.replace(/^#/, '').toLowerCase()).filter(Boolean);
  store.update(n.id, { title, content, tags });
  renderNotesList(); renderBacklinks(); renderOutline(); renderEditorInfo(); renderStatus();
  if (!silent) toast('Nota guardada', '💾');
}
const saveEditorDebounced = debounce(() => saveEditor(true), 450);

function renderPreview() {
  $('#ed-preview').innerHTML = renderMarkdown($('#ed-content').value);
}
function renderBacklinks() {
  const n = currentNote(); if (!n) return;
  const links = backlinksOf(n.id);
  $('#ed-backlinks').innerHTML = links.length
    ? links.map(l => `<a data-id="${l.note.id}">${l.type === 'wiki' ? '🔗' : '💬'} ${escapeHtml(l.note.title)}</a>`).join('')
    : '<div class="side-empty">Ninguna nota la menciona todavía.<br>Enlázala con [[…]]</div>';
  $('#ed-backlinks').querySelectorAll('a').forEach(a => a.onclick = () => {
    const t = store.get(a.dataset.id);
    if (t?.type === 'conversation') openConversation(t.id); else openNote(a.dataset.id);
  });
}
function renderOutline() {
  const heads = outline($('#ed-content').value);
  $('#ed-outline').innerHTML = heads.length
    ? heads.map(h => `<a style="padding-left:${(h.level - 1) * 12}px">${escapeHtml(h.text)}</a>`).join('')
    : '<div class="side-empty">Usa # Títulos para crear un esquema.</div>';
}
function renderEditorInfo() {
  const n = currentNote(); if (!n) return;
  const words = ($('#ed-content').value.match(/\S+/g) || []).length;
  $('#ed-info').textContent = `${words} palabras · creada ${fmtDate(n.created)} · editada ${fmtDate(n.updated)}`;
}

function setEditorMode(mode) {
  state.editorMode = mode;
  const body = $('#ed-body');
  body.classList.remove('mode-edit', 'mode-read');
  if (mode === 'edit') body.classList.add('mode-edit');
  if (mode === 'read') body.classList.add('mode-read');
  $$('#ed-mode button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}

/* Autocompletado [[ ]] */
function caretCoords(ta) {
  const div = document.createElement('div');
  const style = getComputedStyle(ta);
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'padding', 'letterSpacing', 'whiteSpace', 'wordWrap', 'border']) div.style[p] = style[p];
  div.style.position = 'absolute'; div.style.visibility = 'hidden'; div.style.whiteSpace = 'pre-wrap'; div.style.width = ta.clientWidth + 'px';
  div.textContent = ta.value.slice(0, ta.selectionStart);
  const span = document.createElement('span'); span.textContent = '​'; div.appendChild(span);
  document.body.appendChild(div);
  const top = span.offsetTop - ta.scrollTop, left = span.offsetLeft - ta.scrollLeft;
  document.body.removeChild(div);
  return { top, left };
}

let wikiIdx = 0, wikiItems = [];
function updateWikiPopup() {
  const ta = $('#ed-content');
  const before = ta.value.slice(0, ta.selectionStart);
  const m = before.match(/\[\[([^\]\n]*)$/);
  const pop = $('#wiki-popup');
  if (!m) { pop.classList.add('hidden'); return; }
  const q = norm(m[1]);
  const matches = store.all().filter(n => norm(n.title).includes(q)).slice(0, 8);
  wikiItems = matches.map(n => n.title);
  if (m[1].trim() && !store.byTitle(m[1].trim())) wikiItems.push(m[1].trim() + '||NEW');
  if (!wikiItems.length) { pop.classList.add('hidden'); return; }
  wikiIdx = 0;
  pop.innerHTML = wikiItems.map((t, i) => {
    const isNew = t.endsWith('||NEW');
    const label = isNew ? `Crear “${escapeHtml(t.slice(0, -6))}”` : escapeHtml(t);
    return `<div class="wk-item ${i === 0 ? 'sel' : ''} ${isNew ? 'wk-new' : ''}" data-i="${i}">${isNew ? '✨' : '📄'} ${label}</div>`;
  }).join('');
  const c = caretCoords(ta);
  pop.style.top = Math.min(c.top + 26, ta.clientHeight - 60) + 'px';
  pop.style.left = Math.min(c.left + 8, ta.clientWidth - 290) + 'px';
  pop.classList.remove('hidden');
  pop.querySelectorAll('.wk-item').forEach(el => el.onmousedown = e => { e.preventDefault(); pickWiki(+el.dataset.i); });
}
function pickWiki(i) {
  const item = wikiItems[i]; if (item === undefined) return;
  const ta = $('#ed-content');
  const before = ta.value.slice(0, ta.selectionStart);
  const m = before.match(/\[\[([^\]\n]*)$/);
  if (!m) return;
  const isNew = item.endsWith('||NEW');
  const title = isNew ? item.slice(0, -6) : item;
  const start = ta.selectionStart - m[1].length;
  ta.value = ta.value.slice(0, start) + title + ']]' + ta.value.slice(ta.selectionStart);
  ta.selectionStart = ta.selectionEnd = start + title.length + 2;
  $('#wiki-popup').classList.add('hidden');
  ta.focus();
  saveEditorDebounced(); renderPreview();
  if (isNew) toast(`Enlace creado: al escribir [[${title}]] podrás crearla`, '🔗');
}
function moveWiki(d) {
  const pop = $('#wiki-popup');
  if (pop.classList.contains('hidden') || !wikiItems.length) return false;
  wikiIdx = (wikiIdx + d + wikiItems.length) % wikiItems.length;
  pop.querySelectorAll('.wk-item').forEach((el, i) => el.classList.toggle('sel', i === wikiIdx));
  return true;
}

/* ── Lector de conversaciones ────────────────────────── */
function openConversation(id) {
  const c = store.get(id);
  if (!c || c.type !== 'conversation') return;
  state.chatId = id; state.noteId = null;
  $('#chat-empty').classList.add('hidden');
  $('#chat-reader').classList.remove('hidden');
  const meta = SOURCE_META[c.source] || SOURCE_META.generic;
  const badge = $('#cr-badge');
  badge.textContent = meta.icon + ' ' + meta.label;
  badge.style.background = meta.color + '26';
  badge.style.color = meta.color;
  badge.style.border = `1px solid ${meta.color}66`;
  $('#cr-title').textContent = c.title;
  const first = c.messages?.[0]?.ts, last = c.messages?.[c.messages.length - 1]?.ts;
  $('#cr-stats').innerHTML = `<span>💬 ${c.messages?.length || 0} mensajes</span><span>👥 ${escapeHtml((c.participants || []).join(', '))}</span><span>📅 ${fmtDate(first)}${first !== last ? ' → ' + fmtDate(last) : ''}</span>`;
  renderMessages('');
  renderChatsList();
  if (state.view !== 'chats') setView('chats'); else $('#breadcrumb').innerHTML = `💬 Conversaciones / <b>${escapeHtml(c.title)}</b>`;
}

function isMe(m) { return m.role === 'user' || /^(tú|tu|yo)$/i.test(m.sender || ''); }

function avatarColor(name) {
  let h = 0; for (const ch of (name || '?')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 70% 62%)`;
}

function renderMessages(q) {
  const c = store.get(state.chatId); if (!c) return;
  const el = $('#cr-messages');
  const qq = norm(q);
  let html = '', lastDay = '', shown = 0;
  for (const m of c.messages || []) {
    if (qq && !norm(m.text).includes(qq)) continue;
    shown++;
    const d = m.ts ? fmtDate(m.ts) : '';
    if (d && d !== lastDay) { html += `<div class="msg-day">${d}</div>`; lastDay = d; }
    let text = escapeHtml(m.text || '');
    if (qq) text = text.replace(new RegExp(qq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), w => `<mark>${w}</mark>`);
    const me = isMe(m);
    html += `
    <div class="msg-row ${me ? 'me' : ''}">
      <span class="msg-avatar" style="background:${avatarColor(m.sender)}">${escapeHtml((m.sender || '?')[0].toUpperCase())}</span>
      <div class="msg-col">
        <span class="msg-name">${escapeHtml(m.sender || '?')}</span>
        <div class="bubble">${text}</div>
        <span class="msg-time">${fmtTime(m.ts)}</span>
      </div>
    </div>`;
  }
  el.innerHTML = shown ? html : '<div class="list-empty">Sin mensajes que coincidan 🔍</div>';
  el.scrollTop = 0;
}

/* ── Red 3D ──────────────────────────────────────────── */
/* ── Conexiones automáticas (carpeta buzón) ──────────── */
function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString('es-MX', { hour12: false });
}

function renderSyncStatus() {
  const s = syncState;
  const dot = $('#sync-dot');
  dot.className = 'sync-status-dot' + (s.connected ? ' on' : s.handle ? ' paused' : '');
  $('#sync-title').textContent = s.connected
    ? `Carpeta conectada: ${s.folderName}`
    : s.handle ? 'Conexión en pausa' : 'Sin conectar';
  $('#sync-desc').innerHTML = s.connected
    ? 'Vigilando archivos <code>.json</code>/<code>.txt</code> cada 30 segundos. Todo lo nuevo se importa solo a tu red.'
    : s.handle
      ? 'Tu carpeta sigue recordada, pero el navegador pide permiso otra vez (es un clic, por seguridad).'
      : 'Elige una carpeta (por ejemplo "Descargas" o una carpeta llamada "Chats"). Sinapsis la vigilará y auto-importará archivos <code>.json</code> y <code>.txt</code> con conversaciones.';
  $('#sync-stats').textContent = s.connected
    ? `Último escaneo: ${s.lastScan ? fmtClock(s.lastScan) : '—'} · auto-importadas esta sesión: ${s.importedSession}`
    : '';
  $('#btn-connect').classList.toggle('hidden', !!s.handle);
  $('#btn-reconnect').classList.toggle('hidden', !(s.handle && !s.connected));
  $('#btn-disconnect').classList.toggle('hidden', !s.handle);
  $('#btn-rescan').disabled = !s.connected;
  $('#btn-rescan').style.opacity = s.connected ? '1' : '.45';
  // mini estado del panel lateral
  const mini = $('#sync-mini-status');
  if (mini) {
    mini.innerHTML = s.connected
      ? `<div class="legend-row"><span class="sync-status-dot on" style="width:9px;height:9px"></span>Vigilando “${s.folderName}”</div>
         <div class="panel-hint small" style="padding:6px 0 0">Último escaneo: ${s.lastScan ? fmtClock(s.lastScan) : '—'}</div>`
      : s.handle
        ? `<div class="legend-row"><span class="sync-status-dot paused" style="width:9px;height:9px"></span>En pausa — toca “Reconectar”</div>`
        : `<div class="legend-row" style="color:var(--text-faint)">Sin carpeta conectada</div>`;
  }
  // log de actividad
  const logEl = $('#sync-log');
  if (logEl) {
    logEl.innerHTML = s.log.length
      ? s.log.map(l => `<div class="sl-line"><span class="fx-t">${fmtClock(l.ts)}</span> ${escapeHtml(l.text)}</div>`).join('')
      : '<div class="sync-log-empty">Sin actividad todavía…</div>';
  }
}

/* ── HUD estilo IA de trading ────────────────────────── */
const hudState = { signals: [], lastFeed: 0 };

function pushFeedLine(edge, isBurst) {
  const g = state.graphData; if (!g) return;
  const a = g.nodes.find(n => n.id === edge.a), b = g.nodes.find(n => n.id === edge.b);
  if (!a || !b) return;
  const feed = $('#hud-feed'); if (!feed) return;
  const el = document.createElement('div');
  el.className = 'feed-line';
  const t = new Date().toLocaleTimeString('es-MX', { hour12: false });
  el.innerHTML = `<span class="fx-t">${t}</span> ${isBurst ? '🔥' : '⚡'} <b>${escapeHtml(a.title)}</b> ⟶ ${escapeHtml(b.title)}`;
  feed.prepend(el);
  while (feed.children.length > 6) feed.lastChild.remove();
}

function startHudUpdater() {
  setInterval(() => {
    if (state.view !== 'graph') return;
    const g = state.graphData;
    $('#hud-nodes').textContent = g ? g.nodes.length : 0;
    $('#hud-edges').textContent = g ? g.edges.length : 0;
    const now = Date.now();
    hudState.signals = hudState.signals.filter(x => now - x < 60000);
    $('#hud-rate').textContent = hudState.signals.length;
    const active = state.graph ? state.graph.pulses.length : 0;
    $('#hud-meter-bar').style.width = Math.min(100, active / 80 * 100).toFixed(0) + '%';
  }, 1000);
}

function ensureGraph() {
  if (state.graph) return;
  state.graph = new Graph3D($('#graph-container'), {
    tooltipEl: $('#graph-tooltip'),
    onSignal: (e, isBurst) => {
      hudState.signals.push(Date.now());
      const now = Date.now();
      if (now - hudState.lastFeed > 900) { hudState.lastFeed = now; pushFeedLine(e, isBurst); }
    },
    onOpen: id => {
      const n = store.get(id);
      if (!n) return;
      if (n.type === 'conversation') openConversation(id); else openNote(id);
    },
    onFocus: node => {
      const bar = $('#graph-focus-bar');
      if (!node) { bar.classList.add('hidden'); return; }
      bar.classList.remove('hidden');
      $('#graph-focus-label').innerHTML = `🔎 Enfocado en <b>${escapeHtml(node.title)}</b> y sus conexiones`;
    },
  });
}

function refreshGraph() {
  ensureGraph();
  state.graphData = computeGraph({ mentionLinks: state.showMentions });
  const empty = !state.graphData.nodes.length;
  $('#graph-empty').classList.toggle('hidden', !empty);
  if (!empty) {
    state.graph.setData(state.graphData);
    state.graph.setFilter(state.filters, state.showMentions);
    state.graph.setLabels($('#tgl-labels').checked);
  }
  renderStatus();
}

/* ── Importación ─────────────────────────────────────── */
function handleFiles(files) {
  const list = [...files];
  if (!list.length) return;
  let done = 0;
  const results = [];
  for (const f of list) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      const parsed = parseAuto(text, f.name);
      results.push(...parsed.conversations.map(c => ({ ...c, _file: f.name })));
      if (++done === list.length) showImportPreview(results, list.length === 1 ? list[0].name : `${list.length} archivos`);
    };
    reader.readAsText(f);
  }
}

function showImportPreview(convs, srcLabel) {
  if (!convs.length) { toast('No se encontraron conversaciones en el archivo', '⚠️'); return; }
  state.pendingImport = convs;
  const byFmt = {};
  for (const c of convs) byFmt[c.source] = (byFmt[c.source] || 0) + 1;
  $('#ip-title').textContent = `📥 Importar desde ${srcLabel}`;
  $('#ip-sub').innerHTML = `Se detectaron <b>${convs.length}</b> conversaciones (${Object.entries(byFmt).map(([s, n]) => `${(SOURCE_META[s] || SOURCE_META.generic).label}: ${n}`).join(' · ')}). Elige cuáles añadir a tu red:`;
  $('#ip-list').innerHTML = convs.map((c, i) => `
    <label class="ip-item">
      <input type="checkbox" data-i="${i}" checked>
      <span class="dot ${c.source}"></span>
      <span>${escapeHtml(c.title)}</span>
      <span class="ip-n">${c.messages?.length || 0} msgs</span>
    </label>`).join('');
  $('#ip-count').textContent = `${convs.length} seleccionadas`;
  $('#ip-all').checked = true;
  $('#import-preview').classList.remove('hidden');
  $('#ip-list').querySelectorAll('input').forEach(cb => cb.onchange = () => {
    const n = $('#ip-list').querySelectorAll('input:checked').length;
    $('#ip-count').textContent = `${n} seleccionadas`;
    $('#ip-all').checked = n === convs.length;
  });
  $('#ip-all').onchange = e => {
    $('#ip-list').querySelectorAll('input').forEach(cb => cb.checked = e.target.checked);
    $('#ip-count').textContent = `${e.target.checked ? convs.length : 0} seleccionadas`;
  };
}

function confirmImport() {
  const convs = state.pendingImport || [];
  const picked = [...$('#ip-list').querySelectorAll('input:checked')].map(cb => convs[+cb.dataset.i]);
  let added = 0;
  for (const c of picked) {
    if (store.byTitle(c.title)) { // evitar duplicados exactos
      const exists = store.byTitle(c.title);
      if (exists.type === 'conversation' && exists.messages?.length === c.messages?.length) continue;
    }
    store.create({
      type: 'conversation', title: c.title, source: c.source || 'generic',
      participants: c.participants || [], messages: c.messages || [], content: '',
      created: c.created ? c.created * 1000 : (c.messages?.[0]?.ts ? c.messages[0].ts * 1000 : Date.now()),
    });
    added++;
  }
  $('#import-preview').classList.add('hidden');
  state.pendingImport = null;
  renderAll();
  toast(added ? `¡${added} conversaciones añadidas a tu red neuronal!` : 'No se añadieron nuevas (ya existían)', added ? '🧠' : 'ℹ️');
  if (state.view === 'graph') refreshGraph();
}

/* ── Paleta de comandos ──────────────────────────────── */
let palIdx = 0, palItems = [];

function openPalette(prefill = '') {
  $('#palette').classList.remove('hidden');
  $('#palette-input').value = prefill;
  $('#palette-input').focus();
  updatePalette();
}
function closePalette() { $('#palette').classList.add('hidden'); }

const ACTIONS = [
  { icon: '📝', title: 'Nueva nota', sub: 'acción', run: () => newNote() },
  { icon: '🧠', title: 'Abrir red neuronal 3D', sub: 'acción', run: () => setView('graph') },
  { icon: '📥', title: 'Importar conversaciones', sub: 'acción', run: () => setView('import') },
  { icon: '🔌', title: 'Conexiones automáticas (carpeta buzón)', sub: 'acción', run: () => setView('sync') },
  { icon: '💬', title: 'Ver conversaciones', sub: 'acción', run: () => setView('chats') },
  { icon: '✨', title: 'Cargar contenido demo', sub: 'acción', run: () => { seedSamples(); renderAll(); toast('Ejemplos cargados'); } },
  { icon: '❓', title: 'Ayuda y atajos', sub: 'acción', run: () => $('#help-modal').classList.remove('hidden') },
  { icon: '⚙️', title: 'Configuración', sub: 'acción', run: () => $('#settings-modal').classList.remove('hidden') },
];

function updatePalette() {
  const q = norm($('#palette-input').value);
  const items = [];
  for (const a of ACTIONS) if (!q || norm(a.title).includes(q)) items.push({ icon: a.icon, title: a.title, sub: a.sub, run: a.run });
  for (const n of store.all()) {
    if (q && !norm(n.title).includes(q) && !norm(store.searchText(n)).includes(q)) continue;
    const isConv = n.type === 'conversation';
    items.push({
      icon: isConv ? (SOURCE_META[n.source]?.icon || '💬') : '📝',
      title: n.title,
      sub: isConv ? (SOURCE_META[n.source]?.label || 'chat') : 'nota',
      run: () => isConv ? openConversation(n.id) : openNote(n.id),
    });
    if (items.length > 40) break;
  }
  palItems = items; palIdx = 0;
  $('#palette-results').innerHTML = items.map((it, i) =>
    `<div class="pal-item ${i === 0 ? 'sel' : ''}" data-i="${i}"><span class="pal-icon">${it.icon}</span><span>${escapeHtml(it.title)}</span><span class="pal-sub">${it.sub}</span></div>`).join('')
    || '<div class="list-empty">Sin resultados</div>';
  $('#palette-results').querySelectorAll('.pal-item').forEach(el => {
    el.onmouseenter = () => { palIdx = +el.dataset.i; paintPal(); };
    el.onclick = () => runPal();
  });
}
function paintPal() {
  $$('#palette-results .pal-item').forEach((el, i) => el.classList.toggle('sel', i === palIdx));
  $('#palette-results .pal-item.sel')?.scrollIntoView({ block: 'nearest' });
}
function runPal() {
  const it = palItems[palIdx];
  closePalette();
  it?.run();
}

/* ── Búsqueda global (topbar) ────────────────────────── */
const updateGlobalSearch = debounce(() => {
  const q = norm($('#global-search').value);
  const box = $('#global-results');
  if (!q) { box.classList.add('hidden'); return; }
  const hits = store.all()
    .filter(n => norm(n.title).includes(q) || norm(store.searchText(n)).includes(q))
    .slice(0, 8);
  if (!hits.length) { box.innerHTML = '<div class="list-empty">Sin resultados</div>'; box.classList.remove('hidden'); return; }
  box.innerHTML = hits.map(n => {
    const meta = n.type === 'conversation' ? SOURCE_META[n.source] : SOURCE_META.manual;
    return `<button class="item" data-id="${n.id}">
      <span class="item-icon" style="background:${meta.color}">${meta.icon}</span>
      <span class="item-body"><span class="item-title">${escapeHtml(n.title)}</span>
      <span class="d-sub">${escapeHtml(snippet(n, 60))}</span></span></button>`;
  }).join('');
  box.classList.remove('hidden');
  box.querySelectorAll('.item').forEach(b => b.onclick = () => {
    const n = store.get(b.dataset.id);
    box.classList.add('hidden'); $('#global-search').value = '';
    if (n.type === 'conversation') openConversation(n.id); else openNote(n.id);
  });
}, 200);

/* ── Nueva nota / acciones ───────────────────────────── */
function newNote(title = '') {
  const n = store.create({ title: title || 'Nueva nota', content: '', type: 'note', source: 'manual' });
  renderAll();
  openNote(n.id);
  setTimeout(() => { $('#ed-title').focus(); $('#ed-title').select(); }, 50);
  return n;
}

function downloadText(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── Inicialización de eventos ───────────────────────── */
function initEvents() {
  // Rail
  $$('.rail-btn[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
  $('#btn-help').onclick = () => $('#help-modal').classList.remove('hidden');
  $('#btn-settings').onclick = () => $('#settings-modal').classList.remove('hidden');

  // Panel notas
  $('#btn-new-note').onclick = () => newNote();
  $('#btn-quick-note').onclick = () => newNote();
  $('#empty-new-note').onclick = () => newNote();
  $('#graph-empty-new').onclick = () => newNote();
  $('#notes-search').oninput = renderNotesList;
  $('#chats-search').oninput = renderChatsList;
  $('#btn-go-import').onclick = () => setView('import');
  $('#empty-import').onclick = () => setView('import');
  $('#graph-empty-import').onclick = () => setView('import');
  const loadSamples = () => { const n = seedSamples(); renderAll(); if (state.view === 'graph') refreshGraph(); toast(n ? `${n} elementos de ejemplo cargados` : 'Los ejemplos ya estaban cargados', '✨'); };
  $('#empty-samples').onclick = loadSamples;
  $('#empty-samples2').onclick = loadSamples;
  $('#set-samples').onclick = loadSamples;

  // Gráficos del panel red
  $('#tgl-labels').onchange = e => state.graph?.setLabels(e.target.checked);
  $('#tgl-mentions').onchange = e => { state.showMentions = e.target.checked; store.data.settings.mentionLinks = state.showMentions; store.save(); if (state.view === 'graph') refreshGraph(); else renderStatus(); };
  $('#graph-unfocus').onclick = () => state.graph?.clearFocus();

  // Editor
  $('#ed-mode').querySelectorAll('button').forEach(b => b.onclick = () => { setEditorMode(b.dataset.mode); });
  $('#ed-title').oninput = saveEditorDebounced;
  $('#ed-tags').oninput = saveEditorDebounced;
  $('#ed-content').oninput = () => { saveEditorDebounced(); renderPreview(); updateWikiPopup(); };
  $('#ed-content').onkeydown = e => {
    const pop = $('#wiki-popup');
    if (!pop.classList.contains('hidden')) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveWiki(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveWiki(-1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickWiki(wikiIdx); return; }
      if (e.key === 'Escape') { pop.classList.add('hidden'); return; }
    }
    if (e.key === 'Tab') { // indentar
      e.preventDefault();
      const ta = e.target, s = ta.selectionStart;
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + 2;
      saveEditorDebounced(); renderPreview();
    }
  };
  $('#ed-content').onclick = updateWikiPopup;
  $('#ed-preview').onclick = e => {
    const wl = e.target.closest('.wikilink');
    if (wl) {
      const target = wl.dataset.wiki;
      const exists = store.byTitle(target);
      if (exists) { exists.type === 'conversation' ? openConversation(exists.id) : openNote(exists.id); }
      else { const n = newNote(target); n.content = ''; saveEditor(true); toast(`Nota “${target}” creada`, '✨'); }
      return;
    }
    const tag = e.target.closest('.md-tag');
    if (tag) {
      $('#notes-search').value = '#' + tag.dataset.tag;
      setView('notes');
      const q = norm(tag.dataset.tag);
      $('#notes-list').innerHTML = store.all().filter(n => (n.tags || []).some(t => norm(t).includes(q)) || norm(n.content).includes('#' + q))
        .map(n => `<button class="item" data-id="${n.id}"><span class="item-icon" style="background:${SOURCE_META.manual.color}">📝</span><span class="item-body"><span class="item-title">${escapeHtml(n.title)}</span></span></button>`).join('')
        || '<div class="list-empty">Sin notas con esta etiqueta</div>';
      $('#notes-list').querySelectorAll('.item').forEach(b => b.onclick = () => { const t = store.get(b.dataset.id); t.type === 'conversation' ? openConversation(t.id) : openNote(t.id); });
    }
  };
  $('#ed-delete').onclick = () => {
    const n = currentNote(); if (!n) return;
    if (!confirm(`¿Eliminar la nota “${n.title}”?`)) return;
    store.remove(n.id);
    state.noteId = null;
    $('#editor').classList.add('hidden');
    $('#editor-empty').classList.remove('hidden');
    renderAll();
    if (state.view === 'graph') refreshGraph();
    toast('Nota eliminada', '🗑');
  };
  $('#ed-download').onclick = () => {
    const n = currentNote(); if (!n) return;
    downloadText(n.title.replace(/[^\w\- ]/g, '') + '.md', `# ${n.title}\n\n${n.content}`);
    toast('Descargada como Markdown', '⬇');
  };
  $('#ed-graph').onclick = () => {
    const n = currentNote(); if (!n) return;
    setView('graph');
    setTimeout(() => state.graph?.focusNode(n.id), 400);
  };

  // Lector de chats
  $('#cr-search').oninput = e => renderMessages(e.target.value);
  $('#cr-delete').onclick = () => {
    const c = store.get(state.chatId); if (!c) return;
    if (!confirm(`¿Eliminar la conversación “${c.title}”?`)) return;
    store.remove(c.id);
    state.chatId = null;
    $('#chat-reader').classList.add('hidden');
    $('#chat-empty').classList.remove('hidden');
    renderAll();
    if (state.view === 'graph') refreshGraph();
    toast('Conversación eliminada', '🗑');
  };
  $('#cr-tonote').onclick = () => {
    const c = store.get(state.chatId); if (!c) return;
    const n = store.create({ type: 'note', title: c.title + ' (nota)', content: conversationToMarkdown(c), source: 'manual' });
    renderAll();
    openNote(n.id);
    toast('Convertida en nota editable', '📝');
  };
  $('#cr-graph').onclick = () => {
    const c = store.get(state.chatId); if (!c) return;
    setView('graph');
    setTimeout(() => state.graph?.focusNode(c.id), 400);
  };

  // Importación
  $$('.import-card').forEach(card => {
    const src = card.dataset.src;
    card.querySelector('button').onclick = () => {
      if (src === 'samples') { loadSamples(); return; }
      if (src === 'generic') { $('#paste-modal').classList.remove('hidden'); $('#paste-title').focus(); return; }
      $('#file-input').click();
    };
  });
  $('#file-input').onchange = e => { handleFiles(e.target.files); e.target.value = ''; };
  $('#ip-confirm').onclick = confirmImport;
  $('#paste-confirm').onclick = () => {
    const text = $('#paste-text').value.trim();
    if (!text) { toast('Pega primero la conversación', '⚠️'); return; }
    const convs = parseGenericText(text, $('#paste-title').value.trim() || 'Conversación pegada');
    $('#paste-modal').classList.add('hidden');
    $('#paste-text').value = ''; $('#paste-title').value = '';
    showImportPreview(convs || [], 'texto pegado');
  };
  // Drag & drop
  const dropZone = $('#import-drop');
  ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
    e.preventDefault();
    if (state.view === 'import') dropZone.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => {
    e.preventDefault();
    if (ev === 'dragleave' && e.relatedTarget) return;
    dropZone.classList.remove('dragging');
    if (ev === 'drop' && e.dataTransfer?.files?.length) { setView('import'); handleFiles(e.dataTransfer.files); }
  }));

  // Conexiones automáticas
  $('#btn-connect').onclick = async () => {
    try {
      const name = await connectFolder();
      renderSyncStatus();
      toast(`Carpeta “${name}” conectada — la vigilancia es automática`, '🔌');
    } catch (err) {
      if (err?.name === 'AbortError') return; // usuario canceló
      if (err?.message === 'unsupported') { $('#sync-unsupported').classList.remove('hidden'); return; }
      toast('No se pudo conectar la carpeta', '⚠️');
    }
  };
  $('#btn-reconnect').onclick = async () => {
    const ok = await reconnect();
    renderSyncStatus();
    toast(ok ? 'Conexión reactivada' : 'Permiso no concedido', ok ? '🔌' : '⚠️');
  };
  $('#btn-rescan').onclick = async () => {
    const n = await scanNow();
    renderSyncStatus();
    if (n > 0) { renderAll(); if (state.view === 'graph') refreshGraph(); toast(`⚡ ${n} conversaciones importadas automáticamente`, '🔌'); }
    else toast('Escaneo completo: nada nuevo', '🔍');
  };
  $('#btn-disconnect').onclick = async () => {
    if (!confirm('¿Desconectar la carpeta? (Tus conversaciones ya importadas se quedan.)')) return;
    await disconnect();
    renderSyncStatus();
    toast('Carpeta desconectada', '✂️');
  };
  syncState.onChange = ({ event, added }) => {
    renderSyncStatus();
    if (event === 'scan' && added > 0) {
      renderAll();
      if (state.view === 'graph') refreshGraph();
      toast(`⚡ ${added} conversaciones nuevas importadas automáticamente`, '🔌');
    }
  };

  // Paleta
  $('#btn-palette').onclick = () => openPalette();
  $('#palette-input').oninput = updatePalette;
  $('#palette-input').onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); palIdx = Math.min(palIdx + 1, palItems.length - 1); paintPal(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); palIdx = Math.max(palIdx - 1, 0); paintPal(); }
    if (e.key === 'Enter') { e.preventDefault(); runPal(); }
  };

  // Búsqueda global
  $('#global-search').oninput = updateGlobalSearch;
  $('#global-search').onkeydown = e => {
    if (e.key === 'Enter') { $('#global-results .item')?.click(); }
    if (e.key === 'Escape') { $('#global-results').classList.add('hidden'); e.target.blur(); }
  };
  document.addEventListener('click', e => {
    if (!e.target.closest('.topbar-search')) $('#global-results').classList.add('hidden');
  });

  // Modales: cerrar
  $$('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', e => {
      if (e.target === ov && ov.id !== 'onboarding') ov.classList.add('hidden');
    });
    ov.querySelectorAll('[data-close]').forEach(b => b.onclick = () => ov.classList.add('hidden'));
  });

  // Onboarding
  $('#ob-samples').onclick = () => {
    finishOnboarding();
    loadSamples();
  };
  $('#ob-blank').onclick = () => finishOnboarding();

  // Ajustes
  $('#set-export').onclick = () => { downloadText('sinapsis-backup.json', store.exportVault(), 'application/json'); toast('Copia exportada', '💾'); };
  $('#set-import').onclick = () => $('#backup-input').click();
  $('#backup-input').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        store.importVault(String(r.result), 'merge');
        renderAll();
        if (state.view === 'graph') refreshGraph();
        toast('Copia importada', '💾');
      } catch (err) { toast('Archivo de copia no válido', '⚠️'); }
    };
    r.readAsText(f);
    e.target.value = '';
  };
  $('#set-wipe').onclick = () => {
    if (!confirm('¿Borrar TODAS las notas y conversaciones? Esta acción no se puede deshacer.')) return;
    store.data.notes = [];
    store.save();
    state.noteId = state.chatId = null;
    $('#editor').classList.add('hidden'); $('#editor-empty').classList.remove('hidden');
    $('#chat-reader').classList.add('hidden'); $('#chat-empty').classList.remove('hidden');
    renderAll();
    if (state.view === 'graph') refreshGraph();
    toast('Todo borrado', '🗑');
  };

  // Atajos de teclado
  document.addEventListener('keydown', e => {
    const inField = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); openPalette(); return; }
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); return; }
    if (e.altKey && ['1', '2', '3', '4', '5'].includes(e.key)) { e.preventDefault(); setView(['notes', 'chats', 'graph', 'import', 'sync'][+e.key - 1]); return; }
    if (e.key === 'F1') { e.preventDefault(); $('#help-modal').classList.toggle('hidden'); return; }
    if (e.key === 'Escape') {
      if (!$('#palette').classList.contains('hidden')) closePalette();
      else if (state.graph?.focusId && state.view === 'graph') state.graph.clearFocus();
      else $$('.modal-overlay:not(.hidden)').forEach(m => { if (m.id !== 'onboarding') m.classList.add('hidden'); });
    }
    if (inField) return;
    if (e.key === '/') { e.preventDefault(); $('#global-search').focus(); }
  });
}

function finishOnboarding() {
  store.data.settings.onboardingDone = true;
  store.save();
  $('#onboarding').classList.add('hidden');
  if (state.view === 'graph') refreshGraph();
}

/* ── Arranque ────────────────────────────────────────── */
function init() {
  store.load();
  state.showMentions = store.data.settings.mentionLinks !== false;
  $('#tgl-mentions').checked = state.showMentions;
  $('#tgl-labels').checked = !!store.data.settings.labels;
  renderLegend();
  renderAll();
  initEvents();
  startHudUpdater();
  // restaurar conexión de carpeta (queda recordada de sesiones anteriores)
  if (!isSupported()) {
    $('#sync-unsupported').classList.remove('hidden');
    $('#btn-connect').disabled = true;
    $('#btn-connect').style.opacity = '.45';
  } else {
    tryRestore().then(r => renderSyncStatus());
  }
  renderSyncStatus();
  if (!store.data.settings.onboardingDone) {
    $('#onboarding').classList.remove('hidden');
  } else if (store.plainNotes().length) {
    openNote(store.plainNotes().sort((a, b) => b.updated - a.updated)[0].id);
  }
  setView('notes');
}

init();
