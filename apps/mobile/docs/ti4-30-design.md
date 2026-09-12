# TI4-30 — diseño del envío simulado

## Decisión

El envío de solicitudes se modela como una capacidad independiente de la lectura incorporada en TI4-29. La capa de aplicación define un puerto pequeño que recibe una solicitud provisional y devuelve un comprobante. La infraestructura aporta un adaptador mock y la presentación consume el puerto mediante un hook inyectable.

## Flujo

El formulario conserva la validación de TI4-8. Cuando los campos son válidos, crea una copia de los datos y comienza el envío. El hook expone los estados `idle`, `submitting`, `error` y `success`, además de la operación protegida de envío. Una guarda inmediata impide iniciar dos promesas aunque se pulse la acción más de una vez antes del siguiente render.

Durante el envío, los controles quedan deshabilitados y la acción comunica su estado. Un error mantiene los campos, permite corregirlos y reconstruye el comando con los valores visibles al reintentar. Un resultado exitoso reemplaza el formulario por una confirmación con un identificador ficticio; no se crea una ruta nueva ni se persisten datos.

## Límites

- El adaptador no llama a Convex ni reproduce reglas del backend.
- Los datos y comprobantes son ficticios y viven solamente en memoria.
- El modo normal del adaptador confirma la solicitud. Para demostrar la recuperación ante errores en Expo, `EXPO_PUBLIC_STUDENT_REQUEST_DEMO_MODE=fail-once` hace que falle el primer intento y que el reintento confirme la misma solicitud.
- La configuración del escenario ocurre en la raíz de composición. La interfaz del estudiante y el hook no leen variables de entorno ni incluyen controles especiales para pruebas.
- El contrato es provisional y podrá reemplazarse cuando TI2 publique el contrato canónico.

## Contrato provisional

El comando de envío representa cada necesidad de acceso con `AccessNeed`, el mismo tipo usado por la proyección de solicitudes. La presentación conserva el identificador estable y la etiqueta visible; un futuro adaptador de TI2 podrá mapear ambos campos sin depender del texto mostrado en pantalla.

## Verificación

Las pruebas cubren validación, transición de envío a confirmación, fallo único configurable, conservación de datos, reintento y prevención de envíos duplicados. El recorrido manual ejecuta el modo normal y `fail-once` en Expo, registra el estado de envío, el error, el reintento y la confirmación. También se ejecutan el chequeo de tipos, lint y formato del repositorio.
