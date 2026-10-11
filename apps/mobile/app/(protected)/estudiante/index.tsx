import { router } from "expo-router";

import { AccessDeniedNotice } from "../../../src/presentation/components/role-home";
import { StudentAction, StudentScreen } from "../../../src/presentation/estudiante/student-screen";
import { StudentText } from "../../../src/presentation/estudiante/student-text";
import { RoleGuard } from "../../../src/presentation/navigation/role-guard";
import { useNavigationSession } from "../../../src/presentation/navigation/session";

export default function StudentHome() {
  const { accessDeniedRole, dismissAccessDenied, status } = useNavigationSession();
  const isSigningOut = status === "loading";

  return (
    <RoleGuard requiredRole="estudiante">
      <StudentScreen
        title="Inicio de Estudiante"
        description="Cuéntanos qué apoyo necesitas para participar en la vida universitaria."
      >
        {accessDeniedRole ? (
          <AccessDeniedNotice role={accessDeniedRole} onDismiss={dismissAccessDenied} />
        ) : null}
        <StudentAction
          label="Nueva solicitud"
          description="Cuéntanos qué acompañamiento necesitas"
          onPress={() => router.push("/estudiante/nueva-solicitud")}
          disabled={isSigningOut}
        />
        <StudentAction
          label="Mis solicitudes"
          description="Consulta tus solicitudes enviadas"
          onPress={() => router.push("/estudiante/solicitudes")}
          disabled={isSigningOut}
          secondary
        />
        {isSigningOut ? (
          <StudentText
            accessibilityLabel="Cerrando sesión"
            accessibilityLiveRegion="polite"
            accessibilityRole="progressbar"
            accessibilityState={{ busy: true }}
            className="text-center text-base text-student-primary"
          >
            Cerrando sesión…
          </StudentText>
        ) : null}
      </StudentScreen>
    </RoleGuard>
  );
}
