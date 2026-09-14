# Validación de builds Web y Mobile en CI

TI4-27 prepara la ejecución reproducible de los builds reales que TI4-34 debe validar. Un Pull Request normal conserva las comprobaciones existentes, pero no activa el job adicional `builds` de esta preparación.

## Inventario de scripts reales

| Componente | Script del paquete | Comando de CI | Salida esperada |
| --- | --- | --- | --- |
| Web | `build`: `tsc -b && vite build` | `bun run --cwd apps/web build` | `apps/web/dist/` |
| Mobile | `export`: `expo export --platform all` | `bun run --cwd apps/mobile export` | `apps/mobile/dist/` |

El inventario no incluye `eas build`: `apps/mobile` documenta que `export` genera los bundles JavaScript para Android, iOS y Web, mientras que EAS queda reservado para una construcción Preview posterior.

## Ejecución controlada

Desde la pestaña **Actions**, selecciona el workflow **CI**, la rama head de la PR que quieres validar y **Run workflow**. Activa `run_builds` únicamente cuando TI4-34 autorice la ejecución de los builds reales. Para publicar el resultado en la conversación de la PR, indica también su número en `pr_number`.

La matriz ejecuta Web y Mobile en trabajos independientes con `fail-fast: false`. Cada comando usa el script declarado por su paquete y un código de salida distinto de cero deja fallar el trabajo. El job publica la carpeta `dist/` disponible como artefacto del run incluso si el build falla parcialmente y escribe un resumen con el estado, el comando y un enlace al run en el check de GitHub. Cuando se informa `pr_number`, otro job verifica la coincidencia exacta entre la rama del run y la rama head de la PR del mismo repositorio, y crea o actualiza un comentario con el estado y el enlace. Sin `pr_number`, no se escribe ningún comentario. Los logs del paso fallido quedan en ese check.

El repositorio todavía no exige checks para integrar en `main`. Si el equipo configura como obligatorios `Build web (TI4-34)` y `Build mobile (TI4-34)`, un fallo de cualquiera de los dos impedirá integrar la Pull Request hasta que el run sea exitoso.

Reproducción local, sin EAS ni credenciales:

```sh
bun install --frozen-lockfile
bun run --cwd apps/web build
bun run --cwd apps/mobile export
```

TI4-27 no declara resultados de ejecución. La evidencia de los builds y cualquier bloqueo corresponde al run de TI4-34.
