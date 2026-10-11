import { useState } from "react";

import { Pressable, StyleSheet, View } from "react-native";

import type { AccessibilityPreferences } from "../../application/accessibility-preferences-models";
import { getAccessibilityColorPalette } from "./accessibility-color-palette";
import { useAccessibilityPreferences } from "./accessibility-preferences-provider";
import { Action, Screen } from "../components/screen";
import { StudentText } from "../estudiante/student-text";

type PreferenceValue = AccessibilityPreferences[keyof AccessibilityPreferences];

interface PreferenceOption<Value extends PreferenceValue> {
  readonly value: Value;
  readonly label: string;
}

interface PreferenceOptionsProps<Value extends PreferenceValue> {
  readonly title: string;
  readonly accessibilityPrefix: string;
  readonly options: readonly PreferenceOption<Value>[];
  readonly value: Value;
  readonly disabled: boolean;
  readonly onChange: (value: Value) => void;
}

const textScaleOptions: readonly PreferenceOption<AccessibilityPreferences["textScale"]>[] = [
  { value: "system", label: "Seguir el sistema" },
  { value: 1, label: "100 %" },
  { value: 1.5, label: "150 %" },
  { value: 2, label: "200 %" },
];

const contrastOptions: readonly PreferenceOption<AccessibilityPreferences["highContrast"]>[] = [
  { value: "system", label: "Seguir el sistema" },
  { value: "on", label: "Activado" },
  { value: "off", label: "Desactivado" },
];

const motionOptions: readonly PreferenceOption<AccessibilityPreferences["reduceMotion"]>[] = [
  { value: "system", label: "Seguir el sistema" },
  { value: "on", label: "Reducir movimiento" },
  { value: "off", label: "Permitir movimiento" },
];

export function AccessibilityPreferencesScreen() {
  const { preferences, effective, status, error, updatePreferences } =
    useAccessibilityPreferences();
  const [saved, setSaved] = useState(false);
  const isBusy = status !== "ready";
  const colors = getAccessibilityColorPalette(effective.highContrast);

  async function save(patch: Partial<AccessibilityPreferences>) {
    setSaved(false);
    if (await updatePreferences(patch)) setSaved(true);
  }

  const textScale = `${Math.round(effective.textScale * 100)} %`;
  const highContrast = effective.highContrast ? "activado" : "desactivado";
  const reducedMotion = effective.reduceMotion ? "activada" : "desactivada";

  return (
    <Screen
      description="Estos ajustes se aplican en todas tus vistas y se guardan en este dispositivo."
      headerTitle="CERETI"
      showAppHeader
      showPreferencesAction={false}
      title="Preferencias de accesibilidad"
    >
      {status === "loading" ? (
        <StudentText accessibilityLiveRegion="polite" style={{ color: colors.secondary }}>
          Cargando tus preferencias…
        </StudentText>
      ) : null}
      {status === "saving" ? (
        <StudentText accessibilityLiveRegion="polite" style={{ color: colors.secondary }}>
          Guardando tus preferencias…
        </StudentText>
      ) : null}
      <View
        accessibilityLiveRegion="polite"
        style={[styles.summary, { backgroundColor: colors.muted, borderColor: colors.border }]}
      >
        <StudentText weight="semibold" style={{ color: colors.text }}>
          Configuración aplicada
        </StudentText>
        <StudentText style={{ color: colors.secondary }}>
          Texto al {textScale}, alto contraste {highContrast} y reducción de movimiento{" "}
          {reducedMotion}.
        </StudentText>
      </View>
      <PreferenceOptions
        accessibilityPrefix="Tamaño del texto"
        disabled={isBusy}
        onChange={(value) => void save({ textScale: value })}
        options={textScaleOptions}
        title="Tamaño del texto"
        value={preferences.textScale}
      />
      <PreferenceOptions
        accessibilityPrefix="Contraste"
        disabled={isBusy}
        onChange={(value) => void save({ highContrast: value })}
        options={contrastOptions}
        title="Alto contraste"
        value={preferences.highContrast}
      />
      <PreferenceOptions
        accessibilityPrefix="Movimiento"
        disabled={isBusy}
        onChange={(value) => void save({ reduceMotion: value })}
        options={motionOptions}
        title="Movimiento"
        value={preferences.reduceMotion}
      />
      {error ? (
        <StudentText
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          style={[styles.feedback, { backgroundColor: colors.errorSurface, color: colors.error }]}
        >
          {error}
        </StudentText>
      ) : saved ? (
        <StudentText
          accessibilityLiveRegion="polite"
          style={[
            styles.feedback,
            { backgroundColor: colors.successSurface, color: colors.success },
          ]}
        >
          Preferencia guardada.
        </StudentText>
      ) : null}
      <Action
        disabled={isBusy}
        label="Usar valores del sistema"
        onPress={() =>
          void save({
            textScale: "system",
            highContrast: "system",
            reduceMotion: "system",
          })
        }
      />
    </Screen>
  );
}

function PreferenceOptions<Value extends PreferenceValue>({
  title,
  accessibilityPrefix,
  options,
  value,
  disabled,
  onChange,
}: PreferenceOptionsProps<Value>) {
  const [focusedValue, setFocusedValue] = useState<string | null>(null);
  const { effective } = useAccessibilityPreferences();
  const colors = getAccessibilityColorPalette(effective.highContrast);

  return (
    <View accessibilityLabel={title} accessibilityRole="radiogroup" style={styles.group}>
      <StudentText accessibilityRole="header" weight="semibold" style={{ color: colors.text }}>
        {title}
      </StudentText>
      <View style={styles.options}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              accessibilityLabel={`${accessibilityPrefix}: ${option.label}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              onFocus={() => setFocusedValue(String(option.value))}
              onBlur={() => setFocusedValue(null)}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.option,
                { backgroundColor: colors.surface, borderColor: colors.border },
                selected && { borderColor: colors.primary, borderWidth: 2 },
                focusedValue === String(option.value) && {
                  outlineWidth: 3,
                  outlineColor: colors.focus,
                  outlineOffset: 2,
                },
                pressed && !disabled && { backgroundColor: colors.muted },
                disabled && styles.disabled,
              ]}
            >
              <View
                accessible={false}
                style={[styles.radio, { borderColor: selected ? colors.primary : colors.outline }]}
              >
                {selected ? (
                  <View style={[styles.radioSelected, { backgroundColor: colors.primary }]} />
                ) : null}
              </View>
              <StudentText style={[styles.optionLabel, { color: colors.text }]}>
                {option.label}
              </StudentText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    gap: 6,
    padding: 16,
    borderWidth: 1,
    borderRadius: 12,
  },
  group: { gap: 8 },
  options: { gap: 8 },
  option: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 10,
  },
  radio: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderRadius: 11,
  },
  radioSelected: { width: 10, height: 10, borderRadius: 5 },
  optionLabel: { flex: 1, fontSize: 16, lineHeight: 22 },
  feedback: { padding: 14, borderRadius: 10 },
  disabled: { opacity: 0.55 },
});
