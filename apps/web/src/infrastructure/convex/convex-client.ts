import { ConvexReactClient } from "convex/react";

/**
 * Infraestructura cliente: conexión con Convex (TI2-3).
 *
 * `VITE_CONVEX_URL` es pública: solo localiza el deployment. Nunca contiene
 * secretos (ver `apps/web/.env.example`).
 */

export const convexUrl = import.meta.env.VITE_CONVEX_URL ?? "";
export const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL ?? "";

export const isBackendConfigured = convexUrl.length > 0 && convexSiteUrl.length > 0;

export const convexClient = new ConvexReactClient(convexUrl || "https://127.0.0.1:1");
