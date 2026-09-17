// What the engine did, and what it needs a human to do.
//
// The manual list is the important half. An effect with no code written is
// never silently dropped — it surfaces here with its printed text, so the
// players can apply it themselves and the game keeps moving.

import { formatEffect, type ResolvedEffect } from "@wuwatcg/shared";

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

export function MatchLog({
  log,
  manual,
  names,
}: {
  log: string[];
  manual: ResolvedEffect[];
  names: Record<string, string>;
}) {
  return (
    <div className="side-panel battlelog-panel">
      <div className="side-panel-header">Battle Log</div>
      <div className="side-panel-body">
        {manual.length > 0 && (
          <div className="manual-effects">
            <h4>ต้องทำเอง</h4>
            <ul>
              {manual.map((entry, index) => (
                <li key={`${entry.cardId}-${index}`}>
                  <strong>{entry.cardId}</strong> {formatEffect(entry.effect, "th")}
                </li>
              ))}
            </ul>
          </div>
        )}

        {log.length === 0 ? (
          <p className="placeholder">ยังไม่มีบันทึกการต่อสู้</p>
        ) : (
          <ol className="log-lines">
            {log.map((line, index) => (
              <li key={index}>{withNames(line, names)}</li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
