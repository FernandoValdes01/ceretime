import { fireEvent, render, screen } from '@testing-library/react-native';
import { useFonts } from 'expo-font';
import { StudentScreen } from '../src/presentation/estudiante/student-screen';
import { RequestForm } from '../src/presentation/estudiante/request-form';

jest.mock('expo-font', () => ({ useFonts: jest.fn() }));

const form = (
  <StudentScreen title="Solicitud" description="Prueba de fuentes">
    <RequestForm onRevealGroup={() => {}} />
  </StudentScreen>
);

test('cargar la tipografía no borra los valores ingresados', () => {
  jest.mocked(useFonts).mockReturnValue([false, null]);
  const { rerender } = render(form);
  fireEvent.changeText(
    screen.getByLabelText('¿Qué necesidad quieres abordar? *'),
    'Leer materiales accesibles.',
  );
  jest.mocked(useFonts).mockReturnValue([true, null]);
  rerender(
    <StudentScreen title="Solicitud" description="Prueba de fuentes">
      <RequestForm onRevealGroup={() => {}} />
    </StudentScreen>,
  );
  expect(screen.getByDisplayValue('Leer materiales accesibles.')).toHaveStyle({
    fontFamily: 'FiraSans_400Regular',
  });
});

test('un fallo de la fuente no bloquea la revisión del formulario', () => {
  jest
    .mocked(useFonts)
    .mockReturnValue([false, new Error('Fuente no disponible')]);
  render(form);
  fireEvent.press(screen.getByRole('button', { name: 'Revisar formulario' }));
  expect(
    screen.getByText('Describe la necesidad que quieres abordar.'),
  ).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Solicitud' })).toHaveStyle({
    fontFamily: undefined,
  });
});
