---
name: ui
description: Diseña y verifica interfaces de Web y Mobile; úsala antes de crear o cambiar pantallas, componentes, estilos, formularios o estados visuales, incluso en ajustes pequeños.
---

# UI

Lee `DESIGN.md`, las instrucciones del área y la pantalla existente antes de editar. Conserva la identidad y accesibilidad del producto; contrasta las reglas generales con las necesidades de las personas usuarias de CERETI.

## Jerarquía y comportamiento

- Prioriza la información que permite identificar y decidir; agrupa controles relacionados y evita repetir datos o acciones en el mismo contexto.
- Usa espacio y jerarquía tipográfica para separar contenido. Reserva líneas para límites funcionales, como un encabezado fijo; evita anidar cajas y usar etiquetas en mayúsculas como decoración.
- Haz interactiva toda la tarjeta cuando tenga un destino principal; conserva las acciones secundarias como controles independientes y accesibles.
- Distingue carga, vacío, error y éxito. Mantén texto, foco, selección y acciones accesibles sin depender solo del color.
- Ajusta la interfaz al espacio real, al texto ampliado y a tecnologías de apoyo. Mantén nombres, iconos y significados consistentes entre pantallas.
- Usa movimiento breve y pertinente, respeta la reducción de movimiento y evita animaciones continuas costosas. No animes interacciones muy frecuentes sin una razón.

## Comprobación

Usa `verify-ceretime` para recorrer la interfaz real y registrar la evidencia. En Web comprueba escritorio y móvil; en Mobile usa el dispositivo y los tamaños de texto que correspondan. Aplica `break-ui` a datos variables. Verifica los estados afectados, teclado o tecnología de apoyo y temas disponibles; informa lo que no se pudo comprobar. No conviertas un prototipo en evidencia de la aplicación.

Para una exploración de variantes solicitada explícitamente lee `.agents/skills/prototype/SKILL.md`. Para componentes shadcn de Web consulta `apps/web/.agents/skills/shadcn/SKILL.md`; para diseño visual nuevo lee `.agents/skills/frontend-design/SKILL.md`.
