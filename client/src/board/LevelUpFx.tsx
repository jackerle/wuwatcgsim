import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CharacterCard, MatchState } from "@wuwatcg/shared";
import { CardArt } from "./CardImage";
import { useLang } from "../i18n/LanguageContext";

/** How long one Level Up stays on screen, fade-out included. Matches Board.css. */
const FX_MS = 2600;

interface LevelUpEvent {
  key: number;
  seat: string;
  from: CharacterCard;
  to: CharacterCard;
}

const artOf = (card: CharacterCard) => ({
  cardId: card.id,
  imageId: card.imageId,
  name: card.name,
  kind: "character" as const,
  level: card.level,
});

/**
 * Every Level Up between two states of the same match, for either player.
 *
 * Read off the boards rather than the move that was sent, so it catches the
 * opponent's too, and a level up an ability does. A Level Up plays the new
 * card on top of the old one, so the character that levelled is the one whose
 * pile gained a card — and the card now second from the top is the one that
 * was on top before.
 */
function levelUpsBetween(before: MatchState, after: MatchState): Omit<LevelUpEvent, "key">[] {
  const found: Omit<LevelUpEvent, "key">[] = [];
  for (const seat of Object.keys(after.boards)) {
    const was = before.boards[seat];
    const now = after.boards[seat];
    if (!was || !now) continue;
    const slotsWas = [was.leader, ...was.back].filter((slot) => slot !== null);
    for (const slot of [now.leader, ...now.back]) {
      if (!slot || slot.under.length === 0) continue;
      const below = slot.under[slot.under.length - 1];
      const previous = slotsWas.find(
        (old) => old.card.id === below.id && old.under.length === slot.under.length - 1
      );
      if (previous) found.push({ seat, from: previous.card, to: slot.card });
    }
  }
  return found;
}

/**
 * A short cut-in whenever a character levels up: the card that was on top,
 * then the card played onto it, then the whole thing fades away.
 *
 * The match does not wait for it — the bot or the other player keeps going
 * underneath. A Level Up often triggers an ability that asks something
 * (Sanhua's does); PlayGame holds that question back until this is over
 * (onPlayingChange), so the player sees the cause before being asked about
 * it. A click skips it. Several at once play one after another.
 */
export function LevelUpFx({
  state,
  nameOf,
  onPlayingChange,
}: {
  state: MatchState;
  nameOf: (seat: string) => string;
  /**
   * Told when the animation starts and stops, so the screen can hold back an
   * ability's question until it is over — see PlayGame.
   */
  onPlayingChange?: (playing: boolean) => void;
}) {
  const { t } = useLang();
  const previous = useRef<MatchState | null>(null);
  const nextKey = useRef(0);
  const [queue, setQueue] = useState<LevelUpEvent[]>([]);

  // Layout effects, not plain ones: they run before the browser paints, so
  // the frame where the new state has arrived but the animation has not
  // started never shows — the question it holds back would flash up in it.
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = state;
    // A new deal is not a Level Up, whatever the boards look like.
    if (!before || before.matchId !== state.matchId) {
      setQueue([]);
      return;
    }
    const events = levelUpsBetween(before, state);
    if (events.length === 0) return;
    setQueue((current) => [...current, ...events.map((event) => ({ ...event, key: nextKey.current++ }))]);
  }, [state]);

  const showing = queue[0];
  useEffect(() => {
    if (!showing) return;
    const timer = window.setTimeout(() => setQueue((current) => current.slice(1)), FX_MS);
    return () => window.clearTimeout(timer);
  }, [showing]);

  const playing = Boolean(showing);
  useLayoutEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  if (!showing) return null;

  return (
    <div
      key={showing.key}
      className="levelup-fx"
      aria-live="polite"
      onClick={() => setQueue((current) => current.slice(1))}
    >
      <div className="levelup-fx-cards">
        <div className="levelup-fx-card levelup-fx-from">
          <CardArt card={artOf(showing.from)} />
          <span className="levelup-fx-level">Lv.{showing.from.level}</span>
        </div>
        <span className="levelup-fx-arrow" aria-hidden="true">
          ➜
        </span>
        <div className="levelup-fx-card levelup-fx-to">
          <CardArt card={artOf(showing.to)} />
          <span className="levelup-fx-level">Lv.{showing.to.level}</span>
        </div>
      </div>
      <p className="levelup-fx-title">
        {t("levelUpFx.title", nameOf(showing.seat), showing.to.name, showing.to.level)}
      </p>
    </div>
  );
}
