import { defineApp, type ComponentDefinition } from "convex/server";
import betterAuthComponent from "@convex-dev/better-auth/convex.config";

const app = defineApp();
// Cast acotado a este borde: Bun aísla `convex` por workspace y el `tsc`
// local ve dos copias idénticas (v1.45.0). En ejecución es el mismo objeto de
// definición; `convex dev` y el despliegue no se ven afectados.
app.use(betterAuthComponent as ComponentDefinition);

export default app;
