# WuwaTCGSim

Web-based simulator for the Wuthering Waves TCG mini-game. Create a room, share the code with a friend, and play head-to-head in the browser.

## Stack

- **client/** — React + Vite + TypeScript, connects to the server over Socket.IO
- **server/** — Node + Express + Socket.IO, authoritative match and room state (in memory for now)
- **shared/** — the rules engine, the card database, and the types both sides speak

No database or auth yet — rooms live in server memory and are joined via a 4-character code.

## Getting started

```bash
npm install          # installs all three workspaces
npm run dev:server   # Socket.IO/Express server on :3001
npm run dev:client   # Vite dev server on :5173 (in another terminal)
```

Open http://localhost:5173 and enter a name. **Deck** builds a deck — three
characters, then cards from what they bring — and **Play** finds a game: join
a public room from the list, type a private room's code, or open one of your
own. Once both players are in and have chosen a deck, the host presses start.

`?play` on the same URL opens a hotseat game instead: both sides on one screen,
no server involved, no deck needed. Handy for trying a card out alone.

### Playing with someone on the same network, or in the cloud

The client works out where the server is on its own: same host as the page,
port 3001. That covers local dev (`localhost:5173` client, `localhost:3001`
server) and the simplest cloud deployment (one host, two exposed ports)
without any configuration. For the same-network case:

```bash
npm run dev:client -- --host
```

The server's CORS defaults to allowing any origin, since there is no
per-origin trust to protect (a player's identity is a random id it hands
over itself, not a cookie) — it only widens who can connect, never what they
can do once they have. Set `CLIENT_ORIGIN` to lock it down to known hosts:

```bash
CLIENT_ORIGIN=http://192.168.1.20:5173 npm run dev:server
```

If client and server end up on genuinely different domains (a split cloud
deployment), the auto-detected guess is wrong and needs an explicit override
— see `client/.env.example` for `VITE_SERVER_URL` (full address) and
`VITE_SERVER_PORT` (just the port). **This is a build-time value**: Vite
bakes it into the static bundle when you run `npm run build`, so setting it
as a runtime environment variable on an already-built deployment does
nothing — rebuild after changing it.

## Bug reports to Discord

"Report a bug" (main menu, and the ⚙ menu in a match) posts what the player
wrote to a Discord channel, with the match attached as a JSON file. It goes
through a channel webhook (Server Settings → Integrations → Webhooks), whose
URL goes in `server/.env` — it is a secret, anyone holding it can post there,
and `.env` is git-ignored for that reason:

```bash
DISCORD_BUG_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

For a **forum** channel, where each report becomes its own post titled from
the first line of what the player wrote, say so — Discord refuses a post
title for an ordinary channel — and optionally name forum tags to apply
(tag ids, with Developer Mode on: right-click the tag → Copy ID):

```bash
DISCORD_BUG_FORUM=true
DISCORD_BUG_FORUM_TAGS=123456789012345678
```

Unset, the form tells the player reports are not being taken. One report a
minute per player; nothing a player types can ping anyone.

## Status page

`/admin` on the server is a read-only page: players online, open rooms and
how far each match has got, memory, uptime, and the last 50 errors the server
printed. It is off until a token is set in `server/.env`, and asks for that
token before it shows anything:

```bash
ADMIN_TOKEN=some-long-random-string
```

It lives on the Node server (port 3001), not the client build — behind a
reverse proxy that only forwards `/socket.io`, `/admin` needs forwarding too.
It refreshes every 15 seconds while the tab is open and does nothing
otherwise; errors are kept in memory and gone on restart.

## Playing the bot

"Play against the bot" on the menu (`/vs-bot`) deals a match against an
opponent the tab plays itself — no server, no second person. Pick your deck,
it brings a starter deck around a random character.

Two things make it a game rather than a puzzle:

- **It cannot see your hand.** Every decision it makes is taken from
  `updateFor(seat)`, the same filtered view the server sends a networked
  player, where the other hand is a row of blank backs. `test-bot.ts` proves
  it rather than asserting it: the test swaps the opponent's hand behind the
  bot's back between two identical questions and checks the answer never
  moves. The screen filters the same way in the other direction, so you cannot
  see the bot's hand either.
- **It plays the same rules you do.** It carries no copy of them. Which moves
  exist comes from `legalIntents`, what a card costs from `whyUnplayable`, who
  wins a clash from `resolveCombat` — the engine's own functions, the same
  ones the board calls to decide what to grey out.

What it does bring is `worth()` in `shared/src/bot.ts`, which prices a card as
the clash it would be laid down in — run against what the opponent has been
seen playing, falling back to the printed pool. Every other decision is that
one number read in a direction: keep the highest, spend the lowest. A card
that asks a question says which direction it wants through `ChoiceTag`,
because "choose a card" means the opposite thing when the card is being taken
away.

## Tutorial

"Tutorial" on the menu (`/tutorial`) lists the lessons. A lesson is a real
match on the real board with a guide beside it: a box of text, and a glowing
ring around whatever it is talking about.

- `client/src/tutorial/director.ts` runs it. The decks are dealt in a fixed
  order, the opponent plays exactly the cards the script names, and every
  move the player makes is checked against the open step — anything else is
  refused, so the lesson cannot be walked off its path. A step that is there
  to be read holds the board still until Next.
- A lesson is data — the deal, and a list of steps saying what to show, what
  to ring (CSS selectors, see `lessonKit.ts`) and what ends each one. There are
  four: `phaseLesson` (a turn, phase by phase), `colorLesson` (who beats whom),
  `levelLesson` (Level Up and Switch) and `abilityLesson` (when each kind of
  ability fires). `lessons.ts` sets the order the menu lists them in.
- `npm run test:tutorial -w client` plays every lesson to the end, headless,
  and checks each clash comes out the way its text says. Run it after changing
  a rule or a card the lessons use.

## Decks

A deck is three characters plus 40 Action cards. The three bring their own
cards to the pool, plus the 10 Echoes that belong to no character, and no card
may appear more than four times. The Character Deck is not a choice: each
character is printed with exactly five cards, so three of them fill its 15
slots exactly.

Decks live in the browser's localStorage — there are no accounts to hang them
on. They travel as text instead, one card per line:

```
# สายบุกแดง
BP01-001x1
SD01-010x3
```

Export copies that out, import pastes it back. The parser takes bare ids,
`x3`, `3x`, comments and blank lines, and reports any line it could not read
rather than dropping it silently.

What is legal lives in one place, `deckIssues()` in shared/src/deckList.ts.
The builder shows what it says, and the server runs the same function on a
deck as it is handed in — a client that skips the builder and posts its own
40 copies of one card is refused there.

## How a match runs

The rules live in one place: `step(state, playerId, intent, answers)` in
`shared/src/match.ts`, a pure function with no clock and no `Math.random` — the
same inputs always produce the same game. When a card needs a decision it stops
and hands back a question with the state *unchanged*, expecting to be called
again with the answer appended.

`MatchSession` (`shared/src/session.ts`) is the bookkeeping around that: it
holds the half-finished move while its question is open, decides which seat is
allowed to speak, and builds each player's own view of the board. The server
runs one per room; the hotseat screen runs one in the tab. The board component
cannot tell the two apart.

Hidden information is removed on the server, before anything is sent — each
client is given card *backs* where the other hand is, so the counts stay right
and there is nothing to dig out of a devtools console.

### Levelling up

Playing a card onto a character raises two triggers, for two different cards:

- **[Enter]** on the card arriving — levelling up is how a Level 1 or 2 card
  gets onto the field, which is why so many are printed "[Enter] / [Level up]".
- **[Level up]** on the card it was played over. "When this character is
  levelled up" happens TO the card already in play, not to the one being
  played: that is what makes BP01-009 fetch from the trash as you level past
  it, and what stops BP01-001 ("return this card to the Character Deck") from
  bouncing itself off the field the moment it lands.

### Taking a card off a pile

"Take a red 「Encore」 card from your trash" is a decision when the trash
holds five of them, so `pickFrom` in shared/src/effects.ts asks — for every
helper that moves cards out of a pile the player can see: the trash, the
Concerto area, a hand, a deck search. It is the engine that asks, not each
card, so no card can forget to.

It only asks when there is something to decide: fewer matches than the
ability wants, or several copies of one printed card, leaves nothing to
choose between and nothing is asked.

### The battle log

The log is written in Thai, and every line it can carry lives in
shared/src/log.ts rather than being built inline where it happens. That is
the one file a language switch would open; seats stay as `p1`/`p2` for the
client to swap names into, and card names stay as printed.

Each line names the card behind it — `creditCard` in shared/src/match.ts
appends `[BP01-076]` to anything an effect produced, extending a convention
the damage lines already followed — and the log shows that card's art beside
the words instead of the number.

The clash line says how it was decided: `p1 wins the clash (blue beats red)`,
`(Speed 13 vs 8)`, `(unopposed)`. Without it a win is often invisible — a
0-attack Dodge beats a red card on colour alone, so the loser takes nothing
and the only sign anything happened is a `[Judgement]` skill firing off the
win, which reads like the engine got it wrong.

### Asking a card what it can do

Every move about one particular card is asked at that card, not from the
control bar — the bar has a single row to fit a whole turn into, and no way
to say which card a button meant. Click one of your own and a menu offers
whatever is legal right now:

- **a character** — **ดู** (the whole pile, levels and all), **เลเวลอัป**
  and **สลับ**. Level Up then takes the screen over: pick its cost out of
  your hand and confirm.
- **a card in hand** — **ชาร์จ** and **ลงคว่ำ**. Laying one face-down opens
  the Battle Phase, as it always did.

What the menu offers is not the UI's opinion. `levelUpOptions()`,
`canSwitchLeader()`, `canCommit()` and `whyUnplayable()` in
shared/src/match.ts run the same checks the intents themselves do — the
level ladder, the cost your hand has to cover, the one action a turn, a card
that shut switching off, whether this card can be paid for — so a move that
would be refused is never on a menu, and the engine checks again when it
arrives anyway.

A word on wording: the engine calls the clash the *counter* phase and the
cards are printed `[Counter]`, because that is what the imported text says.
The game's own word for it is **Battle** — *ประลอง* — so that is what the
player reads, in `KEYWORD_LABEL` and `PHASE_LABEL`. The printed spelling is
mapped to the keyword by `PRINTED_TAG_KEYWORD`, so the display name is free
to differ from it.

### Reading a card

The Detail panel shows a card's printed ability with its keyword tags drawn
as tags, in the colours wuwatcgdb prints them in — the card database this
app's text is imported from — so orange, purple and blue mean the same three
things here as there. `KEYWORD_COLOR` in shared/src/cards.ts holds them.

The printed text carries its own "[Enter] / [Level up]" prefix and the engine
writes the same keywords out from the effect's conditions, so `formatEffect`
drops the printed one: only the opening run, because a tag further in is part
of the sentence rather than a repeat of the heading. A tag naming a keyword
we don't know is left exactly as printed — unrecognised is not the same as
absent, and dropping it would hide a card we haven't finished importing.

### Leaving, disconnecting, and forfeits

A room survives a refresh: `joinRoom` recognises a returning player id and
hands their seat straight back, match in progress and all — nothing about
leaving is triggered by a socket merely dropping.

- **Clicking "ออกจากห้อง" (leave)** is a deliberate exit. If a match was
  running, it ends immediately in the other seat's favour — no reason to make
  someone wait on a player who chose to go. The finished board stays up (same
  as any match that ends by Life hitting zero) so the remaining player sees a
  clear "จบเกม — ... ชนะ" rather than being dropped back to an empty lobby.
- **A dropped connection** (closed tab, lost signal) gets a 90-second grace
  period before the same forfeit kicks in — long enough to survive a refresh,
  short enough that the other player isn't stuck indefinitely. Reconnecting
  within that window cancels it. If *both* players are gone, nobody is around
  to see a forfeit either way, so the room is just reaped after 5 minutes of
  silence instead.

Both timers live in `server/src/roomManager.ts` and are overridable for tests
(`_setGraceMsForTests`) — real 90-second and 5-minute timers would make the
test suite that slow.

One player holds one seat. Opening or joining a room gives up whatever seat
they already had (`vacatePreviousRoom`) — without that, the room they walked
out of kept a player it still believed was connected, and nothing would ever
tell it otherwise. A periodic sweep (`sweepRooms`, every 30s) is the backstop:
any seat a room thinks is live but that has no socket open is treated as a
disconnect, which starts the usual countdown rather than deleting anything on
the spot.

## Deploying

Rooms and matches live in the server's memory, so a restart ends every game in
progress. `npm run deploy` therefore builds, then **waits for a moment when no
match is running** before restarting:

```bash
npm run deploy       # build -> wait for idle -> systemctl restart
npm run deploy:now   # build -> restart, without waiting
```

The wait is `server/scripts/wait-for-idle.mjs`, which polls `/health` — that
endpoint reports `load: { rooms, matches, players }`, counting only matches
still being played, not finished boards someone is still reading. It gives up
after 15 minutes (`DRAIN_TIMEOUT_S`) and exits non-zero rather than deciding
for you; `deploy:now` is how you say "restart anyway".

On the way down the server announces itself (`serverNotice`) and holds the
door open for a moment so the notice lands, then closes. Clients show a strip
across the top, reconnect on their own, and fall back to the menu when the
room they were in no longer exists.

## Project layout

```
client/   React app: menu, room browser, deck builder, board
server/   Express + Socket.IO, in-memory rooms, one MatchSession each
shared/   Rules engine, card data, deck lists, and the socket contracts
```

## Tests

```bash
npm test -w @wuwatcg/shared
npm test -w @wuwatcg/server
```

The shared suite type-checks the library and its scripts, then runs: effects,
rules, card data, abilities, a full match, the session layer, deck lists, a
fuzz pass that plays whole games checking Life only ever moves when the log
says so, and a validator that every printed card has its effect filled in.

The server suite covers room lifecycle — leaving, disconnecting, reconnecting,
and the forfeit timers above — against the actual bug shapes rather than the
happy path (a race where two near-simultaneous disconnects left a stray
forfeit timer to fire into an empty room is caught here).

## Status

- [x] Monorepo scaffolding (npm workspaces)
- [x] Room create/join over Socket.IO, lobby UI
- [x] Card data — 123 cards, every printed effect implemented
- [x] Game rules / turn structure
- [x] In-match UI (board, hand, actions, battle log)
- [x] Two-player networked matches, with reconnect, forfeit-on-leave, and table chat
- [x] Deck building, with text import/export
- [x] Main menu, public room browser and private rooms
