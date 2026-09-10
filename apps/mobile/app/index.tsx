import { Redirect } from "expo-router";

import { getRoleHome } from "../src/presentation/navigation/roles";
import { useNavigationSession } from "../src/presentation/navigation/session";

export default function Index() {
  const { role } = useNavigationSession();
  return <Redirect href={role ? getRoleHome(role) : "/login"} />;
}
