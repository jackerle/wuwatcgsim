import type { ActionCard, CharacterCard, PlayerBoard } from "@wuwatcg/shared";
import type { HoverPreviewCard } from "./HoverPreviewContext";
import { CharacterSlot } from "./CharacterSlot";
import { Hand } from "./Hand";
import { ChargeArea } from "./ChargeArea";
import { OwnActionSlot } from "./OwnActionSlot";
import { Pile } from "./Pile";

function toActionPreview(card: ActionCard): HoverPreviewCard {
  return {
    cardId: card.id,
    imageId: card.imageId,
    name: card.name,
    kind: "action",
    cost: card.cost,
    color: card.color,
    damage: card.damage,
    speed: card.speed,
  };
}

function toCharacterPreview(card: CharacterCard): HoverPreviewCard {
  return {
    cardId: card.id,
    imageId: card.imageId,
    name: card.name,
    kind: "character",
    level: card.level,
  };
}

export function PlayerZone({
  board,
  name,
  mirrored,
  facedown,
  actionZone,
  selectedHand,
  onHandCardClick,
  unplayable,
  hideHand,
  dealKey,
}: {
  board: PlayerBoard;
  name: string;
  mirrored?: boolean;
  /** The card committed face-down for the Counter Phase, if any. */
  facedown?: ActionCard | null;
  /** Cards turned face-up in the Action Area: the clash card, then follow-ups. */
  actionZone?: ActionCard[];
  /** Hand positions picked out — see Hand. */
  selectedHand?: number[];
  onHandCardClick?: (card: ActionCard, index: number) => void;
  /** Why a card in hand cannot be played right now — see Hand. */
  unplayable?: (card: ActionCard, index: number) => string | null;
  /** Show this player's hand as card backs — they are not the one looking. */
  hideHand?: boolean;
  /** Forwarded to Hand — see its own doc comment. */
  dealKey?: string | number;
}) {
  const poolCards = board.characterPool.map(toCharacterPreview);
  const trashCards = board.trash.map(toActionPreview);

  return (
    <div className={`player-zone ${mirrored ? "mirrored" : ""}`}>
      {/*
        Each row below shares the same grid-template-columns (see
        .zone-row in Board.css): left col | main col | right col | stats
        col. That's what makes ChargeArea/Pool share one X (left col) and
        Deck/Trash share another (right col) across different rows.
      */}
      <div className="zone-row zone-top-row">
        <ChargeArea cards={board.competitionArea} />
        <OwnActionSlot
          facedown={facedown ?? null}
          revealed={actionZone ?? []}
          hideFacedown={hideHand}
        />
        <Pile label="Deck" count={board.actionDeck.length} />
        <div className="stats-bar">
          <span className="player-name">{name}</span>
          <span className="stat" title="Life">
            ❤ {board.life}
          </span>
        </div>
      </div>

      <div className="zone-row characters-row">
        <Pile
          label="Pool"
          count={poolCards.length}
          topCard={poolCards[0] ?? null}
          cards={poolCards}
        />
        <div className="characters-group">
          <CharacterSlot slot={board.back[0] ?? null} label="หลัง" />
          <CharacterSlot slot={board.leader} label="Leader" />
          <CharacterSlot slot={board.back[1] ?? null} label="หลัง" />
        </div>
        <Pile
          label="Trash"
          count={trashCards.length}
          topCard={trashCards[trashCards.length - 1] ?? null}
          cards={trashCards}
        />
      </div>

      <div className="zone-row hand-row">
        <div />
        <Hand
          cards={board.hand}
          faceDown={hideHand}
          selected={selectedHand}
          unplayable={unplayable}
          onCardClick={hideHand ? undefined : onHandCardClick}
          dealKey={dealKey}
        />
      </div>
    </div>
  );
}
