# Matriz de casos de prueba — Practicante, contratos y CI

Evidencia de TI2-29: qué prueba automatizada cubre cada punto del checklist de Practicante, contratos públicos y ruta crítica del Sprint 1, y cómo se verifica en CI.

## Cómo leerla

Cada prueba se nombra por archivo y título, tal como lo imprime `vitest`, para poder buscarla sin depender de números de línea. El archivo integrado de esta issue es `convex/practitionerContracts.test.ts`; las filas citan la cobertura previa que lo sostiene y la prueba nueva que cierra la evidencia integrada. Todo se corre con `bun run test:convex` y la CI lo ejecuta en el job "Verificación Backend"; cualquier archivo `*.test.ts` nuevo en `convex/` entra solo, sin tocar los workflows.

## Practicante en la ruta crítica

| Qué se prueba                                                             | Tipo     | Prueba integrada (TI2-29)                                                                              | Cobertura previa que lo sostiene                                                                                                                                                                          |
| ------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Practicante con acompañamiento asignado lee minimizado con claves exactas | Positivo | `practitionerContracts` › "practicante asignado lee minimizado con claves exactas en la ruta crítica"  | `practitionerMinimization` › "lista solo lo asignado con vista minimizada y claves exactas"; `authorizationIntern` › "practicante habilitado con asignación explícita lee minimizado sin datos sensibles" |
| Acceso a acompañamiento no asignado se rechaza sin filtrar                | Negativo | `practitionerContracts` › "acompañamiento no asignado se rechaza sin filtrar información"              | `practitionerMinimization` › "acceso directo por ID no asignado se rechaza sin filtrar"; `authorizationIntern` › "practicante solo lista lo asignado y no descubre el resto"                              |
| Acceso directo por ID no autorizado e inexistente responden idéntico      | Negativo | `practitionerContracts` › "acceso directo por ID inexistente responde idéntico sin revelar existencia" | `authorizationIntern` › "inexistente responde igual que denegado para practicante"; `authorization` › "negativos genéricos: sin identidad, estudiante en notas e inexistente"                             |
| Intento de modificación y autoasignación se rechazan                      | Negativo | `practitionerContracts` › "modificación y autoasignación del practicante se rechazan"                  | `practitionerMinimization` › "intentos de modificación del practicante se rechazan"; `internAccess` › "autoasignación queda rechazada con el mismo error genérico"                                        |
| Revocación inmediata cierra lectura y listado                             | Negativo | `practitionerContracts` › "revocación inmediata cierra lectura y listado sin filtrar"                  | `authorizationIntern` › "asignación revocada deja de autorizar al practicante"; `internAccess` › "profesional autorizado retira el acceso y la revocación queda auditada"                                 |

Cada caso negativo compara el mensaje exacto `No autorizado` con `toMatch(/^No autorizado$/)` y afirma que el mensaje no contiene el ID, el objetivo ni la necesidad de acceso; la lectura asignada de control sí responde para demostrar que el escenario estaba bien armado.

## Contratos públicos y apertura única

| Qué se prueba                                             | Tipo     | Prueba integrada (TI2-29)                                                                       | Cobertura previa que lo sostiene                                                                                                                                  |
| --------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contratos públicos conservan forma estable sin filtración | Positivo | `practitionerContracts` › "contratos públicos conservan forma estable y errores sin filtración" | `apiBackend` › "Registro válido guarda la necesidad recortada en estado recibido"; `sprint1Queries` › "perfil propio devuelve solo lo necesario para la interfaz" |
| Aceptación repetida no crea duplicados                    | Negativo | `practitionerContracts` › "apertura única no duplica ante aceptación repetida"                  | `acceptance` › "Repetir la aceptación no crea duplicados"; `acceptance` › "Dos profesionales en contienda abren un solo acompañamiento"                           |

La forma estable verificada es la vista completa de `acceptRequest` (`_id`, `studentId`, `status`, `objective`, `accessNeeds`, `view: "full"`) y la vista minimizada del Practicante (`_id`, `status`, `objective`, `view: "minimized"`), según `docs/contratos-sprint-1.md`. La apertura única queda garantizada por construcción (`acceptRequest` comprueba con `findAccompanimentByRequest` y crea en la misma transacción) y probada por duplicado; la demostración con despacho simultáneo contra el deployment de desarrollo se ejecutó el 2026-09-30 (ver "Demostración en vivo" abajo) y confirmó un solo acompañamiento.

## CI verde

| Qué se ejecuta          | Dónde                     | Comando                                                                   |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------- |
| Tipos del backend       | CI "Verificación Backend" | `bun run --cwd apps/web tsc -p ../../convex/tsconfig.json --noEmit`       |
| Tipos de las pruebas    | CI "Verificación Backend" | `bun run --cwd apps/web tsc -p ../../convex/tsconfig.tests.json --noEmit` |
| Unitarias e integración | CI "Verificación Backend" | `bun run test:convex`                                                     |
| Lint y formato          | CI "Lint y formato"       | `bun run lint` y `bun run format:check`                                   |
| Web                     | CI "Validación Web"       | `bun run test:web` y `bun run --cwd apps/web build`                       |
| Mobile                  | CI "Validación Mobile"    | `bun run --cwd apps/mobile typecheck` y `bun run --cwd apps/mobile test`  |

## Qué no cubre esta matriz

El flujo OAuth real contra Google y el despacho simultáneo contra un backend en vivo no se automatizan en CI: el primero lo registró TI2-15 como evidencia manual en `convex/README.md` y el segundo queda registrado abajo como evidencia manual de TI2-29, ejecutada sobre el entorno de TI2-30.

## Demostración en vivo (2026-09-30, deployment de desarrollo)

Con `TEST_SEEDS_ENABLED=true` en el deployment de desarrollo (procedimiento documentado de TI2-30, reversible) se sembraron registros ficticios rotulados `ti29-demo-*` (un Estudiante, dos Profesionales y una solicitud en `received`) y se dispararon pares de llamadas simultáneas con `bunx convex run --identity` (identidades `ti29-demo-vivo|*`, sin sesión OAuth; la autenticación real ya la evidencia TI2-15). Tomas simultáneas sobre la solicitud recibida: la primera crea la toma (`under_review`) y la segunda se rechaza con "Solo se pueden tomar solicitudes recibidas" sin escribir nada, por lo que dos tomas coexistentes no se pueden armar por vía pública (la guarda de estado más el conflicto de escritura sobre la misma solicitud lo impiden; `acceptance` lo cubre con una fila legacy sembrada a mano). Aceptaciones simultáneas: el Profesional con toma abre el acompañamiento (vista `full`) y el concurrente sin toma recibe el genérico `No autorizado` sin filtrar; la repetición se rechaza con "La solicitud ya fue aceptada". Estado final verificado por tres vías: la solicitud queda en `accepted`, `accompaniments.by_request` devuelve exactamente un acompañamiento activo y `listOwnedAccompaniments` del Estudiante trae exactamente un elemento en vista completa.
