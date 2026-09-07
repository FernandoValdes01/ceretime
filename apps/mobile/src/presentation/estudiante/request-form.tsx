import { useRef, useState, type Ref } from 'react';
import {
  AccessibilityInfo,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { StudentAction } from './student-screen';
import { StudentText as Text, useStudentFont } from './student-text';
import { studentTheme as theme } from '../../theme';
import {
  initialRequestValues,
  validateRequestForm,
  type RequestFormErrors,
  type RequestFormValues,
} from './request-form-state';

const accessOptions = [
  'Comunicación escrita',
  'Intérprete de lengua de señas',
  'Sala físicamente accesible',
  'Reducción de estímulos',
  'Más tiempo para comunicarme',
  'Persona de apoyo',
];
const weekdays = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];

function Choice({
  label,
  selected,
  onPress,
  single = false,
  controlRef,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  single?: boolean;
  controlRef?: Ref<View>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      ref={controlRef}
      tabIndex={0}
      accessibilityRole={single ? 'radio' : 'checkbox'}
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.selected,
        pressed && styles.pressed,
        focused && styles.focused,
      ]}
    >
      <View
        accessible={false}
        style={[
          styles.indicator,
          single && styles.radio,
          selected && styles.checkedIndicator,
        ]}
      >
        {selected ? (
          <Text accessible={false} style={styles.check}>
            ✓
          </Text>
        ) : null}
      </View>
      <Text style={styles.choiceText}>{label}</Text>
    </Pressable>
  );
}

function ErrorText({ message }: { message?: string }) {
  return message ? (
    <Text accessibilityRole="alert" style={styles.error}>
      {message}
    </Text>
  ) : null;
}

export function RequestForm({
  onRevealGroup,
}: {
  onRevealGroup: (y: number) => void;
}) {
  const fontFamily = useStudentFont();
  const [focusedField, setFocusedField] = useState<
    keyof RequestFormValues | null
  >(null);
  const [values, setValues] = useState<RequestFormValues>(initialRequestValues);
  const [reviewed, setReviewed] = useState(false);
  const [checked, setChecked] = useState(false);
  const inputs = useRef<
    Partial<Record<keyof RequestFormValues, TextInput | null>>
  >({});
  const errors: RequestFormErrors = reviewed ? validateRequestForm(values) : {};
  const formTop = useRef(0);
  const groupTop = useRef({ modalityPreference: 0, preferredWeekdays: 0 });
  const modalityControl = useRef<View>(null);
  const weekdayControl = useRef<View>(null);

  function update<K extends keyof RequestFormValues>(
    key: K,
    value: RequestFormValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
    setChecked(false);
  }

  function review() {
    const nextErrors = validateRequestForm(values);
    setReviewed(true);
    const firstError = Object.keys(nextErrors)[0] as
      keyof RequestFormValues | undefined;
    if (firstError) {
      setChecked(false);
      if (
        firstError === 'modalityPreference' ||
        firstError === 'preferredWeekdays'
      ) {
        Keyboard.dismiss();
        const control =
          firstError === 'modalityPreference'
            ? modalityControl
            : weekdayControl;
        requestAnimationFrame(() => {
          onRevealGroup(formTop.current + groupTop.current[firstError]);
          if (control.current) {
            if (Platform.OS === 'web') control.current.focus();
            else
              AccessibilityInfo.sendAccessibilityEvent(
                control.current,
                'focus',
              );
          }
        });
      } else inputs.current[firstError]?.focus();
      AccessibilityInfo.announceForAccessibility(
        `Revisa el formulario. ${nextErrors[firstError]}`,
      );
    } else {
      Keyboard.dismiss();
      setChecked(true);
      AccessibilityInfo.announceForAccessibility(
        'Campos revisados. La solicitud todavía no se ha enviado.',
      );
    }
  }

  function field(
    key:
      | 'needSummary'
      | 'expectedOutcome'
      | 'otherAccessNeed'
      | 'availableFrom'
      | 'availableTo'
      | 'preferredAccessibleInformationChannel',
    label: string,
    hint: string,
    multiline = false,
  ) {
    return (
      <View style={styles.field}>
        <Text weight="semibold" nativeID={`${key}-label`} style={styles.label}>
          {label}
        </Text>
        <Text style={styles.hint}>{hint}</Text>
        <TextInput
          ref={(input) => {
            inputs.current[key] = input;
          }}
          accessibilityLabel={label}
          accessibilityHint={errors[key] ?? hint}
          aria-invalid={Boolean(errors[key])}
          aria-describedby={errors[key] ? `${key}-error` : undefined}
          value={values[key]}
          onChangeText={(value) => update(key, value)}
          onFocus={() => setFocusedField(key)}
          onBlur={() => setFocusedField(null)}
          multiline={multiline}
          style={[
            styles.input,
            multiline && styles.multiline,
            errors[key] && styles.invalid,
            focusedField === key && styles.focused,
            { fontFamily },
          ]}
          textAlignVertical={multiline ? 'top' : 'center'}
          autoCapitalize={key.startsWith('available') ? 'none' : 'sentences'}
        />
        {errors[key] && (
          <Text
            nativeID={`${key}-error`}
            accessibilityRole="alert"
            style={styles.error}
          >
            {errors[key]}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View
      style={styles.form}
      onLayout={(event) => {
        formTop.current = event.nativeEvent.layout.y;
      }}
    >
      <View style={styles.notice}>
        <Text weight="semibold" style={styles.noticeTitle}>
          Formulario de prueba
        </Text>
        <Text style={styles.hint}>
          Usa datos ficticios. Puedes revisar los campos, pero todavía no enviar
          la solicitud. Los cambios se pierden al salir.
        </Text>
      </View>
      <Text style={styles.hint}>
        Los campos marcados con * son obligatorios. No incluyas diagnósticos,
        RUT ni certificados.
      </Text>
      <View style={styles.section}>
        {field(
          'needSummary',
          '¿Qué necesidad quieres abordar? *',
          'Describe la barrera o dificultad que encuentras.',
          true,
        )}
        {field(
          'expectedOutcome',
          '¿Qué esperas de CERETI? *',
          'Cuéntanos qué te gustaría lograr con el acompañamiento.',
          true,
        )}
      </View>

      <View style={styles.section}>
        <Text weight="semibold" accessibilityRole="header" style={styles.label}>
          Necesidades de acceso
        </Text>
        <Text style={styles.hint}>
          Opcional. Selecciona todos los apoyos que necesitas para participar o
          comunicarte.
        </Text>
        {accessOptions.map((label) => (
          <Choice
            key={label}
            label={label}
            selected={values.accessNeeds.includes(label)}
            onPress={() =>
              update(
                'accessNeeds',
                values.accessNeeds.includes(label)
                  ? values.accessNeeds.filter((value) => value !== label)
                  : [...values.accessNeeds, label],
              )
            }
          />
        ))}
        {field(
          'otherAccessNeed',
          'Otra necesidad de acceso',
          'Opcional. Puedes describir un apoyo que no aparezca en la lista.',
          true,
        )}
      </View>

      <View
        style={styles.section}
        onLayout={(event) => {
          groupTop.current.modalityPreference = event.nativeEvent.layout.y;
        }}
      >
        <Text weight="semibold" accessibilityRole="header" style={styles.label}>
          Modalidad preferida *
        </Text>
        <Choice
          controlRef={modalityControl}
          label="Presencial"
          single
          selected={values.modalityPreference === 'inPerson'}
          onPress={() => update('modalityPreference', 'inPerson')}
        />
        <Choice
          label="En línea"
          single
          selected={values.modalityPreference === 'online'}
          onPress={() => update('modalityPreference', 'online')}
        />
        <ErrorText message={errors.modalityPreference} />
      </View>

      <View
        style={styles.section}
        onLayout={(event) => {
          groupTop.current.preferredWeekdays = event.nativeEvent.layout.y;
        }}
      >
        <Text weight="semibold" accessibilityRole="header" style={styles.label}>
          Disponibilidad general *
        </Text>
        <Text style={styles.hint}>
          Selecciona los días que te acomodan. Esta preferencia no reserva una
          hora.
        </Text>
        <View style={styles.days}>
          {weekdays.map((label, index) => {
            const day = (index + 1) % 7;
            return (
              <Choice
                controlRef={index === 0 ? weekdayControl : undefined}
                key={label}
                label={label}
                selected={values.preferredWeekdays.includes(day)}
                onPress={() =>
                  update(
                    'preferredWeekdays',
                    values.preferredWeekdays.includes(day)
                      ? values.preferredWeekdays.filter(
                          (value) => value !== day,
                        )
                      : [...values.preferredWeekdays, day],
                  )
                }
              />
            );
          })}
        </View>
        <ErrorText message={errors.preferredWeekdays} />
        <Text style={styles.hint}>
          Opcional. Indica una franja común para los días seleccionados, usando
          el formato de 24 horas.
        </Text>
        {field('availableFrom', 'Desde', 'Formato HH:MM, por ejemplo 09:00.')}
        {field('availableTo', 'Hasta', 'Formato HH:MM, por ejemplo 13:00.')}
      </View>
      <View style={styles.section}>
        {field(
          'preferredAccessibleInformationChannel',
          '¿Cómo prefieres recibir información? *',
          'Por ejemplo, correo con texto accesible. Describe el medio, sin ingresar tu dirección ni teléfono.',
          true,
        )}
      </View>
      <Text style={styles.hint}>
        El nombre y correo se obtendrán de la cuenta institucional cuando esté
        disponible el inicio de sesión.
      </Text>
      {reviewed && Object.keys(errors).length > 0 && (
        <Text accessibilityRole="alert" style={styles.error}>
          Hay campos por revisar. Corrige los mensajes indicados arriba.
        </Text>
      )}
      {checked && (
        <Text accessibilityLiveRegion="polite" style={styles.success}>
          Campos revisados. La solicitud todavía no se ha enviado.
        </Text>
      )}
      <StudentAction label="Revisar formulario" onPress={review} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: theme.spacing.large },
  field: { gap: theme.spacing.small },
  section: {
    gap: theme.spacing.medium,
    padding: theme.spacing.medium,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  label: { color: theme.colors.text, fontSize: 18, lineHeight: 26 },
  hint: { color: theme.colors.textSecondary, fontSize: 16, lineHeight: 26 },
  input: {
    borderWidth: 2,
    borderColor: theme.colors.outline,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    minHeight: 52,
    padding: theme.spacing.medium,
    fontSize: 16,
    lineHeight: 26,
  },
  multiline: { minHeight: 112 },
  invalid: { borderColor: theme.colors.error },
  focused: { borderColor: theme.colors.focus },
  error: { color: theme.colors.error, fontSize: 16, lineHeight: 26 },
  choice: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.small,
    padding: theme.spacing.small,
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.surface,
  },
  selected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.surfaceLow,
  },
  indicator: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: theme.colors.outline,
    borderRadius: theme.radius.indicator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radio: { borderRadius: theme.radius.round },
  checkedIndicator: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary,
  },
  check: { color: theme.colors.onPrimary, fontSize: 16, lineHeight: 20 },
  pressed: { opacity: 0.75 },
  choiceText: {
    color: theme.colors.text,
    fontSize: 16,
    lineHeight: 26,
    flexShrink: 1,
  },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.small },
  notice: {
    padding: theme.spacing.medium,
    gap: theme.spacing.small,
    backgroundColor: theme.colors.surfaceLow,
    borderRadius: theme.radius.card,
  },
  noticeTitle: { color: theme.colors.primary, fontSize: 18, lineHeight: 26 },
  success: { color: theme.colors.primaryPressed, fontSize: 18, lineHeight: 29 },
});
