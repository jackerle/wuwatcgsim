# Handoff — WuwaTCGSim

Context for an agent picking this up without the prior conversation. README.md
covers what the app is and how to run it; this covers the parts you would
otherwise have to learn by breaking them.

Everything described here is committed as of `e474b00`. The working tree is
clean.

---

## Shape of the thing

Three npm workspaces. The important boundary is that **`shared/` holds all the
rules and neither of the other two holds any**:

- `shared/src/game.ts` — data shapes, combat maths, the seeded RNG
- `shared/src/rules.ts` — legality, turn structure, deck-out
- `shared/src/effects.ts` — how one card ability resolves; builds the `ctx` cards are written against
- `shared/src/match.ts` — `step()`, the whole turn engine, one pure function
- `shared/src/session.ts` — `MatchSession`, the bookkeeping a server needs around `step()`
- `shared/src/sets/*.ts` — the card database, one file per set
- `shared/src/log.ts` — every line the battle log can print, in Thai, in one place

`server/` is authorisation + sockets + room lifecycle. `client/` draws whatever
it is handed. Neither reimplements a rule; if the UI needs to know whether a
move is legal it calls the engine's own predicate (`legalIntents`, `canCommit`,
`canMulligan`, `whyUnplayable`, `levelUpOptions`).

`MatchSession` lives in `shared/` rather than `server/` on purpose: the hotseat
screen runs the identical class in the browser. `client/src/game/matchController.ts`
is the interface both paths satisfy, so `PlayGame.tsx` cannot tell a local game
from a networked one.

---

## Five invariants you will break if nobody tells you

### 1. The engine has no clock and no `Math.random`

`step()` is pure. The only randomness is `nextRandom()`/`shuffleWithState()` in
`game.ts`, which advance `state.rngSeed` and are therefore replayable. Calling
`Math.random()` inside an effect **will** corrupt a match — see the next point
for why.

`Math.random` outside the engine is fine and is used: room codes and per-match
seeds in `server/src/roomManager.ts`.

### 2. A question rewinds and replays the entire step

When a card needs a decision, `ask()` in `effects.ts` throws `NeedsChoice`.
`step()` catches it, returns `pending` set and **`state` unchanged**. The caller
re-invokes `step()` with the same arguments and the answer appended. So one
player move can execute its effects five times over.

Consequences:

- An effect's `resolve` must ask the **same questions in the same order** every
  run. Anything that varies between replays (a clock, unseeded randomness,
  iterating a `Set` built from mutable state) will desync the answer cursor and
  the dialog will re-ask forever.
- `preview` on the `StepResult` is the half-applied board, for display only.
  Never feed it back into `step()`.
- `MatchSession.updateFor()` shows the preview **only to the player being
  asked**. Everyone else keeps the committed board, because the move can still
  be cancelled. The one exception is `resolveCounter`: both cards are up either
  way, so both seats see the preview and the reveal cut-in plays for both at
  once.

### 3. Hidden information is stripped server-side, not hidden in the UI

`viewFor(state, seat)` replaces the opponent's hand and deck with
`hiddenActionCard(i)` placeholders — replaced, not emptied, so hand size and
deck size stay visible because they are public at a real table. The client is
never sent the other hand, so there is nothing for a devtools console to dig
out. Do not "optimise" this by sending the full state and filtering in React.

### 4. `followCount` is the single source of truth for Follow{x}

This one already caused a shipped bug. A card's Follow{x} is applied by
**combat**: `comboGrantFor()` in `cardDef.ts` reads `followCount` off the
printed card when it wins the clash, and that is what opens the Combo window.

Every action card with Follow also writes `ctx.grantFollowUp(x)` in its
`resolve`, because that is what the printed text says. Both firing gave the
player double — SD02-013's Follow{2} allowed four follow-ups, SD02-010's
Follow{8} sixteen.

The fix is a guard in `grantFollowUp` (`effects.ts`): if the effect being
resolved declares `followCount` **and the card is an action card**, the call is
dropped.

> **Do not "clean up" the now-redundant `ctx.grantFollowUp(x)` calls in the card
> definitions by deleting the guard.** The guard is what protects the next card
> somebody adds. The calls are left in the card files deliberately, because they
> mirror the printed text.

Character cards are the exception and still grant through `resolve`:
`comboGrantFor` is only ever asked about the winning *action* card, so a
character's `followCount` is never read by combat and exists only to render
`[Follow{3}]` in the card text. BP01-019 and BP01-031 are the two real character
cards here. BP01-057 looks like a Leader Skill but is an *action* card, so it
goes through the guard.

Pinned by `shared/scripts/test-abilities.ts` — both the unit-level check and an
end-to-end "win a clash with SD02-013, count the window".

### 5. Log lines are a catalogue, and seats stay seats

Everything the battle log can say is a function in `shared/src/log.ts`. The
engine writes `"p1"`, never a player's name — a rules function has no business
knowing what anybody is called. `client/src/game/MatchLog.tsx` swaps the real
names in at the last moment. Card names stay as printed and are never
translated.

If you add a log line, add it there, not inline.

---

## What changed most recently, and why

### Opening mulligan

New phase `"mulligan"` before turn 1. Both players put back any number of their
five, shuffle, and draw that many again; an empty `cardIds` is the "keep this
hand" answer and still counts as having chosen. Phase ends when both are in,
whatever order they answered.

- `"mulligan"` is deliberately **absent from `TURN_PHASE_ORDER`** — it happens
  once and the turn cycle never returns to it. `nextPhase("mulligan")` is null;
  the engine leaves it by hand.
- It is not gated on whose turn it is. `legalIntents()` checks it *before* the
  turn-player gate, and it is not in `TURN_PLAYER_ONLY` in `session.ts`.
- Cards are taken out **by position, one id at a time**. A hand can hold two
  copies of one printed card and matching on id alone would put the same one
  back twice.
- `MatchSetup.skipMulligan` deals straight into turn 1. Test fixtures use it so
  they do not have to play two opening moves before reaching the rule under
  test; a real match never sets it.

### Random first player

`firstSeatFor(matchId, seed)` in `session.ts` tosses a coin off the deal's own
seed, not `Math.random`, so a match stays reproducible from its seed. Pin it in
tests with `DealOptions.startingPlayerId`.

Watch the signedness trap that bit here: `hash ^= hash >>> 16` yields a **signed**
32-bit int, and a negative remainder indexes off the front of `SEATS`. The `>>> 0`
is load-bearing.

### Deck-out recycles the trash

Running out is not a loss. `takeFromDeck(state, board, count, log)` in `rules.ts`
is now the only way cards leave the top of a deck — draw, mill, reveal, charge
from deck, mulligan redraw all route through it.

- It refills **part-way through a count**: one card left and two to draw takes
  that card, recycles, takes the second off the new deck.
- It recycles only when the deck is **empty**, never when it is merely low.
  Mixing the trash in underneath a card that is still on top would quietly
  change which card comes off next.
- Both piles empty is handled: no cards, no spin, no throw, a log line.

`revealTop` calls `recycleTrash` rather than `takeFromDeck` because it peeks
without taking.

### Phase track

`client/src/game/PhaseTrack.tsx`, centred in the control bar. Draw › Main ›
Battle › End.

The Combo Step shares the Battle box rather than getting a fifth: the engine
separates it because the rules resolve it separately, but from the table it is
still the battle you just won, and a box that blinks past is noise.

Centring works because the two outer parts of the bar (`.control-side`) share
one flex basis. Do not give either a different `flex` value or the track drifts
off the board's centre line.

### Dialog: auto-highlight, never auto-confirm

`ChoiceDialog` pre-selects the single option when a `pickCard` question offers
exactly one — "take a red Encore card from your trash" with one red Encore in
there is not a choice of *which*, only of *whether*.

It is marked, never sent. The card says "you MAY"; pressing ยืนยัน is how the
player says yes. Answering for them spends an optional ability they may have
been about to decline. This was an explicit product decision, not an oversight.

---

## Open thread: the frozen-modal bug

**Status: mitigated, root cause never reproduced.** If it recurs, start here.

Reported symptom: a confirm dialog ("แสดงการ์ด 1 ใบบนสุดของเด็ค นำขึ้นมือไหม",
BP01-010's `[Leader][Counter]`) appeared over the board and neither ตกลง nor ไม่
did anything. The whole UI was unusable — which is what a modal backdrop over an
unanswerable question looks like.

What was ruled out: a harness was built that plays 400 full games answering
questions randomly across yes/no/pick/decline — the existing fuzz test answers
`options[0] ?? false`, so it had **never once walked the "yes" branch**. No stuck
question, no thrown error, no answer-cursor desync. The engine replays correctly.

So the fault is almost certainly in the plumbing, and three things were changed
to make that class of failure survivable rather than fatal:

1. `MatchSession.run()` wraps `step()` in try/catch. Previously a throw inside a
   card effect propagated out of the socket handler, the server sent no update,
   and **both** clients sat forever on the last board they received. Now it is
   one refused move.
2. `server/src/index.ts` has a `guard()` around the match handlers plus
   process-level `uncaughtException`/`unhandledRejection` logging. A crashed
   process drops every room in memory.
3. There was **no way out of an open question at all** — `cancel()` existed on
   the controller and was wired to no button anywhere. `actorSeat` now travels
   on `MatchUpdate` so the client knows whether the move is its to drop, and
   "ยกเลิกการสั่ง" appears both in the dialog and beside the "waiting for…" hint.

**If it happens again, check the server console for `[matchAnswer] handler
failed:` with a stack trace.** Before these changes that path was silent.

---

## Running things

```bash
npm install            # all three workspaces
npm run dev:server     # :3001
npm run dev:client     # :5173
```

Tests, per workspace:

```bash
npm test -w shared     # typecheck + effects, rules, cards, abilities, match,
                       # session, decklist, fuzz, validate:cards
npm test -w server     # typecheck + roomManager
npm run build -w client   # tsc -b && vite build
npm run lint -w client    # oxlint
```

There is no test runner. Each suite is a `tsx` script that prints PASS/FAIL
lines and exits non-zero. Match the existing style — assertions are named in
Thai, prose comments in English.

`npm run test:fuzz -w shared` plays whole games and asserts that nobody's Life
moves without a log line accounting for it, by the amount it says. It catches
double-applied effects, which do not look like a failing rule until someone is
at -3 Life. Keep it passing.

`?play` on the client URL opens a hotseat game with no server and no deck
needed — the fastest way to see a change on a real board.

---

## Loose ends worth knowing about

- **No `CLAUDE.md` in this repo.** Much of what is above would belong in one.
- The seven action cards with Follow{x} still carry their now-ignored
  `ctx.grantFollowUp(x)` calls. See invariant 4 before touching them.
- `shared/dist/` exists and is stale. Nothing in dev reads it — the workspace
  resolves `@wuwatcg/shared` to `src/index.ts` — but `npm run build:shared`
  regenerates it.
- `client/src/game/LevelUpPicker.tsx` was deleted; Level Up is now driven from
  the character's own card menu (`CardMenu.tsx` → `LevelUpConfirm.tsx`). Charge,
  Commit and Switch moved the same way. The control bar deliberately holds only
  moves about the *turn*, not about a card.
- Rooms are in server memory only. A restart drops every match.
- The UI is Thai throughout. New user-facing strings should be Thai; code
  comments and this document are English.
