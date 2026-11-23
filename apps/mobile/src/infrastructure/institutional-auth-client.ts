import { expoClient } from "@better-auth/expo/client";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

import type { InstitutionalAuthClient } from "./convex-authentication";

/**
 * Better Auth sobre el Site URL de Convex. La cookie de sesión vive en el almacén seguro del sistema
 * y el esquema `ceretime` de `app.json` devuelve a la app desde el navegador.
 */
export function createInstitutionalAuthClient(convexSiteUrl: string): InstitutionalAuthClient {
  return createAuthClient({
    baseURL: convexSiteUrl,
    plugins: [
      expoClient({ storagePrefix: "ceretime", storage: SecureStore }),
      convexClient(),
      genericOAuthClient(),
    ],
  });
}
