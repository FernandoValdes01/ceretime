import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Una sola copia de React en el bundle: con installs aislados conviven
    // react 19.2.x y 19.3.x y el proveedor de auth resolvía una distinta a
    // la app (invalid hook call en ConvexBetterAuthProvider).
    dedupe: ["react", "react-dom"],
  },
});
