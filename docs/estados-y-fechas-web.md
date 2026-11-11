---
created: 2026-11-11T00:00
updated: 2026-11-11T00:00
---

# Estados de vista y formato de fechas de la Web

Documenta las piezas comunes incorporadas en TI2-134: los cuatro estados de vista, el formato único de fechas en `America/Santiago` y la validación de fechas reales en formularios. Estas piezas viven en `apps/web/src/presentation/shared/` y no reemplazan los componentes visuales de `DESIGN.md` ni contienen reglas de negocio.

## Estados de vista

`view-states.tsx` expone cuatro componentes con un solo lenguaje y los estilos de `view-states.css`:

| Componente | Cuándo se usa | Anuncio |
| --- | --- | --- |
| `LoadingState` | La lectura todavía no responde y la vista no puede mostrar datos | `role="status"` |
| `EmptyState` | La lectura terminó sin datos, con una explicación y el siguiente paso | `role="status"` |
| `ErrorState` | La operación falló y se puede reintentar | `role="alert"` |
| `DeniedState` | El Backend negó el acceso sin revelar el motivo | `role="alert"` |

Cada estado comunica en texto qué ocurre y cómo seguir. Ninguno depende solo del color: el error suma borde izquierdo y negrita, el vacío usa un borde superior y la denegación un borde superior sobre el fondo de error. `ErrorState` solo ofrece «Reintentar» cuando recibe `onRetry`: una pantalla sin reintento no muestra una acción falsa.

`DeniedState` usa por defecto `ACCESS_DENIED_MESSAGE`, el aviso genérico acordado con el Backend. Se puede reemplazar el título cuando la pantalla tiene un aviso propio, como el Practicante, y la descripción queda fuera del `role="alert"` para que el anuncio sea el título y no el texto completo.

Ejemplo de uso:

```tsx
if (result === undefined) {
  return <LoadingState label="Cargando la agenda…" />;
}

if (result.status === "error") {
  return <ErrorState message={result.message} onRetry={onRetry} />;
}

if (result.status === "denied") {
  return <DeniedState />;
}

if (result.status === "empty") {
  return (
    <EmptyState title="No tienes atenciones agendadas.">
      <p>Cuando se reserve una atención contigo, aparecerá aquí.</p>
    </EmptyState>
  );
}
```

Los selectores `.student-portal__loading`, `.student-portal__error`, `.student-portal__empty` y `.student-portal__empty-title` siguen definidos en `view-states.css` como alias de las mismas reglas, porque el resto de las pantallas todavía no migra. Al tocar una pantalla nueva, usa los componentes compartidos y no agregues reglas paralelas.

## Formato de fechas y horas

`date-format.ts` es la única fuente del formato de la agenda. Lee los instantes en `AGENDA_TIME_ZONE` (`America/Santiago`, definida en el Dominio) y no en la zona del navegador: un cupo publicado para las 10:00 se ve a las 10:00 aunque la persona abra la Web desde otra zona. Los textos que muestran una hora incluyen `(America/Santiago)` para que el dato no dependa de una convención oculta.

| Función | Resultado |
| --- | --- |
| `formatAgendaDate` | `martes, 12 de mayo de 2026` |
| `formatAgendaTime` | `10:00 a. m.` |
| `formatAgendaTimeRange` | `10:00 a. m. – 11:00 a. m.` |
| `formatAgendaDateTime` | `martes, 12 de mayo de 2026, 10:00 a. m. – 11:00 a. m. (America/Santiago)` |
| `formatAgendaInstant` | `martes, 12 de mayo de 2026, 10:00 a. m. (America/Santiago)` |

Las fechas civiles (`YYYY-MM-DD`) no representan un instante y se leen en UTC para que la zona del navegador no las mueva de día: `formatCivilDay`, `formatCivilDate`, `formatCivilDateWithYear` y `formatCivilDateRange`.

`agenda-labels.ts` y `gestion-labels.ts` conservan sus nombres exportados (`formatSlotDateTime`, `formatAppointmentDateTime`, `formatAppointmentInstant`, `formatAppointmentDate`, `formatAppointmentTime` y `formatAppointmentTimeRange`) como delegados del módulo compartido. Así las pantallas y sus pruebas no cambian de contrato mientras el formato se centraliza.

Toda pantalla nueva muestra la zona vigente donde presenta horas de la agenda. La agenda del Profesional lo declara en la introducción y en una fila «Zona horaria» del detalle.

## Validación de fechas reales

`civilDateIssue` distingue dos problemas al revisar una fecha escrita a mano:

- `"format"`: no tiene la forma `AAAA-MM-DD`, con mes y día de dos dígitos.
- `"impossible"`: tiene la forma correcta, pero no existe en el calendario (29 de febrero de un año común, 31 de abril, mes 13).

`civilDateIssue` devuelve `null` cuando la fecha es real, y `isValidCivilDate` responde el caso booleano. El editor de disponibilidad usa `dateFieldError` para mostrar «Usa una fecha válida con formato AAAA-MM-DD.» o «Esa fecha no existe en el calendario.», según corresponda.

## Pantallas de ejemplo migradas

Una pantalla por rol usa ya las piezas comunes:

| Rol | Pantalla | Estados migrados |
| --- | --- | --- |
| Estudiante | `estudiante/student-appointments-page.tsx` | Carga, error con reintento, denegación, vacío y aviso de sala sin resolver |
| Profesional | `gestion/professional-agenda.tsx` | Carga, error con reintento, denegación, vacío y zona horaria visible |
| Practicante | `gestion/practitioner-accompaniments.tsx` | Carga, vacío, denegación en lista y detalle |
| Administrador | `gestion/admin-space-editor.tsx` | Carga, error con reintento, denegación y catálogo vacío |

El resto de las pantallas de `estudiante/` y `gestion/` se migra al tocarlas, según el alcance de la issue; la revisión final de la Web comprueba que no queden representaciones paralelas.

## Accesibilidad

- La carga y el vacío usan `role="status"`; el error y la denegación usan `role="alert"`.
- La denegación no revela motivo ni existencia del recurso.
- Los mensajes usan texto además del color y los botones conservan al menos 44 × 44 px de objetivo táctil y foco visible de 3 px.

## Pruebas

- `shared/date-format.test.ts` cubre el cambio de hora de Chile (septiembre y abril) y el cambio de año, además de las fechas civiles y la validación de fechas reales.
- `shared/view-states.test.tsx` cubre los anuncios, el reintento y la denegación.
- `professional-availability-editor.test.tsx` comprueba que una fecha imposible no se acepta.

## Validación

Desde la raíz del repositorio:

```powershell
bun run --cwd apps/web lint
bun run test:web
bun run --cwd apps/web build
bun run lint
bun run format:check
```

Para los textos cambiados:

```powershell
bunx --package cspell --package @cspell/dict-es-es cspell lint --no-progress <archivos cambiados>
```
