import * as Speech from "expo-speech";
import type { SpeechPort, SpeechResult } from "../application/speech-port";

function findSpeechVoice(voices: Speech.Voice[]) {
  return (
    voices.find((voice) => /^es[-_]cl$/i.test(voice.language)) ??
    voices.find((voice) => /^es[-_]es$/i.test(voice.language)) ??
    voices.find((voice) => /^es(?:[-_]|$)/i.test(voice.language))
  );
}

export function createNativeSpeechAdapter(
  speech: Pick<typeof Speech, "getAvailableVoicesAsync" | "speak" | "stop"> = Speech,
): SpeechPort {
  let generation = 0;
  let activeUtterance:
    | { readonly id: number; readonly settle: (result: SpeechResult) => void }
    | undefined;

  async function flushQueue(): Promise<void> {
    const previous = activeUtterance;
    previous?.settle({ status: "stopped" });
    await speech.stop();
  }

  return {
    async speak(text) {
      const id = ++generation;
      if (!text.trim()) return { status: "failed", reason: "speech-failed" };
      if (text.length > Speech.maxSpeechInputLength)
        return { status: "failed", reason: "text-too-long" };

      let voice: Speech.Voice | undefined;
      try {
        voice = findSpeechVoice(await speech.getAvailableVoicesAsync());
      } catch {
        return { status: "failed", reason: "speech-failed" };
      }

      if (id !== generation) return { status: "stopped" };
      if (!voice) return { status: "failed", reason: "locale-voice-unavailable" };

      try {
        await flushQueue();
      } catch {
        return { status: "failed", reason: "speech-failed" };
      }
      if (id !== generation) return { status: "stopped" };

      return new Promise<SpeechResult>((resolve) => {
        const settle = (result: SpeechResult) => {
          if (activeUtterance?.id !== id) return;
          activeUtterance = undefined;
          resolve(result);
        };
        activeUtterance = { id, settle };

        try {
          speech.speak(text, {
            language: voice.language,
            voice: voice.identifier,
            onDone: () => settle({ status: "completed" }),
            onError: () => settle({ status: "failed", reason: "speech-failed" }),
            onStopped: () => settle({ status: "stopped" }),
          });
        } catch {
          settle({ status: "failed", reason: "speech-failed" });
        }
      });
    },
    async stop() {
      generation += 1;
      await flushQueue();
    },
  };
}
