---
name: verify-ceretime
description: Comprueba en las superficies reales los flujos de CERETI y documenta evidencia y límites. Úsala al terminar cambios de comportamiento o interfaz, reproducir un fallo o demostrar que un flujo funciona.
---

# Verificar CERETI

Una verificación demuestra el comportamiento del cambio en la superficie afectada y registra sus límites. Una compilación o un test aislado no demuestra por sí solo que una pantalla funciona. Usa únicamente datos ficticios o anonimizados y entornos de prueba; no operes sobre instalaciones o datos en uso.

## Determinar el recorrido

Lee la issue, las instrucciones del área y el diff. Identifica el comportamiento observable, los roles y las superficies afectadas; si cambia un contrato de Convex, sigue sus consumidores en Web y Mobile. Elige los caminos de éxito, error, permisos, estado vacío y persistencia que el cambio pueda afectar. Para un bug, reproduce primero el fallo y comprueba la corrección con el mismo caso.

## Identificar el destino

Desde la raíz, registra `git rev-parse HEAD`, `git status --short` y `git branch --show-current`. Para Web, `ss --no-header --listening --tcp --numeric --processes` identifica el proceso que escucha el puerto; comprueba su directorio de trabajo antes de atribuirlo a este checkout. Una respuesta HTTP no demuestra que el backend, los datos o la sesión estén preparados. Si hay un deployment, confirma que es propio y de prueba sin imprimir secretos. Para Mobile, registra dispositivo, aplicación instalada y revisión servida por Metro; un APK o bundle anterior no verifica el cambio local.

La preparación de Web está en [README.md](../../../README.md#entorno-ti2-desde-un-clon-limpio). El [dataset ficticio](../../../docs/dataset-ficticio.md) no permite iniciar sesión con sus perfiles: un recorrido autenticado necesita una cuenta de prueba autorizada y una identidad vinculada, sin modificar producción. Si faltan esas precondiciones, deja el recorrido pendiente. La [guía de Mobile](../../../apps/mobile/README.md#mapa-de-rutas) contiene las rutas y roles de la demo; su estado vive en memoria.

## Comprobar

- Ejecuta `bun run lint` y `bun run format:check` desde la raíz, además de ortografía para los archivos modificados. Ejecuta las pruebas y tipos pertinentes al cambio; los comandos disponibles están en los `package.json` y la CI.
- **Web:** recorre el flujo en el navegador real, comprueba escritorio y móvil cuando la interfaz sea adaptable y observa errores visibles. Consulta `README.md` para configurar el entorno de desarrollo; verifica que la instancia corresponde a la rama y usa datos ficticios antes de escribir.
- **Mobile:** usa Android con la aplicación de este cambio, no Expo web. Consulta `apps/mobile/README.md` y `apps/mobile/AGENTS.md`; respeta sus restricciones para iniciar Metro y para usar dispositivos. La demostración en memoria no demuestra integración con Convex. Si no hay dispositivo o entorno apropiado, registra el recorrido como pendiente.
- **Convex:** ejecuta las pruebas focalizadas con `bunx vitest run <archivo>` y, cuando cambien permisos o contratos, comprueba los casos negativos y consumidores afectados. Usa un deployment de prueba aislado solo cuando sea necesario y esté configurado; no uses producción para probar.

Si un resultado falla, distingue una regresión de un fallo previo: intenta reproducirlo en la base cuando sea posible. Si agregas una prueba para un invariante, comprueba que puede fallar antes de confiar en su resultado verde. No señales una comprobación como ejecutada si el entorno no la permitió.

## Evidencia y entrega

Para cambios visuales captura la interfaz final real y, cuando ayude a revisar el cambio, el estado anterior; muestra también la vista móvil si aplica. Si muestra datos variables, aplica `break-ui` antes de la captura final. Inspecciona cada captura y no incluyas datos sensibles. Para comportamiento registra la ruta, rol, datos de prueba, acciones, resultado y comandos. Si hay interacción o movimiento relevante, usa vídeo.

Informa **Verificado** solo cuando el recorrido y las comprobaciones pertinentes pasaron; **No verificado** si falta ejecutarlo; **Inconcluso** si el resultado no permite decidir. Enumera superficies y estados comprobados, fallos, evidencia y pendientes. Detén únicamente los procesos que iniciaste tú y conserva la evidencia según las instrucciones del entorno.

Para ampliar o reparar los recorridos y herramientas de esta skill, usa `create-verification-skill` si está disponible. La verificación diaria ejecuta lo ya preparado; no crea un verificador nuevo en cada tarea.
