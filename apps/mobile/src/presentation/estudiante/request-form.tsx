import { useRef, useState, type Ref } from 'react';
import {
  AccessibilityInfo,
  Keyboard,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { StudentAction } from './student-screen';
import { StudentText as Text, useStudentFont } from './student-text';
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
      className={`min-h-[52px] flex-row items-center gap-2 p-2 border-2 rounded-lg active:opacity-75 focus:border-student-focus ${selected ? 'border-student-primary bg-student-muted' : 'border-student-border bg-student-surface'}`}
    >
      <View
        accessible={false}
        className={`w-6 h-6 border-2 items-center justify-center ${single ? 'rounded-full' : 'rounded'} ${selected ? 'border-student-primary bg-student-primary' : 'border-student-outline'}`}
      >
        {selected ? (
          <Text accessible={false} className="text-white text-base leading-5">
            ✓
          </Text>
        ) : null}
      </View>
      <Text className="text-student-text text-base leading-[26px] shrink">
        {label}
      </Text>
    </Pressable>
  );
}

function ErrorText({ message }: { message?: string }) {
  return message ? (
    <Text
      accessibilityRole="alert"
      className="text-student-error text-base leading-[26px]"
    >
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
      | keyof RequestFormValues
      | undefined;
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
      <View className="gap-2">
        <Text
          weight="semibold"
          nativeID={`${key}-label`}
          className="text-student-text text-lg leading-[26px]"
        >
          {label}
        </Text>
        <Text className="text-student-secondary text-base leading-[26px]">
          {hint}
        </Text>
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
          className={`border-2 rounded-lg bg-student-surface text-student-text p-4 text-base leading-[26px] ${multiline ? 'min-h-28' : 'min-h-[52px]'} ${focusedField === key ? 'border-student-focus' : errors[key] ? 'border-student-error' : 'border-student-outline'}`}
          style={{ fontFamily }}
          textAlignVertical={multiline ? 'top' : 'center'}
          autoCapitalize={key.startsWith('available') ? 'none' : 'sentences'}
        />
        {errors[key] && (
          <Text
            nativeID={`${key}-error`}
            accessibilityRole="alert"
            className="text-student-error text-base leading-[26px]"
          >
            {errors[key]}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View
      className="gap-6"
      onLayout={(event) => {
        formTop.current = event.nativeEvent.layout.y;
      }}
    >
      <View className="p-4 gap-2 bg-student-muted rounded-xl">
        <Text
          weight="semibold"
          className="text-student-primary text-lg leading-[26px]"
        >
          Formulario de prueba
        </Text>
        <Text className="text-student-secondary text-base leading-[26px]">
          Usa datos ficticios. Puedes revisar los campos, pero todavía no enviar
          la solicitud. Los cambios se pierden al salir.
        </Text>
      </View>
      <Text className="text-student-secondary text-base leading-[26px]">
        Los campos marcados con * son obligatorios. No incluyas diagnósticos,
        RUT ni certificados.
      </Text>
      <View className="gap-4 p-4 rounded-xl border border-student-border bg-student-surface">
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

      <View className="gap-4 p-4 rounded-xl border border-student-border bg-student-surface">
        <Text
          weight="semibold"
          accessibilityRole="header"
          className="text-student-text text-lg leading-[26px]"
        >
          Necesidades de acceso
        </Text>
        <Text className="text-student-secondary text-base leading-[26px]">
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
        className="gap-4 p-4 rounded-xl border border-student-border bg-student-surface"
        onLayout={(event) => {
          groupTop.current.modalityPreference = event.nativeEvent.layout.y;
        }}
      >
        <Text
          weight="semibold"
          accessibilityRole="header"
          className="text-student-text text-lg leading-[26px]"
        >
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
        className="gap-4 p-4 rounded-xl border border-student-border bg-student-surface"
        onLayout={(event) => {
          groupTop.current.preferredWeekdays = event.nativeEvent.layout.y;
        }}
      >
        <Text
          weight="semibold"
          accessibilityRole="header"
          className="text-student-text text-lg leading-[26px]"
        >
          Disponibilidad general *
        </Text>
        <Text className="text-student-secondary text-base leading-[26px]">
          Selecciona los días que te acomodan. Esta preferencia no reserva una
          hora.
        </Text>
        <View className="flex-row flex-wrap gap-2">
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
        <Text className="text-student-secondary text-base leading-[26px]">
          Opcional. Indica una franja común para los días seleccionados, usando
          el formato de 24 horas.
        </Text>
        {field('availableFrom', 'Desde', 'Formato HH:MM, por ejemplo 09:00.')}
        {field('availableTo', 'Hasta', 'Formato HH:MM, por ejemplo 13:00.')}
      </View>
      <View className="gap-4 p-4 rounded-xl border border-student-border bg-student-surface">
        {field(
          'preferredAccessibleInformationChannel',
          '¿Cómo prefieres recibir información? *',
          'Por ejemplo, correo con texto accesible. Describe el medio, sin ingresar tu dirección ni teléfono.',
          true,
        )}
      </View>
      <Text className="text-student-secondary text-base leading-[26px]">
        El nombre y correo se obtendrán de la cuenta institucional cuando esté
        disponible el inicio de sesión.
      </Text>
      {reviewed && Object.keys(errors).length > 0 && (
        <Text
          accessibilityRole="alert"
          className="text-student-error text-base leading-[26px]"
        >
          Hay campos por revisar. Corrige los mensajes indicados arriba.
        </Text>
      )}
      {checked && (
        <Text
          accessibilityLiveRegion="polite"
          className="text-student-success text-lg leading-[29px]"
        >
          Campos revisados. La solicitud todavía no se ha enviado.
        </Text>
      )}
      <StudentAction label="Revisar formulario" onPress={review} />
    </View>
  );
}
