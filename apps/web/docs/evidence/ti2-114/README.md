# TI2-114: lista web de atenciones propias y estados de inasistencia

Issue: [TI2-114](https://linear.app/ceretime/issue/TI2-114). PR [ #152 ](https://github.com/FernandoValdes01/ceretime/pull/152) sobre `main` `53c41eb2...` (incluye la integración de TI2-113 vía #145 y de TI2-122). Este registro documenta qué entregó la issue y cómo validarla.

## Entrega

- Lista y detalle de atenciones propias del Estudiante en `/estudiante/atenciones` y `/estudiante/atenciones/$appointmentId` (`apps/web/src/presentation/estudiante/student-appointments-page.tsx` con su módulo de datos `student-appointments-page-data.ts`), reutilizando `listAppointments`/`getAppointment` del puerto común de agenda (`agenda-port.ts`) contra el adaptador ficticio del flujo estudiantil; sin otra store, lista ni archivo por estado.
- Estados textuales por etiquetas compartidas (`agenda-labels.ts`): Realizada, Reagendada, Cancelada por el Estudiante, Cancelada por CERETI, Inasistencia pendiente, justificada y no justificada; estados de carga, vacío, fallo técnico con reintento y denegación en lista y detalle; foco en el `h1` al entrar y anuncios con `role="status"`/`role="alert"`.
- La proyección visible aplica la vista `shared` de TI2-112 (el Estudiante no recibe el motivo de cancelación) y las pantallas declaran la demostración: «Demostración con datos ficticios».
- Rutas y nav: `atenciones` y `atenciones/$appointmentId` como hijos de `studentLayoutRoute`, componentes puente en `route-components.tsx` y enlace «Atenciones» en el portal (`student-portal.tsx`).
- Fixtures del adaptador ficticio (`fictitious-agenda-adapter.ts`) ampliados con los tres desenlaces de inasistencia y la cancelación por el Estudiante, con pruebas del escenario en `fictitious-agenda-adapter.test.ts`.
- Contrato documentado para TI2-123 en `docs/contratos-sprint-1.md` (sección «Agenda propia del Estudiante en Web (TI2-114)»): conectará `api.presentation.appointments.listAppointments` y `getAppointment` reutilizando esta lista y su detalle sin segunda lista real.

## Límites respetados

- El plazo de cinco días hábiles lo calcula el Backend (TI2-94); no se calcula ni inventa en React, y la inasistencia se muestra solo por estado.
- Presentación y revisión de justificaciones: TI2-119, fuera de alcance; no se copia la agenda del Profesional (TI2-115) ni se agregan cambios de estado a esta vista.
- Sin código en `convex/` ni `apps/mobile/`; sin persistencia local ni segundo backend.

## Validación ejecutada

| Comando                                                                                   | Resultado                                                  |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `bunx vitest run apps/web/src/presentation/estudiante/student-appointments-page.test.tsx` | 16 pruebas del nuevo módulo, en verde                      |
| `bun run test:web`                                                                        | 23 archivos / 380 pruebas, en verde                        |
| `bun run --cwd apps/web lint`                                                             | en verde                                                   |
| `bun run --cwd apps/web build` (`tsc -b` + Vite)                                          | en verde                                                   |
| `bun run lint` / `bun run format:check`                                                   | en verde (agregar resultado final antes de pedir revisión) |
| `bunx cspell` con `@cspell/dict-es-es`                                                    | pendiente de anotar                                        |

## Pendiente al cierre

- Recorrido por teclado + capturas de escritorio y móvil de carga, vacío, fallo, denegación y los estados de atención, anotadas aquí antes de pedir la revisión de TI4.
- Resultado final de `bun run lint`, `bun run format:check` y `cspell` de los textos definitivos, más los SHA de los commits de cierre.
