import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// Expone `/api/auth/*` en el Convex Site URL con CORS para la SPA (Vite).
// El callback Google queda en `/api/auth/callback/google` bajo ese origen.
authComponent.registerRoutes(http, createAuth, { cors: true });

export default http;
