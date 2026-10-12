import { render, screen, waitFor } from "@testing-library/react-native";
import * as ReactNative from "react-native";
import { TextInput } from "react-native";
import type { PropsWithChildren } from "react";
import {
  defaultAccessibilityPreferences,
  type AccessibilityPreferences,
} from "@/application/accessibility-preferences-models";
import type { AccessibilityPreferencesPort } from "@/application/accessibility-preferences-port";
import { AccessibilityPreferencesProvider } from "@/presentation/accessibility/accessibility-preferences-provider";
import { Screen } from "@/presentation/components/screen";
import { StudentScreen } from "@/presentation/estudiante/student-screen";
import { StudentText } from "@/presentation/estudiante/student-text";

jest.mock("expo-font", () => ({ useFonts: () => [true, null] }));

afterEach(() => jest.restoreAllMocks());

function createPort(
  textScale: AccessibilityPreferences["textScale"],
  highContrast: AccessibilityPreferences["highContrast"] = "system",
): AccessibilityPreferencesPort {
  return {
    read: async () => ({
      preferences: { ...defaultAccessibilityPreferences, textScale, highContrast },
      source: "stored",
      error: null,
    }),
    update: async (patch) => ({
      ok: true,
      preferences: { ...defaultAccessibilityPreferences, textScale, highContrast, ...patch },
    }),
  };
}

test("el tamaño elegido escala texto y altura de línea una sola vez", async () => {
  render(
    <Screen title="Preferencia ampliada">
      <StudentText testID="scaled-inline" style={{ fontSize: 20, lineHeight: 24 }}>
        Texto con tamaño explícito
      </StudentText>
    </Screen>,
    { wrapper: ({ children }) => <Provider textScale={1.5}>{children}</Provider> },
  );

  expect(await screen.findByText("Texto con tamaño explícito")).toHaveStyle({
    fontSize: 15,
    lineHeight: 18,
  });
  render(
    <StudentText testID="scaled-class" className="text-xl leading-[29px]">
      Texto con clases de estilo
    </StudentText>,
    { wrapper: ({ children }) => <Provider textScale={1.5}>{children}</Provider> },
  );
  await waitFor(() =>
    expect(screen.getByTestId("scaled-class")).toHaveStyle({ fontSize: 15, lineHeight: 21.75 }),
  );
  render(
    <StudentScreen title="Texto ampliado" description="Un encabezado que sigue escalando." />,
    { wrapper: ({ children }) => <Provider textScale={1.5}>{children}</Provider> },
  );
  await waitFor(() =>
    expect(screen.getByRole("header", { name: "Texto ampliado" })).toHaveStyle({
      fontSize: 21,
      lineHeight: 27.75,
    }),
  );
});

test("el texto nativo mantiene su escalado del sistema con preferencia system", async () => {
  render(
    <StudentText testID="native-text" style={{ fontSize: 20, lineHeight: 24 }}>
      Texto del sistema
    </StudentText>,
    { wrapper: ({ children }) => <Provider textScale="system">{children}</Provider> },
  );

  expect(await screen.findByTestId("native-text")).toHaveStyle({ fontSize: 20, lineHeight: 24 });
});

test("el tamaño de texto configurado llega a TextInput mediante NativeWind", async () => {
  render(<TextInput testID="scaled-input" className="text-base leading-[26px]" />, {
    wrapper: ({ children }) => <Provider textScale={1.5}>{children}</Provider>,
  });

  await waitFor(() =>
    expect(screen.getByTestId("scaled-input")).toHaveStyle({ fontSize: 12, lineHeight: 19.5 }),
  );
});

test("Android conserva decimales de la escala elegida en texto directo y NativeWind", async () => {
  jest.replaceProperty(ReactNative.Platform, "OS", "android");
  jest.spyOn(ReactNative.Platform, "Version", "get").mockReturnValue(37);
  jest.spyOn(ReactNative, "useWindowDimensions").mockReturnValue({
    width: 360,
    height: 800,
    scale: 3,
    fontScale: 2,
  });

  render(
    <>
      <StudentText testID="android-inline" style={{ fontSize: 16 }}>
        Texto directo
      </StudentText>
      <TextInput testID="android-nativewind" className="text-base" />
    </>,
    { wrapper: ({ children }) => <Provider textScale={1.5}>{children}</Provider> },
  );

  await waitFor(() => {
    expect(
      ReactNative.StyleSheet.flatten(screen.getByTestId("android-inline").props.style),
    ).toEqual(expect.objectContaining({ fontSize: 11.5 }));
    expect(screen.getByTestId("android-nativewind")).toHaveStyle({ fontSize: 11.5 });
  });
});

test("el alto contraste actualiza el token de texto y la base Screen", async () => {
  render(
    <>
      <StudentScreen title="Estudiante" description="Descripción" />
      <Screen title="Vista compartida" />
    </>,
    {
      wrapper: ({ children }) => (
        <Provider textScale="system" highContrast="on">
          {children}
        </Provider>
      ),
    },
  );

  await waitFor(() => {
    expect(screen.getByRole("header", { name: "Estudiante" })).toHaveStyle({ color: "#000000" });
    expect(screen.getByRole("header", { name: "Vista compartida" })).toHaveStyle({
      color: "#000000",
    });
  });
});

function Provider({
  children,
  textScale,
  highContrast,
}: PropsWithChildren<{
  textScale: "system" | 1 | 1.5 | 2;
  highContrast?: AccessibilityPreferences["highContrast"];
}>) {
  const port = createPort(textScale, highContrast);
  return (
    <AccessibilityPreferencesProvider port={port}>{children}</AccessibilityPreferencesProvider>
  );
}
