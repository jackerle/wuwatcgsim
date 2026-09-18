// The buttons for whatever the turn player may legally do right now.
//
// What is offered comes from the engine's own legalIntents(), not from a
// second copy of the rules written out in the UI. If the two ever disagree,
// the engine wins: a button the engine rejects just shows its reason.

import type { ReactNode } from "react";
import { PhaseTrack } from "./PhaseTrack";
import {
  canCommit,
  canCommitAnything,
  legalIntents,
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

  if (state.winnerId) {
    return (
      <div className="control-bar">
        <span className="control-phase">
          จบเกม — {state.winnerId === "draw" ? "เสมอ" : `${nameOf(state.winnerId)} ชนะ`}
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
        <span className="control-phase">
          เปลี่ยนการ์ดในมือ · {nameOf(state.startingPlayerId)} เริ่มก่อน
        </span>
        <span className="control-actions">
          {theirs && !chosen && mulligan && (
            <>
              <span className="control-hint">
                เลือกการ์ดที่ไม่ต้องการกี่ใบก็ได้ — คืนเข้ากอง สับ แล้วจั่วใหม่เท่าจำนวนที่คืน
              </span>
              {mulligan.picked > 0 && (
                <button type="button" onClick={onClearSelection}>
                  ล้างที่เลือก
                </button>
              )}
              <button type="button" className="primary" onClick={mulligan.onSubmit}>
                {mulligan.picked > 0 ? `เปลี่ยน ${mulligan.picked} ใบ` : "เก็บมือนี้"}
              </button>
            </>
          )}
          {theirs && chosen && (
            <span className="control-hint">
              {waitingFor.length > 0
                ? `เลือกแล้ว — รอ ${waitingFor.map(nameOf).join(", ")}`
                : "เลือกแล้ว"}
            </span>
          )}
          {!theirs && (
            <span className="control-hint">
              {chosen ? `${nameOf(viewer)} เลือกแล้ว` : `รอ ${nameOf(viewer)} เลือกการ์ด`}
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
        <span className="control-phase">
          เลเวลอัป {card.name} → Lv.{card.level}
        </span>
        <span className="control-actions">
          {/* No confirm button: picking the last card opens the dialog, and
              that is where the move is agreed to. */}
          <span className="control-hint">
            เลือกการ์ดในมือเพื่อทิ้ง {picked}/{card.level} ใบ
          </span>
          <button type="button" onClick={onCancel}>
            ยกเลิก
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
      <span className="control-phase">
        เทิร์น {state.turnNumber} · {nameOf(me)}
      </span>

      {/* Scrolls sideways rather than wrapping: the board has an exact
          vertical budget, so this bar must stay one row high however many
          moves are on offer. */}
      <span className="control-actions">
      {allowed.includes("startTurn") && (
        <button type="button" onClick={() => act({ kind: "startTurn" })}>
          เริ่มเทิร์น
        </button>
      )}

      {/* Charge, Level Up, Switch and laying a card face-down are all moves
          about one particular card, so each is asked of that card — click it
          on the board. See CardMenu. What is left here is the moves that are
          about the turn itself, which is all this one row can hold. */}

      {/* A player with an empty hand, or nothing they can pay for, has no
          legal card to lay down — without this the phase could never end. */}
      {waitingToCommit && (
        <button
          type="button"
          className={canCommitAnything(state, viewer) ? "" : "primary"}
          title={
            canCommitAnything(state, viewer)
              ? "ยอมแพ้การปะทะรอบนี้ แต่ไม่เสียการ์ด"
              : "ไม่มีการ์ดที่ลงได้"
          }
          onClick={() => {
            onSend(viewer, { kind: "pass" });
            onClearSelection();
          }}
        >
          ไม่ลงการ์ด
        </button>
      )}

      {allowed.includes("resolveCounter") && (
        <button type="button" className="primary" onClick={() => act({ kind: "resolveCounter" })}>
          เปิดการ์ด
        </button>
      )}

      {allowed.includes("passCombo") && (
        <button type="button" onClick={() => act({ kind: "passCombo" })}>
          จบคอมโบ
        </button>
      )}

      {allowed.includes("endTurn") && (
        <button type="button" className="primary" onClick={() => act({ kind: "endTurn" })}>
          จบเทิร์น
        </button>
      )}

      {waitingToCommit && (
        <span className="control-hint">
          {canCommitAnything(state, viewer)
            ? "คลิกการ์ดในมือเพื่อเลือกว่าจะทำอะไรกับมัน"
            : "ไม่มีการ์ดที่ลงได้ — กดไม่ลงการ์ดเพื่อไปต่อ"}
        </span>
      )}
      {state.phase === "counter" && state.facedown[viewer] && !allowed.includes("resolveCounter") && (
        <span className="control-hint">ลงคว่ำแล้ว — รออีกฝ่ายลงการ์ด</span>
      )}
      {/* Like committing, the combo prompt follows the viewer: the hand you
          can actually click is the face-up one, not the turn player's. */}
      {state.phase === "combo" && state.combo?.playerId === viewer && (
        <span className="control-hint">
          คลิกการ์ดในมือเพื่อคอมโบ
          {state.combo.unlimited ? " (ไม่จำกัด)" : ` (เหลือ ${state.combo.remaining})`}
        </span>
      )}
      {state.phase === "combo" && state.combo && state.combo.playerId !== viewer && (
        <span className="control-hint">
          {controls.includes(state.combo.playerId)
            ? `สลับมุมมองไป ${nameOf(state.combo.playerId)} เพื่อคอมโบ`
            : `รอ ${nameOf(state.combo.playerId)} คอมโบ`}
        </span>
      )}

      {!mine && !waitingToCommit && state.phase !== "combo" && (
        <span className="control-hint">รอ {nameOf(me)} เล่น...</span>
      )}
      {waitingOn && (
        <>
          <span className="control-hint">รอ {nameOf(waitingOn)} ตอบคำถาม...</span>
          {/* The move is ours, so dropping it is ours to do. Without this a
              question put to a player who never answers leaves both sides
              unable to do anything at all. */}
          {onCancelChoice && (
            <button
              type="button"
              title="ยกเลิกการสั่งที่ค้างอยู่ แล้วกลับไปที่กระดานเดิม"
              onClick={onCancelChoice}
            >
              ยกเลิกการสั่ง
            </button>
          )}
        </>
      )}

      {error && <span className="control-error">{error}</span>}
      </span>
      </span>

      {/* Where the turn is right now. The phase name used to sit in the line
          above as a word among others; as a track it also says what comes
          next, which is the part a player new to the game is missing. */}
      <PhaseTrack phase={state.phase} />

      <span className="control-side control-side-end">
        <button
          type="button"
          className="danger"
          title={`${nameOf(viewer)} ยอมแพ้ทันที`}
          onClick={() => {
            onSend(viewer, { kind: "concede" });
            onClearSelection();
          }}
        >
          ยอมแพ้
        </button>
        {children}
      </span>
    </div>
  );
}
