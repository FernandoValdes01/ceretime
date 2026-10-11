import { NavigationContext } from "expo-router/react-navigation";
import { useContext, useEffect, useRef } from "react";
import { AccessibilityInfo } from "react-native";

// Las pantallas fuera de foco consumen la transición sin interrumpir la pantalla activa.
export function OperationAnnouncement({ message }: { readonly message: string | null }) {
  const navigation = useContext(NavigationContext);
  const lastMessage = useRef<string | null>(null);

  useEffect(() => {
    if (message === lastMessage.current) return;
    lastMessage.current = message;
    if (message && (!navigation || navigation.isFocused()))
      AccessibilityInfo.announceForAccessibility(message);
  }, [message, navigation]);

  return null;
}
