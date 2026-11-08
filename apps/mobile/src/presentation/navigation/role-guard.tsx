import { router } from "expo-router";
import { useEffect, type PropsWithChildren } from "react";

import type { AuthRole } from "../../domain/auth-models";
import { getRoleHome } from "./roles";
import { useNavigationSession } from "./session";
import { Screen } from "../components/screen";

// Protege una sección por rol: si la sesión es de otro rol, registra el acceso denegado y la envía a su inicio.
export function RoleGuard({
  requiredRole,
  children,
}: PropsWithChildren<{ readonly requiredRole: AuthRole }>) {
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
