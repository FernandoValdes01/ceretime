import { Stack } from 'expo-router';
import { useRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Screen } from '../components/screen';
import { RequestForm } from './request-form';

export default function NewRequestScreen() {
  const headerHeight = useHeaderHeight();
  const scrollRef = useRef<ScrollView>(null);
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <Stack.Screen options={{ title: 'Nueva solicitud' }} />
      <Screen
        scrollRef={scrollRef}
        title="Solicitud de acompañamiento"
        description="Describe la necesidad que quieres abordar con CERETI. Esta solicitud no es un canal de urgencias."
      >
        <RequestForm
          onRevealGroup={(y) =>
            scrollRef.current?.scrollTo({ y, animated: false })
          }
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}
