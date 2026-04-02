# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

POS system for Padano SRL — a full-stack JavaScript app with ERP integration (Centum), electronic invoicing (AFIP), payments (Mercado Pago, Talo), and 203 MCP tools exposed at `/mcp`.

### Modules

| Module | Description |
|--------|-------------|
| POS / Ventas | Point of sale, sales history, conciliation, receipts (ticket + A4) |
| Compras | Purchase orders, suppliers, demand analysis, AI-suggested orders |
| Traspasos | Inter-branch transfers with canastos/pallets tracking |
| Cajas / Cierres | Cash register control, opening/closing, denomination counts |
| Pedidos | Internal orders with payment links (MP, Talo) |
| Clientes | Client management, Centum sync, AFIP lookup, duplicates detection |
| Artículos | Product catalog, ERP sync, stock by branch, pricing |
| RRHH | Employees, shifts, time tracking (fichajes), licenses, holidays |
| Tareas | Task management with AI analytics and compliance tracking |
| Auditoría | Sales audit with KPIs, charts, AI chat, cancellation tracking |
| Gift Cards | Activation, sale, balance tracking |
| Promociones | Conditional promotions (buy N of A, get discount on B) |
| Delivery | Delivery guides, PedidosYa + Rappi integration (in progress) |

## Development Commands

```bash
# Backend (Express, port 3001)
cd backend && npm run dev      # nodemon with hot reload
cd backend && npm test         # Jest tests (no test files exist yet)
cd backend && npx jest path/to/file.test.js  # Run single test

# Frontend (React+Vite, port 5173)
cd frontend && npm run dev     # Vite dev server
cd frontend && npm run build   # Production build
```

Both services must run simultaneously. Frontend expects backend at `VITE_API_URL` (default http://localhost:3001). No linter is configured.

## Deployment

- **Frontend:** Vercel (auto-deploy on push to main, root directory: `frontend`)
- **Backend:** Render (auto-deploy on push to main, config in `render.yaml`)
- **Database:** Supabase (manual SQL migrations in `sql/` and `supabase/`)

## Architecture

**Monorepo with two independent npm projects** — no workspace setup. Backend uses CommonJS (`require`), frontend uses ESM (`import`).

```
elias/
├── backend/src/
│   ├── index.js              # Express app entry — mounts all /api routes + MCP
│   ├── config/               # supabase.js (Supabase client), centum.js (SQL Server BI)
│   ├── middleware/auth.js    # JWT verification + offline cache fallback
│   ├── routes/               # 35 route files, mounted under /api/{module}
│   ├── services/             # 20 service files: ERP sync, AFIP, MP, email, PDF, AI
│   └── jobs/cron.js          # node-cron scheduled background tasks
├── backend/mcp-server.js     # MCP StreamableHTTPServerTransport at /mcp
├── backend/mcp-tools-config.js  # All MCP tool definitions (~203)
├── frontend/src/
│   ├── App.jsx               # All routes defined here (react-router-dom v6)
│   ├── pages/                # Feature modules: pos/, compras/, auditoria/, rrhh/, etc.
│   ├── components/           # Reusable UI organized by feature (pos/, cajas/, layout/)
│   ├── context/AuthContext.jsx  # Global auth state, offline login support
│   ├── services/api.js       # Axios client with auto JWT injection + token refresh
│   ├── services/offlineDB.js # IndexedDB cache (articles, clients, promos)
│   └── utils/                # Receipt/label printing (jsPDF, thermal printer)
├── supabase/schema.sql       # Core database schema
└── sql/                      # 23 additional migration SQL files
```

### Auth & Roles

Three roles: `admin`, `gestor`, `operario`. Stored in Supabase `perfiles` table linked to `auth.users`. Note: the original schema CHECK constraint only has `admin`/`operario` — `gestor` was added later in application code but the DB constraint may need updating.

- **Backend:** `verificarAuth` middleware validates Supabase JWT via `Authorization: Bearer` header. Populates `req.usuario` and `req.perfil`. Has in-memory cache (1h TTL) for offline fallback. Role guards: `soloAdmin`, `soloGestorOAdmin`.
- **Frontend:** `AuthContext` stores user in state + localStorage. `RutaProtegida` component wraps routes with `rolesPermitidos` or `soloAdmin` props. `api.js` auto-injects token and handles 401 refresh.
- **Emergency mode:** Token prefix `emergency-offline-` bypasses Supabase validation (operario role only).

### Route Convention

Backend routes in `index.js` follow the pattern `app.use('/api/{module}', moduleRoutes)`. Some modules (retiros, gastos) mount at `/api` directly with sub-paths defined in their route files.

Frontend routes are all declared in `App.jsx` — no nested route files. Each page is a standalone component that fetches its own data.

### Data Flow: POS → ERP

1. Sale created in Supabase (`ventas_pos` table)
2. `centumVentasPOS.js` service syncs to Centum ERP REST API
3. AFIP electronic invoice requested via `afip.js`
4. CAE (authorization code) saved back to the sale record

### Key Patterns

- **Services** in `backend/src/services/` contain all business logic. Routes are thin — they validate input and delegate to services.
- **Frontend pages** are self-contained: each fetches data, manages local state, renders UI. No global store beyond AuthContext.
- **Offline-first PWA:** IndexedDB caches via `offlineDB.js`, Service Worker (`sw.js`) with Workbox.
- **No TypeScript** — entire codebase is JavaScript (JSX for frontend).

### External Integrations

| System | Purpose | Key Files |
|--------|---------|-----------|
| Centum ERP | REST API + SQL Server BI for articles, clients, stock, sales | `services/centum*.js`, `config/centum.js` |
| AFIP | Electronic invoicing (Factura A/B, Nota de Crédito) | `services/afip.js` |
| Mercado Pago | Point/posnet payments + QR | `routes/mpPoint.js`, `services/mercadopago.js` |
| Talo | Bank transfer payment links | `services/talo.js` |
| Supabase | PostgreSQL + Auth + Row-Level Security | `config/supabase.js` |
| Claude AI | AI analysis for audits, purchases, tasks | `services/claude.js`, `services/claudeCompras.js`, `services/patronesIA.js` |
| Web Push | VAPID push notifications to admins | `routes/push.js` |
| PedidosYa/Rappi | Delivery platform integration (in progress) | `routes/pos.js` (guías delivery) |

### Key Services (backend/src/services/)

| Service | Purpose |
|---------|---------|
| `centumVentasPOS.js` | Sync POS sales → Centum ERP |
| `centumClientes.js` | Client sync with Centum REST + BI |
| `centumPedidosVenta.js` | Sync sales orders to Centum |
| `centumAjusteStock.js` | Automatic stock adjustments in ERP |
| `syncERP.js` | General ERP synchronization |
| `retrySyncVentasPOS.js` | Retry failed sale syncs |
| `syncPedidosVenta.js` | Sync sales orders |
| `afip.js` | AFIP electronic invoicing (CAE) |
| `mercadopago.js` | Mercado Pago Point integration |
| `talo.js` | Talo bank transfer links |
| `claude.js` | AI analysis for audits and cashier behavior |
| `claudeCompras.js` | AI-suggested purchase orders + demand analysis |
| `patronesIA.js` | AI behavior pattern detection for auditing |
| `tareasScheduler.js` | Cron-based task scheduling |
| `historialCajero.js` | Cashier performance history |
| `email.js` | Email sending (invoices, reports) |
| `pdfGenerator.js` | PDF generation |
| `comprobanteHTML.js` | HTML receipt generation |
| `apiLogger.js` | API request/response logging |
| `demandaCompras.js` | Purchase demand calculation |

### Database

- **Supabase (PostgreSQL):** 50+ tables with RLS. Core: `perfiles`, `articulos`, `articulos_por_sucursal`, `ventas_pos`, `clientes`, `pedidos`, `cierres`, `empleados`.
- **SQL Server (Centum BI):** Read-only via `mssql` driver for ERP data sync.
- **Migrations:** SQL files in `sql/` and `supabase/`, applied manually via Supabase SQL Editor.

### Centum ERP Gotchas

- Division field: `DivisionEmpresaGrupoEconomico.IdDivisionEmpresaGrupoEconomico` (NOT `DivisionEmpresa`). ID 3 = Empresa, ID 2 = Prueba.
- Client update: `POST /Clientes/Actualizar` with `IdCliente` in body (NOT PUT/PATCH — returns 405).
- Factura A (RI/MT): precios NETOS (sin IVA). Factura B (CF): precios FINALES (con IVA).
- Nota de Crédito: `IdTipoComprobanteVenta: 6`. Centum auto-assigns reference by client+PV.

## Environment Variables

Backend `.env` requires: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `PORT`, `FRONTEND_URL`, `CENTUM_BASE_URL`, `CENTUM_API_KEY`, `CENTUM_BI_*` (SQL Server connection), plus keys for AFIP, Mercado Pago, email, Talo.

Frontend `.env` requires: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`.

See `.env.example` in each directory for full list.
