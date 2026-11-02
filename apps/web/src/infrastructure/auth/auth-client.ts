import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";
import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { convexSiteUrl } from "../convex/convex-client";

/**
 * Infraestructura cliente: Better Auth sobre Convex (TI2-3).
 *
 * `baseURL` apunta al Site URL de Convex, donde vive `/api/auth/*`.
 * `genericOAuthClient` habilita `signIn.oauth2` para los proveedores por
 * población (TI2-131); su callback es
 * `{VITE_CONVEX_SITE_URL}/api/auth/oauth2/callback/<providerId>`.
 */

export const authClient = createAuthClient({
  baseURL: convexSiteUrl || undefined,
  plugins: [convexClient(), crossDomainClient(), genericOAuthClient()],
});
