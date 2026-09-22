# Casos de uso — solicitudes (TI2-9)

Evidencia de cierre de TI2-9: endpoints públicos de solicitudes para Estudiante y Profesional. Solo servidor, sin UI y sin saltarse Aplicación ni Dominio. Todo opera con DATOS FICTICIOS.

## Operaciones

| Endpoint                                             | Quién               | Qué hace                                                                                                            |
| ---------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `presentation/requests.createRequest`                | Estudiante vigente  | Registra en `received` y devuelve la entidad pública canónica (TI2-8)                                               |
| `presentation/requests.listOwnRequests`              | Estudiante vigente  | Lista solo sus solicitudes, paginado                                                                                |
| `presentation/requests.listAuthorizedRequests`       | Profesional vigente | Lista solicitudes tomadas por él, paginado                                                                          |
| `presentation/requests.listOpenRequests`             | Profesional vigente | Bandeja de triage minimizada (sin `accessNeeds`), paginado                                                          |
| `presentation/requests.takeRequest`                  | Profesional vigente | Toma una solicitud para sí e inicia su revisión; la retoma se rechaza                                               |
| `presentation/requests.requestAdditionalInformation` | Profesional vigente | Mueve `under_review` a `awaiting_information_or_acceptance` con motivo obligatorio, aplicando la política de TI2-21 |

Toda denegación responde el error genérico, sin motivo ni existencia del recurso. El `studentId` siempre sale del perfil del servidor, nunca del cliente.

## Alcance explícito

- El Profesional solo opera solicitudes con toma activa a su nombre; la toma es manual y queda auditada (quién y cuándo). Sin toma no hay acceso.
- Persiste el estado resultante y el registro del cambio (motivo, actor y fecha) en la misma transacción, en la bitácora `requestTransitions`.
- Se guarda el texto de necesidades de acceso; convertir el contenido estructurado a la forma persistida es alcance de TI2-23.

## Validación

`bun install --frozen-lockfile`, `bun run test:convex`, `tsc` de funciones y de pruebas, `bun run lint` y formato `oxfmt`, todo en verde.
