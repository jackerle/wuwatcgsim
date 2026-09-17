import { characterStack, type CharacterInstance } from "@wuwatcg/shared";
import { CardImage } from "./CardImage";
import { usePileModal } from "./PileModalContext";

/**
 * One character in play, drawn as the pile they actually are on the table.
 *
 * Levelling up does not swap the card out, it plays a new one on top, so the
 * lower levels stay underneath. Only a strip of each one shows, so clicking
 * opens the same expanded view the Pool and Trash piles use — that is where
 * you read the abilities of the levels a character was built through, which
 * still matter for what the character is.
 */
export function CharacterSlot({
  slot,
  label,
}: {
  slot: CharacterInstance | null;
  /** Shown in an empty slot, and as the expanded panel's title. */
  label?: string;
}) {
  const { setOpenPile } = usePileModal();

  if (!slot) {
    return (
      <div className="character-slot empty">
        {label && <span className="character-position">{label}</span>}
      </div>
    );
  }

  // Highest level first in the expanded view — the top of the pile is the
  // level the character is actually at, so it should read first.
  const pile = characterStack(slot);
  const open = () =>
    setOpenPile({
      label: `${slot.card.name} — ${label ?? slot.position}`,
      cards: [...pile].reverse().map((card) => ({
        cardId: card.id,
        imageId: card.imageId,
        name: card.name,
        kind: "character" as const,
        level: card.level,
      })),
    });

  return (
    <div
      className={`character-slot clickable ${slot.position}`}
      onClick={open}
      role="button"
      title={`ดูการ์ดทั้งกองของ ${slot.card.name} (${pile.length} ใบ)`}
    >
      {pile.map((card, index) => (
        <div
          key={`${card.id}-${index}`}
          className={`character-layer ${index === pile.length - 1 ? "top" : ""}`}
          // Each level peeks out above the one played on top of it.
          style={{ top: (pile.length - 1 - index) * 10, zIndex: index }}
        >
          <CardImage
            card={{
              cardId: card.id,
              imageId: card.imageId,
              name: card.name,
              kind: "character",
              level: card.level,
            }}
          />
        </div>
      ))}
      <span className="character-level">Lv.{slot.card.level}</span>
      {slot.position === "leader" && <span className="character-tag">Leader</span>}
      {pile.length > 1 && <span className="character-count">{pile.length}</span>}
    </div>
  );
}
