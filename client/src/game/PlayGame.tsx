// The playable screen: a real match, played through the real engine.
//
// Where the match is actually running is not this component's business. It
// draws whatever the controller hands it and sends moves back — the same code
// serves two people sharing a laptop and two people on opposite sides of the
// internet. See matchController.ts.

import { useEffect, useRef, useState } from "react";
import {
  CHARGE_PER_TURN,
  canCommit,
  canSwitchLeader,
  legalIntents,
  levelUpOptions,
  whyUnplayable,
  type ActionCard,
  type CharacterCard,
  type CharacterInstance,
  type MatchIntent,
  type Seat,
} from "@wuwatcg/shared";
import { PlayerZone } from "../board/PlayerZone";
import { HoverPreviewProvider } from "../board/HoverPreviewContext";
import { PileModalProvider } from "../board/PileModalContext";
import { PileModal } from "../board/PileModal";
import { DragProvider, type DragPayload, type DropTargets } from "../board/DragContext";
import { ChoiceDialog } from "../board/ChoiceDialog";
import { LevelUpConfirm } from "../board/LevelUpConfirm";
import type { CardMenuItem } from "../board/CardMenu";
import { HoverPreviewPanel } from "../board/HoverPreviewPanel";
import { DetailPanel } from "../board/DetailPanel";
import { CardPeek } from "../board/CardPeek";
import { LevelUpFx } from "../board/LevelUpFx";
import { ClashRevealFx } from "../board/ClashRevealFx";
import { useBoardEvents } from "./boardEvents";
import { ChatPanel } from "../board/ChatPanel";
import { ControlBar } from "./ControlBar";
import { MatchLog } from "./MatchLog";
import { MatchSettings } from "./MatchSettings";
import type { MatchController } from "./matchController";
import { useLang } from "../i18n/LanguageContext";
import "../board/Board.css";
import "./PlayGame.css";

export function PlayGame({
  match,
  onLeave,
}: {
  match: MatchController;
  /** Online and vs-bot: whoever started the match owns what leaving it means. */
  onLeave?: () => void;
}) {
  const { t } = useLang();
  // Hand POSITIONS, not card ids — several copies of one printed card can sit
  // in a hand at once, and picking one must not light up the others.
  const [selected, setSelected] = useState<number[]>([]);
  /**
   * A Level Up that has been chosen but not paid for yet.
   *
   * Picking the card off a character puts the screen into this mode instead
   * of sending anything: the cost comes out of hand, so the hand is where
   * the rest of the move happens. Nothing has reached the engine until the
   * confirm goes through.
   */
  const [levelUp, setLevelUp] = useState<CharacterCard | null>(null);
  /**
   * A Leader picked but not yet submitted — see the `chooseLeader` control
   * bar branch. Null means "still the default", not "nothing picked": the
   * default IS a legal, already-placed answer (see chooseLeader's own docs),
   * so the fallback below reads the board's own arrangement.
   */
  const [pickedLeaderId, setPickedLeaderId] = useState<string | null>(null);
  /**
   * Is a cut-in (the clash reveal, a Level Up) on screen right now? Turning
   * the cards over or levelling up is often exactly what triggers an
   * ability's question, and the question should come AFTER the player has
   * seen what caused it — so the dialog is held back until both are done.
   * The engine is not paused: the question is already pending, it is only
   * not drawn yet.
   */
  const [clashFxPlaying, setClashFxPlaying] = useState(false);
  const [levelUpFxPlaying, setLevelUpFxPlaying] = useState(false);
  const fxPlaying = clashFxPlaying || levelUpFxPlaying;

  const state = match.shown;
  const turnPlayer = state.turnPlayerId;
  const bottom = match.viewing;
  const top: Seat = bottom === "p1" ? "p2" : "p1";
  const nameOf = (seat: string) => match.names[seat] ?? seat;
  /**
   * Hits, heals and cards an ability put into hand — called out beside each
   * player's Life, after any cut-in covering the board has finished.
   */
  const boardEvents = useBoardEvents(match.log, state.matchId, fxPlaying);
  const eventsFor = (seat: string) => boardEvents.active.filter((event) => event.seat === seat);
  const shownLifeOf = (seat: string) => (state.boards[seat]?.life ?? 0) + (boardEvents.lifeLag[seat] ?? 0);

  /**
   * The moves that play themselves. Each is the only move the engine allows
   * at that point and asks nothing, so a button for it was a click with no
   * decision in it:
   *
   *   Draw Phase        startTurn — it draws, and [Advantage] changes hands.
   *   both have chosen  resolveCounter — the reveal. Once each side has laid
   *                     a card down or passed, turning them up is all that is
   *                     left to do.
   *
   * Still the very same moves the buttons sent, through the engine; this only
   * presses them, from the turn player's screen (they are turn-player-only
   * moves — see TURN_PLAYER_ONLY in session.ts). Held until any cut-in is
   * over, and a beat after the state settles, so what happens next lands
   * where the player is looking.
   */
  const sendRef = useRef(match.send);
  useEffect(() => {
    sendRef.current = match.send;
  });
  const autoSeat = state.turnPlayerId;
  const autoKind: "startTurn" | "resolveCounter" | null = (() => {
    if (state.winnerId || match.askingSeat || fxPlaying) return null;
    if (!match.controls.includes(autoSeat as Seat)) return null;
    const legal = legalIntents(state, autoSeat);
    if (state.phase === "draw" && legal.includes("startTurn")) return "startTurn";
    if (state.phase === "counter" && legal.includes("resolveCounter")) return "resolveCounter";
    return null;
  })();
  useEffect(() => {
    if (!autoKind) return;
    const timer = window.setTimeout(() => sendRef.current(autoSeat, { kind: autoKind }), 450);
    return () => window.clearTimeout(timer);
    // `state` too: a new board is a new moment to act on, even when the move
    // that is due has not changed.
  }, [autoKind, autoSeat, state]);
  /**
   * The opening mulligan, still owed by whoever's hand is face-up.
   *
   * While this is on, a click in hand means "put this one back" and nothing
   * else: no card menus, no unplayable markers (every card is unplayable
   * before turn 1, and dimming the whole hand would say the wrong thing).
   */
  const mulliganing = state.phase === "mulligan" && !state.mulliganDone[bottom];

  /**
   * Leader Select, still owed by whoever's board this is: the step before
   * the mulligan, where each side arranges their three starters.
   */
  const choosingLeader = state.phase === "leaderSelect" && !state.leaderChosen[bottom];
  const bottomLeaderId = state.boards[bottom]?.leader?.card.id ?? null;
  /** The pick this client would submit right now — the default until touched. */
  const effectiveLeaderId = pickedLeaderId ?? bottomLeaderId;

  /**
   * A click on your own hand means whatever the phase says it means: pick a
   * card out for Charge or Level Up, commit it face-down, or combo with it.
   */
  function handleHandClick(playerId: string, card: ActionCard, index: number) {
    // A combo is played straight from hand — there is nothing to pick first.
    if (state.phase === "combo" && state.combo?.playerId === playerId) {
      match.send(playerId, { kind: "combo", cardId: card.id });
      return;
    }
    // Paying for a Level Up: the selection is capped at what it costs, so
    // the count can never be wrong by the time the confirm appears.
    if (levelUp) {
      setSelected((current) => {
        if (current.includes(index)) return current.filter((i) => i !== index);
        if (current.length >= levelUp.level) return current;
        return [...current, index];
      });
      return;
    }
    // Otherwise a click picks the card out; the control bar says what to do
    // with the selection (charge it, pay a Level Up with it, commit it).
    setSelected((current) =>
      current.includes(index) ? current.filter((i) => i !== index) : [...current, index]
    );
  }

  /** The selected positions as card ids, which is what the engine takes. */
  const selectedIds = (playerId: string): string[] => {
    const hand = state.boards[playerId]?.hand ?? [];
    return selected.map((i) => hand[i]?.id).filter((id): id is string => Boolean(id));
  };

  const send = (playerId: string, intent: MatchIntent) => {
    match.send(playerId, intent);
    setSelected([]);
  };

  const cancelLevelUp = () => {
    setLevelUp(null);
    setSelected([]);
  };

  /**
   * What each of the bottom player's characters may be told to do.
   *
   * The engine works it out — levelUpOptions() and canSwitchLeader() are the
   * same checks the intents themselves run — so the menu can never offer a
   * move the rules would refuse. Only the turn player's own board, and only
   * when this client is the one playing it.
   */
  const actionsFor = (slot: CharacterInstance) => {
    if (state.phase === "mulligan" || state.phase === "leaderSelect") return undefined;
    if (turnPlayer !== bottom || !match.controls.includes(bottom) || levelUp) return undefined;
    const options = levelUpOptions(state, bottom, slot.card.id);
    const back = state.boards[bottom]?.back ?? [];
    // Switching means bringing a back character up. Asked from the Leader
    // that is a choice between everyone back there; asked from a back
    // character it is that character, and there is nothing to choose.
    const switchOptions = !canSwitchLeader(state, bottom)
      ? []
      : slot.position === "leader"
        ? back
        : [slot];
    if (options.length === 0 && switchOptions.length === 0) return undefined;
    return {
      levelOptions: options,
      onLevelUp: (card: CharacterCard) => {
        setSelected([]);
        setLevelUp(card);
      },
      switchOptions,
      onSwitch: (toCardId: string) => send(bottom, { kind: "switch", toCardId }),
    };
  };

  /**
   * What a card in hand can be told to do, asked of that card.
   *
   * Charge and Commit both take exactly one card, so they read as things you
   * do TO a card rather than to a selection — and the control bar had no way
   * to say which card its buttons meant. The engine decides what is on the
   * menu: legalIntents() for the turn's one Charge, canCommit() for laying a
   * card out (which is the one move you also make on the other player's
   * turn), whyUnplayable() for whether this particular card can be paid for.
   *
   * Returning nothing leaves the click alone — that is how the hand still
   * works as a picker while a Level Up is being paid for.
   */
  const handMenuFor = (card: ActionCard, index: number): CardMenuItem[] | undefined => {
    if (levelUp || mulliganing || !match.controls.includes(bottom)) return undefined;
    // A combo is played straight from hand, one click, as many times as the
    // window allows — a menu in the middle of that would be all it is.
    if (state.phase === "combo" && state.combo?.playerId === bottom) return undefined;

    const items: CardMenuItem[] = [];
    if (turnPlayer === bottom && legalIntents(state, bottom).includes("charge")) {
      items.push({
        key: "charge",
        label: t("playGame.chargeLabel"),
        hint: t("playGame.chargeHint", CHARGE_PER_TURN),
        onPick: () => send(bottom, { kind: "charge", cardIds: [card.id] }),
      });
    }
    const blocked = whyUnplayable(state, card, bottom);
    if (canCommit(state, bottom) && !blocked) {
      items.push({
        key: "commit",
        label: t("playGame.commitLabel"),
        hint: t("playGame.commitHint"),
        onPick: () => send(bottom, { kind: "commit", cardId: card.id }),
      });
    }
    // Nothing legal is worth a menu that says so; the card's own tooltip
    // already carries the reason.
    if (items.length === 0) return undefined;
    void index;
    return items;
  };

  /**
   * Where a dragged card may be dropped, and what the drop sends — see
   * DragContext. The same engine checks the menus use, the same moves they
   * send: dragging is only a faster way to pick from the menu.
   *
   *   hand card → Concerto area   Charge
   *   hand card → Action Area     lay it face-down, or combo with it
   *   character → another slot    Switch the Leader
   */
  const dropTargetsFor = (payload: DragPayload): DropTargets => {
    const targets: DropTargets = {};
    if (!match.controls.includes(bottom) || levelUp || mulliganing || choosingLeader) return targets;

    if (payload.kind === "hand") {
      const { card } = payload;
      if (state.phase === "combo" && state.combo?.playerId === bottom) {
        if (legalIntents(state, bottom).includes("combo") && !whyUnplayable(state, card, bottom)) {
          targets.commit = () => send(bottom, { kind: "combo", cardId: card.id });
        }
        return targets;
      }
      if (turnPlayer === bottom && legalIntents(state, bottom).includes("charge")) {
        targets.charge = () => send(bottom, { kind: "charge", cardIds: [card.id] });
      }
      if (canCommit(state, bottom) && !whyUnplayable(state, card, bottom)) {
        targets.commit = () => send(bottom, { kind: "commit", cardId: card.id });
      }
      return targets;
    }

    // A character: the switch actionsFor() would offer, dropped onto the
    // character it swaps with.
    const offered = actionsFor(payload.slot)?.switchOptions ?? [];
    const board = state.boards[bottom];
    if (payload.slot.position === "leader") {
      for (const back of offered) {
        targets[`char:${back.card.id}`] = () => send(bottom, { kind: "switch", toCardId: back.card.id });
      }
    } else if (offered.length > 0 && board?.leader) {
      targets[`char:${board.leader.card.id}`] = () =>
        send(bottom, { kind: "switch", toCardId: payload.slot.card.id });
    }
    return targets;
  };

  const label = (seat: Seat) => {
    const offline = match.connected[seat] === false ? t("playGame.offlineSuffix") : "";
    const turn = turnPlayer === seat ? (seat === bottom ? "" : "") : "";
    return `${nameOf(seat)}${turn}${offline}`;
  };

  return (
    <HoverPreviewProvider>
      <PileModalProvider>
        <DragProvider targetsFor={dropTargetsFor}>
          <div className="game-ui">
            <div className="game-board">
              {match.canFlip && (
                <button
                  type="button"
                  className="view-hand-toggle"
                  title={t("playGame.viewHandTitle", nameOf(top))}
                  onClick={() => match.setViewing(top)}
                >
                  {t("playGame.viewHand", nameOf(top))}
                </button>
              )}
              <PlayerZone
                board={state.boards[top]}
                name={label(top)}
                mirrored
                hideHand
                facedown={state.facedown[top]}
                actionZone={state.actionZone[top]}
                committed={state.committed[top]}
                advantage={state.advantageIds.includes(top)}
                dealKey={state.matchId}
                shownLife={shownLifeOf(top)}
                events={eventsFor(top)}
              />

              <ControlBar
                leading={
                  <MatchSettings
                    onConcede={() => send(bottom, { kind: "concede" })}
                    canRestart={match.canRestart}
                    onRestart={() => {
                      setSelected([]);
                      setLevelUp(null);
                      setPickedLeaderId(null);
                      match.restart();
                    }}
                    onLeave={onLeave}
                  />
                }
                state={state}
                onSend={send}
                onClearSelection={() => setSelected([])}
                error={match.error}
                viewer={bottom}
                controls={match.controls}
                names={match.names}
                waitingOn={match.askingSeat && match.askingSeat !== bottom ? match.askingSeat : null}
                onCancelChoice={match.canCancel ? match.cancel : null}
                chooseLeader={
                  choosingLeader
                    ? {
                        pickedId: effectiveLeaderId,
                        onSubmit: () => {
                          if (effectiveLeaderId) {
                            send(bottom, { kind: "chooseLeader", leaderId: effectiveLeaderId });
                          }
                          setPickedLeaderId(null);
                        },
                      }
                    : null
                }
                mulligan={
                  mulliganing
                    ? {
                        picked: selected.length,
                        onSubmit: () =>
                          send(bottom, { kind: "mulligan", cardIds: selectedIds(bottom) }),
                      }
                    : null
                }
                levelUp={
                  levelUp
                    ? {
                        card: levelUp,
                        picked: selected.length,
                        onCancel: cancelLevelUp,
                      }
                    : null
                }
              />

              <PlayerZone
                board={state.boards[bottom]}
                name={label(bottom)}
                facedown={state.facedown[bottom]}
                actionZone={state.actionZone[bottom]}
                committed={state.committed[bottom]}
                advantage={state.advantageIds.includes(bottom)}
                shownLife={shownLifeOf(bottom)}
                events={eventsFor(bottom)}
                selectedHand={selected}
                handSelectionMeans={mulliganing ? "return" : "pick"}
                onHandCardClick={(card, index) => handleHandClick(bottom, card, index)}
                /* Affordability only decides anything once a card could
                   actually be laid down. In the Main Phase every card is a
                   legal Charge whatever it costs, so dimming the expensive
                   ones there says something untrue. */
                unplayable={
                  levelUp || mulliganing || !(state.phase === "counter" || state.phase === "combo")
                    ? undefined
                    : (card) => whyUnplayable(state, card, bottom)
                }
                actionsFor={actionsFor}
                handMenuFor={handMenuFor}
                dealKey={state.matchId}
                leaderPick={
                  choosingLeader
                    ? { pickedId: effectiveLeaderId, onPick: setPickedLeaderId }
                    : undefined
                }
              />

              <ClashRevealFx
                state={state}
                top={top}
                bottom={bottom}
                nameOf={nameOf}
                onPlayingChange={setClashFxPlaying}
              />
              <LevelUpFx state={state} nameOf={nameOf} onPlayingChange={setLevelUpFxPlaying} />
              <PileModal />
              <ChoiceDialog
                choice={fxPlaying ? null : match.pending}
                onAnswer={match.answer}
                onCancel={match.canCancel ? match.cancel : null}
              />
              {/* The cost being counted out IS the question, so reaching the
                  last card asks it — a second "confirm" button in the middle of
                  the board only made the dialog say it twice. Backing out here
                  puts the cards back rather than dropping the whole move. */}
              {levelUp && selected.length === levelUp.level && (
                <LevelUpConfirm
                  card={levelUp}
                  discarding={selected
                    .map((i) => state.boards[bottom]?.hand[i])
                    .filter((card): card is ActionCard => Boolean(card))}
                  onCancel={() => setSelected([])}
                  onConfirm={() => {
                    send(bottom, {
                      kind: "levelUp",
                      characterId: levelUp.id,
                      discardIds: selectedIds(bottom),
                    });
                    setLevelUp(null);
                  }}
                />
              )}
            </div>

            <div className="right-panel">
              <div className="right-panel-row top-panel">
                <div className="panel-cell">
                  <HoverPreviewPanel />
                </div>
                <div className="panel-divider vertical" />
                <div className="panel-cell">
                  <DetailPanel />
                </div>
              </div>

              <div className="panel-divider horizontal" />

              <div className="right-panel-row bottom-panel">
                <div className="panel-cell">
                  <ChatPanel messages={match.chat} onSend={match.sendChat} />
                </div>
                <div className="panel-divider vertical" />
                <div className="panel-cell">
                  <MatchLog log={match.log} manual={match.manual} names={match.names} />
                </div>
              </div>
            </div>
          </div>
          <CardPeek />
        </DragProvider>
      </PileModalProvider>
    </HoverPreviewProvider>
  );
}
