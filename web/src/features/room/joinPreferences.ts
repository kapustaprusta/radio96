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

export function microphoneErrorText(code: string): string {
  if (code === "microphone_denied") {
    return "Доступ к микрофону запрещён. Разреши его в настройках браузера или войди без микрофона.";
  }

  if (code === "microphone_not_found") {
    return "Микрофон не найден. Подключи устройство или войди без микрофона.";
  }

  return "Не удалось включить микрофон. Проверь устройство или войди без микрофона.";
}
