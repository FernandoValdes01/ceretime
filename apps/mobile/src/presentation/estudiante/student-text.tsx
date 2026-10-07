import { createContext, useContext, type PropsWithChildren } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  type TextProps,
  type TextStyle,
} from "react-native";
import { useFonts } from "expo-font";
import { FiraSans_400Regular } from "@expo-google-fonts/fira-sans/400Regular";
import { FiraSans_600SemiBold } from "@expo-google-fonts/fira-sans/600SemiBold";
import { FiraSans_700Bold } from "@expo-google-fonts/fira-sans/700Bold";
import { getNativeFontSize } from "../accessibility/accessibility-preferences-policy";
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

export function StudentText({ weight = "regular", style, className, ...props }: StudentTextProps) {
  const preferences = useOptionalAccessibilityPreferences();
  const { fontScale } = useWindowDimensions();
  const textScale = preferences?.effective.textScale ?? fontScale;
  const fontFamily = useStudentFont(weight);
  const fontWeight = fontFamily
    ? "400"
    : weight === "bold"
      ? "700"
      : weight === "semibold"
        ? "600"
        : "400";
  return (
    <Text
      {...props}
      className={className}
      style={[
        scaleTextStyle(style, textScale, fontScale, Boolean(className)),
        { fontFamily, fontWeight },
      ]}
    />
  );
}

function scaleTextStyle(
  style: TextProps["style"],
  textScale: number,
  systemFontScale: number,
  hasClassName: boolean,
): TextProps["style"] {
  if (textScale === systemFontScale) return style;
  const flattened = StyleSheet.flatten(style);
  const scaled: TextStyle = { ...flattened };
  if (typeof flattened?.fontSize === "number") {
    scaled.fontSize = getNativeFontSize(
      flattened.fontSize,
      textScale,
      systemFontScale,
      Platform.OS,
      Platform.Version,
    );
  } else if (!hasClassName) {
    scaled.fontSize = getNativeFontSize(
      14,
      textScale,
      systemFontScale,
      Platform.OS,
      Platform.Version,
    );
  }
  if (typeof flattened?.lineHeight === "number") {
    scaled.lineHeight = getNativeFontSize(
      flattened.lineHeight,
      textScale,
      systemFontScale,
      Platform.OS,
      Platform.Version,
    );
  }
  return scaled;
}
