import type { ReactNode, Ref } from "react";

/**
 * Fila de un detalle de gestión: término y valor de un `<dl>` (TI2-157).
 *
 * La comparten el detalle de la solicitud y el del acompañamiento para que
 * ambos se lean igual. El `<dl>` que las agrupa va dentro de un contenedor
 * `text-left`, porque `#root` centra el texto de toda la Web.
 *
 * `valueRef` permite llevar el foco al valor tras una acción, como el estado
 * de la solicitud; el foco llega solo por programa, no con Tab.
 */
export function DetailRow({
  label,
  valueRef,
  children,
}: {
  label: ReactNode;
  valueRef?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  return (
    <div className="py-3">
      <dt className="text-sm font-semibold text-on-surface">{label}</dt>
      {/* Las necesidades de acceso llegan unidas por saltos de línea. */}
      <dd
        ref={valueRef}
        tabIndex={valueRef === undefined ? undefined : -1}
        className="m-0 text-base whitespace-pre-line text-on-surface wrap-anywhere"
      >
        {children}
      </dd>
    </div>
  );
}
