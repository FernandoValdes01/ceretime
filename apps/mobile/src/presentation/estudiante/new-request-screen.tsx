import { Stack } from "expo-router";
import { useRef } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useHeaderHeight } from "expo-router/react-navigation";
import { StudentScreen } from "./student-screen";
import { RequestForm } from "./request-form";

export default function NewRequestScreen() {
  const headerHeight = useHeaderHeight();
  const scrollRef = useRef<ScrollView>(null);
  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <Stack.Screen options={{ title: "Nueva solicitud" }} />
      <StudentScreen
        scrollRef={scrollRef}
        title="Solicitud de acompañamiento"
        description="Describe la necesidad que quieres abordar con CERETI. Esta solicitud no es un canal de urgencias."
      >
        <RequestForm onRevealGroup={(y) => scrollRef.current?.scrollTo({ y, animated: false })} />
      </StudentScreen>
    </KeyboardAvoidingView>
  );
}
