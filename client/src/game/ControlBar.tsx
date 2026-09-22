// The turn controls: the five phase tabs are the only phase navigation, and
// the small status line below says what is happening without competing with
// those tabs.
//
// To the right of the track sits ONE button, and it is the only control here:
// whatever this client's next move actually is, named as a verb — Start Turn,
// Go Battle, Pass, Reveal, End Turn. The track beside it is now read-only (see
// PhaseTrack), so the bar answers "where is the turn" and "what do I press" in
// two places that cannot be mistaken for each other.
//
// Legality stays in shared. The bar asks legalIntents()/canCommit() and never
// recreates a rules check in React; its derived wording is presentation only.

import { useState, type ReactNode } from "react";
import { PhaseTrack, type PhaseStepKey } from "./PhaseTrack";
import { ConfirmDialog } from "../board/ConfirmDialog";
import { useLang } from "../i18n/LanguageContext";
import {
  canCommitAnything,
  canPassCounter,
  legalIntents,
  MAX_ACTIONS_PER_TURN,
  type CharacterCard,
  type MatchIntent,
  type MatchState,
} from "@wuwatcg/shared";

/**
 * Has the combo window's owner actually laid a follow-up down?
 *
 * The clash card is the first card in its owner's Action Area; anything past it
 * got there through playCombo. That is the only signal, and it is enough: the
 * window itself (state.combo) exists from the moment the clash is won, whether
 * or not it is ever used.
 */
function comboStarted(state: MatchState): boolean {
  const owner = state.combo?.playerId;
  if (!owner) return false;
  return (state.actionZone[owner]?.length ?? 0) > 1;
}

/**
 * Which box on the track is lit.
 *
 * One engine phase, `combo`, covers two boxes: the beat right after the clash
 * was judged, and a follow-up chain actually running. They are one phase to the
 * engine — the window opens the instant Judgement resolves — but two different
 * things to a player, so the split is on whether a follow-up has been played.
 * A battle where nobody follows up therefore never lights Combo and reads as
 * Judgement → End, which is what happens.
 */
function activeStep(state: MatchState): PhaseStepKey | null {
  switch (state.phase) {
    case "draw":
      return "draw";
    case "action":
      return "main";
    case "counter":
      return "battle";
    case "combo":
      return comboStarted(state) ? "combo" : "judgement";
    case "end":
      return "end";
    default:
      // Leader Select and the mulligan, which render their own bar without a
      // track — there is no turn yet for the track to describe.
      return null;
  }
}

/**
 * One move this client may make, filed under the phase step it leads TO.
 *
 * Keyed that way because the step is also the verb: the move that reaches
 * Battle is "Go Battle". Only the button reads these now — the track does not.
 */
interface StepMove {
  onPick: () => void;
  /** Localized tooltip: what pressing it will actually do. */
  title: string;
}

export interface ControlBarProps {
  state: MatchState;
  onSend: (playerId: string, intent: MatchIntent) => void;
  onClearSelection: () => void;
  /** Why the last move was refused, if any. */
  error?: string | null;
  /** Whose side of the table is face-up right now. */
  viewer: string;
  /**
   * The seats this client is allowed to play. Both of them on a shared
   * screen; just your own over the network.
   */
  controls: string[];
  names: Record<string, string>;
  /** A seat that owes an answer, when it isn't the viewer's to give. */
  waitingOn?: string | null;
  /** See MatchController.cancel — only shown to the move's actor. */
  onCancelChoice?: (() => void) | null;
  chooseLeader?: {
    pickedId: string | null;
    onSubmit: () => void;
  } | null;
  mulligan?: {
    picked: number;
    onSubmit: () => void;
  } | null;
  levelUp?: {
    card: CharacterCard;
    picked: number;
    onCancel: () => void;
  } | null;
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
  chooseLeader,
  mulligan,
  levelUp,
}: ControlBarProps) {
  const { t } = useLang();
  const [confirming, setConfirming] = useState<{
    prompt: string;
    detail?: string;
    confirmLabel: string;
    onYes: () => void;
  } | null>(null);

  const nameOf = (playerId: string): string => names[playerId] ?? playerId;
  const me = state.turnPlayerId;
  // Combo is the one phase not owned by the turn player: whoever won the
  // clash owns its follow-ups AND the End action that closes them. Every
  // other phase continues to follow turn ownership.
  const phaseOwner = state.phase === "combo" && state.combo ? state.combo.playerId : me;
  const mine = controls.includes(phaseOwner);
  const allowed = mine ? legalIntents(state, phaseOwner) : [];
  const act = (intent: MatchIntent) => {
    onSend(phaseOwner, intent);
    onClearSelection();
  };

  const actionsLeft =
    MAX_ACTIONS_PER_TURN - (state.boards[me]?.actionsTakenThisTurn.length ?? 0);
  const phaseMoves: Partial<Record<PhaseStepKey, StepMove>> = {};
  const phaseWaiting: Partial<Record<PhaseStepKey, string>> = {};

  if (allowed.includes("startTurn")) {
    phaseMoves.draw = {
      onPick: () => act({ kind: "startTurn" }),
      title: t("controlBar.drawTitle"),
    };
  }

  if (allowed.includes("toBattle")) {
    phaseMoves.battle = {
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
    phaseMoves.judgement = {
      onPick: () => act({ kind: "resolveCounter" }),
      title: t("controlBar.judgementTitle"),
    };
  } else if (state.phase === "counter" && mine) {
    phaseWaiting.judgement = t("controlBar.judgementWaiting");
  }

  /**
   * Declining the clash — rendered beside the track, not in it.
   *
   * Gone once this viewer has committed OR passed: their Battle work is
   * complete either way, and the engine would refuse a second answer. Note it
   * follows `viewer` rather than `phaseOwner`, because laying a card down is
   * the one move both sides of the table make.
   */
  // canPassCounter, not waitingToCommit: the turn player may only decline the
  // clash when nothing in hand is playable, so offering the button to them
  // otherwise would only produce a rejection. The non-turn player always may.
  const onPass = canPassCounter(state, viewer) && controls.includes(viewer)
    ? () =>
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
        })
    : null;

  /**
   * The Action Phase's other exit: past the clash entirely, straight to the End
   * Phase. A move of its own rather than a variant of Go Battle — nothing is
   * revealed, nobody takes damage, and the opponent picks up [Advantage] — so it
   * gets its own (secondary) button rather than hiding inside the confirm.
   */
  const onSkipCounter = allowed.includes("skipCounter")
    ? () =>
        setConfirming({
          prompt: t("controlBar.skipCounterPrompt"),
          detail: t("controlBar.skipCounterDetail"),
          confirmLabel: t("controlBar.skipCounter"),
          onYes: () => act({ kind: "skipCounter" }),
        })
    : null;

  // End now only ever means the end of the turn. It cannot collide with Pass:
  // legalIntents() never offers endTurn during the Battle Phase, which is the
  // only phase a card is committed in.
  if (allowed.includes("endTurn")) {
    const holdingCombo = state.phase === "combo" && state.combo?.playerId === phaseOwner;
    phaseMoves.end = {
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

  /**
   * The verb on the button beside the track, keyed by the step a move leads
   * TO — which is what makes the mapping trivial: the move out of Main lands
   * on Battle, so it is "Go Battle"; the one that turns the cards up lands on
   * Judgement, so it is "Reveal".
   *
   * English in both languages, like the tab labels it sits beside.
   *
   * `main` is the one step with no entry: no move leads TO the Main Phase, so
   * there is never a button for it. `end` is here because it has to be — the
   * track stopped being pressable, so this button is the only way to end a
   * turn. It was briefly dropped while the End tab could still be clicked.
   */
  const PRIMARY_LABEL: Partial<Record<PhaseStepKey, string>> = {
    draw: "Start Turn",
    battle: "Go Battle",
    judgement: "Reveal",
    end: "End Turn",
  };
  // Track order, so the choice is deterministic. In practice at most one step
  // is ever pressable at a time — legalIntents() offers one phase move per
  // phase — but ordering it means a future phase with two cannot pick at
  // random depending on key insertion order.
  const PRIMARY_ORDER: PhaseStepKey[] = ["draw", "battle", "judgement", "end"];
  const primaryStep = PRIMARY_ORDER.find((key) => phaseMoves[key] && PRIMARY_LABEL[key]);
  /**
   * Pass wins whenever it is offered, and cannot race the phase moves: it is
   * only ever available in the Battle Phase before this viewer has answered,
   * and none of the phase moves are legal in that window (Reveal needs both
   * sides in; endTurn is not a Battle Phase move at all).
   */
  const primary: { label: string; title: string; onPick: () => void; pass?: boolean } | null =
    onPass
      ? { label: "Pass", title: t("controlBar.passTitle"), onPick: onPass, pass: true }
      : primaryStep
        ? {
            label: PRIMARY_LABEL[primaryStep]!,
            title: phaseMoves[primaryStep]!.title,
            onPick: phaseMoves[primaryStep]!.onPick,
          }
        : null;

  /**
   * The second row is now only for things the player must act on: a refused
   * move, and a question owed by the other seat (with its way out). All the
   * phase narration that used to live here — "click a card in hand to combo",
   * "waiting on the other side", "2 actions left" — is gone: the board already
   * shows it (a card back in the opponent's Action Area, the lit phase tab,
   * the verb on the button beside the track), and a line of prose restating it
   * under every single phase was one more thing to read and never the thing
   * you needed. Null here means the row does not render at all, so the bar is
   * one line in ordinary play rather than one line and a reserved gap.
   */
  let status: ReactNode = null;
  if (error) {
    status = <span className="control-error">{error}</span>;
  } else if (waitingOn) {
    status = (
      <>
        {t("controlBar.waitingToAnswer", nameOf(waitingOn))}
        {onCancelChoice && (
          <button
            type="button"
            className="control-status-action"
            title={t("controlBar.cancelQuestionTitle")}
            onClick={onCancelChoice}
          >
            {t("common.cancelQuestion")}
          </button>
        )}
      </>
    );
  }

  if (state.winnerId) {
    return (
      <div className="control-bar simple">
        <span className="control-phase">
          {t(
            "controlBar.gameOver",
            state.winnerId === "draw" ? t("controlBar.draw") : t("controlBar.wins", nameOf(state.winnerId))
          )}
        </span>
      </div>
    );
  }

  if (state.phase === "leaderSelect") {
    const chosen = Boolean(state.leaderChosen[viewer]);
    const theirs = controls.includes(viewer);
    const waitingFor = Object.keys(state.boards).filter((id) => !state.leaderChosen[id]);
    const board = state.boards[viewer];
    const pickedName = chooseLeader?.pickedId
      ? [board?.leader, ...(board?.back ?? [])].find(
          (slot) => slot?.card.id === chooseLeader.pickedId
        )?.card.name
      : undefined;
    return (
      <div className="control-bar simple">
        <span className="control-phase">{t("controlBar.leaderSelectHeading")}</span>
        <span className="control-actions">
          {theirs && !chosen && chooseLeader && (
            <>
              <span className="control-hint">{t("controlBar.leaderSelectHint")}</span>
              <button
                type="button"
                className="primary"
                disabled={!chooseLeader.pickedId}
                onClick={chooseLeader.onSubmit}
              >
                {pickedName ? t("controlBar.confirmLeader", pickedName) : t("controlBar.leaderSelectHint")}
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
      </div>
    );
  }

  if (state.phase === "mulligan") {
    const chosen = Boolean(state.mulliganDone[viewer]);
    const theirs = controls.includes(viewer);
    const waitingFor = Object.keys(state.boards).filter((id) => !state.mulliganDone[id]);
    return (
      <div className="control-bar simple">
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
      </div>
    );
  }

  if (levelUp) {
    const { card, picked, onCancel } = levelUp;
    return (
      <div className="control-bar simple">
        <span className="control-phase">{t("controlBar.levelUpHeading", card.name, card.level)}</span>
        <span className="control-actions">
          <span className="control-hint">{t("controlBar.levelUpHint", picked, card.level)}</span>
          <button type="button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          {error && <span className="control-error">{error}</span>}
        </span>
      </div>
    );
  }

  return (
    <div className="control-bar">
      <div className="control-main-row">
        {/* Equal-width sides keep the five read-only phase labels on the
            board's centre line, with the turn heading left and the one verb
            button right. */}
        <span className="control-side">
          <span className="control-phase">{t("controlBar.turnHeading", state.turnNumber, nameOf(me))}</span>
        </span>
        <PhaseTrack active={activeStep(state)} waiting={phaseWaiting} />
        {/* Kept in the right-hand .control-side so the track stays on the
            board's centre line: both sides hold the same flex basis, so the
            button changing word — or going away in a phase with no move of
            this client's — never shifts the tabs. */}
        <span className="control-side control-side-end">
          {onSkipCounter && (
            <button
              type="button"
              className="control-secondary-move"
              title={t("controlBar.skipCounterTitle")}
              onClick={onSkipCounter}
            >
              {t("controlBar.skipCounter")}
            </button>
          )}
          {primary && (
            <button
              type="button"
              className={`control-primary-move${primary.pass ? " control-pass" : ""}`}
              title={primary.title}
              onClick={primary.onPick}
            >
              {primary.label}
            </button>
          )}
        </span>
      </div>
      {status && <div className="control-status" role="status">{status}</div>}

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
