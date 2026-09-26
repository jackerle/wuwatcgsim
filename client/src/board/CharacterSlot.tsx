import { useState } from "react";
import { characterStack, isHiddenCard, type CharacterCard, type CharacterInstance } from "@wuwatcg/shared";
import { CardImage } from "./CardImage";
import { CardMenu, useDismiss, type CardMenuItem } from "./CardMenu";
import { useDrag, useDropTarget } from "./DragContext";
import { usePileModal } from "./PileModalContext";
import { useLang } from "../i18n/LanguageContext";

/** What this character can be told to do, worked out by the engine. */
export interface SlotActions {
  /** Cards that may legally be played on top of them. Empty: not on offer. */
  levelOptions: CharacterCard[];
  onLevelUp: (card: CharacterCard) => void;
  /**
   * Who could take the Leader slot by switching with this character. On the
   * Leader that is everyone in the back; on a back character it is only
   * themselves, so the menu can act without asking again. Empty: not on
   * offer.
   */
  switchOptions: CharacterInstance[];
  onSwitch: (toCardId: string) => void;
}

/**
 * Leader Select's own affordance: while it is on, a click picks this
 * character as the Leader outright — no menu, and no other action is on
 * offer yet, since the turn itself has not started.
 */
export interface PickableLeader {
  /** Is this the character currently picked (not yet submitted)? */
  picked: boolean;
  onPick: () => void;
}

const previewOf = (card: CharacterCard) => ({
  cardId: card.id,
  imageId: card.imageId,
  name: card.name,
  kind: "character" as const,
  level: card.level,
});

/**
 * One character in play, drawn as the pile they actually are on the table.
 *
 * Levelling up does not swap the card out, it plays a new one on top, so the
 * lower levels stay underneath. Only a strip of each one shows, so the menu's
 * "View" opens the same expanded view the Pool and Trash piles use — that is
 * where you read the abilities of the levels a character was built through,
 * which still matter for what the character is.
 *
 * Level Up and Switch are here rather than in the control bar because that
 * is where they read: the move is about THIS character, and the bar has an
 * exact one-row budget to fit every other move into. What the menu offers is
 * decided by levelUpOptions()/canSwitchLeader() in the engine, never by this
 * component — and the engine checks again when the move arrives.
 */
export function CharacterSlot({
  slot,
  label,
  actions,
  pickable,
  draggable,
}: {
  slot: CharacterInstance | null;
  /** Shown in an empty slot, and as the expanded panel's title. */
  label?: string;
  /** Omitted for a character nobody at this screen may move right now. */
  actions?: SlotActions;
  /** Set during Leader Select — see PickableLeader. Overrides `actions`. */
  pickable?: PickableLeader;
  /**
   * Your own board: this character can be dragged onto another slot, and
   * another dragged onto it, to switch the Leader — see DragContext.
   */
  draggable?: boolean;
}) {
  const { t } = useLang();
  const { setOpenPile } = usePileModal();
  const [menu, setMenu] = useState<"root" | "level" | "switch" | null>(null);
  const rootRef = useDismiss(menu !== null, () => setMenu(null));
  const drag = useDrag();
  const { dropProps, dropClass } = useDropTarget(draggable && slot ? `char:${slot.card.id}` : undefined);

  if (!slot) {
    return (
      <div className="character-slot empty">
        {label && <span className="character-position">{label}</span>}
      </div>
    );
  }

  // The opponent's starters before the mulligan is over: face-down, and
  // nothing to click — see viewFor() in shared/src/match.ts.
  if (isHiddenCard(slot.card)) {
    return (
      <div className="character-slot-wrap">
        <div className={`character-slot ${slot.position} facedown`} title={t("characterSlot.hiddenTitle")}>
          <div className="character-layer top card-back" />
        </div>
      </div>
    );
  }

  // Highest level first in the expanded view — the top of the pile is the
  // level the character is actually at, so it should read first.
  const pile = characterStack(slot);
  const view = () => {
    setMenu(null);
    setOpenPile({
      label: `${slot.card.name} — ${label ?? slot.position}`,
      cards: [...pile].reverse().map(previewOf),
    });
  };

  const levelOptions = pickable ? [] : actions?.levelOptions ?? [];
  const switchOptions = pickable ? [] : actions?.switchOptions ?? [];
  // Leader Select overrides everything else a click could mean: there is
  // nothing to decide but which character sits in the Leader slot.
  // Otherwise, with nothing to decide, a click is the old one-step "show me
  // the pile".
  const open = pickable
    ? pickable.onPick
    : levelOptions.length || switchOptions.length
      ? () => setMenu("root")
      : view;

  const levelUp = (card: CharacterCard) => {
    setMenu(null);
    actions?.onLevelUp(card);
  };
  const doSwitch = (toCardId: string) => {
    setMenu(null);
    actions?.onSwitch(toCardId);
  };

  const root: CardMenuItem[] = [
    {
      key: "view",
      label: t("characterSlot.view"),
      hint: t("characterSlot.wholePileHint", pile.length),
      onPick: view,
    },
  ];
  if (levelOptions.length > 0) {
    root.push({
      key: "level",
      label: t("characterSlot.levelUp"),
      hint: t("characterSlot.playableHint", levelOptions.length),
      // One legal card is not a choice — go straight to paying for it.
      onPick: () => (levelOptions.length === 1 ? levelUp(levelOptions[0]) : setMenu("level")),
    });
  }
  if (switchOptions.length > 0) {
    root.push({
      key: "switch",
      label: t("characterSlot.switch"),
      hint:
        slot.position === "leader"
          ? t("characterSlot.switchFromLeaderHint")
          : t("characterSlot.switchFromBackHint"),
      onPick: () =>
        switchOptions.length === 1
          ? doSwitch(switchOptions[0].card.id)
          : setMenu("switch"),
    });
  }

  return (
    <div className="character-slot-wrap" ref={rootRef} {...dropProps}>
      <div
        className={`character-slot clickable ${slot.position} ${menu ? "menu-open" : ""} ${
          pickable ? "picking" : ""
        } ${pickable?.picked ? "picked" : ""} ${draggable && !pickable ? "draggable" : ""} ${dropClass}`}
        onClick={open}
        // What the tutorial's guide finds a character by.
        data-card-id={slot.card.id}
        data-name={slot.card.name}
        onPointerDown={
          draggable && !pickable
            ? (event) => drag.press(event, { kind: "character", slot }, previewOf(slot.card))
            : undefined
        }
        role="button"
        title={
          pickable
            ? t("characterSlot.pickAsLeaderTitle", slot.card.name)
            : root.length > 1
              ? t("characterSlot.multiActionTitle", slot.card.name)
              : t("characterSlot.viewOnlyTitle", slot.card.name, pile.length)
        }
      >
        {pile.map((card, index) => (
          <div
            key={`${card.id}-${index}`}
            className={`character-layer ${index === pile.length - 1 ? "top" : ""}`}
            // Each level peeks out above the one played on top of it.
            style={{ top: (pile.length - 1 - index) * 10, zIndex: index }}
          >
            <CardImage card={previewOf(card)} />
          </div>
        ))}
        <span className="character-level">Lv.{slot.card.level}</span>
        {/* Leader Select has not been submitted yet, so the tag follows the
            LOCAL pick rather than the board's still-default arrangement. */}
        {(pickable ? pickable.picked : slot.position === "leader") && (
          <span className="character-tag">Leader</span>
        )}
        {pile.length > 1 && <span className="character-count">{pile.length}</span>}
      </div>

      {menu === "root" && <CardMenu items={root} />}

      {menu === "level" && (
        <CardMenu
          head={t("characterSlot.levelUpMenuHead")}
          items={levelOptions.map((card) => ({
            key: card.id,
            label: `${card.name} Lv.${card.level}`,
            hint: t("characterSlot.levelUpItemHint", card.id, card.level),
            card: previewOf(card),
            onPick: () => levelUp(card),
          }))}
        />
      )}

      {menu === "switch" && (
        <CardMenu
          head={t("characterSlot.switchMenuHead")}
          items={switchOptions.map((option) => ({
            key: option.card.id,
            label: option.card.name,
            hint: `Lv.${option.card.level}`,
            card: previewOf(option.card),
            onPick: () => doSwitch(option.card.id),
          }))}
        />
      )}
    </div>
  );
}
