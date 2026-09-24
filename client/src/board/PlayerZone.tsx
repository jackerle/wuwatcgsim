import type { ActionCard, CharacterCard, CharacterInstance, PlayerBoard } from "@wuwatcg/shared";
import type { HoverPreviewCard } from "./HoverPreviewContext";
import { CharacterSlot, type PickableLeader, type SlotActions } from "./CharacterSlot";
import type { CardMenuItem } from "./CardMenu";
import { Hand } from "./Hand";
import { ChargeArea } from "./ChargeArea";
import { OwnActionSlot } from "./OwnActionSlot";
import { Pile } from "./Pile";
import { PlayerStats } from "./PlayerStats";
import type { BoardEvent } from "../game/boardEvents";
import { useLang } from "../i18n/LanguageContext";

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
  committed,
  advantage,
  selectedHand,
  handSelectionMeans,
  onHandCardClick,
  unplayable,
  hideHand,
  dealKey,
  actionsFor,
  handMenuFor,
  leaderPick,
  shownLife,
  events,
}: {
  board: PlayerBoard;
  name: string;
  mirrored?: boolean;
  /** The card committed face-down for the Counter Phase, if any. */
  facedown?: ActionCard | null;
  /** Cards turned face-up in the Action Area: the clash card, then follow-ups. */
  actionZone?: ActionCard[];
  /** Has this player committed a card or chosen not to? Public in Battle. */
  committed?: boolean;
  /**
   * Does this player hold [Advantage] for the turn being played? Public — it
   * is decided by who won a battle both players watched.
   */
  advantage?: boolean;
  /** Hand positions picked out — see Hand. */
  selectedHand?: number[];
  /** What that selection means — see Hand's `selectionMeans`. */
  handSelectionMeans?: "pick" | "return";
  onHandCardClick?: (card: ActionCard, index: number) => void;
  /** Why a card in hand cannot be played right now — see Hand. */
  unplayable?: (card: ActionCard, index: number) => string | null;
  /** Show this player's hand as card backs — they are not the one looking. */
  hideHand?: boolean;
  /** Forwarded to Hand — see its own doc comment. */
  dealKey?: string | number;
  /**
   * What each character in play can be told to do — Level Up, Switch, or
   * just be looked at. Given only for a board this screen may actually move
   * right now; see CharacterSlot.
   */
  actionsFor?: (slot: CharacterInstance) => SlotActions | undefined;
  /** What each card in hand can be told to do — see Hand. */
  handMenuFor?: (card: ActionCard, index: number) => CardMenuItem[] | undefined;
  /**
   * Leader Select in progress for this board: which of the three starters is
   * currently picked, and what to call when another one is clicked. Omitted
   * once this board has submitted, or for a board that is not this screen's
   * to choose — see CharacterSlot's `pickable`.
   */
  leaderPick?: { pickedId: string | null; onPick: (cardId: string) => void };
  /**
   * The Life to draw, when it should differ from the board's: held back
   * while a hit waits for a cut-in to finish — see useBoardEvents.
   */
  shownLife?: number;
  /** This player's hits, heals and ability draws playing right now. */
  events?: BoardEvent[];
}) {
  const { t } = useLang();
  // The side this screen plays — the one face-up at the bottom.
  const own = !mirrored && !hideHand && Boolean(onHandCardClick);
  const poolCards = board.characterPool.map(toCharacterPreview);
  const trashCards = board.trash.map(toActionPreview);

  return (
    <div className={`player-zone ${mirrored ? "mirrored" : ""}`}>
      {/*
        Each row below shares the same grid-template-columns (see
        .zone-row in Board.css): left col | main col | right col | spare
        col. That's what makes ChargeArea/Pool share one X (left col) and
        Deck/Trash share another (right col) across different rows. The
        spare column is the Life panel's, in the hand row.
      */}
      <div className="zone-row zone-top-row">
        {/* Only your own board takes drops: nothing is ever dragged onto
            the other player's. */}
        <ChargeArea cards={board.competitionArea} dropId={own ? "charge" : undefined} />
        <OwnActionSlot
          facedown={facedown ?? null}
          revealed={actionZone ?? []}
          committed={committed}
          hideFacedown={hideHand}
          dropId={own ? "commit" : undefined}
        />
        <Pile label="Deck" count={board.actionDeck.length} />
      </div>

      <div className="zone-row characters-row">
        <Pile
          label="Pool"
          count={poolCards.length}
          topCard={poolCards[0] ?? null}
          cards={poolCards}
        />
        <div className="characters-group">
          {([board.back[0] ?? null, board.leader, board.back[1] ?? null] as const).map(
            (slot, index) => {
              const pickable: PickableLeader | undefined =
                leaderPick && slot
                  ? {
                      picked: slot.card.id === leaderPick.pickedId,
                      onPick: () => leaderPick.onPick(slot.card.id),
                    }
                  : undefined;
              return (
                <CharacterSlot
                  key={slot?.card.id ?? `empty-${index}`}
                  slot={slot}
                  label={index === 1 ? "Leader" : t("common.back.position")}
                  actions={slot ? actionsFor?.(slot) : undefined}
                  pickable={pickable}
                  draggable={own}
                />
              );
            }
          )}
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
          selectionMeans={handSelectionMeans}
          unplayable={unplayable}
          onCardClick={hideHand ? undefined : onHandCardClick}
          menuFor={hideHand ? undefined : handMenuFor}
          dealKey={dealKey}
          draggable={own}
        />
        {/* The hand row is each half's outer edge — the bottom of the screen
            for this side, the top for the mirrored one — so the Life panel
            sits in that corner. */}
        <PlayerStats
          name={name}
          life={shownLife ?? board.life}
          advantage={advantage}
          events={events ?? []}
        />
      </div>
    </div>
  );
}
