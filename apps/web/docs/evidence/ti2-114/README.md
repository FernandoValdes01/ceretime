# TI2-114: lista web de atenciones propias y estados de inasistencia

Issue: [TI2-114](https://linear.app/ceretime/issue/TI2-114). PR [#152](https://github.com/FernandoValdes01/ceretime/pull/152) actualizada con `main` `13c6ee6` (incluye TI2-113 vía #145, TI2-122 y TI2-123 vía #155). Este registro documenta qué entregó la issue y cómo validarla.

## Entrega

- Lista y detalle de atenciones propias del Estudiante en `/estudiante/atenciones` y `/estudiante/atenciones/$appointmentId` (`apps/web/src/presentation/estudiante/student-appointments-page.tsx` con su módulo de datos `student-appointments-page-data.ts`), reutilizando `listAppointments`/`getAppointment` del puerto común de agenda (`agenda-port.ts`), que desde TI2-123 lee la API por `convex-agenda-adapter.ts`; sin otra store, lista ni archivo por estado.
- Estados textuales por etiquetas compartidas (`agenda-labels.ts`): Realizada, Reagendada, Cancelada por el Estudiante, Cancelada por CERETI, Inasistencia pendiente, justificada y no justificada; estados de carga, vacío, fallo técnico con reintento y denegación en lista y detalle; aviso con reintento cuando no se resuelve la sala; foco en el `h1` al entrar y al reintentar, y anuncios con `role="status"`/`role="alert"`.
- La proyección visible aplica la vista `shared` de TI2-112 (el Estudiante no recibe el motivo de cancelación). La lista declara su período (los últimos 45 días y los próximos 46, la ventana que lee el adaptador) y el vacío se acota a ese período.
- Rutas y nav: `atenciones` y `atenciones/$appointmentId` como hijos de `studentLayoutRoute`, componentes puente en `route-components.tsx` y enlace «Atenciones» en el portal (`student-portal.tsx`), cuya portada también enlaza la lista.
- Fixtures del adaptador ficticio (`fictitious-agenda-adapter.ts`) ampliados con los tres desenlaces de inasistencia y la cancelación por el Estudiante, con pruebas del escenario en `fictitious-agenda-adapter.test.ts`; quedan solo para pruebas.
- Contrato documentado en `docs/contratos-sprint-1.md` (sección «Agenda propia del Estudiante en Web (TI2-114)»): parámetros de `listAppointments` y `getAppointment`, ventana de lectura, límites de páginas y estados de lectura.

## Límites respetados

- El plazo de cinco días hábiles lo calcula el Backend (TI2-94); no se calcula ni inventa en React, y la inasistencia se muestra solo por estado.
- Presentación y revisión de justificaciones: TI2-119, fuera de alcance; no se copia la agenda del Profesional (TI2-115) ni se agregan cambios de estado a esta vista.
- Sin código en `convex/` ni `apps/mobile/`; sin persistencia local ni segundo backend.

## Validación ejecutada

Sobre la rama actualizada con `main` `13c6ee6`, en Windows:

| Comando                                                 | Resultado                                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run test:web`                                      | 24 archivos / 419 pruebas, en verde                                                                                                                                 |
| `bun run --cwd apps/web lint`                           | en verde                                                                                                                                                            |
| `bun run --cwd apps/web build` (`tsc -b` + Vite)        | en verde                                                                                                                                                            |
| `bun run lint` / `bun run format:check`                 | en verde                                                                                                                                                            |
| `cspell` con `@cspell/dict-es-es` (ejecutado con `npx`) | sin hallazgos en los textos de esta entrega; quedan una palabra en `student-portal.tsx` y 8 en `docs/contratos-sprint-1.md`, en líneas que esta entrega no modifica |

Las pruebas de la página simulan `getAgendaPort`; no verifican la llamada real a la API.

## Pendiente al cierre

- Comprobar contra la API en el entorno ficticio de TI2-30: lista y detalle de un Estudiante con atenciones, denegación de una atención ajena, cancelación sin motivo visible y sala de una atención presencial.
- Recorrido por teclado y capturas de escritorio y móvil de carga, vacío, fallo, denegación, aviso de sala y los estados de atención, antes de pedir la revisión de TI4.
- SHA de los commits de cierre.
