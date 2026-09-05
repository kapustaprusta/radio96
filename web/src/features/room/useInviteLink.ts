import { useEffect, useRef, useState } from "react";

export function useInviteLink() {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "fallback">("idle");
  const timer = useRef<number | undefined>(undefined);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  const copy = async () => {
    window.clearTimeout(timer.current);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }

      await navigator.clipboard.writeText(window.location.href);
      if (!active.current) return;
      setCopyState("copied");
      timer.current = window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      if (active.current) setCopyState("fallback");
    }
  };

  return { copyState, copy };
}
