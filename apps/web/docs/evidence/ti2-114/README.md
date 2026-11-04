# TI2-114: lista web de atenciones propias y estados de inasistencia

Issue: [TI2-114](https://linear.app/ceretime/issue/TI2-114). PR abierta en draft al iniciar la issue sobre `main` `53c41eb2...` (incluye la integración de TI2-113 vía #145 y de TI2-122). Este registro declara el alcance del cierre y queda como carpeta de evidencia; en este punto nada está implementado todavía.

## Alcance acordado con la issue

- Lista de atenciones propias del Estudiante con datos ficticios declarados como fixtures del escenario y DTO común (contrato de TI2-100), en `apps/web/src/presentation/estudiante/` y reutilizando el puerto de agenda compartido de TI2-101/TI2-113.
- Realización, cancelación e inasistencia distinguibles por texto y por estados accesibles, junto con los estados de carga, vacío, fallo y denegación, sin depender solo del color.
- Punto de integración con lo ya presente en `main`: la sección «Atenciones del acompañamiento y acciones de calendario» de TI2-122 (`apps/web/src/presentation/estudiante/student-appointments.tsx` con sus hooks en `student-accompaniments-data.ts` y etiquetas en `agenda-labels.ts`). La lista de esta issue se integra con esa base y la extiende con realización, cancelación e inasistencia; no crea una segunda lista paralela del mismo flujo.
- Detalle de la atención con navegación desde la lista, sin crear un archivo por estado ni estructuras paralelas.
- Documentación del contrato de lectura que TI2-112 publicará y TI2-123 conectará reutilizando esta lista y su detalle.

## Límites que respeta el alcance

- El plazo de cinco días hábiles pertenece a TI2-94 y no se calcula ni inventa en React.
- La presentación y revisión de justificaciones es TI2-119; queda fuera de alcance.
- No se copia la agenda del Profesional (TI2-115) ni se consume API real de agenda profesional.
- No se toca `apps/mobile/` ni `convex/`: solo presentación, puerto y adaptador Web.

## Evidencia pendiente al cierre

- Recorrido por teclado y capturas en escritorio y móvil de carga, vacío, fallo, denegación y los estados de atención.
- Resultados de `bun run lint`, `bun run format:check`, `bun run test:web` y `bun run --cwd apps/web build` (el build ejecuta `tsc -b`).
- `cspell` sin hallazgos en los textos modificados, con `@cspell/dict-es-es`.
- SHAs de los commits, comandos ejecutados y observaciones de revisión de TI4 resueltas.
