import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type {
  ProfessionalAccompaniment,
  ProfessionalAccompanimentStatus,
} from "@/application/professional-accompaniment-models";
import { mobileDependencies } from "@/composition/mobile-dependencies";
import { AppIcon, type AppIconName } from "@/presentation/components/app-icon";
import { StudentFonts, StudentText } from "@/presentation/estudiante/student-text";
import { useProfessionalAccompaniments } from "@/presentation/hooks/use-professional-accompaniments";
import { RoleGuard } from "@/presentation/navigation/role-guard";
import { ProfessionalHeader } from "./professional-header";

const statusPresentations = {
  active: { label: "Activo", icon: "circleCheck" },
  paused: { label: "En pausa", icon: "clock" },
  closed: { label: "Cerrado", icon: "circleX" },
} satisfies Record<ProfessionalAccompanimentStatus, { label: string; icon: AppIconName }>;

function StateMessage({
  title,
  message,
  action,
  children,
}: {
  readonly title: string;
  readonly message?: string;
  readonly action?: { readonly label: string; readonly onPress: () => void };
  readonly children?: React.ReactNode;
}) {
  return (
    <View style={styles.stateCard}>
      <StudentText
        accessibilityRole="header"
        accessibilityLiveRegion="polite"
        weight="semibold"
        style={styles.stateTitle}
      >
        {title}
      </StudentText>
      {message ? <StudentText style={styles.stateMessage}>{message}</StudentText> : null}
      {children}
      {action ? (
        <Pressable
          accessibilityRole="button"
          onPress={action.onPress}
          style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
        >
          <StudentText weight="semibold" style={styles.retryText}>
            {action.label}
          </StudentText>
        </Pressable>
      ) : null}
    </View>
  );
}

function StatusBadge({ status }: Pick<ProfessionalAccompaniment, "status">) {
  const presentation = statusPresentations[status];

  return (
    <View style={styles.statusBadge} accessible={false}>
      <AppIcon
        accessible={false}
        color="#087D70"
        name={presentation.icon}
        size={16}
        strokeWidth={2.2}
      />
      <StudentText weight="semibold" style={styles.statusText}>
        {presentation.label}
      </StudentText>
    </View>
  );
}

function AccompanimentCard({
  accompaniment,
  onOpen,
}: {
  readonly accompaniment: ProfessionalAccompaniment;
  readonly onOpen: () => void;
}) {
  const presentation = statusPresentations[accompaniment.status];
  const [isPressed, setIsPressed] = useState(false);

  return (
    <Pressable
      accessibilityHint="Abre el detalle del acompañamiento"
      accessibilityLabel={`Acompañamiento de ${accompaniment.studentName}. Estado: ${presentation.label}. ${accompaniment.objective}`}
      accessibilityRole="button"
      onPress={onOpen}
      onPressIn={() => setIsPressed(true)}
      onPressOut={() => setIsPressed(false)}
      style={[styles.accompanimentCard, isPressed && styles.buttonPressed]}
    >
      <View style={styles.cardTopRow}>
        <View style={styles.cardIdentity}>
          <View style={styles.studentAvatar}>
            <StudentText weight="semibold" style={styles.studentAvatarText}>
              {accompaniment.studentName.slice(0, 1)}
            </StudentText>
          </View>
          <View style={styles.cardIdentityCopy}>
            <StudentText weight="semibold" style={styles.studentName}>
              {accompaniment.studentName}
            </StudentText>
          </View>
        </View>
        <StatusBadge status={accompaniment.status} />
      </View>
      <View style={styles.divider} />
      <StudentText weight="semibold" style={styles.accompanimentTitle}>
        {accompaniment.objective}
      </StudentText>
    </Pressable>
  );
}

export function ProfessionalAccompanimentsContent({
  status,
  data,
  error,
  reload,
  onOpen = () => undefined,
}: ReturnType<typeof useProfessionalAccompaniments> & {
  readonly onOpen?: (accompanimentId: string) => void;
}) {
  if (status === "loading") {
    return (
      <StateMessage title="Cargando acompañamientos…">
        <ActivityIndicator accessible={false} color="#087D70" />
      </StateMessage>
    );
  }

  if (status === "error") {
    return (
      <StateMessage
        title="No pudimos cargar tus acompañamientos"
        message={error instanceof Error ? error.message : "Intenta nuevamente."}
        action={{ label: "Reintentar", onPress: reload }}
      />
    );
  }

  if (status === "empty") {
    return (
      <StateMessage
        title="No tienes acompañamientos autorizados"
        message="Cuando se abra un acompañamiento autorizado, aparecerá aquí."
      />
    );
  }

  return (
    <View style={styles.accompanimentList}>
      {data.map((accompaniment) => (
        <AccompanimentCard
          key={accompaniment.id}
          accompaniment={accompaniment}
          onOpen={() => onOpen(accompaniment.id)}
        />
      ))}
    </View>
  );
}

export function ProfessionalAccompanimentsScreen() {
  const state = useProfessionalAccompaniments(mobileDependencies.professionalAccompanimentReader);

  return (
    <RoleGuard requiredRole="profesional">
      <StudentFonts>
        <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
          <ProfessionalHeader />
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            contentInsetAdjustmentBehavior="automatic"
          >
            <View style={styles.introduction}>
              <StudentText accessibilityRole="header" weight="bold" style={styles.title}>
                Acompañamientos
              </StudentText>
            </View>
            <ProfessionalAccompanimentsContent
              {...state}
              onOpen={(accompanimentId) =>
                router.push({
                  pathname: "/profesional/acompanamientos/[accompanimentId]",
                  params: { accompanimentId },
                })
              }
            />
          </ScrollView>
        </SafeAreaView>
      </StudentFonts>
    </RoleGuard>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F7FAF9" },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 96 },
  introduction: { paddingTop: 20, paddingBottom: 18, paddingHorizontal: 4 },
  title: { color: "#182C31", fontSize: 30, lineHeight: 36 },
  accompanimentList: { gap: 12 },
  accompanimentCard: {
    position: "relative",
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: "#C9D9D6",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    boxShadow: "0 2px 5px rgba(24, 44, 49, 0.08)",
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  cardIdentity: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  cardIdentityCopy: { flex: 1, gap: 2 },
  studentAvatar: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: "#E9BFA8",
  },
  studentAvatarText: { color: "#704336", fontSize: 16 },
  studentName: { color: "#182C31", fontSize: 16, lineHeight: 21 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: "#E8F4F1",
  },
  statusText: { color: "#087D70", fontSize: 12, lineHeight: 16 },
  divider: { height: 1, backgroundColor: "#E2E9E7" },
  accompanimentTitle: { color: "#182C31", fontSize: 17, lineHeight: 23 },
  buttonPressed: { opacity: 0.78 },
  stateCard: {
    alignItems: "flex-start",
    gap: 10,
    padding: 18,
    borderWidth: 1,
    borderColor: "#C9D9D6",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
  },
  stateTitle: { color: "#182C31", fontSize: 18, lineHeight: 24 },
  stateMessage: { color: "#42565B", fontSize: 15, lineHeight: 22 },
  retryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 11,
    backgroundColor: "#087D70",
  },
  retryText: { color: "#FFFFFF", fontSize: 15, lineHeight: 20 },
});
