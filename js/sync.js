/* ═══════════════ sync.js — Conexión única: carpeta buzón con auto-importación ═══════════════
 * Conectas UNA carpeta una sola vez (File System Access API, Chrome/Edge).
 * El permiso queda guardado en IndexedDB; Sinapsis la vigila cada 30 s e
 * importa automáticamente cualquier export de conversación que aparezca.
 */
import { parseAuto } from './importers.js';
import { store } from './store.js';

const DB_NAME = 'sinapsis';
const DB_STORE = 'handles';
const MODS_KEY = 'sinapsis.sync.mods';   // ruta → lastModified ya procesados
const KEYS_KEY = 'sinapsis.sync.keys';   // claves de conversaciones ya importadas
const MAX_SIZE = 25 * 1024 * 1024;       // 25 MB por archivo
export const SCAN_EVERY_MS = 30000;

export const syncState = {
  handle: null,
  connected: false,
  folderName: '',
  lastScan: null,
  scanning: false,
  importedSession: 0,
  log: [],            // {ts, text}
  onChange: null,     // callback(event) para la UI
};

function emit(event, detail = {}) { syncState.onChange?.({ event, ...detail }); }
function logLine(text) {
  syncState.log.unshift({ ts: Date.now(), text });
  syncState.log = syncState.log.slice(0, 8);
}

/* ── IndexedDB: recordar la carpeta conectada ── */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(DB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function saveHandle(h) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(h, 'dropFolder');
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function dropHandle() {
  const db = await idb();
  return new Promise(res => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete('dropFolder');
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}
export async function loadHandle() {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const rq = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get('dropFolder');
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => rej(rq.error);
    });
  } catch { return null; }
}

/* ── Deduplicación de conversaciones ── */
export function dedupeKey(c) {
  const first = c.messages?.[0]?.ts || 0;
  return [c.source, c.title, (c.messages || []).length, first].join('|');
}
function loadKeys() {
  try { return new Set(JSON.parse(localStorage.getItem(KEYS_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveKeys(set) {
  try { localStorage.setItem(KEYS_KEY, JSON.stringify([...set].slice(-5000))); } catch {}
}

/* Importa conversaciones parseadas sin preguntar (para el auto-sync) */
export function importParsed(convs, { auto = true } = {}) {
  let added = 0;
  const keys = loadKeys();
  let dirty = false;
  for (const c of convs || []) {
    const k = dedupeKey(c);
    if (keys.has(k)) continue;
    const existing = store.byTitle(c.title);
    if (existing && existing.type === 'conversation' && (existing.messages?.length || 0) === (c.messages?.length || 0)) {
      keys.add(k); dirty = true; continue;
    }
    store.create({
      type: 'conversation', title: c.title, source: c.source || 'generic',
      participants: c.participants || [], messages: c.messages || [], content: '',
      auto, created: c.created ? c.created * 1000 : (c.messages?.[0]?.ts ? c.messages[0].ts * 1000 : Date.now()),
    });
    keys.add(k); dirty = true; added++;
  }
  if (dirty) { saveKeys(keys); store.save(); }
  return added;
}

/* ── Escaneo de la carpeta ── */
function loadMods() { try { return JSON.parse(localStorage.getItem(MODS_KEY) || '{}'); } catch { return {}; } }
function saveMods(m) { try { localStorage.setItem(MODS_KEY, JSON.stringify(m)); } catch {} }

async function collect(dir, prefix, out, depth) {
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'file') {
      if (/\.(json|txt)$/i.test(name) && !/sinapsis/i.test(name)) {
        try {
          const file = await h.getFile();
          out.push({ path: prefix + name, name, lastModified: file.lastModified, size: file.size, handle: h });
        } catch {}
      }
    } else if (h.kind === 'directory' && depth < 1 && !name.startsWith('.')) {
      try { await collect(h, prefix + name + '/', out, depth + 1); } catch {}
    }
  }
}

export async function scanNow() {
  if (!syncState.handle || syncState.scanning) return 0;
  if (!syncState.connected) return 0;
  syncState.scanning = true;
  let addedTotal = 0;
  try {
    const mods = loadMods();
    const files = [];
    await collect(syncState.handle, '', files, 0);
    let changedMods = false;
    for (const f of files) {
      if (mods[f.path] === f.lastModified) continue;
      if (f.size > MAX_SIZE) { mods[f.path] = f.lastModified; changedMods = true; continue; }
      try {
        const file = await f.handle.getFile();
        const text = await file.text();
        const { conversations } = parseAuto(text, f.name);
        const added = importParsed(conversations, { auto: true });
        if (added > 0) {
          addedTotal += added;
          logLine(`⚡ ${added} conv. nuevas ← ${f.path}`);
        }
      } catch {}
      mods[f.path] = f.lastModified;
      changedMods = true;
    }
    if (changedMods) saveMods(mods);
    syncState.lastScan = Date.now();
    syncState.importedSession += addedTotal;
  } catch {}
  syncState.scanning = false;
  emit('scan', { added: addedTotal });
  return addedTotal;
}

/* ── Conectar / reconectar / desconectar ── */
export function isSupported() { return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'; }

export async function connectFolder() {
  if (!isSupported()) throw new Error('unsupported');
  const h = await window.showDirectoryPicker({ mode: 'read' });
  syncState.handle = h;
  syncState.connected = true;
  syncState.folderName = h.name;
  try { await saveHandle(h); } catch {}
  startWatcher();
  logLine(`📁 Carpeta conectada: ${h.name}`);
  emit('connected');
  await scanNow();
  return h.name;
}

export async function tryRestore() {
  const h = await loadHandle();
  if (!h) return false;
  syncState.handle = h;
  syncState.folderName = h.name || 'carpeta';
  try {
    const perm = await h.queryPermission({ mode: 'read' });
    if (perm === 'granted') {
      syncState.connected = true;
      startWatcher();
      scanNow();
      emit('restored');
      return true;
    }
  } catch {}
  emit('needs-permission');
  return 'prompt';
}

export async function reconnect() {
  if (!syncState.handle) return false;
  try {
    const p = await syncState.handle.requestPermission({ mode: 'read' });
    if (p === 'granted') {
      syncState.connected = true;
      startWatcher();
      logLine('🔁 Conexión reactivada');
      emit('connected');
      scanNow();
      return true;
    }
  } catch {}
  return false;
}

export async function disconnect() {
  stopWatcher();
  try { await dropHandle(); } catch {}
  syncState.handle = null;
  syncState.connected = false;
  syncState.folderName = '';
  logLine('✂️ Carpeta desconectada');
  emit('disconnected');
}

export function startWatcher() {
  stopWatcher();
  syncState.timer = setInterval(scanNow, SCAN_EVERY_MS);
}
export function stopWatcher() {
  if (syncState.timer) clearInterval(syncState.timer);
  syncState.timer = null;
}
