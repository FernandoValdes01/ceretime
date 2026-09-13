import { type PropsWithChildren, type Ref } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
  }
>;

export function StudentScreen({ scrollRef, children, ...introduction }: StudentScreenProps) {
  return (
    <StudentFonts>
      <SafeAreaView className="flex-1 bg-student-background" edges={["left", "right", "bottom"]}>
        <View className="items-center border-b border-student-border p-4">
          <StudentText weight="bold" className="text-student-primary text-2xl leading-[34px]">
            CERETI
          </StudentText>
        </View>
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="grow w-full max-w-[600px] self-center px-4 py-6 gap-8"
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
      onPress={onPress}
      disabled={disabled}
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
        <StudentText
          accessible={false}
          className={`${secondary ? "text-student-primary" : "text-white"} text-[32px] ml-auto`}
        >
          ›
        </StudentText>
      ) : null}
    </Pressable>
  );
}
