---
created: 2026-11-09T00:00
updated: 2026-11-09T00:00
---

# Rutas web por rol y navegación común

Documenta la división del árbol de rutas y el encabezado común de la Web incorporados en TI2-133, la relación con la referencia visual adjunta a la issue y las diferencias que se mantienen a propósito.

## Referencia visual

La issue TI2-133 adjunta `mockup.zip`, un proyecto Next.js de referencia. No se copia el proyecto: se porta su estructura a la Web de CERETI. Los archivos que definen las pantallas y componentes son:

- `app/layout.tsx`: enlace de salto, encabezado fijo, contenido principal y pie.
- `components/site-header.tsx`: marca, acceso a «Mis citas» y menú de accesibilidad.
- `components/site-footer.tsx`: datos de contacto, horario y dirección.
- `app/panel/page.tsx`: panel de citas próximas e historial.
- `app/agendar/*`: flujo de reserva por pasos (servicio, fecha, datos y confirmación).
- `components/accessibility/*`: tamaño de texto, alto contraste y lectura en voz alta.

La Web conserva de esa referencia el encabezado fijo, la marca con retorno al inicio, el menú de accesibilidad, el enlace de salto y la jerarquía de títulos y regiones. El resto se adapta al producto y a `DESIGN.md`.

## Archivos de rutas

Cada área define su árbol en un archivo propio. `router.tsx` solo compone la raíz y no contiene definiciones de ruta.

| Archivo | Área | Rutas |
| --- | --- | --- |
| `root-route.ts` | Raíz | Envoltorio común, 404 y destino desconocido |
| `public-routes.ts` | Pública | `/`, `/login` y `/denegado` |
| `student-routes.ts` | Estudiante | `/estudiante`, `/estudiante/solicitudes`, `/estudiante/solicitudes/$requestId`, `/estudiante/horarios`, `/estudiante/reservar`, `/estudiante/atenciones`, `/estudiante/atenciones/$appointmentId` y `/estudiante/acompanamientos/$accompanimentId` |
| `professional-routes.ts` | Profesional | `/profesional`, `/profesional/solicitudes`, `/profesional/solicitudes/$requestId`, `/profesional/disponibilidad`, `/profesional/agenda` y `/profesional/agenda/$appointmentId` |
| `practitioner-routes.ts` | Practicante | `/practicante`, `/practicante/acompanamientos` y `/practicante/acompanamientos/$accompanimentId` |
| `admin-routes.ts` | Administrador | `/administrador` y `/administrador/espacios` |

Las URL y las guardias vigentes no cambian: cada layout conserva su `RequireStudent` o `RequireStaffRole`, y las páginas siguen resolviendo sus parámetros con `getRouteApi` sobre la misma ruta.

## Navegación por rol

`navigation.ts` concentra la navegación visible de los cuatro portales. Solo enlaza pantallas reales; el cierre de sesión es un botón y no una ruta.

| Portal | Enlaces |
| --- | --- |
| Estudiante | Inicio, Solicitudes, Horarios, Reservar y Atenciones |
| Profesional | Inicio, Solicitudes, Agenda y Disponibilidad |
| Practicante | Inicio y Acompañamientos |
| Administrador | Inicio y Espacios |

El encabezado común vive en `app-shell.tsx` y `app-shell.css`. Marca la sección actual con `aria-current="page"`, distingue el elemento activo con fondo y subrayado (no solo color) y mantiene objetivos táctiles de 44 × 44 px. El botón «Cerrar sesión» llama a `authClient.signOut()`, espera la invalidación de la sesión y vuelve al índice. Se retiró el enlace «Sesión» que apuntaba a `/login` porque no cerraba la sesión.

## Cómo agregar una ruta

1. Crea la página en la carpeta de Presentación que corresponda (`estudiante/`, `gestion/`, etc.).
2. Agrega el puente de ruta en `route-components.tsx` si la página necesita parámetros o búsqueda.
3. Define el `createRoute` en el archivo del área y agrégalo al `addChildren` de ese layout.
4. Si la pantalla debe aparecer en el encabezado, agrega su enlace a la lista del portal en `navigation.ts`.
5. No edites el archivo de rutas de otra área ni `router.tsx`: la composición ya incluye los cinco archivos.

## Diferencias con la referencia visual

- **Marca:** la referencia usa «Centro de Apoyo Universitario» y «Universidad Inclusiva»; la Web conserva CERETI y la Universidad Católica de Temuco.
- **Tipografía:** la referencia usa Nunito y Nunito Sans; la Web conserva Fira Sans y la escala de `DESIGN.md`.
- **Color:** la referencia usa un primario azul y un fondo cálido; la Web conserva el teal institucional de `DESIGN.md`.
- **Navegación:** la referencia tiene un único enlace «Mis citas»; la Web separa los portales por rol y enlaza solo las pantallas entregadas.
- **Pie de página:** no se porta el pie de la referencia porque sus teléfonos, correo, horario y dirección son inventados. Publicarlos como datos reales induciría a error; si se agrega más adelante, debe usar canales oficiales.
- **Panel:** la referencia muestra un nombre fijo y citas de ejemplo; la Web consulta datos propios según el rol y no inventa atenciones.
- **Sesión:** la referencia no modela el cierre de sesión; la Web lo resuelve con Better Auth en el encabezado.

## Accesibilidad

La referencia presenta dos barreras que se corrigieron en la implementación:

- **Foco oculto por el encabezado fijo (WCAG 2.2, 2.4.11):** al navegar con teclado, el encabezado podía tapar el elemento enfocado. La Web reserva la altura del encabezado con `scroll-padding-top` en `html`: 5,5 rem en escritorio y 8 rem en móvil.
- **Contraste del encabezado translúcido:** la referencia usa un fondo semitransparente con desenfoque, que puede bajar el contraste según el contenido detrás. La Web usa el fondo opaco de `--ct-card`.

Además, el enlace de salto es el primer elemento que recibe el foco y apunta a `<main id="contenido" tabindex="-1">`, de modo que el foco se mueve al contenido. Los controles conservan foco visible, nombres accesibles y estados que no dependen solo del color.

## Validación

Desde la raíz del repositorio:

```powershell
bun run --cwd apps/web lint
bun run test:web
bun run --cwd apps/web build
bun run lint
bun run format:check
```

Para los textos cambiados (limita la revisión a los archivos tocados; otros archivos del repositorio ya traen palabras que el diccionario español no incluye):

```powershell
bunx --package cspell --package @cspell/dict-es-es cspell lint --no-progress <archivos cambiados>
```

El recorrido con teclado se hizo en los cuatro roles: enlace de salto, navegación con `aria-current`, menú de accesibilidad y botón de cierre de sesión.
