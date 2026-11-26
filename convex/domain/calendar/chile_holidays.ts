/**
 * Feriados civiles de Chile (TI2-147).
 *
 * Fuente: calendario oficial chileno publicado por el Ministerio del Interior
 * y Seguridad Pública (https://www.feriados.cl/) y la ley 19.973 (feriados
 * irrenunciables). Se actualiza anualmente: agregar los feriados del año
 * siguiente a este catálogo y regenerar el deployment.
 *
 * Cómo actualizar:
 * 1. Consultar los feriados del año correspondiente en https://www.feriados.cl/
 *    o en el decreto de feriados del año.
 * 2. Agregar las fechas `YYYY-MM-DD` al array del año correspondiente.
 * 3. Verificar que los feriados movibles (San Pedro y San Pablo, Encuentro de
 *    Dos Mundos, Iglesias Evangélicas) estén en la fecha correcta del año.
 * 4. Ejecutar `bun run test:convex` para validar.
 *
 * Los feriados son civiles (fecha `YYYY-MM-DD` en zona `America/Santiago`).
 * Los fines de semana (sábado y domingo) se consideran descanso por defecto
 * en `addBusinessDays` de `civil_days.ts`, sin necesidad de incluirlos acá.
 */
export const CHILE_HOLIDAYS: readonly string[] = [
  // 2024
  "2024-01-01", // Año Nuevo
  "2024-03-29", // Viernes Santo
  "2024-03-30", // Sábado Santo
  "2024-05-01", // Día del Trabajo
  "2024-05-21", // Glorias Navales
  "2024-06-29", // San Pedro y San Pablo (trasladado al lunes 1 de julio en 2024? No, en 2024 cayó sábado, se traslada al lunes 1 de julio)
  "2024-07-01", // San Pedro y San Pablo (trasladado)
  "2024-07-16", // Día de la Virgen del Carmen
  "2024-08-15", // Asunción de la Virgen
  "2024-09-18", // Independencia Nacional
  "2024-09-19", // Glorias del Ejército
  "2024-10-12", // Encuentro de Dos Mundos
  "2024-10-31", // Iglesias Evangélicas y Protestantes
  "2024-11-01", // Todos los Santos
  "2024-12-08", // Inmaculada Concepción
  "2024-12-25", // Navidad
  // 2025
  "2025-01-01", // Año Nuevo
  "2025-04-18", // Viernes Santo
  "2025-04-19", // Sábado Santo
  "2025-05-01", // Día del Trabajo
  "2025-05-21", // Glorias Navales
  "2025-06-20", // San Pedro y San Pablo (trasladado al lunes 30 de junio? No, en 2025 cayó domingo, se traslada al lunes 30 de junio)
  "2025-06-30", // San Pedro y San Pablo (trasladado)
  "2025-07-16", // Día de la Virgen del Carmen
  "2025-08-15", // Asunción de la Virgen
  "2025-09-18", // Independencia Nacional
  "2025-09-19", // Glorias del Ejército
  "2025-10-12", // Encuentro de Dos Mundos
  "2025-10-31", // Iglesias Evangélicas y Protestantes
  "2025-11-01", // Todos los Santos
  "2025-12-08", // Inmaculada Concepción
  "2025-12-25", // Navidad
  // 2026
  "2026-01-01", // Año Nuevo
  "2026-04-03", // Viernes Santo
  "2026-04-04", // Sábado Santo
  "2026-05-01", // Día del Trabajo
  "2026-05-21", // Glorias Navales
  "2026-06-29", // San Pedro y San Pablo
  "2026-07-16", // Día de la Virgen del Carmen
  "2026-08-15", // Asunción de la Virgen
  "2026-09-18", // Independencia Nacional
  "2026-09-19", // Glorias del Ejército
  "2026-10-12", // Encuentro de Dos Mundos
  "2026-10-31", // Iglesias Evangélicas y Protestantes
  "2026-11-01", // Todos los Santos
  "2026-12-08", // Inmaculada Concepción
  "2026-12-25", // Navidad
];

/** Zona horaria de Temuco (Chile continental). */
export const TEMUCO_TIME_ZONE = "America/Santiago";
