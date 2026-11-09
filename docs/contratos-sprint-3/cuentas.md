# Cuentas profesionales y administrativas — TI2-137

Fuente: `CONTEXT.md` (Administrador sin acceso irrestricto), matriz de `convex/domain/authorization/permissions-matrix.md` y habilitación de `convex/domain/accounts/enablement.md`. Superficie pública bajo `api.presentation.accounts.*`; todo opera con datos ficticios.

## Queries públicas

| Operación | Argumentos | Devuelve | Quién | Denegación |
| --- | --- | --- | --- | --- |
| `presentation/accounts.listAccounts` | `paginationOpts` | Página de cuentas con detalle mínimo | Administrador vigente | Error genérico, sin revelar existencia |
| `presentation/accounts.getAccount` | `userId` | Detalle mínimo de la cuenta | Administrador vigente | Error genérico, sin revelar existencia |

## Mutations públicas

| Operación | Argumentos | Devuelve | Quién | Denegación |
| --- | --- | --- | --- | --- |
| `presentation/accounts.enableAccount` | `userId` | `userId` habilitado | Administrador vigente, objetivo profesional o administrador pendiente o revocado | Error genérico, sin revelar motivo ni existencia |
| `presentation/accounts.revokeAccount` | `userId` | `userId` revocado | Administrador vigente, objetivo profesional o administrador habilitado | Error genérico, sin revelar motivo ni existencia |

## Detalle mínimo

El listado y el detalle entregan `_id`, `email`, `fullName`, `role`, `institutionalStatus`, `accountStatus` y la auditoría (`enabledBy`, `enabledAt`, `revokedBy`, `revokedAt`); nunca `tokenIdentifier`, acompañamientos, necesidades de acceso ni notas internas.

## Permisos y datos por rol

Solo el Administrador con cuenta habilitada y vigente lista, lee, habilita y revoca cuentas profesionales y administrativas. Estudiante, Profesional y Practicante solo ven su perfil propio mediante `presentation/session.getMyProfile` y reciben denegación en esta superficie. Tener correo institucional no concede acceso: sin perfil vinculado y vigente la respuesta es denegación. Administrar no concede acompañamientos ni notas: el Administrador sigue denegado en `accompaniment:read` e `internalNote:read`. La gestión de Practicantes corresponde al Profesional y se resuelve en TI2-140.

## Errores

Toda denegación de autorización responde `ConvexError("No autorizado")`: mismo mensaje sin motivo y sin revelar si el recurso existe. Aplica a identidad ausente, perfil ausente o no vigente, rol ajeno, objetivo inexistente, rol no administrable, correo no institucional, cuenta no vigente, estado que no admite el tránsito, auto-revocación y revocación del último administrador vigente. Las validaciones de tipo de argumentos fallan con error de validador de Convex, sin detalles sensibles.

## Ejemplos

```ts
import { api } from "./_generated/api";

const page = await ctx.runQuery(api.presentation.accounts.listAccounts, {
  paginationOpts: { numItems: 20, cursor: null },
});

const detail = await ctx.runQuery(api.presentation.accounts.getAccount, {
  userId: targetId,
});

const enabled = await ctx.runMutation(api.presentation.accounts.enableAccount, {
  userId: targetId,
});

const revoked = await ctx.runMutation(api.presentation.accounts.revokeAccount, {
  userId: targetId,
});
```
