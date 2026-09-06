// El transporte de desarrollo de Expo intenta abrir un WebSocket hacia Metro.
// Las pruebas del router no necesitan un servidor de desarrollo.
jest.mock('expo/src/async-require/messageSocket.native', () => ({}));
