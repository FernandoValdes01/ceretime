# Web (TI2)

Aplicación web de CereTime: React, Vite y TanStack Router, con el backend Convex compartido de `convex/`. No contiene lógica de negocio: la autorización ocurre en el backend.

Para levantarla desde un clon limpio, con el dataset ficticio del Sprint 1, sigue la guía [Entorno TI2 desde un clon limpio](../../README.md#entorno-ti2-desde-un-clon-limpio) del README raíz. Las variables públicas que usa están en `.env.example`, sin valores.

Comprobaciones propias de la web, desde la raíz del repositorio:

```sh
bun run test:web
bun --cwd apps/web run lint
bun --cwd apps/web run build
```
