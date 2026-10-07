# Workers (fase 2)
- `import-worker.ts` — pipeline de importación (ver `docs/ARQUITECTURA.md`)
- `embedding-worker.ts` — genera/refresca embeddings en pgvector
Cola: Redis + BullMQ. Deploy: Render background workers.
