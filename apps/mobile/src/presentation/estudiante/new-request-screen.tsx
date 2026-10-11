import { useEffect, useRef } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useHeaderHeight } from "expo-router/react-navigation";
import { router } from "expo-router";
import type { StudentRequestSubmitter } from "@/application/student-area-port";
import { createMockStudentRequestSubmitter } from "@/infrastructure/mock-student-request-submitter";
import { mockStudentAreaStore } from "@/infrastructure/mock-student-area-store";
import { StudentScreen } from "./student-screen";
import { RequestForm } from "./request-form";
import { RoleGuard } from "../navigation/role-guard";

const defaultSubmitter = createMockStudentRequestSubmitter({
  failureMode: process.env.EXPO_PUBLIC_STUDENT_REQUEST_DEMO_MODE === "fail-once" ? "once" : "never",
  store: mockStudentAreaStore,
});

export interface NewRequestScreenProps {
  readonly submitter?: StudentRequestSubmitter;
}

export default function NewRequestScreen({
  submitter = defaultSubmitter,
}: NewRequestScreenProps = {}) {
  const headerHeight = useHeaderHeight();
  const scrollRef = useRef<ScrollView>(null);
  const focusedInputHandleRef = useRef<number | null>(null);

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
            submitter={submitter}
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
