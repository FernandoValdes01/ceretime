// Convex expone `process.env` en tiempo de ejecución para leer secretos y
// URLs del deployment. Declaración mínima para no depender de `@types/node`
// dentro de `convex/`.
declare const process: {
  env: Record<string, string | undefined>;
};
