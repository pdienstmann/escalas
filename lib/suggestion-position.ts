export type SuggestionPosition = {
  top: number;
  left: number;
  maxHeight: number;
  placement: "above" | "below";
};

type AnchorRect = { top: number; bottom: number; left: number; right: number };

export function suggestionPosition(
  anchor: AnchorRect,
  viewport: { width: number; height: number },
  cardWidth = 380,
): SuggestionPosition | null {
  if (viewport.width <= 700) return null;

  const margin = 8;
  const gap = 6;
  const spaceAbove = Math.max(0, anchor.top - margin - gap);
  const spaceBelow = Math.max(0, viewport.height - anchor.bottom - margin - gap);
  const placement = spaceBelow >= 360 || spaceBelow >= spaceAbove ? "below" : "above";
  const available = placement === "below" ? spaceBelow : spaceAbove;
  const maxHeight = Math.max(240, Math.min(620, available));
  const left = Math.max(
    margin,
    Math.min(viewport.width - cardWidth - margin, anchor.left),
  );
  const top =
    placement === "below"
      ? anchor.bottom + gap
      : Math.max(margin, anchor.top - gap - maxHeight);

  return { top, left, maxHeight, placement };
}
