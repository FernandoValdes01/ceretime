import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useHeaderHeight } from "expo-router/react-navigation";
import { router, usePathname } from "expo-router";
import type { StudentRequestSubmitter } from "@/application/student-area-port";
import {
  authMode,
  getMobileConvexClient,
  mobileDependencies,
} from "@/composition/mobile-dependencies";
import { createConvexStudentRequestSubmitter } from "@/infrastructure/convex-student-request-submitter";
import { StudentScreen } from "./student-screen";
import { RequestForm } from "./request-form";
import { RoleGuard } from "../navigation/role-guard";
import { useOptionalNavigationSession } from "../navigation/session";

export interface NewRequestScreenProps {
  readonly submitter?: StudentRequestSubmitter;
}

// El envío real se crea una vez por cuenta: conserva la clave de idempotencia entre reintentos.
function useDefaultSubmitter(): StudentRequestSubmitter {
  const userId = useOptionalNavigationSession()?.session?.user.id;
  return useMemo(
    () =>
      authMode === "institutional" && userId !== undefined
        ? createConvexStudentRequestSubmitter({ client: getMobileConvexClient() })
        : mobileDependencies.studentRequestSubmitter,
    [userId],
  );
}

export default function NewRequestScreen({ submitter }: NewRequestScreenProps = {}) {
  const defaultSubmitter = useDefaultSubmitter();
  const activeSubmitter = submitter ?? defaultSubmitter;
  const headerHeight = useHeaderHeight();
  const pathname = usePathname();
  const [formSession, setFormSession] = useState(0);
  const [completed, setCompleted] = useState(false);
  const markCompleted = useCallback(() => setCompleted(true), []);
  const scrollRef = useRef<ScrollView>(null);
  const focusedInputHandleRef = useRef<number | null>(null);

  // Tras enviar, salir a otra sección del Estudiante reinicia el formulario con una sesión nueva.
  const leftForStudentArea =
    pathname !== "/estudiante/nueva-solicitud" &&
    (pathname === "/estudiante" || pathname.startsWith("/estudiante/"));
  if (completed && leftForStudentArea) {
    setCompleted(false);
    setFormSession(formSession + 1);
  }

  useEffect(() => {
    focusedInputHandleRef.current = null;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [formSession]);

  // Mantiene visible el campo enfocado cuando el teclado aparece o cambia el alto disponible.
  function revealFocusedInput() {
    const focusedInputHandle = focusedInputHandleRef.current;
    if (focusedInputHandle === null || !Keyboard.isVisible()) return;

    requestAnimationFrame(() => {
      scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(focusedInputHandle, 100, true);
    });
  }

  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidShow", revealFocusedInput);
    return () => subscription.remove();
  }, []);

  return (
    <RoleGuard requiredRole="estudiante">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
        onLayout={revealFocusedInput}
      >
        <StudentScreen
          scrollRef={scrollRef}
          onBack={() => {
            Keyboard.dismiss();
            router.back();
          }}
          title="Solicitud de acompañamiento"
          description="Describe la necesidad que quieres abordar con CERETI. Esta solicitud no es un canal de urgencias."
        >
          <RequestForm
            key={formSession}
            onSubmitted={markCompleted}
            submitter={activeSubmitter}
            onRevealGroup={(y) => scrollRef.current?.scrollTo({ y, animated: false })}
            onFieldFocus={(inputHandle) => {
              focusedInputHandleRef.current = inputHandle;
              revealFocusedInput();
            }}
          />
        </StudentScreen>
      </KeyboardAvoidingView>
    </RoleGuard>
  );
}
