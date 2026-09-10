import {
  convexClient,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { convexSiteUrl } from "../convex/convex-client";

/**
 * Infraestructura cliente: Better Auth sobre Convex (TI2-3).
 *
 * `baseURL` apunta al Site URL de Convex, donde vive `/api/auth/*`. El
 * callback OAuth de Google es `{VITE_CONVEX_SITE_URL}/api/auth/callback/google`.
 */

export const authClient = createAuthClient({
  baseURL: convexSiteUrl || undefined,
  plugins: [convexClient(), crossDomainClient()],
});
