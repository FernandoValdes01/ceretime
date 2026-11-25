# Contrato Sprint 3 — Catálogo de espacios (TI2-148, avisos TI2-156)

Superficie pública versionada para que administración cree, consulte, edite y deshabilite espacios con sus condiciones e instrucciones de acceso, usando el mismo catálogo que la disponibilidad. Todo lo que Web y Mobile consumen sale de `api.presentation.spaces` y de los tipos generados en `convex/_generated`; no existe otro catálogo ni borrado físico de salas con historial.

## Operaciones públicas

| Operación | Argumentos | Devuelve | Quién | Denegación |
| --- | --- | --- | --- | --- |
| `presentation.spaces.listSpaces` | `limit`, `cursor?`, `version: "v1"` | `{items: Space[], hasMore, nextCursor, version}` | Cualquier rol con cuenta vigente | `ConvexError("No autorizado")` sin motivo ni existencia |
| `presentation.spaces.getSpace` | `spaceId`, `version: "v1"` | `{space: Space, label, isActive}` | Solo administración vigente | `{code: "unauthorized", message: "No autorizado"}`; inexistente o de otra tabla igual |
| `presentation.spaces.createSpace` | `campus, building, floor, room, accessConditions, arrivalInstructions`, `version: "v1"` | `{space: Space, label, isActive}` | Solo administración vigente | `unauthorized` genérico (se autoriza antes de validar); duplicado `conflict`; campos vacíos `space_fields_invalid` |
| `presentation.spaces.updateSpace` | `spaceId` más los campos de creación | `{space: Space, label, isActive}` | Solo administración vigente | `unauthorized` genérico; ubicación de otra sala `conflict`; campos vacíos `space_fields_invalid`; lectura truncada de futuras `conflict` sin escribir ni avisar a medias (TI2-156) |
| `presentation.spaces.setSpaceActive` | `spaceId, isActive`, `version: "v1"` | `{space: Space, label, isActive}` | Solo administración vigente | `unauthorized` genérico; inexistente o de otra tabla igual, sin filtrar; lectura truncada de futuras `conflict` (TI2-156) |
| `presentation.spaces.listInactiveSpaces` | `limit`, `cursor?`, `version: "v1"` | `{items: Space[], hasMore, nextCursor, version}` solo retiradas | Solo administración vigente | `unauthorized` genérico; `conflict` ante versión o límite inválidos |

## Reglas

* Versión del contrato: `"v1"` (`SPACE_CATALOG_CONTRACT_VERSION`). Otra versión rechaza con `Error("La versión del contrato de espacios debe ser la vigente.")`; desde la API pública el validador `v.literal("v1")` rechaza antes.
* Campos legibles en español: llegan a producción como `{code: "space_fields_invalid", message}` con el mensaje del campo (`"Indica el campus del espacio."`, `"Indica el edificio del espacio."`, `"Indica el piso del espacio."`, `"Indica la sala del espacio."`, `"Describe las condiciones de acceso del espacio."` o `"Describe las instrucciones de llegada al espacio."`). Los valores se guardan recortados: `" Sala 1 "` se registra como `"Sala 1"`.
* Duplicado lógico: misma tupla `(campus, building, floor, room)` ya recortada, vigente o retirada, responde `{code: "conflict", message: "La solicitud entra en conflicto con el estado actual."}` sin escribir. Vale para crear y para editar hacia la ubicación de otra sala. Una sala retirada bloquea su ubicación para siempre: el camino es reactivarla con `setSpaceActive(true)`, no crear una gemela.
* Límite conocido: el duplicado distingue mayúsculas y espacios internos (`"Sala 1"` y `"sala 1"` son salas distintas) y los campos de texto no tienen tope de largo; no se cubre en esta tarea.
* Nombres legibles: toda respuesta de gestión trae el contrato `Space` (con su `version`) más `label` (`toSpaceLabel`: `campus · building · floor · room`) y `isActive`, sin otra representación del mismo concepto.
* Sin borrado físico: deshabilitar conserva la fila y su historial. Una sala con `isActive: false` deja de ofrecerse en `listSpaces` y en la compatibilidad de disponibilidad (`compatibilitySpaceSource` responde `null`).
* Con avisos (TI2-156): retirar, cambiar la ubicación o cambiar condiciones revalida las futuras de esa sala en la misma mutación y avisa solo lo que pasa de reservable a no reservable (`appointment_space_changed`), sin borrar ni cancelar. Si cambia `campus/building/floor/room`, avisa a todas las futuras de esa sala; si solo cambian condiciones, avisa a las que dejan de ser compatibles (antes/después). Si la lectura se trunca, responde `conflict` sin escribir. Reactivar no avisa. Sin pantalla: la conexión Web es TI2-169; `listInactiveSpaces` permite reactivar con `setSpaceActive(true)` desde el siguiente módulo.
