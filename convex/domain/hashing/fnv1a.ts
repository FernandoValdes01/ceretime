/**
 * Hash FNV-1a de 64 bits compartido por las claves deterministas del dominio.
 *
 * Dominio puro: lo usan la clave del evento de calendario (TI2-122) y el código de referencia de la coordinación por canal oficial (TI2-144). No es criptográfico: sirve para derivar una clave estable y corta, no para proteger un secreto.
 */

/** Base de desplazamiento estándar de FNV-1a de 64 bits. */
export const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;

const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

/** FNV-1a de 64 bits: determinista y puro. Una base distinta produce otro recorrido. */
export function fnv1a64(value: string, basis: bigint = FNV_OFFSET_BASIS): bigint {
  let hash = basis;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return hash;
}
