import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';

import { StudentAreaExample } from './src/StudentAreaExample';
import { createMockMobileClient } from './src/mock-mobile-client';

// Composition root only: UI consumes the replaceable MobileClient boundary.
const mobileClient = createMockMobileClient();

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <StudentAreaExample client={mobileClient} />
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
