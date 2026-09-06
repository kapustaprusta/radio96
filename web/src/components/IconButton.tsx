import { useEffect, useId, useRef, useState } from "react";
import type { ButtonHTMLAttributes, Ref } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tooltip: string;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ tooltip, className = "", children, onClick, ref, ...props }: IconButtonProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const tooltipId = useId();
  const close = () => { window.clearTimeout(timer.current); setOpen(false); };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <button {...props} ref={ref} type="button" className={`button button--icon icon-button ${className}`}
      aria-describedby={open ? tooltipId : undefined}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") timer.current = window.setTimeout(() => setOpen(true), 700);
      }}
      onPointerLeave={close} onFocus={() => setOpen(true)} onBlur={close}
      onKeyDown={(event) => { if (event.key === "Escape") close(); }}
      onClick={(event) => { close(); onClick?.(event); }}>
      {children}
      {open && <span className="tooltip" role="tooltip" id={tooltipId}>{tooltip}</span>}
    </button>
  );
}
