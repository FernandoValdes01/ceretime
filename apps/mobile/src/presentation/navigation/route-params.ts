// Expo Router entrega un parámetro repetido como arreglo; las pantallas de detalle solo usan el primero.
export function firstRouteParam(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}
