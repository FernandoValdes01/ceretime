import { useEffect, useRef, useState, type Ref } from "react";
import { AccessibilityInfo, Keyboard, Pressable, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import type {
  AccessNeed,
  StudentRequestSubmissionReceipt,
  SubmitStudentRequestCommand,
} from "@/application/student-area-models";
import type { StudentRequestSubmitter } from "@/application/student-area-port";
import { useSubmitStudentRequest } from "@/presentation/hooks/use-submit-student-request";
import { StudentAction } from "./student-screen";
import { StudentText as Text, useStudentFont } from "./student-text";
import {
  initialRequestValues,
  validateRequestForm,
  type RequestFormErrors,
  type RequestFormValues,
} from "./request-form-state";

const accessOptions: readonly AccessNeed[] = [
  { id: "written-communication", label: "Comunicación escrita" },
  { id: "sign-language-interpreter", label: "Intérprete de lengua de señas" },
  { id: "physically-accessible-room", label: "Sala físicamente accesible" },
  { id: "reduced-stimulation", label: "Reducción de estímulos" },
  { id: "extended-communication-time", label: "Más tiempo para comunicarme" },
  { id: "support-person", label: "Persona de apoyo" },
];
const weekdays = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function Choice({
  label,
  selected,
  onPress,
  single = false,
  controlRef,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  single?: boolean;
  controlRef?: Ref<View>;
  disabled?: boolean;
}) {
  return (
    <Pressable
      ref={controlRef}
      tabIndex={disabled ? -1 : 0}
      accessibilityRole={single ? "radio" : "checkbox"}
      accessibilityLabel={label}
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
        {selected ? (
          <Text accessible={false} className="text-white text-base leading-5">
            ✓
          </Text>
        ) : null}
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

function toSubmissionCommand(values: RequestFormValues): SubmitStudentRequestCommand {
  const availableFrom = values.availableFrom.trim();
  const availableTo = values.availableTo.trim();
  const otherAccessNeed = values.otherAccessNeed.trim();

  return {
    needSummary: values.needSummary.trim(),
    expectedOutcome: values.expectedOutcome.trim(),
    accessNeeds: values.accessNeeds.map((need) => ({ ...need })),
    ...(otherAccessNeed ? { otherAccessNeed } : {}),
    generalAvailability: {
      preferredWeekdays: [...values.preferredWeekdays],
      ...(availableFrom && availableTo
        ? { preferredTimeRange: { from: availableFrom, to: availableTo } }
        : {}),
    },
    modalityPreference:
      values.modalityPreference as SubmitStudentRequestCommand["modalityPreference"],
    preferredAccessibleInformationChannel: values.preferredAccessibleInformationChannel.trim(),
  };
}

function RequestConfirmation({ receipt }: { readonly receipt: StudentRequestSubmissionReceipt }) {
  return (
    <Animated.View
      testID="request-confirmation"
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      accessibilityLiveRegion="polite"
      className="gap-5"
    >
      <View
        testID="request-confirmation-card"
        className="gap-3 p-5 rounded-xl border-2 border-student-success bg-student-surface"
        style={{ borderCurve: "continuous" }}
      >
        <Text
          weight="semibold"
          accessibilityRole="header"
          className="text-student-success text-2xl leading-[34px]"
        >
          Solicitud enviada
        </Text>
        <Text className="text-student-text text-lg leading-[29px]">
          Recibimos tu solicitud ficticia. Este envío solo existe en el simulador de la aplicación.
        </Text>
      </View>
      <View className="gap-2 p-4 rounded-xl bg-student-muted" style={{ borderCurve: "continuous" }}>
        <Text weight="semibold" className="text-student-primary text-lg leading-[26px]">
          Comprobante de prueba
        </Text>
        <Text selectable className="text-student-text text-base leading-[26px]">
          Referencia: {receipt.requestId}
        </Text>
      </View>
    </Animated.View>
  );
}

export interface RequestFormProps {
  readonly onRevealGroup: (y: number) => void;
  readonly submitter: StudentRequestSubmitter;
}

export function RequestForm({ onRevealGroup, submitter }: RequestFormProps) {
  const fontFamily = useStudentFont();
  const [focusedField, setFocusedField] = useState<keyof RequestFormValues | null>(null);
  const [values, setValues] = useState<RequestFormValues>(initialRequestValues);
  const [reviewed, setReviewed] = useState(false);
  const submission = useSubmitStudentRequest(submitter);
  const isSubmitting = submission.status === "submitting";
  const inputs = useRef<Partial<Record<keyof RequestFormValues, TextInput | null>>>({});
  const errors: RequestFormErrors = reviewed ? validateRequestForm(values) : {};
  const formTop = useRef(0);
  const groupTop = useRef({ modalityPreference: 0, preferredWeekdays: 0 });
  const modalityControl = useRef<View>(null);
  const weekdayControl = useRef<View>(null);

  function update<K extends keyof RequestFormValues>(key: K, value: RequestFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function submit() {
    const nextErrors = validateRequestForm(values);
    setReviewed(true);
    const firstError = Object.keys(nextErrors)[0] as keyof RequestFormValues | undefined;
    if (firstError) {
      if (firstError === "modalityPreference" || firstError === "preferredWeekdays") {
        Keyboard.dismiss();
        const control = firstError === "modalityPreference" ? modalityControl : weekdayControl;
        requestAnimationFrame(() => {
          onRevealGroup(formTop.current + groupTop.current[firstError]);
          if (control.current) {
            if (process.env.EXPO_OS === "web") control.current.focus();
            else AccessibilityInfo.sendAccessibilityEvent(control.current, "focus");
          }
        });
      } else inputs.current[firstError]?.focus();
      AccessibilityInfo.announceForAccessibility(`Revisa el formulario. ${nextErrors[firstError]}`);
    } else {
      Keyboard.dismiss();
      AccessibilityInfo.announceForAccessibility("Enviando solicitud ficticia.");
      void submission.submit(toSubmissionCommand(values));
    }
  }

  useEffect(() => {
    if (submission.status === "error") {
      AccessibilityInfo.announceForAccessibility(
        "No pudimos enviar la solicitud ficticia. Puedes reintentar.",
      );
    } else if (submission.status === "success") {
      AccessibilityInfo.announceForAccessibility("Solicitud ficticia enviada.");
    }
  }, [submission.status]);

  if (submission.status === "success" && submission.receipt) {
    return <RequestConfirmation receipt={submission.receipt} />;
  }

  function field(
    key:
      | "needSummary"
      | "expectedOutcome"
      | "otherAccessNeed"
      | "availableFrom"
      | "availableTo"
      | "preferredAccessibleInformationChannel",
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
        <Text className="text-student-secondary text-base leading-[26px]">{hint}</Text>
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
          editable={!isSubmitting}
          accessibilityState={{ disabled: isSubmitting }}
          multiline={multiline}
          className={`border-2 rounded-lg bg-student-surface text-student-text p-4 text-base leading-[26px] ${isSubmitting ? "opacity-60" : ""} ${multiline ? "min-h-28" : "min-h-[52px]"} ${focusedField === key ? "border-student-focus" : errors[key] ? "border-student-error" : "border-student-outline"}`}
          style={{ fontFamily, borderCurve: "continuous" }}
          textAlignVertical={multiline ? "top" : "center"}
          autoCapitalize={key.startsWith("available") ? "none" : "sentences"}
        />
        {errors[key] && (
          <Text
            selectable
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
      <View className="p-4 gap-2 bg-student-muted rounded-xl" style={{ borderCurve: "continuous" }}>
        <Text weight="semibold" className="text-student-primary text-lg leading-[26px]">
          Formulario de prueba
        </Text>
        <Text className="text-student-secondary text-base leading-[26px]">
          Usa datos ficticios. El envío se realizará solamente contra un simulador local y los
          cambios se perderán al salir.
        </Text>
      </View>
      <Text className="text-student-secondary text-base leading-[26px]">
        Los campos marcados con * son obligatorios. No incluyas diagnósticos, RUT ni certificados.
      </Text>
      <View
        className="gap-4 p-4 rounded-xl border border-student-border bg-student-surface"
        style={{ borderCurve: "continuous" }}
      >
        {field(
          "needSummary",
          "¿Qué necesidad quieres abordar? *",
          "Describe la barrera o dificultad que encuentras.",
          true,
        )}
        {field(
          "expectedOutcome",
          "¿Qué esperas de CERETI? *",
          "Cuéntanos qué te gustaría lograr con el acompañamiento.",
          true,
        )}
      </View>

      <View
        className="gap-4 p-4 rounded-xl border border-student-border bg-student-surface"
        style={{ borderCurve: "continuous" }}
      >
        <Text
          weight="semibold"
          accessibilityRole="header"
          className="text-student-text text-lg leading-[26px]"
        >
          Necesidades de acceso
        </Text>
        <Text className="text-student-secondary text-base leading-[26px]">
          Opcional. Selecciona todos los apoyos que necesitas para participar o comunicarte.
        </Text>
        {accessOptions.map((option) => {
          const selected = values.accessNeeds.some((need) => need.id === option.id);
          return (
            <Choice
              key={option.id}
              label={option.label}
              selected={selected}
              disabled={isSubmitting}
              onPress={() =>
                update(
                  "accessNeeds",
                  selected
                    ? values.accessNeeds.filter((need) => need.id !== option.id)
                    : [...values.accessNeeds, option],
                )
              }
            />
          );
        })}
        {field(
          "otherAccessNeed",
          "Otra necesidad de acceso",
          "Opcional. Puedes describir un apoyo que no aparezca en la lista.",
          true,
        )}
      </View>

      <View
        className="gap-4 p-4 rounded-xl border border-student-border bg-student-surface"
        style={{ borderCurve: "continuous" }}
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
          selected={values.modalityPreference === "inPerson"}
          disabled={isSubmitting}
          onPress={() => update("modalityPreference", "inPerson")}
        />
        <Choice
          label="En línea"
          single
          selected={values.modalityPreference === "online"}
          disabled={isSubmitting}
          onPress={() => update("modalityPreference", "online")}
        />
        <ErrorText message={errors.modalityPreference} />
      </View>

      <View
        className="gap-4 p-4 rounded-xl border border-student-border bg-student-surface"
        style={{ borderCurve: "continuous" }}
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
          Selecciona los días que te acomodan. Esta preferencia no reserva una hora.
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {weekdays.map((label, index) => {
            const day = (index + 1) % 7;
            const selected = values.preferredWeekdays.includes(day);
            return (
              <Choice
                controlRef={index === 0 ? weekdayControl : undefined}
                key={label}
                label={label}
                selected={selected}
                disabled={isSubmitting}
                onPress={() =>
                  update(
                    "preferredWeekdays",
                    selected
                      ? values.preferredWeekdays.filter((value) => value !== day)
                      : [...values.preferredWeekdays, day],
                  )
                }
              />
            );
          })}
        </View>
        <ErrorText message={errors.preferredWeekdays} />
        <Text className="text-student-secondary text-base leading-[26px]">
          Opcional. Indica una franja común para los días seleccionados, usando el formato de 24
          horas.
        </Text>
        {field("availableFrom", "Desde", "Formato HH:MM, por ejemplo 09:00.")}
        {field("availableTo", "Hasta", "Formato HH:MM, por ejemplo 13:00.")}
      </View>
      <View
        className="gap-4 p-4 rounded-xl border border-student-border bg-student-surface"
        style={{ borderCurve: "continuous" }}
      >
        {field(
          "preferredAccessibleInformationChannel",
          "¿Cómo prefieres recibir información? *",
          "Por ejemplo, correo con texto accesible. Describe el medio, sin ingresar tu dirección ni teléfono.",
          true,
        )}
      </View>
      <Text className="text-student-secondary text-base leading-[26px]">
        El nombre y correo se obtendrán de la cuenta institucional cuando esté disponible el inicio
        de sesión.
      </Text>
      {reviewed && Object.keys(errors).length > 0 && (
        <Text
          selectable
          accessibilityRole="alert"
          className="text-student-error text-base leading-[26px]"
        >
          Hay campos por revisar. Corrige los mensajes indicados arriba.
        </Text>
      )}
      {submission.status === "error" && (
        <Animated.View
          testID="submission-error"
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          accessibilityLiveRegion="assertive"
          className="gap-3 p-4 rounded-xl border-2 border-student-error bg-student-surface"
          style={{ borderCurve: "continuous" }}
        >
          <Text selectable weight="semibold" className="text-student-error text-lg leading-[29px]">
            No pudimos enviar la solicitud ficticia.
          </Text>
          <Text selectable className="text-student-secondary text-base leading-[26px]">
            Tus datos siguen en el formulario. Puedes intentar nuevamente.
          </Text>
          <StudentAction label="Reintentar envío" onPress={submit} />
        </Animated.View>
      )}
      <StudentAction
        label={submission.status === "submitting" ? "Enviando solicitud…" : "Enviar solicitud"}
        disabled={submission.status === "submitting"}
        onPress={submit}
      />
    </View>
  );
}
