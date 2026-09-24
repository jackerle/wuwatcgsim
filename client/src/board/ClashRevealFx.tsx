import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ActionCard, MatchState } from "@wuwatcg/shared";
import { CardArt } from "./CardImage";
import { clashRevealBetween, type ClashReveal } from "./clashReveal";
import { useLang } from "../i18n/LanguageContext";
import { playCardSfx } from "../audio/sfx";

/** How long the reveal stays on screen, fade-out included. Matches Board.css. */
const FX_MS = 1900;
/** When the cards start turning over: 16% into clash-fx-flip in Board.css. */
const FLIP_SOUND_MS = 300;


/**
 * Both committed cards turning face-up at once, the moment the Counter Phase
 * resolves.
 *
 * Read off the state change rather than the move, so it plays the same
 * whoever triggered the reveal: the Counter Phase ending is the reveal, and
 * resolveCounter() puts each side's card at the front of its Action Zone —
 * an empty zone means that player laid nothing down. When neither did, there
 * was nothing to turn over and nothing plays.
 *
 * Kept short on purpose (under two seconds, and a click skips it): this
 * happens every turn, and the Action Zones already show the result. Any
 * question the reveal raises ([Enter], [Counter], [Judgement]) waits for it
 * to finish — see onPlayingChange.
 */
export function ClashRevealFx({
  state,
  top,
  bottom,
  nameOf,
  onPlayingChange,
}: {
  state: MatchState;
  top: string;
  bottom: string;
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
  const [reveal, setReveal] = useState<(ClashReveal & { key: number }) | null>(null);

  // Layout effects, not plain ones: they run before the browser paints, so
  // the frame where the new state has arrived but the animation has not
  // started never shows — the question it holds back would flash up in it.
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = state;
    if (!before || before.matchId !== state.matchId) {
      setReveal(null);
      return;
    }
    const found = clashRevealBetween(before, state, top, bottom);
    if (found) setReveal({ key: nextKey.current++, ...found });
  }, [state, top, bottom]);

  useEffect(() => {
    if (!reveal) return;
    const timer = window.setTimeout(() => setReveal(null), FX_MS);
    const flip = window.setTimeout(playCardSfx, FLIP_SOUND_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(flip);
    };
  }, [reveal]);

  const playing = reveal !== null;
  useLayoutEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  if (!reveal) return null;

  const side = (seat: string, card: ActionCard | null) => (
    <div className={`clash-fx-side ${reveal.result?.winnerId === seat ? "winner" : ""}`}>
      <span className="clash-fx-name">{nameOf(seat)}</span>
      {card ? (
        <div className="clash-fx-card">
          <div className="clash-fx-flip">
            <div className="clash-fx-face clash-fx-back card-back" />
            <div className="clash-fx-face clash-fx-front">
              <CardArt
                card={{
                  cardId: card.id,
                  imageId: card.imageId,
                  name: card.name,
                  kind: "action",
                  cost: card.cost,
                  color: card.color,
                  damage: card.damage,
                  speed: card.speed,
                }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="clash-fx-card clash-fx-none">{t("clashFx.noCard")}</div>
      )}
    </div>
  );

  return (
    <div key={reveal.key} className="clash-fx" aria-live="polite" onClick={() => setReveal(null)}>
      {side(top, reveal.top)}
      <p className="clash-fx-result">
        {reveal.result &&
          (reveal.result.winnerId ? t("clashFx.wins", nameOf(reveal.result.winnerId)) : t("clashFx.draw"))}
      </p>
      {side(bottom, reveal.bottom)}
    </div>
  );
}
