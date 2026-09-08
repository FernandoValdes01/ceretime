import { useNavigationSession } from '../navigation/session';
import { Action, Screen } from './screen';

export function RoleHome({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const { clearSession } = useNavigationSession();

  return (
    <Screen title={title} description={description}>
      <Action label="Cambiar de rol" onPress={clearSession} />
    </Screen>
  );
}
