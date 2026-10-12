# Evidencia de accesibilidad de gestión, TI4-57

Issue: [TI4-57](https://linear.app/ceretime/issue/TI4-57/corregir-nombres-estados-y-alternativas-a-gestos-en-vistas-de). Hallazgos auditados: [TI4-48](../ti4-48/README.md). Este documento vincula cada hallazgo con el cambio de interfaz y las comprobaciones realizadas.

## Cambios y comprobaciones

| Hallazgo | Cambio                                                                                                                                           | Comprobación automatizada                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| H1       | La tarjeta del Practicante anuncia objetivo y estado en un solo botón; la insignia anidada deja de duplicar el anuncio.                          | `practitioner-accompaniments.test.tsx` comprueba el nombre y la ruta al detalle.                            |
| H2       | Las etiquetas largas de pestañas admiten un salto visual y mantienen el nombre accesible completo.                                               | `navigation.test.tsx` comprueba las etiquetas visibles y los nombres de pestaña.                            |
| H3       | Los reintentos de Solicitudes, Acompañamientos y detalle conservan su estilo visible y área mínima de 44 dp al excluir la interop CSS del botón. | `professional-accompaniments.test.tsx` comprueba los estilos y activa ambos reintentos.                     |
| H4       | La acción conserva su nombre durante la carga; el indicador se añade junto al texto y se mantienen los estados ocupado e inhabilitado.           | `professional-review.test.tsx` mantiene la promesa pendiente y comprueba el nombre, ocupado e inhabilitado. |
| H5       | Al pasar a En revisión, el resultado visible recibe el foco de accesibilidad sin depender de encontrar el nuevo estado manualmente.              | `professional-review.test.tsx` comprueba el mensaje y el evento de foco.                                    |
| H6       | Al habilitar una cuenta, el foco pasa al mensaje de éxito después de desaparecer el botón.                                                       | `administrator-accounts.test.tsx` comprueba el mensaje, el estado único y el evento de foco.                |
| H7       | Al abrir el detalle del Practicante, el encabezado recibe el foco y evita conservar el indicio de abrir la tarjeta anterior.                     | `practitioner-accompaniments.test.tsx` comprueba la navegación y el evento de foco.                         |
| H8       | El estado de la cuenta se agrupa en un único nodo con etiqueta accesible.                                                                        | `administrator-accounts.test.tsx` comprueba el nodo y oculta su texto descendiente del lector.              |
| H9       | La inicial decorativa del avatar queda fuera del recorrido accesible; nombre y correo permanecen visibles.                                       | `administrator-accounts.test.tsx` comprueba que la inicial no sea accesible.                                |

## Resultado automatizado

`bun run --cwd apps/mobile test --runTestsByPath __tests__/professional-review.test.tsx __tests__/professional-accompaniments.test.tsx __tests__/practitioner-accompaniments.test.tsx __tests__/administrator-accounts.test.tsx`: las cuatro suites y sus 40 pruebas pasan.

`bun run --cwd apps/mobile test --runTestsByPath __tests__/navigation.test.tsx`: la suite y sus 19 pruebas pasan.

La salida de Jest incluye avisos existentes de actualizaciones asíncronas del proveedor de preferencias fuera de `act`; no impiden que las suites terminen correctamente.

## Verificación Android nativa

- Dispositivo: Samsung Galaxy S23 (`SM-S911B`), Android 16, API 36; TalkBack 16.2.00.12 con voz en español; escala del sistema restaurada a 100 % al terminar.
- Cliente `cl.rmv.ceretime.qa`, versión 1.0.0; binario nativo compilado desde `641c967173f5acc02032a51ec0e35ce48431891a`, SHA-256 `b2dbe2bb281224ab59970294867306be416795a05fa43409c80af5f593eb09da` y JavaScript servido por Metro desde el árbol integrado.
- Practicante: las tarjetas se exponen como botones cuyo nombre reúne objetivo y estado; con TalkBack abrí una tarjeta por doble toque y llegué al encabezado «Detalle del acompañamiento». Los estados Activo, En pausa y Cerrado aparecen como texto.
- Profesional: la lista presenta cada solicitud como una acción con identificador y estado; en SOL-PRO-001 activé «Poner en revisión» con TalkBack y el resultado mostró «Estado: En revisión» junto con las acciones siguientes.
- Administrador: la lista expone el estado como un grupo etiquetado y el botón incluye el nombre de la persona; con TalkBack activé una cuenta y apareció «Cuenta habilitada» junto con el mensaje de resultado.
- Escala ampliada: seleccioné 200 % desde preferencias y comprobé la agenda/solicitudes profesionales, las tarjetas del Practicante y la lista del Administrador; los textos crecieron, las listas pudieron desplazarse y sus acciones conservaron nombres accesibles. A 100 % también probé las acciones y los cambios de estado anteriores.
- El centro común se abrió desde Estudiante, Profesional, Practicante y Administrador; probé 100 %, 150 % y 200 %, contraste activado/desactivado y las opciones de movimiento. El valor 150 % sobrevivió al cierre forzado y reapertura y se compartió al cambiar entre Administrador y Estudiante.
- La activación de cuenta y el cambio de solicitud modificaron solo datos ficticios del cliente `.qa`; el cliente se desinstaló al acabar, sin alterar la aplicación institucional.
- No se grabó el audio de TalkBack; las pruebas confirman la navegación e interacción con el lector y el árbol expone nombre, rol y estado. Esta comprobación no declara conformidad WCAG general ni cubre todas las combinaciones de error.

## Resultado

La pasada nativa cubre H1, H5, H6, H7 y H8 en sus flujos principales; H2, H3, H4 y H9 siguen respaldados por las pruebas automatizadas y la inspección de código descritas arriba, sin una comprobación táctil individual en este dispositivo.
