# Evidencia de cierre del Sprint 3 (TI2-179)

Registro de [TI2-179](https://linear.app/ceretime/issue/TI2-179): demostrar el proceso completo, desde la solicitud hasta el cierre y la consulta del historial, en una misma versión y con datos ficticios. Cada criterio indica tarea, entrega, versión, pasos y resultado. Lo pendiente, fallido o bloqueado figura como parte faltante: una simulación o una credencial pendiente no cuenta como terminada.

Este documento está en curso. Fecha de corte: 27/11/2026.

## Versión y entorno

<!-- cspell:ignore lulloa -->

- **Base:** `main` en `4acf1da5` (TI2-155, #212), integrado en la rama `lulloa/ti2-179-desplegar-la-web-con-datos-ficticios-y` con `572fa661`.
- **Pruebas automáticas:** `convex-test` con identidades simuladas; no usan un deployment.
- **Recorrido en la interfaz:** deployment de desarrollo propio de Convex con `TEST_SEEDS_ENABLED=true` y la Web local. La carga de `operations/fictitiousData:load` se rechaza en producción, por diseño.
- **Cuentas que pueden iniciar sesión:** solo `@alu.uct.cl` y `@uct.cl` (`hd` en `convex/infrastructure/auth/google_providers.ts`). Las cuentas del dataset usan el emisor inventado `dataset-ficticio` y no pueden iniciar sesión.
- **Producción:** fuera de este documento por ahora. Se registra aparte cómo se demuestra en el despliegue de la universidad.

## Criterios

| Criterio | Tarea | Entrega | Versión | Resultado |
| --- | --- | --- | --- | --- |
| Proceso completo con los cuatro roles en una misma secuencia | TI2-179 | S4 | `1cfbe37b` y `572fa661` | Cumplido en pruebas automáticas y en el recorrido, con el Estudiante en la interfaz y los demás roles por la API pública |
| Permisos entre usuarios | TI2-179 sobre TI2-86, TI2-127 y TI2-140 | S4 | `1cfbe37b` | Cumplido en pruebas automáticas |
| Revocación del practicante | TI2-179 sobre TI2-127 y TI2-140 | S4 | `1cfbe37b` y `572fa661` | Cumplido en pruebas automáticas y en el recorrido |
| Reservas simultáneas | TI2-179 sobre TI2-84, TI2-96 y TI2-120 | S4 | `1cfbe37b` | Cumplido en pruebas automáticas |
| Estados y cierre sin reapertura | TI2-179 sobre TI2-152 | S4 | `1cfbe37b` y `572fa661` | Cumplido en pruebas automáticas y en el recorrido |
| Plazos de justificación | TI2-119 y TI2-147 | S4 | `572fa661` | Cumplido en pruebas existentes |
| Reintentos y recuperación de avisos y Calendar | TI2-159, TI2-160 y TI2-162 | S4 | `572fa661` | Cumplido en pruebas existentes con dobles. Envío real pendiente |
| Contratos completos para Web y Mobile | TI2-179 | S4 | `1a96cdff` | Cumplido con un hallazgo abierto |
| Correo real | TI2-179 sobre TI2-159 | S4 | — | Pendiente: el deployment propio no tiene las credenciales del remitente |
| Push real | TI2-179 sobre TI2-160 | S4 | — | Pendiente: falta configurar VAPID y no hay pantalla para activarlo |
| Google Calendar y `.ics` reales | TI2-179 sobre TI2-122, TI2-161 y TI2-162 | S4 | `572fa661` | Cumplido en el recorrido: vínculo, evento creado al reservar y `.ics` descargado |
| Validación funcional por CERETI | CERETI | — | — | Pendiente. Fecha y responsable sin registrar |
| Validación del lenguaje por CERETI | CERETI | — | — | Pendiente. Fecha y responsable sin registrar |

## Proceso completo en pruebas automáticas

**Pasos.** `convex/tests/acceptance.test.ts`, prueba «TI2-179: el proceso completo funciona junto con los cuatro roles». Recorre la API pública en una sola secuencia, con el reloj fijado en el lunes 2027-01-04 de la agenda:

1. El Administrador se crea con `ensureBootstrapAdmin`. El Profesional y el Practicante se crean pendientes con `createTestUser`.
2. El Profesional pendiente no puede habilitar al Practicante. El Administrador habilita al Profesional (`enabledBy` del Administrador) y el Profesional habilita al Practicante (`enabledBy` del Profesional).
3. El Estudiante entra por `ensureMyProfile` y crea la solicitud. El Practicante no puede tomarla; el Profesional la toma y la acepta, y se abre el acompañamiento.
4. Antes de la asignación el Practicante queda denegado; después ve la vista `minimized`.
5. El Administrador registra una sala que cubre la necesidad de acceso y el Profesional publica su bloque en ella. La búsqueda ofrece el cupo y dos reservas simultáneas del Estudiante dejan una sola atención.
6. El Practicante no puede registrar la atención; el Profesional la registra como realizada y guarda el seguimiento con una nota interna.
7. El Profesional lee la vista `professional` con la nota, el Estudiante la vista `shared` y el Practicante la vista `minimized`, ambas sin la nota. El Administrador no accede al acompañamiento.
8. Al revocar al Practicante, pierde el acceso al seguimiento y al acompañamiento desde la llamada siguiente.
9. Al cerrar, el acompañamiento no se reactiva (`conflict`) ni admite reservas. El Estudiante sigue viendo el estado cerrado y su historial, sin la nota interna.

**Resultado.** Sobre `572fa661`, `bun run test:convex`: 99 archivos y 1730 pruebas OK. `tsc` de `convex/tsconfig.json` y `convex/tsconfig.tests.json`: 0 errores. `bun run lint` y `bun run format:check`: OK.

## Recorrido en la interfaz

**Entorno.** Deployment de desarrollo propio con las funciones de `572fa661` (`bunx convex dev --once`) y la Web local (`bun run --cwd apps/web dev`). El Estudiante es una cuenta institucional real que solo carga datos ficticios. El Profesional, el Practicante y el Administrador son las cuentas del dataset (`dataset-ficticio|profesional-1`, `practicante-1` y `administrador-1`): no pueden iniciar sesión, así que sus pasos se ejecutan con `bunx convex run <función pública> --identity`, contra la misma API pública que usa la Web.

**Atención probada.** La del viernes 27/11/2026 de 21:45 a 22:45 en la Sala F-179 (acompañamiento con código `CER-TG1N-80JK`). Otros eventos que aparezcan en las capturas del calendario no forman parte del recorrido.

| Paso | Rol y vía | Resultado |
| --- | --- | --- |
| 1 | Operador, `ensureBootstrapAdmin` | Administrador creado una sola vez en el deployment |
| 2 | Estudiante, interfaz | Google Calendar conectado con el permiso `calendar.events`; la sección «Atenciones» confirma la conexión |
| 3 | Estudiante, interfaz | Solicitud enviada con «Sala físicamente accesible», modalidad presencial; queda «Recibida» |
| 4 | Profesional, `takeRequest` y `acceptRequest` | Solicitud en revisión y luego aceptada; se abre el acompañamiento |
| 5 | Administrador, `createSpace` | Sala F-179 con la condición «Sala físicamente accesible» |
| 6 | Profesional, `assignAccompanimentAccess` | Practicante asignado. Su lectura con `getAccompaniment` es `minimized`: solo objetivo y estado, sin necesidades ni datos del Estudiante |
| 7 | Profesional, `publishBlock` | Bloque del viernes de 21:45 a 22:45, presencial en la Sala F-179 |
| 8 | Estudiante, interfaz | Reserva del cupo. La atención queda «Programada · Presencial · Agregada a Google Calendar» sin acción manual (`calendarSyncStatus: synced`) |
| 9 | Estudiante, Google Calendar | El evento aparece a las 21:45 con el título genérico «Atención programada» y sin ubicación |
| 10 | Estudiante, interfaz | `.ics` descargado y abierto correctamente |
| 11 | Profesional, `recordAppointmentAttendance` y `saveFollowUpRecord` a las 21:26 | Rechazados con `conflict` sin escribir: la atención todavía no empezaba y no admite seguimiento |
| 12 | Profesional, los mismos comandos a las 21:46 | Atención «Realizada» y seguimiento guardado con un acuerdo, una tarea del Estudiante, próximos pasos y una nota interna |
| 13 | Profesional y Practicante, `getFollowUpRecord` | El Profesional recibe la vista `professional` con la nota interna; el Practicante, la vista `minimized` con acuerdos, tareas y próximos pasos, sin la nota |
| 14 | Estudiante, interfaz | El historial muestra «Atención del viernes, 27 de noviembre de 2026 · Realizada» con acuerdos, tareas y próximos pasos. La nota interna no está en la página ni en el HTML |
| 15 | Profesional, `revokeAccompanimentAccess` | Practicante revocado. Desde la llamada siguiente, `getAccompaniment` y `getFollowUpRecord` lo deniegan |
| 16 | Profesional, `closeAccompaniment` y `reactivateAccompaniment` | Acompañamiento cerrado; reactivarlo responde `conflict` |
| 17 | Estudiante, interfaz | Estado «Cerrado» con aviso de solo lectura, atenciones sin acciones de calendario, historial visible y sin el formulario de necesidades |

**Capturas.** Calendar conectado, solicitud enviada, atención agregada a Google Calendar, evento en Google Calendar, seguimiento del Estudiante sin la nota interna y acompañamiento cerrado. Están en el cuerpo de la PR de TI2-179.

## Cobertura existente por tema

| Tema | Dónde |
| --- | --- |
| Permisos y vistas por rol | `authorization.test.ts`, `authorizationIntern.test.ts`, `role_permissions.test.ts`, `practitionerMinimization.test.ts` |
| Revocación | `internAccess.test.ts`, `internManagement.test.ts`, `appointmentChangesApi.test.ts`, «TI2-120 API: revocar la asignación…» en `acceptance.test.ts` |
| Reservas simultáneas | Pruebas TI2-84, TI2-96 y TI2-120 de `acceptance.test.ts` |
| Estados del acompañamiento | `accompanimentStatusApi.test.ts` |
| Plazos de justificación | `appointmentChangesApi.test.ts`, `justificationExpiration.test.ts` |
| Reintentos de avisos | `emailNotificationDelivery.test.ts`, `pushNotificationDelivery.test.ts` |
| Calendar | `calendarApi.test.ts`, `calendarLinkApi.test.ts`, `calendarSyncApi.test.ts` |
| Dataset ficticio | `fictitiousData.test.ts` |

## Revisión de contratos

**Pasos.** Se cruzaron las 86 funciones públicas de `convex/presentation/` con `docs/contratos-sprint-1.md`, `docs/contratos-sprint-3/`, `docs/integraciones/` y `docs/operaciones/`, y se compararon los argumentos de cada validador con las tablas.

**Resultado.**

- Ningún argumento falta. Los que no figuran en la fila de su tabla se explican en el mismo documento: la forma completa de las solicitudes, los campos de `publishBlock` y de creación de salas, y `additionalProfessionalIds` en `agenda.md`.
- Corregido en `7ca00f01`: la suscripción push propia (`getOwnPushStatus`, `activatePushSubscription` y `deactivatePushSubscription`) no estaba en ningún contrato; ahora está en `avisos.md`.
- Corregido en `1a96cdff`: `contratos-sprint-1.md` decía que el vencimiento de las justificaciones no usa cron; desde TI2-147 un barrido cada hora cierra las inasistencias sin entrega con el plazo vencido.
- Sin cambios: el `.ics` y Calendar por atención están en `integraciones/google-calendar.md`, con indicaciones para Mobile.

## Partes faltantes

- **Recorrido en la interfaz con los cuatro roles.** Hay una sola cuenta institucional; el Estudiante recorre la interfaz y los demás roles operan por la API pública con `--identity`. Ver las pantallas del Profesional, el Practicante y el Administrador requiere cuentas que puedan iniciar sesión.
- **Correo real.** El deployment propio no tiene `GMAIL_SENDER_ADDRESS` ni `GMAIL_SENDER_REFRESH_TOKEN`.
- **Push real.** Falta cargar `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT`. Además, la Web tiene el service worker y el adaptador del navegador, pero ninguna pantalla permite activar push.
- **Formato de error de acompañamientos.** Las consultas de `presentation/accompaniments` rechazan con el mensaje «No autorizado» sin el objeto `{ code, message }` que solicitudes adoptó en TI2-181. El recorrido lo confirma: al Practicante revocado, `getAccompaniment` responde `No autorizado` y `getFollowUpRecord`, `{"code":"unauthorized","message":"No autorizado"}`. No impide el uso, pero un cliente nuevo debe tratar las dos formas.
- **Validaciones de CERETI.** Sin fecha ni responsable.
- **Dependencias.** TI2-178 (WCAG) y TI2-174 (conservación) bloquean esta tarea y no están integradas; «todo funciona junto en la misma versión» se vuelve a comprobar cuando lo estén.
