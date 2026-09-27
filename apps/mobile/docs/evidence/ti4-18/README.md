# Evidencia de TI4-18

Validación de [TI4-18](https://linear.app/ceretime/issue/TI4-18/autenticacion-mobile-validacion-de-redirecciones) sobre `41a50f8`, con el Pixel 5 gestionado por `android-pixel-5`, Android 15 (API 35) y la sesión simulada de Mobile.

| Caso                                   | Resultado                                                                       | Evidencia                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Inicio sin sesión                      | Abre el selector de roles.                                                      | [login.png](login.png)                                           |
| Estudiante                             | Redirige a Inicio de Estudiante.                                                | [estudiante.png](estudiante.png)                                 |
| Profesional                            | Redirige a la Agenda profesional.                                               | [profesional.png](profesional.png)                               |
| Practicante asignado                   | Redirige a Acompañamientos asignados.                                           | [practicante.png](practicante.png)                               |
| Administrador                          | Redirige a Inicio de Administrador.                                             | [administrador.png](administrador.png)                           |
| Practicante sin asignación             | Muestra Sin asignaciones y Acceso denegado.                                     | [practicante-sin-asignacion.png](practicante-sin-asignacion.png) |
| Acceso sin sesión a una ruta protegida | Vuelve al login para los cuatro roles.                                          | `navigation.test.tsx`                                            |
| Acceso a la ruta de otro rol           | Vuelve al inicio propio, muestra Acceso denegado y no revela la pantalla ajena. | `navigation.test.tsx`                                            |
| Logout                                 | Limpia la sesión, vuelve al login y no conserva historial protegido.            | `authentication.test.tsx` y `navigation.test.tsx`                |
| Error de logout                        | Conserva la sesión y permite reintentar.                                        | `authentication.test.tsx`                                        |

`bun run --cwd apps/mobile test -- --runTestsByPath __tests__/authentication.test.tsx __tests__/navigation.test.tsx`: 2 suites y 23 pruebas aprobadas.

Las capturas muestran el cliente de desarrollo con su botón flotante de herramientas. Ese botón cubre la acción de salida en el emulador; por ello, el logout y el retorno al login se comprobaron mediante las pruebas de rutas reales de Expo Router. No se detectó una corrección necesaria en la navegación o la sesión simulada.
