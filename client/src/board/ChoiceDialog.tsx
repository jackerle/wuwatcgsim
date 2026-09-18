import { useEffect, useState } from "react";
import { localize, type ChoiceAnswer, type PendingChoice } from "@wuwatcg/shared";
import { CardImage } from "./CardImage";
import { useLang } from "../i18n/LanguageContext";

/**
 * The question a card is waiting on, shown over the board.
 *
 * The engine never guesses on the player's behalf: when an ability says
 * "you MAY...", resolution stops, the board is left untouched, and this
 * dialog appears. Answering sends the reply back and the effect runs again
 * with it. See resolveTrigger in shared/src/effects.ts.
 */
/**
 * The single card a pickCard question offers, if it offers exactly one.
 *
 * Empty for everything else: a confirm has no cards, a pickOption is a menu
 * of actions rather than of targets, and a real choice between several is
 * the player's to make from scratch.
 */
function onlyOption(choice: PendingChoice | null): string[] {
  if (!choice || choice.kind !== "pickCard" || choice.options.length !== 1) return [];
  return [choice.options[0].value];
}

export function ChoiceDialog({
  choice,
  onAnswer,
  onCancel,
}: {
  choice: PendingChoice | null;
  onAnswer: (answer: ChoiceAnswer) => void;
  /**
   * Drops the whole move this question belongs to, when it is this player's
   * move to drop. The dialog is modal and covers the board, so a question
   * that cannot be got rid of takes the game with it — this is the way out.
   */
  onCancel?: (() => void) | null;
}) {
  const { t, lang } = useLang();
  const [selected, setSelected] = useState<string[]>([]);

  // A new question starts from a clean selection — except when there is
  // nothing to choose between. "Take a red Encore card from your trash" with
  // exactly one red Encore in there is not a choice of WHICH, only of
  // whether, so the one card is marked for them.
  //
  // Marked, never sent: the card says "you MAY", and pressing Confirm is how
  // the player says yes. Answering it for them would spend an optional
  // ability they were about to decline.
  useEffect(() => {
    setSelected(onlyOption(choice));
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
                {/* The card number comes from `cardId`, not from `value`:
                    several options can be the same printed card (four copies
                    in a trash pile), so the value has to be unique per
                    option while the art is looked up by the number. */}
                <CardImage
                  card={{
                    cardId: option.cardId ?? option.value,
                    imageId: option.cardId ?? option.value,
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
          {onCancel && (
            <button
              type="button"
              className="choice-cancel"
              title={t("choiceDialog.cancelAllTitle")}
              onClick={onCancel}
            >
              {t("common.cancelQuestion")}
            </button>
          )}
          {kind === "confirm" ? (
            <>
              <button type="button" className="choice-no" onClick={() => onAnswer(false)}>
                {t("choiceDialog.no")}
              </button>
              <button type="button" className="choice-yes" onClick={() => onAnswer(true)}>
                {t("choiceDialog.ok")}
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
                  {t("choiceDialog.decline")}
                </button>
              )}
              <button type="button" className="choice-yes" disabled={!enough} onClick={submit}>
                {max > 1 ? t("common.confirmCount", selected.length, max) : t("common.confirm")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
