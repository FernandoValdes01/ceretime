import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/

type VercelHeader = { key: string; value: string };
type VercelHeaderRule = { source: string; headers: VercelHeader[] };
type VercelConfig = { headers?: VercelHeaderRule[] };

const SECURITY_HEADER_SOURCE = "/(.*)";

/**
 * Lee las cabeceras de `vercel.json`, única fuente para la Web publicada.
 *
 * `dev` y `preview` las reutilizan para comprobarlas en localhost antes de
 * integrar (TI2-184). No agregar aquí una segunda lista.
 */
function readSecurityHeaders(): Record<string, string> {
  const path = new URL("./vercel.json", import.meta.url);
  const config = JSON.parse(readFileSync(path, "utf8")) as VercelConfig;
  const headers = Object.fromEntries(
    (config.headers ?? [])
      .filter((rule) => rule.source === SECURITY_HEADER_SOURCE)
      .flatMap((rule) => rule.headers.map(({ key, value }) => [key, value])),
  );
  if (headers["Content-Security-Policy"] === undefined) {
    throw new Error(
      `vercel.json no declara Content-Security-Policy para ${SECURITY_HEADER_SOURCE}`,
    );
  }
  return headers;
}

/**
 * `dev` conserva la política publicada salvo dos concesiones que exige el
 * servidor de Vite y que no existen en la Web publicada:
 *
 * - React Refresh inyecta un script inline en `index.html`.
 * - HMR usa un WebSocket contra el puerto que elija Vite.
 *
 * `preview` sirve el build real sin concesiones, así que es la comprobación
 * fiel a producción.
 */
function withDevOnlyCsp(csp: string): string {
  return csp
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive.length > 0)
    .map((directive) => {
      const [name, ...sources] = directive.split(/\s+/);
      if (name === "script-src" && !sources.includes("'unsafe-inline'")) {
        return `${directive} 'unsafe-inline'`;
      }
      if (name === "connect-src") {
        return `${directive} ws://localhost:* ws://127.0.0.1:*`;
      }
      return directive;
    })
    .join("; ");
}

const securityHeaders = readSecurityHeaders();
const devHeaders: Record<string, string> = {
  ...securityHeaders,
  "Content-Security-Policy": withDevOnlyCsp(securityHeaders["Content-Security-Policy"]),
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Una sola copia de React en el bundle: con installs aislados conviven
    // react 19.2.x y 19.3.x y el proveedor de auth resolvía una distinta a
    // la app (invalid hook call en ConvexBetterAuthProvider).
    dedupe: ["react", "react-dom"],
  },
  server: { headers: devHeaders },
  preview: { headers: securityHeaders },
});
