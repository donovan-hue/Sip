// Rutas según ARQUITECTURA.md — CRUD real para notas/links/grafo/búsqueda;
// el resto queda cableado para completarse con auth y storage.
import type { Express } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// TODO(fase2): middleware JWT — const auth = (req,res,next)=>{...}
export function registerRoutes(app: Express) {
  app.get('/api/notes', async (_req, res) => {
    res.json(await prisma.note.findMany({ include: { tags: { include: { tag: true } } } }));
  });
  app.post('/api/notes', async (req, res) => {
    const { title, content, type = 'note', kind, folderId, projectId } = req.body;
    res.status(201).json(await prisma.note.create({ data: { title, content, type, kind, folderId, projectId, userId: 'local' } }));
  });
  app.get('/api/links', async (_req, res) => res.json(await prisma.link.findMany()));
  app.post('/api/links', async (req, res) => {
    const { sourceId, targetId, relationship = 'relates' } = req.body;
    res.status(201).json(await prisma.link.create({ data: { sourceId, targetId, relationship } }));
  });
  // nodes/edges derivados de notes+links (sin tabla duplicada)
  app.get('/api/graph', async (_req, res) => {
    const [notes, links] = await Promise.all([prisma.note.findMany(), prisma.link.findMany()]);
    res.json({ nodes: notes.map(n => ({ id: n.id, title: n.title, kind: n.kind || n.type })), edges: links });
  });
  // búsqueda de texto (fase 2b: + tsvector + semántica con pgvector <=>)
  app.get('/api/search', async (req, res) => {
    const q = String(req.query.q || '');
    res.json(await prisma.note.findMany({ where: { OR: [{ title: { contains: q } }, { content: { contains: q } }] } }));
  });
  app.get('/api/conversations', async (_req, res) => res.json(await prisma.conversation.findMany({ include: { messages: true } })));
  // Stubs cableados (completar con auth/storage/colas):
  for (const r of ['auth', 'users', 'folders', 'tags', 'import', 'files', 'ai', 'embeddings', 'projects', 'settings']) {
    app.all(`/api/${r}/*`, (_req, res) => res.status(501).json({ TODO: `/api/${r} — ver docs/ARQUITECTURA.md` }));
    app.all(`/api/${r}`, (_req, res) => res.status(501).json({ TODO: `/api/${r} — ver docs/ARQUITECTURA.md` }));
  }
}
