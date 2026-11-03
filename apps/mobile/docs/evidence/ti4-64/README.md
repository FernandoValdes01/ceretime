# TI4-64: comprobaciones propias de la consolidación WCAG

<!-- cspell:words talkback -->

Issue: [TI4-64](https://linear.app/ceretime/issue/TI4-64). Consolidación del 3 de noviembre de 2026 sobre `main` `5c641432cb5179469cdd303147dcb68375f0c89a` (B1), en la rama `vrivera/ti4-64-consolidar-evidencias-talkback`. El resultado vive en la [matriz WCAG](../../accessibility/wcag-matrix.md), sección Consolidación S4; este informe solo registra lo que se comprobó para escribirla y lo que no.

## Qué se ejecutó

No se ejecutó ninguna prueba nativa. No había un dispositivo ni un emulador Android conectado (`adb devices` vacío) ni un Metro activo, y [AGENTS.md de Mobile](../../../AGENTS.md) prohíbe iniciarlos sin solicitud explícita. Por eso no existe una captura, una grabación ni una confirmación auditiva de TI4-64: ninguna fila pasó a Aprobado y las capturas de las otras tareas conservan su versión original.

Lo ejecutado fue de repositorio, con datos ficticios y sin tocar código de la aplicación:

| Comprobación                                                                                           | Resultado                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Jest de Mobile en B1: `build-run bun run --cwd apps/mobile test`, tras `bun install --frozen-lockfile` | 26 suites y 273 pruebas pasan, las mismas cifras que registra [TI4-63](../ti4-63/README.md). Sin la instalación, 13 suites fallaban por el módulo `expo-speech` ausente en `node_modules`; era un entorno local desactualizado, no un defecto.                                                                                                               |
| Vigencia de E63: `git diff bfd60b4 HEAD -- apps/mobile/src apps/mobile/app`                            | Vacío. `bfd60b4` no es ancestro de `main` (squash), de modo que se comparó el árbol.                                                                                                                                                                                                                                                                         |
| Vigencia del cierre táctil de E63: la misma diferencia desde `6656b03`                                 | Solo `role-tabs.tsx` y el `_layout.tsx` del Profesional, es decir, las pestañas compactas de la última sección de E63.                                                                                                                                                                                                                                       |
| Vigencia de E52, E57 y E58: la misma diferencia desde `641c967`, binario de esas pruebas               | Cambiaron cabecera, pestañas, formulario y flujo del Estudiante, la lista del Administrador (tamaño del avatar), el `_layout.tsx` del Profesional y el módulo de voz. Las pantallas del Profesional y del Practicante no cambiaron. El JavaScript probado era el de la rama de la PR, sin commit consignado: la comparación acota la vigencia, no la prueba. |
| Rutas de B1 frente al inventario: `find apps/mobile/app -name '*.tsx'`                                 | La única ruta nueva desde B0 es `/preferencias`, con su bloque de filas. No existe ruta de reserva estudiantil.                                                                                                                                                                                                                                              |

## Qué queda abierto

Todo criterio sin una ejecución nativa suficiente sigue como No probado, con su motivo en la fila. Quedan sin comprobar en dispositivo: TalkBack combinado con texto al 200 % en el flujo guiado, 150 % del flujo guiado, audición de los anuncios H5 y H6 de TI4-48, contraste medido, objetivos táctiles medidos, teclado externo, reflujo y espaciado. La prueba final de Juan y los comandos de Fernando de S4 tienen evidencia propia y no se esperaron.

Para cerrar esos criterios, una sesión con autorización para iniciar Metro y un dispositivo debe seguir los métodos M1 a M10 de la matriz y añadir una versión por cada repetición, sin reescribir las filas anteriores.
