// El adaptador lo lanza cuando el acompañamiento pedido no pertenece a la persona; los hooks lo distinguen de un fallo de carga.
export class AccompanimentAccessDeniedError extends Error {
  constructor() {
    super("No puedes acceder a este acompañamiento.");
    this.name = "AccompanimentAccessDeniedError";
  }
}

export function isAccompanimentAccessDeniedError(
  error: unknown,
): error is AccompanimentAccessDeniedError {
  return error instanceof AccompanimentAccessDeniedError;
}
