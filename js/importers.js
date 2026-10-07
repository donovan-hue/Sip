/* ═══════════════ importers.js — ChatGPT · Gemini · WhatsApp · Messenger · Genérico ═══════════════ */

const USER_WORDS = new Set(['usuario','user','you','tú','tu','yo','human','humano','me','juan','maria']);
const AI_WORDS = new Set(['assistant','asistente','chatgpt','gpt','gemini','claude','copilot','bard','ai','ia','bot','model','modelo']);

function guessRole(name) {
  const n = (name || '').toLowerCase().trim();
  if (AI_WORDS.has(n)) return 'assistant';
  if (USER_WORDS.has(n)) return 'user';
  return 'other';
}

function tryJson(text) { try { return JSON.parse(text); } catch { return null; } }

/* ── WhatsApp (.txt exportado) ─────────────────────────── */
const WA_A = /^\[(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\]\s?([^:]{1,60}):\s?([\s\S]*)$/;
const WA_B = /^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s?-\s?([^:]{1,60}):\s?([\s\S]*)$/;

export function looksLikeWhatsApp(text) {
  const head = text.slice(0, 4000).split('\n').slice(0, 40);
  let hits = 0;
  for (const l of head) if (WA_A.test(l) || WA_B.test(l)) hits++;
  return hits >= 3;
}

function parseWaDate(dstr, tstr) {
  const p = dstr.split(/[/.-]/).map(Number);
  let y = p[2]; if (y < 100) y += 2000;
  const [d, mo] = [p[0], p[1]];
  const [h, mi, s] = tstr.split(':').map(Number);
  const t = new Date(y, mo - 1, d, h, mi, s || 0);
  return isNaN(t) ? null : Math.floor(t.getTime() / 1000);
}

export function parseWhatsApp(text, filename = '') {
  const messages = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\u200e|\u200f/g, '').trimEnd();
    if (!line.trim()) { if (cur) cur.text += '\n'; continue; }
    const m = line.match(WA_A) || line.match(WA_B);
    if (m) {
      const [, d, t, sender, msg] = m;
      cur = { role: guessRole(sender), sender: sender.trim(), text: msg || '', ts: parseWaDate(d, t) };
      messages.push(cur);
    } else if (cur) {
      cur.text += '\n' + line;
    }
  }
  for (const msg of messages) msg.text = msg.text.trim();
  const clean = messages.filter(m => m.text && !/^Messages and calls are end-to-end encrypted/i.test(m.text) && !/^Los mensajes y las llamadas están cifrados/i.test(m.text));
  if (!clean.length) return null;
  const senders = [...new Set(clean.map(m => m.sender))];
  let title = (filename || '').replace(/\.(txt|zip)$/i, '').replace(/^Chat de WhatsApp con\s*/i, '').trim();
  if (!title) title = 'WhatsApp · ' + (senders.find(s => guessRole(s) !== 'user') || senders[0] || 'Chat');
  return [{ title, source: 'whatsapp', participants: senders, messages: clean }];
}

/* ── ChatGPT (conversations.json) ─────────────────────── */
export function parseChatGPT(text) {
  const data = tryJson(text);
  if (!Array.isArray(data)) return null;
  const convs = [];
  for (const c of data) {
    const mapping = c.mapping || {};
    const msgs = [];
    for (const key of Object.keys(mapping)) {
      const msg = mapping[key]?.message;
      if (!msg || !msg.content) continue;
      const role = msg.author?.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const ct = msg.content.content_type;
      if (ct !== 'text' && ct !== 'code') continue;
      const parts = (msg.content.parts || []).filter(p => typeof p === 'string' && p.trim());
      if (!parts.length) continue;
      msgs.push({ role, sender: role === 'user' ? 'Tú' : 'ChatGPT', text: parts.join('\n'), ts: msg.create_time ? Math.floor(msg.create_time) : null });
    }
    msgs.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    if (!msgs.length) continue;
    const title = (c.title || 'Conversación sin título').trim();
    const ts = msgs.map(m => m.ts).filter(Boolean);
    convs.push({
      title, source: 'chatgpt', participants: ['Tú', 'ChatGPT'], messages: msgs,
      created: ts.length ? Math.min(...ts) : null,
    });
  }
  return convs.length ? convs : null;
}

/* ── Gemini (Conversations.json de Takeout) ───────────── */
export function parseGemini(text) {
  const data = tryJson(text);
  if (!Array.isArray(data)) return null;
  const convs = [];
  for (const c of data) {
    const msgs = [];
    const prompt = c.prompt?.text || c.prompt;
    if (typeof prompt === 'string' && prompt.trim()) msgs.push({ role: 'user', sender: 'Tú', text: prompt.trim(), ts: c.updateTime ? Math.floor(new Date(c.updateTime).getTime() / 1000) : null });
    let resp = '';
    if (typeof c.response === 'string') resp = c.response;
    else if (c.response?.candidates?.[0]?.content?.parts) resp = c.response.candidates[0].content.parts.map(p => p.text || '').join('\n');
    else if (Array.isArray(c.response?.responseTexts)) resp = c.response.responseTexts.join('\n');
    else if (typeof c.response?.text === 'string') resp = c.response.text;
    if (resp.trim()) msgs.push({ role: 'assistant', sender: 'Gemini', text: resp.trim(), ts: msgs[0]?.ts || null });
    if (!msgs.length) continue;
    convs.push({
      title: (c.title || 'Chat con Gemini').trim() || 'Chat con Gemini',
      source: 'gemini', participants: ['Tú', 'Gemini'], messages: msgs,
      created: msgs[0].ts,
    });
  }
  return convs.length ? convs : null;
}

/* ── Facebook Messenger (message_1.json) ──────────────── */
export function parseFacebook(text, filename = '') {
  const data = tryJson(text);
  if (!data || !Array.isArray(data.messages) || !Array.isArray(data.participants)) return null;
  const participants = data.participants.map(p => p.name).filter(Boolean);
  const msgs = [];
  for (const m of data.messages) {
    if (!m.content || !m.sender_name) continue;
    msgs.push({
      role: guessRole(m.sender_name), sender: m.sender_name, text: m.content,
      ts: m.timestamp_ms ? Math.floor(m.timestamp_ms / 1000) : null,
    });
  }
  msgs.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (!msgs.length) return null;
  const title = data.title || data.thread_name || ('Messenger · ' + (participants[0] || 'chat'));
  return [{ title, source: 'facebook', participants, messages: msgs }];
}

/* ── Genérico JSON: [{role|from|sender, content|text|message}] ── */
export function parseGenericJSON(text) {
  const data = tryJson(text);
  let arr = null, title = 'Conversación importada';
  if (Array.isArray(data)) arr = data;
  else if (data && Array.isArray(data.messages)) { arr = data.messages; title = data.title || title; }
  if (!arr || !arr.length) return null;
  const msgs = [];
  for (const m of arr) {
    if (typeof m === 'string') { msgs.push({ role: 'other', sender: '?', text: m, ts: null }); continue; }
    const who = m.sender || m.from || m.author || m.role || m.name || '?';
    const body = m.content || m.text || m.message || (Array.isArray(m.parts) ? m.parts.join('\n') : null);
    if (!body || typeof body !== 'string') continue;
    const tsRaw = m.ts || m.timestamp || m.timestamp_ms || m.create_time || m.date || null;
    let ts = null;
    if (typeof tsRaw === 'number') ts = tsRaw > 1e12 ? Math.floor(tsRaw / 1000) : Math.floor(tsRaw);
    else if (typeof tsRaw === 'string') { const d = Date.parse(tsRaw); if (!isNaN(d)) ts = Math.floor(d / 1000); }
    msgs.push({ role: guessRole(String(who)), sender: String(who), text: body, ts });
  }
  if (!msgs.length) return null;
  const participants = [...new Set(msgs.map(m => m.sender))];
  return [{ title, source: 'generic', participants, messages: msgs }];
}

/* ── Texto genérico: líneas "Nombre: mensaje" ─────────── */
export function parseGenericText(text, titleHint = '') {
  const msgs = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 ._-]{1,40}):\s?([\s\S]*)$/);
    if (m && !/^\d/.test(m[1])) {
      cur = { role: guessRole(m[1]), sender: m[1].trim(), text: m[2], ts: null };
      msgs.push(cur);
    } else if (cur) cur.text += '\n' + line;
    else if (line.trim()) { cur = { role: 'other', sender: '?', text: line, ts: null }; msgs.push(cur); }
  }
  for (const m of msgs) m.text = m.text.trim();
  const clean = msgs.filter(m => m.text);
  if (!clean.length) return null;
  const participants = [...new Set(clean.map(m => m.sender))];
  return [{ title: titleHint || 'Conversación pegada', source: 'generic', participants, messages: clean }];
}

/* ── Detección automática ─────────────────────────────── */
export function detectFormat(text, filename = '') {
  const fn = (filename || '').toLowerCase();
  const j = tryJson(text);
  if (j) {
    if (Array.isArray(j) && j.length && j[0] && j[0].mapping) return 'chatgpt';
    if (Array.isArray(j) && j.length && j[0] && ('prompt' in j[0] || 'response' in j[0])) return 'gemini';
    if (!Array.isArray(j) && Array.isArray(j.messages) && Array.isArray(j.participants)) return 'facebook';
    if (Array.isArray(j) && j.length && j[0] && ('role' in j[0] || 'from' in j[0] || 'sender' in j[0] || 'content' in j[0] || 'text' in j[0])) return 'generic';
    if (!Array.isArray(j) && Array.isArray(j.messages)) return 'generic';
    return 'unknown'; // JSON válido pero sin formato de chat conocido
  }
  if (looksLikeWhatsApp(text)) return 'whatsapp';
  return 'text';
}

export function parseAuto(text, filename = '') {
  const fmt = detectFormat(text, filename);
  switch (fmt) {
    case 'chatgpt': return { format: 'chatgpt', conversations: parseChatGPT(text) || [] };
    case 'gemini': return { format: 'gemini', conversations: parseGemini(text) || [] };
    case 'facebook': return { format: 'facebook', conversations: parseFacebook(text, filename) || [] };
    case 'whatsapp': return { format: 'whatsapp', conversations: parseWhatsApp(text, filename) || [] };
    case 'generic': return { format: 'generic', conversations: parseGenericJSON(text) || [] };
    case 'unknown': return { format: 'unknown', conversations: [] };
    default: return { format: 'text', conversations: parseGenericText(text, (filename || '').replace(/\.[a-z]+$/i, '')) || [] };
  }
}

export const FORMAT_LABEL = {
  chatgpt: 'ChatGPT', gemini: 'Gemini', whatsapp: 'WhatsApp',
  facebook: 'Messenger', generic: 'JSON genérico', text: 'Texto',
};
