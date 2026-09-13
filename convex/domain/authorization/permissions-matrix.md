# Matriz base de permisos — Autorización en Backend (S2)

Fuente: roles provisionales de `docs/especificacion-prototipo.md`, lenguaje de `CONTEXT.md` y requerimientos RF-10, RF-23, RF-38, RF-39, RN-06, RN-08, RN-25, RN-26, RNF-08 y RNF-17. Este archivo es la evidencia de cierre; el modelo ejecutable vive en [`permissions.ts`](./permissions.ts), la coordinación en [`authorize.ts`](../../../application/authorization/authorize.ts) y el enforcement en [`accompaniments.ts`](../../../presentation/accompaniments.ts). Todo opera con datos ficticios.

## Precondiciones comunes a toda operación protegida

La identidad se deriva en el servidor con `ctx.auth.getUserIdentity()` y se vincula al perfil por `tokenIdentifier`; nunca se acepta un `userId` del cliente como prueba. El perfil debe existir con `institutionalStatus === "enabled"` y `accountStatus === "active"`; la habilitación sola no concede acceso a ningún acompañamiento. Toda denegación responde el mismo error genérico `No autorizado`, sin exponer motivo ni existencia del recurso.

## Matriz S2 (acompañamientos y notas internas)

| Caso de uso                                                       | Estudiante                               | Profesional                                       | Practicante                                                                           | Administrador                                   |
| ----------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `accompaniment:read` (`getAccompaniment`, `listMyAccompaniments`) | `full` solo propios (`studentId` propio) | `full` solo asignados activos como profesional    | `minimized` solo asignados activos como practicante, sin `accessNeeds` ni `studentId` | Denegado siempre, sin acceso ni listado general |
| `internalNote:read` (`getInternalNotes`)                          | Denegado aunque sea dueño                | Permitido solo asignados activos como profesional | Denegado aunque tenga asignación                                                      | Denegado por defecto (RNF-17)                   |

La habilitación de una cuenta Practicante y su asignación a un acompañamiento son decisiones distintas: una cuenta habilitada sin asignación activa no lee nada, y una asignación revocada deja de autorizar. Una cuenta `@alu.uct.cl` solo opera como profesional de prueba dentro de acompañamientos explícitamente asignados y auditados (RN-25). La vista `minimized` excluye `accessNeeds` por tratarse de dato potencialmente sensible (Ley 21.719) y las notas internas quedan en una consulta separada solo para profesionales autorizados.

## Cómo se enforcea en Backend

Presentación valida argumentos, resuelve identidad y perfil, carga el acompañamiento y las asignaciones del llamante por el índice `by_accompaniment_and_user`, y delega en Aplicación/Dominio; Dominio decide con `getAccompanimentView` y `canReadInternalNote` sin importar Convex. El Administrador no tiene rama de lectura: cualquier intento de leer, listar o ver notas cae en denegación genérica, lo que impide el acceso general por construcción y no solo ocultando controles de la UI.

## Casos cubiertos por pruebas

Positivos: estudiante lee lo propio en vista completa; profesional asignado lee completo y lee notas; practicante asignado lee minimizado sin `accessNeeds`; listados por alcance para los tres roles. Negativos: administrador denegado en lectura, listado y notas; estudiante ajeno denegado; profesional sin asignación denegado; practicante habilitado sin asignación denegado; asignación revocada denegada; cuenta deshabilitada o inactiva denegada; sin identidad denegado; estudiante dueño denegado en notas; practicante asignado denegado en notas; recurso inexistente responde igual que denegado.

## Qué queda pendiente de validación

La matriz definitiva, su correspondencia con cargos reales y los permisos exactos del Practicante requieren validación de CERETI y UCT (PV-01, PV-16, PV-17). Solicitudes, atenciones, reportes agregados y gestión de cuentas quedan fuera de este incremento mínimo y seguirán la misma separación por capas cuando se implementen.
