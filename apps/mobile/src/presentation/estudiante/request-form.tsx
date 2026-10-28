import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { AccessibilityInfo, Keyboard, Pressable, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import type {
  AccessNeed,
  StudentRequestSubmissionReceipt,
  SubmitStudentRequestCommand,
} from "@/application/student-area-models";
import type { StudentRequestSubmitter } from "@/application/student-area-port";
import {
  useSubmitStudentRequest,
  type StudentRequestSubmissionStatus,
} from "@/presentation/hooks/use-submit-student-request";
import { OperationAnnouncement } from "../accessibility/operation-announcement";
import { StudentAction } from "./student-screen";
import { StudentText as Text, useStudentFont } from "./student-text";
import { AppIcon } from "../components/app-icon";
import {
  initialRequestValues,
  getRequestFormStepForField,
  requestFormSteps,
  validateRequestForm,
  validateRequestFormStep,
  type RequestFormErrors,
  type RequestFormStepId,
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
const stepTitles: Record<RequestFormStepId, string> = {
  need: "Cuéntanos qué necesitas",
  access: "Necesidades de acceso",
  availability: "Modalidad y disponibilidad",
  information: "Cómo prefieres recibir información",
  review: "Revisa tu solicitud",
};
const stepDescriptions: Record<RequestFormStepId, string> = {
  need: "Describe la barrera que quieres abordar y qué esperas del acompañamiento.",
  access: "Selecciona o describe los apoyos que necesitas para participar y comunicarte.",
  availability: "Indica una modalidad y los días que te acomodan. Esto no reserva una atención.",
  information: "Elige cómo prefieres que CERETI se comunique contigo.",
  review: "Confirma que los datos estén correctos antes de enviar la solicitud.",
};

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

function submissionAnnouncement(status: StudentRequestSubmissionStatus): string | null {
  if (status === "submitting") return "Enviando solicitud ficticia.";
  if (status === "error") return "No pudimos enviar la solicitud ficticia. Puedes reintentar.";
  if (status === "success") return "Solicitud ficticia enviada.";
  return null;
}

function RequestConfirmation({ receipt }: { readonly receipt: StudentRequestSubmissionReceipt }) {
  return (
    <Animated.View
      testID="request-confirmation"
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      accessibilityLiveRegion="none"
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
  readonly onFieldFocus?: (inputHandle: number) => void;
  readonly submitter: StudentRequestSubmitter;
}

export function RequestForm({ onFieldFocus, onRevealGroup, submitter }: RequestFormProps) {
  const fontFamily = useStudentFont();
  const [focusedField, setFocusedField] = useState<keyof RequestFormValues | null>(null);
  const [values, setValues] = useState<RequestFormValues>(initialRequestValues);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [validatedSteps, setValidatedSteps] = useState<RequestFormStepId[]>([]);
  const submission = useSubmitStudentRequest(submitter);
  const isSubmitting = submission.status === "submitting";
  const inputs = useRef<Partial<Record<keyof RequestFormValues, TextInput | null>>>({});
  const stepHeading = useRef<View>(null);
  const stepFocusTarget = useRef<keyof RequestFormValues | null>(null);
  const focusHeadingOnStepChange = useRef(false);
  const currentStep = requestFormSteps[currentStepIndex];
  const errors: RequestFormErrors = validatedSteps.includes(currentStep.id)
    ? validateRequestFormStep(values, currentStep.id)
    : {};
  const formTop = useRef(0);
  const groupTop = useRef({ accessNeeds: 0, modalityPreference: 0, preferredWeekdays: 0 });
  const accessControl = useRef<View>(null);
  const modalityControl = useRef<View>(null);
  const weekdayControl = useRef<View>(null);
  const submissionError = useRef<View>(null);
  const submissionErrorTop = useRef(0);

  const focusInvalidField = useCallback(
    (key: keyof RequestFormValues) => {
      if (key === "accessNeeds" || key === "modalityPreference" || key === "preferredWeekdays") {
        Keyboard.dismiss();
        const control =
          key === "accessNeeds"
            ? accessControl
            : key === "modalityPreference"
              ? modalityControl
              : weekdayControl;
        requestAnimationFrame(() => {
          onRevealGroup(formTop.current + groupTop.current[key]);
          if (control.current) {
            if (process.env.EXPO_OS === "web") control.current.focus();
            else AccessibilityInfo.sendAccessibilityEvent(control.current, "focus");
          }
        });
        return;
      }

      requestAnimationFrame(() => {
        const input = inputs.current[key];
        input?.focus();
        if (input && process.env.EXPO_OS !== "web") {
          AccessibilityInfo.sendAccessibilityEvent(input, "focus");
        }
      });
    },
    [onRevealGroup],
  );

  useEffect(() => {
    const focusTarget = stepFocusTarget.current;
    const focusHeading = focusHeadingOnStepChange.current;
    if (focusTarget === null && !focusHeading) return;

    stepFocusTarget.current = null;
    focusHeadingOnStepChange.current = false;
    const frame = requestAnimationFrame(() => {
      if (focusTarget !== null) {
        focusInvalidField(focusTarget);
      } else if (stepHeading.current) {
        AccessibilityInfo.sendAccessibilityEvent(stepHeading.current, "focus");
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [currentStepIndex, focusInvalidField]);

  function markStepValidated(stepId: RequestFormStepId) {
    setValidatedSteps((current) => (current.includes(stepId) ? current : [...current, stepId]));
  }

  function showStep(index: number, focusTarget?: keyof RequestFormValues) {
    Keyboard.dismiss();
    stepFocusTarget.current = focusTarget ?? null;
    focusHeadingOnStepChange.current = focusTarget === undefined;
    setCurrentStepIndex(index);
  }

  function continueToNextStep() {
    markStepValidated(currentStep.id);
    const stepErrors = validateRequestFormStep(values, currentStep.id);
    const firstError = currentStep.fields.find((key) => stepErrors[key]);
    if (firstError) {
      focusInvalidField(firstError);
      AccessibilityInfo.announceForAccessibility(`Revisa este paso. ${stepErrors[firstError]}`);
      return;
    }
    showStep(currentStepIndex + 1);
  }

  function update<K extends keyof RequestFormValues>(key: K, value: RequestFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function submit() {
    const nextErrors = validateRequestForm(values);
    const firstError = requestFormSteps
      .slice(0, -1)
      .flatMap(({ fields }) => fields)
      .find((key) => nextErrors[key]);
    if (firstError) {
      const targetStepId = getRequestFormStepForField(firstError);
      const targetStepIndex = requestFormSteps.findIndex(({ id }) => id === targetStepId);
      markStepValidated(targetStepId);
      if (targetStepIndex === currentStepIndex) focusInvalidField(firstError);
      else showStep(targetStepIndex, firstError);
      AccessibilityInfo.announceForAccessibility(`Revisa el formulario. ${nextErrors[firstError]}`);
    } else {
      Keyboard.dismiss();
      void submission.submit(toSubmissionCommand(values));
    }
  }

  const announcement = submissionAnnouncement(submission.status);

  if (submission.status === "success" && submission.receipt) {
    return (
      <View className="gap-6">
        <OperationAnnouncement message={announcement} />
        <RequestConfirmation receipt={submission.receipt} />
      </View>
    );
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
          ref={(input) => {
            inputs.current[key] = input;
          }}
          accessibilityLabel={errors[key] ? `${label}. Error: ${errors[key]}` : label}
          accessibilityHint={hint}
          aria-invalid={Boolean(errors[key])}
          aria-describedby={errors[key] ? `${key}-error` : undefined}
          value={values[key]}
          onChangeText={(value) => update(key, value)}
          onFocus={(event) => {
            setFocusedField(key);
            onFieldFocus?.(event.nativeEvent.target);
          }}
          onBlur={() => {
            setFocusedField(null);
          }}
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

  const preferredWeekdays = values.preferredWeekdays
    .flatMap((day) => {
      const label = weekdayLabelByValue.get(day);
      return label ? [label] : [];
    })
    .join(", ");
  const accessNeedsSummary = [
    ...values.accessNeeds.map(({ label }) => label),
    ...(values.otherAccessNeed.trim() ? [values.otherAccessNeed.trim()] : []),
  ].join(", ");
  const timeRangeSummary = values.availableFrom.trim()
    ? `${values.availableFrom.trim()} a ${values.availableTo.trim()}`
    : "Sin preferencia de horario";

  function summaryItem(label: string, value: string) {
    return (
      <View key={label} className="gap-1 border-b border-student-border py-3">
        <Text weight="semibold" className="text-student-secondary text-base leading-[26px]">
          {label}
        </Text>
        <Text selectable className="text-student-text text-lg leading-[29px]">
          {value}
        </Text>
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
      <OperationAnnouncement
        message={announcement}
        focusTarget={submission.status === "error" ? submissionError : undefined}
        onRevealTarget={
          submission.status === "error"
            ? () => onRevealGroup(formTop.current + submissionErrorTop.current)
            : undefined
        }
      />
      <View className="p-4 gap-2 bg-student-muted rounded-xl" style={{ borderCurve: "continuous" }}>
        <Text weight="semibold" className="text-student-primary text-lg leading-[26px]">
          Formulario de prueba
        </Text>
        <Text className="text-student-secondary text-base leading-[26px]">
          Usa datos ficticios. El envío se realizará solamente contra un simulador local y los
          cambios se perderán al salir.
        </Text>
      </View>
      <View className="gap-2">
        <View
          ref={stepHeading}
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${stepTitles[currentStep.id]}. Paso ${currentStepIndex + 1} de ${requestFormSteps.length}.`}
          className="gap-2"
        >
          <Text weight="semibold" className="text-student-text text-2xl leading-[34px]">
            {stepTitles[currentStep.id]}
          </Text>
          <Text className="text-student-secondary text-base leading-[26px]">
            {stepDescriptions[currentStep.id]}
          </Text>
        </View>
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="text-student-secondary text-base leading-[26px]"
        >
          Paso {currentStepIndex + 1} de {requestFormSteps.length}
        </Text>
        <View
          accessible={false}
          className="h-2 overflow-hidden rounded-full bg-student-border"
          style={{ borderCurve: "continuous" }}
        >
          <View
            className="h-full rounded-full bg-student-primary"
            style={{ width: `${((currentStepIndex + 1) / requestFormSteps.length) * 100}%` }}
          />
        </View>
      </View>

      {currentStep.id === "need" && (
        <>
          <Text className="text-student-secondary text-base leading-[26px]">
            Los campos marcados con * son obligatorios. No incluyas diagnósticos, RUT ni
            certificados.
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
        </>
      )}

      {currentStep.id === "access" && (
        <View
          className="gap-4 p-4 rounded-xl border border-student-border bg-student-surface"
          style={{ borderCurve: "continuous" }}
          onLayout={(event) => {
            groupTop.current.accessNeeds = event.nativeEvent.layout.y;
          }}
        >
          <Text
            weight="semibold"
            accessibilityRole="header"
            className="text-student-text text-lg leading-[26px]"
          >
            Necesidades de acceso *
          </Text>
          {accessOptions.map((option, index) => {
            const selected = values.accessNeeds.some((need) => need.id === option.id);
            return (
              <Choice
                controlRef={index === 0 ? accessControl : undefined}
                error={errors.accessNeeds}
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
          <ErrorText message={errors.accessNeeds} />
        </View>
      )}

      {currentStep.id === "availability" && (
        <>
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
              error={errors.modalityPreference}
              controlRef={modalityControl}
              label="Presencial"
              single
              selected={values.modalityPreference === "inPerson"}
              disabled={isSubmitting}
              onPress={() => update("modalityPreference", "inPerson")}
            />
            <Choice
              error={errors.modalityPreference}
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
            <View className="flex-row flex-wrap gap-2">
              {weekdays.map(({ label, value }, index) => {
                const selected = values.preferredWeekdays.includes(value);
                return (
                  <Choice
                    error={errors.preferredWeekdays}
                    controlRef={index === 0 ? weekdayControl : undefined}
                    key={label}
                    label={label}
                    selected={selected}
                    disabled={isSubmitting}
                    onPress={() =>
                      update(
                        "preferredWeekdays",
                        selected
                          ? values.preferredWeekdays.filter((day) => day !== value)
                          : [...values.preferredWeekdays, value],
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
        </>
      )}

      {currentStep.id === "information" && (
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
      )}

      {currentStep.id === "review" && (
        <>
          <View
            className="gap-1 p-4 rounded-xl border border-student-border bg-student-surface"
            style={{ borderCurve: "continuous" }}
          >
            {summaryItem("Necesidad que quieres abordar", values.needSummary.trim())}
            {summaryItem("Resultado esperado", values.expectedOutcome.trim())}
            {summaryItem("Necesidades de acceso", accessNeedsSummary)}
            {summaryItem(
              "Modalidad preferida",
              values.modalityPreference === "inPerson" ? "Presencial" : "En línea",
            )}
            {summaryItem("Días preferidos", preferredWeekdays)}
            {summaryItem("Franja horaria", timeRangeSummary)}
            {summaryItem(
              "Medio preferido para recibir información",
              values.preferredAccessibleInformationChannel.trim(),
            )}
          </View>
          <Text className="text-student-secondary text-base leading-[26px]">
            El nombre y correo se obtendrán de la cuenta institucional cuando esté disponible el
            inicio de sesión.
          </Text>
        </>
      )}

      {Object.keys(errors).length > 0 && (
        <Text
          selectable
          accessibilityRole="alert"
          className="text-student-error text-base leading-[26px]"
        >
          Corrige los campos indicados para continuar.
        </Text>
      )}
      {currentStep.id === "review" && submission.status === "error" && (
        <Animated.View
          testID="submission-error"
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          accessibilityLiveRegion="none"
          onLayout={(event) => {
            submissionErrorTop.current = event.nativeEvent.layout.y;
          }}
          className="gap-3 p-4 rounded-xl border-2 border-student-error bg-student-surface"
          style={{ borderCurve: "continuous" }}
        >
          <View
            ref={submissionError}
            accessible
            accessibilityRole="text"
            accessibilityLabel="No pudimos enviar la solicitud ficticia. Tus datos siguen en el formulario. Puedes reintentar."
            className="gap-3"
          >
            <Text
              selectable
              weight="semibold"
              className="text-student-error text-lg leading-[29px]"
            >
              No pudimos enviar la solicitud ficticia.
            </Text>
            <Text selectable className="text-student-secondary text-base leading-[26px]">
              Tus datos siguen en el formulario. Puedes intentar nuevamente.
            </Text>
          </View>
          <StudentAction label="Reintentar envío" onPress={submit} />
        </Animated.View>
      )}
      {currentStepIndex > 0 && (
        <StudentAction
          label="Volver al paso anterior"
          secondary
          disabled={isSubmitting}
          onPress={() => showStep(currentStepIndex - 1)}
        />
      )}
      {currentStep.id === "review" ? (
        submission.status === "error" ? null : (
          <StudentAction
            label={isSubmitting ? "Enviando solicitud…" : "Confirmar y enviar solicitud"}
            disabled={isSubmitting}
            onPress={submit}
          />
        )
      ) : (
        <StudentAction label="Continuar" disabled={isSubmitting} onPress={continueToNextStep} />
      )}
    </View>
  );
}
