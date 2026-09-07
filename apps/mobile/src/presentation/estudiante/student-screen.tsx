import { useState, type PropsWithChildren, type Ref } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { studentTheme as theme } from '../../theme';
import { StudentFonts, StudentText } from './student-text';

export interface StudentScreenProps extends PropsWithChildren {
  readonly title: string;
  readonly description: string;
  readonly scrollRef?: Ref<ScrollView>;
}

export function StudentScreen({
  title,
  description,
  scrollRef,
  children,
}: StudentScreenProps) {
  return (
    <StudentFonts>
      <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
        <View style={styles.brandBar}>
          <StudentText weight="bold" style={styles.brand}>
            CERETI
          </StudentText>
        </View>
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <View style={styles.introduction}>
            <StudentText
              weight="semibold"
              accessibilityRole="header"
              style={styles.title}
            >
              {title}
            </StudentText>
            <StudentText style={styles.description}>{description}</StudentText>
          </View>
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
}

export function StudentAction({
  label,
  description,
  onPress,
  secondary = false,
}: StudentActionProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        description && styles.actionCard,
        secondary && styles.secondary,
        pressed && styles.pressed,
        focused && styles.focused,
      ]}
    >
      <View style={styles.actionCopy}>
        <StudentText
          weight="semibold"
          style={[
            styles.buttonLabel,
            description && styles.actionTitle,
            secondary && styles.secondaryLabel,
          ]}
        >
          {label}
        </StudentText>
        {description ? (
          <StudentText style={styles.actionDescription}>
            {description}
          </StudentText>
        ) : null}
      </View>
      {description ? (
        <StudentText accessible={false} style={styles.arrow}>
          ›
        </StudentText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  brandBar: {
    padding: theme.spacing.medium,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  brand: { color: theme.colors.primary, fontSize: 24, lineHeight: 34 },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    paddingHorizontal: theme.spacing.medium,
    paddingVertical: theme.spacing.large,
    gap: theme.spacing.section,
  },
  introduction: { gap: theme.spacing.small },
  title: { color: theme.colors.text, fontSize: 28, lineHeight: 37 },
  description: {
    color: theme.colors.textSecondary,
    fontSize: 18,
    lineHeight: 29,
  },
  button: {
    minHeight: 52,
    padding: theme.spacing.medium,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.primary,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonLabel: {
    color: theme.colors.onPrimary,
    fontSize: 18,
    lineHeight: 25,
    textAlign: 'center',
  },
  actionCard: {
    minHeight: 96,
    flexDirection: 'row',
    gap: theme.spacing.medium,
    borderRadius: theme.radius.card,
  },
  actionCopy: { flexShrink: 1, gap: theme.spacing.small },
  actionTitle: { fontSize: 24, lineHeight: 34, textAlign: 'left' },
  actionDescription: {
    color: theme.colors.onPrimary,
    fontSize: 16,
    lineHeight: 25,
  },
  arrow: { color: theme.colors.onPrimary, fontSize: 32, marginLeft: 'auto' },
  secondary: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
  },
  secondaryLabel: { color: theme.colors.primary },
  pressed: { opacity: 0.75 },
  focused: { borderColor: theme.colors.focus },
});
