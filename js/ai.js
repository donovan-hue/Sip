/* ═══════════════ ai.js — RAG sobre tu propia base de conocimiento ═══════════════
 * Flujo de seguridad (según la arquitectura): NUNCA se envía toda la base al modelo.
 *   Pregunta → recuperar contexto relevante (semántico o léxico) → enviar SOLO eso → respuesta con citas.
 * La clave API vive solo en el navegador del usuario.
 */
import { store, norm } from './store.js';

const CFG_KEY = 'sinapsis.ai.cfg';
const EMB_DB = 'sinapsis-emb';

export const aiCfg = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  chatModel: 'gpt-4o-mini',
  embModel: 'text-embedding-3-small',
};

export const PRESETS = {
  OpenAI:     { baseUrl: 'https://api.openai.com/v1',      chat: 'gpt-4o-mini',            emb: 'text-embedding-3-small' },
  Groq:       { baseUrl: 'https://api.groq.com/openai/v1', chat: 'llama-3.3-70b-versatile', emb: '' },
  OpenRouter: { baseUrl: 'https://openrouter.ai/api/v1',   chat: 'openai/gpt-4o-mini',     emb: '' },
};

export function loadAiCfg() {
  try { Object.assign(aiCfg, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch {}
  return aiCfg;
}
export function saveAiCfg(patch = {}) {
  Object.assign(aiCfg, patch);
  try { localStorage.setItem(CFG_KEY, JSON.stringify(aiCfg)); } catch {}
}

/* ── Chunking: trozos indexables de notas y conversaciones ── */
export function buildChunks() {
  const chunks = [];
  const MAX = 700;
  for (const n of store.all()) {
    if (n.type === 'note' || n.type === 'entity') {
      const paras = (n.content || '').split(/\n{2,}/);
      let buf = '';
      const flush = () => { if (buf.trim()) chunks.push({ refId: n.id, refType: n.type, refTitle: n.title, text: buf.trim() }); buf = ''; };
      for (const p of paras) {
        if ((buf + '\n\n' + p).length > MAX) { flush(); buf = p; }
        else buf = buf ? buf + '\n\n' + p : p;
      }
      flush();
      if (!chunks.some(c => c.refId === n.id) && n.title) chunks.push({ refId: n.id, refType: n.type, refTitle: n.title, text: n.title });
    } else if (n.type === 'conversation' && n.messages) {
      let buf = '', count = 0;
      const flush = () => { if (buf.trim()) chunks.push({ refId: n.id, refType: 'conversation', refTitle: n.title, text: buf.trim() }); buf = ''; count = 0; };
      for (const m of n.messages) {
        const line = `${m.sender}: ${m.text}`;
        if (buf.length + line.length > MAX || count > 14) flush();
        buf += line + '\n'; count++;
      }
      flush();
    }
  }
  chunks.forEach((c, i) => { c.id = c.refId + '#' + i; });
  return chunks;
}

/* ── Recuperación léxica (TF-IDF ligero, sin dependencias) ── */
const tok = s => norm(s).match(/[a-z0-9ñ]{3,}/g) || [];

export function lexicalSearch(query, chunks, k = 6) {
  const q = new Set(tok(query));
  if (!q.size) return [];
  const df = {};
  const docs = chunks.map(c => {
    const t = tok(c.text);
    const uniq = new Set(t);
    for (const w of uniq) df[w] = (df[w] || 0) + 1;
    return { c, tf: {}, len: t.length };
  });
  for (const d of docs) for (const w of tok(d.c.text)) d.tf[w] = (d.tf[w] || 0) + 1;
  const N = docs.length || 1;
  return docs
    .map(d => {
      let s = 0;
      for (const w of q) if (d.tf[w]) s += (d.tf[w] / d.len) * Math.log(N / (df[w] || 1));
      return { chunk: d.c, score: s, mode: 'texto' };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/* ── Embeddings en IndexedDB ── */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(EMB_DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('vecs'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGetAll() {
  const db = await idb();
  return new Promise((res, rej) => {
    const out = {};
    const rq = db.transaction('vecs', 'readonly').objectStore('vecs').openCursor();
    rq.onsuccess = () => {
      const cur = rq.result;
      if (cur) { out[cur.key] = cur.value; cur.continue(); }
      else res(out);
    };
    rq.onerror = () => rej(rq.error);
  });
}
async function idbPut(key, val) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('vecs', 'readwrite');
    tx.objectStore('vecs').put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
export async function clearEmbeddings() {
  const db = await idb();
  return new Promise(res => {
    const tx = db.transaction('vecs', 'readwrite');
    tx.objectStore('vecs').clear();
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function callEmbeddings(texts) {
  const res = await fetch(aiCfg.baseUrl.replace(/\/$/, '') + '/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiCfg.apiKey}` },
    body: JSON.stringify({ model: aiCfg.embModel, input: texts }),
  });
  if (!res.ok) throw new Error('Embeddings ' + res.status + ': ' + (await res.text()).slice(0, 140));
  const j = await res.json();
  return j.data.map(d => d.embedding);
}

export async function embedAll(chunks, onProgress) {
  if (!aiCfg.apiKey || !aiCfg.embModel) throw new Error('Configura clave y modelo de embeddings');
  await clearEmbeddings();
  const B = 48;
  for (let i = 0; i < chunks.length; i += B) {
    const batch = chunks.slice(i, i + B);
    const vecs = await callEmbeddings(batch.map(c => c.text.slice(0, 1800)));
    for (let j = 0; j < batch.length; j++) await idbPut(batch[j].id, { v: vecs[j], ref: batch[j].refId, title: batch[j].refTitle });
    onProgress?.(Math.min(100, Math.round((i + B) / chunks.length * 100)));
  }
  await idbPut('__meta', { count: chunks.length, model: aiCfg.embModel, at: Date.now() });
}

export async function embeddingsReady() {
  try {
    const all = await idbGetAll();
    const meta = all['__meta'];
    return meta ? { count: meta.count, model: meta.model, at: meta.at } : null;
  } catch { return null; }
}

/* ── Recuperación híbrida ── */
export async function retrieve(query, k = 6) {
  const chunks = buildChunks();
  const ready = await embeddingsReady();
  if (ready && aiCfg.apiKey && aiCfg.embModel) {
    try {
      const [qv] = await callEmbeddings([query]);
      const all = await idbGetAll();
      const byId = new Map(chunks.map(c => [c.id, c]));
      const scored = [];
      for (const [id, rec] of Object.entries(all)) {
        if (id === '__meta' || !byId.has(id)) continue;
        scored.push({ chunk: byId.get(id), score: cosine(qv, rec.v), mode: 'semántica' });
      }
      scored.sort((a, b) => b.score - a.score);
      const sem = scored.slice(0, k);
      if (sem.length && sem[0].score > 0.2) return sem;
    } catch {}
  }
  return lexicalSearch(query, chunks, k);
}

/* ── Chat con tu conocimiento (RAG) ── */
export async function ask(question, { onContext } = {}) {
  if (!aiCfg.apiKey) throw new Error('Configura tu clave API en el panel IA');
  const ctx = await retrieve(question, 6);
  onContext?.(ctx);
  const contextText = ctx.map((r, i) =>
    `[${i + 1}] (${r.chunk.refType === 'conversation' ? 'Conversación' : r.chunk.refType === 'entity' ? 'Entidad' : 'Nota'}: "${r.chunk.refTitle}")\n${r.chunk.text.slice(0, 1400)}`
  ).join('\n\n---\n\n');
  const messages = [
    {
      role: 'system',
      content: `Eres el asistente de la base de conocimiento personal del usuario (app Sinapsis). Responde SOLO con el contexto proporcionado; si el contexto no alcanza, dilo claramente. Cita las fuentes usando marcadores [1], [2], etc. según el número del fragmento de contexto que uses. Responde en español, conciso y útil.`,
    },
    {
      role: 'user',
      content: `CONTEXTO DE LA BASE DE CONOCIMIENTO:\n\n${contextText || '(sin contexto relevante)'}\n\nPREGUNTA: ${question}`,
    },
  ];
  const res = await fetch(aiCfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiCfg.apiKey}` },
    body: JSON.stringify({ model: aiCfg.chatModel, messages, temperature: 0.3 }),
  });
  if (!res.ok) throw new Error('La IA respondió ' + res.status + ': ' + (await res.text()).slice(0, 140));
  const j = await res.json();
  const answer = j.choices?.[0]?.message?.content || '(respuesta vacía)';
  return { answer, citations: ctx };
}

export async function testConnection() {
  const res = await fetch(aiCfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiCfg.apiKey}` },
    body: JSON.stringify({ model: aiCfg.chatModel, messages: [{ role: 'user', content: 'di OK' }], max_tokens: 5 }),
  });
  if (!res.ok) throw new Error('Conexión falló (' + res.status + ')');
  return true;
}

/* ── Extracción automática: conversación → conocimiento estructurado (Nivel 2) ── */
export async function extractFromConversation(conv) {
  const transcript = (conv.messages || []).map(m => `${m.sender}: ${m.text}`).join('\n').slice(0, 7000);
  const res = await fetch(aiCfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiCfg.apiKey}` },
    body: JSON.stringify({
      model: aiCfg.chatModel, temperature: 0,
      messages: [
        { role: 'system', content: 'Extraes conocimiento estructurado de conversaciones. Respondes ÚNICAMENTE con JSON válido, sin markdown ni explicaciones.' },
        { role: 'user', content: `De esta conversación extrae:\n{"resumen":"1-2 oraciones","temas":["..."],"decisiones":["..."],"tareas":["..."],"tecnologias":["..."],"personas":["..."],"proyecto":"nombre si aplica o null"}\nReglas: máx 6 items por lista, en español, nombres concretos, listas vacías si no aplica.\n\nCONVERSACIÓN:\n${transcript}` },
      ],
    }),
  });
  if (!res.ok) throw new Error('Extracción falló (' + res.status + ')');
  const j = await res.json();
  let txt = j.choices?.[0]?.message?.content || '';
  txt = txt.replace(/```json|```/g, '').trim();
  const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('La IA no devolvió JSON');
  return JSON.parse(txt.slice(s, e + 1));
}

/* Crea entidades (Nivel 2) enlazadas a la conversación original (Nivel 1 siempre se conserva) */
export function applyExtraction(conv, ex) {
  const kinds = [
    ['temas', 'tema', '🏷'], ['decisiones', 'decision', '⚖️'],
    ['tareas', 'tarea', '✅'], ['tecnologias', 'tecnologia', '⚙️'],
  ];
  let created = 0;
  for (const [key, kind, icon] of kinds) {
    for (const raw of (ex[key] || []).slice(0, 6)) {
      const title = String(raw).trim();
      if (!title || title.length < 3 || title.length > 80) continue;
      if (store.byTitle(title)) continue;
      store.create({
        type: 'entity', kind, title,
        content: `${icon} **${kind.charAt(0).toUpperCase() + kind.slice(1)}** extraída por IA de la conversación [[${conv.title}]].\n\n> ${ex.resumen || ''}`,
        source: 'ai', meta: { from: conv.id, kind }, tags: ['ia'],
      });
      created++;
    }
  }
  if (ex.proyecto && String(ex.proyecto).trim().toLowerCase() !== 'null') {
    const t = String(ex.proyecto).trim();
    if (t.length >= 3 && !store.byTitle(t)) {
      store.create({ type: 'entity', kind: 'proyecto', title: t, content: `📁 Proyecto detectado por IA en [[${conv.title}]].\n\n> ${ex.resumen || ''}`, source: 'ai', meta: { from: conv.id, kind: 'proyecto' }, tags: ['ia'] });
      created++;
    }
  }
  store.update(conv.id, { meta: Object.assign({}, conv.meta, { extracted: true, resumen: ex.resumen || '' }) });
  store.save();
  return created;
}
