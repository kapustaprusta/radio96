import { useCallback, useEffect, useRef, useState } from "react";

export function useInviteLink() {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "fallback">("idle");
  const timer = useRef<number | undefined>(undefined);
  const active = useRef(true);
  const [compact, setCompact] = useState(() => window.matchMedia?.("(max-width: 650px)").matches ?? false);

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 650px)");
    if (!media) return;
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

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

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setCopyState("idle");
  }, []);

  const nativeShare = compact && typeof navigator.share === "function";
  const share = async () => {
    if (!nativeShare) return copy();
    try {
      await navigator.share({ title: "Голосовая комната — radio96", url: window.location.href });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      await copy();
    }
  };

  return { copyState, copy, share, compact, nativeShare, dismiss };
}
