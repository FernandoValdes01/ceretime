import { authMode, mobileDependencies } from "../../src/composition/mobile-dependencies";
import { LoginScreen } from "../../src/presentation/auth/login-screen";

export default function LoginRoute() {
  return (
    <LoginScreen
      mode={authMode}
      unassignedInternCredentials={mobileDependencies.unassignedInternCredentials}
      onResetDemo={mobileDependencies.resetDemo}
    />
  );
}
