# server/ — API fase 2
Esqueleto desplegable: Express + TypeScript + Prisma (PostgreSQL + pgvector).

```bash
cd server
npm install
# crear Postgres con extensión vector y poner DATABASE_URL en .env
npx prisma migrate dev
npm run dev   # API en :8787
```
Rutas completas y modelo de datos: `../docs/ARQUITECTURA.md`.
