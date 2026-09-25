// Two bots, many games, one number: how often the first beats the second.
//
// Not a test — there is no pass mark, and it takes minutes rather than
// seconds. It is the number to look at after changing either half of the bot:
// the pricing in bot.ts, the weights in botSearch.ts. A change that feels
// smarter and moves this number the wrong way was not smarter.
//
// Every deal is played twice with the seats swapped, so neither the coin toss
// nor the better deck can carry the result — only the difference in play. The
// decks are the built-in ones plus a starter around every playable character,
// so no one matchup decides it either.
//
// Run with: npm run bench:bot [pairs] [bot] [against]
//
// A bot is "search" (what players face), "plain" (bot.ts alone), or search
// with numbers changed: "search:horizon=1,hand=1" — see SearchTuning. The
// default is search against plain: what the playouts are worth.

import { botStep, type SearchTuning } from "../src/botSearch";
import { playableCharacters } from "../src/decks";
import { MatchSession, starterDeck } from "../src/session";
import { starterDecks } from "../src/starterDecks";
import type { DeckList } from "../src/deckList";
import type { Seat } from "../src/types";

const [pairsArg, firstArg, secondArg] = process.argv.slice(2);
const PAIRS = Number(pairsArg ?? 40);
const FIRST = firstArg ?? "search";
const SECOND = secondArg ?? "plain";
const MOVE_BUDGET = 2000;

type Policy = (session: MatchSession, seat: Seat) => boolean;

function policy(spec: string): Policy {
  if (spec === "plain") return (session, seat) => botStep(session, seat, { search: false });
  if (spec === "search") return (session, seat) => botStep(session, seat);
  if (spec.startsWith("search:")) {
    const tuning: Partial<SearchTuning> = {};
    for (const pair of spec.slice("search:".length).split(",")) {
      const [key, value] = pair.split("=");
      (tuning as Record<string, number>)[key] = Number(value);
    }
    return (session, seat) => botStep(session, seat, { tuning });
  }
  throw new Error(`unknown bot "${spec}" — plain, search, or search:key=value,...`);
}

const decks: DeckList[] = [...starterDecks(), ...playableCharacters().map((name) => starterDeck(name))];
const first = policy(FIRST);
const second = policy(SECOND);

let wins = 0;
let losses = 0;
let draws = 0;
let thinking = 0;
let moves = 0;
let slowest = 0;
const started = performance.now();

for (let game = 0; game < PAIRS; game += 1) {
  const pair = [decks[(game * 7) % decks.length], decks[(game * 5 + 3) % decks.length]];
  for (const firstSeat of ["p1", "p2"] as Seat[]) {
    const session = MatchSession.deal(
      `arena-${game}`,
      { p1: pair[0], p2: pair[1] } as Record<Seat, DeckList>,
      game * 7919 + 13
    );
    const policies: Record<Seat, Policy> =
      firstSeat === "p1" ? { p1: first, p2: second } : { p1: second, p2: first };
    for (let guard = 0; !session.winnerId && guard < MOVE_BUDGET; guard += 1) {
      let moved = false;
      for (const seat of ["p1", "p2"] as Seat[]) {
        const start = performance.now();
        const did = policies[seat](session, seat);
        if (seat === firstSeat) {
          const took = performance.now() - start;
          thinking += took;
          slowest = Math.max(slowest, took);
          if (did) moves += 1;
        }
        if (did) moved = true;
      }
      if (!moved) break;
    }
    const other = firstSeat === "p1" ? "p2" : "p1";
    if (session.winnerId === firstSeat) wins += 1;
    else if (session.winnerId === other) losses += 1;
    else draws += 1;
  }
  process.stderr.write(`\r${game + 1}/${PAIRS}`);
}
process.stderr.write("\n");

console.log(`${FIRST} vs ${SECOND}, ${wins + losses + draws} games (${PAIRS} deals, both seats each)`);
console.log(`  won ${wins}  lost ${losses}  drawn/unfinished ${draws}`);
console.log(`  win rate ${((100 * wins) / Math.max(1, wins + losses)).toFixed(1)}%`);
console.log(
  `  ${FIRST} thinking: ${(thinking / Math.max(1, moves)).toFixed(1)} ms per move on average, slowest ${slowest.toFixed(0)} ms`
);
console.log(`  took ${((performance.now() - started) / 1000).toFixed(0)} s`);
