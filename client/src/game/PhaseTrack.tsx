// The turn, laid out as the four steps a player actually thinks in.
//
// The engine has five phases, not four: the Combo Step is its own phase
// because the rules resolve it separately, but from the table it is still
// the battle — you are extending the attack you just won. So it shares the
// Battle step here rather than adding a box that blinks past.
//
// Nothing is clickable. This says where the turn is, and the control bar
// beside it says what to do about it.

import type { TurnPhase } from "@wuwatcg/shared";

interface Step {
  key: string;
  label: string;
  /** Engine phases that light this step up. */
  phases: TurnPhase[];
  /** The Thai name, for the tooltip — the label itself stays short. */
  title: string;
}

const STEPS: Step[] = [
  { key: "draw", label: "Draw", phases: ["draw"], title: "เฟสจั่ว" },
  { key: "main", label: "Main", phases: ["action"], title: "เฟสหลัก — ชาร์จ เลเวลอัป สลับ Leader" },
  {
    key: "battle",
    label: "Battle",
    // The Combo Step is the tail of the battle, not a step of its own.
    phases: ["counter", "combo"],
    title: "เฟสประลอง — เปิดการ์ดและโจมตีต่อเนื่อง",
  },
  { key: "end", label: "End", phases: ["end"], title: "เฟสจบเทิร์น" },
];

export function PhaseTrack({ phase }: { phase: TurnPhase }) {
  return (
    <ol className="phase-track" aria-label="ลำดับเฟสในเทิร์น">
      {STEPS.map((step, index) => {
        const active = step.phases.includes(phase);
        return (
          <li key={step.key} className="phase-track-item">
            {index > 0 && (
              <span className="phase-track-arrow" aria-hidden="true">
                ›
              </span>
            )}
            <span
              className={`phase-track-step ${active ? "active" : ""}`}
              title={step.title}
              aria-current={active ? "step" : undefined}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
