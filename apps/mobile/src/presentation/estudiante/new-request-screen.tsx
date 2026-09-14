import { useRef } from "react";
import { KeyboardAvoidingView, ScrollView } from "react-native";
import { router } from "expo-router";
import type { StudentRequestSubmitter } from "@/application/student-area-port";
import { createMockStudentRequestSubmitter } from "@/infrastructure/mock-student-request-submitter";
import { StudentAction, StudentScreen } from "./student-screen";
import { RequestForm } from "./request-form";
import { RoleGuard } from "../navigation/role-guard";

const defaultSubmitter = createMockStudentRequestSubmitter({
  failureMode: process.env.EXPO_PUBLIC_STUDENT_REQUEST_DEMO_MODE === "fail-once" ? "once" : "never",
});

export interface NewRequestScreenProps {
  readonly submitter?: StudentRequestSubmitter;
}

export default function NewRequestScreen({
  submitter = defaultSubmitter,
}: NewRequestScreenProps = {}) {
  const scrollRef = useRef<ScrollView>(null);

  const goToStudentHome = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/estudiante");
  };

  return (
    <RoleGuard requiredRole="estudiante">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      >
        <StudentScreen
          scrollRef={scrollRef}
          title="Solicitud de acompañamiento"
          description="Describe la necesidad que quieres abordar con CERETI. Esta solicitud no es un canal de urgencias."
        >
          <StudentAction label="Volver al inicio" onPress={goToStudentHome} secondary />
          <RequestForm
            submitter={submitter}
            onRevealGroup={(y) => scrollRef.current?.scrollTo({ y, animated: false })}
          />
        </StudentScreen>
      </KeyboardAvoidingView>
    </RoleGuard>
  );
}
