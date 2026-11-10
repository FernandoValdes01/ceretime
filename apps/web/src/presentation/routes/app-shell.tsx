import { useState, type ReactNode } from "react";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { GENERIC_AUTH_MESSAGES } from "../../application/session/institutional-login.ts";
import { authClient } from "../../infrastructure/auth/auth-client.ts";
import { AccessibilityMenu } from "../accessibility/AccessibilityMenu.tsx";
import { PORTAL_NAVIGATION, type PortalArea } from "./navigation.ts";
import "./app-shell.css";

/**
 * Estructura común de la Web (TI2-133).
 *
 * Encabezado del mockup con marca, navegación del rol, menú de accesibilidad y
 * cierre de sesión real; contenido debajo del mismo encabezado y un único
 * destino de salto al contenido. La navegación solo enlaza pantallas
 * existentes, marca la sección actual con `aria-current` (no solo color) y el
 * cierre de sesión es un botón operable con teclado.
 *
 * El enlace de salto y el `<main id="contenido">` viven en este módulo para
 * que las páginas públicas y los portales usen el mismo destino sin duplicar
 * identificadores.
 */

/** Enlace de salto al contenido, primero en el orden del teclado. */
export function SkipLink() {
  return (
    <a href="#contenido" className="app-shell__skip">
      Saltar al contenido principal
    </a>
  );
}

/** Destino de contenido de las páginas públicas (acceso, índice, denegado). */
export function PublicMain({ children }: { children: ReactNode }) {
  return (
    <main id="contenido" className="app-shell__public" tabIndex={-1}>
      {children}
    </main>
  );
}

/** Portal con encabezado y navegación común para un área con sesión. */
export function AppShell({ area }: { area: PortalArea }) {
  const navigation = PORTAL_NAVIGATION[area];
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      // Invalida la sesión en Better Auth; las consultas de sesión vuelven a
      // `unauthenticated` y el índice deriva al acceso. Un fallo de API llega
      // en el resultado, así que se revisa además del `catch`.
      const result = await authClient.signOut();
      if (result?.error) {
        setSignOutError(GENERIC_AUTH_MESSAGES.signOutError);
        return;
      }
      await navigate({ to: "/", replace: true });
    } catch {
      setSignOutError(GENERIC_AUTH_MESSAGES.signOutError);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <div className="app-shell__bar">
          <Link
            to={navigation.brandHome}
            className="app-shell__brand"
            aria-label={`CERETI, ir al inicio del ${navigation.title}`}
          >
            <span className="app-shell__mark" aria-hidden="true">
              CE
            </span>
            <span className="app-shell__name">
              <strong>CERETI</strong>
              <span>{navigation.title}</span>
            </span>
          </Link>
          <div className="app-shell__actions">
            <nav aria-label={navigation.title} className="app-shell__nav">
              {navigation.items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: item.exact, includeSearch: false }}
                  activeProps={{ "aria-current": "page" }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <AccessibilityMenu />
            <button
              type="button"
              className="app-shell__logout"
              disabled={signingOut}
              aria-busy={signingOut}
              onClick={() => void handleSignOut()}
            >
              {signingOut ? GENERIC_AUTH_MESSAGES.loading : "Cerrar sesión"}
            </button>
          </div>
        </div>
        {signOutError ? (
          <p role="alert" className="app-shell__error">
            {signOutError}
          </p>
        ) : null}
      </header>
      <main
        id="contenido"
        className={area === "student" ? "app-shell__main" : "app-shell__main app-shell__main--wide"}
        tabIndex={-1}
      >
        <Outlet />
      </main>
    </div>
  );
}
