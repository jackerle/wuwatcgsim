import { useEffect, useState, type HTMLAttributes } from "react";
import { allImageIds, getCard } from "@wuwatcg/shared";
import { useHoverPreview, type HoverPreviewCard } from "./HoverPreviewContext";
import { useLongPress } from "./useLongPress";

/**
 * Every image on file for a card, best first.
 *
 * 27 cards were only ever scraped in their parallel-art printing, so their
 * base `imageId` has no file behind it. Rather than ship 27 broken images,
 * fall through the card's other printings — they are the same card.
 */
function imageCandidates(card: HoverPreviewCard): string[] {
  const definition = card.cardId ? getCard(card.cardId) : undefined;
  const fromDb = definition ? allImageIds(definition) : [];
  return [...new Set([card.imageId, ...fromDb])];
}

/**
 * A card's picture, and nothing else.
 *
 * Every card image in the app goes through here, because which file actually
 * exists is not something a caller should have to know: the first candidate
 * is tried, and each failure falls through to the next printing of the same
 * card. A bare <img> would simply break on those 27 cards.
 */
export function CardArt({
  card,
  className,
  onMouseEnter,
  onMouseLeave,
  pressHandlers,
}: {
  card: HoverPreviewCard;
  className?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Pointer handlers for press-and-hold — see useLongPress. */
  pressHandlers?: HTMLAttributes<HTMLElement>;
}) {
  const candidates = imageCandidates(card);
  const [attempt, setAttempt] = useState(0);

  // A different card in the same slot starts its own search from the top.
  useEffect(() => setAttempt(0), [card.cardId, card.imageId]);

  const src = candidates[Math.min(attempt, candidates.length - 1)];
  const exhausted = attempt >= candidates.length;

  if (exhausted) {
    // Nothing on file. Show the name rather than a broken-image icon.
    return (
      <span
        className={`card-art-missing ${className ?? ""}`}
        title={card.name}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        {...pressHandlers}
      >
        {card.name}
      </span>
    );
  }

  return (
    <img
      src={`/cards/${src}.jpg`}
      alt={card.name}
      className={className}
      onError={() => setAttempt((n) => n + 1)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      draggable={false}
      {...pressHandlers}
    />
  );
}

/**
 * A card's art, wired to push its full detail to the shared Preview/Detail
 * panels on hover, and to open it full-size (CardPeek) on a touch hold. Use this everywhere a card shows up on the board (hand,
 * characters, piles, action slots).
 *
 * The panels themselves want CardArt instead — hovering the big preview must
 * not re-drive the hover state that is drawing it.
 */
export function CardImage({ card, className }: { card: HoverPreviewCard; className?: string }) {
  const { setHovered, setPeeked } = useHoverPreview();
  const pressHandlers = useLongPress(() => {
    setHovered(card);
    setPeeked(card);
  });
  return (
    <CardArt
      card={card}
      className={className}
      onMouseEnter={() => setHovered(card)}
      onMouseLeave={() => setHovered(null)}
      pressHandlers={pressHandlers}
    />
  );
}
