# TI4-30 — diseño del envío simulado

## Decisión

El envío de solicitudes se modela como una capacidad independiente de la lectura incorporada en TI4-29. La capa de aplicación define un puerto pequeño que recibe una solicitud provisional y devuelve un comprobante. La infraestructura aporta un adaptador mock y la presentación consume el puerto mediante un hook inyectable.

## Flujo

El formulario conserva la validación de TI4-8. Cuando los campos son válidos, crea una copia de los datos y comienza el envío. El hook expone los estados `idle`, `submitting`, `error` y `success`, además de una operación de reintento. Una guarda inmediata impide iniciar dos promesas aunque se pulse la acción más de una vez antes del siguiente render.

Durante el envío, la acción queda deshabilitada y comunica su estado. Un error mantiene los campos y permite reenviar la misma copia. Un resultado exitoso reemplaza el formulario por una confirmación con un identificador ficticio; no se crea una ruta nueva ni se persisten datos.

## Límites

- El adaptador no llama a Convex ni reproduce reglas del backend.
- Los datos y comprobantes son ficticios y viven solamente en memoria.
- Los errores se controlan mediante dependencias inyectadas en las pruebas, no mediante controles ocultos o especiales en la interfaz del estudiante.
- El contrato es provisional y podrá reemplazarse cuando TI2 publique el contrato canónico.

## Verificación

Las pruebas cubren validación, transición de envío a confirmación, rechazo, conservación de datos, reintento y prevención de envíos duplicados. También se ejecutan el chequeo de tipos, lint y formato del repositorio.
