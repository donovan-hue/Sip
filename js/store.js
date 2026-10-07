/* ═══════════════ store.js — Capa de datos (localStorage) ═══════════════ */

const KEY = 'sinapsis.vault.v1';

export const SOURCE_META = {
  manual:   { label: 'Nota',        color: '#22d3ee', icon: '📝' },
  chatgpt:  { label: 'ChatGPT',     color: '#10a37f', icon: '⚡' },
  gemini:   { label: 'Gemini',      color: '#8b7bff', icon: '✦' },
  whatsapp: { label: 'WhatsApp',    color: '#25d366', icon: '💬' },
  facebook: { label: 'Messenger',   color: '#4a90ff', icon: 'ⓕ' },
  generic:  { label: 'Otra IA',     color: '#f472b6', icon: '🤖' },
  person:   { label: 'Persona',     color: '#ffb454', icon: '👤' },
};

// Nombres que NO generan nodos de persona
const AI_NAMES = new Set(['chatgpt','gpt','gpt-4','gpt-3.5','gemini','assistant','asistente','ai','ia','bot','claude','copilot','bard','you','tú','tu','usuario','user','yo','human','humano','system','sistema']);

function uid() {
  return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

export const store = {
  data: { notes: [], settings: { onboardingDone: false, mentionLinks: true, labels: false } },

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        this.data = Object.assign({ notes: [], settings: {} }, d);
        this.data.settings = Object.assign({ onboardingDone: false, mentionLinks: true, labels: false }, d.settings || {});
      }
    } catch (e) { console.warn('No se pudo cargar el vault', e); }
    return this.data;
  },

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); }
    catch (e) { console.warn('No se pudo guardar', e); }
  },

  storageSize() {
    try { return (localStorage.getItem(KEY) || '').length; } catch { return 0; }
  },

  // ── Notas ─────────────────────────
  all() { return this.data.notes; },
  get(id) { return this.data.notes.find(n => n.id === id); },
  byTitle(title) {
    const t = norm(title);
    return this.data.notes.find(n => norm(n.title) === t);
  },
  plainNotes() { return this.data.notes.filter(n => n.type === 'note'); },
  conversations() { return this.data.notes.filter(n => n.type === 'conversation'); },

  create(fields) {
    const n = Object.assign({
      id: uid(), type: 'note', title: 'Sin título', content: '', source: 'manual',
      messages: null, participants: [], tags: [], created: Date.now(), updated: Date.now(),
    }, fields);
    this.data.notes.unshift(n);
    this.save();
    return n;
  },

  update(id, patch) {
    const n = this.get(id);
    if (!n) return null;
    Object.assign(n, patch, { updated: Date.now() });
    this.save();
    return n;
  },

  remove(id) {
    this.data.notes = this.data.notes.filter(n => n.id !== id);
    this.save();
  },

  // Texto completo indexable de una nota/conversación
  searchText(n) {
    let t = n.title + '\n' + (n.content || '');
    if (n.messages) t += '\n' + n.messages.map(m => m.text).join('\n');
    return t;
  },

  exportVault() { return JSON.stringify(this.data, null, 2); },

  importVault(json, mode = 'merge') {
    const d = JSON.parse(json);
    if (!d || !Array.isArray(d.notes)) throw new Error('Formato de copia no válido');
    if (mode === 'replace') {
      this.data.notes = d.notes;
    } else {
      const titles = new Set(this.data.notes.map(n => norm(n.title)));
      for (const n of d.notes) if (!titles.has(norm(n.title))) this.data.notes.push(n);
    }
    this.save();
  },
};

/* ═══════════════ Cálculo de la red (nodos + conexiones) ═══════════════ */

const WIKI_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

export function computeGraph({ mentionLinks = true } = {}) {
  const notes = store.all();
  const nodes = [];
  const edges = [];
  const nodeById = new Map();
  const edgeKey = new Set();

  function addNode(n) {
    if (nodeById.has(n.id)) return nodeById.get(n.id);
    const node = {
      id: n.id, title: n.title, kind: n.type === 'conversation' ? 'conversation' : 'note',
      source: n.source || 'manual', degree: 0,
    };
    nodes.push(node); nodeById.set(n.id, node);
    return node;
  }
  function addEdge(a, b, type) {
    if (a === b) return;
    const k = a < b ? a + '|' + b + '|' + type : b + '|' + a + '|' + type;
    if (edgeKey.has(k)) return;
    edgeKey.add(k);
    edges.push({ a, b, type });
    const na = nodeById.get(a), nb = nodeById.get(b);
    if (na) na.degree++;
    if (nb) nb.degree++;
  }

  // 1 · Nodos de notas y conversaciones
  for (const n of notes) addNode(n);

  // 2 · Enlaces [[wiki]] explícitos
  for (const n of notes) {
    const content = n.content || '';
    let m;
    WIKI_RE.lastIndex = 0;
    while ((m = WIKI_RE.exec(content))) {
      const target = store.byTitle(m[1]);
      if (target) addEdge(n.id, target.id, 'wiki');
    }
  }

  // 3 · Conexiones por mención de títulos (4+ letras, sin contar la propia nota)
  if (mentionLinks) {
    for (const n of notes) {
      const hay = norm(store.searchText(n));
      for (const other of notes) {
        if (other.id === n.id) continue;
        const t = norm(other.title);
        if (t.length >= 4 && hay.includes(t)) addEdge(n.id, other.id, 'mention');
      }
    }
  }

  // 4 · Personas: nodos hub que conectan conversaciones con el mismo contacto
  const personMap = new Map(); // nombre norm → id
  for (const n of notes) {
    if (n.type !== 'conversation' || !Array.isArray(n.participants)) continue;
    for (const p of n.participants) {
      if (!p || norm(p) === '' || AI_NAMES.has(norm(p)) || p.length > 40) continue;
      const key = norm(p);
      let pid = personMap.get(key);
      if (!pid) {
        pid = 'person:' + key;
        personMap.set(key, pid);
        const node = { id: pid, title: p, kind: 'person', source: 'person', degree: 0 };
        nodes.push(node); nodeById.set(pid, node);
      }
      addEdge(pid, n.id, 'person');
    }
  }
  // Personas que solo aparecen en 1 conversación sobrecargan: se conservan (dan contexto)

  return { nodes, edges };
}

// Vecindad de un nodo (para modo enfoque)
export function neighborhood(graph, id) {
  const ids = new Set([id]);
  for (const e of graph.edges) {
    if (e.a === id) ids.add(e.b);
    if (e.b === id) ids.add(e.a);
  }
  return {
    nodes: graph.nodes.filter(n => ids.has(n.id)),
    edges: graph.edges.filter(e => ids.has(e.a) && ids.has(e.b)),
  };
}

// Backlinks: qué notas conectan con la nota dada
export function backlinksOf(id) {
  const n = store.get(id);
  if (!n) return [];
  const out = [];
  for (const other of store.all()) {
    if (other.id === id) continue;
    const txt = norm(store.searchText(other));
    const wiki = (other.content || '').match(WIKI_RE);
    const wikiHit = wiki && wiki.some(m => norm(store.byTitle(m.slice(2, m.indexOf(']'))) ?.title || '') === norm(n.title));
    const titleHit = norm(n.title).length >= 4 && txt.includes(norm(n.title));
    if (wikiHit || titleHit) out.push({ note: other, type: wikiHit ? 'wiki' : 'mention' });
  }
  return out;
}

export function isAiName(name) { return AI_NAMES.has(norm(name)); }
