import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </IconBase>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
      <path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" />
    </IconBase>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m5 12 4 4L19 6" />
    </IconBase>
  );
}

export function RadioIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5.6 16.4a6.2 6.2 0 0 1 0-8.8" />
      <path d="M2.8 19.2a10.2 10.2 0 0 1 0-14.4" />
      <path d="M18.4 7.6a6.2 6.2 0 0 1 0 8.8" />
      <path d="M21.2 4.8a10.2 10.2 0 0 1 0 14.4" />
      <circle cx="12" cy="12" r="2" />
    </IconBase>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </IconBase>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
      <path d="m8.5 8.5 4 4" />
      <path d="m12.5 8.5-4 4" />
    </IconBase>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </IconBase>
  );
}

export function PhoneOffIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10.7 6.7 9.3 3.5a1.4 1.4 0 0 0-1.6-.8L4.9 3.4a1.5 1.5 0 0 0-1.1 1.5c.4 7.7 6.6 13.9 14.3 14.3a1.5 1.5 0 0 0 1.5-1.1l.7-2.8a1.4 1.4 0 0 0-.8-1.6l-3.2-1.4a1.4 1.4 0 0 0-1.7.4l-1.2 1.5a12 12 0 0 1-3.6-3.6l1.5-1.2a1.4 1.4 0 0 0 .4-1.7Z" />
      <path d="m3 3 18 18" />
    </IconBase>
  );
}
