import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { CheckIcon, ClipboardOffIcon } from "../../components/Icons";

export function InviteLinkFeedback({ copyState, onDismiss }: {
  copyState: "idle" | "copied" | "fallback";
  onDismiss: () => void;
}) {
  return (
    <>
      {copyState === "fallback" && <ClipboardFallback onDismiss={onDismiss} />}
      <div className="toast" data-visible={copyState === "copied"} role="status" aria-live="polite">
        {copyState === "copied" && <><CheckIcon /><span>Ссылка скопирована</span></>}
      </div>
    </>
  );
}

function ClipboardFallback({ onDismiss }: { onDismiss: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    input.current?.focus();
    input.current?.select();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return createPortal(
    <section className="screen centered-screen system-screen clipboard-screen" role="dialog"
      aria-modal="true" aria-labelledby="clipboard-title" onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); onDismiss(); }
        if (event.key !== "Tab") return;
        if (event.shiftKey && document.activeElement === input.current) { event.preventDefault(); button.current?.focus(); }
        else if (!event.shiftKey && document.activeElement === button.current) { event.preventDefault(); input.current?.focus(); }
      }}>
      <div className="state-stack">
        <span className="state-icon" aria-hidden="true"><ClipboardOffIcon /></span>
        <h1 id="clipboard-title">Буфер обмена недоступен</h1>
        <p>Попробуй скопировать ссылку вручную.</p>
        <input ref={input} className="text-input" value={window.location.href} readOnly
          aria-label="Ссылка на комнату" onFocus={(event) => event.currentTarget.select()} />
        <div className="state-actions">
          <button ref={button} className="button button--primary" type="button" onClick={onDismiss}>Вернуться</button>
        </div>
      </div>
    </section>, document.body,
  );
}
