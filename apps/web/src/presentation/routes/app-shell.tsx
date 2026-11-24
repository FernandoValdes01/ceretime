import { useState, type ReactNode } from "react";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { GENERIC_AUTH_MESSAGES } from "../../application/session/institutional-login.ts";
import { authClient } from "../../infrastructure/auth/auth-client.ts";
import { AccessibilityMenu } from "../accessibility/AccessibilityMenu.tsx";
import { clearAllRequestDrafts } from "../estudiante/student-request-draft.ts";
import { PORTAL_NAVIGATION, type PortalArea } from "./navigation.ts";
import "./app-shell.css";

/**
 * Estructura común de la Web (TI2-133, menú lateral de Administración TI2-169).
 *
 * Encabezado del mockup con marca, navegación del rol, menú de accesibilidad y
 * cierre de sesión real; contenido debajo del mismo encabezado y un único
 * destino de salto al contenido. La navegación solo enlaza pantallas
 * existentes, marca la sección actual con `aria-current` (no solo color) y el
 * cierre de sesión es un botón operable con teclado.
 *
 * El portal de Administración usa menú lateral en lugar de encabezado
 * superior: la misma marca, la misma navegación por rol, el mismo menú de
 * accesibilidad y el mismo cierre de sesión, con el botón abajo a la
 * izquierda y el contenido a ancho completo. Los demás portales conservan el
 * encabezado superior del mockup.
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

/** Destino de contenido de las páginas públicas (acceso, índice, denegado y no encontrado). */
export function PublicMain({ children }: { children: ReactNode }) {
  return (
    <main id="contenido" className="app-shell__public" tabIndex={-1}>
      {children}
    </main>
  );
}

/** Marca CERETI con retorno al inicio del portal; el lateral usa el emblema. */
function ShellBrand({
  navigation,
  withLogo = false,
}: {
  navigation: (typeof PORTAL_NAVIGATION)[PortalArea];
  withLogo?: boolean;
}) {
  return (
    <Link
      to={navigation.brandHome}
      className="app-shell__brand"
      aria-label={`CERETI, ir al inicio del ${navigation.title}`}
    >
      {withLogo ? (
        <img
          className="app-shell__mark app-shell__mark--logo"
          src="/cereti.jpg"
          alt=""
          aria-hidden="true"
        />
      ) : (
        <span className="app-shell__mark" aria-hidden="true">
          CE
        </span>
      )}
      <span className="app-shell__name">
        <strong>CERETI</strong>
        <span>{navigation.title}</span>
      </span>
    </Link>
  );
}

/** Navegación del rol con la sección actual marcada; vertical en el lateral. */
function ShellNav({
  navigation,
  sidebar = false,
}: {
  navigation: (typeof PORTAL_NAVIGATION)[PortalArea];
  sidebar?: boolean;
}) {
  return (
    <nav
      aria-label={navigation.title}
      className={sidebar ? "app-shell__nav app-shell__nav--sidebar" : "app-shell__nav"}
    >
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
  );
}

/** Accesibilidad y cierre de sesión con su error; el contenedor lo pone cada disposición. */
function ShellActions({
  signingOut,
  signOutError,
  onSignOut,
}: {
  signingOut: boolean;
  signOutError: string | null;
  onSignOut: () => void;
}) {
  return (
    <>
      <AccessibilityMenu />
      <button
        type="button"
        className="app-shell__logout"
        disabled={signingOut}
        aria-busy={signingOut}
        onClick={onSignOut}
      >
        {signingOut ? GENERIC_AUTH_MESSAGES.loading : "Cerrar sesión"}
      </button>
      {signOutError ? (
        <p role="alert" className="app-shell__error">
          {signOutError}
        </p>
      ) : null}
    </>
  );
}

/**
 * Portal con encabezado y navegación común para un área con sesión. Con
 * `children` muestra ese contenido en lugar de la vista de la ruta, para que
 * un estado de cuenta conserve la navegación y el cierre de sesión.
 */
export function AppShell({ area, children }: { area: PortalArea; children?: ReactNode }) {
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
      // Solo tras cerrar la sesión: si falla, la persona sigue dentro y no
      // pierde lo que escribió en una solicitud sin enviar.
      clearAllRequestDrafts();
      await navigate({ to: "/", replace: true });
    } catch {
      setSignOutError(GENERIC_AUTH_MESSAGES.signOutError);
    } finally {
      setSigningOut(false);
    }
  }

  if (area === "admin") {
    return (
      <div className="app-shell app-shell--sidebar">
        <aside className="app-shell__sidebar">
          <ShellBrand navigation={navigation} withLogo />
          <ShellNav navigation={navigation} sidebar />
          <div className="app-shell__sidebar-foot">
            <ShellActions
              signingOut={signingOut}
              signOutError={signOutError}
              onSignOut={() => void handleSignOut()}
            />
          </div>
        </aside>
        <main id="contenido" className="app-shell__main" tabIndex={-1}>
          {children ?? <Outlet />}
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <div className="app-shell__bar">
          <ShellBrand navigation={navigation} />
          <div className="app-shell__actions">
            <ShellNav navigation={navigation} />
            <ShellActions
              signingOut={signingOut}
              signOutError={signOutError}
              onSignOut={() => void handleSignOut()}
            />
          </div>
        </div>
      </header>
      <main
        id="contenido"
        className={area === "student" ? "app-shell__main" : "app-shell__main app-shell__main--wide"}
        tabIndex={-1}
      >
        {children ?? <Outlet />}
      </main>
    </div>
  );
}
