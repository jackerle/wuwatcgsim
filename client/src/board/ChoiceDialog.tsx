import { useEffect, useState } from "react";
import { localize, type ChoiceAnswer, type PendingChoice } from "@wuwatcg/shared";
import { CardImage } from "./CardImage";

/**
 * The question a card is waiting on, shown over the board.
 *
 * The engine never guesses on the player's behalf: when an ability says
 * "you MAY...", resolution stops, the board is left untouched, and this
 * dialog appears. Answering sends the reply back and the effect runs again
 * with it. See resolveTrigger in shared/src/effects.ts.
 */
export function ChoiceDialog({
  choice,
  onAnswer,
  lang = "th",
}: {
  choice: PendingChoice | null;
  onAnswer: (answer: ChoiceAnswer) => void;
  lang?: "th" | "en";
}) {
  const [selected, setSelected] = useState<string[]>([]);

  // A new question always starts from a clean selection.
  useEffect(() => {
    setSelected([]);
  }, [choice]);

  if (!choice) return null;

  const { kind, prompt, options, min, max } = choice;
  const canDecline = min === 0;
  const enough = selected.length >= min && selected.length <= max;

  const toggle = (value: string) => {
    setSelected((current) => {
      if (current.includes(value)) return current.filter((v) => v !== value);
      if (max === 1) return [value];
      if (current.length >= max) return current;
      return [...current, value];
    });
  };

  const submit = () => {
    if (kind === "confirm") return onAnswer(true);
    if (kind === "pickOption") return onAnswer(selected[0]);
    onAnswer(max === 1 ? (selected[0] ?? "") : selected);
  };

  return (
    <div className="choice-backdrop" role="dialog" aria-modal="true">
      <div className="choice-dialog">
        <p className="choice-prompt">{localize(prompt, lang)}</p>

        {kind === "pickCard" && (
          <div className="choice-cards">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`choice-card ${selected.includes(option.value) ? "picked" : ""}`}
                onClick={() => toggle(option.value)}
              >
                {/* For pickCard the option value IS the card number, so it
                    doubles as the id: that is what lets the art fall through
                    to a parallel printing, and what the Detail panel looks
                    the ability up by while you are choosing. */}
                <CardImage
                  card={{
                    cardId: option.value,
                    imageId: option.value,
                    name: localize(option.label, lang),
                    kind: "action",
                  }}
                />
              </button>
            ))}
          </div>
        )}

        {kind === "pickOption" && (
          <div className="choice-options">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`choice-option ${selected[0] === option.value ? "picked" : ""}`}
                onClick={() => setSelected([option.value])}
              >
                {localize(option.label, lang)}
              </button>
            ))}
          </div>
        )}

        <div className="choice-actions">
          {kind === "confirm" ? (
            <>
              <button type="button" className="choice-no" onClick={() => onAnswer(false)}>
                ไม่
              </button>
              <button type="button" className="choice-yes" onClick={() => onAnswer(true)}>
                ตกลง
              </button>
            </>
          ) : (
            <>
              {canDecline && (
                <button
                  type="button"
                  className="choice-no"
                  onClick={() => onAnswer(max === 1 ? "" : [])}
                >
                  ไม่เอา
                </button>
              )}
              <button type="button" className="choice-yes" disabled={!enough} onClick={submit}>
                {max > 1 ? `ยืนยัน (${selected.length}/${max})` : "ยืนยัน"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
