import { type PropsWithChildren, type Ref } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppHeader } from "../components/app-header";
import { AppIcon } from "../components/app-icon";
import { StudentFonts, StudentText } from "./student-text";

type StudentScreenIntroductionProps =
  | {
      readonly showIntroduction: false;
      readonly title?: never;
      readonly description?: never;
    }
  | {
      readonly showIntroduction?: true;
      readonly title: string;
      readonly description: string;
    };

export type StudentScreenProps = PropsWithChildren<
  StudentScreenIntroductionProps & {
    readonly scrollRef?: Ref<ScrollView>;
    readonly onBack?: () => void;
  }
>;

export function StudentScreen({
  scrollRef,
  onBack,
  children,
  ...introduction
}: StudentScreenProps) {
  return (
    <StudentFonts>
      <SafeAreaView
        className="flex-1 bg-student-background"
        edges={["top", "left", "right", "bottom"]}
      >
        <AppHeader onBack={onBack} />
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="grow w-full max-w-[600px] self-center p-6 gap-4"
        >
          {introduction.showIntroduction === false ? null : (
            <View className="gap-2">
              <StudentText
                weight="semibold"
                accessibilityRole="header"
                className="text-student-text text-[28px] leading-[37px]"
              >
                {introduction.title}
              </StudentText>
              <StudentText className="text-student-secondary text-lg leading-[29px]">
                {introduction.description}
              </StudentText>
            </View>
          )}
          {children}
        </ScrollView>
      </SafeAreaView>
    </StudentFonts>
  );
}

export interface StudentActionProps {
  readonly label: string;
  readonly description?: string;
  readonly onPress: () => void;
  readonly secondary?: boolean;
  readonly disabled?: boolean;
}

export function StudentAction({
  label,
  description,
  onPress,
  secondary = false,
  disabled = false,
}: StudentActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`items-center justify-center border-2 p-4 active:opacity-75 focus:border-student-focus ${disabled ? "opacity-60" : ""} ${description ? "min-h-24 flex-row gap-4 rounded-xl" : "min-h-[52px] rounded-lg"} ${secondary ? "bg-student-surface border-student-border" : "bg-student-primary border-student-primary"}`}
      style={{ borderCurve: "continuous" }}
    >
      <View className="shrink gap-2">
        <StudentText
          weight="semibold"
          className={`${description ? "text-2xl leading-[34px] text-left" : "text-lg leading-[25px] text-center"} ${secondary ? "text-student-primary" : "text-white"}`}
        >
          {label}
        </StudentText>
        {description ? (
          <StudentText
            className={`${secondary ? "text-student-secondary" : "text-white"} text-base leading-[25px]`}
            selectable
          >
            {description}
          </StudentText>
        ) : null}
      </View>
      {description ? (
        <AppIcon
          name="chevronRight"
          size={28}
          color={secondary ? "#0A7C70" : "#FFFFFF"}
          accessible={false}
          testID="student-action-chevron-right"
        />
      ) : null}
    </Pressable>
  );
}
