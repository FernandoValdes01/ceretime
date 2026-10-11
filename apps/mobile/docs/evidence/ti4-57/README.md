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

## Verificación manual pendiente

TalkBack, el tamaño de texto al 100 % y al 200 %, y el contraste deben repetirse en Android con un build de este commit. No se generó ni instaló ese build y no se inició Expo, Metro ni un servidor de desarrollo, según `apps/mobile/AGENTS.md`; por tanto, esta entrega no acredita lectura audible ni conformidad WCAG general.

Al completar la comprobación, registrar dispositivo y versión de Android, SHA del build instalado, pasos por cada vista afectada y resultado audible/visual, incluyendo error y recuperación cuando corresponda.
