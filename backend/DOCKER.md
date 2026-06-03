# Docker Compose para microservicios

Este archivo de ayuda describe cómo levantar los microservicios `auth` y `messages` junto a Postgres para desarrollo local.

Comandos:

1. Construir y arrancar con Docker Compose:

```powershell
docker compose -f ..\docker-compose.micro.yml up --build
```

2. Parar y eliminar contenedores:

```powershell
docker compose -f ..\docker-compose.micro.yml down
```

Notas:
- El `docker-compose.micro.yml` usa la imagen construida desde `./backend` y ejecuta `node dist/services/auth/index.js` y `node dist/services/messages/index.js` como entrypoints.
- Asegúrate de que TypeScript compile (`npm run build`) durante la construcción del contenedor (el Dockerfile ya ejecuta `npm run build`).
- Variables de entorno de ejemplo están en `.env_micro`.
