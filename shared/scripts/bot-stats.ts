// Which characters farm cards, and which ones press damage — measured, not
// guessed, by letting the bot play every starter deck against every other.
//
// Per turn, credited to whoever was Leader when the turn began:
//
//   cards   net cards the turn's owner came out of it with (hand + Concerto,
//           after the turn against before its draw). The two-card draw is in
//           there for everyone alike, so what separates characters is what
//           their abilities draw, recover and save.
//   dealt   Life the turn's owner took off the opponent, on their own turn.
//   taken   Life the owner lost on the opponent's following turn — what
//           the character left them open to.
//
// And per deck, how often it won.
//
// Read it as "how this bot plays these characters", not as a tier list: a
// character whose strength the bot does not know how to use will look weak.
//
// Run with: npm run stats:bot [games] [--plain]

import { botStep } from "../src/botSearch";
import { getCard } from "../src/cardDb";
import { playableCharacters } from "../src/decks";
import type { MatchState } from "../src/game";
import { MatchSession, starterDeck } from "../src/session";
import { starterDecks } from "../src/starterDecks";
import type { DeckList } from "../src/deckList";
import type { Seat } from "../src/types";

const args = process.argv.slice(2);
const plain = args.includes("--plain");
const GAMES = Number(args.find((arg) => !arg.startsWith("--")) ?? 60);
const SEATS: Seat[] = ["p1", "p2"];

const decks: DeckList[] = [...starterDecks(), ...playableCharacters().map((name) => starterDeck(name))];

interface Tally {
  turns: number;
  cards: number;
  dealt: number;
  taken: number;
}
const byLeader = new Map<string, Tally>();
const byDeck = new Map<string, { games: number; wins: number }>();

const leaderOf = (state: MatchState, seat: Seat) =>
  getCard(state.boards[seat]?.leader?.card.id ?? "")?.character ?? "?";
const cardsOf = (state: MatchState, seat: Seat) =>
  (state.boards[seat]?.hand.length ?? 0) + (state.boards[seat]?.competitionArea.length ?? 0);
const lifeOf = (state: MatchState, seat: Seat) => state.boards[seat]?.life ?? 0;

for (let game = 0; game < GAMES; game += 1) {
  const pair = [decks[(game * 7) % decks.length], decks[(game * 5 + 3) % decks.length]];
  const session = MatchSession.deal(`stats-${game}`, { p1: pair[0], p2: pair[1] } as Record<Seat, DeckList>, game * 104729 + 7);

  // The turn being watched: whose, who led it, and the board before it.
  let open: { seat: Seat; leader: string; cards: number; foeLife: number; turn: number } | null = null;
  // Last turn's tally, still waiting on the damage its owner takes next.
  let waiting: { tally: Tally; seat: Seat; life: number } | null = null;

  for (let guard = 0; !session.winnerId && guard < 2000; guard += 1) {
    const state = session.state;
    if (state.phase === "draw" && (!open || open.turn !== state.turnNumber)) {
      const seat = state.turnPlayerId as Seat;
      const foe = SEATS.find((other) => other !== seat)!;
      if (open) {
        // The previous turn is over: close it.
        const tally = byLeader.get(open.leader) ?? { turns: 0, cards: 0, dealt: 0, taken: 0 };
        const openFoe = SEATS.find((other) => other !== open!.seat)!;
        tally.turns += 1;
        tally.cards += cardsOf(state, open.seat) - open.cards;
        tally.dealt += open.foeLife - lifeOf(state, openFoe);
        byLeader.set(open.leader, tally);
        if (waiting) waiting.tally.taken += waiting.life - lifeOf(state, waiting.seat);
        waiting = { tally, seat: open.seat, life: lifeOf(state, open.seat) };
      }
      open = { seat, leader: leaderOf(state, seat), cards: cardsOf(state, seat), foeLife: lifeOf(state, foe), turn: state.turnNumber };
    }
    const moved = SEATS.some((seat) => botStep(session, seat, { search: !plain }));
    if (!moved) break;
  }

  pair.forEach((deck, index) => {
    const entry = byDeck.get(deck.name) ?? { games: 0, wins: 0 };
    entry.games += 1;
    if (session.winnerId === SEATS[index]) entry.wins += 1;
    byDeck.set(deck.name, entry);
  });
  process.stderr.write(`\r${game + 1}/${GAMES}`);
}
process.stderr.write("\n");

const rows = [...byLeader.entries()]
  .filter(([, tally]) => tally.turns > 0)
  .map(([name, tally]) => ({
    name,
    turns: tally.turns,
    cards: tally.cards / tally.turns,
    dealt: tally.dealt / tally.turns,
    taken: tally.taken / tally.turns,
  }));

const pad = (text: string | number, width: number) => String(text).padStart(width);
console.log(`\nAs Leader, per own turn (${GAMES} games, ${plain ? "bot.ts only" : "with search"})`);
console.log(`${"character".padEnd(14)}${pad("turns", 7)}${pad("cards", 8)}${pad("dealt", 8)}${pad("taken", 8)}`);
for (const row of rows.sort((a, b) => b.cards - a.cards)) {
  console.log(
    `${row.name.padEnd(14)}${pad(row.turns, 7)}${pad(row.cards.toFixed(2), 8)}${pad(row.dealt.toFixed(2), 8)}${pad(row.taken.toFixed(2), 8)}`
  );
}

console.log(`\nBy deck`);
for (const [name, entry] of [...byDeck.entries()].sort((a, b) => b[1].wins / b[1].games - a[1].wins / a[1].games)) {
  console.log(`${name.padEnd(22)}${pad(entry.wins, 4)}/${entry.games}  ${pad(((100 * entry.wins) / entry.games).toFixed(0), 3)}%`);
}
