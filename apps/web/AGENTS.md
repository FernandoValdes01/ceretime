# Aplicación web

`apps/web/` es el frontend web de CERETI y pertenece a TI2. Su responsabilidad es Presentación: interfaz React, navegación, estado local de la interfaz e integración cliente con la API pública de Convex.

## Antes de cambiar código

- Toma la issue vigente en Linear como autoridad final para el alcance operativo, la prioridad, las dependencias y los criterios de cierre. Usa los documentos versionados para el vocabulario y las decisiones estables del producto.
- Consulta `CONTEXT.md` para usar el lenguaje del producto y `DESIGN.md` para las decisiones visuales y de accesibilidad.
- Revisa la documentación relevante de `docs/` cuando el cambio afecte arquitectura, contratos, autenticación o responsabilidades entre TI2 y TI4.
- Si el cambio consume o modifica Convex, inspecciona la función pública y sus consumidores en `apps/mobile/` antes de cambiar el contrato.
- Verifica que las APIs, los tipos y las dependencias existan en el estado actual antes de importarlos; la arquitectura prevista no implica que una integración ya esté implementada.

## Límites de la aplicación

- Mantén la lógica de interfaz en React y la lógica de negocio compartida en el backend o en módulos de Aplicación/Dominio definidos por el proyecto.
- Consume la API pública y los tipos generados de Convex; no accedas a la base de datos desde el frontend ni copies funciones del backend en `apps/web/`.
- Toda variable `VITE_` queda expuesta al navegador: úsala sólo para configuración pública, nunca para secretos o credenciales.
- Si falta una capacidad en el backend, coordina el cambio en `convex/`; no fabriques una segunda implementación local para desbloquear la pantalla.
- Los guards de Web mejoran la navegación y la experiencia; la autorización efectiva siempre se comprueba en Convex.
- Usa sólo datos ficticios o anonimizados en desarrollo, pruebas y demostraciones.

## Experiencia y accesibilidad

- Usa los términos definidos en `CONTEXT.md` y conserva los estados de carga, vacío, error y éxito que permitan entender qué ocurre sin depender del color o de una animación.
- Usa HTML semántico, controles operables con teclado, foco visible, nombres accesibles y anuncios adecuados para cambios dinámicos.
- Respeta el sistema visual de `DESIGN.md`, incluidos contraste AA, objetivos táctiles de al menos 44 × 44 px y composición responsive sin desplazamiento horizontal innecesario.
- Mantén los componentes simples y extrae una abstracción sólo cuando exista una responsabilidad compartida clara.

## Verificación

Desde la raíz del repositorio, ejecuta `bun --cwd apps/web run lint` y `bun --cwd apps/web run build` después de cambios en la aplicación.

Si cambias un contrato público de Convex, verifica también `convex/` y las aplicaciones consumidoras antes de considerar terminada la tarea; el trabajo web está completo cuando el lint y el build pasan y los estados afectados siguen siendo accesibles.
