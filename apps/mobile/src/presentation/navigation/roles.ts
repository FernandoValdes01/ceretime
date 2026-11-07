import type { AuthRole } from "../../domain/auth-models";

// Identificadores locales de la navegación simulada, no contratos del backend.
export const roles = [
  { id: "estudiante", label: "Estudiante", href: "/estudiante" },
  { id: "profesional", label: "Profesional", href: "/profesional" },
  { id: "practicante", label: "Practicante", href: "/practicante" },
  { id: "administrador", label: "Administrador", href: "/administrador" },
] as const satisfies readonly { id: AuthRole; label: string; href: string }[];

export function getRoleHome(role: AuthRole) {
  return roles.find((entry) => entry.id === role)!.href;
}
