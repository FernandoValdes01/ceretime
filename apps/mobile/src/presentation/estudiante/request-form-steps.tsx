// Contenido de cada paso del formulario de solicitud y sus controles. El estado, la validación y el foco
// viven en `RequestForm`; estos componentes solo dibujan lo que reciben.
import { useState, type PropsWithChildren, type Ref } from "react";
import { Pressable, TextInput, View, type LayoutChangeEvent } from "react-native";
import type { AccessNeed } from "@/domain/request-models";
import { AppIcon } from "../components/app-icon";
import { StudentText as Text, useStudentFont } from "./student-text";
import type { RequestFormErrors, RequestFormValues } from "./request-form-state";

const accessOptions: readonly AccessNeed[] = [
  { id: "written-communication", label: "Comunicación escrita" },
  { id: "sign-language-interpreter", label: "Intérprete de lengua de señas" },
  { id: "physically-accessible-room", label: "Sala físicamente accesible" },
  { id: "reduced-stimulation", label: "Reducción de estímulos" },
  { id: "extended-communication-time", label: "Más tiempo para comunicarme" },
  { id: "support-person", label: "Persona de apoyo" },
];
const weekdays = [
  { label: "Lunes", value: 1 },
  { label: "Martes", value: 2 },
  { label: "Miércoles", value: 3 },
  { label: "Jueves", value: 4 },
  { label: "Viernes", value: 5 },
  { label: "Sábado", value: 6 },
  { label: "Domingo", value: 0 },
] as const;
const weekdayLabelByValue = new Map<number, string>(
  weekdays.map(({ label, value }) => [value, label]),
);

export type RequestTextFieldKey =
  | "needSummary"
  | "expectedOutcome"
  | "otherAccessNeed"
  | "availableFrom"
  | "availableTo"
  | "preferredAccessibleInformationChannel";

export type RequestChoiceGroup = "accessNeeds" | "modalityPreference" | "preferredWeekdays";

// Lo que el formulario conecta a cada campo de texto: valor, error, edición y registro del input para el foco.
export interface RequestTextFieldBinding {
  readonly fieldKey: RequestTextFieldKey;
  readonly value: string;
  readonly error?: string;
  readonly disabled: boolean;
  readonly onChangeText: (value: string) => void;
  readonly onFocus?: (inputHandle: number) => void;
  readonly inputRef: (input: TextInput | null) => void;
}

export type BindRequestTextField = (key: RequestTextFieldKey) => RequestTextFieldBinding;

type UpdateRequestValue = <K extends keyof RequestFormValues>(
  key: K,
  value: RequestFormValues[K],
) => void;

// Datos comunes de los pasos con grupos de opciones. `onGroupLayout` guarda la posición de cada grupo
// para desplazar la pantalla hasta él cuando tiene un error.
interface ChoiceStepProps {
  readonly values: RequestFormValues;
  readonly errors: RequestFormErrors;
  readonly disabled: boolean;
  readonly update: UpdateRequestValue;
  readonly bindField: BindRequestTextField;
  readonly onGroupLayout: (group: RequestChoiceGroup, y: number) => void;
}

function FormCard({
  children,
  onLayout,
}: PropsWithChildren<{ readonly onLayout?: (event: LayoutChangeEvent) => void }>) {
  return (
    <View
      className="gap-4 p-4 rounded-xl border border-student-border bg-student-surface"
      style={{ borderCurve: "continuous" }}
      onLayout={onLayout}
    >
      {children}
    </View>
  );
}

function GroupTitle({ children }: PropsWithChildren) {
  return (
    <Text
      weight="semibold"
      accessibilityRole="header"
      className="text-student-text text-lg leading-[26px]"
    >
      {children}
    </Text>
  );
}

// Casilla o botón de radio accesible; el error se incluye en el nombre que anuncia el lector.
function Choice({
  label,
  selected,
  onPress,
  single = false,
  controlRef,
  disabled = false,
  error,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  single?: boolean;
  controlRef?: Ref<View>;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <Pressable
      ref={controlRef}
      tabIndex={disabled ? -1 : 0}
      accessibilityRole={single ? "radio" : "checkbox"}
      accessibilityLabel={error ? `${label}. Error: ${error}` : label}
      accessibilityState={{ checked: selected, disabled }}
      onPress={onPress}
      disabled={disabled}
      className={`min-h-[52px] flex-row items-center gap-2 p-2 border-2 rounded-lg active:opacity-75 focus:border-student-focus ${disabled ? "opacity-60" : ""} ${selected ? "border-student-primary bg-student-muted" : "border-student-border bg-student-surface"}`}
      style={{ borderCurve: "continuous" }}
    >
      <View
        accessible={false}
        className={`w-6 h-6 border-2 items-center justify-center ${single ? "rounded-full" : "rounded"} ${selected ? "border-student-primary bg-student-primary" : "border-student-outline"}`}
        style={single ? undefined : { borderCurve: "continuous" }}
      >
        {selected ? <AppIcon accessible={false} name="check" color="#FFFFFF" size={16} /> : null}
      </View>
      <Text className="text-student-text text-base leading-[26px] shrink">{label}</Text>
    </Pressable>
  );
}

function ErrorText({ message }: { message?: string }) {
  return message ? (
    <Text
      selectable
      accessibilityRole="alert"
      className="text-student-error text-base leading-[26px]"
    >
      {message}
    </Text>
  ) : null;
}

// Campo de texto con etiqueta, ayuda y error anunciados en un solo nombre accesible.
function RequestTextField({
  fieldKey,
  value,
  error,
  disabled,
  onChangeText,
  onFocus,
  inputRef,
  label,
  hint,
  multiline = false,
}: RequestTextFieldBinding & {
  readonly label: string;
  readonly hint: string;
  readonly multiline?: boolean;
}) {
  const fontFamily = useStudentFont();
  const [focused, setFocused] = useState(false);
  const borderClass = focused
    ? "border-student-focus"
    : error
      ? "border-student-error"
      : "border-student-outline";

  return (
    <View className="gap-2">
      <Text
        weight="semibold"
        nativeID={`${fieldKey}-label`}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="text-student-text text-lg leading-[26px]"
      >
        {label}
      </Text>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="text-student-secondary text-base leading-[26px]"
      >
        {hint}
      </Text>
      <TextInput
        ref={inputRef}
        accessibilityLabel={error ? `${label}. Error: ${error}` : label}
        accessibilityHint={hint}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${fieldKey}-error` : undefined}
        value={value}
        onChangeText={onChangeText}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event.nativeEvent.target);
        }}
        onBlur={() => setFocused(false)}
        editable={!disabled}
        accessibilityState={{ disabled }}
        multiline={multiline}
        className={`border-2 rounded-lg bg-student-surface text-student-text p-4 text-base leading-[26px] ${disabled ? "opacity-60" : ""} ${multiline ? "min-h-28" : "min-h-[52px]"} ${borderClass}`}
        style={{ fontFamily, borderCurve: "continuous" }}
        textAlignVertical={multiline ? "top" : "center"}
        autoCapitalize={fieldKey.startsWith("available") ? "none" : "sentences"}
      />
      {error && (
        <Text
          selectable
          nativeID={`${fieldKey}-error`}
          accessibilityRole="alert"
          className="text-student-error text-base leading-[26px]"
        >
          {error}
        </Text>
      )}
    </View>
  );
}

// Agrega el elemento si no está o lo quita si ya estaba.
function toggleItem<T>(items: readonly T[], item: T, isSame: (current: T) => boolean): T[] {
  return items.some(isSame) ? items.filter((current) => !isSame(current)) : [...items, item];
}

// Paso 1: la necesidad y el resultado esperado.
export function NeedStep({ bindField }: { readonly bindField: BindRequestTextField }) {
  return (
    <>
      <Text className="text-student-secondary text-base leading-[26px]">
        Los campos marcados con * son obligatorios. No incluyas diagnósticos, RUT ni certificados.
      </Text>
      <FormCard>
        <RequestTextField
          {...bindField("needSummary")}
          label="¿Qué necesidad quieres abordar? *"
          hint="Describe la barrera o dificultad que encuentras."
          multiline
        />
        <RequestTextField
          {...bindField("expectedOutcome")}
          label="¿Qué esperas de CERETI? *"
          hint="Cuéntanos qué te gustaría lograr con el acompañamiento."
          multiline
        />
      </FormCard>
    </>
  );
}

// Paso 2: apoyos de la lista o uno descrito libremente; basta con uno de los dos.
export function AccessStep({
  values,
  errors,
  disabled,
  update,
  bindField,
  onGroupLayout,
  accessControl,
}: ChoiceStepProps & { readonly accessControl: Ref<View> }) {
  return (
    <FormCard onLayout={(event) => onGroupLayout("accessNeeds", event.nativeEvent.layout.y)}>
      <GroupTitle>Necesidades de acceso *</GroupTitle>
      {accessOptions.map((option, index) => (
        <Choice
          controlRef={index === 0 ? accessControl : undefined}
          error={errors.accessNeeds}
          key={option.id}
          label={option.label}
          selected={values.accessNeeds.some((need) => need.id === option.id)}
          disabled={disabled}
          onPress={() =>
            update(
              "accessNeeds",
              toggleItem(values.accessNeeds, option, (need) => need.id === option.id),
            )
          }
        />
      ))}
      <RequestTextField
        {...bindField("otherAccessNeed")}
        label="Otra necesidad de acceso"
        hint="Opcional. Puedes describir un apoyo que no aparezca en la lista."
        multiline
      />
      <ErrorText message={errors.accessNeeds} />
    </FormCard>
  );
}

// Paso 3: modalidad, días y una franja horaria opcional. No reserva una atención.
export function AvailabilityStep({
  values,
  errors,
  disabled,
  update,
  bindField,
  onGroupLayout,
  modalityControl,
  weekdayControl,
}: ChoiceStepProps & { readonly modalityControl: Ref<View>; readonly weekdayControl: Ref<View> }) {
  return (
    <>
      <FormCard
        onLayout={(event) => onGroupLayout("modalityPreference", event.nativeEvent.layout.y)}
      >
        <GroupTitle>Modalidad preferida *</GroupTitle>
        <Choice
          error={errors.modalityPreference}
          controlRef={modalityControl}
          label="Presencial"
          single
          selected={values.modalityPreference === "inPerson"}
          disabled={disabled}
          onPress={() => update("modalityPreference", "inPerson")}
        />
        <Choice
          error={errors.modalityPreference}
          label="En línea"
          single
          selected={values.modalityPreference === "online"}
          disabled={disabled}
          onPress={() => update("modalityPreference", "online")}
        />
        <ErrorText message={errors.modalityPreference} />
      </FormCard>

      <FormCard
        onLayout={(event) => onGroupLayout("preferredWeekdays", event.nativeEvent.layout.y)}
      >
        <GroupTitle>Disponibilidad general *</GroupTitle>
        <View className="flex-row flex-wrap gap-2">
          {weekdays.map(({ label, value }, index) => (
            <Choice
              error={errors.preferredWeekdays}
              controlRef={index === 0 ? weekdayControl : undefined}
              key={label}
              label={label}
              selected={values.preferredWeekdays.includes(value)}
              disabled={disabled}
              onPress={() =>
                update(
                  "preferredWeekdays",
                  toggleItem(values.preferredWeekdays, value, (day) => day === value),
                )
              }
            />
          ))}
        </View>
        <ErrorText message={errors.preferredWeekdays} />
        <Text className="text-student-secondary text-base leading-[26px]">
          Opcional. Indica una franja común para los días seleccionados, usando el formato de 24
          horas.
        </Text>
        <RequestTextField
          {...bindField("availableFrom")}
          label="Desde"
          hint="Formato HH:MM, por ejemplo 09:00."
        />
        <RequestTextField
          {...bindField("availableTo")}
          label="Hasta"
          hint="Formato HH:MM, por ejemplo 13:00."
        />
      </FormCard>
    </>
  );
}

// Paso 4: el medio accesible para recibir información, sin datos de contacto.
export function InformationStep({ bindField }: { readonly bindField: BindRequestTextField }) {
  return (
    <FormCard>
      <RequestTextField
        {...bindField("preferredAccessibleInformationChannel")}
        label="¿Cómo prefieres recibir información? *"
        hint="Por ejemplo, correo con texto accesible. Describe el medio, sin ingresar tu dirección ni teléfono."
        multiline
      />
    </FormCard>
  );
}

function SummaryItem({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View className="gap-1 border-b border-student-border py-3">
      <Text weight="semibold" className="text-student-secondary text-base leading-[26px]">
        {label}
      </Text>
      <Text selectable className="text-student-text text-lg leading-[29px]">
        {value}
      </Text>
    </View>
  );
}

// Paso 5: resumen de lo ingresado antes de enviar.
export function ReviewStep({ values }: { readonly values: RequestFormValues }) {
  const preferredWeekdays = values.preferredWeekdays
    .flatMap((day) => {
      const label = weekdayLabelByValue.get(day);
      return label ? [label] : [];
    })
    .join(", ");
  const otherAccessNeed = values.otherAccessNeed.trim();
  const accessNeedsSummary = [
    ...values.accessNeeds.map(({ label }) => label),
    ...(otherAccessNeed ? [otherAccessNeed] : []),
  ].join(", ");
  const timeRangeSummary = values.availableFrom.trim()
    ? `${values.availableFrom.trim()} a ${values.availableTo.trim()}`
    : "Sin preferencia de horario";

  return (
    <>
      <View
        className="gap-1 p-4 rounded-xl border border-student-border bg-student-surface"
        style={{ borderCurve: "continuous" }}
      >
        <SummaryItem label="Necesidad que quieres abordar" value={values.needSummary.trim()} />
        <SummaryItem label="Resultado esperado" value={values.expectedOutcome.trim()} />
        <SummaryItem label="Necesidades de acceso" value={accessNeedsSummary} />
        <SummaryItem
          label="Modalidad preferida"
          value={values.modalityPreference === "inPerson" ? "Presencial" : "En línea"}
        />
        <SummaryItem label="Días preferidos" value={preferredWeekdays} />
        <SummaryItem label="Franja horaria" value={timeRangeSummary} />
        <SummaryItem
          label="Medio preferido para recibir información"
          value={values.preferredAccessibleInformationChannel.trim()}
        />
      </View>
      <Text className="text-student-secondary text-base leading-[26px]">
        El nombre y correo se obtendrán de la cuenta institucional cuando esté disponible el inicio
        de sesión.
      </Text>
    </>
  );
}
