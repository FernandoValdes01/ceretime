import { router } from "expo-router";
import { useEffect, type PropsWithChildren } from "react";

import type { NavigationRole } from "./roles";
import { getRoleHome } from "./roles";
import { useNavigationSession } from "./session";
import { Screen } from "../components/screen";

export function RoleGuard({
  requiredRole,
  children,
}: PropsWithChildren<{ readonly requiredRole: NavigationRole }>) {
  const { role, recordAccessDenied } = useNavigationSession();

  useEffect(() => {
    if (!role || role === requiredRole) return;

    recordAccessDenied(requiredRole);
    router.replace(getRoleHome(role));
  }, [recordAccessDenied, requiredRole, role]);

  if (role === requiredRole) return children;

  return (
    <Screen
      title="Acceso denegado"
      description="Tu sesión no tiene permisos para acceder a esta sección. Volverás a tu inicio."
    />
  );
}
