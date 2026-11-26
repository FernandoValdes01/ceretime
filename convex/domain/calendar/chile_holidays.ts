/**
 * Feriados civiles de Chile (TI2-147).
 *
 * Fuente verificable: la base legal de la Biblioteca del Congreso Nacional
 * (LeyChile, https://www.bcn.cl/leychile) y el Diario Oficial. Las fechas
 * movibles se derivan de las leyes vigentes, no de un calendario privado:
 * - Ley 2.977: feriados generales (Año Nuevo, Semana Santa, 1 de mayo,
 *   21 de mayo, 15 de agosto, 18 y 19 de septiembre, 1 de noviembre,
 *   8 y 25 de diciembre).
 * - Ley 19.973: feriados irrenunciables (1 de enero, 1 de mayo, 18 y 19 de
 *   septiembre, 25 de diciembre).
 * - Ley 19.668: San Pedro y San Pablo (29 de junio) y Encuentro de Dos Mundos
 *   (12 de octubre) se trasladan al lunes de la misma semana si caen martes,
 *   miércoles o jueves, y al lunes siguiente si caen viernes. Si caen sábado
 *   o domingo NO se trasladan.
 * - Ley 20.148: Virgen del Carmen, 16 de julio.
 * - Ley 20.299: Iglesias Evangélicas y Protestantes, 31 de octubre, con
 *   traslado propio (al viernes de la semana si cae miércoles, al viernes
 *   anterior si cae martes).
 * - Ley 20.983: viernes 17 de septiembre cuando el 18 y 19 caen sábado y
 *   domingo.
 * - Ley 21.357: Día Nacional de los Pueblos Indígenas, día del solsticio de
 *   invierno (20 o 21 de junio según el año), sin traslado.
 *
 * Cómo actualizar:
 * 1. Consultar las leyes indicadas en LeyChile para el año siguiente y
 *    contrastar cada fecha, en especial las movibles.
 * 2. Agregar las fechas `YYYY-MM-DD` al array del año correspondiente.
 * 3. Ejecutar `bun run test:convex`: las pruebas de plazo fallan si el
 *    catálogo no cubre el año siguiente o si falta un feriado que mueve
 *    el vencimiento.
 *
 * Las fechas son civiles en zona `America/Santiago` (zona de la agenda).
 * Sábados y domingos ya se excluyen en `addBusinessDays` de `civil_days.ts`;
 * se listan igual para que el catálogo coincida con la fuente.
 */
export const CHILE_HOLIDAYS: readonly string[] = [
  // 2024 — solsticio 20 de junio; San Pedro y San Pablo cae sábado (sin traslado).
  "2024-01-01", // Año Nuevo
  "2024-03-29", // Viernes Santo
  "2024-03-30", // Sábado Santo
  "2024-05-01", // Día del Trabajo
  "2024-05-21", // Glorias Navales
  "2024-06-20", // Pueblos Indígenas (solsticio)
  "2024-06-29", // San Pedro y San Pablo (sábado, sin traslado)
  "2024-07-16", // Virgen del Carmen
  "2024-08-15", // Asunción de la Virgen
  "2024-09-18", // Independencia Nacional
  "2024-09-19", // Glorias del Ejército
  "2024-10-12", // Encuentro de Dos Mundos (sábado, sin traslado)
  "2024-10-31", // Iglesias Evangélicas y Protestantes
  "2024-11-01", // Todos los Santos
  "2024-12-08", // Inmaculada Concepción
  "2024-12-25", // Navidad
  // 2025 — solsticio 20 de junio; San Pedro y San Pablo cae domingo (sin traslado).
  "2025-01-01", // Año Nuevo
  "2025-04-18", // Viernes Santo
  "2025-04-19", // Sábado Santo
  "2025-05-01", // Día del Trabajo
  "2025-05-21", // Glorias Navales
  "2025-06-20", // Pueblos Indígenas (solsticio)
  "2025-06-29", // San Pedro y San Pablo (domingo, sin traslado)
  "2025-07-16", // Virgen del Carmen
  "2025-08-15", // Asunción de la Virgen
  "2025-09-18", // Independencia Nacional
  "2025-09-19", // Glorias del Ejército
  "2025-10-12", // Encuentro de Dos Mundos (domingo, sin traslado)
  "2025-10-31", // Iglesias Evangélicas y Protestantes
  "2025-11-01", // Todos los Santos
  "2025-12-08", // Inmaculada Concepción
  "2025-12-25", // Navidad
  // 2026 — solsticio 21 de junio (domingo); San Pedro y San Pablo cae lunes 29.
  "2026-01-01", // Año Nuevo
  "2026-04-03", // Viernes Santo
  "2026-04-04", // Sábado Santo
  "2026-05-01", // Día del Trabajo
  "2026-05-21", // Glorias Navales
  "2026-06-21", // Pueblos Indígenas (solsticio)
  "2026-06-29", // San Pedro y San Pablo (lunes)
  "2026-07-16", // Virgen del Carmen
  "2026-08-15", // Asunción de la Virgen
  "2026-09-18", // Independencia Nacional
  "2026-09-19", // Glorias del Ejército
  "2026-10-12", // Encuentro de Dos Mundos (lunes)
  "2026-10-31", // Iglesias Evangélicas y Protestantes
  "2026-11-01", // Todos los Santos
  "2026-12-08", // Inmaculada Concepción
  "2026-12-25", // Navidad
  // 2027 — solsticio 21 de junio; 29 de junio y 12 de octubre caen martes y
  // se trasladan al lunes; 18 y 19 de septiembre caen fin de semana, así que
  // la Ley 20.983 agrega el viernes 17.
  "2027-01-01", // Año Nuevo
  "2027-03-26", // Viernes Santo
  "2027-03-27", // Sábado Santo
  "2027-05-01", // Día del Trabajo
  "2027-05-21", // Glorias Navales
  "2027-06-21", // Pueblos Indígenas (solsticio)
  "2027-06-28", // San Pedro y San Pablo (trasladado del martes 29)
  "2027-07-16", // Virgen del Carmen
  "2027-08-15", // Asunción de la Virgen
  "2027-09-17", // Fiestas Patrias adicional (Ley 20.983)
  "2027-09-18", // Independencia Nacional
  "2027-09-19", // Glorias del Ejército
  "2027-10-11", // Encuentro de Dos Mundos (trasladado del martes 12)
  "2027-10-31", // Iglesias Evangélicas y Protestantes
  "2027-11-01", // Todos los Santos
  "2027-12-08", // Inmaculada Concepción
  "2027-12-25", // Navidad
];
