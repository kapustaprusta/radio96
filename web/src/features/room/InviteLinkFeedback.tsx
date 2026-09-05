import { useEffect, useRef } from "react";

import { CheckIcon } from "../../components/Icons";

export function InviteLinkFeedback({ copyState }: { copyState: "idle" | "copied" | "fallback" }) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (copyState === "fallback") input.current?.select();
  }, [copyState]);

  return (
    <>
      {copyState === "fallback" && (
        <div className="copy-fallback" role="status">
          <p>Скопируй ссылку вручную:</p>
          <input
            ref={input}
            className="text-input text-input--compact"
            value={window.location.href}
            readOnly
            aria-label="Ссылка на комнату"
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}
      <div className="toast" data-visible={copyState === "copied"} role="status" aria-live="polite">
        {copyState === "copied" && <><CheckIcon /><span>Ссылка скопирована</span></>}
      </div>
    </>
  );
}
