// The buttons for whatever the turn player may legally do right now.
//
// What is offered comes from the engine's own legalIntents(), not from a
// second copy of the rules written out in the UI. If the two ever disagree,
// the engine wins: a button the engine rejects just shows its reason.

import { useState, type ReactNode } from "react";
import { PhaseTrack, type PhaseAction, type PhaseStepKey } from "./PhaseTrack";
import { ConfirmDialog } from "../board/ConfirmDialog";
import { useLang } from "../i18n/LanguageContext";
import {
  canCommit,
  canCommitAnything,
  legalIntents,
  MAX_ACTIONS_PER_TURN,
  type CharacterCard,
  type MatchIntent,
  type MatchState,
} from "@wuwatcg/shared";

export interface ControlBarProps {
  state: MatchState;
  onSend: (playerId: string, intent: MatchIntent) => void;
  onClearSelection: () => void;
  /** Why the last move was refused, if it was. */
  error?: string | null;
  /** Whose side of the table is face-up right now. */
  viewer: string;
  /**
   * The seats this client is allowed to play. Both of them on a shared
   * screen; just your own over the network, where the other player's moves
   * are theirs to make.
   */
  controls: string[];
  names: Record<string, string>;
  /** A seat that owes an answer, when it isn't the viewer's to give. */
  waitingOn?: string | null;
  /**
   * Drops the question that seat owes, when the move behind it is the
   * viewer's. A question put to someone who cannot answer it — they have
   * dropped out, or the card that asked has a bug — otherwise freezes the
   * board for both players, since every other move is refused while one is
   * open.
   */
  onCancelChoice?: (() => void) | null;
  /**
   * The opening mulligan, while it is the viewer's to make. `picked` is how
   * many cards they have marked to put back; `onSubmit` sends them (an empty
   * pick is the "keep this hand" answer and is just as valid).
   */
  mulligan?: {
    picked: number;
    onSubmit: () => void;
  } | null;
  /**
   * A Level Up picked off a character and now being paid for. While this is
   * set the bar shows nothing but the cost being counted out — the move is
   * half-made, and offering the rest of the turn's actions beside it would
   * only invite one to be started on top of it.
   */
  levelUp?: {
    card: CharacterCard;
    /** How many cards are picked out of hand so far. */
    picked: number;
    onCancel: () => void;
  } | null;
  /** Match-level controls, pushed to the far end of the same row. */
  children?: ReactNode;
}

export function ControlBar({
  state,
  onSend,
  onClearSelection,
  error,
  viewer,
  controls,
  names,
  waitingOn,
  onCancelChoice,
  mulligan,
  children,
  levelUp,
}: ControlBarProps) {
  const { t } = useLang();
  /**
   * A move waiting on a yes/no. Held here rather than sent straight off,
   * because leaving the Main Phase and declining the clash both throw
   * something away that cannot be got back.
   */
  const [confirming, setConfirming] = useState<{
    prompt: string;
    detail?: string;
    confirmLabel: string;
    onYes: () => void;
  } | null>(null);
  const nameOf = (playerId: string): string => names[playerId] ?? playerId;
  const me = state.turnPlayerId;
  // Whether the turn is this client's to drive. Over the network the other
  // player's buttons are not disabled, they are simply not here: the server
  // would refuse them anyway, and a dead button is worse than no button.
  const mine = controls.includes(me);
  const allowed = mine ? legalIntents(state, me) : [];
  // The Counter Phase is the one moment both players act, so its prompt
  // follows whoever is looking at the screen, not whose turn it is.
  // Committing is the one move a player makes on the other's turn too, so this
  // follows the viewer rather than the turn player.
  const waitingToCommit = canCommit(state, viewer) && controls.includes(viewer);
  const act = (intent: MatchIntent) => {
    onSend(me, intent);
    onClearSelection();
  };

  // --- The phase track, as the turn's controls -----------------------------
  //
  // Each step is pressable only when the engine says its move is legal, so
  // this is a rendering of legalIntents() rather than a second rulebook.
  const actionsLeft =
    MAX_ACTIONS_PER_TURN - (state.boards[me]?.actionsTakenThisTurn.length ?? 0);
  const phaseActions: Partial<Record<PhaseStepKey, PhaseAction>> = {};
  const phaseWaiting: Partial<Record<PhaseStepKey, string>> = {};

  if (allowed.includes("startTurn")) {
    phaseActions.draw = {
      onPick: () => act({ kind: "startTurn" }),
      title: t("controlBar.drawTitle"),
    };
  }

  if (allowed.includes("toBattle")) {
    phaseActions.battle = {
      onPick: () =>
        setConfirming({
          prompt: t("controlBar.toBattlePrompt"),
          detail: actionsLeft > 0 ? t("controlBar.toBattleDetail", actionsLeft) : undefined,
          confirmLabel: t("controlBar.toBattleConfirm"),
          onYes: () => act({ kind: "toBattle" }),
        }),
      title: t("controlBar.toBattleTitle"),
    };
  }

  if (allowed.includes("resolveCounter")) {
    phaseActions.judgement = {
      onPick: () => act({ kind: "resolveCounter" }),
      title: t("controlBar.judgementTitle"),
    };
  } else if (state.phase === "counter" && mine) {
    phaseWaiting.judgement = t("controlBar.judgementWaiting");
  }

  // End carries two meanings, and the phase says which: in the Battle Phase
  // it is "I lay nothing down", and after that it is the turn finishing.
  // Both are the same instinct — I am done here — so they share the step
  // rather than adding a sixth box that is only ever true once.
  if (waitingToCommit) {
    phaseActions.end = {
      onPick: () =>
        setConfirming({
          prompt: t("controlBar.passPrompt"),
          detail: canCommitAnything(state, viewer)
            ? t("controlBar.passDetailCan")
            : t("controlBar.passDetailCannot"),
          confirmLabel: t("controlBar.pass"),
          onYes: () => {
            onSend(viewer, { kind: "pass" });
            onClearSelection();
          },
        }),
      title: t("controlBar.passTitle"),
    };
  } else if (allowed.includes("endTurn")) {
    // Still holding follow-ups is the one case worth a second look; the
    // plain End Phase has nothing left to spend.
    const holdingCombo = state.phase === "combo" && state.combo?.playerId === me;
    phaseActions.end = {
      onPick: () =>
        holdingCombo
          ? setConfirming({
              prompt: t("controlBar.endComboPrompt"),
              detail: state.combo?.unlimited
                ? t("controlBar.endComboDetailUnlimited")
                : t("controlBar.endComboDetailRemaining", state.combo?.remaining ?? 0),
              confirmLabel: t("controlBar.endTurn"),
              onYes: () => act({ kind: "endTurn" }),
            })
          : act({ kind: "endTurn" }),
      title: holdingCombo ? t("controlBar.endComboThenTurnTitle") : t("controlBar.endTurn"),
    };
  }

  if (state.winnerId) {
    return (
      <div className="control-bar">
        <span className="control-phase">
          {t(
            "controlBar.gameOver",
            state.winnerId === "draw" ? t("controlBar.draw") : t("controlBar.wins", nameOf(state.winnerId))
          )}
        </span>
        <span className="control-spacer" />
        {children}
      </div>
    );
  }

  // The opening mulligan, before turn 1. Both players answer it at once, so
  // like committing it follows the VIEWER rather than the turn player — the
  // hand you can click is the face-up one.
  if (state.phase === "mulligan") {
    const chosen = Boolean(state.mulliganDone[viewer]);
    const theirs = controls.includes(viewer);
    const waitingFor = Object.keys(state.boards).filter((id) => !state.mulliganDone[id]);
    return (
      <div className="control-bar">
        <span className="control-phase">{t("controlBar.mulliganHeading", nameOf(state.startingPlayerId))}</span>
        <span className="control-actions">
          {theirs && !chosen && mulligan && (
            <>
              <span className="control-hint">{t("controlBar.mulliganHint")}</span>
              {mulligan.picked > 0 && (
                <button type="button" onClick={onClearSelection}>
                  {t("controlBar.clearSelection")}
                </button>
              )}
              <button type="button" className="primary" onClick={mulligan.onSubmit}>
                {mulligan.picked > 0 ? t("controlBar.mulliganSubmit", mulligan.picked) : t("controlBar.keepHand")}
              </button>
            </>
          )}
          {theirs && chosen && (
            <span className="control-hint">
              {waitingFor.length > 0
                ? t("controlBar.chosenWaiting", waitingFor.map(nameOf).join(", "))
                : t("controlBar.chosen")}
            </span>
          )}
          {!theirs && (
            <span className="control-hint">
              {chosen ? t("controlBar.theyChose", nameOf(viewer)) : t("controlBar.waitingToPick", nameOf(viewer))}
            </span>
          )}
          {error && <span className="control-error">{error}</span>}
        </span>
        {children}
      </div>
    );
  }

  // Paying for a Level Up. Which character, and which card on top of them,
  // was already settled at the character itself — all that is left is the
  // cost, and it comes out of the hand below.
  if (levelUp) {
    const { card, picked, onCancel } = levelUp;
    return (
      <div className="control-bar">
        <span className="control-phase">{t("controlBar.levelUpHeading", card.name, card.level)}</span>
        <span className="control-actions">
          {/* No confirm button: picking the last card opens the dialog, and
              that is where the move is agreed to. */}
          <span className="control-hint">{t("controlBar.levelUpHint", picked, card.level)}</span>
          <button type="button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          {error && <span className="control-error">{error}</span>}
        </span>
        {children}
      </div>
    );
  }

  return (
    <div className="control-bar">
      {/* Three parts, and the two outer ones share one flex basis — that is
          what puts the phase track on the centre line of the board however
          long the buttons on either side run. */}
      <span className="control-side">
      <span className="control-phase">{t("controlBar.turnHeading", state.turnNumber, nameOf(me))}</span>

      {/* Scrolls sideways rather than wrapping: the board has an exact
          vertical budget, so this bar must stay one row high however many
          moves are on offer. */}
      <span className="control-actions">
      {/* Every move about the turn is now a step in the track below: Draw,
          Battle, Judgement, End. Charge, Level Up, Switch and laying a card
          face-down are moves about one particular card, so each is asked of
          that card — click it on the board. See CardMenu. What is left in
          this row is what the board cannot say by itself. */}

      {state.phase === "action" && mine && (
        <span className="control-hint">
          {actionsLeft > 0 ? t("controlBar.mainPhaseHint", actionsLeft) : t("controlBar.noActionsLeft")}
        </span>
      )}

      {waitingToCommit && (
        <span className="control-hint">
          {canCommitAnything(state, viewer) ? t("controlBar.canCommitHint") : t("controlBar.cannotCommitHint")}
        </span>
      )}
      {/* The other side has no move yet: the turn player opens the Counter
          Phase. Without a word here their hand simply offers nothing and the
          screen looks stuck. */}
      {state.phase === "action" && viewer !== state.turnPlayerId && controls.includes(viewer) && (
        <span className="control-hint">{t("controlBar.waitOtherMainPhase", nameOf(state.turnPlayerId))}</span>
      )}
      {state.phase === "counter" &&
        state.committed[viewer] &&
        !allowed.includes("resolveCounter") && (
          <span className="control-hint">
            {t(
              "controlBar.waitingOtherSide",
              state.facedown[viewer] ? t("controlBar.committed") : t("controlBar.passed")
            )}
          </span>
        )}
      {/* Like committing, the combo prompt follows the viewer: the hand you
          can actually click is the face-up one, not the turn player's. */}
      {state.phase === "combo" && state.combo?.playerId === viewer && (
        <span className="control-hint">
          {t("controlBar.comboOwnHint")}
          {state.combo.unlimited ? t("controlBar.comboUnlimited") : t("controlBar.comboRemaining", state.combo.remaining)}
        </span>
      )}
      {state.phase === "combo" && state.combo && state.combo.playerId !== viewer && (
        <span className="control-hint">
          {controls.includes(state.combo.playerId)
            ? t("controlBar.switchToCombo", nameOf(state.combo.playerId))
            : t("controlBar.waitingToCombo", nameOf(state.combo.playerId))}
        </span>
      )}

      {!mine && !waitingToCommit && state.phase !== "combo" && (
        <span className="control-hint">{t("controlBar.waitingToPlay", nameOf(me))}</span>
      )}
      {waitingOn && (
        <>
          <span className="control-hint">{t("controlBar.waitingToAnswer", nameOf(waitingOn))}</span>
          {/* The move is ours, so dropping it is ours to do. Without this a
              question put to a player who never answers leaves both sides
              unable to do anything at all. */}
          {onCancelChoice && (
            <button type="button" title={t("controlBar.cancelQuestionTitle")} onClick={onCancelChoice}>
              {t("common.cancelQuestion")}
            </button>
          )}
        </>
      )}

      {error && <span className="control-error">{error}</span>}
      </span>
      </span>

      {/* Where the turn is, and how it is moved on. A step is a button only
          when its move is this client's to make right now. */}
      <PhaseTrack phase={state.phase} actions={phaseActions} waiting={phaseWaiting} />

      <span className="control-side control-side-end">
        <button
          type="button"
          className="danger"
          title={t("controlBar.concedeTitle", nameOf(viewer))}
          onClick={() => {
            onSend(viewer, { kind: "concede" });
            onClearSelection();
          }}
        >
          {t("controlBar.concede")}
        </button>
        {children}
      </span>

      {confirming && (
        <ConfirmDialog
          prompt={confirming.prompt}
          detail={confirming.detail}
          confirmLabel={confirming.confirmLabel}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const go = confirming.onYes;
            setConfirming(null);
            go();
          }}
        />
      )}
    </div>
  );
}
