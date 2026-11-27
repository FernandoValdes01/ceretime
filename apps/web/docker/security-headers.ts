/**
 * Genera las directivas `add_header` de nginx para la imagen Docker de la Web.
 *
 * Las lee de `vercel.json`, única fuente de las cabeceras publicadas que
 * también reutiliza `vite.config.ts`; nginx no mantiene una segunda lista.
 *
 * Uso: `bun apps/web/docker/security-headers.ts > security-headers.conf`
 */
import vercelConfig from "../vercel.json" with { type: "json" };

type VercelHeader = { key: string; value: string };
type VercelConfig = { headers?: { source: string; headers: VercelHeader[] }[] };

const SECURITY_HEADER_SOURCE = "/(.*)";
// nginx interpretaría `$` como variable y `"` cerraría el valor entre comillas.
const UNQUOTABLE_IN_NGINX = /["$\\\r\n]/;

const config: VercelConfig = vercelConfig;
const headers = (config.headers ?? [])
  .filter((rule) => rule.source === SECURITY_HEADER_SOURCE)
  .flatMap((rule) => rule.headers);

if (!headers.some(({ key }) => key === "Content-Security-Policy")) {
  throw new Error(`vercel.json no declara Content-Security-Policy para ${SECURITY_HEADER_SOURCE}`);
}

const directives = headers.map(({ key, value }) => {
  if (UNQUOTABLE_IN_NGINX.test(key) || UNQUOTABLE_IN_NGINX.test(value)) {
    throw new Error(`La cabecera ${key} tiene caracteres que nginx no admite entre comillas`);
  }
  return `add_header ${key} "${value}" always;`;
});

console.log(directives.join("\n"));
