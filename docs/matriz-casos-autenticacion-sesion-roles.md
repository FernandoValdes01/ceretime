# Matriz de casos de prueba — autenticación, sesión y roles

Evidencia de TI2-12: qué prueba automatizada cubre cada situación de autenticación, sesión y permisos base de Estudiante, Profesional, Practicante y Administrador, y qué situaciones todavía no tienen prueba.

## Cómo leerla

Cada prueba se nombra por archivo y título, tal como lo imprime `vitest`, para poder buscarla sin depender de números de línea. El estado dice si la prueba ya está en `main`, si la agrega esta issue (TI2-12) o si no existe ninguna prueba para esa situación.

Todo se corre con `bun run test:convex` y `bun run test:web`. La CI ejecuta los dos en los jobs "Verificación Backend" y "Validación Web", y cualquier archivo `*.test.ts` o `*.test.tsx` nuevo en `convex/` o `apps/web/src/` entra solo, sin tocar los workflows.

## Archivos citados

| Nombre | Archivo |
| --- | --- |
| `session` | `convex/session.test.ts` |
| `session_role` | `convex/session_role.test.ts` |
| `authorization` | `convex/authorization.test.ts` |
| `authorizationIntern` | `convex/authorizationIntern.test.ts` |
| `internAccess` | `convex/internAccess.test.ts` |
| `accounts` | `convex/accounts.test.ts` |
| `requests` | `convex/requests.test.ts` |
| `acceptance` | `convex/acceptance.test.ts` |
| `reject_external_user` | `convex/application/session/reject_external_user.test.ts` |
| `institutional_domain` | `convex/domain/auth/institutional_domain.test.ts` |
| `student-routes` | `apps/web/src/presentation/routes/student-routes.test.tsx` |
| `staff-routes` | `apps/web/src/presentation/routes/staff-routes.test.tsx` |
| `return-target` | `apps/web/src/presentation/routes/return-target.test.ts` |
| `auth-error` | `apps/web/src/presentation/auth/auth-error.test.ts` |
| `institutional-login` | `apps/web/src/application/session/institutional-login.test.ts` |
| `AuthScreen` | `apps/web/src/presentation/auth/AuthScreen.test.tsx` |
| `sprint1Queries` | `convex/sprint1Queries.test.ts` |

## Login e identidad institucional

| Qué se prueba | Tipo | Prueba | Estado |
| --- | --- | --- | --- |
| Una cuenta de estudiante recibe identidad mínima | Positivo | `session` › "identidad institucional recibe identidad mínima" | En `main` |
| Una cuenta de personal recibe su población | Positivo | `session` › "identidad personal recibe población personal" | En `main` |
| Un dominio externo no inicia sesión ni recibe motivo | Negativo | `session` › "dominio externo responde no autenticado sin motivo"; `reject_external_user` › "rechaza correos fuera de la institución" | En `main` |
| Un correo con el sufijo institucional pero inválido se rechaza | Negativo | `institutional_domain` › "rechaza correos inválidos aunque terminen con el sufijo" | En `main` |
| Sin identidad no hay sesión | Negativo | `session` › "sin identidad responde no autenticado" | En `main` |
| Una cuenta no autorizada responde igual que una sesión ausente | Negativo | `session` › "cuenta no autorizada y sesión ausente responden idéntico sin filtrar motivo (TI2-14)" | En `main` |
| Un error del proveedor se muestra sin exponer sus valores | Negativo | `auth-error` › "traduce el error del proveedor sin exponer sus valores" | En `main` |
| Después del login se vuelve a la ruta pedida | Positivo | `student-routes` › "el retorno OAuth en / navega a la ruta conservada una sola vez" | En `main` |
| El retorno no acepta URLs externas | Negativo | `return-target` › "rechaza URLs absolutas, protocolo relativo y no texto" | En `main` |
| La interfaz ofrece un inicio por población | Positivo | `institutional-login` › "expone un inicio por población con su sufijo institucional" | En `main` |
| El inicio usa Google y vuelve a la aplicación por una ruta fija | Positivo | `institutional-login` › "usa el mismo proveedor Google con retorno controlado a la SPA" | En `main` |
| Los mensajes de error de ingreso, de sesión expirada y de cierre no revelan dominio ni correo | Negativo | `institutional-login` › "no filtra motivo, dominio ni datos de sesión" | En `main` |

## Cierre de sesión

| Qué se prueba | Tipo | Prueba | Estado |
| --- | --- | --- | --- |
| Con sesión iniciada, la interfaz ofrece cerrarla | Positivo | `student-routes` › "la sesión ya iniciada sin retorno muestra su estado con cierre" | En `main` |
| El cierre invalida la sesión y vuelve al acceso | Positivo | `AuthScreen` › "vuelve al acceso cuando el cierre invalida la sesión observada" | En `main` |
| Llamar al cierre no basta: manda el estado observado | Negativo | `AuthScreen` › "no sale de la sesión solo por llamar a signOut: sigue el estado observado" | En `main` |
| Un cierre fallido muestra un mensaje genérico | Negativo | `AuthScreen` › "muestra el mensaje genérico cuando el cierre responde error"; "muestra el mensaje genérico cuando el cierre rechaza" | En `main` |
| Después del cierre el backend no entrega datos | Negativo | `session` › "cierre (identidad ausente) responde no autenticado sin datos mínimos (TI2-15)" | En `main` |

## Sesión persistida y expirada

Dónde se guarda la sesión y cuánto dura lo resuelve Better Auth: `convex/auth.ts` no configura una duración propia. Estas pruebas cubren cómo reacciona la aplicación a la sesión, no su almacenamiento.

| Qué se prueba | Tipo | Prueba | Estado |
| --- | --- | --- | --- |
| Portales de personal: una sesión existente se restaura sin pasar por el acceso | Positivo | `staff-routes` › "el índice espera al par pendiente y deriva al portal cuando se resuelve" | En `main` |
| Portal del Estudiante: lo mismo | Positivo | `staff-routes` › "la sesión pendiente se restaura en el portal sin pasar por el acceso" | TI2-12 |
| Sin sesión confirmada no se muestra contenido protegido | Negativo | `staff-routes` › "sin sesión confirmada navega al acceso aunque el par siga pendiente" | En `main` |
| Portales de personal: perder la sesión oculta el portal y vuelve al acceso | Negativo | `staff-routes` › "perder la sesión oculta el portal y navega al acceso aunque el rol siga vigente" | En `main` |
| Portal del Estudiante: lo mismo | Negativo | `staff-routes` › "la sesión que se pierde con el portal abierto lo oculta y vuelve al acceso" | TI2-12 |
| Al cambiar de cuenta no aparece el portal anterior | Negativo | `staff-routes` › "al cambiar de cuenta el portal anterior no aparece con la sesión nueva" | En `main` |
| Un perfil inhabilitado conserva la sesión pero pierde el rol | Negativo | `session_role` › "perfil inhabilitado mantiene sesión pero sin rol" | En `main` |
| Una sesión expirada responde no autenticado sin motivo | Negativo | `session` › "expiración (identidad ausente) responde no autenticado sin filtrar motivo (TI2-15)" | En `main` |
| La interfaz avisa cuando una sesión existente deja de reconocerse | Negativo | `AuthScreen` › "anuncia el término cuando una sesión existente deja de ser reconocida" | En `main` |

## Guards de sesión en la Web

Qué ve cada rol al entrar directamente a cada portal. El guard del Estudiante decide primero por la población del correo y después niega cualquier rol de personal que venga del perfil; si la cuenta no tiene perfil, entra por población, como definió TI2-6. Los guards de personal deciden por rol.

| Portal | Estudiante | Profesional | Practicante | Administrador | Sin sesión | Sin perfil |
| --- | --- | --- | --- | --- | --- | --- |
| Estudiante | Entra | Denegado | Denegado por rol | Denegado por población | Al acceso | Entra por población |
| Profesional | Denegado | Entra | Denegado | Denegado | Al acceso | Denegado |
| Practicante | Denegado | Denegado | Entra | Denegado | Al acceso | Denegado |
| Administración | Denegado | Denegado | Denegado | Entra | Al acceso | Denegado |

El Practicante tiene correo de estudiante, así que pasa el filtro por población del portal del Estudiante y solo lo detiene su rol. Al Administrador lo detiene la población, y eso lo prueba `student-routes` › "la sesión de otra población ve denegado sin contenido protegido". La cuenta sin perfil entra porque la portada no lee datos del backend, y el backend le niega el perfil propio: `sprint1Queries` › "perfil propio sin identidad o sin perfil se deniega".

Pruebas del portal del Estudiante: `student-routes` › "el Estudiante con sesión ve el portal sin redirigir", "la sesión de otra población ve denegado sin contenido protegido", "el acceso directo sin sesión redirige al acceso conservando el retorno"; `staff-routes` › "el Profesional no entra al portal del Estudiante", "el acceso directo a /estudiante deniega el rol staff sin exponer contenido", "el Practicante con correo de estudiante ve denegado sin contenido del portal", "la cuenta de estudiante sin perfil entra por población". Las dos últimas están en `staff-routes` porque su simulador fija el rol aparte de la sesión; el de `student-routes` le da siempre rol de estudiante a la sesión de estudiante.

Pruebas de los portales de personal: `staff-routes`, grupos "portal Profesional (TI2-20)", "portal Practicante (TI2-20)" y "portal Administración (TI2-20)". Cada grupo prueba los tres roles denegados, la sesión sin perfil, el acceso directo sin sesión y el rol que entra.

## Permisos base de los cuatro roles

Resultado de llamar cada operación del backend con cada rol vigente, o sin identidad. "Denegado" significa que la operación responde el error genérico `No autorizado`, sin revelar si el recurso existe.

### Sesión y acompañamientos

| Operación | Estudiante | Profesional | Practicante | Administrador | Sin identidad |
| --- | --- | --- | --- | --- | --- |
| Sesión y rol propios | Sesión y rol · `session_role` | Sesión y rol · `session_role` | Sesión y rol · `session_role` | Sesión y rol · `session_role` | No autenticado · `session_role` |
| Perfil propio | Propio · `sprint1Queries` | **Sin prueba** | **Sin prueba** | **Sin prueba** | Denegado · `sprint1Queries` |
| Leer un acompañamiento | Propio, completo · `authorization` | Asignado, completo · `authorization` | Asignado, minimizado · `authorization` | Denegado · `authorization` | Denegado · `authorization` |
| Listar acompañamientos propios | Propios · `authorization` | **Sin prueba** | **Sin prueba** | Denegado · `authorization` | **Sin prueba** |
| Listar acompañamientos asignados | **Sin prueba** | Asignados · `authorization` | Asignados · `authorization` | Denegado · `authorization` | **Sin prueba** |
| Leer notas internas | Denegado · `authorization` | Asignado · `authorization` | Denegado · `authorization` | Denegado · `authorization` | **Sin prueba** |

### Asignaciones y habilitación

| Operación | Estudiante | Profesional | Practicante | Administrador | Sin identidad |
| --- | --- | --- | --- | --- | --- |
| Conceder o retirar el acceso de un practicante | Denegado · `authorization` | Permitido si tiene el acompañamiento · `internAccess` | Denegado · `authorizationIntern` | Denegado · `internAccess` | Denegado · `authorization` |
| Habilitar la cuenta de un practicante | Denegado · `accounts` | Denegado · `accounts` | Denegado · `accounts` | Permitido · `accounts` | Denegado · `accounts` |

### Solicitudes

| Operación | Estudiante | Profesional | Practicante | Administrador | Sin identidad |
| --- | --- | --- | --- | --- | --- |
| Registrar una solicitud | Permitido · `requests` | Denegado · `requests` | **Sin prueba** | **Sin prueba** | Denegado · `requests` |
| Listar solicitudes propias | Propias · `requests` | Denegado · `requests` | **Sin prueba** | **Sin prueba** | Denegado · `requests` |
| Listar solicitudes tomadas | Denegado · `requests` | Tomadas · `requests` | **Sin prueba** | **Sin prueba** | Denegado · `requests` |
| Ver la bandeja de recibidas | **Sin prueba** | Recibidas, sin datos sensibles · `requests` | **Sin prueba** | **Sin prueba** | **Sin prueba** |
| Tomar una solicitud | **Sin prueba** | Permitido si está recibida y sin otra toma · `requests` | **Sin prueba** | **Sin prueba** | **Sin prueba** |
| Pedir información adicional | Denegado · `requests` | Permitido con toma y motivo · `requests` | **Sin prueba** | **Sin prueba** | Denegado · `requests` |
| Aceptar una solicitud | Denegado · `acceptance` | Permitido con toma · `acceptance` | **Sin prueba** | **Sin prueba** | Denegado · `acceptance` |
| Ver el detalle de una solicitud | Propia · `sprint1Queries` | Tomada · `sprint1Queries` | Denegado · `sprint1Queries` | Denegado · `sprint1Queries` | Denegado · `sprint1Queries` |

## Casos de prueba pendientes

Son el trabajo pendiente de esta rama. Donde el resultado esperado no está escrito en otro documento, se confirma leyendo el caso de uso antes de escribir la prueba.

- **Identidad:** el Profesional, el Practicante y el Administrador consultando su propio perfil; solo está probado el Estudiante.
- **Solicitudes:** el Practicante y el Administrador en las siete operaciones; el Estudiante y el anónimo en la bandeja y en la toma. El documento de casos de uso de TI2-9, en `convex/application/requests/`, define quién opera cada una y que toda denegación responde el error genérico.
- **Acompañamientos:** los listados llamados por un rol distinto del que les corresponde, y las notas internas sin identidad.
