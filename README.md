# Sistema de Pedidos Internos

App web mobile-first para gestión de pedidos entre sucursales.

## Stack
- **Frontend**: React + Vite + Tailwind CSS → deploy en Vercel
- **Backend**: Node.js + Express → deploy en Railway
- **Base de datos y auth**: Supabase

---

## 1. Configurar Supabase

1. Crear proyecto en [supabase.com](https://supabase.com)
2. Ir a **SQL Editor** y ejecutar el contenido de `supabase/schema.sql`
3. Ir a **Authentication > Users** y crear los usuarios manualmente:
   - 1 admin: `admin@empresa.com`
   - 1 operario por sucursal: `sucursal1@empresa.com`, etc.
4. Luego de crear cada usuario, insertar su perfil en la tabla `perfiles` vía SQL Editor (ver ejemplos en el schema)

---

## 2. Variables de entorno

**Backend** (`/backend/.env`):
```
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_KEY=tu-service-role-key
PORT=3001
FRONTEND_URL=http://localhost:5173
```

**Frontend** (`/frontend/.env`):
```
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key
VITE_API_URL=http://localhost:3001
```

---

## 3. Correr en desarrollo

```bash
# Backend
cd backend
npm install
npm run dev

# Frontend (en otra terminal)
cd frontend
npm install
npm run dev
```

---

## 4. Deploy

### Backend → Railway
1. Crear proyecto en Railway conectado al repo
2. Configurar las variables de entorno en Railway
3. Railway detecta automáticamente Node.js

### Frontend → Vercel
1. Crear proyecto en Vercel conectado al repo
2. Configurar `Root Directory` como `frontend`
3. Agregar las variables de entorno `VITE_*` en Vercel

---

## Estructura del proyecto

```
/
├── backend/
│   ├── src/
│   │   ├── config/      # Configuración de Supabase
│   │   ├── middleware/  # Autenticación y roles
│   │   └── routes/      # Endpoints de la API
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/  # Componentes reutilizables
│   │   ├── context/     # Estado global (auth)
│   │   ├── pages/       # Páginas por rol
│   │   └── services/    # Cliente HTTP
│   ├── .env.example
│   └── package.json
└── supabase/
    └── schema.sql       # Esquema de la base de datos
```
