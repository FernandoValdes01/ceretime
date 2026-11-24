import { execFileSync } from "node:child_process";
import { StyleSheet } from "react-native-css-interop";
import { cssToReactNativeRuntime } from "react-native-css-interop/css-to-rn";
import { setUpTests } from "react-native-reanimated";
import "react-native-css-interop/dist/runtime/components";

setUpTests();

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// Better Auth publica módulos ESM `.mjs` que Jest no transforma, y el almacén seguro es nativo. Las pruebas
// sustituyen el cliente por uno doble; el cableado real se comprueba en Android.
jest.mock("./src/infrastructure/institutional-auth-client", () => ({
  createInstitutionalAuthClient: jest.fn(),
}));

// El transporte de desarrollo de Expo intenta abrir un WebSocket hacia Metro.
// Las pruebas del router no necesitan un servidor de desarrollo.
jest.mock("expo/src/async-require/messageSocket.native", () => ({}));

// Jest no pasa por Metro. Compilamos las clases reales y las registramos en
// NativeWind para comprobar estilos nativos, sin sustituirlos por un mock.
jest.mock("./global.css", () => ({}));
beforeAll(() => {
  const css = execFileSync(
    process.execPath,
    [
      require.resolve("tailwindcss/lib/cli"),
      "--input",
      "./global.css",
      "--config",
      "./tailwind.config.js",
    ],
    {
      cwd: __dirname,
      env: { ...process.env, NATIVEWIND_OS: "ios" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  StyleSheet.registerCompiled(cssToReactNativeRuntime(css, { inlineRem: 16 }));
});
