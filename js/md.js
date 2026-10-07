/* ═══════════════ md.js — Markdown + wikilinks + etiquetas ═══════════════ */
import { store, norm } from './store.js';

export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const WIKI_RE = /\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]+))?\]\]/g;

function inline(text) {
  let s = escapeHtml(text);
  // código inline (protegido con marcador)
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  // imágenes y enlaces
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // negrita / cursiva / tachado
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // ==resaltado==
  s = s.replace(/==([^=]+)==/g, '<mark>$1</mark>');
  // wikilinks [[Nota]] o [[Nota|alias]]
  s = s.replace(WIKI_RE, (_, target, _head, alias) => {
    const exists = store.byTitle(target);
    const label = alias || target;
    const cls = exists ? 'wikilink' : 'wikilink broken';
    const t = escapeHtml(target).replace(/'/g, '&#39;');
    return `<a class="${cls}" data-wiki="${t}" title="${exists ? 'Abrir nota' : 'Crear nota'}">${escapeHtml(label)}</a>`;
  });
  // #etiquetas (no dentro de palabras)
  s = s.replace(/(^|\s)#([a-záéíóúñü0-9_\/-]{2,})/gi, '$1<span class="md-tag" data-tag="$2">#$2</span>');
  // restaurar código
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + escapeHtml(codes[+i]) + '</code>');
  return s;
}

export function renderMarkdown(src) {
  if (!src) return '<p style="color:var(--text-faint)">Nada que previsualizar todavía…</p>';
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0, para = [], listStack = null, inCode = false, codeBuf = [], codeLang = '';

  function flushPara() {
    if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; }
  }
  function closeList() { if (listStack) { out.push(listStack === 'ul' ? '</ul>' : '</ol>'); listStack = null; } }

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      if (!inCode) { flushPara(); closeList(); inCode = true; codeLang = line.slice(3).trim(); codeBuf = []; }
      else { out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`); inCode = false; }
      i++; continue;
    }
    if (inCode) { codeBuf.push(line); i++; continue; }

    // hr
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushPara(); closeList(); out.push('<hr>'); i++; continue; }
    // headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); closeList(); const lv = h[1].length; out.push(`<h${lv}>${inline(h[2])}</h${lv}>`); i++; continue; }
    // blockquote
    if (/^>\s?/.test(line)) {
      flushPara(); closeList();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push('<blockquote>' + buf.map(inline).join('<br>') + '</blockquote>');
      continue;
    }
    // tablas
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flushPara(); closeList();
      const cells = r => r.replace(/^\||\|\s*$/g, '').split('|').map(c => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      out.push('<table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    // task list
    const task = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/);
    if (task) {
      flushPara();
      if (listStack !== 'ul') { closeList(); out.push('<ul>'); listStack = 'ul'; }
      const done = task[1].toLowerCase() === 'x';
      out.push(`<li class="task"><input type="checkbox" disabled ${done ? 'checked' : ''}> ${inline(task[2])}</li>`);
      i++; continue;
    }
    // listas
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const want = ul ? 'ul' : 'ol';
      if (listStack !== want) { closeList(); out.push(want === 'ul' ? '<ul>' : '<ol>'); listStack = want; }
      out.push('<li>' + inline((ul || ol)[1]) + '</li>');
      i++; continue;
    }
    // línea vacía
    if (/^\s*$/.test(line)) { flushPara(); closeList(); i++; continue; }
    // párrafo
    closeList();
    para.push(line);
    i++;
  }
  if (inCode) out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  flushPara(); closeList();
  return out.join('\n');
}

// Esquema (headings) de un contenido
export function outline(src) {
  const heads = [];
  for (const line of (src || '').split('\n')) {
    const m = line.match(/^(#{1,4})\s+(.+)$/);
    if (m) heads.push({ level: m[1].length, text: m[2].replace(/[*_`[\]#]/g, '') });
  }
  return heads;
}

// Transcripción markdown de una conversación
export function conversationToMarkdown(conv) {
  const srcLabel = conv.source || 'chat';
  let md = `> 💬 Conversación importada (${srcLabel}) · ${conv.messages?.length || 0} mensajes\n\n`;
  let lastTs = '';
  for (const m of conv.messages || []) {
    const d = m.ts ? new Date(m.ts * 1000) : null;
    const day = d ? d.toLocaleDateString('es-MX') : '';
    if (day && day !== lastTs) { md += `\n### 📅 ${day}\n\n`; lastTs = day; }
    const who = m.sender || m.role || '?';
    const time = d ? d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '';
    md += `**${who}**${time ? ' _' + time + '_' : ''}:\n${m.text}\n\n`;
  }
  return md;
}
