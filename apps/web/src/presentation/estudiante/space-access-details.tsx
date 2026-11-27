import type { SpaceFields } from "../../../../../convex/domain/index.ts";

/**
 * Ubicación y acceso de una sala o de un canal presencial (TI2-163).
 *
 * Muestra los mismos campos del catálogo de espacios (TI2-87) que entrega el
 * Backend: condiciones de acceso e instrucciones de llegada y, cuando la
 * pantalla no muestra ya la sala, el lugar (campus, edificio, piso y sala). Es
 * una lista de definiciones para que el lector de pantalla anuncie cada dato
 * con su nombre; los textos llegan escritos para leerse en voz alta y no se
 * resumen.
 */
export function SpaceAccessDetails({
  space,
  includePlace,
}: {
  space: SpaceFields;
  /** Falso cuando la pantalla ya muestra la sala, para no repetirla. */
  includePlace: boolean;
}) {
  return (
    <dl className="m-0 grid gap-3">
      {includePlace ? (
        <AccessRow label="Lugar">
          {space.campus}, {space.building}, {space.floor}, {space.room}
        </AccessRow>
      ) : null}
      <AccessRow label="Condiciones de acceso">{space.accessConditions}</AccessRow>
      <AccessRow label="Instrucciones de llegada">{space.arrivalInstructions}</AccessRow>
    </dl>
  );
}

function AccessRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-on-surface">{label}</dt>
      <dd className="m-0 text-base leading-relaxed text-on-surface">{children}</dd>
    </div>
  );
}
