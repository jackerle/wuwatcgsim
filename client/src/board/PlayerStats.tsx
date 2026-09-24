import type { CSSProperties } from "react";
import { getCard, KEYWORD_COLOR, STARTING_LIFE } from "@wuwatcg/shared";
import { CardArt } from "./CardImage";
import { useLang } from "../i18n/LanguageContext";
import { BOARD_EVENT_STAGGER_MS, type BoardEvent } from "../game/boardEvents";

/**
 * A player's name and Life, as a health bar, in their corner of the board —
 * bottom right for the near side, top right for the far one (PlayerZone puts
 * it in the hand row, which is at the outer edge of each half).
 *
 * Also where that player's hits, heals and ability draws are called out
 * (`events`): the bar flashes or shakes, and a short line beside it names
 * the card responsible.
 */
export function PlayerStats({
  name,
  life,
  advantage,
  events,
}: {
  name: string;
  /** The Life to show — PlayGame lags it behind hits that have not played yet. */
  life: number;
  advantage?: boolean;
  events: BoardEvent[];
}) {
  const { t } = useLang();
  // Life can go over where it started (a heal at full), so the bar is out of
  // whichever is larger: at 24 of 20 it is simply full.
  const ratio = Math.max(0, Math.min(1, life / Math.max(STARTING_LIFE, life)));
  const band = ratio > 0.5 ? "high" : ratio > 0.25 ? "mid" : "low";
  const lifeEvents = events.filter((event) => event.kind !== "toHand");
  const latest = lifeEvents[lifeEvents.length - 1];

  return (
    <div className="player-stats">
      {/*
        "Adv" in both languages rather than the localized keyword: this corner
        is narrow, and the Thai "แอดวานเทจ" is long enough to push the bar
        around when it appears mid-game. The colour still comes from
        KEYWORD_COLOR, so the badge and the [Advantage] tag printed in every
        ability's text can never drift to two purples. The tooltip carries the
        full wording, in the player's own language.
      */}
      <div className="player-stats-head">
        {advantage && (
          <span
            className="advantage-badge"
            style={{ color: KEYWORD_COLOR.advantage }}
            title={t("playerZone.advantageTitle")}
          >
            ◈Adv
          </span>
        )}
        <span className="player-name">{name}</span>
      </div>

      <div
        // Re-keyed per event so the flash restarts on every hit, not just the
        // first of several in a row.
        key={latest?.key ?? "idle"}
        className={`hp hp-${band} ${latest ? `hp-${latest.kind}` : ""}`}
        title="Life"
      >
        <span className="hp-heart" aria-hidden="true">
          ❤
        </span>
        <span className="hp-value">{life}</span>
        <span className="hp-track">
          <span className="hp-fill" style={{ width: `${ratio * 100}%` }} />
        </span>
        {lifeEvents.map((event) => (
          <span
            key={event.key}
            className={`hp-float hp-float-${event.kind}`}
            style={staggered(events, event)}
            aria-hidden="true"
          >
            {event.kind === "damage" ? `-${event.amount}` : `+${event.amount}`}
          </span>
        ))}
      </div>

      {events.length > 0 && (
        <div className="stat-events" aria-live="polite">
          {events.map((event) => (
            <EventLine key={event.key} event={event} style={staggered(events, event)} />
          ))}
        </div>
      )}
    </div>
  );
}

const staggered = (events: BoardEvent[], event: BoardEvent): CSSProperties => ({
  animationDelay: `${events.indexOf(event) * BOARD_EVENT_STAGGER_MS}ms`,
});

function EventLine({ event, style }: { event: BoardEvent; style: CSSProperties }) {
  const { t } = useLang();
  const card = event.cardId ? getCard(event.cardId) : undefined;
  const what =
    event.kind === "damage"
      ? t("boardEvent.damage", event.amount)
      : event.kind === "heal"
        ? t("boardEvent.heal", event.amount)
        : t("boardEvent.toHand", event.amount);

  return (
    <div className={`stat-event stat-event-${event.kind}`} style={style}>
      {card && (
        <span className="stat-event-thumb">
          <CardArt
            card={{
              cardId: card.id,
              imageId: card.imageId,
              name: card.name,
              kind: card.type === "leader" ? "character" : "action",
            }}
          />
        </span>
      )}
      <span className="stat-event-text">
        <strong>{what}</strong>
        {card && <small>{card.name}</small>}
      </span>
    </div>
  );
}
