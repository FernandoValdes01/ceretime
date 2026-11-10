# Contrato Sprint 3 — Catálogo de espacios (TI2-148)

Superficie pública versionada para que administración cree, consulte, edite y deshabilite espacios con sus condiciones e instrucciones de acceso, usando el mismo catálogo que la disponibilidad. Todo lo que Web y Mobile consumen sale de `api.presentation.spaces` y de los tipos generados en `convex/_generated`; no existe otro catálogo ni borrado físico de salas con historial.

## Operaciones públicas

| Operación | Argumentos | Devuelve | Quién | Denegación |
| --- | --- | --- | --- | --- |
| `presentation.spaces.listSpaces` | `limit`, `cursor?`, `version: "v1"` | `{items: Space[], hasMore, nextCursor, version}` | Cualquier rol con cuenta vigente | `ConvexError("No autorizado")` sin motivo ni existencia |
| `presentation.spaces.getSpace` | `spaceId`, `version: "v1"` | `{space: Space, label, isActive, version}` | Solo administración vigente | `{code: "unauthorized", message: "No autorizado"}`; inexistente o de otra tabla igual |
| `presentation.spaces.createSpace` | `campus, building, floor, room, accessConditions, arrivalInstructions`, `version: "v1"` | `{space: Space, label, isActive, version}` | Solo administración vigente | `unauthorized` genérico; duplicado `conflict` |
| `presentation.spaces.updateSpace` | `spaceId` más los campos de creación | `{space: Space, label, isActive, version}` | Solo administración vigente | `unauthorized` genérico; ubicación de otra sala `conflict` |
| `presentation.spaces.setSpaceActive` | `spaceId, isActive`, `version: "v1"` | `{space: Space, label, isActive, version}` | Solo administración vigente | `unauthorized` genérico; inexistente `conflict` en persistencia, `unauthorized` en el borde |

## Reglas

* Versión del contrato: `"v1"` (`SPACE_CATALOG_CONTRACT_VERSION`). Otra versión rechaza con `Error("La versión del contrato de espacios debe ser la vigente.")`.
* Campos legibles en español: vacíos recortados rechazan con `Error("Indica el campus del espacio.")`, `Error("Indica el edificio del espacio.")`, `Error("Indica el piso del espacio.")`, `Error("Indica la sala del espacio.")`, `Error("Describe las condiciones de acceso del espacio.")` o `Error("Describe las instrucciones de llegada al espacio.")`.
* Duplicado lógico: misma tupla `(campus, building, floor, room)`, vigente o retirada, responde `{code: "conflict", message: "La solicitud entra en conflicto con el estado actual."}` sin escribir. Vale para crear y para editar hacia la ubicación de otra sala.
* Nombres legibles: toda respuesta de gestión trae el contrato `Space` más `label` (`toSpaceLabel`: `campus · building · floor · room`) y `isActive`, sin otra representación del mismo concepto.
* Sin borrado físico: deshabilitar conserva la fila y su historial. Una sala con `isActive: false` deja de ofrecerse en `listSpaces` y en la compatibilidad de disponibilidad (`compatibilitySpaceSource` responde `null`).
* Sin avisos: retirar no notifica a atenciones confirmadas ni aplica necesidades actualizadas; eso es TI2-156. Sin pantalla: la conexión Web es TI2-169.
