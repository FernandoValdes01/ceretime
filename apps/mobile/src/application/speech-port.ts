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

export type SpeechRecognitionResult =
  | { readonly status: "recognized"; readonly transcript: string }
  | { readonly status: "silence" | "denied" | "unavailable" | "failed" | "stopped" };

export interface SpeechRecognitionPort {
  recognize(): Promise<SpeechRecognitionResult>;
  stop(): Promise<void>;
}
