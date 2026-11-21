import { api } from "../../../../convex/_generated/api";
import { GOOGLE_PROVIDER_ID_BY_POPULATION } from "../../../../convex/domain/auth/institutional_domain";
import type { Role } from "../../../../convex/domain/identity/roles";
import type { InstitutionalAuthPort } from "../application/auth-port";
import { UserFacingError } from "../application/user-facing-error";
import type { AuthRole, AuthSession } from "../domain/auth-models";
import type { GetAuthToken, MobileConvexClient } from "./convex-client";

// El token de Convex dura 15 minutos; se reutiliza solo una parte para no pedir uno nuevo en cada llamada.
const TOKEN_REUSE_MS = 5 * 60_000;

const roleByBackendRole = {
  student: "estudiante",
  professional: "profesional",
  intern: "practicante",
  admin: "administrador",
} as const satisfies Record<Role, AuthRole>;

export const institutionalSignInFailedMessage =
  "No pudimos iniciar sesión con tu cuenta institucional. Inténtalo de nuevo.";
export const sessionCheckFailedMessage =
  "No pudimos verificar tu sesión. Revisa tu conexión e inténtalo de nuevo.";
export const accountNotEnabledMessage =
  "Tu cuenta todavía no está habilitada en CERETI. Pide al equipo de CERETI que la habilite.";

// `ensureMyProfile` deniega con ConvexError("No autorizado"); el transporte, con `code: "unauthorized"`.
function isAuthorizationDenied(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const { data, code } = cause as { data?: unknown; code?: unknown };
  return (
    data === "No autorizado" ||
    code === "unauthorized" ||
    (typeof data === "object" && data !== null && "code" in data && data.code === "unauthorized")
  );
}

/** Mitad de Better Auth que usa la app; el cliente real la cumple y las pruebas la sustituyen. */
export interface InstitutionalAuthClient {
  signIn: {
    oauth2(input: {
      providerId: string;
      callbackURL: string;
      errorCallbackURL: string;
    }): Promise<{ error?: unknown }>;
  };
  signOut(): Promise<unknown>;
  convex: {
    token(): Promise<{
      data?: { token?: string | null } | null;
      error?: { status?: number } | null;
    }>;
  };
}

/** Token que identifica a la sesión ante Convex; `null` cuando el servidor no reconoce la sesión. */
export function createAuthTokenSupplier(
  authClient: Pick<InstitutionalAuthClient, "convex">,
  now: () => number = Date.now,
) {
  let cached: { readonly token: string; readonly reusableUntil: number } | null = null;

  const getAuthToken: GetAuthToken = async () => {
    if (cached && now() < cached.reusableUntil) return cached.token;
    cached = null;
    const { data, error } = await authClient.convex.token();
    if (error) {
      // 401: la sesión no existe o venció. Cualquier otro fallo es del servidor o de la red.
      if (error.status === 401) return null;
      throw new Error("No se pudo obtener el token de la sesión.");
    }
    const token = data?.token;
    if (!token) return null;
    cached = { token, reusableUntil: now() + TOKEN_REUSE_MS };
    return token;
  };

  return {
    getAuthToken,
    clear() {
      cached = null;
    },
  };
}

type TokenSupplier = ReturnType<typeof createAuthTokenSupplier>;

export function createConvexAuthAdapter({
  authClient,
  convexClient: backend,
  tokens,
}: {
  readonly authClient: InstitutionalAuthClient;
  readonly convexClient: Pick<MobileConvexClient, "query" | "mutation">;
  readonly tokens: TokenSupplier;
}): InstitutionalAuthPort {
  // Quita del dispositivo la cookie y el token de una sesión que el servidor ya no reconoce.
  async function discardLocalSession() {
    tokens.clear();
    try {
      await authClient.signOut();
    } catch {
      // El cierre local ya ocurrió antes de la petición; la red no cambia ese resultado.
    }
  }

  // Crea el perfil de la cuenta en su primer ingreso (TI2-182). Una denegación deja la cuenta sin rol;
  // cualquier otro fallo interrumpe la comprobación para poder reintentar.
  async function ensureOwnProfile() {
    try {
      await backend.mutation(api.presentation.session.ensureMyProfile, {});
    } catch (cause) {
      if (!isAuthorizationDenied(cause)) throw cause;
    }
  }

  // El rol sale del servidor: el cliente solo traduce el rol recibido a los de la navegación.
  async function readServerSession(): Promise<
    | { readonly status: "authenticated"; readonly session: AuthSession }
    | { readonly status: "unauthenticated" | "not-enabled" }
  > {
    if (!(await tokens.getAuthToken())) return { status: "unauthenticated" };
    const getSessionWithRole = api.presentation.session.getSessionWithRole;
    let { session, role } = await backend.query(getSessionWithRole, {});
    if (session.status === "authenticated" && role.status !== "authenticated") {
      await ensureOwnProfile();
      ({ session, role } = await backend.query(getSessionWithRole, {}));
    }
    if (session.status !== "authenticated") return { status: "unauthenticated" };
    // Sesión válida sin rol: cuenta pendiente, revocada o rechazada por el servidor.
    if (role.status !== "authenticated") return { status: "not-enabled" };
    return {
      status: "authenticated",
      session: {
        user: {
          id: role.email,
          displayName: session.name,
          email: role.email,
          role: roleByBackendRole[role.role],
          assignedAccompaniments: [],
        },
      },
    };
  }

  async function restoreSession() {
    let result: Awaited<ReturnType<typeof readServerSession>>;
    try {
      result = await readServerSession();
    } catch {
      throw new UserFacingError(sessionCheckFailedMessage);
    }
    if (result.status === "authenticated") return result.session;
    await discardLocalSession();
    if (result.status === "not-enabled") throw new UserFacingError(accountNotEnabledMessage);
    return null;
  }

  return {
    restoreSession,
    async signInInstitutional(population) {
      let result: { error?: unknown };
      try {
        result = await authClient.signIn.oauth2({
          providerId: GOOGLE_PROVIDER_ID_BY_POPULATION[population],
          callbackURL: "/",
          errorCallbackURL: "/",
        });
      } catch {
        throw new UserFacingError(institutionalSignInFailedMessage);
      }
      if (result.error) throw new UserFacingError(institutionalSignInFailedMessage);
      // El navegador vuelve sin avisar si la persona canceló o Google rechazó la cuenta: solo la sesión lo dice.
      tokens.clear();
      return restoreSession();
    },
    async logout() {
      await discardLocalSession();
    },
  };
}
