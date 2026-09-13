# Evidencia nativa de TI4-19

Recorrido ejecutado el 13 de septiembre de 2026 sobre el commit de implementación `6bf499b1d5c8dfbb109f993c95667c67843f5802`, sin cambios locales de código, en el AVD `Pixel_5_Liviano` con Android 15, API 35, y una compilación de desarrollo de Expo. Los escenarios se activaron únicamente mediante `EXPO_PUBLIC_STUDENT_AREA_DEMO_MODE` y `EXPO_PUBLIC_STUDENT_AREA_DELAY_MS`.

## Carga

Con el modo `success` y una demora de 5000 ms, el acceso desde **Inicio de Estudiante** mostró el indicador y el mensaje de carga antes de presentar los datos.

![Estado de carga](./loading.png)

## Éxito y navegación al detalle

El listado presentó dos solicitudes del snapshot del estudiante. La jerarquía de accesibilidad expuso cada tarjeta como una única acción con referencia, necesidad y fecha de envío. Al activar la primera tarjeta se abrió su detalle y se comprobaron la referencia, las fechas de envío y actualización, la necesidad, el resultado esperado, las necesidades de acceso, la modalidad y el canal accesible preferido.

![Listado con solicitudes](./success.png)

![Inicio del detalle](./detail.png)

![Continuación del detalle](./detail-continuacion.png)

El detalle no expuso disponibilidad, franja horaria, estado de la solicitud ni resultado del acompañamiento, elementos reservados para otras issues.

## Vacío

Con el modo `empty`, el listado mostró una explicación y la acción **Crear nueva solicitud** sin presentar tarjetas ficticias.

![Estado vacío](./empty.png)

## Error y reintento

Con el modo `error`, el listado presentó un error recuperable y la acción **Reintentar**. La acción volvió a ejecutar la lectura y conservó el error esperado del escenario configurado.

![Estado de error](./error.png)

## Resultado

El recorrido Listado → Detalle y los estados de carga, vacío, error y éxito quedaron aprobados en el emulador. La comprobación automatizada complementaria cubre el reintento, la recuperación ante identificadores desconocidos y la protección de rutas por rol. El commit posterior que incorpora este registro modifica solo documentación y evidencia.
