import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// Expone `/api/auth/*` en el Convex Site URL con CORS para la SPA (Vite).
// El inicio institucional usa `/api/auth/oauth2/callback/google-alu` y
// `/api/auth/oauth2/callback/google-uct`; Calendar conserva
// `/api/auth/callback/google` (TI2-122).
authComponent.registerRoutes(http, createAuth, { cors: true });

export default http;
