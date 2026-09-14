# Consistencia del encabezado mobile

## Objetivo

Unificar la presentación de encabezados entre las vistas Mobile de CERETI y el patrón aplicado por la rama `fvaldes2023/ti4-7-auth`, sin reintroducir títulos duplicados en el listado y detalle de solicitudes.

## Decisión

La aplicación usará una configuración compartida de header nativo con la marca `CERETIME`, colores comunes y navegación de regreso coherente. `Screen` y `StudentScreen` dejarán de dibujar una marca adicional dentro del contenido. Las rutas de solicitudes conservarán sus títulos nativos específicos, de modo que `Mis solicitudes` y `Detalle de solicitud` continúen apareciendo una sola vez.

El formulario de nueva solicitud mantendrá el regreso nativo visible. Las áreas de contenido seguirán ubicadas debajo del header nativo, por lo que conservarán el ajuste de área segura compatible con esta estructura.

## Alcance

- Centralizar opciones visuales y de navegación del header.
- Aplicar esas opciones a los layouts públicos y protegidos.
- Retirar las marcas internas redundantes de los componentes de pantalla.
- Mantener el contenido, los estados y la navegación de TI4-19.
- Actualizar pruebas y evidencia visual afectadas.

## Fuera de alcance

No se modifican contratos de datos, estados de solicitudes, autenticación, backend ni el contenido funcional del formulario.

## Verificación

Se ejecutarán las pruebas Mobile, typecheck, lint, formato y CSpell. El recorrido en Pixel 5 confirmará que las vistas comparten header, que el regreso del formulario es visible y que listado y detalle mantienen un único título.
