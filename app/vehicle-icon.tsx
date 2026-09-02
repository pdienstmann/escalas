import type { SVGProps } from "react";

type VehicleIconProps = SVGProps<SVGSVGElement> & {
  type?: string | null;
  label?: string;
};

/** Stable vehicle glyphs that do not depend on operating-system emoji fonts. */
export function VehicleIcon({ type, label, className = "", ...props }: VehicleIconProps) {
  const normalized = String(type || "sedan").toLowerCase();
  return (
    <svg
      viewBox="0 0 32 20"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={`vehicle-glyph type-${normalized} ${className}`.trim()}
      {...props}
    >
      {normalized === "moto" ? <MotoGlyph /> : normalized === "van" ? <VanGlyph /> : <CarGlyph type={normalized} />}
    </svg>
  );
}

function MotoGlyph() {
  return <>
    <circle cx="7" cy="15" r="3.2" />
    <circle cx="25" cy="15" r="3.2" />
    <path d="M7 15h6l4-7h4l4 7M12 15l-3-7h5l4 7M19 8l-2-3h4M21 5h4" />
  </>;
}

function VanGlyph() {
  return <>
    <path d="M3 6h18l6 5v5H3z" />
    <path d="M20 7v5h6M7 8h8" />
    <circle cx="9" cy="16" r="2.5" />
    <circle cx="24" cy="16" r="2.5" />
  </>;
}

function CarGlyph({ type }: { type: string }) {
  const pickup = type === "pickup";
  const suv = type === "suv";
  return <>
    <path d={pickup ? "M3 10h12l2-5h6l4 5h2v6H3z" : suv ? "M3 10l4-5h17l5 6v5H3z" : "M3 11l4-5h16l6 5v5H3z"} />
    {pickup ? <path d="M16 6v5h12M7 10h8" /> : <path d="M8 7h14l4 4H5" />}
    <circle cx="9" cy="16" r="2.5" />
    <circle cx="24" cy="16" r="2.5" />
  </>;
}

export function vehicleTypeLabel(type?: string | null) {
  return ({ moto: "Moto", pickup: "Caminhonete", van: "Furgão", suv: "SUV", sedan: "Sedan" } as Record<string, string>)[String(type || "sedan").toLowerCase()] || "Viatura";
}
