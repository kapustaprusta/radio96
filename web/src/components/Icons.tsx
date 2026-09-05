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

export function LinkIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
      <path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" />
    </IconBase>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v5" />
    </IconBase>
  );
}

export function MicOffIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m2 2 20 20" />
      <path d="M9 9v1a3 3 0 0 0 5.1 2.1" />
      <path d="M15 9.3V5a3 3 0 0 0-5.8-1" />
      <path d="M17 16.9A7 7 0 0 0 19 10" />
      <path d="M5 10a7 7 0 0 0 11.9 5" />
      <path d="M12 19v3" />
    </IconBase>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <circle cx="16" cy="7" r="2" />
      <path d="M4 17h2" />
      <path d="M10 17h10" />
      <circle cx="8" cy="17" r="2" />
    </IconBase>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </IconBase>
  );
}

export function VolumeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M11 5 6 9H2v6h4l5 4Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18 6a8.5 8.5 0 0 1 0 12" />
    </IconBase>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m7 4 13 8-13 8Z" />
    </IconBase>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
      <path d="M16 3.1a4 4 0 0 1 0 7.8" />
    </IconBase>
  );
}

export function UnplugIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m19 5 3-3" />
      <path d="m2 22 3-3" />
      <path d="M6.2 17.8 4.8 16.4a2 2 0 0 1 0-2.8l3.5-3.5 5.6 5.6-3.5 3.5a2 2 0 0 1-2.8 0Z" />
      <path d="m14.5 3.5 6 6" />
      <path d="m16 8-3 3" />
      <path d="m11 5 3-3" />
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
      <path
        d={[
          "M10.7 6.7 9.3 3.5a1.4 1.4 0 0 0-1.6-.8L4.9 3.4a1.5 1.5 0 0 0-1.1 1.5",
          "c.4 7.7 6.6 13.9 14.3 14.3a1.5 1.5 0 0 0 1.5-1.1l.7-2.8a1.4 1.4 0 0 0-.8-1.6",
          "l-3.2-1.4a1.4 1.4 0 0 0-1.7.4l-1.2 1.5a12 12 0 0 1-3.6-3.6l1.5-1.2a1.4 1.4 0 0 0 .4-1.7Z",
        ].join(" ")}
      />
      <path d="m3 3 18 18" />
    </IconBase>
  );
}
