import { useSyncExternalStore } from "react";
import { ConvexError } from "convex/values";

/**
 * Estado de la creación del perfil propio por correo (TI2-182).
 *
 * Vive fuera de los componentes porque lo comparten el par sesión y rol, que
 * pide el perfil, y el portal del Estudiante, que debe distinguir un fallo
 * pasajero de una cuenta no habilitada y ofrecer el reintento sin desmontar
 * su layout. No importa el cliente de Convex: recibe la mutation de quien la
 * pide, así los consumidores solo leen el estado.
 *
 * - `pending`: la petición sigue abierta.
 * - `settled`: el Backend respondió, con el perfil o con la denegación
 *   genérica; repetirla no cambia el resultado, así que no se reintenta.
 * - `failed`: falló por otra causa (red o error interno) y admite un nuevo intento.
 */
export type OwnProfileProvisioning = "pending" | "settled" | "failed";

type Entry = {
  readonly status: OwnProfileProvisioning;
  readonly ensure: () => Promise<unknown>;
};

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function setEntry(email: string, entry: Entry): void {
  entries.set(email, entry);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Pide el perfil salvo que ya haya una petición abierta o una respuesta. */
export function requestOwnProfile(email: string, ensure: () => Promise<unknown>): void {
  const current = entries.get(email)?.status;
  if (current === "pending" || current === "settled") return;
  setEntry(email, { status: "pending", ensure });
  ensure().then(
    () => setEntry(email, { status: "settled", ensure }),
    (error: unknown) =>
      setEntry(email, { status: error instanceof ConvexError ? "settled" : "failed", ensure }),
  );
}

/** Vuelve a pedir el perfil tras un fallo pasajero; sin fallo no hace nada. */
export function retryOwnProfile(email: string): void {
  const entry = entries.get(email);
  if (entry?.status === "failed") requestOwnProfile(email, entry.ensure);
}

/** Estado vigente para el correo, o `null` si nunca se pidió. */
export function useOwnProfileProvisioning(email: string | null): OwnProfileProvisioning | null {
  return useSyncExternalStore(subscribe, () =>
    email === null ? null : (entries.get(email)?.status ?? null),
  );
}
