# Validación de builds Web y Mobile en CI

TI4-27 prepara la ejecución reproducible de los builds reales que TI4-34 debe validar. Un Pull Request normal conserva las comprobaciones existentes, incluido el build Web del job `web`; la matriz manual vive en `.github/workflows/build-validation.yml` y no se agrega a la ejecución automática de la PR.

## Inventario de scripts reales

| Componente | Script del paquete | Comando de CI | Salida esperada |
| --- | --- | --- | --- |
| Web | `build`: `tsc -b && vite build` | `bun run --cwd apps/web build` | `apps/web/dist/` |
| Mobile | `export`: `expo export --platform all` | `bun run --cwd apps/mobile export` | `apps/mobile/dist/` |

El inventario no incluye `eas build`: `apps/mobile` documenta que `export` genera los bundles JavaScript para Android, iOS y Web, mientras que EAS queda reservado para una construcción Preview posterior.

## Por qué aparecían checks como `skipped`

La primera versión incluía estos dos jobs dentro de `ci.yml` y los condicionaba a `workflow_dispatch`. GitHub los mostraba como `skipped` en cada ejecución de `pull_request`, aunque la preparación manual no se hubiera solicitado. Ahora están aislados en un workflow manual para que la CI de la PR no presente checks omitidos.

| Job | Qué hace | Cuándo se ejecuta |
| --- | --- | --- |
| `builds` | Ejecuta en paralelo el build real de Web y el export de Mobile, publica sus carpetas `dist/` como artefactos y deja un resumen del resultado. | Solo mediante **Run workflow** en `Validación de builds`. |
| `publish-pr-result` | Publica o actualiza un comentario en la PR con el estado, el commit validado y el enlace al run. No ejecuta builds ni pruebas. | Siempre después de `builds`; `pr_number` es obligatorio. |

En una ejecución normal de `pull_request`, esos jobs ya no forman parte del workflow `CI`, por lo que no quedan checks `skipped`. La validación Web existente sí se ejecuta en su job normal, pero la matriz adicional de Web y Mobile sigue reservada para la ejecución controlada de TI4-34. En el workflow manual tampoco se omiten pasos por componente: cada trabajo de la matriz ejecuta exactamente el comando que corresponde a su componente.

## Ejecución controlada

Una vez integrada esta preparación en `main`, confirma que la rama candidata de la PR contiene `.github/workflows/build-validation.yml`. Desde la pestaña **Actions**, selecciona **Validación de builds**, esa rama head y **Run workflow**. Indica el número de la PR en `pr_number`; el workflow ejecuta los builds reales y publica el resultado en esa conversación.

La matriz ejecuta Web y Mobile en trabajos independientes con `fail-fast: false`. Cada comando usa el script declarado por su paquete y un código de salida distinto de cero deja fallar el trabajo. El job publica la carpeta `dist/` disponible como artefacto del run incluso si el build falla parcialmente y escribe un resumen con el estado, el comando y un enlace al run en el check de GitHub. Si no hay archivos para publicar, el trabajo falla. Cada intento usa un nombre de artefacto distinto para permitir repetir la ejecución. Una nueva ejecución manual de builds en la misma rama cancela la anterior para impedir que dos runs publiquen evidencia en distinto orden.

Cuando se informa `pr_number`, otro job verifica el repositorio, la rama y el commit del run contra el head actual de la PR, y crea o actualiza un comentario con el estado, el SHA validado y el enlace. Si la rama avanzó durante el build, la publicación falla sin sustituir el comentario anterior: ejecuta de nuevo el workflow sobre el commit vigente. El SHA del comentario permite reconocer un resultado anterior después de nuevos commits. Sin `pr_number`, no se escribe ningún comentario. Los logs del paso fallido quedan en ese check.

Esta preparación no configura reglas de protección de `main`. En TI4-34, un fallo de instalación, build o publicación de artefactos deja el componente sin validar e impide dar por terminada la validación. Un fallo al publicar el comentario requiere corregir la asociación con la PR y volver a publicar la evidencia. Antes de hacer obligatorios los checks `Build web (TI4-34)` y `Build mobile (TI4-34)`, el equipo debe definir su ejecución para cada commit candidato a integración y comprobar con una PR de prueba que un fallo bloquea el merge. La ausencia de un check manual en una PR normal no demuestra que el build haya pasado; la evidencia válida es el run manual asociado al SHA.

Reproducción local, sin EAS ni credenciales:

```sh
bun install --frozen-lockfile
bun run --cwd apps/web build
bun run --cwd apps/mobile export
```

TI4-27 no declara resultados de ejecución. La evidencia de los builds y cualquier bloqueo corresponde al run de TI4-34.

## Pruebas de la preparación

`bun test ./.github/ci-publication.test.ts` ejecuta el script de publicación del workflow con respuestas simuladas de GitHub. Comprueba creación y actualización del comentario, publicación de fallos y rechazo de otra rama, repositorio, número inválido o commit desactualizado. Estas pruebas corren en CI sin ejecutar los builds adicionales ni escribir en GitHub.
