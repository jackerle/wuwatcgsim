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

Open http://localhost:5173, enter a name, and create a room. Share the
4-character code with a friend so they can join from their own browser. Pick a
character each, and the host presses start.

`?play` on the same URL opens a hotseat game instead: both sides on one screen,
no server involved. Handy for trying a card out alone.

### Playing with someone on the same network

The server only accepts browsers from origins it is told about, so point it at
the address your friend will actually type:

```bash
CLIENT_ORIGIN=http://192.168.1.20:5173 npm run dev:server
npm run dev:client -- --host
```

The client reads the server URL from `client/.env` (`VITE_SERVER_URL`, defaults
to `http://localhost:3001`).

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

## Project layout

```
client/   React app: lobby, board, and the two match controllers
server/   Express + Socket.IO, in-memory rooms, one MatchSession each
shared/   Rules engine, card data, decks, and the shared socket contracts
```

## Tests

```bash
npm test -w @wuwatcg/shared
```

Type-checks the library and its scripts, then runs the suites: effects, rules,
card data, abilities, a full match, the session layer, and a validator that
every printed card has its effect filled in.

## Status

- [x] Monorepo scaffolding (npm workspaces)
- [x] Room create/join over Socket.IO, lobby UI
- [x] Card data — 123 cards, every printed effect implemented
- [x] Game rules / turn structure
- [x] In-match UI (board, hand, actions, battle log)
- [x] Two-player networked matches, with reconnect and table chat
- [ ] Deck building (starter decks stand in for now)
