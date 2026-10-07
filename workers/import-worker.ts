// Pipeline de importación (BullMQ) según ARQUITECTURA.md:
//   Importar conversación → Procesar → Extraer mensajes → Detectar temas
//   → Crear documentos → Crear relaciones → Generar embeddings → Indexar
// Regla de oro: el original (Nivel 1) SIEMPRE se conserva; las entidades (Nivel 2) se derivan.
export const PIPELINE = [
  'receive-export',      // ZIP/JSON entra por /api/import
  'normalize',           // conversations.json → Conversation + Messages (inmutables)
  'persist-original',    // PostgreSQL (nivel 1) + Storage (adjuntos)
  'extract-entities',    // IA: temas, proyectos, decisiones, tareas, personas, tecnologías
  'create-documents',    // entidades como Notes(type=entity)
  'create-relations',    // Links entidad→conversación, entidad→nota
  'embed',               // pgvector vector(1536)
  'index',               // grafo + búsqueda disponibles
] as const;
// Implementación fase 2: new Worker('imports', processor, { connection: redis })
