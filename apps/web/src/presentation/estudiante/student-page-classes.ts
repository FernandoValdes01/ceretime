/**
 * Clases compartidas de las pantallas de solicitudes del Estudiante (TI2-149).
 *
 * El bloque de compatibilidad de `index.css` (TI2-130) centra el texto de
 * `#root` y fija tamaño, color, peso y márgenes de `h1` y `h2` fuera de las
 * capas de Tailwind, por lo que gana a las utilidades. Hasta que se migre,
 * estas pantallas alinean a la izquierda (DESIGN.md) y marcan como
 * importantes las utilidades de sus títulos.
 */
export const FOCUS_CLASS =
  "focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** Contenedor de página: una columna legible, alineada a la izquierda. */
export const PAGE_CLASS = "mx-auto flex w-full max-w-3xl flex-col gap-6 text-left";

export const HEADING_RESET_CLASS = "m-0! font-sans! tracking-normal!";
export const PAGE_TITLE_CLASS = `${HEADING_RESET_CLASS} text-[1.75rem]! leading-snug! font-semibold! text-primary! sm:text-[2rem]!`;
export const SECTION_TITLE_CLASS = `${HEADING_RESET_CLASS} text-xl! leading-snug! font-semibold! text-on-surface!`;

export const LINK_CLASS = `inline-flex min-h-[44px] w-fit items-center rounded-[0.5rem] py-2 font-semibold text-primary underline underline-offset-4 ${FOCUS_CLASS}`;
export const PRIMARY_LINK_CLASS = `inline-flex min-h-12 w-fit items-center justify-center rounded-[0.5rem] bg-primary-container px-6 py-2.5 font-semibold text-on-primary no-underline hover:bg-primary ${FOCUS_CLASS}`;
