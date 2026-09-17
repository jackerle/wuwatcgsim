// The playable screen: a real match, played through the real engine.
//
// Where the match is actually running is not this component's business. It
// draws whatever the controller hands it and sends moves back — the same code
// serves two people sharing a laptop and two people on opposite sides of the
// internet. See matchController.ts.

import { useState } from "react";
import { whyUnplayable, type ActionCard, type MatchIntent, type Seat } from "@wuwatcg/shared";
import { PlayerZone } from "../board/PlayerZone";
import { HoverPreviewProvider } from "../board/HoverPreviewContext";
import { PileModalProvider } from "../board/PileModalContext";
import { PileModal } from "../board/PileModal";
import { ChoiceDialog } from "../board/ChoiceDialog";
import { HoverPreviewPanel } from "../board/HoverPreviewPanel";
import { DetailPanel } from "../board/DetailPanel";
import { ChatPanel } from "../board/ChatPanel";
import { ControlBar } from "./ControlBar";
import { MatchLog } from "./MatchLog";
import type { MatchController } from "./matchController";
import "../board/Board.css";
import "./PlayGame.css";

export function PlayGame({ match, children }: { match: MatchController; children?: React.ReactNode }) {
  // Hand POSITIONS, not card ids — several copies of one printed card can sit
  // in a hand at once, and picking one must not light up the others.
  const [selected, setSelected] = useState<number[]>([]);

  const state = match.shown;
  const turnPlayer = state.turnPlayerId;
  const bottom = match.viewing;
  const top: Seat = bottom === "p1" ? "p2" : "p1";
  const nameOf = (seat: string) => match.names[seat] ?? seat;

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

  const label = (seat: Seat) => {
    const offline = match.connected[seat] === false ? " · หลุด" : "";
    const turn = turnPlayer === seat ? (seat === bottom ? " · ตาคุณ" : " · ตาเขา") : "";
    return `${nameOf(seat)}${turn}${offline}`;
  };

  return (
    <HoverPreviewProvider>
      <PileModalProvider>
        <div className="game-ui">
          <div className="game-board">
            <PlayerZone
              board={state.boards[top]}
              name={label(top)}
              mirrored
              hideHand
              facedown={state.facedown[top]}
              actionZone={state.actionZone[top]}
              dealKey={state.matchId}
            />

            <ControlBar
              state={state}
              selected={selected}
              onSend={send}
              onClearSelection={() => setSelected([])}
              error={match.error}
              viewer={bottom}
              controls={match.controls}
              names={match.names}
              waitingOn={match.askingSeat && match.askingSeat !== bottom ? match.askingSeat : null}
              selectedIds={selectedIds}
            >
              {/* The board fits an exact 100vh budget, so these share the
                  control bar's row rather than adding a second one. */}
              {match.canFlip && (
                <button type="button" onClick={() => match.setViewing(top)}>
                  ดูมือ {nameOf(top)}
                </button>
              )}
              {match.canRestart && (
                <button type="button" onClick={() => match.restart()}>
                  เกมใหม่
                </button>
              )}
              {children}
            </ControlBar>

            <PlayerZone
              board={state.boards[bottom]}
              name={label(bottom)}
              facedown={state.facedown[bottom]}
              actionZone={state.actionZone[bottom]}
              selectedHand={selected}
              onHandCardClick={(card, index) => handleHandClick(bottom, card, index)}
              unplayable={(card) => whyUnplayable(state, card, bottom)}
              dealKey={state.matchId}
            />

            <PileModal />
            <ChoiceDialog choice={match.pending} onAnswer={match.answer} />
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
      </PileModalProvider>
    </HoverPreviewProvider>
  );
}
