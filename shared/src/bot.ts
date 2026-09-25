// The bot: what a seat plays when nobody is sitting in it.
//
// Two rules shape everything below.
//
// **It is handed a view, never the match.** Every function here takes the
// filtered state a networked player would be sent (see `viewFor`), where the
// other hand is a row of blank backs. It cannot read the opponent's cards
// because it was never given them, not because it promises not to look — and
// `test-bot.ts` holds that boundary by shuffling the opponent's hand behind
// its back and checking the move it picks never changes.
//
// **It knows no rules.** Which moves exist comes from `legalIntents`, what a
// card costs from `whyUnplayable`, who wins a clash from `resolveCombat` —
// the engine's own functions, the same ones the UI calls. A bot carrying its
// own copy of any of that would be a second rulebook, and the first thing to
// drift when a card changes.
//
// What it does bring is preferences, and they are all in one place: `worth()`
// prices a card as the clash it would be laid down in, and every other
// decision — what to mulligan, what to charge away, what to discard for a
// Level Up, which option to take when a card asks — is that same number read
// in one direction or the other.
//
// That number only sees what is printed in figures. What a card's text does
// — its [Judgement], its Leader Skill — this file cannot price, and so does
// not try: botSearch.ts plays the moves out through the engine and reorders
// this file's list by what actually happened. This file is the fast half,
// and the policy both players follow inside those playouts.

import { ALL_CARDS, getCard } from "./cardDb";
import { isActionCard, keywordsOf, type ChoiceAnswer, type ChoiceOption, type PendingChoice } from "./cardDef";
import { MAX_COPIES_PER_CARD, cardPoolFor } from "./deckList";
import { toActionCard } from "./decks";
import {
  characterStack,
  isHiddenCard,
  resolveCombat,
  type ActionCard,
  type CardColor,
  type CharacterInstance,
  type MatchState,
  type PlayerBoard,
} from "./game";
import {
  canChooseLeader,
  canCommit,
  canMulligan,
  canPassCounter,
  legalIntents,
  levelUpOptions,
  opponentOf,
  whyUnplayable,
  type MatchIntent,
} from "./match";
import { levelUpCost } from "./rules";
import type { Seat } from "./types";

/**
 * What one card in hand is worth, in Life.
 *
 * Every clash costs the card laid down, so a move has to beat doing nothing
 * by at least this much to be worth making.
 */
const CARD_IN_HAND = 0.6;

/** Below this, a card in the opening hand is not worth keeping. */
const MULLIGAN_KEEP = 0.9;

/**
 * How far below the deck's average a card has to be before it is swapped for
 * a fresh draw. A swap is a gamble, so a card only a little worse stays.
 */
const MULLIGAN_MARGIN = 0.5;

/** Never put the whole hand back: a fresh five can be worse than this one. */
const MULLIGAN_MAX = 3;

/**
 * How much charged energy to sit on.
 *
 * Charging costs a card from hand and one of the turn's actions, and pays for
 * one expensive card later. So the answer depends on the deck: enough to pay
 * for most of what it holds — the hand and what is still to be drawn — and no
 * more. A deck of cost 0 and 1 cards has little use for a pile of Concerto;
 * one built around cost 3 cards has to save up for them.
 */
function concertoTarget(board: PlayerBoard): number {
  const costs = [...board.hand, ...board.actionDeck].map((card) => card.cost).sort((a, b) => a - b);
  if (costs.length === 0) return 1;
  // "Most": the cost that four cards in five come in at or under.
  return Math.max(1, Math.min(3, costs[Math.floor((costs.length - 1) * 0.8)]));
}

/**
 * A Leader Skill card in hand, counted towards switching to its character:
 * one card the switch makes playable is worth about one level.
 */
const SWITCH_PER_CARD = 2;

/** How much better the new Leader has to be to spend the turn's Switch on. */
const SWITCH_MARGIN = 1;

/** Keep at least this many cards back when spending hand on a Level Up. */
const KEEP_IN_HAND = 1;

// --- What the opponent is likely to be holding -----------------------------

/**
 * A stand-in opponent card per colour, at the printed pool's average stats.
 *
 * Public knowledge, not a peek: anyone can read the card list. This is what
 * the bot falls back on before the opponent has shown it anything — without
 * it a first clash would be a guess with no shape at all, and in a pool this
 * lopsided (far more red cards than anything else) "assume red" is most of a
 * read.
 */
const GENERIC_FOE: { card: ActionCard; weight: number }[] = (() => {
  const pool = ALL_CARDS.filter(isActionCard);
  const colors: CardColor[] = ["red", "green", "blue"];
  const out: { card: ActionCard; weight: number }[] = [];
  for (const color of colors) {
    const of = pool.filter((card) => card.color === color);
    if (of.length === 0) continue;
    const mean = (pick: (card: (typeof of)[number]) => number) =>
      of.reduce((sum, card) => sum + pick(card), 0) / of.length;
    out.push({
      weight: of.length / pool.length,
      card: {
        id: `generic-${color}`,
        name: color,
        color,
        cost: 0,
        damage: mean((card) => card.attack),
        speed: mean((card) => card.speed ?? 0),
        imageId: "",
      },
    });
  }
  return out;
})();

/**
 * The characters a player brought, read off their side of the table.
 *
 * Public: the characters in play are face up, and so is the rest of the
 * Character Deck waiting to be levelled up. Only during Leader Select and the
 * mulligan are the three on the field turned down — the pool still gives them
 * away, since every character brings more than one card to it.
 */
function charactersOf(board: PlayerBoard): string[] {
  const names = new Set<string>();
  const cards = [
    ...[board.leader, ...board.back].flatMap((slot) => (slot ? characterStack(slot) : [])),
    ...board.characterPool,
  ];
  for (const card of cards) {
    if (isHiddenCard(card)) continue;
    const name = getCard(card.id)?.character;
    if (name) names.add(name);
  }
  return [...names];
}

/** Every action card of this player's that is face up somewhere on the table. */
function shownCards(view: MatchState, playerId: string): ActionCard[] {
  const board = view.boards[playerId];
  if (!board) return [];
  const facedown = view.facedown[playerId];
  return [
    ...board.trash,
    ...board.competitionArea,
    ...(view.actionZone[playerId] ?? []),
    ...board.hand,
    ...(facedown ? [facedown] : []),
    ...(view.reveals ?? []).filter((entry) => entry.playerId === playerId).flatMap((entry) => entry.cards),
  ].filter((card) => !isHiddenCard(card));
}

/**
 * What could still be in the opponent's deck and hand, weighted.
 *
 * Built the way a player at the table would build it. A deck can only hold
 * its own characters' cards plus the Echoes, and the characters are face up —
 * so a Jinshi deck is never holding a Camellya card, and that alone narrows
 * the field to a few dozen cards. Anything they have shown is a card they
 * chose to put in, so it counts double, less the copies already spent; at
 * MAX_COPIES_PER_CARD shown, there are none left to fear.
 *
 * Everything here is public — the characters, the trash, the Action Area —
 * which is what keeps it counting cards rather than seeing them.
 */
export function foeCardPool(view: MatchState, foe: string): { card: ActionCard; weight: number }[] {
  const board = view.boards[foe];
  if (!board) return GENERIC_FOE;
  const names = charactersOf(board);
  if (names.length === 0) return GENERIC_FOE;

  const shown = new Map<string, number>();
  for (const card of shownCards(view, foe)) shown.set(card.id, (shown.get(card.id) ?? 0) + 1);

  const out: { card: ActionCard; weight: number }[] = [];
  const listed = new Set<string>();
  for (const def of cardPoolFor(names)) {
    if (listed.has(def.id)) continue;
    listed.add(def.id);
    const seen = shown.get(def.id) ?? 0;
    const left = Math.max(0, MAX_COPIES_PER_CARD - seen);
    if (left === 0) continue;
    out.push({ card: toActionCard(def), weight: seen > 0 ? left * 2 : left });
  }
  return out.length > 0 ? out : GENERIC_FOE;
}

/**
 * What the opponent might lay down, weighted.
 *
 * Their deck's possible contents (foeCardPool), narrowed by what they can pay
 * for right now: a cost 2 card is no threat from someone with one card of
 * Concerto. The cost is read the same way the engine reads it, including
 * whatever discounts are live.
 */
function likelyFoeCards(view: MatchState, foe: string): { card: ActionCard; weight: number }[] {
  // Asked once per card priced, and a decision prices every card in hand
  // several times over — against a board that does not change in between.
  const cached = foeCache.get(view);
  if (cached?.foe === foe) return cached.cards;
  const pool = foeCardPool(view, foe);
  const payable = pool === GENERIC_FOE ? pool : pool.filter(({ card }) => whyUnplayable(view, card, foe) === null);
  const cards = payable.length > 0 ? payable : pool;
  foeCache.set(view, { foe, cards });
  return cards;
}

/**
 * likelyFoeCards per board. Keyed on the board object itself: the engine
 * hands back a new one for every change, so an entry can never go stale, and
 * the WeakMap lets the old boards go.
 */
const foeCache = new WeakMap<MatchState, { foe: string; cards: { card: ActionCard; weight: number }[] }>();

// --- Pricing a card --------------------------------------------------------

/**
 * A card that loses every clash and deals nothing: what "lay nothing down" is
 * worth, priced through the same function as a real card so the two can be
 * compared. Blue, because blue is the one colour nothing beats outright — it
 * must not read as a card that sometimes wins on its own.
 */
const NOTHING: ActionCard = {
  id: "nothing",
  name: "",
  color: "blue",
  cost: 0,
  damage: 0,
  speed: 0,
  imageId: "",
};

/**
 * What laying this card down is expected to be worth, in Life.
 *
 * Runs the real clash against each card the opponent might answer with and
 * averages the results, so nothing here needs to know that red beats green or
 * that blue draws blue — `resolveCombat` does, including whatever stat
 * modifiers are live on the board this turn. A card that wins is worth the
 * damage it deals; one that loses costs the damage it lets through; a draw is
 * worth nothing either way.
 */
function clashValue(view: MatchState, seat: Seat, card: ActionCard): number {
  const foe = opponentOf(view, seat);
  if (!foe) return card.damage;

  // They have already answered, and answered with nothing: this lands whole.
  if (view.committed[foe] && !view.facedown[foe]) return card.damage;

  const mine = { playerId: seat as string, card };
  const turnIsMine = view.turnPlayerId === seat;
  let total = 0;
  let weights = 0;
  for (const { card: theirs, weight } of likelyFoeCards(view, foe)) {
    const entry = { playerId: foe, card: theirs };
    const result = resolveCombat(
      turnIsMine ? mine : entry,
      turnIsMine ? entry : mine,
      view.statModifiers
    );
    if (result.winnerId === seat) total += weight * result.damage;
    else if (result.winnerId) total -= weight * result.damage;
    weights += weight;
  }
  return weights > 0 ? total / weights : card.damage;
}

/**
 * What a card in hand is worth keeping for: the clash it would be laid down
 * in, less what getting there costs.
 *
 * One number for every decision that compares cards — what to put back in the
 * mulligan, what to charge away, what to throw at a Level Up, which card an
 * effect should take or bin. Read highest-first when the bot is choosing what
 * to keep, lowest-first when it is choosing what to give up.
 */
function worth(view: MatchState, seat: Seat, card: ActionCard): number {
  // A card that cannot be paid for is not worth its clash yet — though not
  // worthless either, since one charge from now it might be.
  const unaffordable = whyUnplayable(view, card, seat) === null ? 0 : 0.5;
  return clashValue(view, seat, card) - card.cost * 0.8 - unaffordable;
}

/** The hand, cheapest to part with first. */
export function spareFirst(view: MatchState, seat: Seat, hand: ActionCard[]): ActionCard[] {
  return hand
    .map((card) => ({ card, value: worth(view, seat, card) }))
    .sort((a, b) => a.value - b.value)
    .map(({ card }) => card);
}

// --- Choosing a move -------------------------------------------------------

/**
 * Everything the bot is willing to do right now, best first.
 *
 * A list rather than one move, because the caller is the only side that finds
 * out whether a move is actually taken: the engine has the last word and
 * refuses what it does not like. Walking down the list until one lands means
 * a move the bot misjudged costs a retry instead of wedging the match, and
 * the last entry is always something the phase cannot refuse.
 *
 * Empty means there is nothing for the bot to do right now.
 */
export function botIntents(view: MatchState, seat: Seat): MatchIntent[] {
  const board = view.boards[seat];
  if (!board || view.winnerId) return [];
  const kinds = new Set(legalIntents(view, seat));

  // Leader Select, the mulligan, and the Counter Phase all belong to both
  // players at once, so they are asked before anything gated on whose turn
  // it is.
  if (canChooseLeader(view, seat)) return [chooseLeader(board)];
  if (canMulligan(view, seat)) return [mulligan(view, seat, board)];
  if (canCommit(view, seat) && !view.committed[seat]) return counterMoves(view, seat, board);

  switch (view.phase) {
    case "draw":
      return kinds.has("startTurn") ? [{ kind: "startTurn" }] : [];
    case "action":
      return actionMoves(view, seat, board, kinds);
    case "counter":
      // Both sides have answered; someone has to turn the cards up.
      return kinds.has("resolveCounter") ? [{ kind: "resolveCounter" }] : [];
    case "combo":
      return comboMoves(view, seat, board, kinds);
    case "end":
      return kinds.has("endTurn") ? [{ kind: "endTurn" }] : [];
    default:
      return [];
  }
}

// --- Who leads -------------------------------------------------------------

/**
 * The character whose Leader Skill this card is, or null if it is not one.
 *
 * A Leader Skill card can only be laid down while its character is the
 * Leader — the engine refuses it otherwise (see whyUnplayable) — so which
 * character leads decides how much of the hand is playable at all.
 */
function leaderSkillOf(card: ActionCard): string | null {
  const def = getCard(card.id);
  if (!def || def.type !== "action" || !def.character) return null;
  return def.effects.some((effect) => keywordsOf(effect.condition).includes("leader")) ? def.character : null;
}

/**
 * How much having this character lead is worth to a deck.
 *
 * Its level, since higher levels carry stronger Leader skills, plus the
 * Leader Skill cards it unlocks — counted in `cards`, which is the hand for
 * a Switch (what could be played this turn) and the whole deck for the
 * opening choice (what will be drawn over the game).
 */
function leadValue(slot: CharacterInstance, cards: ActionCard[], perCard: number): number {
  const name = getCard(slot.card.id)?.character ?? slot.card.name;
  const unlocked = cards.filter((card) => leaderSkillOf(card) === name).length;
  return slot.card.level * 2 + unlocked * perCard;
}

/**
 * The opening Leader: whichever of the three starters the deck is built
 * around — the one whose Leader Skill cards it holds most of. Ties keep the
 * deck's own order.
 */
function chooseLeader(board: PlayerBoard): MatchIntent {
  const cards = [...board.hand, ...board.actionDeck];
  let best = board.leader!;
  for (const slot of board.back) {
    if (leadValue(slot, cards, 1) > leadValue(best, cards, 1)) best = slot;
  }
  return { kind: "chooseLeader", leaderId: best.card.id };
}

/**
 * Which of the opening five to put back.
 *
 * A card goes back when what replaces it is likely to be better — and the
 * bot knows what would replace it, because it knows its own deck: not the
 * order, but the list. So the bar is the deck's own average card, not a
 * fixed number: a deck full of strong cards throws back more freely than one
 * whose opening five is as good as it gets. Never more than three, since a
 * hand of five is never so bad that trading all of it for five unknowns is an
 * improvement.
 */
function mulligan(view: MatchState, seat: Seat, board: PlayerBoard): MatchIntent {
  const deck = board.actionDeck;
  const average =
    deck.length > 0 ? deck.reduce((sum, card) => sum + worth(view, seat, card), 0) / deck.length : MULLIGAN_KEEP;
  const bar = Math.min(MULLIGAN_KEEP, average - MULLIGAN_MARGIN);
  const back = spareFirst(view, seat, board.hand)
    .filter((card) => worth(view, seat, card) < bar)
    .slice(0, MULLIGAN_MAX);
  return { kind: "mulligan", cardIds: back.map((card) => card.id) };
}

/**
 * The Action Phase: up to one Level Up, one Switch and one Charge, then out.
 *
 * Ordered by how much of the game each decides. A Level Up is permanent and
 * the cards it costs are the ones already at the bottom of the hand; a Switch
 * only matters when somebody stronger is sitting in the back; a Charge trades
 * one card for the ability to pay for a better one later.
 */
function actionMoves(
  view: MatchState,
  seat: Seat,
  board: PlayerBoard,
  kinds: Set<MatchIntent["kind"]>
): MatchIntent[] {
  const out: MatchIntent[] = [];

  if (kinds.has("levelUp")) {
    for (const slot of [board.leader, ...board.back]) {
      if (!slot) continue;
      // Lowest level first: one rung at a time is cheaper than reaching, and
      // the ladder allows both.
      for (const incoming of levelUpOptions(view, seat, slot.card.id).sort(
        (a, b) => a.level - b.level
      )) {
        const cost = levelUpCost(incoming.level);
        if (board.hand.length < cost + KEEP_IN_HAND) continue;
        const spend = spareFirst(view, seat, board.hand).slice(0, cost);
        if (spend.length === cost) {
          out.push({
            kind: "levelUp",
            characterId: incoming.id,
            discardIds: spend.map((card) => card.id),
          });
        }
      }
    }
  }

  if (kinds.has("switch") && board.leader) {
    // Worth the turn's Switch when someone in the back leads better: a higher
    // level, or Leader Skill cards in hand that only they can unlock.
    const current = leadValue(board.leader, board.hand, SWITCH_PER_CARD);
    const stronger = board.back
      .map((slot) => ({ slot, value: leadValue(slot, board.hand, SWITCH_PER_CARD) }))
      .filter(({ value }) => value > current + SWITCH_MARGIN)
      .sort((a, b) => b.value - a.value)[0];
    if (stronger) out.push({ kind: "switch", toCardId: stronger.slot.card.id });
  }

  if (
    kinds.has("charge") &&
    board.hand.length > 1 &&
    board.competitionArea.length < concertoTarget(board)
  ) {
    const spare = spareFirst(view, seat, board.hand)[0];
    if (spare) out.push({ kind: "charge", cardIds: [spare.id] });
  }

  // Leaving. Skipping the Counter Phase hands the opponent [Advantage] next
  // turn, so it is the answer only when there is nothing to fight with —
  // which is also when passing inside the phase would show the whole hand.
  const armed = board.hand.some((card) => whyUnplayable(view, card, seat) === null);
  if (armed && kinds.has("toBattle")) out.push({ kind: "toBattle" });
  if (kinds.has("skipCounter")) out.push({ kind: "skipCounter" });
  if (kinds.has("toBattle")) out.push({ kind: "toBattle" });
  return out;
}

/**
 * The Counter Phase: which card to lay face-down, or whether to decline.
 *
 * Blocking is never worse than declining for Life — their card lands either
 * way, and this one might beat it — so the whole question is whether the card
 * spent buys enough back. That is `CARD_IN_HAND`, and it is why a bot holding
 * nothing but cards that lose keeps them instead.
 */
function counterMoves(view: MatchState, seat: Seat, board: PlayerBoard): MatchIntent[] {
  const out: MatchIntent[] = [];
  const ranked = board.hand
    .filter((card) => whyUnplayable(view, card, seat) === null)
    .map((card) => ({ card, value: clashValue(view, seat, card) }))
    .sort((a, b) => b.value - a.value);

  const declining = canPassCounter(view, seat);
  // What declining is worth: their card lands whole and nothing of ours is
  // spent. Priced the same way as a clash so the two can be compared.
  const passValue = declining ? clashValue(view, seat, NOTHING) : -Infinity;

  // A card in hand is worth keeping only while there is a game left to keep
  // it for. When what they could hit with is enough to finish this, or what
  // this card hits with is enough to finish them, it goes down.
  const foe = opponentOf(view, seat);
  const foeLife = foe ? (view.boards[foe]?.life ?? Infinity) : Infinity;
  const worstHit = foe ? Math.max(0, ...likelyFoeCards(view, foe).map(({ card }) => card.damage)) : 0;
  const cornered = board.life <= worstHit;
  const keep = (card: ActionCard) => (cornered || card.damage >= foeLife ? 0 : CARD_IN_HAND);

  for (const { card, value } of ranked) {
    if (declining && value - passValue < keep(card)) continue;
    out.push({ kind: "commit", cardId: card.id });
  }
  if (declining) out.push({ kind: "pass" });
  // The engine only allows a pass while nothing is playable, so a bot that
  // declined everything above still has to be able to lay something down.
  for (const { card } of ranked) out.push({ kind: "commit", cardId: card.id });
  return out;
}

/**
 * The Combo Step: a follow-up lands outside the colour clash, so its attack
 * goes straight through. Free damage, as long as the card is red and paid for
 * — the engine enforces both; this only picks the biggest.
 */
function comboMoves(
  view: MatchState,
  seat: Seat,
  board: PlayerBoard,
  kinds: Set<MatchIntent["kind"]>
): MatchIntent[] {
  const out: MatchIntent[] = [];
  if (kinds.has("combo")) {
    const follow = board.hand
      .filter((card) => card.color === "red" && card.damage > 0)
      .filter((card) => whyUnplayable(view, card, seat) === null)
      .sort((a, b) => b.damage - a.damage);
    for (const card of follow) out.push({ kind: "combo", cardId: card.id });
  }
  if (kinds.has("passCombo")) out.push({ kind: "passCombo" });
  if (kinds.has("endTurn")) out.push({ kind: "endTurn" });
  return out;
}

// --- Answering a card ------------------------------------------------------

/** Picks the bot GAINS from; everything else it is giving something up for. */
const GAINS_FROM = new Set(["trashToHand", "trashToConcerto", "searchDeck"]);

/**
 * What the bot answers when a card asks it something.
 *
 * The direction is the whole problem: "choose a card" is the same question
 * whether the card is being handed over or thrown away, and the best answer
 * is the opposite one in the two cases. `choice.tag` is what says which (see
 * ChoiceTag). With no tag the question is a card's own, where taking the best
 * thing on offer is the safe reading — a card that asks its controller to
 * choose is almost always offering.
 */
export function botAnswer(view: MatchState, seat: Seat, choice: PendingChoice): ChoiceAnswer {
  // A card asking "do you want to?" is offering its own effect. Yes.
  if (choice.kind === "confirm") return true;
  if (choice.options.length === 0) return true;

  const gaining = !choice.tag || GAINS_FROM.has(choice.tag);
  const ranked = choice.options
    .map((option) => ({ option, value: optionWorth(view, seat, option) }))
    .sort((a, b) => b.value - a.value)
    .map(({ option }) => option);
  const order = gaining ? ranked : ranked.reverse();

  // An optional pick the bot would rather not make: decline it rather than
  // give something up for nothing.
  const count = Math.min(
    Math.max(choice.min, gaining ? 1 : choice.min),
    choice.max,
    order.length
  );
  if (count === 0) return [];
  const picked = order.slice(0, count).map((option) => option.value);
  // A question that wants one card takes the value on its own — the engine
  // unwraps a single-element array too, but this is the shape the UI sends.
  return choice.max <= 1 ? picked[0] : picked;
}

/**
 * What one option on offer is worth, read through the same pricing as a card
 * in hand. Options that are not cards — a plain either/or — cannot be told
 * apart this way and keep the order the card offered them in.
 */
function optionWorth(view: MatchState, seat: Seat, option: ChoiceOption): number {
  const card = option.cardId ? findCard(view, seat, option.cardId) : null;
  return card ? worth(view, seat, card) : 0;
}

/**
 * The printed card behind an option, found in the bot's own zones.
 *
 * Copies of one card are identical in everything this prices them on, so the
 * first match is as good as the right one. Nothing here reaches into the
 * opponent's board — the view would only hand back blanks anyway.
 */
function findCard(view: MatchState, seat: Seat, cardId: string): ActionCard | null {
  const board = view.boards[seat];
  if (!board) return null;
  for (const zone of [board.hand, board.trash, board.competitionArea, board.actionDeck]) {
    const found = zone.find((card) => card.id === cardId);
    if (found) return found;
  }
  return null;
}
