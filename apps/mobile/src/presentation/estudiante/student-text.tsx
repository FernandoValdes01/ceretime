import { createContext, useContext, type PropsWithChildren } from "react";
import { StyleSheet, Text, type TextProps, type TextStyle } from "react-native";
import { useFonts } from "expo-font";
import { FiraSans_400Regular } from "@expo-google-fonts/fira-sans/400Regular";
import { FiraSans_600SemiBold } from "@expo-google-fonts/fira-sans/600SemiBold";
import { FiraSans_700Bold } from "@expo-google-fonts/fira-sans/700Bold";
import { useOptionalAccessibilityPreferences } from "../accessibility/accessibility-preferences-provider";

const fonts = { FiraSans_400Regular, FiraSans_600SemiBold, FiraSans_700Bold };
const FontContext = createContext(false);

export function StudentFonts({ children }: PropsWithChildren) {
  const [loaded] = useFonts(fonts);
  // La fuente del sistema permite usar el formulario mientras carga o si falla.
  return <FontContext value={loaded}>{children}</FontContext>;
}

export function useStudentFont(weight: "regular" | "semibold" | "bold" = "regular") {
  const loaded = useContext(FontContext);
  const families = {
    regular: "FiraSans_400Regular",
    semibold: "FiraSans_600SemiBold",
    bold: "FiraSans_700Bold",
  };
  return loaded ? families[weight] : undefined;
}

export interface StudentTextProps extends TextProps {
  readonly weight?: "regular" | "semibold" | "bold";
  readonly className?: string;
}

export function StudentText({ weight = "regular", style, ...props }: StudentTextProps) {
  const preferences = useOptionalAccessibilityPreferences();
  const scale = preferences?.effective.textScaleMultiplier ?? 1;
  const fontFamily = useStudentFont(weight);
  const fontWeight = fontFamily
    ? "400"
    : weight === "bold"
      ? "700"
      : weight === "semibold"
        ? "600"
        : "400";
  return <Text {...props} style={[scaleTextStyle(style, scale), { fontFamily, fontWeight }]} />;
}

function scaleTextStyle(style: TextProps["style"], scale: number): TextProps["style"] {
  if (scale === 1) return style;
  const flattened = StyleSheet.flatten(style);
  if (!flattened) return style;

  const scaled: TextStyle = { ...flattened };
  if (typeof flattened.fontSize === "number") scaled.fontSize = flattened.fontSize * scale;
  if (typeof flattened.lineHeight === "number") scaled.lineHeight = flattened.lineHeight * scale;
  return scaled;
}
