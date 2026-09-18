// The turn, laid out as the six steps a player thinks in — and nothing else.
//
// Nothing here is pressable. The steps were briefly buttons, on the grounds
// that pressing the step IS the move, but a row where some tabs act and others
// only report is a row you have to test by clicking. So the track answers one
// question — where is the turn — and the single verb button beside it (see
// ControlBar) is the only thing that moves the game on.
//
// It does not read MatchState either. Which box is lit comes in as `active`,
// worked out by ControlBar: one engine phase (`combo`) covers two of these
// boxes, so the mapping needs the board, and putting it here would have made
// this component know the rules as well as draw them.

import { useLang, type StringKey } from "../i18n/LanguageContext";

export type PhaseStepKey = "draw" | "main" | "battle" | "judgement" | "combo" | "end";

interface Step {
  key: PhaseStepKey;
  label: string;
  /** The i18n key for the tooltip — the label itself stays short. */
  titleKey: StringKey;
}

/**
 * Judgement and Combo are separate boxes, though the engine runs both inside
 * one `combo` phase.
 *
 * They were one box, called Judgement, and that hid the difference between
 * "the clash has been decided, look at what it did" and "a follow-up chain is
 * running". A turn with no follow-up never reaches the Combo box at all, which
 * is the point: the track shows it was skipped rather than implying a step
 * happened that did not.
 */
const STEPS: Step[] = [
  { key: "draw", label: "Draw", titleKey: "phaseTrack.draw" },
  { key: "main", label: "Main", titleKey: "phaseTrack.main" },
  { key: "battle", label: "Battle", titleKey: "phaseTrack.battle" },
  { key: "judgement", label: "Judgement", titleKey: "phaseTrack.judgement" },
  { key: "combo", label: "Combo", titleKey: "phaseTrack.combo" },
  { key: "end", label: "End", titleKey: "phaseTrack.end" },
];

export function PhaseTrack({
  active,
  waiting = {},
}: {
  /** The step the turn is on, or null outside a turn (the mulligan). */
  active: PhaseStepKey | null;
  /**
   * Steps that are the next move but not ready — the reason is shown as the
   * tooltip, and the step is drawn dashed. Distinct from the active step: one
   * is where the turn IS, the other is where it is trying to go.
   */
  waiting?: Partial<Record<PhaseStepKey, string>>;
}) {
  const { t } = useLang();
  return (
    <ol className="phase-track" aria-label={t("phaseTrack.ariaLabel")}>
      {STEPS.map((step, index) => {
        const isActive = step.key === active;
        const why = waiting[step.key];
        const stepTitle = t(step.titleKey);
        return (
          <li key={step.key} className="phase-track-item">
            {index > 0 && (
              <span className="phase-track-arrow" aria-hidden="true">
                ›
              </span>
            )}
            <span
              className={`phase-track-step ${isActive ? "active" : ""} ${why ? "waiting" : ""}`}
              title={why ? `${stepTitle} — ${why}` : stepTitle}
              aria-current={isActive ? "step" : undefined}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
