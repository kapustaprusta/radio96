import type { AudioInputChoice } from "./AudioSettingsDialog";

export interface JoinPreferences {
  displayName: string;
  microphoneEnabled: boolean;
  input: AudioInputChoice;
  outputId: string;
}

export const defaultJoinPreferences: JoinPreferences = {
  displayName: "",
  microphoneEnabled: true,
  input: { deviceId: "default", label: "Микрофон по умолчанию" },
  outputId: "default",
};
