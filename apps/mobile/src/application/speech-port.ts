export type SpeechResult =
  | { readonly status: "completed" | "stopped" }
  | {
      readonly status: "failed";
      readonly reason: "locale-voice-unavailable" | "speech-failed" | "text-too-long";
    };

export interface SpeechPort {
  speak(text: string): Promise<SpeechResult>;
  stop(): Promise<void>;
}
