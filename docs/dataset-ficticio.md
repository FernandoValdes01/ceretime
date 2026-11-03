# Dataset ficticio de Agenda y Solicitudes (TI2-30 / TI2-108)

Datos mínimos para mostrar el entorno TI2 con cada rol, cada estado de solicitud del Sprint 1 y la agenda de atenciones. Todo es inventado: ningún nombre, correo ni necesidad de acceso corresponde a una persona real, como exige la Ley 21.719 para el prototipo.

## Cómo se carga

- La carga es `internal.operations.fictitiousData.load`, en `convex/operations/fictitiousData.ts`. Solo opera con `TEST_SEEDS_ENABLED=true` en el deployment, igual que `createTestUser`; en producción la variable permanece ausente y la carga se rechaza.
- Es repetible e idempotente: si el dataset ya existe (verificando por el marcador del primer estudiante), no vuelve a escribir duplicados. Si se requiere recrear tras actualizar la estructura de agenda, se debe utilizar un entorno limpio de prueba.
- Se carga a mano en un deployment de desarrollo propio con `bunx convex run operations/fictitiousData:load`, después de configurar sus variables según la guía de arranque del [README](../README.md). Ningún despliegue la ejecuta automáticamente.
- Los perfiles se crean con `createTestUser` y las solicitudes pasan por los casos de uso reales (registrar, tomar, pedir información, aceptar y asignar), así que el dataset cumple las mismas reglas que el flujo del cliente.

## Cuentas

Todas quedan habilitadas y vigentes. Su `tokenIdentifier` usa el emisor inventado `dataset-ficticio`, que ningún inicio de sesión real produce: nadie puede entrar como una de estas cuentas. El dataset no crea Administradores, porque el primero sale solo de `internal.operations.accounts.ensureBootstrapAdmin`.

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

## Acompañamiento y Agenda

- **Acompañamiento:** Uno solo, abierto por la aceptación de la solicitud del Estudiante Cuatro, con el objetivo "Coordinar los apoyos de acceso para las clases prácticas del semestre." Tiene dos asignaciones vigentes: el Profesional Ficticio y el Practicante Ficticio.
- **Espacios:** Sala C-107 (Campus Norte, Edificio C, Piso 2) con la condición "Sala con acceso sin escaleras para las clases prácticas.", la misma línea de la necesidad del acompañamiento, para que los cupos presenciales resulten compatibles en la búsqueda real.
- **Disponibilidad:** Bloques recurrentes del Profesional Ficticio los lunes, en la zona de la agenda (`America/Santiago`): en línea de 09:00 a 10:00 y presencial en la sala C-107 de 10:00 a 11:00. Los instantes se generan desde esa zona civil, no desde UTC.
- **Excepciones:** Una cancelación del bloque presencial del lunes 2026-10-12, que deja ese día sin cupo compatible, y una ventana agregada el sábado 2026-10-17 de 10:00 a 11:00 en la sala C-107, que demuestra el escenario compatible fuera de la recurrencia.
- **Atenciones:** Cuatro atenciones presenciales vinculadas al acompañamiento, todas en el cupo de las 10:00 civiles de un lunes, con fechas deterministas:
  1. `no_show` (Inasistencia registrada) el 2026-09-28.
  2. `completed` (Realizada) el 2026-10-05.
  3. `cancelled_by_student` (Cancelada por el estudiante con motivo) el 2026-10-12, el mismo día del bloque cancelado por la excepción.
  4. `scheduled` (Programada) el 2026-10-19.

## Comprobación

`convex/tests/fictitiousData.test.ts` comprueba el rechazo sin `TEST_SEEDS_ENABLED`, los roles, los estados, el historial, los espacios, la disponibilidad, las excepciones, las atenciones, el aislamiento por rol y el acompañamiento de este inventario, y que una segunda carga no escribe nada. Sobre la agenda, verifica que las atenciones se consultan con la vista de cada rol (compartida para el Estudiante, completa para el Profesional y minimizada para el Practicante), que la revocación del Practicante corta el acceso, que las respuestas no exponen motivos ni notas, y que el bloque cancelado y la ventana agregada se reflejan en la búsqueda de cupos. Corre con `bun run test:convex`.
