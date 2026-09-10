import { AuthScreen } from "./presentation/auth/AuthScreen.tsx";

/**
 * Raíz de Presentación web (TI2-3): solo acceso y sesión.
 * La autorización y los portales por rol pertenecen a otra issue.
 */
function App() {
  return (
    <main>
      <AuthScreen />
    </main>
  );
}

export default App;
