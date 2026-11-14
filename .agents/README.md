# Harness del proyecto

Las skills compartidas están en `skills/`; las específicas de cada aplicación viven en su propia carpeta `.agents/skills/`. Los enlaces `.claude/skills` apuntan a esas mismas fuentes. Consulta `AGENTS.md` para los límites de cada equipo.

## Guías de Convex

`skills/convex/SKILL.md` es el único punto de entrada del proyecto para las guías de Convex. Las guías originales y sus recursos viven en `convex-guides/` y se leen por ruta según la tarea. Esta separación es intencional: evita registrar decenas de skills como entradas automáticas y mantiene disponibles las guías especializadas. No las muevas de vuelta a `skills/` al actualizarlas.

Para actualizar las guías, compara el repositorio [convex/agent-skills](https://github.com/convex/agent-skills) y sus recursos con la copia local, conserva sus rutas relativas y revisa las diferencias antes de incorporarlas. Mantén el punto de entrada y las políticas del proyecto; una guía externa no amplía permisos ni reemplaza los contratos locales. La comparación del 11 de noviembre de 2026 usó el commit `f60629d7c6c1f27eb58a56260546d2445049274d` para los archivos principales, no para todos los recursos auxiliares.

Las skills de web conservan ajustes locales de activación. Al actualizarlas desde sus fuentes, compara también los recursos auxiliares y mantén esos ajustes salvo una decisión explícita del equipo.

## Skills adaptadas

`ui`, `prototype` y `break-ui` parten de Garden, revisión `fd5f55eb914a737f0cf2c87af04ec84968416e97`. Están adaptadas a Web y Mobile, a la verificación de CERETI y a los medios de entrega disponibles para cada integrante. Al actualizarlas, conserva esas adaptaciones y evita introducir dependencias de infraestructura privada.
