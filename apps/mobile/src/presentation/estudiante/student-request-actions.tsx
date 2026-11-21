import { useEffect, useRef, useState } from "react";
import { Keyboard, TextInput, View } from "react-native";
import { REQUEST_RESPONSE_MAX_LENGTH } from "../../../../../convex/domain/requests/request";
import type { StudentRequest } from "@/domain/student-area-models";
import {
  StudentRequestActionError,
  type StudentRequestActions,
} from "@/application/student-area-port";
import { isMobileAccessDenied, toMobileOperationError } from "../to-mobile-operation-error";
import { StudentAction } from "./student-screen";
import { StudentText, useStudentFont } from "./student-text";

type ActionKind = "respondToInformationRequest" | "cancelRequest";
type ActionResult =
  | { readonly status: "idle" | "pending" }
  | { readonly status: "success"; readonly message: string }
  | { readonly status: "error"; readonly message: string; readonly retryable: boolean };

export function StudentRequestActionsPanel({
  request,
  actions,
  onReload,
}: {
  readonly request?: StudentRequest;
  readonly actions?: StudentRequestActions;
  readonly onReload: () => void;
}) {
  const fontFamily = useStudentFont();
  const [previousActions, setPreviousActions] = useState(() => actions);
  const [focused, setFocused] = useState(false);
  const [kind, setKind] = useState<ActionKind | null>(null);
  const [response, setResponse] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult>({ status: "idle" });
  const inFlight = useRef<object | null>(null);
  const activeActions = useRef(actions);
  const input = useRef<TextInput>(null);
  useEffect(() => {
    activeActions.current = actions;
    return () => {
      activeActions.current = undefined;
      inFlight.current = null;
    };
  }, [actions]);

  if (previousActions !== actions) {
    setPreviousActions(() => actions);
    setResult({ status: "idle" });
    setKind(null);
    setResponse("");
    setReason("");
    setFieldError(null);
  }
  if (!request || !actions) return null;
  const canRespond = request.status === "awaitingInformationOrAcceptance";
  const canCancel = ["received", "underReview", "awaitingInformationOrAcceptance"].includes(
    request.status,
  );
  const pending = result.status === "pending";
  const selectedAllowed = kind === "respondToInformationRequest" ? canRespond : canCancel;
  const label =
    kind === "respondToInformationRequest"
      ? "Respuesta a la información solicitada"
      : "Motivo de cancelación";
  const value = kind === "respondToInformationRequest" ? response : reason;

  async function execute() {
    if (!request || !actions || !kind || inFlight.current || activeActions.current !== actions)
      return;
    const text = value.trim();
    const error = !text
      ? kind === "cancelRequest"
        ? "Indica el motivo de cancelación."
        : "Escribe tu respuesta."
      : kind === "respondToInformationRequest" && text.length > REQUEST_RESPONSE_MAX_LENGTH
        ? `Usa como máximo ${REQUEST_RESPONSE_MAX_LENGTH} caracteres.`
        : null;
    setFieldError(error);
    if (error) {
      input.current?.focus();
      return;
    }
    const operation = {};
    inFlight.current = operation;
    Keyboard.dismiss();
    setResult({ status: "pending" });
    try {
      await actions.execute(
        kind === "cancelRequest"
          ? { kind, requestId: request.id, reason: text }
          : { kind, requestId: request.id, response: text },
      );
      if (activeActions.current !== actions || inFlight.current !== operation) return;
      setResult({
        status: "success",
        message:
          kind === "cancelRequest"
            ? "Solicitud cancelada en la demostración."
            : "Respuesta enviada en la demostración. La solicitud vuelve a revisión.",
      });
      setKind(null);
      setResponse("");
      setReason("");
    } catch (error) {
      if (activeActions.current !== actions || inFlight.current !== operation) return;
      const denied = isMobileAccessDenied(error);
      const conflict = error instanceof StudentRequestActionError && error.code === "conflict";
      setResult({
        status: "error",
        message: denied
          ? "No tienes permiso para realizar esta acción."
          : toMobileOperationError(
              error,
              "No pudimos completar la acción. Conservamos lo que escribiste.",
            ).message,
        retryable: !denied && !conflict,
      });
    } finally {
      if (inFlight.current === operation) inFlight.current = null;
    }
  }

  function select(next: ActionKind) {
    if (inFlight.current) return;
    setKind(next);
    setFieldError(null);
    setResult({ status: "idle" });
  }

  return (
    <View className="gap-4">
      {(canRespond || canCancel) && (
        <StudentText className="text-student-secondary text-base leading-[26px]">
          Acciones de prueba. Usa datos ficticios: los cambios solo se guardan en esta sesión de
          demostración.
        </StudentText>
      )}
      {result.status === "success" && (
        <StudentText
          accessibilityRole="alert"
          className="text-student-success text-base leading-[26px]"
        >
          {result.message}
        </StudentText>
      )}
      {result.status === "error" && (
        <View className="gap-3">
          <StudentText
            accessibilityRole="alert"
            className="text-student-error text-base leading-[26px]"
          >
            {result.message}
          </StudentText>
          {!result.retryable && <StudentAction label="Actualizar detalle" onPress={onReload} />}
        </View>
      )}
      {pending && (
        <StudentText
          accessibilityRole="alert"
          className="text-student-secondary text-base leading-[26px]"
        >
          Procesando acción de prueba…
        </StudentText>
      )}
      {kind && selectedAllowed ? (
        <View className="gap-3">
          <StudentText weight="semibold" className="text-student-text text-lg leading-[26px]">
            {label}
          </StudentText>
          <TextInput
            ref={input}
            accessibilityLabel={fieldError ? `${label}. Error: ${fieldError}` : label}
            accessibilityHint="Usa datos ficticios. El texto se conserva si la acción falla."
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? "request-action-error" : undefined}
            value={value}
            onChangeText={(text) => {
              if (kind === "respondToInformationRequest") setResponse(text);
              else setReason(text);
              setFieldError(null);
            }}
            editable={!pending}
            accessibilityState={{ disabled: pending }}
            multiline
            textAlignVertical="top"
            className="min-h-28 border-2 border-student-outline rounded-lg bg-student-surface text-student-text p-4 text-base leading-[26px]"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{ fontFamily, ...(focused ? { borderColor: "#2563eb" } : {}) }}
          />
          {fieldError && (
            <StudentText
              nativeID="request-action-error"
              accessibilityRole="alert"
              className="text-student-error text-base leading-[26px]"
            >
              {fieldError}
            </StudentText>
          )}
          {kind === "cancelRequest" && (
            <StudentText className="text-student-secondary text-base leading-[26px]">
              Al confirmar, la solicitud quedará cancelada. Esta acción no abre un acompañamiento.
            </StudentText>
          )}
          {(result.status !== "error" || result.retryable) && (
            <StudentAction
              label={
                pending
                  ? "Procesando acción…"
                  : result.status === "error"
                    ? "Reintentar acción"
                    : kind === "cancelRequest"
                      ? "Confirmar cancelación de prueba"
                      : "Enviar respuesta de prueba"
              }
              disabled={pending}
              onPress={() => {
                void execute();
              }}
            />
          )}
          <StudentAction
            label="Volver sin confirmar"
            secondary
            disabled={pending}
            onPress={() => {
              setKind(null);
              setFieldError(null);
            }}
          />
        </View>
      ) : null}
      {kind === null && (
        <View className="gap-3">
          {canRespond && (
            <StudentAction
              label="Responder información"
              onPress={() => select("respondToInformationRequest")}
            />
          )}
          {canCancel && (
            <StudentAction
              label="Cancelar solicitud"
              secondary
              onPress={() => select("cancelRequest")}
            />
          )}
        </View>
      )}
    </View>
  );
}
