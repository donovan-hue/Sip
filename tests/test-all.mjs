/* Tests de importadores + store + markdown + coherencia DOM */
globalThis.localStorage = {
  _s: {},
  getItem(k) { return this._s[k] ?? null; },
  setItem(k, v) { this._s[k] = String(v); },
  removeItem(k) { delete this._s[k]; },
};
import { readFileSync } from 'fs';
const { parseAuto, detectFormat, parseWhatsApp, parseChatGPT, parseGemini, parseFacebook } = await import('../js/importers.js');

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : (fail++, console.error('❌ FAIL:', name, extra)); };

// ── Importadores ──
const chatgpt = JSON.stringify([{
  title: 'Ideas de negocio',
  mapping: {
    'a1': { message: { author: { role: 'system' }, content: { content_type: 'text', parts: [''] }, create_time: 1700000000 } },
    'a2': { message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['¿Cómo aprendo 3D?'] }, create_time: 1700000010 } },
    'a3': { message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Empieza con three.js.'] }, create_time: 1700000020 } },
  },
}, { title: 'Vacía', mapping: {} }]);
t('detect chatgpt', detectFormat(chatgpt, 'conversations.json') === 'chatgpt');
const cg = parseChatGPT(chatgpt);
t('chatgpt: 1 conv, 2 msgs', cg.length === 1 && cg[0].messages.length === 2);
t('chatgpt: orden', cg[0].messages[0].text === '¿Cómo aprendo 3D?');

const gemini = JSON.stringify([{ title: 'Rutina', updateTime: '2025-09-01T10:00:00Z', prompt: { text: 'Arma rutina' }, response: { candidates: [{ content: { parts: [{ text: 'Día 1...' }] } }] } }]);
t('detect gemini', detectFormat(gemini, 'Conversations.json') === 'gemini');
t('gemini: 2 msgs', parseGemini(gemini)[0].messages.length === 2);

const waA = `Messages and calls are end-to-end encrypted.
[3/10/26, 10:32:15] Mamá: ¿Vienes?
[3/10/26, 10:33:02] Tú: Sí
llego temprano
[3/10/26, 10:35:44] Mamá: Ok ❤️`;
t('detect whatsapp', detectFormat(waA, 'Chat.txt') === 'whatsapp');
const wa = parseWhatsApp(waA, 'Chat de WhatsApp con Mamá.txt');
t('whatsapp: título + msgs + multilínea', wa[0].title === 'Mamá' && wa[0].messages.length === 3 && wa[0].messages[1].text.includes('temprano'));

const fb = JSON.stringify({ participants: [{ name: 'Carlos' }, { name: 'Yo' }], title: 'Carlos', messages: [{ sender_name: 'Carlos', content: 'Hola', timestamp_ms: 1700000000000 }, { sender_name: 'Yo', timestamp_ms: 1 } ] });
t('facebook: filtra sin contenido', parseFacebook(fb, 'message_1.json')[0].messages.length === 1);

const gen = JSON.stringify([{ role: 'user', content: 'Hola' }, { role: 'assistant', content: '¡Hola!' }]);
t('generic json', parseAuto(gen, 'c.json').conversations[0].messages.length === 2);

const txt = `Usuario: ideas\nAsistente: tacos\nUsuario: gracias`;
t('texto plano', parseAuto(txt, 'chat.txt').conversations[0].messages.length === 3);

// ── Store + grafo + markdown ──
const { store, computeGraph, backlinksOf } = await import('../js/store.js');
const { seedSamples } = await import('../js/samples.js');
const { renderMarkdown, outline, conversationToMarkdown } = await import('../js/md.js');

store.load();
t('seed: 9 elementos', seedSamples() === 9);
t('seed: idempotente', seedSamples() === 0);

const g = computeGraph({ mentionLinks: true });
const titles = g.nodes.map(n => n.title);
t('grafo: persona Mamá', titles.includes('Mamá'));
t('grafo: ChatGPT no es persona', !titles.includes('ChatGPT'));
t('grafo: aristas persona = 2', g.edges.filter(e => e.type === 'person').length === 2);
const byTitle = Object.fromEntries(g.nodes.map(n => [n.title, n]));
t('grafo: wiki Plan↔Hábitos', g.edges.some(e => e.type === 'wiki' &&
  ((e.a === byTitle['Plan de entrenamiento'].id && e.b === byTitle['Hábitos atómicos'].id) || (e.b === byTitle['Plan de entrenamiento'].id && e.a === byTitle['Hábitos atómicos'].id))));
t('grafo: sin menciones al desactivar', computeGraph({ mentionLinks: false }).edges.filter(e => e.type === 'mention').length === 0);
t('backlinks: Plan→Hábitos', backlinksOf(store.byTitle('Hábitos atómicos').id).some(b => b.note.title === 'Plan de entrenamiento'));

const html = renderMarkdown('# Hola\n[[Hábitos atómicos]] [[No existe|alias]] `code`\n- [x] hecho\n> q\n```\nx\n```\n| a | b |\n|-|-|\n| 1 | 2 |\n<script>x</script> #tag1');
t('md: h1 + wiki + roto + code', html.includes('<h1>Hola</h1>') && html.includes('data-wiki="Hábitos atómicos"') && html.includes('wikilink broken') && html.includes('<code>code</code>'));
t('md: tabla + XSS escapado', html.includes('<table>') && !html.includes('<script>') && html.includes('&lt;script&gt;'));
t('md: tag', html.includes('data-tag="tag1"'));
t('outline: 3', outline('# A\n## B\n### C').length === 3);
t('transcripción', conversationToMarkdown(store.conversations().find(c => c.title === 'Mamá')).includes('birria'));

// ── Coherencia DOM: ids de app.js existen en index.html ──
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const htmlFile = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const refs = new Set();
for (const m of app.matchAll(/\$\$?\(\s*'#([a-zA-Z0-9_-]+)/g)) refs.add(m[1]);
const missing = [...refs].filter(id => !htmlFile.includes(`id="${id}"`));
t(`DOM: ${refs.size} ids de app.js existen en HTML`, missing.length === 0, missing.join(','));

// ── graph3d.js: paleta neón + efectos (sin DOM) ──
const g3 = readFileSync(new URL('../js/graph3d.js', import.meta.url), 'utf8');
const m = g3.match(/export const NEON = (\{[\s\S]*?\n\});/);
const neonSrc = m && m[1];
t('graph3d: NEON presente', !!neonSrc);
if (neonSrc) {
  t('neon: 7 categorías', (neonSrc.match(/color:/g) || []).length === 7);
  t('neon: fucsia', neonSrc.includes('#ff2d95'));
  t('neon: verde fosforescente', neonSrc.includes('#39ff14'));
  t('neon: azul eléctrico', neonSrc.includes('#00e0ff'));
  t('neon: morado eléctrico', neonSrc.includes('#a020ff'));
  t('neon: rojo fuerte', neonSrc.includes('#ff1f1f'));
}
t('graph3d: ciclo infinito de color', g3.includes('CYCLE_SECONDS') && g3.includes('% 1'));
t('graph3d: fondo negro puro', g3.includes('background = new THREE.Color(0x000000)'));
t('graph3d: sin estrellas ni nebulosas', !g3.includes('_addStars') && !g3.includes('_addNebulae'));
t('graph3d: sin halo brillante en nodos', !g3.includes('o.glow') && !g3.includes('glow.scale'));
t('graph3d: bloom reducido', g3.includes('UnrealBloomPass(new THREE.Vector2(1, 1), 0.5'));
t('graph3d: wireframe (definición 3D)', g3.includes('wireframe: true'));
t('graph3d: señales (pulses)', g3.includes('_updatePulses') && g3.includes('_spawnPulse') && g3.includes('burst('));
t('graph3d: curvas bézier', g3.includes('_curveAt') && g3.includes('EDGE_SEG'));
t('graph3d: borde fresnel', g3.includes('SHELL_FRAG') && g3.includes('ShaderMaterial'));
t('graph3d: colores de aristas actualizados por frame', g3.includes('_updateEdgeColors'));
t('graph3d: rejilla holográfica', g3.includes('GridHelper') && g3.includes('this.grid'));
t('graph3d: anillos orbitales', g3.includes('ringGeo') && g3.includes('TorusGeometry'));
t('graph3d: auto-rotación cinemática', g3.includes('autoRotate') && g3.includes('autoRotateSpeed'));
t('graph3d: callback onSignal', g3.includes('onSignal') && g3.includes('this.onSignal(e, !!fromId)'));

// ── HUD trading: elementos en HTML/CSS/APP ──
t('html: panel HUD', htmlFile.includes('hud-panel') && htmlFile.includes('hud-live') && htmlFile.includes('hud-feed'));
t('html: stats en vivo', htmlFile.includes('hud-nodes') && htmlFile.includes('hud-edges') && htmlFile.includes('hud-rate') && htmlFile.includes('hud-meter-bar'));
const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
t('css: scanlines holograma', css.includes('repeating-linear-gradient') && css.includes('radial-gradient(ellipse at center, transparent 58%'));
t('css: estilo trading', css.includes('#hud-panel') && css.includes('#hud-feed') && css.includes('@keyframes blink'));
t('app: updater HUD + feed', app.includes('startHudUpdater') && app.includes('pushFeedLine'));
t('html: etiqueta SEÑALES/MIN', htmlFile.includes('SEÑALES/MIN'));

// ── JSON desconocido no genera basura ──
const junk = JSON.stringify({ notes: [{ title: 'x' }], settings: {} });
t('importers: JSON desconocido → 0 conversaciones', parseAuto(junk, 'sinapsis-backup.json').conversations.length === 0);

// ── Auto-sync: importParsed con deduplicación ──
const { importParsed, dedupeKey } = await import('../js/sync.js');
const fakeConvs = [
  { title: 'Chat auto 1', source: 'generic', participants: ['A'], messages: [{ role: 'user', sender: 'A', text: 'hola', ts: 1700000000 }] },
  { title: 'Chat auto 2', source: 'whatsapp', participants: ['B'], messages: [{ role: 'other', sender: 'B', text: 'hi', ts: 1700000001 }] },
];
t('sync: primera importación agrega 2', importParsed(fakeConvs, { auto: true }) === 2);
t('sync: segunda importación agrega 0 (dedupe)', importParsed(fakeConvs, { auto: true }) === 0);
const grown = [{ ...fakeConvs[0], messages: [...fakeConvs[0].messages, { role: 'user', sender: 'A', text: 'más', ts: 1700000050 }] }];
t('sync: chat con mensajes nuevos se reimporta', importParsed(grown, { auto: true }) === 1);
t('sync: marca auto en la nota', store.byTitle('Chat auto 1')?.auto === true || store.all().filter(n => n.title === 'Chat auto 1').length === 2);
t('sync: dedupeKey estable', dedupeKey(fakeConvs[1]) === dedupeKey({ ...fakeConvs[1] }));

// ── UI de conexiones: HTML/CSS/APP ──
t('html: vista de conexiones', htmlFile.includes('view-sync') && htmlFile.includes('btn-connect') && htmlFile.includes('sync-log') && htmlFile.includes('panel-sync'));
t('html: rail botón Conexiones', htmlFile.includes('data-view="sync"'));
t('css: estilos de conexiones', css.includes('.sync-card') && css.includes('.sync-status-dot') && css.includes('.sync-log'));
t('app: wiring de sync', app.includes('connectFolder') && app.includes('tryRestore') && app.includes('renderSyncStatus') && app.includes("setView('sync')"));

console.log(`\n✅ ${pass} pasaron, ❌ ${fail} fallaron`);
process.exit(fail ? 1 : 0);
