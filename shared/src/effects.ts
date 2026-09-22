// The engine side of card effects: raising a trigger, building the context an
// effect resolves against, and deciding what happens to effects nobody has
// written the code for yet.
//
// The contract that makes an incomplete card list safe to play with: an
// effect with no `resolve` is NOT skipped silently. Its printed text comes
// back in `manual`, so the UI can ask the players to apply it. The app
// degrades into "it tells you what to do", never into "the card did nothing
// and nobody noticed".

import {
  appliesTo,
  describeFilter,
  effectiveStats,
  matchesFilter,
  type CardFilter,
  type FilterableCard,
  type LocalizedText,
  type ModifierDuration,
  type StatModifier,
} from "./cards";
import {
  continuousOf,
  effectsForContinuous,
  effectsForTrigger,
  isManual,
  keywordsOf,
  triggerOf,
  triggersOf,
  comboGrantFor,
  type CardDef,
  type CardEffect,
  type ChoiceAnswer,
  type ChoiceOption,
  type ChoiceTag,
  type Condition,
  type EffectContext,
  type PendingChoice,
} from "./cardDef";
import type { CardKeyword, ContinuousKeyword, EffectTrigger } from "./cards";
import { getCard } from "./cardDb";
import { LOG, PROMPT, type LogLine } from "./log";
import { canStackOnto, recordCharacterPlayed, takeFromDeck } from "./rules";
import { characterStack, nextRandom, shuffleWithState } from "./game";
import type {
  ActionCard,
  CharacterInstance,
  ComboGrant,
  MatchState,
  PlayerBoard,
} from "./game";

/** Where a card sits while its effect is being considered. */
export type EffectZone = "leader" | "back" | "actionZone" | "concerto" | "hand" | "trash";

/**
 * A runtime card carries only its printed stats, so character and subtype
 * come from the card database. Filters need all three.
 */
/** Every keyword printed anywhere on a card, for filter.keyword. */
function keywordsOn(card: CardDef): CardKeyword[] {
  const out = new Set<CardKeyword>();
  for (const effect of card.effects) {
    for (const keyword of keywordsOf(effect.condition)) out.add(keyword);
  }
  return [...out];
}

export function filterableFor(card: ActionCard): FilterableCard {
  const definition = getCard(card.id);
  return {
    id: card.id,
    color: card.color,
    character: definition?.character ?? null,
    subtypes: definition && definition.type === "action" ? definition.subtypes : undefined,
    keywords: definition ? keywordsOn(definition) : undefined,
  };
}

export interface EffectSource {
  card: CardDef;
  controllerId: string;
  zone: EffectZone;
  /**
   * Abilities this card was handed by something else — see ctx.grantEffect.
   * They resolve exactly like printed ones, with `ctx.self` set to this card.
   */
  granted?: CardEffect[];
}

export type EffectStatus = "applied" | "manual" | "skipped" | "failed" | "awaiting";

/**
 * Thrown when an effect asks the player something the engine has no answer
 * for yet. Never an error condition — it is how a choice suspends the run.
 */
export class NeedsChoice extends Error {
  // Written out longhand rather than as a parameter property: the client
  // compiles with erasableSyntaxOnly, which forbids that shorthand.
  readonly choice: PendingChoice;

  constructor(choice: PendingChoice) {
    super(`Waiting on ${choice.playerId}: ${choice.prompt.en ?? choice.prompt.th ?? ""}`);
    this.name = "NeedsChoice";
    this.choice = choice;
  }
}

export interface ResolvedEffect {
  cardId: string;
  controllerId: string;
  effect: CardEffect;
  status: EffectStatus;
  /** Why it needs a human, why it did not apply, or what went wrong. */
  reason?: string;
  log: LogLine[];
}

export interface TriggerResult {
  state: MatchState;
  resolved: ResolvedEffect[];
  /** Effects the players must apply themselves — the UI shows these. */
  manual: ResolvedEffect[];
  /**
   * Set when the run stopped to ask something. `state` is the board as it was
   * BEFORE the asking effect started, so nothing is half-applied. Show the
   * question, then call resolveTrigger again with the answer appended.
   */
  pending: PendingChoice | null;
}

// --- Context ---------------------------------------------------------------

/**
 * Walks the answers given so far, in the order the questions were asked.
 *
 * One cursor spans everything that replays as a unit. A single trigger makes
 * its own; a whole phase — which may raise several triggers — shares one, so
 * the answers keep lining up across all of them. See match.ts.
 */
export interface AnswerCursor {
  answers: ChoiceAnswer[];
  next: number;
}

export function makeCursor(answers: ChoiceAnswer[] = []): AnswerCursor {
  return { answers, next: 0 };
}

/**
 * Which cards to take out of a pile, asked of the player when there is a
 * real choice to make.
 *
 * "Take a red Encore card from your trash" is a decision when the trash
 * holds three of them, and the engine has no business making it — it used
 * to take the most recently binned one and say nothing. Asked only when it
 * matters: fewer matches than the card wants (or exactly as many) leaves
 * nothing to decide, so nothing is asked; neither do copies of one printed
 * card, which are not a choice, they are the same card twice.
 *
 * Returns the cards themselves, still in the pile; the caller moves them.
 *
 * Standalone rather than a helper closed over one card's own effect context:
 * match.ts asks the same question outside of any effect — which charged
 * cards pay a cost is the player's choice too (rule 909.2, "any X cards"),
 * not a card asking on its own behalf. `askingCardId` credits whichever card
 * IS asking, effect or not.
 *
 * `ask` is the asking function itself rather than a cursor, so each caller
 * can suspend its own way: an effect's `ask(cursor, choice)` throws
 * NeedsChoice, which `runEffect` is set up to catch, while match.ts's
 * `Run.ask` throws Suspended, which `step` is set up to catch. Same question,
 * same selection logic, two callers that cannot share an exception type.
 */
export function pickCardsFrom(
  ask: (choice: PendingChoice) => ChoiceAnswer,
  askingCardId: string,
  pile: ActionCard[],
  count: number,
  filter: CardFilter | undefined,
  owner: string,
  prompt: LocalizedText,
  /** What the pick is for — see ChoiceTag. Paired with `prompt`. */
  tag: ChoiceTag
): ActionCard[] {
  // Newest first, which is the order these piles are read in and the one
  // the old silent behaviour used.
  const candidates = [...pile]
    .reverse()
    .filter((c) => !filter || matchesFilter(filterableFor(c), filter));
  if (candidates.length <= count) return candidates;
  // Copies of one printed card are not a choice, they are the same card
  // twice. This is also what keeps a card that already asked — "you MAY
  // take a {Basic Attack}", then take the one they named — from asking a
  // second time on the way through here.
  if (new Set(candidates.map((c) => c.id)).size === 1) return candidates.slice(0, count);

  const answer = ask({
    kind: "pickCard",
    playerId: owner,
    cardId: askingCardId,
    prompt,
    options: candidates.map(cardOption),
    min: count,
    max: count,
    tag,
  });
  const picked = Array.isArray(answer) ? answer : [answer].filter((v) => typeof v === "string");
  const seen = new Set<number>();
  const chosen: ActionCard[] = [];
  for (const value of picked as string[]) {
    const at = optionIndex(value);
    if (seen.has(at) || !candidates[at]) continue;
    seen.add(at);
    chosen.push(candidates[at]);
  }
  // An answer that named nothing usable still has to move the game on, so
  // fall back to what the engine would have taken on its own.
  return chosen.length > 0 ? chosen : candidates.slice(0, count);
}

function createContext(
  state: MatchState,
  card: CardDef,
  controllerId: string,
  log: LogLine[],
  /** Set while recomputing continuous effects — see recomputeContinuous. */
  derived = false,
  cursor: AnswerCursor = { answers: [], next: 0 },
  /**
   * The effect being resolved, when there is one. Only the parts of the
   * context that have to tell one of a card's abilities from another look at
   * it — see grantFollowUp.
   */
  effect?: CardEffect
): EffectContext {
  const opponentId = Object.keys(state.boards).find((id) => id !== controllerId) ?? "";
  const boardOf = (playerId?: string): PlayerBoard => {
    const board = state.boards[playerId ?? controllerId];
    if (!board) throw new Error(`No board for player "${playerId ?? controllerId}"`);
    return board;
  };

  /**
   * Everything that has to happen after two characters trade places, wherever
   * the switch came from.
   *
   * Both of them were "switched" — rule 906.2: "a character whose position
   * changed as a result of a switch is said to be switched". That is not only
   * the one arriving in front. The FAQ settles it for the cards that ask:
   * #52 on SD01-009 跃焰 ("[Combo] Switch your Leader. If 「Chixia」 is one of
   * the switched characters, this card deals +2") answers yes for a Chixia who
   * was switched OUT of the Leader slot into the back.
   *
   * So this raises [Switch] (913.9.1, "triggers when the character card
   * carrying it is switched") on both piles, and hands the caller both names
   * for the cards that condition on who moved.
   *
   * Switches written into an ability are switches. The keyword rule says
   * "when the card is switched" with no mention of how, and FAQ #52 is itself
   * about an ability-driven one — the Action Phase rule move (603.1.2.1.1) is
   * one source of these, not the only one.
   *
   * The whole pile on each side, not just the top card: a buried level keeps
   * its skills (205.4), which is why a level up fires [Level up] on the cards
   * underneath. Only [Enter] is restricted to the topmost card (603.1.2.2.1),
   * and [Switch] carries no such restriction.
   */
  const fireSwitched = (
    ownerId: string,
    incoming: CharacterInstance,
    outgoing: CharacterInstance | null
  ): string[] => {
    // Their new positions: the incoming card is the Leader by the time this
    // runs, and the one it displaced is in the back.
    const moved: { slot: CharacterInstance; zone: EffectZone }[] = [
      { slot: incoming, zone: "leader" },
      ...(outgoing ? [{ slot: outgoing, zone: "back" as const }] : []),
    ];
    for (const { slot, zone } of moved) {
      for (const stacked of characterStack(slot)) {
        fireHere(state, "switch", stacked, ownerId, zone, cursor, log);
      }
    }
    return moved.map(({ slot }) => slot.card.name);
  };

  // This card's own version of pickCardsFrom (above): same question, with
  // `cursor` and `card.id` filled in from this effect's own context instead
  // of being passed by every call site below.
  const pickFrom = (
    pile: ActionCard[],
    count: number,
    filter: CardFilter | undefined,
    owner: string,
    prompt: LocalizedText,
    tag: ChoiceTag
  ): ActionCard[] =>
    pickCardsFrom((choice) => ask(cursor, choice), card.id, pile, count, filter, owner, prompt, tag);

  /** Lifts specific cards out of a pile, by identity. */
  const lift = (pile: ActionCard[], cards: ActionCard[]): ActionCard[] => {
    const out: ActionCard[] = [];
    for (const target of cards) {
      const at = pile.indexOf(target);
      if (at >= 0) out.push(...pile.splice(at, 1));
    }
    return out;
  };

  const pushModifier = (modifier: Omit<StatModifier, "id" | "derived">) => {
    state.statModifiers.push({
      ...modifier,
      id: `${card.id}-${state.statModifiers.length}-${modifier.stat}`,
      ...(derived ? { derived: true } : {}),
    });
  };

  return {
    self: card,
    controllerId,
    opponentId,
    state,

    wonLastBattle: () => state.lastBattleWinnerId === controllerId,
    hasAdvantage: () => state.advantageIds.includes(controllerId),
    wonWith: (color) =>
      state.lastBattle?.winnerId === controllerId &&
      state.lastBattle.colorByPlayer[controllerId] === color,
    wonWithThisCard: () =>
      state.lastBattle?.winnerId === controllerId &&
      // The card this player revealed IS the card that deals the clash damage,
      // so "this card dealt the damage" is the same question as "this card is
      // the one I countered with".
      state.lastBattle.cardIdByPlayer[controllerId] === card.id,
    lostTo: (color) => {
      const battle = state.lastBattle;
      if (!battle || battle.loserId !== controllerId || !battle.winnerId) return false;
      return battle.colorByPlayer[battle.winnerId] === color;
    },
    lastPlayedColor: (playerId) => {
      const id = playerId ?? controllerId;
      // The card face-up in the Action Area is the one being played right
      // now — that is what "[Counter] if you counter with a green card"
      // means.
      const zone = state.actionZone[id] ?? [];
      if (zone.length > 0) return zone[0].color;

      // Mid-clash, an empty Action Area IS the answer: this player revealed
      // nothing, so they countered with nothing. Falling back here would
      // reach for the previous battle — and lastBattle is not replaced until
      // after [Counter] has been raised, so a player who countered with red
      // last turn and passed this turn would keep firing "if you counter
      // with a red card" every turn afterwards.
      if (state.phase === "counter" || state.phase === "combo" || state.phase === "end") {
        return null;
      }
      return state.lastBattle?.colorByPlayer[id] ?? null;
    },
    board: boardOf,
    hand: (playerId) => boardOf(playerId).hand,
    life: (playerId) => boardOf(playerId).life,
    leaderId: (playerId) => boardOf(playerId).leader?.card.id ?? null,
    actionZone: (playerId) => state.actionZone[playerId ?? controllerId] ?? [],
    concerto: (playerId) => boardOf(playerId).competitionArea,
    countMatching: (cards, filter) =>
      cards.filter((c) => matchesFilter(filterableFor(c), filter)).length,

    cardsPlayedThisTurn: (playerId) => state.turnLog.cardsPlayed[playerId ?? controllerId] ?? [],
    countPlayedThisTurn: (filter, playerId) =>
      (state.turnLog.cardsPlayed[playerId ?? controllerId] ?? []).filter((c) =>
        matchesFilter(filterableFor(c), filter)
      ).length,
    selfPlayedThisTurn: (playerId) => {
      const who = playerId ?? controllerId;
      // Either pile: an action card is played by being turned up, a
      // character by being levelled onto the field.
      return (
        (state.turnLog.cardsPlayed[who] ?? []).some((c) => c.id === card.id) ||
        (state.turnLog.charactersPlayed[who] ?? []).includes(card.id)
      );
    },
    damageTakenThisTurn: (playerId) => state.turnLog.damageTaken[playerId ?? controllerId] ?? 0,
    healedThisTurn: (playerId) => state.turnLog.healed[playerId ?? controllerId] ?? 0,
    useLimit(max, label) {
      const key = label ? `${card.id}:${label}` : card.id;
      const used = state.turnLog.uses[key] ?? 0;
      if (used >= max) return false;
      state.turnLog.uses[key] = used + 1;
      return true;
    },
    restrict(flag, playerId) {
      const target = playerId ?? controllerId;
      const list = (state.turnLog.flags[target] ??= []);
      if (!list.includes(flag)) list.push(flag);
      log.push(LOG.restricted(target, flag));
    },
    isRestricted: (flag, playerId) =>
      (state.turnLog.flags[playerId ?? controllerId] ?? []).includes(flag),

    draw(count, playerId) {
      const board = boardOf(playerId);
      // The one operation that rebuilds mid-count: "draw 2" off a 1-card deck
      // draws it, rebuilds from the trash, and draws the second.
      const drawn = takeFromDeck(state, board, count, log, { recycle: true });
      board.hand.push(...drawn);
      log.push(LOG.draws(board.playerId, drawn.length));
    },
    damage(amount, targetId) {
      const board = boardOf(targetId ?? opponentId);
      board.life -= amount;
      const seen = state.turnLog.damageTaken[board.playerId] ?? 0;
      state.turnLog.damageTaken[board.playerId] = seen + amount;
      log.push(LOG.takesFrom(board.playerId, amount, `${card.name} [${card.id}]`, board.life));
    },
    heal(amount, playerId) {
      const board = boardOf(playerId);
      board.life += amount;
      const seen = state.turnLog.healed[board.playerId] ?? 0;
      state.turnLog.healed[board.playerId] = seen + amount;
      log.push(LOG.healsFrom(board.playerId, amount, `${card.name} [${card.id}]`, board.life));
    },
    discard(count, playerId) {
      const board = boardOf(playerId);
      const moved = lift(
        board.hand,
        pickFrom(board.hand, count, undefined, board.playerId, PROMPT.discard(count), "discard")
      );
      board.trash.push(...moved);
      log.push(LOG.discards(board.playerId, moved.length));
    },
    charge(count, playerId) {
      const board = boardOf(playerId);
      const moved = lift(
        board.hand,
        pickFrom(board.hand, count, undefined, board.playerId, PROMPT.charge(count), "charge")
      );
      board.competitionArea.push(...moved);
      log.push(LOG.chargesCards(board.playerId, moved.length));
    },
    returnToCharacterDeck() {
      const board = boardOf();
      const slots = [board.leader, ...board.back].filter(
        (entry): entry is CharacterInstance => entry !== null
      );
      // Only THIS card goes back. The levels it was played over stay on the
      // table — take the top card off a 0>1>2 pile and the character is still
      // there at Level 1, not gone.
      const slot = slots.find(
        (entry) => entry.card.id === card.id || entry.under.some((c) => c.id === card.id)
      );
      if (!slot) {
        log.push(LOG.notOnField(card.id));
        return;
      }

      if (slot.card.id === card.id) {
        const beneath = slot.under.pop();
        board.characterPool.push(slot.card);
        if (beneath) {
          slot.card = beneath;
          log.push(LOG.returnsToCharacterDeckExposing(card.id, beneath.id));
          return;
        }
        // Nothing underneath: the character leaves the field entirely.
        if (board.leader === slot) board.leader = null;
        else board.back = board.back.filter((entry) => entry !== slot);
        log.push(LOG.returnsToCharacterDeckEmptying(card.id));
        return;
      }

      // Buried in the pile: pull just that card out, the rest closes up.
      const at = slot.under.findIndex((c) => c.id === card.id);
      board.characterPool.push(...slot.under.splice(at, 1));
      log.push(LOG.returnsToCharacterDeck(card.id));
    },
    switchLeader(toCardId, playerId) {
      const board = boardOf(playerId);
      const index = toCardId
        ? board.back.findIndex((slot) => slot.card.id === toCardId)
        : 0;
      if (index < 0 || !board.back[index]) {
        log.push(LOG.noBackCharacter());
        return [];
      }
      const incoming = board.back[index];
      const outgoing = board.leader;
      // Whole pile, not just the top card — see CharacterInstance.under.
      board.leader = { ...incoming, position: "leader" };
      if (outgoing) board.back[index] = { ...outgoing, position: "back" };
      else board.back.splice(index, 1);
      log.push(LOG.switchesLeader(board.playerId, incoming.card.id));
      return fireSwitched(board.playerId, incoming, outgoing);
    },
    revealTop(count, playerId) {
      const board = boardOf(playerId);
      // Whatever is actually on top, however few. Revealing is not drawing, so
      // a short deck is not topped up first: "reveal the top 5" off a 2-card
      // deck shows 2, and the rebuild happens once the skill has finished
      // (rebuildEmptyDecks). Rebuilding here would hand the card three extra
      // cards and empty the trash mid-effect.
      const revealed = board.actionDeck.slice(0, count);
      log.push(LOG.revealsTop(board.playerId, revealed.length));
      return revealed;
    },
    topToConcerto(count, playerId) {
      const board = boardOf(playerId);
      const moved = takeFromDeck(state, board, count, log, { recycle: false });
      board.competitionArea.push(...moved);
      log.push(LOG.deckToConcerto(board.playerId, moved.length));
    },
    deckToHand(count, playerId) {
      const board = boardOf(playerId);
      // Not a draw: "take the top N to hand" is printed on cards that reveal
      // first, and those take what is there. ctx.draw is the one that tops the
      // deck up mid-count.
      const moved = takeFromDeck(state, board, count, log, { recycle: false });
      board.hand.push(...moved);
      log.push(LOG.deckToHand(board.playerId, moved.length));
      return moved;
    },
    deckToTrash(count, playerId) {
      const board = boardOf(playerId);
      const moved = takeFromDeck(state, board, count, log, { recycle: false });
      board.trash.push(...moved);
      log.push(LOG.deckToTrash(board.playerId, moved.length));
      return moved;
    },
    trashToHand(count, filter, playerId) {
      const board = boardOf(playerId);
      const moved = lift(
        board.trash,
        pickFrom(board.trash, count, filter, board.playerId, PROMPT.trashToHand(count), "trashToHand")
      );
      board.hand.push(...moved);
      // Silent when nothing matched — an ability that found no target should
      // not leave a line in the battle log claiming it did something.
      if (moved.length > 0) {
        log.push(LOG.trashToHand(board.playerId, moved.length));
      }
    },
    buff(filter: CardFilter, stat, amount, duration: ModifierDuration = "turn", options = {}) {
      pushModifier({
        controllerId,
        sourceCardId: card.id,
        stat,
        amount,
        filter: { ...filter, ...(options.side ? { side: options.side } : {}) },
        duration,
        ...(options.limit ? { limit: options.limit } : {}),
      });
      log.push(LOG.statChange(describeFilter(filter), stat, amount, duration));
    },
    setStat(filter: CardFilter, stat, value, duration: ModifierDuration = "turn", options = {}) {
      pushModifier({
        controllerId,
        sourceCardId: card.id,
        stat,
        amount: value,
        mode: "set",
        filter: { ...filter, ...(options.side ? { side: options.side } : {}) },
        duration,
        ...(options.limit ? { limit: options.limit } : {}),
      });
      log.push(LOG.statSet(describeFilter(filter), stat, value, duration));
    },

    grantEffect(filter: CardFilter, grantKey, duration: ModifierDuration = "turn", options = {}) {
      if (!card.grants?.[grantKey]) {
        throw new Error(`${card.id} has no grant named "${grantKey}"`);
      }
      state.grantedEffects.push({
        id: `${card.id}-g${state.grantedEffects.length}`,
        controllerId,
        sourceCardId: card.id,
        filter: { ...filter, ...(options.side ? { side: options.side } : {}) },
        effectKey: grantKey,
        duration,
        ...(options.limit ? { limit: options.limit } : {}),
        ...(derived ? { derived: true } : {}),
      });
      log.push(LOG.gainsAbility(describeFilter(filter), duration));
    },

    limitActionArea(filter: CardFilter, max, playerId) {
      const target = playerId ?? controllerId;
      state.zoneLimits.push({
        id: `${card.id}-z${state.zoneLimits.length}`,
        controllerId: target,
        sourceCardId: card.id,
        filter,
        max,
        ...(derived ? { derived: true } : {}),
      });
    },
    grantFollowUp(count, playerId) {
      // An ACTION card's own Follow{x} is already applied by combat, at the
      // moment it wins the clash — comboGrantFor() reads `followCount` off
      // the printed card and that is what opens the Combo window. An effect
      // that declares `followCount` and then hands the same number out here
      // is the one ability written down twice, and the player gets both:
      // Follow{2} allowed four follow-ups, Follow{8} sixteen.
      //
      // The printed number wins, so this call is dropped. A LEADER's Follow
      // is a different thing and still goes through: comboGrantFor is only
      // ever asked about the winning action card, so a Leader Skill granting
      // follow-ups has no other way to do it — its own `followCount` is there
      // to print "[Follow{3}]" in the card text, nothing more.
      if (card.type === "action" && typeof effect?.followCount === "number") return;
      const target = playerId ?? controllerId;
      const window = state.combo;
      if (window && window.playerId === target) {
        if (!window.unlimited) window.remaining += count;
      } else {
        // Nothing open yet: these fire on [Judgement], which lands before the
        // Combo Step has a window set up.
        state.combo = { playerId: target, unlimited: false, remaining: count };
      }
      log.push(LOG.gainsFollowUp(target, count));
    },
    returnToHand() {
      const board = boardOf();
      const zone = state.actionZone[controllerId] ?? [];
      const at = zone.findIndex((c) => c.id === card.id);
      if (at < 0) {
        log.push(LOG.notInActionArea(card.id));
        return;
      }
      board.hand.push(...zone.splice(at, 1));
      log.push(LOG.returnsToHand(card.id));
    },

    levelUpCharacter(characterName, options = {}) {
      const board = boardOf(options.playerId);
      const slot = [board.leader, ...board.back].find(
        (entry) => entry?.card.name === characterName
      );
      if (!slot) {
        log.push(LOG.notInPlay(characterName));
        return false;
      }
      // "By whatever means" — the 5-card ceiling binds an ability-driven level
      // up exactly as it binds the Action Phase one, so a card that says "level
      // this character up" cannot push a full pile past it either.
      const room = canStackOnto(slot);
      if (!room.ok) {
        log.push(LOG.cannotStackHigher(characterName));
        return false;
      }
      // A card that names the level it puts into play says exactly which
      // cards it means, and the one-step ladder is not one of the things it
      // has to obey — reaching Level 2 out of turn is what makes such a card
      // worth playing. Everything else climbs the usual way: one step at a
      // time, and a card of the level they are already at counts, same as
      // canLevelUpOnto in rules.ts.
      const wanted = options.level;
      const legalLevel = (level: number) =>
        wanted !== undefined
          ? level === wanted
          : level >= slot.card.level && level <= slot.card.level + 1;
      const candidates = board.characterPool
        .map((c, index) => ({ c, index }))
        .filter(({ c }) => c.name === characterName && c.level > 0 && legalLevel(c.level))
        .sort((a, b) => a.c.level - b.c.level);
      if (candidates.length === 0) {
        log.push(LOG.noLevelUpCardLeft(characterName));
        return false;
      }

      // Which card goes on top is the player's call, not the engine's: the
      // levels legal here are different cards with different abilities, and
      // staying at the level you are on to pick up a second Level 1 skill is
      // a real play. Only worth asking when the answer is not forced.
      let chosen = candidates[0];
      if (candidates.length > 1) {
        const answer = ask(cursor, {
          kind: "pickCard",
          playerId: board.playerId,
          cardId: card.id,
          prompt: {
            th: `Level up ${characterName} ด้วยการ์ดใบไหน`,
            en: `Level ${characterName} up with which card?`,
          },
          options: candidates.map(({ c }) => ({
            value: c.id,
            label: { th: `${c.name} Lv.${c.level}`, en: `${c.name} Lv.${c.level}` },
          })),
          min: 1,
          max: 1,
        });
        const pickedId = Array.isArray(answer) ? answer[0] : answer;
        chosen = candidates.find(({ c }) => c.id === pickedId) ?? candidates[0];
      }

      const [picked] = board.characterPool.splice(chosen.index, 1);
      slot.under.push(slot.card);
      slot.card = picked;
      const beneath = [...slot.under];
      adoptState(state, recordCharacterPlayed(state, board.playerId, picked.id));
      log.push(LOG.levelsUp(board.playerId, characterName, picked.level));

      // The same triggers the Action Phase move raises: [Enter] for the one
      // arriving, [Level up] for every card it was played over — the whole
      // pile, not just the card directly beneath, because the lower levels
      // keep their skills. See levelUp() in match.ts. Without them an ability
      // that levels a character up quietly swallows both.
      const zone: EffectZone = slot.position === "leader" ? "leader" : "back";
      fireHere(state, "enter", picked, board.playerId, zone, cursor, log);
      for (const card of beneath) {
        fireHere(state, "levelUp", card, board.playerId, zone, cursor, log);
      }
      return true;
    },
    switchLeaderTo(characterName, playerId) {
      const board = boardOf(playerId);
      // A card can forbid switching for the turn (SD02-010's [Counter]). That
      // restriction has to bite here too, not only on the manual Action-Phase
      // switch: most in-game switches during Judgement/Combo run through this
      // effect path, and honouring the flag only in the manual path let them
      // slip past. "This turn" means the flag holds regardless of phase.
      if ((state.turnLog.flags[board.playerId] ?? []).includes("noLeaderSwitch")) {
        log.push(LOG.restrictionBlocksSwitch(board.playerId));
        return [];
      }
      const at = board.back.findIndex((slot) => slot.card.name === characterName);
      if (at < 0) {
        // Already leading is the common case — half these abilities read
        // "switch your Leader to X" on a card X is printed on, so they are
        // offered while X is in front. Nothing happens, and nothing is worth
        // saying about it; only a genuinely absent character is.
        const leading = board.leader?.card.name === characterName;
        if (!leading) log.push(LOG.notInPlayToSwitch(characterName));
        return [];
      }
      const incoming = board.back[at];
      const outgoing = board.leader;
      board.leader = { ...incoming, position: "leader" };
      if (outgoing) board.back[at] = { ...outgoing, position: "back" };
      else board.back.splice(at, 1);
      log.push(LOG.switchesLeader(board.playerId, characterName));
      return fireSwitched(board.playerId, incoming, outgoing);
    },

    trashToConcerto(count, filter, playerId) {
      const board = boardOf(playerId);
      const moved = lift(
        board.trash,
        pickFrom(
          board.trash,
          count,
          filter,
          board.playerId,
          PROMPT.trashToConcerto(count),
          "trashToConcerto"
        )
      );
      board.competitionArea.push(...moved);
      if (moved.length > 0) {
        log.push(LOG.trashToConcerto(board.playerId, moved.length));
      }
    },
    concertoToTrash(count, filter, playerId) {
      const board = boardOf(playerId);
      const moved = lift(
        board.competitionArea,
        pickFrom(
          board.competitionArea,
          count,
          filter,
          board.playerId,
          PROMPT.concertoToTrash(count),
          "concertoToTrash"
        )
      );
      board.trash.push(...moved);
      if (moved.length > 0) log.push(LOG.concertoToTrash(board.playerId, moved.length));
    },
    toDeckBottom(cards, playerId) {
      const board = boardOf(playerId);
      // Lift each card out of wherever it currently is, so this never leaves a
      // duplicate behind in a hand or a trash pile.
      let moved = 0;
      for (const target of cards) {
        for (const pile of [board.hand, board.trash, board.competitionArea]) {
          const at = pile.findIndex((c) => c.id === target.id);
          if (at < 0) continue;
          board.actionDeck.push(...pile.splice(at, 1));
          moved += 1;
          break;
        }
      }
      if (moved > 0) log.push(LOG.toDeckBottom(board.playerId, moved));
    },
    spendCost(amount, playerId) {
      const board = boardOf(playerId);
      if (board.competitionArea.length < amount) return false;
      board.trash.push(...board.competitionArea.splice(0, amount));
      log.push(LOG.spendsConcerto(board.playerId, amount));
      return true;
    },
    searchDeck(filter, count, playerId) {
      const board = boardOf(playerId);
      // Searching means looking through the whole deck, so which copy comes
      // out is the searcher's call, not the first one the scan happens to
      // reach.
      const found = lift(
        board.actionDeck,
        pickFrom(board.actionDeck, count, filter, board.playerId, PROMPT.searchDeck(count), "searchDeck")
      );
      board.hand.push(...found);
      // Searching exposes the deck order, so it is shuffled afterwards.
      board.actionDeck = shuffleWithState(state, board.actionDeck);
      log.push(LOG.searchesDeck(board.playerId, found.length));
      return found;
    },
    shuffleDeck(playerId) {
      const board = boardOf(playerId);
      board.actionDeck = shuffleWithState(state, board.actionDeck);
      log.push(LOG.shuffles(board.playerId));
    },
    randomFromHand(playerId) {
      const board = boardOf(playerId);
      if (board.hand.length === 0) return null;
      return board.hand[nextRandom(state, board.hand.length)];
    },
    revealHand(playerId) {
      const target = playerId ?? controllerId;
      if (!state.revealedHands.includes(target)) state.revealedHands.push(target);
      log.push(LOG.revealsHand(target));
    },

    isTurnPlayer: (playerId) => state.turnPlayerId === (playerId ?? controllerId),
    isDefender: (playerId) => state.turnPlayerId !== (playerId ?? controllerId),
    leaderName(playerId) {
      const leader = boardOf(playerId).leader;
      if (!leader) return null;
      return getCard(leader.card.id)?.character ?? leader.card.name;
    },
    discardCards(cards, playerId) {
      const board = boardOf(playerId);
      let moved = 0;
      for (const target of cards) {
        const at = board.hand.findIndex((c) => c.id === target.id);
        if (at < 0) continue;
        board.trash.push(...board.hand.splice(at, 1));
        moved += 1;
      }
      if (moved > 0) log.push(LOG.discards(board.playerId, moved));
    },

    restrictNextTurn(flag, playerId) {
      const target = playerId ?? controllerId;
      const list = (state.pendingFlags[target] ??= []);
      if (!list.includes(flag)) list.push(flag);
      log.push(LOG.restrictedNextTurn(target, flag));
    },
    modifyDamageTaken(amount, playerId, duration: ModifierDuration = "turn", options = {}) {
      const target = playerId ?? controllerId;
      pushModifier({
        controllerId: target,
        sourceCardId: card.id,
        stat: "damageTaken",
        amount,
        filter: {},
        duration,
        ...(options.limit ? { limit: options.limit } : {}),
      });
      log.push(LOG.damageTakenChange(target, amount, duration));
    },
    log: (message) => log.push({ th: message, en: message }),

    confirm(prompt, playerId) {
      return Boolean(
        ask(cursor, {
          kind: "confirm",
          playerId: playerId ?? controllerId,
          cardId: card.id,
          prompt,
          options: [],
          min: 1,
          max: 1,
        })
      );
    },
    chooseCard(prompt, from, options = {}) {
      if (from.length === 0) return null;
      const answer = ask(cursor, {
        kind: "pickCard",
        playerId: options.playerId ?? controllerId,
        cardId: card.id,
        prompt,
        options: from.map(cardOption),
        min: options.optional ? 0 : 1,
        max: 1,
      });
      const picked = Array.isArray(answer) ? answer[0] : answer;
      if (typeof picked !== "string") return null;
      return from[optionIndex(picked)] ?? null;
    },
    chooseCards(prompt, from, options = {}) {
      if (from.length === 0) return [];
      const answer = ask(cursor, {
        kind: "pickCard",
        playerId: options.playerId ?? controllerId,
        cardId: card.id,
        prompt,
        options: from.map(cardOption),
        min: options.min ?? 1,
        max: options.max ?? options.min ?? 1,
      });
      const picked = Array.isArray(answer) ? answer : [answer].filter((v) => typeof v === "string");
      // By position, so picking one of two identical cards takes that one and
      // leaves the other — matching by id would take the same card twice.
      const seen = new Set<number>();
      const chosen: ActionCard[] = [];
      for (const value of picked as string[]) {
        const at = optionIndex(value);
        if (seen.has(at) || !from[at]) continue;
        seen.add(at);
        chosen.push(from[at]);
      }
      return chosen;
    },
    chooseOption(prompt, options, playerId) {
      const answer = ask(cursor, {
        kind: "pickOption",
        playerId: playerId ?? controllerId,
        cardId: card.id,
        prompt,
        options,
        min: 1,
        max: 1,
      });
      return typeof answer === "string" ? answer : String(answer);
    },
  };
}

/**
 * One card as something to pick.
 *
 * The answer is the card's POSITION in the list offered, not its number: a
 * trash pile holds four copies of the same card, and an answer of "BP01-044"
 * would name all four at once — which is how picking one of them came to
 * light up every copy on screen. `cardId` carries the number for the art.
 */
function cardOption(card: ActionCard, index: number): ChoiceOption {
  return { value: `${index}:${card.id}`, cardId: card.id, label: { en: card.name, th: card.name } };
}

/** The position an option's value points at, or -1 if it names none. */
function optionIndex(value: string): number {
  const at = Number.parseInt(value, 10);
  return Number.isNaN(at) ? -1 : at;
}

/**
 * Returns the answer already given for this question, or suspends the effect
 * so the engine can go and ask it. Questions are matched to answers purely by
 * the order they are asked in, which is why a resolve must ask the same
 * questions in the same order every time it runs.
 */
function ask(cursor: AnswerCursor, choice: PendingChoice): ChoiceAnswer {
  if (cursor.next < cursor.answers.length) {
    return cursor.answers[cursor.next++];
  }
  throw new NeedsChoice(choice);
}

/**
 * Raises a trigger for one character, from inside an effect that is itself
 * still running.
 *
 * The result is written back into the state the caller is holding rather
 * than returned (see adoptState), and a question raised down there is
 * rethrown so it rewinds the whole outer effect and replays once the answer
 * is in — the same rewind every other question gets.
 */
function fireHere(
  state: MatchState,
  trigger: EffectTrigger,
  card: { id: string },
  controllerId: string,
  zone: EffectZone,
  cursor: AnswerCursor,
  log: LogLine[]
): void {
  const definition = getCard(card.id);
  if (!definition) return;
  const result = resolveTriggerWith(
    state,
    trigger,
    [{ card: definition, controllerId, zone }],
    cursor
  );
  adoptState(state, result.state);
  for (const entry of result.resolved) log.push(...entry.log);
  if (result.pending) throw new NeedsChoice(result.pending);
}

/**
 * Overwrites one state with another, in place.
 *
 * Resolution normally hands a new board back and the caller takes it. An
 * effect cannot: it is handed one state object to mutate and its caller is
 * holding that same object, so a trigger raised from inside an effect —
 * [Level up], via ctx.levelUpCharacter — has to write its result back into
 * it rather than return one. Every ctx helper reads through `state` on each
 * call, so replacing the contents is enough; nothing caches a board.
 */
function adoptState(target: MatchState, next: MatchState): void {
  const holder = target as unknown as Record<string, unknown>;
  // Emptied first, not just assigned over: a key the trigger deleted has to
  // be gone here too, and Object.assign alone would leave the old one.
  for (const key of Object.keys(holder)) delete holder[key];
  Object.assign(holder, next);
}

// --- Conditions ------------------------------------------------------------

/**
 * Checks everything in a condition list other than the trigger itself: the
 * condition keywords the engine knows, plus any custom check functions the
 * card supplied. Returns null when the effect may run, or the reason it may
 * not.
 */
export function conditionBlocking(
  condition: Condition[],
  ctx: EffectContext,
  zone: EffectZone
): string | null {
  const keywords = keywordsOf(condition);

  // [Advantage] is a status carried INTO the turn, not "did I just win": a
  // battle won this turn only starts paying out next turn. ctx.hasAdvantage()
  // reads the turn's snapshot for exactly that reason — wonLastBattle() would
  // already be true by the time [Judgement] and the Combo Step run, handing
  // the winner their Advantage several steps early.
  if (keywords.includes("advantage") && !ctx.hasAdvantage()) {
    return "Advantage: did not hold Advantage coming into this turn";
  }
  // [Leader] reads differently depending on what it is printed on.
  //
  // On a character card it means "while this card is the active Leader", so
  // the card has to be sitting in the Leader slot.
  //
  // On an action card it is printed [Leader Skill] and means "while the
  // character this card belongs to is your Leader" — the card itself is in
  // the Action Area, never the Leader slot, so requiring that would switch
  // every one of these off.
  if (keywords.includes("leader")) {
    if (ctx.self.type === "leader") {
      if (zone !== "leader") return "Leader: this card is not the active leader";
    } else if (!ctx.self.character) {
      // This should be rejected during card validation, but effects may be
      // built in a test or by a future import path. Do not silently let a
      // characterless action impersonate a Leader Skill.
      return "Leader Skill: this action has no character owner";
    } else if (ctx.leaderName() !== ctx.self.character) {
      return `Leader Skill: ${ctx.self.character} is not your active Leader`;
    }
  }
  for (const entry of condition) {
    if (typeof entry === "function" && !entry(ctx)) {
      return "a condition on this card was not met";
    }
  }
  return null;
}

// --- Resolution ------------------------------------------------------------

function runEffect(
  effect: CardEffect,
  state: MatchState,
  source: EffectSource,
  derived: boolean,
  cursor: AnswerCursor = { answers: [], next: 0 }
): { state: MatchState; entry: ResolvedEffect; pending?: PendingChoice } {
  const base = {
    cardId: source.card.id,
    controllerId: source.controllerId,
    effect,
  };
  const log: LogLine[] = [];
  const before = structuredClone(state);
  const ctx = createContext(state, source.card, source.controllerId, log, derived, cursor, effect);

  const blocked = conditionBlocking(effect.condition, ctx, source.zone);
  if (blocked) {
    return { state: before, entry: { ...base, status: "skipped", reason: blocked, log: [] } };
  }

  if (isManual(effect)) {
    return {
      state: before,
      entry: {
        ...base,
        status: "manual",
        reason: "no resolve written — players apply the printed text",
        log: [],
      },
    };
  }

  try {
    effect.resolve!(ctx);
    return { state, entry: { ...base, status: "applied", log } };
  } catch (error) {
    if (error instanceof NeedsChoice) {
      // Not a failure — the effect needs an answer. Rewind everything it did
      // so the board is untouched while the question is on screen.
      return {
        state: before,
        entry: { ...base, status: "awaiting", reason: error.message, log: [] },
        pending: error.choice,
      };
    }
    // Roll the whole effect back rather than leave it half-applied.
    return {
      state: before,
      entry: {
        ...base,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
        log: [],
      },
    };
  }
}

/**
 * Raises one trigger against a set of cards and runs whatever fires.
 *
 * An effect runs when its trigger matches and every other condition holds.
 * Without a `resolve` it comes back in `manual` for the players to apply.
 */
export function resolveTrigger(
  state: MatchState,
  trigger: EffectTrigger,
  sources: EffectSource[],
  /**
   * Answers to questions asked on earlier attempts, oldest first. Start with
   * none; each time the result comes back with `pending`, append the player's
   * answer and call again.
   */
  answers: ChoiceAnswer[] = []
): TriggerResult {
  return resolveTriggerWith(state, trigger, sources, makeCursor(answers));
}

/**
 * resolveTrigger, but reading from a cursor the caller owns. Use this when
 * several triggers resolve as one replayable unit and their questions have to
 * share a single answer list.
 */
export function resolveTriggerWith(
  state: MatchState,
  trigger: EffectTrigger,
  sources: EffectSource[],
  cursor: AnswerCursor
): TriggerResult {
  let working: MatchState = structuredClone(state);
  const resolved: ResolvedEffect[] = [];

  for (const source of sources) {
    const firing = [
      ...effectsForTrigger(source.card, trigger),
      ...(source.granted ?? []).filter((effect) =>
        triggersOf(effect.condition).includes(trigger)
      ),
    ];
    for (const effect of firing) {
      const result = runEffect(effect, working, source, false, cursor);
      working = result.state;
      resolved.push(result.entry);

      if (result.pending) {
        // Stop here. Everything before this effect stands; this effect was
        // rewound. Answer and call again to replay the whole run.
        return {
          state: working,
          resolved,
          manual: resolved.filter((entry) => entry.status === "manual"),
          pending: result.pending,
        };
      }
    }
  }

  return {
    state: working,
    resolved,
    manual: resolved.filter((entry) => entry.status === "manual"),
    pending: null,
  };
}

// --- Continuous effects ----------------------------------------------------
//
// A passive is not an event, so it is never "run" the way a trigger is.
// Running it on a schedule would double-apply it; running it once would let
// it go stale when the board changes under it. Instead every modifier a
// continuous effect produces is marked `derived`, and recomputeContinuous
// throws all of those away and rebuilds them from the current board. That
// makes it safe to call after any state change, as many times as you like.

export interface ContinuousResult {
  state: MatchState;
  manual: ResolvedEffect[];
  log: LogLine[];
}

/**
 * Rebuilds every always-on effect from the board as it stands right now.
 * Call it after anything that could change the answer: a card entering or
 * leaving play, a level up, a switch, the start of a phase.
 */
export function recomputeContinuous(
  state: MatchState,
  resolve: (cardId: string) => CardDef | undefined = getCard
): ContinuousResult {
  let working = structuredClone(state);
  // Everything a continuous effect produced is thrown away and rebuilt, which
  // is what makes this safe to call as often as we like.
  working.statModifiers = working.statModifiers.filter((modifier) => !modifier.derived);
  working.grantedEffects = working.grantedEffects.filter((granted) => !granted.derived);
  working.zoneLimits = working.zoneLimits.filter((limit) => !limit.derived);

  const manual: ResolvedEffect[] = [];
  const log: LogLine[] = [];

  for (const [playerId, board] of Object.entries(working.boards)) {
    // Action cards carry passives too — "〈Echo〉 is capped at 1 on the Action
    // Area", "while your Life is higher, this card gets +1". Which zone they
    // have to be in varies by card, so every zone an action card can sit in
    // is offered and the card's own condition decides.
    const loose: { card: ActionCard; zone: EffectZone }[] = [
      ...(working.actionZone[playerId] ?? []).map((card) => ({ card, zone: "actionZone" as const })),
      ...board.competitionArea.map((card) => ({ card, zone: "concerto" as const })),
      ...board.hand.map((card) => ({ card, zone: "hand" as const })),
    ];
    for (const { card: runtime, zone } of loose) {
      const card = resolve(runtime.id);
      if (!card) continue;
      for (const effect of effectsForContinuous(card, "passive")) {
        const result = runEffect(effect, working, { card, controllerId: playerId, zone }, true);
        working = result.state;
        log.push(...result.entry.log);
        if (result.entry.status === "manual") manual.push(result.entry);
      }
    }

    for (const slot of [board.leader, ...board.back]) {
      if (!slot) continue;
      // EVERY card in the pile is live, not just the top one. Levelling a
      // character up adds an ability, it does not replace the one underneath,
      // so a Level 2 Leader is running its Level 0 and Level 1 skills too.
      for (const inPlay of characterStack(slot)) {
        const card = resolve(inPlay.id);
        if (!card) continue;

        // "passive" applies wherever the card is; "leader" only to the active
        // leader. A card can carry both.
        const kinds: ContinuousKeyword[] =
          slot.position === "leader" ? ["passive", "leader"] : ["passive"];

        for (const kind of kinds) {
          for (const effect of effectsForContinuous(card, kind)) {
            const source: EffectSource = {
              card,
              controllerId: playerId,
              zone: slot.position === "leader" ? "leader" : "back",
            };
            const result = runEffect(effect, working, source, true);
            working = result.state;
            log.push(...result.entry.log);
            if (result.entry.status === "manual") manual.push(result.entry);
          }
        }
      }
    }
  }

  return { state: working, manual, log };
}

/**
 * Builds the source list for a trigger from what is on the board — every
 * character in play. Continuous effects do not go through here.
 */
export function sourcesInPlay(
  state: MatchState,
  trigger: EffectTrigger,
  resolve: (cardId: string) => CardDef | undefined = getCard
): EffectSource[] {
  const sources: EffectSource[] = [];
  // Turn player first, then the other — the order the rules resolve skills in
  // ("ターンプレイヤー→非ターンプレイヤーの順"). See sourcesOnBoard in match.ts,
  // which orders the same way.
  const order = [
    state.turnPlayerId,
    ...Object.keys(state.boards).filter((id) => id !== state.turnPlayerId),
  ];
  for (const playerId of order) {
    const board = state.boards[playerId];
    if (!board) continue;
    void trigger;
    for (const slot of [board.leader, ...board.back]) {
      if (!slot) continue;
      // Every level in the pile answers, not just the top — see
      // recomputeContinuous for why.
      for (const inPlay of characterStack(slot)) {
        const definition = resolve(inPlay.id);
        if (!definition) continue;
        sources.push({
          card: definition,
          controllerId: playerId,
          zone: slot.position === "leader" ? "leader" : "back",
        });
      }
    }
  }
  return sources;
}

/**
 * Drops modifiers that have run out. Call with "battle" after each battle is
 * judged and "turn" at end of turn. "whileActive" modifiers are dropped once
 * the card that granted them is no longer in play.
 */
export function expireModifiers(state: MatchState, moment: "battle" | "turn"): MatchState {
  const inPlay = new Set<string>();
  for (const board of Object.values(state.boards)) {
    for (const slot of [board.leader, ...board.back]) {
      if (!slot) continue;
      // EVERY level in the pile counts as in play, not just the top card.
      // Levelling a character up covers the lower level, it does not take it
      // off the field — so a whileActive modifier or granted effect sourced
      // from a covered Level 1 card must survive being levelled up to Level
      // 2. Reading only slot.card.id here expired those the moment the
      // character levelled, which killed the lower level's ability. This
      // matches how recomputeContinuous and sourcesInPlay walk the stack.
      for (const inPile of characterStack(slot)) inPlay.add(inPile.id);
    }
  }

  const alive = (duration: ModifierDuration, sourceCardId: string): boolean => {
    if (duration === "permanent") return true;
    if (duration === "whileActive") return inPlay.has(sourceCardId);
    if (duration === "battle") return false;
    // "nextTurn" survives this sweep and becomes an ordinary turn modifier —
    // see the age() below, which is what actually demotes it.
    if (duration === "nextTurn") return true;
    return moment !== "turn";
  };
  const age = <T extends { duration: ModifierDuration }>(entry: T): T =>
    moment === "turn" && entry.duration === "nextTurn" ? { ...entry, duration: "turn" } : entry;

  const next = structuredClone(state);
  next.statModifiers = state.statModifiers
    .filter((m) => alive(m.duration, m.sourceCardId))
    .map(age);
  next.grantedEffects = state.grantedEffects
    .filter((g) => alive(g.duration, g.sourceCardId))
    .map(age);
  next.zoneLimits = next.zoneLimits.filter((limit) => inPlay.has(limit.sourceCardId));
  // A revealed hand stays face-up only for the turn it was revealed in.
  if (moment === "turn") next.revealedHands = [];
  return next;
}

/**
 * The modifiers that actually reach a given card right now.
 *
 * A modifier carrying a `limit` only applies to the first N matching cards
 * its controller played this turn, so whether it reaches THIS card depends on
 * where the card sits in the turn log. Everything else passes straight
 * through.
 */
export function qualifyingModifiers(
  state: MatchState,
  card: ActionCard,
  ownerId: string
): StatModifier[] {
  const filterable = filterableFor(card);
  return state.statModifiers.filter((modifier) => {
    if (modifier.limit === undefined) return true;
    if (!appliesTo(modifier, filterable, ownerId)) return true; // it misses anyway

    const played = state.turnLog.cardsPlayed[modifier.controllerId] ?? [];
    const matching = played.filter((c) => matchesFilter(filterableFor(c), modifier.filter));
    const position = matching.findIndex((c) => c.id === card.id);
    // Not played yet: it will be the next match, so it still qualifies.
    if (position < 0) return matching.length < modifier.limit;
    return position < modifier.limit;
  });
}

/** Abilities granted to a card, resolved the same way modifiers are. */
export function grantedFor(state: MatchState, card: ActionCard, ownerId: string): CardEffect[] {
  const filterable = filterableFor(card);
  return state.grantedEffects
    .filter((granted) => {
      const side = granted.filter.side ?? "self";
      const owned = ownerId === granted.controllerId;
      if (side === "self" && !owned) return false;
      if (side === "opponent" && owned) return false;
      if (!matchesFilter(filterable, granted.filter)) return false;
      if (granted.limit === undefined) return true;
      const played = state.turnLog.cardsPlayed[granted.controllerId] ?? [];
      const matching = played.filter((c) => matchesFilter(filterableFor(c), granted.filter));
      const position = matching.findIndex((c) => c.id === card.id);
      if (position < 0) return matching.length < granted.limit;
      return position < granted.limit;
    })
    .map((granted) => getCard(granted.sourceCardId)?.grants?.[granted.effectKey])
    .filter((effect): effect is CardEffect => effect !== undefined);
}

/** The cost a card actually asks for, after any modifier that changes it. */
export function effectiveCost(state: MatchState, card: ActionCard, ownerId: string): number {
  return effectiveStats(
    { ...filterableFor(card), attack: card.damage, speed: card.speed, cost: card.cost },
    ownerId,
    qualifyingModifiers(state, card, ownerId)
  ).cost;
}

/**
 * Why a card may not be laid into the Action Area right now, or null when it
 * may. Covers the printed caps ("〈Echo〉 up to 1 on the Action Area") and
 * cards that may only arrive via an ability.
 */
export function zoneBlocking(
  state: MatchState,
  card: ActionCard,
  playerId: string
): string | null {
  const filterable = filterableFor(card);
  const zone = state.actionZone[playerId] ?? [];
  for (const limit of state.zoneLimits) {
    if (limit.controllerId !== playerId) continue;
    if (!matchesFilter(filterable, limit.filter)) continue;
    const already = zone.filter((c) => matchesFilter(filterableFor(c), limit.filter)).length;
    if (already >= limit.max) {
      return `${describeFilter(limit.filter)} is capped at ${limit.max} in the Action Area`;
    }
  }
  return null;
}

/** Extra damage a player takes from active [damageTaken] modifiers. */
export function damageTakenModifier(state: MatchState, playerId: string): number {
  const hits = state.turnLog.hitsTaken[playerId] ?? 0;
  return state.statModifiers
    .filter((modifier) => {
      if (modifier.stat !== "damageTaken" || modifier.controllerId !== playerId) return false;
      // `limit` on a damage-taken modifier counts HITS, not cards: "each
      // round, damage taken -1" softens one hit and is then spent, however
      // many more land afterwards.
      return modifier.limit === undefined || hits < modifier.limit;
    })
    .reduce((sum, modifier) => sum + modifier.amount, 0);
}

/**
 * The combo lookup to hand to resolveCombat so it applies the real rule: a
 * red win allows unlimited follow-ups, any other colour only what its own
 * Follow{x} grants.
 */
export function comboLookupFromDb(
  resolve: (cardId: string) => CardDef | undefined = getCard
): (card: ActionCard) => ComboGrant {
  return (card) => {
    const definition = resolve(card.id);
    if (!definition) {
      return card.color === "red"
        ? { unlimited: true, count: Infinity }
        : { unlimited: false, count: 0 };
    }
    return comboGrantFor(definition);
  };
}

/** Cards in play whose text still needs a human for a given trigger. */
export function pendingManualCards(state: MatchState, trigger: EffectTrigger): string[] {
  return sourcesInPlay(state, trigger)
    .filter((source) => effectsForTrigger(source.card, trigger).some(isManual))
    .map((source) => source.card.id);
}

export { triggerOf, continuousOf };
