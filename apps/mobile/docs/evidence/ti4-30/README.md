# Evidencia nativa de TI4-30

Recorrido ejecutado el 11 de septiembre de 2026 en un Samsung SM-S911B con Android 16 y Expo Go. El dispositivo se conectó por USB. Se ejecutó una sesión sin variables para el modo normal y otra con `EXPO_PUBLIC_STUDENT_REQUEST_DEMO_MODE=fail-once`.

Las capturas de los escenarios funcionales se tomaron sobre el commit `6120e1aba1985cb5e0edb2aa1dbdada1f8d6e72a`. La verificación visual posterior de los cambios de presentación se ejecutó sobre `57ce5145de1bcf8ddf99c498cc9ee6f3b6eb94db`.

## Verificación manual de accesibilidad

El 12 de septiembre de 2026 se recorrió el formulario sobre el head de implementación `b3330229ca005c176d832370ebdc7765d763ce8a`, sin cambios locales, en el AVD `Pixel_5_Liviano` con Android 15, API 35, y TalkBack 15.0.0.639625893. TalkBack permaneció enlazado con exploración táctil y salida hablada mediante Google TTS; la navegación se realizó con foco secuencial y activación por teclado usando las flechas y Enter. La sesión usó `EXPO_PUBLIC_STUDENT_REQUEST_DEMO_MODE=fail-once` para recorrer el error y el reintento sin conectar un backend.

| Estado            | Resultado manual con TalkBack                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Envío             | Aprobado. Al activar `Enviar solicitud`, TalkBack recibió el anuncio de envío; el formulario pasó a estado no editable y sus controles quedaron deshabilitados mientras se resolvía la operación. |
| Error y reintento | Aprobado. El mensaje `No pudimos enviar la solicitud ficticia` recibió el foco, los datos permanecieron en el formulario y `Reintentar envío` se alcanzó y activó en el orden de foco.            |
| Confirmación      | Aprobado. TalkBack recibió el anuncio de solicitud enviada; el encabezado `Solicitud enviada`, el texto explicativo y la referencia `SOL-DEMO-001` quedaron disponibles en el recorrido de foco.  |

Resultado general: aprobado sin bloqueos de foco ni controles inaccesibles. El commit posterior que incorpora este registro modifica solo documentación; el código móvil verificado corresponde al hash indicado arriba.

## Modo normal

Sin la variable de escenario, el primer envío confirmó la solicitud como `SOL-DEMO-001`.

![Confirmación en el modo normal](./success-default.png)

## Error controlado

El primer intento mostró el error y conservó los valores del formulario. La acción de reintento quedó disponible.

![Error controlado con datos conservados](./error.png)

## Estado de envío y doble pulsación

En un segundo formulario se pulsó dos veces la acción durante los 600 ms del adaptador. La acción mostró `Enviando solicitud…`, quedó deshabilitada y la guarda del hook mantuvo una sola operación activa.

![Acción deshabilitada durante el envío](./sending.png)

## Confirmación

El reintento del primer formulario produjo `SOL-DEMO-001`. El segundo formulario, después de la doble pulsación, produjo solamente `SOL-DEMO-002`; no apareció un tercer comprobante.

![Confirmación posterior a la doble pulsación](./confirmation-after-double-tap.png)
