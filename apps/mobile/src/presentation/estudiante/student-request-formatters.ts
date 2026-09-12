const weekdays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export function formatRequestDate(value: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function formatWeekdays(days: readonly number[]): string {
  return days.map((day) => weekdays[day] ?? "Día no especificado").join(", ");
}
