# Cuentas profesionales y administrativas — TI2-137

Fuente: `CONTEXT.md` (Administrador sin acceso irrestricto), matriz de `convex/domain/authorization/permissions-matrix.md` y habilitación de `convex/domain/accounts/enablement.md`. Superficie pública bajo `api.presentation.accounts.*`; todo opera con datos ficticios.

## Queries públicas

| Operación | Argumentos | Devuelve | Quién | Denegación |
| --- | --- | --- | --- | --- |
| `presentation/accounts.listAccounts` | `role` (`professional` o `admin`), `paginationOpts` (`numItems` entero entre 1 y 100) | Página de cuentas del `role` pedido con detalle mínimo | Administrador vigente | `unauthorized`, sin revelar existencia; `numItems` fuera de rango falla con error de regla |
| `presentation/accounts.getAccount` | `userId` | Detalle mínimo de la cuenta | Administrador vigente, solo personal | `unauthorized`; el `_id` de estudiante o practicante se deniega igual que uno inexistente |

## Mutations públicas

| Operación | Argumentos | Devuelve | Quién | Denegación |
| --- | --- | --- | --- | --- |
| `presentation/accounts.enableAccount` | `userId` | `{ userId }` habilitado | Administrador vigente, objetivo profesional o administrador de personal, pendiente o revocado | `unauthorized` sin permiso o con objetivo inexistente o fuera de esta vía; `conflict` con tránsito inválido |
| `presentation/accounts.revokeAccount` | `userId` | `{ userId }` revocado | Administrador vigente, objetivo profesional o administrador habilitado | `unauthorized` sin permiso o con objetivo inexistente o fuera de esta vía; `conflict` con tránsito inválido o auto-revocación |

## Detalle mínimo y resultados

El listado y el detalle entregan `_id`, `email`, `fullName`, `role`, `institutionalStatus`, `accountStatus` y la auditoría (`enabledBy`, `enabledAt`, `revokedBy`, `revokedAt`); nunca `tokenIdentifier`, acompañamientos, necesidades de acceso ni notas internas. La página conserva la forma de `paginate`: `{ page, isDone, continueCursor }`.

```json
{
  "_id": "j97abc...",
  "email": "pro@uct.cl",
  "fullName": "Profesional Ficticio",
  "role": "professional",
  "institutionalStatus": "enabled",
  "accountStatus": "active",
  "enabledBy": "j97def...",
  "enabledAt": 1762700000000
}
```

Una cuenta pendiente aún no trae auditoría; una revocada conserva la habilitación y suma la revocación (`revokedBy`, `revokedAt`); una rehabilitada vuelve a `enabled` y conserva ambas auditorías. El estado vigente lo decide `institutionalStatus`, nunca la comparación de fechas.

## Permisos y datos por rol

Solo el Administrador con cuenta habilitada y vigente lista, lee, habilita y revoca cuentas de personal. Estudiante, Profesional y Practicante solo ven su perfil propio mediante `presentation/session.getMyProfile` y reciben `unauthorized` en esta superficie. Tener correo institucional no concede acceso: sin perfil vinculado y vigente la respuesta es denegación. Habilitar exige correo de personal en ambos roles; revocar no revisa el dominio: cortar el acceso siempre está permitido. Administrar no concede acompañamientos ni notas: el Administrador sigue denegado en `accompaniment:read` e `internalNote:read`. La gestión de Practicantes corresponde al Profesional y se resuelve en TI2-140.

Revocar a un Profesional no reasigna sus acompañamientos ni atenciones: las filas se conservan y dejan de autorizar en la petición siguiente porque cada lectura vuelve a exigir el perfil vigente. La reasignación queda fuera de alcance de TI2-137 y pendiente de coordinar con la administración web (TI2-169).

## Errores

Los errores usan el contrato común de TI2-88 (`ConvexError({ code, message })`): los clientes distinguen por `error.data.code`, nunca por el texto. `unauthorized` (`No autorizado`) responde ante falta de identidad, perfil o vigencia, rol ajeno u objetivo inexistente o fuera de esta vía. `conflict` explica un tránsito inválido a un administrador autorizado: cuenta ya habilitada, cuenta no habilitada, objetivo sin correo de personal, cuenta no vigente o auto-revocación. El `numItems` fuera de 1–100 no es un problema de permiso: falla con error de regla en español antes de leer. Las validaciones de tipo de argumentos fallan con error de validador de Convex, sin detalles sensibles.

```json
{ "code": "unauthorized", "message": "No autorizado" }
```

## Ejemplos para Web y Mobile

```ts
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "./_generated/api";

const { results, status, loadMore } = usePaginatedQuery(
  api.presentation.accounts.listAccounts,
  { role: "professional" },
  { initialNumItems: 20 },
);

const enableAccount = useMutation(api.presentation.accounts.enableAccount);
const { userId } = await enableAccount({ userId: targetId });

const revokeAccount = useMutation(api.presentation.accounts.revokeAccount);
await revokeAccount({ userId: targetId });
```

```ts
import { ConvexError } from "convex/values";

try {
  await enableAccount({ userId: targetId });
} catch (error) {
  if (error instanceof ConvexError && error.data.code === "conflict") {
    muestraMensaje(error.data.message);
  }
}
```
