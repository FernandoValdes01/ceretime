import { useRef, useState, type Ref } from 'react';
import {
  AccessibilityInfo,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Action } from '../components/screen';
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
  return (
    <Pressable
      ref={controlRef}
      tabIndex={0}
      accessibilityRole={single ? 'radio' : 'checkbox'}
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.selected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.choiceText}>
        {selected ? '✓ ' : ''}
        {label}
      </Text>
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
        <Text nativeID={`${key}-label`} style={styles.label}>
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
          multiline={multiline}
          style={[
            styles.input,
            multiline && styles.multiline,
            errors[key] && styles.invalid,
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
        <Text style={styles.noticeTitle}>Formulario de prueba</Text>
        <Text style={styles.hint}>
          Usa datos ficticios. Puedes revisar los campos, pero todavía no enviar
          la solicitud. Los cambios se pierden al salir.
        </Text>
      </View>
      <Text style={styles.hint}>
        Los campos marcados con * son obligatorios. No incluyas diagnósticos,
        RUT ni certificados.
      </Text>
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

      <View style={styles.field}>
        <Text accessibilityRole="header" style={styles.label}>
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
        style={styles.field}
        onLayout={(event) => {
          groupTop.current.modalityPreference = event.nativeEvent.layout.y;
        }}
      >
        <Text accessibilityRole="header" style={styles.label}>
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
        style={styles.field}
        onLayout={(event) => {
          groupTop.current.preferredWeekdays = event.nativeEvent.layout.y;
        }}
      >
        <Text accessibilityRole="header" style={styles.label}>
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
      {field(
        'preferredAccessibleInformationChannel',
        '¿Cómo prefieres recibir información? *',
        'Por ejemplo, correo con texto accesible. Describe el medio, sin ingresar tu dirección ni teléfono.',
        true,
      )}
      <Text style={styles.hint}>
        El nombre y correo se obtendrán de la cuenta institucional cuando esté
        disponible el inicio de sesión.
      </Text>
      {reviewed && Object.keys(errors).length > 0 && (
        <Text accessibilityRole="alert" style={styles.error}>
          Hay campos por revisar. Corrige los mensajes indicados arriba.
        </Text>
      )}
      <Action label="Revisar formulario" onPress={review} />
      {checked && (
        <Text accessibilityLiveRegion="polite" style={styles.success}>
          Campos revisados. La solicitud todavía no se ha enviado.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 24 },
  field: { gap: 10 },
  label: { color: '#182C31', fontSize: 18, fontWeight: '600' },
  hint: { color: '#42565B', fontSize: 16, lineHeight: 24 },
  input: {
    borderWidth: 1,
    borderColor: '#687E83',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    color: '#182C31',
    minHeight: 52,
    padding: 14,
    fontSize: 17,
  },
  multiline: { minHeight: 112 },
  invalid: { borderColor: '#A32626', borderWidth: 2 },
  error: { color: '#A32626', fontSize: 16, lineHeight: 24 },
  choice: {
    minHeight: 52,
    justifyContent: 'center',
    padding: 14,
    borderWidth: 1,
    borderColor: '#687E83',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  selected: { borderColor: '#246259', backgroundColor: '#E0EFEA' },
  pressed: { opacity: 0.75 },
  choiceText: { color: '#182C31', fontSize: 17 },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  notice: { padding: 16, gap: 8, backgroundColor: '#E0EFEA', borderRadius: 10 },
  noticeTitle: { color: '#182C31', fontSize: 17, fontWeight: '600' },
  success: { color: '#17483F', fontSize: 17, lineHeight: 26 },
});
