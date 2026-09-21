# Casos de uso — solicitudes (TI2-9)

Evidencia de cierre de TI2-9: endpoints públicos de solicitudes para Estudiante y Profesional. Solo servidor, sin UI y sin saltarse Aplicación ni Dominio. Todo opera con DATOS FICTICIOS.

## Operaciones

| Endpoint                                             | Quién               | Qué hace                                                                                                            |
| ---------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `presentation/requests.createRequest`                | Estudiante vigente  | Registra en `received` y devuelve la entidad pública canónica (TI2-8)                                               |
| `presentation/requests.listOwnRequests`              | Estudiante vigente  | Lista solo sus solicitudes, paginado                                                                                |
| `presentation/requests.requestAdditionalInformation` | Profesional vigente | Mueve `under_review` a `awaiting_information_or_acceptance` con motivo obligatorio, aplicando la política de TI2-21 |

Toda denegación responde el error genérico, sin motivo ni existencia del recurso. El `studentId` siempre sale del perfil del servidor, nunca del cliente.

## Alcance explícito

- El listado del Profesional solo muestra solicitudes vinculadas a acompañamientos con asignación profesional activa; sin asignación no hay acceso.
- Solo persiste el estado resultante de la transición; el registro histórico del cambio (actor, fecha, motivo) es alcance de TI2-21/TI2-24.
- Se guarda el texto de necesidades de acceso; convertir el contenido estructurado a la forma persistida es alcance de TI2-23.

## Validación

`bun install --frozen-lockfile`, `bun run test:convex`, `tsc` de funciones y de pruebas, `bun run lint` y formato `oxfmt`, todo en verde.
