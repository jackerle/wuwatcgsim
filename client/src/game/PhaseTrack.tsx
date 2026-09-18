// The turn, laid out as the five steps a player thinks in — and the control
// that drives it.
//
// This used to be a read-only track beside a row of verb buttons ("เริ่มเทิร์น",
// "เปิดการ์ด", "จบเทิร์น"), which said the same thing twice: the button named a
// move, the track named the phase that move leaves. Now pressing the step IS
// the move, so where the turn is and what to do about it are one thing.
//
// The engine still decides what is legal. A step is pressable only when the
// caller hands it an action, and the caller asks legalIntents().

import type { TurnPhase } from "@wuwatcg/shared";

export type PhaseStepKey = "draw" | "main" | "battle" | "judgement" | "end";

interface Step {
  key: PhaseStepKey;
  label: string;
  /** Engine phases that light this step up. */
  phases: TurnPhase[];
  /** The Thai name, for the tooltip — the label itself stays short. */
  title: string;
}

/**
 * The Combo Step gets its own box here, as Judgement.
 *
 * It used to share the Battle box on the grounds that extending an attack is
 * still the battle you just won. But the reveal, the colour comparison, the
 * damage and the follow-ups all happen in it, and none of that is what the
 * Battle box now means — Battle is where the cards go face-down, and the
 * board sits there waiting for both players. Two different waits reading as
 * one box is what made the turn hard to follow.
 */
const STEPS: Step[] = [
  { key: "draw", label: "Draw", phases: ["draw"], title: "เฟสจั่ว — กดเพื่อจั่วการ์ด" },
  {
    key: "main",
    label: "Main",
    phases: ["action"],
    title: "เฟสหลัก — ชาร์จ เลเวลอัป สลับ Leader (อย่างละครั้ง)",
  },
  { key: "battle", label: "Battle", phases: ["counter"], title: "เฟสประลอง — ลงการ์ดคว่ำ" },
  {
    key: "judgement",
    label: "Judgement",
    phases: ["combo"],
    title: "เฟสตัดสิน — เปิดการ์ด ตัดสินผล และโจมตีต่อเนื่อง",
  },
  { key: "end", label: "End", phases: ["end"], title: "เฟสจบเทิร์น" },
];

/** A step this client may press, and what pressing it means. */
export interface PhaseAction {
  onPick: () => void;
  /** Replaces the tooltip: what pressing it will actually do. */
  title?: string;
}

export function PhaseTrack({
  phase,
  actions = {},
  waiting = {},
}: {
  phase: TurnPhase;
  /** Keyed by step. A step with no entry is not pressable. */
  actions?: Partial<Record<PhaseStepKey, PhaseAction>>;
  /**
   * Steps that are the next move but not ready — the reason is shown as the
   * tooltip. "Not ready" and "not yours" look different on purpose: one is a
   * wait, the other is simply not your move.
   */
  waiting?: Partial<Record<PhaseStepKey, string>>;
}) {
  return (
    <ol className="phase-track" aria-label="ลำดับเฟสในเทิร์น">
      {STEPS.map((step, index) => {
        const active = step.phases.includes(phase);
        const action = actions[step.key];
        const why = waiting[step.key];
        const className = `phase-track-step ${active ? "active" : ""} ${
          action ? "pressable" : ""
        } ${why ? "waiting" : ""}`;
        return (
          <li key={step.key} className="phase-track-item">
            {index > 0 && (
              <span className="phase-track-arrow" aria-hidden="true">
                ›
              </span>
            )}
            {action ? (
              <button
                type="button"
                className={className}
                title={action.title ?? step.title}
                aria-current={active ? "step" : undefined}
                onClick={action.onPick}
              >
                {step.label}
              </button>
            ) : (
              <span
                className={className}
                title={why ? `${step.title} — ${why}` : step.title}
                aria-current={active ? "step" : undefined}
              >
                {step.label}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
