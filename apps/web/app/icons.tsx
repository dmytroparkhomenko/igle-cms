/** Small hand-authored line icons for the sidebar nav — no icon-library dependency, just enough
 * shapes to make a 12-item text-only nav scannable. Consistent 18x18 viewBox, 1.6 stroke, currentColor. */

type IconProps = { size?: number };

const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 18 18",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const
};

export function DashboardIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <rect x="2.5" y="2.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="10" y="2.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="2.5" y="10" width="5.5" height="5.5" rx="1.2" />
      <rect x="10" y="10" width="5.5" height="5.5" rx="1.2" />
    </svg>
  );
}

export function SitesIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <circle cx="9" cy="9" r="6.5" />
      <ellipse cx="9" cy="9" rx="2.6" ry="6.5" />
      <path d="M2.7 9h12.6M3.6 5.5h10.8M3.6 12.5h10.8" />
    </svg>
  );
}

export function TemplatesIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M9 2.5 15.5 6 9 9.5 2.5 6z" />
      <path d="M2.5 9.5 9 13l6.5-3.5" />
      <path d="M2.5 12.5 9 16l6.5-3.5" />
    </svg>
  );
}

export function IntegrationsIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M6.2 2.7v3M11.8 2.7v3" />
      <path d="M4 5.7h10v3.3a5 5 0 0 1-10 0z" />
      <path d="M9 12.6v3" />
      <path d="M6 15.5h6" />
    </svg>
  );
}

export function DeploymentsIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M9 2.5v9" />
      <path d="M5.6 7.9 9 4.5l3.4 3.4" />
      <path d="M3.5 12v1.8a1.7 1.7 0 0 0 1.7 1.7h7.6a1.7 1.7 0 0 0 1.7-1.7V12" />
    </svg>
  );
}

export function TasksIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <rect x="2.7" y="2.7" width="12.6" height="12.6" rx="2.2" />
      <path d="M5.8 9.2 7.6 11l4.2-4.4" />
    </svg>
  );
}

export function JobsIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <circle cx="9" cy="9" r="6.5" />
      <path d="M9 5.2V9l2.8 1.7" />
    </svg>
  );
}

export function TeamIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <circle cx="6.7" cy="6.5" r="2.4" />
      <circle cx="12.1" cy="7.3" r="1.9" />
      <path d="M2.6 15.3c.4-2.6 2-4 4.1-4s3.7 1.4 4.1 4" />
      <path d="M11.6 11.6c1.7.2 2.9 1.5 3.2 3.7" />
    </svg>
  );
}

export function ServersIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <rect x="2.7" y="2.7" width="12.6" height="4.6" rx="1.1" />
      <rect x="2.7" y="10.7" width="12.6" height="4.6" rx="1.1" />
      <path d="M5.2 5h.01M5.2 13h.01" />
    </svg>
  );
}

export function DomainsIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M7.6 10.4 10.4 7.6" />
      <path d="M8.3 4.8 9.6 3.5a2.6 2.6 0 0 1 3.7 3.7L12 8.5" />
      <path d="M9.7 13.2 8.4 14.5a2.6 2.6 0 0 1-3.7-3.7L6 9.5" />
    </svg>
  );
}

export function CloudflareIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M4 13h9.2a2.6 2.6 0 0 0 .3-5.2 3.9 3.9 0 0 0-7.5-1.3A3 3 0 0 0 3.5 9.6" />
    </svg>
  );
}

export function SettingsIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <circle cx="9" cy="9" r="2.4" />
      <path d="M9 2.8v1.7M9 13.5v1.7M15.2 9h-1.7M4.5 9H2.8M13.1 4.9l-1.2 1.2M6.1 11.9l-1.2 1.2M13.1 13.1l-1.2-1.2M6.1 6.1 4.9 4.9" />
    </svg>
  );
}

export function SunIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <circle cx="9" cy="9" r="3.4" />
      <path d="M9 1.8v2M9 14.2v2M16.2 9h-2M3.8 9h-2M13.9 4.1l-1.4 1.4M5.5 12.5l-1.4 1.4M13.9 13.9l-1.4-1.4M5.5 5.5 4.1 4.1" />
    </svg>
  );
}

export function MoonIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M14.8 10.9A6.2 6.2 0 0 1 7.1 3.2a6.2 6.2 0 1 0 7.7 7.7z" />
    </svg>
  );
}
