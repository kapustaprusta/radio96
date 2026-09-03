import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { CheckIcon, LinkIcon, RadioIcon } from "../../components/Icons";
import { validateDisplayName } from "../../displayName";
import type { DisplayNameError } from "../../displayName";

const errorMessages: Record<DisplayNameError, string> = {
  empty: "Введи никнейм",
  "too-long": "Не больше 32 символов",
};

type CopyState = "idle" | "copied" | "fallback";

export function PreJoin() {
  const [displayName, setDisplayName] = useState("");
  const [nameError, setNameError] = useState<DisplayNameError | null>(null);
  const [nameWasChecked, setNameWasChecked] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const fallbackInput = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) {
        window.clearTimeout(toastTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (copyState === "fallback") {
      fallbackInput.current?.select();
    }
  }, [copyState]);

  const checkName = (): boolean => {
    const result = validateDisplayName(displayName);
    setNameWasChecked(true);

    if (!result.valid) {
      setNameError(result.error);
      return false;
    }

    setDisplayName(result.value);
    setNameError(null);
    return true;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    checkName();
  };

  const handleCopy = async () => {
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
    }

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }

      await navigator.clipboard.writeText(window.location.href);
      setCopyState("copied");
      toastTimer.current = window.setTimeout(() => {
        setCopyState("idle");
        toastTimer.current = null;
      }, 2000);
    } catch {
      setCopyState("fallback");
    }
  };

  const fieldDescription = nameError ? "display-name-hint display-name-error" : "display-name-hint";

  return (
    <section className="screen centered-screen">
      <div className="prejoin-card">
        <div className="prejoin-heading">
          <span className="prejoin-heading__icon" aria-hidden="true">
            <RadioIcon />
          </span>
          <div>
            <p className="eyebrow">Голосовая комната</p>
            <h1>Вход в комнату</h1>
          </div>
        </div>

        <form noValidate onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="display-name">
            Никнейм
          </label>
          <input
            className="text-input"
            id="display-name"
            name="displayName"
            type="text"
            value={displayName}
            placeholder="Никнейм"
            autoComplete="nickname"
            autoFocus
            aria-invalid={nameError ? "true" : undefined}
            aria-describedby={fieldDescription}
            onChange={(event) => {
              setDisplayName(event.target.value);
              if (nameWasChecked) {
                const result = validateDisplayName(event.target.value);
                setNameError(result.valid ? null : result.error);
              }
            }}
            onBlur={checkName}
          />
          <div className="field-meta">
            <span id="display-name-hint">От 1 до 32 символов</span>
            {nameError && (
              <span className="field-error" id="display-name-error" role="alert">
                {errorMessages[nameError]}
              </span>
            )}
          </div>

          <div className="prejoin-actions">
            <button className="button button--primary" type="submit">
              Войти в разговор
            </button>
            <button
              className="button button--icon"
              type="button"
              aria-label="Копировать ссылку"
              title="Копировать ссылку"
              onClick={handleCopy}
            >
              <LinkIcon />
            </button>
          </div>
        </form>

        {copyState === "fallback" && (
          <div className="copy-fallback" role="status">
            <p>Скопируй ссылку вручную:</p>
            <input
              ref={fallbackInput}
              className="text-input text-input--compact"
              value={window.location.href}
              readOnly
              aria-label="Ссылка на комнату"
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
        )}
      </div>

      <div className="toast" data-visible={copyState === "copied"} role="status" aria-live="polite">
        {copyState === "copied" && (
          <>
            <CheckIcon />
            <span>Ссылка скопирована</span>
          </>
        )}
      </div>
    </section>
  );
}
