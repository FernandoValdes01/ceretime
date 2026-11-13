# Vocabulario de código

[CONTEXT.md](../CONTEXT.md) define los conceptos del producto en español. Esta tabla registra su nombre acordado en código para que web, mobile y backend hablen el mismo idioma; no redefine sus reglas de negocio.

| Concepto                    | Nombre en código | Evitar para el mismo concepto |
| --------------------------- | ---------------- | ----------------------------- |
| Practicante                 | `intern`         | `practitioner`                |
| Profesional                 | `professional`   |                               |
| Estudiante                  | `student`        |                               |
| Acompañamiento              | `accompaniment`  | `case`                        |
| Solicitud de acompañamiento | `request`        | `case`, `appointment`         |
| Atención                    | `appointment`    | `accompaniment`, `request`    |

Usa el nombre acordado en identificadores nuevos y revisa los consumidores al modificar un flujo. Existen nombres antiguos, incluido `practitioner` en web y variables de entorno de mobile: su presencia no cambia el término preferido ni autoriza a romper contratos existentes. Para cambiar un nombre persistido o público, acuerda una transición con los equipos afectados y comprueba sus consumidores. Si falta un término o dos nombres parecen referirse a conceptos distintos, aclara primero su significado en `CONTEXT.md` y acuerda su traducción aquí.
