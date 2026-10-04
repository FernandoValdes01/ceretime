# Evidencia del recorrido documental de TI4-46

Las capturas muestran la matriz inicial WCAG 2.2 A/AA en GitHub y la navegación desde el README de Mobile hasta una fuente de evidencia. Corresponden al cambio documental de [TI4-46](https://linear.app/ceretime/issue/TI4-46), sin añadir resultados de auditoría Android.

## Versión y entorno

- Fecha: 4 de octubre de 2026.
- Commit documental observado: `a7aab1752ae548124e8aa1cce863d42be759c8e7`.
- Base del inventario B0: `297ae38781f2a518bda1b772c9325ab328bd4427`.
- Navegador: Chrome `150.0.7871.224` sobre Linux, GitHub en modo oscuro y sin sesión iniciada.
- Área del navegador: 1600 × 900; capturas PNG: 1280 × 720. Se conservaron las imágenes entregadas por la herramienta de captura.

## Recorrido observado

1. Abrir el [README de Mobile de la versión observada](https://github.com/FernandoValdes01/ceretime/blob/a7aab1752ae548124e8aa1cce863d42be759c8e7/apps/mobile/README.md), localizar «Matriz de accesibilidad» y activar «matriz inicial WCAG 2.2 A/AA». El enlace abre el documento correspondiente.
2. Comprobar el título, la referencia B0 y el alcance A/AA de la [matriz mostrada en GitHub](https://github.com/FernandoValdes01/ceretime/blob/a7aab1752ae548124e8aa1cce863d42be759c8e7/apps/mobile/docs/accessibility/wcag-matrix.md).
3. Desplazarse a «Estudiante». Las filas muestran ruta, criterio/nivel, método, escenario, versión y resultado. Desplazar horizontalmente la tabla hacia la derecha permite leer «Evidencia disponible» y «Pendiente y tarea»; los ejemplos conservan No probado, el contexto histórico/parcial E18 y el seguimiento TI4-64.
4. En el registro E53, activar «Repetición final del foco». El enlace abre [la sección final de TI4-53](https://github.com/FernandoValdes01/ceretime/blob/a7aab1752ae548124e8aa1cce863d42be759c8e7/apps/mobile/docs/evidence/ti4-53/README.md#corrección-del-foco-tras-la-prueba-manual), donde se puede leer el hash final y los límites de esa ejecución.

| Captura                                                          | Qué muestra                                                                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [01. Entrada desde el README](01-readme-matriz.png)              | Enlace a la matriz y explicación de su alcance.                                                                              |
| [02. Alcance de la matriz](02-matriz-alcance.png)                | Título, versión B0, fuente única y alcance A/AA.                                                                             |
| [03. Criterios por pantalla](03-matriz-criterios.png)            | Primeras filas de Estudiante, métodos, versión y resultado.                                                                  |
| [04. Evidencia y pendientes](04-matriz-evidencia-pendientes.png) | Las mismas filas después del desplazamiento horizontal de 313 píxeles, con las columnas de evidencia y seguimiento visibles. |
| [05. Apertura de la fuente final](05-enlace-evidencia-final.png) | Destino del enlace E53, corrección de foco, hash final y pendientes nativos originales.                                      |

El [CI de la versión observada](https://github.com/FernandoValdes01/ceretime/actions/runs/37185047681) aprobó Lint y formato, Validación Mobile, Validación Web y Verificación Backend. Las comprobaciones del commit que incorpora estas capturas se registran en la PR.

Estas imágenes acreditan el recorrido documental. La captura de TI4-53 muestra un informe histórico; su contenido conserva la atribución y los límites originales. Las pruebas de TalkBack, teclado, contraste y demás criterios siguen el estado y las tareas de la matriz. Se revisaron las cinco imágenes antes de incorporarlas; solo muestran documentación pública del proyecto.
