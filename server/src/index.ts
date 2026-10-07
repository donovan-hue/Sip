// API Sinapsis (fase 2) — Express + Prisma/PostgreSQL+pgvector
import express from 'express';
import cors from 'cors';
import { registerRoutes } from './routes.js';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? '*' }));
app.use(express.json({ limit: '25mb' }));
registerRoutes(app);
app.get('/health', (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`Sinapsis API en :${port}`));
