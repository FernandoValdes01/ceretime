# Arquitectura por capas

Este patrón describe la dirección buscada en el código de CERETIME. Los diagramas en `docs/diagramas/` presentan el diseño objetivo; la estructura de carpetas por sí sola no garantiza que una dependencia lo respete.

## Responsabilidad de cada capa

| Capa            | Decide o hace                                                                                                                                                                                           | Evita                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Presentación    | Recibe una petición o interacción, valida su forma, muestra los estados y adapta respuestas al medio. En Backend obtiene la identidad del contexto y puede componer los adaptadores de Infraestructura. | Decidir permisos o transiciones de negocio; acceder a la base desde una pantalla.                |
| Aplicación      | Coordina un caso de uso: pide datos mediante puertos, autoriza, aplica reglas de Dominio y ordena los efectos. Declara los puertos que necesita.                                                        | Importar repositorios concretos, construir clientes externos o depender de componentes visuales. |
| Dominio         | Define conceptos, invariantes, políticas y transiciones del negocio con tipos y funciones que no necesitan I/O.                                                                                         | Conocer Convex, React, Expo, almacenamiento o formatos de pantalla.                              |
| Infraestructura | Implementa los puertos: consulta y escribe datos, traduce formatos y habla con proveedores.                                                                                                             | Decidir por su cuenta políticas de negocio que corresponden a Dominio o Aplicación.              |

La composición conecta las implementaciones con los puertos en el borde. Infraestructura puede depender de las interfaces internas; el caso de uso no importa la implementación. En Convex, conserva el contexto transaccional al crear los adaptadores y ejecutar la operación: separar capas no significa hacer una petición de red por cada paso.

## Recorrido concreto: reservar una atención

1. El cliente solicita una reserva a la función pública; no demuestra permiso solo por mostrar un cupo.
2. Presentación valida argumentos, obtiene la identidad y conecta el caso de uso con adaptadores. Consulta [appointments.ts](../convex/presentation/appointments.ts).
3. Aplicación comprueba autorización, revalida el cupo y coordina la ocupación con puertos. Consulta [booking.ts](../convex/application/appointments/booking.ts) y [ports.ts](../convex/application/availability/ports.ts).
4. Dominio define la compatibilidad y las reglas del cupo. Infraestructura implementa las lecturas y la escritura dentro de la transacción. Consulta [compatibilidad](../convex/domain/spaces/compatibility.ts) y [repositorio de atenciones](../convex/infrastructure/appointments/repository.ts).

Las pruebas del flujo y de sus denegaciones son parte de la verificación. Que exista este recorrido no demuestra que todos los casos de uso sigan ya el mismo diseño.

## Una dependencia que conviene evitar

Un caso de uso que importa un repositorio concreto o recibe el `ctx` de Convex queda ligado a esa infraestructura: no se puede probar con dobles y un cambio de persistencia obliga a editarlo. Desde TI4-84, ningún archivo de `convex/application/` importa de `convex/infrastructure/`. Cada módulo declara sus puertos en su `ports.ts`, como [los de acompañamientos](../convex/application/accompaniments/ports.ts) o [los de solicitudes](../convex/application/requests/ports.ts), y Presentación crea los adaptadores con el `ctx` de la función, así la operación sigue siendo una sola transacción. Compruébalo con `git grep "infrastructure/" -- convex/application`. No añadas un adaptador de paso sin ocultar una dependencia real ni cambies una transacción por llamadas independientes.

## Cómo revisar un cambio

Sigue una acción desde la pantalla o función pública hasta sus efectos. Para cada decisión pregunta qué capa conoce la regla, quién construye sus dependencias y si un cambio de proveedor obliga a editar el caso de uso. Busca otra implementación del mismo concepto antes de crear una nueva. Verifica los contratos de Web y Mobile y los datos existentes; una carpeta con el nombre correcto o un test con dobles no demuestra que el recorrido integrado funcione.
