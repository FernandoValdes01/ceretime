# Backend compartido Convex

`convex/` contiene el único backend compartido de CERETI y es responsabilidad técnica de TI2. Web y Mobile consumen su API pública; no debe existir una segunda base de datos, otra carpeta Convex ni copias de sus funciones dentro de las aplicaciones.

Consulta también `CONTEXT.md`, `DESIGN.md` y la documentación relevante de `docs/` cuando el cambio afecte lenguaje del producto, arquitectura, privacidad, autenticación o contratos consumidos por Web o Mobile.

La issue vigente en Linear es la autoridad final para el alcance operativo, la prioridad, las dependencias y los criterios de cierre. La arquitectura documentada es un objetivo: comprueba que el esquema, la API y la configuración existan antes de importarlos o extenderlos.

## Arquitectura

- Mantén las funciones públicas de Convex como adaptadores del borde de Presentación: validan la entrada, resuelven la identidad y delegan en Aplicación; no concentres autorización, consultas y reglas de negocio en una función extensa.
- Mantén las reglas del negocio en Dominio o Aplicación y los detalles de persistencia, autenticación y servicios externos en Infraestructura, siguiendo la separación descrita en la documentación del proyecto.
- Usa `query`, `mutation` y `action` sólo para la API pública; usa sus variantes `internal*` para funciones privadas que no deben formar parte del contrato expuesto.
- Define validadores para todos los argumentos de las funciones y trata los contratos públicos como una interfaz compartida con `apps/web/` y `apps/mobile/`.

## Datos y seguridad

- Define el modelo en `convex/schema.ts`, nombra los índices con todos sus campos y consulta los campos en el mismo orden declarado.
- Deriva la identidad en el servidor con `ctx.auth.getUserIdentity()`; usa `tokenIdentifier` para relacionar datos con la identidad y evalúa la autorización en el backend, nunca sólo ocultando controles del frontend.
- No aceptes un `userId` u otro identificador enviado por el cliente como prueba de autorización.
- Separa la habilitación administrativa de una cuenta Practicante de la asignación de acompañamientos por un Profesional autorizado; valida identidad, rol, cuenta vigente y asignación explícita, minimiza la respuesta y usa errores genéricos.
- Usa sólo datos ficticios o anonimizados en desarrollo, pruebas y demostraciones; mantén separados los datos de desarrollo y producción.
- Modela elementos potencialmente ilimitados en tablas relacionadas, no en arrays crecientes dentro de un documento.
- Revisa el impacto de cada cambio de esquema o contrato en ambas aplicaciones y documenta los cambios incompatibles antes de implementarlos.

## Archivos generados y verificación

- Trata `convex/_generated/` como salida generada: no edites sus archivos manualmente. Regenera lo necesario ejecutando `bunx convex dev` desde la raíz.
- Comprueba el backend con `bunx tsc -p convex/tsconfig.json --noEmit` y ejecuta las validaciones de Web o Mobile cuando cambie una función pública, un esquema o un tipo consumido por esas aplicaciones.
- No despliegues ni modifiques el deployment compartido durante una tarea local sin una solicitud explícita; prepara y verifica el cambio primero.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
