// What the engine did, and what it needs a human to do.
//
// The manual list is the important half. An effect with no code written is
// never silently dropped — it surfaces here with its printed text, so the
// players can apply it themselves and the game keeps moving.

import { getCard, localize, type LogLine, type ResolvedEffect } from "@wuwatcg/shared";
import { CardImage } from "../board/CardImage";
import { EffectText } from "../board/EffectText";
import { useLang } from "../i18n/LanguageContext";

/**
 * Puts player names into a log line.
 *
 * The engine only knows seats — it writes "p1 draws 2", because a rules
 * function has no business knowing what anybody is called. The names arrive
 * with the board, so the substitution happens here, at the last moment.
 */
function withNames(line: string, names: Record<string, string>): string {
  let out = line;
  for (const [seat, name] of Object.entries(names)) {
    if (!name || name === seat) continue;
    // String.raw, because a lone \b in an ordinary template literal is a
    // backspace character, not a word boundary. The boundary is what stops a
    // seat id from matching inside a longer token.
    out = out.replace(new RegExp(String.raw`\b${seat}\b`, "g"), name);
  }
  return out;
}

/** Card numbers as the engine writes them into a log line: "[BP01-076]". */
const CARD_IN_LINE = /\[([A-Z]{2}\d{2}-\d{3})(?:_\d+)?\]/;

/**
 * Splits a log line into the card that caused it and the words themselves.
 *
 * The engine credits a card on every line one is responsible for (see
 * creditCard in match.ts), which is what lets the card's own art stand in
 * for repeating its number in the text. A line with no card — "p1 draws 1",
 * the turn passing — simply has no picture.
 */
function readLine(line: string) {
  const match = CARD_IN_LINE.exec(line);
  if (!match) return { text: line, card: null };
  const definition = getCard(match[1]);
  return {
    // The number goes with the picture, so it is not also spelled out.
    text: line.replace(match[0], "").replace(/\s{2,}/g, " ").trim(),
    // The stats travel with it, not just the art: hovering a log thumbnail
    // feeds the same Preview and Detail panels as hovering the card on the
    // board, and those read cost/colour/damage/speed off the hovered card.
    card: definition
      ? {
          cardId: definition.id,
          imageId: definition.imageId,
          name: definition.name,
          ...(definition.type === "leader"
            ? { kind: "character" as const, level: definition.level }
            : {
                kind: "action" as const,
                cost: definition.cost,
                color: definition.color,
                damage: definition.attack,
                speed: definition.speed ?? 0,
              }),
        }
      : null,
  };
}

export function MatchLog({
  log,
  manual,
  names,
}: {
  log: LogLine[];
  manual: ResolvedEffect[];
  names: Record<string, string>;
}) {
  const { t, lang } = useLang();
  return (
    <div className="side-panel battlelog-panel">
      <div className="side-panel-header">Battle Log</div>
      <div className="side-panel-body">
        {manual.length > 0 && (
          <div className="manual-effects">
            <h4>{t("matchLog.manualHeading")}</h4>
            <ul>
              {manual.map((entry, index) => (
                <li key={`${entry.cardId}-${index}`}>
                  <strong>{entry.cardId}</strong> <EffectText effect={entry.effect} lang={lang} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* The log lines come from the shared engine (see shared/src/log.ts)
            already in both languages — localize() picks the one showing. */}
        {log.length === 0 ? (
          <p className="placeholder">{t("matchLog.empty")}</p>
        ) : (
          <ol className="log-lines">
            {log.map((entry, index) => {
              const { text, card } = readLine(localize(entry, lang));
              return (
                <li key={index}>
                  {/* The slot is there whether or not a card fills it, so
                      the words stay in one column down the whole log. */}
                  <span
                    className={`log-thumb ${card ? "" : "empty"}`}
                    title={card ? `${card.name} (${card.cardId})` : undefined}
                  >
                    {card && <CardImage card={card} />}
                  </span>
                  <span className="log-text">{withNames(text, names)}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
