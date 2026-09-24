import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { CardColor, CharacterLevel } from "@wuwatcg/shared";

/**
 * Everything the Preview + Detail panels need to render, regardless of
 * whether the hovered card is an ActionCard or a CharacterCard. The
 * `kind` discriminant tells the Detail panel which fields are meaningful.
 */
export interface HoverPreviewCard {
  /** The printed card's id, so the Detail panel can look its ability up. */
  cardId?: string;
  imageId: string;
  name: string;
  kind: "action" | "character";
  level?: CharacterLevel;
  cost?: number;
  color?: CardColor;
  damage?: number;
  speed?: number;
}

interface HoverPreviewContextValue {
  hovered: HoverPreviewCard | null;
  setHovered: (card: HoverPreviewCard | null) => void;
  /**
   * The card a touch screen is holding open full-size — hover has no touch
   * equivalent, so pressing and holding a card is how a phone reads it. See
   * CardPeek.
   */
  peeked: HoverPreviewCard | null;
  setPeeked: (card: HoverPreviewCard | null) => void;
}

const HoverPreviewContext = createContext<HoverPreviewContextValue | null>(null);

export function HoverPreviewProvider({ children }: { children: ReactNode }) {
  const [hovered, setHovered] = useState<HoverPreviewCard | null>(null);
  const [peeked, setPeeked] = useState<HoverPreviewCard | null>(null);
  const value = useMemo(
    () => ({ hovered, setHovered, peeked, setPeeked }),
    [hovered, peeked]
  );
  return <HoverPreviewContext.Provider value={value}>{children}</HoverPreviewContext.Provider>;
}

export function useHoverPreview() {
  const ctx = useContext(HoverPreviewContext);
  if (!ctx) throw new Error("useHoverPreview must be used within a HoverPreviewProvider");
  return ctx;
}
