# Documentación de CERETIME

Este índice distingue el diseño acordado, las guías para trabajar y la evidencia de pruebas. El código y las issues vigentes permiten comprobar qué parte del diseño ya funciona.

## Producto y arquitectura

- [Especificación del prototipo](especificacion-prototipo.md): alcance, roles y requisitos del producto objetivo.
- [Lenguaje del dominio](../CONTEXT.md), [diseño de interfaz](../DESIGN.md) y [decisiones arquitectónicas](adr/): términos, criterios visuales y razones de las decisiones.
- [Diagramas](diagramas/integra4.drawio): arquitectura, componentes, casos de uso y modelo de datos objetivo; no acreditan que todas las funciones estén implementadas.
- [Aplicación de la Ley 21.719](producto/ley-21719.md): análisis para el prototipo y sus límites.
- [Contratos compartidos](contratos-sprint-1.md): operaciones y acuerdos de integración entre Backend, Web y Mobile.

## Desarrollo y operación

- [Inicio del repositorio](../README.md): configuración local, Linear y flujo de trabajo.
- [Dataset ficticio](dataset-ficticio.md): datos de prueba, carga y límites de los perfiles.
- [Guía Mobile](../apps/mobile/README.md) y [guía Web](../apps/web/README.md): ejecución y verificaciones por aplicación.
- [Google Calendar](integraciones/google-calendar.md): integración por atención y alternativa `.ics`.
- [CI y protecciones](operaciones/ci-protections.md), [validación de builds](operaciones/ci-build-validation.md) y [despliegue Web](operaciones/vercel-deployment.md): configuración y operación del proyecto.
- [Issues](agents/issue-tracker.md), [pull requests](agents/pull-requests.md) y [PR apiladas](agents/r2d2-stacked-prs.md): coordinación del equipo.
- [Estándares de código](../CODING_STANDARDS.md) y [patrones](../patterns/README.md): reglas compartidas, comprobaciones y ejemplos para implementar y revisar.

## Verificación y evidencia

- `evidence/`: capturas históricas compartidas. La evidencia específica de cada aplicación permanece en `apps/web/docs/` o `apps/mobile/docs/`.

## Material académico

- [Requerimientos](requerimientos.pdf) y [código de ética](codigo-etica.pdf): documentos de entrega; sus fuentes están en `sources/`.
- [Tutoriales](tutoriales/): PDF de Git, configuración técnica y Google OAuth; sus fuentes están en `sources/tutoriales/`.
- [Instrucciones de documentación](AGENTS.md): relación entre las fuentes editables y los PDF.
