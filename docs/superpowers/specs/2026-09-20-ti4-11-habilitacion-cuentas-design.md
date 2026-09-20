# TI4-11: habilitación de cuentas en Mobile

<!-- cspell:ignore habilitacion -->

## Contexto

El área Mobile del Administrador ya dispone de las rutas protegidas `/administrador` y `/administrador/usuarios`, pero ambas muestran contenido provisional. TI4-11 debe convertirlas en un recorrido mínimo que represente la habilitación de una cuenta institucional con datos ficticios y deje claro que esta acción no concede acceso a acompañamientos.

## Alcance

El Administrador podrá abrir la sección de usuarios desde su inicio, consultar cuentas institucionales ficticias y ejecutar una habilitación simulada. El flujo incluirá un resultado válido y un error controlado. No incluirá auditoría, reportes, configuración avanzada, acompañamientos, notas internas ni concesión de acceso de Practicantes.

## Diseño elegido

La funcionalidad seguirá las capas existentes de Mobile. La capa de aplicación definirá una proyección mínima de cuenta institucional y un puerto de lectura y habilitación. Infraestructura aportará un adapter mock con datos ficticios. Presentación consumirá el puerto mediante un hook que se encargará de la carga y de los estados de cada acción. Este límite evita mezclar la administración de cuentas con `AuthPort` y permite sustituir el mock sin reescribir las pantallas.

No se extenderá `AuthPort`, porque autenticación y habilitación institucional son capacidades distintas. Tampoco se guardará el estado directamente en la pantalla, porque eso acoplaría la interfaz a la simulación y rompería el patrón que ya utilizan los flujos de Estudiante y Profesional.

## Componentes

- `administrator-account-models.ts` contendrá la cuenta institucional mínima, su estado provisional y el recibo de habilitación.
- `administrator-accounts-port.ts` expondrá la lectura de cuentas y la habilitación de una cuenta por identificador.
- Un adapter mock mantendrá el conjunto ficticio durante la sesión y representará un caso exitoso y un error controlado.
- `use-administrator-accounts.ts` expondrá los estados `loading`, `empty`, `success` y `error`, junto con el estado de habilitación de cada cuenta.
- La composición Mobile inyectará una única instancia del adapter para conservar los cambios mientras dure la sesión.
- La pantalla de inicio sustituirá el placeholder por una entrada breve a la gestión de usuarios.
- La pantalla de usuarios mostrará las cuentas, su estado, la acción disponible y el aviso de límites de permiso.

## Flujo de datos

Al entrar a Usuarios, el hook consultará el puerto y mostrará el estado correspondiente. Al solicitar una habilitación, el hook bloqueará nuevas pulsaciones para esa cuenta, invocará el puerto y actualizará la lista con el recibo devuelto. Si el adapter rechaza la operación, conservará el estado anterior, mostrará un mensaje controlado y permitirá reintentar.

El adapter tendrá al menos una cuenta pendiente que pueda habilitarse y otra cuenta que permita comprobar el error controlado. Todos los nombres y correos serán ficticios. La interfaz no solicitará ni mostrará datos que TI4-11 no necesita.

## Accesibilidad y permisos

Los estados se expresarán con texto y no dependerán sólo del color. Los botones tendrán nombre, estado deshabilitado y un área táctil coherente con la aplicación. Los mensajes de confirmación y error usarán semántica accesible. `RoleGuard` seguirá rechazando el acceso de otros roles a las rutas administrativas.

La pantalla mostrará de forma explícita que habilitar una cuenta institucional permite acceder al área de gestión, pero no concede acceso a acompañamientos. No habrá enlaces ni acciones hacia acompañamientos, notas internas o asignaciones de Practicantes.

## Pruebas y evidencia

Las pruebas cubrirán la navegación Inicio → Usuarios, la protección por rol, la carga de cuentas, la habilitación válida, el error controlado, el reintento y la prevención de operaciones duplicadas. También comprobarán el aviso sobre acompañamientos y la ausencia de acciones fuera de alcance.

La verificación final incluirá las pruebas de Mobile, TypeScript, `bun run lint`, `bun run format:check` y `cspell` sobre los textos modificados. El recorrido manual se hará en el Pixel 5 y dejará capturas de los casos válido y de error para la evidencia de cierre.

## Rama y Pull Request

La rama es `jmunoz/ti4-11-habilitacion-cuentas`. El título previsto de la PR es `TI4-11 - feat(mobile): administradores habilitan cuentas institucionales`.

El resumen previsto es: "El área administrativa sólo mostraba pantallas provisionales. Esta PR permite recorrer la habilitación simulada de una cuenta institucional, incluyendo un caso válido y un error controlado, y aclara que la habilitación no concede acceso a acompañamientos."
