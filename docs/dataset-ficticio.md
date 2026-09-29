# Dataset ficticio del Sprint 1 (TI2-30)

Datos mínimos para mostrar el entorno TI2 con cada rol y cada estado de solicitud del Sprint 1. Todo es inventado: ningún nombre, correo ni necesidad de acceso corresponde a una persona real, como exige la Ley 21.719 para el prototipo.

## Cómo se carga

- La carga es `internal.fictitiousData.load`, en `convex/fictitiousData.ts`. Solo opera con `TEST_SEEDS_ENABLED=true` en el deployment, igual que `createTestUser`; en producción la variable permanece ausente y la carga se rechaza.
- Es repetible: si el dataset ya existe, no escribe nada.
- En cada Preview la ejecuta Convex con `--preview-run fictitiousData:load`, que se ignora en producción.
- En un deployment de desarrollo propio se carga con `bunx convex env set TEST_SEEDS_ENABLED true` y luego `bunx convex run fictitiousData:load`.
- Los perfiles se crean con `createTestUser` y las solicitudes pasan por los casos de uso reales (registrar, tomar, pedir información, aceptar y asignar), así que el dataset cumple las mismas reglas que el flujo del cliente.

## Cuentas

Todas quedan habilitadas y vigentes. Su `tokenIdentifier` usa el emisor inventado `dataset-ficticio`, que ningún inicio de sesión real produce: nadie puede entrar como una de estas cuentas. El dataset no crea Administradores, porque el primero sale solo de `internal.accounts.ensureBootstrapAdmin`.

| Cuenta                     | Rol         | Correo                            |
| -------------------------- | ----------- | --------------------------------- |
| Estudiante Ficticio Uno    | Estudiante  | `estudiante.ficticio1@alu.uct.cl` |
| Estudiante Ficticio Dos    | Estudiante  | `estudiante.ficticio2@alu.uct.cl` |
| Estudiante Ficticio Tres   | Estudiante  | `estudiante.ficticio3@alu.uct.cl` |
| Estudiante Ficticio Cuatro | Estudiante  | `estudiante.ficticio4@alu.uct.cl` |
| Profesional Ficticio       | Profesional | `profesional.ficticio@uct.cl`     |
| Practicante Ficticio       | Practicante | `practicante.ficticio@alu.uct.cl` |

## Solicitudes

Una por cada estado del Sprint 1. Las que avanzan las toma el Profesional Ficticio.

| Estudiante | Estado                             | Necesidad de acceso                                                      |
| ---------- | ---------------------------------- | ------------------------------------------------------------------------ |
| Uno        | Recibida                           | Material de clases en formato digital compatible con lector de pantalla. |
| Dos        | En revisión                        | Tiempo adicional en evaluaciones escritas.                               |
| Tres       | Esperando información o aceptación | Apoyo para organizar la entrega de trabajos del semestre.                |
| Cuatro     | Aceptada                           | Sala con acceso sin escaleras para las clases prácticas.                 |

El historial de cambios de estado queda con 5 registros: tres tomas, el pedido de información (con el motivo "Falta indicar en qué asignaturas se necesita el apoyo.") y la aceptación.

## Acompañamiento

Uno solo, abierto por la aceptación de la solicitud del Estudiante Cuatro, con el objetivo "Coordinar los apoyos de acceso para las clases prácticas del semestre." Tiene dos asignaciones vigentes: el Profesional Ficticio, que la recibe al aceptar, y el Practicante Ficticio, asignado por ese Profesional.

## Comprobación

`convex/fictitiousData.test.ts` comprueba el rechazo sin `TEST_SEEDS_ENABLED`, los roles, los estados, el historial y el acompañamiento de este inventario, y que una segunda carga no escriba nada. Corre con `bun run test:convex`.
