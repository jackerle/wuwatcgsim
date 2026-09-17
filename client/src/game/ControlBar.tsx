// The buttons for whatever the turn player may legally do right now.
//
// What is offered comes from the engine's own legalIntents(), not from a
// second copy of the rules written out in the UI. If the two ever disagree,
// the engine wins: a button the engine rejects just shows its reason.

import { useState, type ReactNode } from "react";
import {
  CHARGE_PER_TURN,
  PHASE_LABEL,
  canCommitAnything,
  legalIntents,
  type MatchIntent,
  type MatchState,
} from "@wuwatcg/shared";

export interface ControlBarProps {
  state: MatchState;
  /** Hand POSITIONS picked out, for the action that needs them. */
  selected: number[];
  /** Turns the picked positions into card ids for a given player's hand. */
  selectedIds: (playerId: string) => string[];
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
  /** Match-level controls, pushed to the far end of the same row. */
  children?: ReactNode;
}

export function ControlBar({
  state,
  selected,
  selectedIds,
  onSend,
  onClearSelection,
  error,
  viewer,
  controls,
  names,
  waitingOn,
  children,
}: ControlBarProps) {
  const nameOf = (playerId: string): string => names[playerId] ?? playerId;
  const me = state.turnPlayerId;
  const board = state.boards[me];
  // Whether the turn is this client's to drive. Over the network the other
  // player's buttons are not disabled, they are simply not here: the server
  // would refuse them anyway, and a dead button is worse than no button.
  const mine = controls.includes(me);
  const allowed = mine ? legalIntents(state, me) : [];
  const phase = PHASE_LABEL[state.phase].th;
  // The Counter Phase is the one moment both players act, so its prompt
  // follows whoever is looking at the screen, not whose turn it is.
  // Committing is the one move a player makes on the other's turn too, so this
  // follows the viewer rather than the turn player.
  const waitingToCommit =
    (state.phase === "action" || state.phase === "counter") &&
    !state.facedown[viewer] &&
    !state.winnerId &&
    controls.includes(viewer);
  // Which Level Up card the picker is on. Kept here rather than in the parent
  // because nothing outside this bar cares about it.
  const [levelChoice, setLevelChoice] = useState("");

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

  // Characters that can still be levelled up: same name, level at or above
  // the one in play. The engine checks this again — this only decides whether
  // there is anything worth offering.
  // Levelling moves one step at a time, so a Level 2 card is only on offer
  // once the character is already at Level 1. The engine checks this again —
  // this decides what is worth putting in the picker.
  const inPlay = [board?.leader, ...(board?.back ?? [])].filter(Boolean);
  const levelTargets = (board?.characterPool ?? []).filter((card) =>
    inPlay.some(
      (slot) =>
        slot!.card.name === card.name &&
        card.level > 0 &&
        card.level >= slot!.card.level &&
        card.level <= slot!.card.level + 1
    )
  );
  const chosenLevel =
    levelTargets.find((card) => card.id === levelChoice) ?? levelTargets[0] ?? null;

  return (
    <div className="control-bar">
      <span className="control-phase">
        เทิร์น {state.turnNumber} · {phase} · {nameOf(me)}
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

      {allowed.includes("charge") && (
        <button
          type="button"
          // One card per turn, so this wants exactly one picked — not "at
          // least one", which would silently charge only the first.
          disabled={selected.length !== CHARGE_PER_TURN}
          title={`เลือกการ์ดจากมือ ${CHARGE_PER_TURN} ใบ — ชาร์จได้เทิร์นละใบเดียว`}
          onClick={() => act({ kind: "charge", cardIds: selectedIds(me) })}
        >
          ชาร์จ
        </button>
      )}

      {/* Three characters in play, each with several printings per level,
          means a dozen Level Up options — far too many to be one button
          each. The picker keeps every choice without flooding the bar. */}
      {allowed.includes("levelUp") && levelTargets.length > 0 && (
        <span className="control-group">
          <select
            className="control-select"
            value={levelChoice}
            onChange={(event) => setLevelChoice(event.target.value)}
          >
            {levelTargets.map((card) => (
              <option key={card.id} value={card.id}>
                {card.name} Lv.{card.level} ({card.id}) — ทิ้ง {card.level}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-card-id={chosenLevel?.id}
            disabled={!chosenLevel || selected.length !== chosenLevel.level}
            title={
              chosenLevel
                ? `ทิ้งการ์ด ${chosenLevel.level} ใบ — เลือกจากมือให้ครบก่อน`
                : undefined
            }
            onClick={() =>
              chosenLevel &&
              act({ kind: "levelUp", characterId: chosenLevel.id, discardIds: selectedIds(me) })
            }
          >
            เลเวลอัป
          </button>
        </span>
      )}

      {allowed.includes("switch") &&
        (board?.back ?? []).map((slot) => (
          <button
            key={slot.card.id}
            type="button"
            data-card-id={slot.card.id}
            onClick={() => act({ kind: "switch", toCardId: slot.card.id })}
          >
            สลับไป {slot.card.name}
          </button>
        ))}

      {waitingToCommit && (
        <button
          type="button"
          disabled={selected.length !== 1}
          title={selected.length === 1 ? undefined : "เลือกการ์ดจากมือ 1 ใบ"}
          onClick={() => {
            onSend(viewer, { kind: "commit", cardId: selectedIds(viewer)[0] });
            onClearSelection();
          }}
        >
          ลงการ์ดคว่ำ
        </button>
      )}

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
            ? "เลือกการ์ดในมือแล้วกดลงคว่ำ"
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
      {waitingOn && <span className="control-hint">รอ {nameOf(waitingOn)} ตอบคำถาม...</span>}

      {error && <span className="control-error">{error}</span>}
      </span>

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
    </div>
  );
}
