import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { HoverPreviewCard } from "./HoverPreviewContext";

export interface PileModalData {
  label: string;
  cards: HoverPreviewCard[];
}

interface PileModalContextValue {
  openPile: PileModalData | null;
  setOpenPile: (data: PileModalData | null) => void;
}

const PileModalContext = createContext<PileModalContextValue | null>(null);

export function PileModalProvider({ children }: { children: ReactNode }) {
  const [openPile, setOpenPile] = useState<PileModalData | null>(null);
  const value = useMemo(() => ({ openPile, setOpenPile }), [openPile]);
  return <PileModalContext.Provider value={value}>{children}</PileModalContext.Provider>;
}

export function usePileModal() {
  const ctx = useContext(PileModalContext);
  if (!ctx) throw new Error("usePileModal must be used within a PileModalProvider");
  return ctx;
}
