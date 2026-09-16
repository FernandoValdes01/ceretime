# Habilitación institucional y arranque administrativo — TI2-11

Fuente: lenguaje de `CONTEXT.md` (Practicante con cuenta institucional habilitada y asignación como decisiones distintas, Administrador sin acceso irrestricto), seguridad mínima de `docs/especificacion-prototipo.md` (habilitación previa de cuentas de funcionarios, autorización en backend y datos ficticios) y matriz de `domain/authorization/permissions-matrix.md`. Este archivo es la evidencia de cierre; el modelo ejecutable vive en [`enablement.ts`](./enablement.ts), la coordinación en [`enablement.ts`](../../application/accounts/enablement.ts), la persistencia en [`repository.ts`](../../infrastructure/accounts/repository.ts) y el borde en [`accounts.ts`](../../accounts.ts). Todo opera con datos ficticios.

## Regla de habilitación

Solo el Administrador con cuenta habilitada (`institutionalStatus === "enabled"`) y vigente (`accountStatus === "active"`) habilita cuentas de Practicante mediante `internal.accounts.enableIntern`, con identidad derivada en el servidor (`ctx.auth.getUserIdentity()`) y perfil vinculado por `tokenIdentifier`; nunca se acepta un `userId` del cliente como prueba.

## Validación del objetivo

El objetivo debe tener rol `intern`, correo institucional normalizado (`@alu.uct.cl` o `@uct.cl` según `domain/auth/institutional_domain.ts`), cuenta vigente (`accountStatus === "active"`) y estado pendiente (`institutionalStatus === "pending"`); la operación lo deja en `enabled` sin cambiar el rol y rechaza la cuenta ya habilitada para no sobrescribir la auditoría. Toda denegación de esta vía (permiso, existencia, rol, correo, vigencia o estado) responde el mismo error genérico `No autorizado`, sin exponer el motivo.

## Auditoría y separación de decisiones

Cada habilitación registra actor (`enabledBy` con el `_id` del Administrador) y fecha (`enabledAt`) en el propio documento de `users`; habilitar no concede acompañamientos, una cuenta habilitada sin asignación activa sigue sin leer nada y la asignación posterior la realiza un Profesional autorizado por la vía guardada de `internal.assignments`.

## Ausencia de auto-escalamiento

No existe función pública (`query`, `mutation` o `action`) que cree cuentas ni que cambie roles; `internal.users.createTestUser` y `internal.accounts.ensureBootstrapAdmin` son internas y no forman parte del contrato expuesto, `enableIntern` jamás escribe el campo `role` y el arranque solo crea el primer Administrador, por lo que ningún usuario puede promoverse a sí mismo desde el cliente.

## Procedimiento de arranque por entorno

El arranque crea una sola vez la cuenta administrativa inicial con `internal.accounts.ensureBootstrapAdmin`, usando valores propios de cada entorno (desarrollo, pruebas o producción) provistos por el operador al invocar la función; antes de ejecutar, el operador selecciona el entorno de forma explícita y confirma sus variables con el comando completo `bunx convex env get TEST_SEEDS_ENABLED --prod` (con `--deployment <nombre>` fuera de producción y nunca sin selector cuando el objetivo es producción), registra el correo institucional de personal (`@uct.cl`), el nombre completo y el `tokenIdentifier` de la identidad Google del administrador, ejecuta la función sobre ese mismo entorno con `bunx convex run accounts:ensureBootstrapAdmin '{"email":"valor","fullName":"valor","tokenIdentifier":"valor"}' --prod` (con `--deployment <nombre>` fuera de producción), verifica que la cuenta nace con `role === "admin"`, `institutionalStatus === "enabled"` y `accountStatus === "active"`, y archiva la fecha de ejecución como evidencia. Sin selector, el CLI acciona el entorno de desarrollo por defecto; por eso cada paso contra producción lleva su selector explícito y así se evita validar o ejecutar el arranque accidentalmente en desarrollo.

## Garantías contra semillas en producción

Las semillas de desarrollo son solo `internal.users.createTestUser` y los insert directos de las pruebas con `convex-test`; no existe guion automático que las ejecute al desplegar, el arranque falla con `Ya existe una cuenta administrativa` cuando ya hay un Administrador, el arranque exige correo `@uct.cl` con estructura válida y rechaza cualquier otro rol, y toda demostración usa datos ficticios sin reutilizar correos, nombres ni identificadores de producción.

## Casos cubiertos por pruebas

Positivos: el Administrador habilita al Practicante pendiente y deja actor y fecha; la cuenta habilitada sigue sin leer acompañamientos sin asignación; el arranque crea al primer Administrador habilitado. Negativos: estudiante, profesional, practicante, anónimo y administrador inhabilitado reciben `No autorizado`; correo externo, cuenta inactiva, rol no practicante, estado no pendiente, cuenta ya habilitada y recurso inexistente también responden `No autorizado`; segundo arranque, arranque con correo no `@uct.cl` o inválido y arranque con identidad duplicada se rechazan; la superficie pública no expone creación ni promoción de Administradores.
