---
status: accepted
---

# Grupo mínimo y supresión complementaria en reportes agregados

El sistema aplica un tamaño mínimo de grupo de **5** por defecto en todos los reportes agregados de CERETI para evitar la identificación de personas en recuentos pequeños.

Administración puede configurar el umbral solo hacia arriba y nunca por debajo de 5. Cada modificación del umbral queda registrada en el historial del sistema con el actor resuelto en el servidor, el valor anterior, el valor nuevo y la fecha.

Cuando una celda queda oculta por estar por debajo del umbral (supresión primaria), el sistema aplica **supresión complementaria**: si en una fila, columna, vector de totales o subtotal derivado (cancelaciones o inasistencias) queda una sola celda oculta frente a un total visible, también se oculta otra celda o el total correspondiente para impedir que el valor suprimido se calcule por diferencia. La supresión de atenciones se calcula sobre todas las modalidades del periodo antes de proyectar el filtro de modalidad, evitando fugas al comparar filtros.

La pantalla y las exportaciones (CSV y JSON) se calculan desde la misma función de dominio, declaran siempre el periodo, la zona horaria (`America/Santiago`), los filtros aplicados, el umbral vigente y la metodología de cálculo, y nunca incluyen datos personales, notas internas ni necesidades de acceso. Cada exportación queda registrada en el servidor con el actor, formato, periodo, filtros, umbral y fecha.
