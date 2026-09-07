import { Stack } from 'expo-router';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Screen } from '../components/screen';
import { RequestForm } from './request-form';

export default function NewRequestScreen() {
  const headerHeight = useHeaderHeight();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <Stack.Screen options={{ title: 'Nueva solicitud' }} />
      <Screen
        title="Solicitud de acompañamiento"
        description="Describe la necesidad que quieres abordar con CERETI. Esta solicitud no es un canal de urgencias."
      >
        <RequestForm />
      </Screen>
    </KeyboardAvoidingView>
  );
}
