/* ═══════════════ github.js — Respaldo automático de la bóveda en GitHub ═══════════════
 * Conectas un repo una sola vez (token fine-grained con permiso Contents: R/W).
 * La bóveda se sube sola cada 60 s si hubo cambios, y se puede descargar/fusionar.
 * El token vive SOLO en el navegador del usuario y solo se envía a api.github.com.
 */
import { store } from './store.js';

const CFG_KEY = 'sinapsis.github.cfg';

export const ghState = {
  token: '', owner: '', repo: '', branch: 'main', path: 'sinapsis-vault.json',
  connected: false, lastSync: null, lastError: null, auto: true,
  log: [], timer: null, lastPushed: null, onChange: null, busy: false,
};

/* ── Utilidades puras (testeables) ── */
export function parseRepo(input) {
  const s = (input || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
  let m = s.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (m) return { owner: m[1], repo: m[2] };
  m = s.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}

export function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}
export function b64decode(b64str) {
  const bin = atob(String(b64str).replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/* ── Config persistente ── */
export function loadGhConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
    if (c && c.token && c.owner && c.repo) {
      Object.assign(ghState, {
        token: c.token, owner: c.owner, repo: c.repo,
        branch: c.branch || 'main', path: c.path || 'sinapsis-vault.json',
        auto: c.auto !== false, connected: true,
      });
      startGhTimer();
      return true;
    }
  } catch {}
  return false;
}
function saveGhConfig() {
  const { token, owner, repo, branch, path, auto } = ghState;
  try { localStorage.setItem(CFG_KEY, JSON.stringify({ token, owner, repo, branch, path, auto })); } catch {}
}
export function setGhAuto(v) {
  ghState.auto = !!v;
  if (ghState.connected) saveGhConfig();
}

/* ── Logs / eventos ── */
function ghLog(text) {
  ghState.log.unshift({ ts: Date.now(), text });
  ghState.log = ghState.log.slice(0, 8);
  emit('log');
}
function emit(ev, d = {}) { ghState.onChange?.({ event: ev, ...d }); }

/* ── API ── */
async function api(endpoint, opts = {}) {
  return fetch('https://api.github.com' + endpoint, {
    ...opts,
    headers: {
      Authorization: `Bearer ${ghState.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

export async function connectGitHub(token, repoInput, branch) {
  if (!token || !token.trim()) throw new Error('Falta el token');
  const pr = parseRepo(repoInput);
  if (!pr) throw new Error('Repo no válido — usa "usuario/repositorio" o la URL');
  ghState.token = token.trim();
  ghState.owner = pr.owner;
  ghState.repo = pr.repo;
  ghState.branch = (branch || '').trim() || 'main';

  const res = await api(`/repos/${pr.owner}/${pr.repo}`);
  if (res.status === 401 || res.status === 403) throw new Error('Token rechazado por GitHub (401/403)');
  if (res.status === 404) throw new Error('Repo no encontrado o sin acceso (404)');
  if (!res.ok) throw new Error('GitHub respondió ' + res.status);
  const info = await res.json();
  if (info.default_branch && !(branch || '').trim()) ghState.branch = info.default_branch;

  ghState.connected = true;
  ghState.lastError = null;
  saveGhConfig();
  ghLog(`🐙 Conectado a ${pr.owner}/${pr.repo} · rama ${ghState.branch}`);
  startGhTimer();
  emit('connected');
  // sincronización inicial: fusiona lo remoto y sube el resultado
  await pullGitHub(true);
  await pushGitHub();
  return `${pr.owner}/${pr.repo}`;
}

async function getSha() {
  const res = await api(`/repos/${ghState.owner}/${ghState.repo}/contents/${ghState.path}?ref=${ghState.branch}`);
  if (res.status === 200) {
    const j = await res.json();
    return j.sha;
  }
  return null;
}

export async function pushGitHub() {
  if (!ghState.connected || ghState.busy) return false;
  ghState.busy = true;
  try {
    const json = store.exportVault();
    if (json === ghState.lastPushed) return false; // sin cambios
    const sha = await getSha();
    const res = await api(`/repos/${ghState.owner}/${ghState.repo}/contents/${ghState.path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `🧠 Respaldo Sinapsis · ${new Date().toLocaleString('es-MX')}`,
        content: b64encode(json),
        branch: ghState.branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`No se pudo subir (${res.status}) ${txt.slice(0, 100)}`);
    }
    ghState.lastPushed = json;
    ghState.lastSync = Date.now();
    ghState.lastError = null;
    ghLog('⬆ Respaldo subido a GitHub');
    emit('pushed');
    return true;
  } catch (e) {
    ghState.lastError = e.message || String(e);
    ghLog('⚠️ ' + ghState.lastError);
    emit('error');
    return false;
  } finally {
    ghState.busy = false;
  }
}

export async function pullGitHub(quiet = false) {
  if (!ghState.connected) return 0;
  try {
    const res = await api(`/repos/${ghState.owner}/${ghState.repo}/contents/${ghState.path}?ref=${ghState.branch}`);
    if (res.status === 404) {
      if (!quiet) ghLog('ℹ️ Todavía no hay respaldo en el repo');
      return 0;
    }
    if (!res.ok) throw new Error('Descarga falló (' + res.status + ')');
    const j = await res.json();
    const json = b64decode(j.content);
    const before = store.all().length;
    store.importVault(json, 'merge');
    const added = store.all().length - before;
    ghState.lastSync = Date.now();
    ghState.lastError = null;
    ghLog(added > 0 ? `⬇ Descargado: +${added} elementos nuevos` : '⬇ Descargado: todo al día');
    emit('pulled', { added });
    return added;
  } catch (e) {
    ghState.lastError = e.message || String(e);
    if (!quiet) ghLog('⚠️ ' + ghState.lastError);
    emit('error');
    return 0;
  }
}

export function startGhTimer() {
  stopGhTimer();
  ghState.timer = setInterval(() => {
    if (ghState.connected && ghState.auto) pushGitHub();
  }, 60000);
}
export function stopGhTimer() {
  if (ghState.timer) clearInterval(ghState.timer);
  ghState.timer = null;
}

export function disconnectGitHub() {
  stopGhTimer();
  ghState.token = ''; ghState.owner = ''; ghState.repo = '';
  ghState.connected = false; ghState.lastPushed = null; ghState.lastError = null;
  try { localStorage.removeItem(CFG_KEY); } catch {}
  ghLog('✂️ GitHub desconectado (token borrado de este navegador)');
  emit('disconnected');
}
