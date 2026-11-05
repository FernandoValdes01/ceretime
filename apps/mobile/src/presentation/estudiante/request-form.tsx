import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Keyboard, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import type {
  StudentRequestSubmissionReceipt,
  SubmitStudentRequestCommand,
} from "@/domain/student-area-models";
import type { StudentRequestSubmitter } from "@/application/student-area-port";
import {
  useSubmitStudentRequest,
  type StudentRequestSubmissionStatus,
} from "@/presentation/hooks/use-submit-student-request";
import { OperationAnnouncement } from "../accessibility/operation-announcement";
import { StudentAction } from "./student-screen";
import { StudentText as Text } from "./student-text";
import { studentRequestSubmissionMessages } from "./student-request-submission-messages";
import {
  AccessStep,
  AvailabilityStep,
  InformationStep,
  NeedStep,
  ReviewStep,
  type RequestChoiceGroup,
  type RequestTextFieldBinding,
  type RequestTextFieldKey,
} from "./request-form-steps";
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

// Convierte el borrador editable en el comando de envío; solo se llama después de validar el formulario.
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
    // La validación ya descartó la modalidad vacía, pero el tipo del borrador aún la admite.
    modalityPreference:
      values.modalityPreference as SubmitStudentRequestCommand["modalityPreference"],
    preferredAccessibleInformationChannel: values.preferredAccessibleInformationChannel.trim(),
  };
}

function submissionAnnouncement(status: StudentRequestSubmissionStatus): string | null {
  if (status === "idle") return null;
  return studentRequestSubmissionMessages[status];
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
  readonly onSubmitted?: () => void;
  readonly onRevealGroup: (y: number) => void;
  readonly onFieldFocus?: (inputHandle: number) => void;
  readonly submitter: StudentRequestSubmitter;
}

// Formulario de solicitud del Estudiante en cinco pasos; valida por paso y lleva el foco al primer error
// para que lectores de pantalla y teclado no pierdan la posición.
export function RequestForm({
  onSubmitted,
  onFieldFocus,
  onRevealGroup,
  submitter,
}: RequestFormProps) {
  const [values, setValues] = useState<RequestFormValues>(initialRequestValues);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [validatedSteps, setValidatedSteps] = useState<RequestFormStepId[]>([]);
  const submission = useSubmitStudentRequest(submitter);
  useEffect(() => {
    if (submission.status === "success") onSubmitted?.();
  }, [submission.status, onSubmitted]);
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
        // Los grupos de opciones no son TextInput: se enfocan por su contenedor con un evento de accesibilidad.
        const control = {
          accessNeeds: accessControl,
          modalityPreference: modalityControl,
          preferredWeekdays: weekdayControl,
        }[key];
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
    // Valida solo el paso actual para permitir avanzar sin ocultar errores posteriores.
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
    // La revisión final recorre los pasos en orden y lleva el foco al primer dato pendiente.
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

  if (submission.status === "success") {
    return (
      <View className="gap-6">
        <OperationAnnouncement message={announcement} />
        <RequestConfirmation receipt={submission.receipt} />
      </View>
    );
  }

  // Conecta cada campo de texto con el estado del formulario y registra su input para enfocarlo.
  function bindField(key: RequestTextFieldKey): RequestTextFieldBinding {
    return {
      fieldKey: key,
      value: values[key],
      error: errors[key],
      disabled: isSubmitting,
      onChangeText: (value) => update(key, value),
      onFocus: onFieldFocus,
      inputRef: (input) => {
        inputs.current[key] = input;
      },
    };
  }

  const choiceStepProps = {
    values,
    errors,
    disabled: isSubmitting,
    update,
    bindField,
    onGroupLayout: (group: RequestChoiceGroup, y: number) => {
      groupTop.current[group] = y;
    },
  };

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

      {currentStep.id === "need" && <NeedStep bindField={bindField} />}
      {currentStep.id === "access" && (
        <AccessStep {...choiceStepProps} accessControl={accessControl} />
      )}
      {currentStep.id === "availability" && (
        <AvailabilityStep
          {...choiceStepProps}
          modalityControl={modalityControl}
          weekdayControl={weekdayControl}
        />
      )}
      {currentStep.id === "information" && <InformationStep bindField={bindField} />}
      {currentStep.id === "review" && <ReviewStep values={values} />}

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
