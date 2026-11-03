import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// Expone `/api/auth/*` en el Convex Site URL con CORS para la SPA (Vite).
// Los callbacks de Google quedan en `/api/auth/oauth2/callback/google-alu` y
// `/api/auth/oauth2/callback/google-uct` bajo ese origen.
authComponent.registerRoutes(http, createAuth, { cors: true });

export default http;
