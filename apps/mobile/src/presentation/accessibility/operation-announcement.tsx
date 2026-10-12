import { NavigationContext } from "expo-router/react-navigation";
import { useContext, useEffect, useEffectEvent, useRef, type RefObject } from "react";
import { AccessibilityInfo, type View } from "react-native";

// Las pantallas fuera de foco consumen la transición sin interrumpir la pantalla activa.
export function OperationAnnouncement({
  message,
  focusTarget,
  onRevealTarget,
}: {
  readonly message: string | null;
  readonly focusTarget?: RefObject<View | null>;
  readonly onRevealTarget?: () => void;
}) {
  const navigation = useContext(NavigationContext);
  const lastMessage = useRef<string | null>(null);
  const revealTarget = useEffectEvent(() => onRevealTarget?.());

  useEffect(() => {
    if (message === lastMessage.current) return;
    lastMessage.current = message;
    if (!message || (navigation && !navigation.isFocused())) return;
    if (!focusTarget) {
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }

    // El foco habla el resultado después de revelar su contenido; no se suma otro anuncio.
    let frame = requestAnimationFrame(() => {
      revealTarget();
      frame = requestAnimationFrame(() => {
        if (focusTarget.current && (!navigation || navigation.isFocused()))
          AccessibilityInfo.sendAccessibilityEvent(focusTarget.current, "focus");
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [message, navigation, focusTarget]);

  return null;
}
