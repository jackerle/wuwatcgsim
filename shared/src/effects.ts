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
  type Condition,
  type EffectContext,
  type PendingChoice,
} from "./cardDef";
import type { CardKeyword, ContinuousKeyword, EffectTrigger } from "./cards";
import { getCard } from "./cardDb";
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
  log: string[];
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

function createContext(
  state: MatchState,
  card: CardDef,
  controllerId: string,
  log: string[],
  /** Set while recomputing continuous effects — see recomputeContinuous. */
  derived = false,
  cursor: AnswerCursor = { answers: [], next: 0 }
): EffectContext {
  const opponentId = Object.keys(state.boards).find((id) => id !== controllerId) ?? "";
  const boardOf = (playerId?: string): PlayerBoard => {
    const board = state.boards[playerId ?? controllerId];
    if (!board) throw new Error(`No board for player "${playerId ?? controllerId}"`);
    return board;
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
    wonWith: (color) =>
      state.lastBattle?.winnerId === controllerId &&
      state.lastBattle.colorByPlayer[controllerId] === color,
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
    selfPlayedThisTurn: (playerId) =>
      (state.turnLog.cardsPlayed[playerId ?? controllerId] ?? []).some((c) => c.id === card.id),
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
      log.push(`${target} restricted this turn: ${flag}`);
    },
    isRestricted: (flag, playerId) =>
      (state.turnLog.flags[playerId ?? controllerId] ?? []).includes(flag),

    draw(count, playerId) {
      const board = boardOf(playerId);
      const drawn = board.actionDeck.splice(0, count);
      board.hand.push(...drawn);
      log.push(`${board.playerId} draws ${drawn.length}`);
    },
    damage(amount, targetId) {
      const board = boardOf(targetId ?? opponentId);
      board.life -= amount;
      const seen = state.turnLog.damageTaken[board.playerId] ?? 0;
      state.turnLog.damageTaken[board.playerId] = seen + amount;
      log.push(`${board.playerId} takes ${amount} from ${card.name} [${card.id}] (life ${board.life})`);
    },
    heal(amount, playerId) {
      const board = boardOf(playerId);
      board.life += amount;
      const seen = state.turnLog.healed[board.playerId] ?? 0;
      state.turnLog.healed[board.playerId] = seen + amount;
      log.push(`${board.playerId} heals ${amount} from ${card.name} [${card.id}] (life ${board.life})`);
    },
    discard(count, playerId) {
      const board = boardOf(playerId);
      const moved = board.hand.splice(0, count);
      board.trash.push(...moved);
      log.push(`${board.playerId} discards ${moved.length}`);
    },
    charge(count, playerId) {
      const board = boardOf(playerId);
      const moved = board.hand.splice(0, count);
      board.competitionArea.push(...moved);
      log.push(`${board.playerId} charges ${moved.length}`);
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
        log.push(`${card.id} is not on the field — nothing to return`);
        return;
      }

      if (slot.card.id === card.id) {
        const beneath = slot.under.pop();
        board.characterPool.push(slot.card);
        if (beneath) {
          slot.card = beneath;
          log.push(`${card.id} returns to the Character Deck; ${beneath.id} is exposed underneath`);
          return;
        }
        // Nothing underneath: the character leaves the field entirely.
        if (board.leader === slot) board.leader = null;
        else board.back = board.back.filter((entry) => entry !== slot);
        log.push(`${card.id} returns to the Character Deck, leaving the slot empty`);
        return;
      }

      // Buried in the pile: pull just that card out, the rest closes up.
      const at = slot.under.findIndex((c) => c.id === card.id);
      board.characterPool.push(...slot.under.splice(at, 1));
      log.push(`${card.id} returns to the Character Deck from under the pile`);
    },
    switchLeader(toCardId, playerId) {
      const board = boardOf(playerId);
      const index = toCardId
        ? board.back.findIndex((slot) => slot.card.id === toCardId)
        : 0;
      if (index < 0 || !board.back[index]) {
        log.push("no back character to switch with");
        return;
      }
      const incoming = board.back[index];
      const outgoing = board.leader;
      // Whole pile, not just the top card — see CharacterInstance.under.
      board.leader = { ...incoming, position: "leader" };
      if (outgoing) board.back[index] = { ...outgoing, position: "back" };
      else board.back.splice(index, 1);
      log.push(`${board.playerId} switches leader to ${incoming.card.id}`);
    },
    revealTop(count, playerId) {
      const board = boardOf(playerId);
      const revealed = board.actionDeck.slice(0, count);
      log.push(`${board.playerId} reveals ${revealed.length} from the top`);
      return revealed;
    },
    topToConcerto(count, playerId) {
      const board = boardOf(playerId);
      const moved = board.actionDeck.splice(0, count);
      board.competitionArea.push(...moved);
      log.push(`${board.playerId} puts ${moved.length} from the deck into the Concerto area`);
    },
    deckToHand(count, playerId) {
      const board = boardOf(playerId);
      const moved = board.actionDeck.splice(0, count);
      board.hand.push(...moved);
      log.push(`${board.playerId} takes ${moved.length} from the top of the deck`);
      return moved;
    },
    deckToTrash(count, playerId) {
      const board = boardOf(playerId);
      const moved = board.actionDeck.splice(0, count);
      board.trash.push(...moved);
      log.push(`${board.playerId} bins ${moved.length} from the top of the deck`);
      return moved;
    },
    trashToHand(count, filter, playerId) {
      const board = boardOf(playerId);
      let taken = 0;
      for (let i = board.trash.length - 1; i >= 0 && taken < count; i -= 1) {
        const candidate = board.trash[i];
        if (filter && !matchesFilter(filterableFor(candidate), filter)) continue;
        board.hand.push(candidate);
        board.trash.splice(i, 1);
        taken += 1;
      }
      // Silent when nothing matched — an ability that found no target should
      // not leave a line in the battle log claiming it did something.
      if (taken > 0) {
        log.push(`${board.playerId} returns ${taken} card(s) from the trash to hand`);
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
      log.push(`${describeFilter(filter)} ${stat} ${amount >= 0 ? "+" : ""}${amount} (${duration})`);
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
      log.push(`${describeFilter(filter)} ${stat} = ${value} (${duration})`);
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
      log.push(`${describeFilter(filter)} gains an ability (${duration})`);
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
      const target = playerId ?? controllerId;
      const window = state.combo;
      if (window && window.playerId === target) {
        if (!window.unlimited) window.remaining += count;
      } else {
        // Nothing open yet: these fire on [Judgement], which lands before the
        // Combo Step has a window set up.
        state.combo = { playerId: target, unlimited: false, remaining: count };
      }
      log.push(`${target} gains ${count} follow-up attack(s)`);
    },
    returnToHand() {
      const board = boardOf();
      const zone = state.actionZone[controllerId] ?? [];
      const at = zone.findIndex((c) => c.id === card.id);
      if (at < 0) {
        log.push(`${card.id} is not in the Action Area`);
        return;
      }
      board.hand.push(...zone.splice(at, 1));
      log.push(`${card.id} returns to hand`);
    },

    levelUpCharacter(characterName, playerId) {
      const board = boardOf(playerId);
      const slot = [board.leader, ...board.back].find(
        (entry) => entry?.card.name === characterName
      );
      if (!slot) {
        log.push(`${characterName} is not in play`);
        return false;
      }
      // Lowest legal card first, so an effect never burns a Level 2 when a
      // Level 1 would have done. Levelling moves one step at a time, same as
      // the Action Phase move — see canLevelUpOnto.
      const candidates = board.characterPool
        .map((c, index) => ({ c, index }))
        .filter(
          ({ c }) =>
            c.name === characterName &&
            c.level > 0 &&
            c.level >= slot.card.level &&
            c.level <= slot.card.level + 1
        )
        .sort((a, b) => a.c.level - b.c.level);
      if (candidates.length === 0) {
        log.push(`no Level Up card left for ${characterName}`);
        return false;
      }
      const [picked] = board.characterPool.splice(candidates[0].index, 1);
      slot.under.push(slot.card);
      slot.card = picked;
      log.push(`${board.playerId} levels ${characterName} up to ${picked.level}`);
      return true;
    },
    switchLeaderTo(characterName, playerId) {
      const board = boardOf(playerId);
      const at = board.back.findIndex((slot) => slot.card.name === characterName);
      if (at < 0) {
        log.push(`${characterName} is not a back character`);
        return false;
      }
      const incoming = board.back[at];
      const outgoing = board.leader;
      board.leader = { ...incoming, position: "leader" };
      if (outgoing) board.back[at] = { ...outgoing, position: "back" };
      else board.back.splice(at, 1);
      log.push(`${board.playerId} switches Leader to ${characterName}`);
      return true;
    },

    trashToConcerto(count, filter, playerId) {
      const board = boardOf(playerId);
      let taken = 0;
      for (let i = board.trash.length - 1; i >= 0 && taken < count; i -= 1) {
        if (filter && !matchesFilter(filterableFor(board.trash[i]), filter)) continue;
        board.competitionArea.push(...board.trash.splice(i, 1));
        taken += 1;
      }
      if (taken > 0) {
        log.push(`${board.playerId} moves ${taken} from the trash to the Concerto area`);
      }
    },
    concertoToTrash(count, filter, playerId) {
      const board = boardOf(playerId);
      let taken = 0;
      for (let i = board.competitionArea.length - 1; i >= 0 && taken < count; i -= 1) {
        if (filter && !matchesFilter(filterableFor(board.competitionArea[i]), filter)) continue;
        board.trash.push(...board.competitionArea.splice(i, 1));
        taken += 1;
      }
      if (taken > 0) log.push(`${board.playerId} bins ${taken} from the Concerto area`);
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
      if (moved > 0) log.push(`${moved} card(s) go under the deck of ${board.playerId}`);
    },
    spendCost(amount, playerId) {
      const board = boardOf(playerId);
      if (board.competitionArea.length < amount) return false;
      board.trash.push(...board.competitionArea.splice(0, amount));
      log.push(`${board.playerId} spends ${amount} from the Concerto area`);
      return true;
    },
    searchDeck(filter, count, playerId) {
      const board = boardOf(playerId);
      const found: ActionCard[] = [];
      for (let i = 0; i < board.actionDeck.length && found.length < count; i += 1) {
        if (!matchesFilter(filterableFor(board.actionDeck[i]), filter)) continue;
        found.push(...board.actionDeck.splice(i, 1));
        i -= 1;
      }
      board.hand.push(...found);
      // Searching exposes the deck order, so it is shuffled afterwards.
      board.actionDeck = shuffleWithState(state, board.actionDeck);
      log.push(`${board.playerId} searches the deck and takes ${found.length}`);
      return found;
    },
    shuffleDeck(playerId) {
      const board = boardOf(playerId);
      board.actionDeck = shuffleWithState(state, board.actionDeck);
      log.push(`${board.playerId} shuffles their deck`);
    },
    randomFromHand(playerId) {
      const board = boardOf(playerId);
      if (board.hand.length === 0) return null;
      return board.hand[nextRandom(state, board.hand.length)];
    },
    revealHand(playerId) {
      const target = playerId ?? controllerId;
      if (!state.revealedHands.includes(target)) state.revealedHands.push(target);
      log.push(`${target} reveals their hand`);
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
      if (moved > 0) log.push(`${board.playerId} discards ${moved}`);
    },

    restrictNextTurn(flag, playerId) {
      const target = playerId ?? controllerId;
      const list = (state.pendingFlags[target] ??= []);
      if (!list.includes(flag)) list.push(flag);
      log.push(`${target} will be restricted next turn: ${flag}`);
    },
    modifyDamageTaken(amount, playerId, duration: ModifierDuration = "turn") {
      const target = playerId ?? controllerId;
      pushModifier({
        controllerId: target,
        sourceCardId: card.id,
        stat: "damageTaken",
        amount,
        filter: {},
        duration,
      });
      log.push(`${target} damage taken ${amount >= 0 ? "+" : ""}${amount} (${duration})`);
    },
    log: (message) => log.push(message),

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
        options: from.map((c) => ({ value: c.id, label: { en: c.name, th: c.name } })),
        min: options.optional ? 0 : 1,
        max: 1,
      });
      const picked = Array.isArray(answer) ? answer[0] : answer;
      if (typeof picked !== "string") return null;
      return from.find((c) => c.id === picked) ?? null;
    },
    chooseCards(prompt, from, options = {}) {
      if (from.length === 0) return [];
      const answer = ask(cursor, {
        kind: "pickCard",
        playerId: options.playerId ?? controllerId,
        cardId: card.id,
        prompt,
        options: from.map((c) => ({ value: c.id, label: { en: c.name, th: c.name } })),
        min: options.min ?? 1,
        max: options.max ?? options.min ?? 1,
      });
      const picked = Array.isArray(answer) ? answer : [answer].filter((v) => typeof v === "string");
      const remaining = [...from];
      const chosen: ActionCard[] = [];
      for (const id of picked as string[]) {
        const at = remaining.findIndex((c) => c.id === id);
        if (at >= 0) chosen.push(...remaining.splice(at, 1));
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

  if (keywords.includes("advantage") && !ctx.wonLastBattle()) {
    return "Advantage: did not win the last battle";
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
    } else if (ctx.self.character && ctx.leaderName() !== ctx.self.character) {
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
  const log: string[] = [];
  const before = structuredClone(state);
  const ctx = createContext(state, source.card, source.controllerId, log, derived, cursor);

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
  log: string[];
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
  const log: string[] = [];

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
      if (slot) inPlay.add(slot.card.id);
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
  return state.statModifiers
    .filter((modifier) => modifier.stat === "damageTaken" && modifier.controllerId === playerId)
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
