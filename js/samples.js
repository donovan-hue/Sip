/* ═══════════════ samples.js — Contenido demo ═══════════════ */
import { store } from './store.js';

const H = 3600;
const D = 24 * H;
const now = Math.floor(Date.now() / 1000);

const NOTES = [
  {
    title: '🚀 Bienvenida a Sinapsis',
    content: `# ¡Bienvenido a tu segundo cerebro en 3D! 🧠

Sinapsis conecta **todo lo que piensas y hablas**: tus notas, tus chats con IA y tus conversaciones de WhatsApp o Messenger.

## Cómo funciona

1. **Escribe notas** como en [[Ideas de proyectos]] — soporta Markdown completo.
2. **Conecta notas** escribiendo dos corchetes: \`[[nombre de la nota]]\`. Prueba con [[Hábitos atómicos]].
3. **Importa conversaciones** desde la sección 📥 Importar: ChatGPT, Gemini, WhatsApp, Messenger…
4. **Explora tu red 3D**: cada nodo es una idea o chat; cada línea, una conexión.

> 💡 Consejo: escribe \`[[\` en el editor y aparecerá un buscador de notas.

## Atajos útiles

- \`Ctrl+K\` — paleta de comandos
- \`Ctrl+P\` — abrir nota rápido
- Doble clic en un nodo de la red — enfocar su vecindad

#guia #inicio`,
    tags: ['guia', 'inicio'],
  },
  {
    title: 'Ideas de proyectos',
    content: `# 💡 Ideas de proyectos

## En curso
- [ ] App de recetas con IA — ver [[Recetas favoritas]]
- [ ] Dashboard de gastos personales
- [x] Migrar notas a [[Hábitos atómicos|mi sistema de hábitos]]

## Algún día
- Blog sobre productividad con los resúmenes de [[Hábitos atómicos]]
- Integrar mi [[Plan de entrenamiento]] con el calendario

Relacionado: conversé con ChatGPT sobre esto en la conversación demo *Ideas de app de recetas*.

#proyectos #ideas`,
    tags: ['proyectos', 'ideas'],
  },
  {
    title: 'Hábitos atómicos',
    content: `# 📖 Hábitos Atómicos — James Clear

## Ideas clave
1. **Mejora 1% cada día** — el interés compuesto de los hábitos.
2. Las 4 leyes del cambio de conducta:
   - Hacerlo **obvio**
   - Hacerlo **atractivo**
   - Hacerlo **sencillo**
   - Hacerlo **satisfactorio**
3. *No te elevas al nivel de tus metas, caes al nivel de tus sistemas.*

## Aplicación personal
- Apilar hábitos: después de ☕ café → 10 min de lectura.
- Enlazar con mi [[Plan de entrenamiento]]: dejar la ropa lista la noche anterior.

#libros #productividad`,
    tags: ['libros', 'productividad'],
  },
  {
    title: 'Recetas favoritas',
    content: `# 🍳 Recetas favoritas

## Tacos de birria (versión rápida)
- Birria de res deshebrada, consomé, tortillas de maíz
- Queso Oaxaca, cebolla, cilantro, limón

## Pasta al pesto en 15 min
- Albahaca, piñones, parmesano, ajo, aceite de oliva

> Le pedí variaciones saludables a ChatGPT — ver la conversación *Ideas de app de recetas*.

Para el meal prep de la semana: combinar con el [[Plan de entrenamiento]].

#recetas #cocina`,
    tags: ['recetas', 'cocina'],
  },
  {
    title: 'Plan de entrenamiento',
    content: `# 🏋️ Plan de entrenamiento semanal

| Día | Enfoque |
|-----|---------|
| Lunes | Fuerza: empuje |
| Martes | Cardio 30 min |
| Miércoles | Fuerza: tirón |
| Jueves | Descanso activo |
| Viernes | Fuerza: pierna |
| Sábado | Senderismo 🥾 |

## Principios
- Sobrecarga progresiva (subir 2.5 kg por semana)
- Dormir 7-8 h — refuerzo de [[Hábitos atómicos]]
- Nutrición: ver [[Recetas favoritas]] para meal prep

#salud #fitness`,
    tags: ['salud', 'fitness'],
  },
];

function msgs(list, startTs) {
  let ts = startTs;
  return list.map(([sender, text, gap]) => {
    ts += gap;
    const ai = /chatgpt|gemini|asistente/i.test(sender);
    const you = /tú|^yo$/i.test(sender);
    return { role: ai ? 'assistant' : you ? 'user' : 'other', sender, text, ts };
  });
}

const CONVERSATIONS = [
  {
    title: 'Ideas de app de recetas con IA',
    source: 'chatgpt',
    participants: ['Tú', 'ChatGPT'],
    messages: msgs([
      ['Tú', 'Quiero hacer una app de recetas que sugiera comidas según lo que tengo en el refrigerador. ¿Por dónde empiezo?', 0],
      ['ChatGPT', '¡Gran idea! Te propongo un MVP en 3 pasos:\n\n1. **Inventario simple**: el usuario captura lo que tiene (foto o lista).\n2. **Motor de sugerencias**: un LLM genera recetas con solo esos ingredientes.\n3. **Lista de compras**: lo que falta para completar la receta.\n\nPara empezar sin backend, podrías usar la API de un modelo y guardar el inventario en localStorage.', 90],
      ['Tú', 'Me gusta. ¿Y cómo manejo que la gente guarde sus recetas favoritas?', 120],
      ['ChatGPT', 'Añade un botón de ⭐ favorito que guarde la receta en una colección local. Más adelante puedes sincronizar con la nube. También puedes etiquetar por #recetas rápidas, saludables, etc. — eso conecta muy bien con un sistema de notas como tus Recetas favoritas.', 80],
      ['Tú', 'Perfecto, lo voy a anotar en mis Ideas de proyectos. ¡Gracias!', 200],
    ], now - 3 * D),
  },
  {
    title: 'Rutina de ejercicio con Gemini',
    source: 'gemini',
    participants: ['Tú', 'Gemini'],
    messages: msgs([
      ['Tú', 'Ayúdame a armar una rutina de ejercicio de 4 días si soy principiante.', 0],
      ['Gemini', 'Claro, una rutina equilibrada de 4 días:\n\n**Día 1 — Empuje**: press de banca, press militar, fondos.\n**Día 2 — Cardio**: 30 min trote suave o bici.\n**Día 3 — Tirón**: remo, dominadas asistidas, curl.\n**Día 4 — Pierna**: sentadilla, peso muerto ligero, desplantes.\n\nProgresa subiendo peso poco a poco y descansa 1-2 min entre series.', 70],
      ['Tú', '¿Y cómo lo combino con buenos hábitos para no abandonar?', 140],
      ['Gemini', 'La clave es hacerlo obvio y sencillo: deja tu ropa de ejercicio lista la noche anterior y ancla el hábito a algo que ya haces (ej. entrenar justo después del café). Es exactamente la filosofía de Hábitos atómicos: sistemas sobre metas.', 60],
    ], now - 5 * D),
  },
  {
    title: 'Mamá',
    source: 'whatsapp',
    participants: ['Tú', 'Mamá'],
    messages: msgs([
      ['Mamá', '¿Vienes a comer el domingo? Haré birria 🍲', 0],
      ['Tú', '¡Sí! Llevo el postre. ¿Quieres que lleve algo más?', 300],
      ['Mamá', 'Trae tortillas de maíz de la esquina, las demás las hago yo. Y avísale a tu hermana.', 180],
      ['Tú', 'Va, le escribo. Por cierto te paso la receta de pesto que me gustó, está en mis Recetas favoritas', 400],
      ['Mamá', 'Ay sí, la del plan de entrenamiento que me contaste? Bueno, te espero ❤️', 240],
    ], now - 2 * D),
  },
  {
    title: 'Carlos (trabajo)',
    source: 'facebook',
    participants: ['Tú', 'Carlos'],
    messages: msgs([
      ['Carlos', 'Oye, viste mi mensaje sobre el proyecto del dashboard?', 0],
      ['Tú', 'Sí! Ya lo agregué a mis Ideas de proyectos. El finde lo arranco.', 500],
      ['Carlos', 'Genial. Si necesitas ayuda con las gráficas me avisas. Por cierto leí tu resumen de Hábitos atómicos, muy bueno 👏', 300],
      ['Tú', 'Gracias! Después te paso también el Plan de entrenamiento que armé con Gemini jaja', 220],
    ], now - 6 * D),
  },
];

export function seedSamples() {
  let added = 0;
  for (const n of NOTES) {
    if (store.byTitle(n.title)) continue;
    store.create({ type: 'note', title: n.title, content: n.content, tags: n.tags || [], source: 'manual' });
    added++;
  }
  for (const c of CONVERSATIONS) {
    if (store.byTitle(c.title)) continue;
    const created = c.messages[0]?.ts ? c.messages[0].ts * 1000 : Date.now();
    store.create({ type: 'conversation', title: c.title, source: c.source, participants: c.participants, messages: c.messages, content: '', tags: [], created });
    added++;
  }
  store.save();
  return added;
}
