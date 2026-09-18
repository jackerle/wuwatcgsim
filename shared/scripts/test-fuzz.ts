// Plays whole games and checks that the board only ever changes in ways the
// log accounts for.
//
// The other suites each assert a specific rule. This one asserts something
// weaker but much harder to fake: over many full games, nobody's Life moves
// without a log line saying so, and by the amount it says. That is the shape
// a whole class of bugs takes — an effect applied twice, or re-applied every
// time the board is rebuilt — and none of them look like a failing rule
// until someone is suddenly at -3 Life.
//
// Run with: npm run test:fuzz
import { playableCharacters } from "../src/decks";
import { MatchSession, starterDeck } from "../src/session";
import type { DeckList } from "../src/deckList";
import type { Seat } from "../src/types";

const names = playableCharacters();
let games = 0;
let silent = 0;
let mismatched = 0;
let earlyWins = 0;

for (let g = 0; g < 25; g += 1) {
  const picks = {
    p1: starterDeck(names[g % names.length]),
    p2: starterDeck(names[(g + 3) % names.length]),
  } as Record<Seat, DeckList>;
  const s = MatchSession.deal(`fuzz-${g}`, picks, g * 7919 + 13);
  let life = { p1: s.state.boards.p1.life, p2: s.state.boards.p2.life };
  let seen = 0;

  for (let i = 0; i < 400 && !s.winnerId; i += 1) {
    const turn = s.state.turnPlayerId as Seat;
    const other: Seat = turn === "p1" ? "p2" : "p1";
    const before = s.log.length;

    if (s.question) { s.answer(s.question.choice.playerId as Seat, s.question.choice.options[0]?.value ?? false); }
    else switch (s.state.phase) {
      // Both seats answer the opening mulligan, putting back a different
      // number each game so the shuffle-and-redraw path is actually walked.
      case "mulligan":
        for (const seat of ["p1", "p2"] as Seat[]) {
          if (s.state.mulliganDone[seat]) continue;
          const back = s.state.boards[seat].hand.slice(0, g % 6).map((c) => c.id);
          s.apply(seat, { kind: "mulligan", cardIds: back });
        }
        break;
      case "draw": s.apply(turn, { kind: "startTurn" }); break;
      case "action":
      case "counter":
        if (!s.state.facedown[turn] && !s.state.committed[turn]) {
          const card = s.state.boards[turn].hand[0];
          if (!card || !s.apply(turn, { kind: "commit", cardId: card.id })) s.apply(turn, { kind: "pass" });
        } else if (!s.state.facedown[other] && !s.state.committed[other]) {
          const card = s.state.boards[other].hand[0];
          if (!card || !s.apply(other, { kind: "commit", cardId: card.id })) s.apply(other, { kind: "pass" });
        } else s.apply(turn, { kind: "resolveCounter" });
        break;
      case "combo": s.apply(s.state.combo?.playerId as Seat, { kind: "passCombo" }); break;
      case "end": s.apply(turn, { kind: "endTurn" }); break;
      default: i = 400;
    }

    const now = { p1: s.state.boards.p1.life, p2: s.state.boards.p2.life };
    const fresh = s.log.slice(before);
    for (const seat of ["p1", "p2"] as Seat[]) {
      const delta = life[seat] - now[seat];
      if (delta === 0) continue;
      // Matched against the catalogue's own wording — see LOG.takesFrom /
      // LOG.healsFrom in shared/src/log.ts. A line the log stops writing that
      // way must be caught here, not silently stop counting.
      const mentions = fresh.filter(
        (l) => l.startsWith(`${seat} เสีย `) || l.startsWith(`${seat} ฟื้นฟู `)
      );
      if (mentions.length === 0) {
        silent += 1;
        console.log(`game ${g} step ${i}: ${seat} lost ${delta} with nothing in the log`);
        console.log("   recent:", JSON.stringify(s.log.slice(-4)));
      } else {
        const logged = mentions.reduce((sum, l) => {
          const m = /(เสีย|ฟื้นฟู) (\d+)/.exec(l);
          return sum + (m ? (m[1] === "เสีย" ? 1 : -1) * Number(m[2]) : 0);
        }, 0);
        if (logged !== delta) {
          mismatched += 1;
          console.log(`game ${g} step ${i}: ${seat} lost ${delta} but log says ${logged} — ${JSON.stringify(mentions)}`);
        }
      }
    }
    life = now;
    seen = i;
  }
  games += 1;
  if (s.winnerId) {
    const dead = Object.values(s.state.boards).some((b) => b.life <= 0);
    if (!dead && s.winnerId !== "draw") {
      earlyWins += 1;
      console.log(
        `game ${g}: winner ${s.winnerId} but nobody is at 0 (p1=${s.state.boards.p1.life} p2=${s.state.boards.p2.life})`
      );
    }
  }
  void seen;
}
const failures = silent + mismatched + earlyWins;
console.log(
  `${games} games played. silent life changes: ${silent}. mismatched: ${mismatched}. early wins: ${earlyWins}.`
);
console.log(failures === 0 ? "PASS  เลือดขยับตรงกับ log ทุกเกม" : `FAIL  พบ ${failures} จุดที่ไม่ตรง`);
process.exit(failures > 0 ? 1 : 0);
