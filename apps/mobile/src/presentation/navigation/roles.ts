// Identificadores locales de la navegación simulada, no contratos del backend.
export const roles = [
  { id: 'estudiante', label: 'Estudiante', href: '/estudiante' },
  { id: 'profesional', label: 'Profesional', href: '/profesional' },
  { id: 'practicante', label: 'Practicante', href: '/practicante' },
  { id: 'administrador', label: 'Administrador', href: '/administrador' },
] as const;

export type NavigationRole = (typeof roles)[number]['id'];

export function getRoleHome(role: NavigationRole) {
  return roles.find((entry) => entry.id === role)!.href;
}
