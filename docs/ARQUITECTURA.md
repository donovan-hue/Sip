# 🏛 ARQUITECTURA — Sinapsis: base de conocimiento personal con IA

> No es un clon de Obsidian: es una **base de conocimiento personal con IA** donde tus
> conversaciones (ChatGPT, Gemini, WhatsApp, Messenger) son fuentes de primera clase.

## Estado actual (FASE 1 — en producción, 100% cliente)

Todo lo marcado ✅ ya funciona en https://donovan-hue.github.io/Sip/ sin backend:

| Capacidad | Estado | Implementación |
|---|---|---|
| Editor Markdown + `[[wikilinks]]` | ✅ | `js/app.js`, `js/md.js` |
| Grafo 3D en tiempo real | ✅ | `js/graph3d.js` (three.js, fuerzas, bloom, señales) |
| Importador ChatGPT/Gemini/WhatsApp/Messenger/genérico | ✅ | `js/importers.js` |
| Import original preservado (Nivel 1) | ✅ | mensajes crudos en `store.notes[].messages` |
| Carpeta buzón con auto-import | ✅ | `js/sync.js` (File System Access API) |
| Respaldo a GitHub | ✅ | `js/github.js` (API Contents) |
| Chat RAG con tu conocimiento + citas | ✅ | `js/ai.js` → `ask()`: recuperar contexto → enviar SOLO eso → citar [n] |
| Búsqueda semántica (embeddings + coseno) | ✅ | `js/ai.js` → IndexedDB de vectores |
| Extracción Nivel 2 (temas/decisiones/tareas/tecnologías/proyectos) | ✅ | `js/ai.js` → `extractFromConversation()` + `applyExtraction()` |
| Grafo con entidades Nivel 2 | ✅ | `store.computeGraph()` — colores por tipo de entidad |
| Búsqueda texto + semántica + grafo | ✅ | topbar + panel IA + doble clic/enfocar en grafo |

**Decisión de seguridad implementada:** la IA **nunca** recibe toda la base. Flujo real:

```
Pregunta → retrieve(query, k=6) → SOLO los 6 fragmentos relevantes → LLM → respuesta con citas [n]
```

## FASE 2 — Backend (esqueleto codificado en `/server` y `/workers`)

```
┌─────────────────────┐
│   APP WEB/ANDROID   │  ← apps/web (hoy: raíz del repo, Next.js en fase 2)
│ Editor + Grafo + IA │
└──────────┬──────────┘
           │ API REST + WebSocket / Auth JWT
┌──────────┴──────────┐          ┌─────────────┐
│  BACKEND Node+TS    │◄────────►│ IA: embeds  │
│  Express + Jobs     │          │ RAG + LLM   │
└──────────┬──────────┘          └─────────────┘
     ┌─────┴─────┐
┌────▼─────┐ ┌───▼──────────┐
│PostgreSQL│ │ Object Store │  (Cloudflare R2 / S3)
│+pgvector │ │ archivos/PDF │
└──────────┘ └──────────────┘
```

### API (rutas definidas en `server/src/routes.ts`)

```
/api/auth  /api/users  /api/notes  /api/folders  /api/tags
/api/links /api/graph  /api/search /api/conversations
/api/import /api/files /api/ai     /api/embeddings
/api/projects /api/settings
```

### Modelo de datos (`server/prisma/schema.prisma`)

users · notes · folders · tags · note_tags · links · projects · conversations ·
messages · attachments · embeddings (pgvector `vector(1536)`) · ai_runs · imports
+ vistas derivadas nodes/edges desde notes+links.

### Pipeline de importación (worker)

```
ChatGPT Export.zip → Import Engine → conversations.json
  → Normalizador (conserva original: Conversation → Messages)
  → PostgreSQL + Storage
  → Procesamiento IA (temas, proyectos, decisiones, tareas, personas, tecnologías)
  → Embeddings → Indexar → Grafo de conocimiento
```

Regla de oro: **nunca convertir una conversación directamente en nota**. Primero el
original (Nivel 1), después las entidades (Nivel 2), después las relaciones (Nivel 3).

### Los tres niveles de conocimiento

1. **Original** — lo que realmente dijiste (messages crudos, inmutables).
2. **Estructurado** — Proyecto · Tema · Decisión · Tarea · Tecnología · Persona · Documento.
3. **Relacionado** — el grafo: KRONOS → Webhooks → Vercel → GitHub → deploy-verify.yml.

### Stack fase 2

| Capa | Tecnología |
|---|---|
| Frontend | Next.js + React + TypeScript + Tailwind |
| Grafo | three.js propio (ya existe) / React Flow para 2D |
| Backend | Node.js + TypeScript + Express |
| DB | PostgreSQL + pgvector |
| Storage | Cloudflare R2 |
| Auth | JWT/sesión + 2FA opcional + Row Level Security |
| IA | OpenAI + proveedor secundario (Groq/OpenRouter ya soportados) |
| Jobs | Redis + BullMQ (workers en `/workers`) |
| Deploy | Vercel (web) · Render (API) · Supabase/Postgres · Cloudflare (CDN) |

**PostgreSQL sobre MongoDB**: relaciones, permisos, RLS, búsquedas y embeddings en un
solo motor (`pgvector`) simplifican todo.

### Seguridad

HTTPS · JWT · 2FA opcional · RLS por usuario · cifrado en tránsito y reposo ·
backups · audit log (`ai_runs`, `imports`) · contexto mínimo a la IA (ya implementado).

## Estructura del repo

```
/ (raíz = app web fase 1, servida por GitHub Pages)
├── index.html · css/ · js/ · vendor/ · tests/
├── docs/ARQUITECTURA.md   ← este documento
├── server/                ← API Express+TS + Prisma (fase 2, desplegable en Render)
└── workers/               ← import-worker y embedding-worker (BullMQ)
```

Migración fase 2: mover la raíz a `apps/web` (Next.js) y reutilizar `js/ai.js`,
`js/importers.js` y `js/graph3d.js` como `packages/shared`.
