// What every lesson is built from: a deal in a known order, and the places
// on the board a step can point at.

import {
  characterCardsFor,
  createMatch,
  requireCard,
  toActionCard,
  toCharacterCard,
  type MatchState,
} from "@wuwatcg/shared";

export interface LessonSide {
  /** The three characters, Leader first. */
  characters: string[];
  /** The opening hand (the first five), then every draw in order. */
  cards: string[];
  /** Past the scripted cards: only there to make 40, cycled in this order. */
  filler: string[];
}

function actionDeck(side: LessonSide) {
  const ids = [...side.cards];
  for (let i = 0; ids.length < 40; i += 1) ids.push(side.filler[i % side.filler.length]);
  return ids.map((id) => toActionCard(requireCard(id)));
}

/**
 * A lesson's board: the player (p1) goes first, straight into turn 1 — no
 * Leader Select, no mulligan, nothing shuffled.
 */
export function dealLesson(matchId: string, you: LessonSide, them: LessonSide): MatchState {
  return createMatch({
    matchId,
    startingPlayerId: "p1",
    skipMulligan: true,
    players: [
      {
        playerId: "p1",
        characterDeck: characterCardsFor(you.characters).map(toCharacterCard),
        actionDeck: actionDeck(you),
      },
      {
        playerId: "p2",
        characterDeck: characterCardsFor(them.characters).map(toCharacterCard),
        actionDeck: actionDeck(them),
      },
    ],
  });
}

/**
 * The scripted opponent every lesson uses. Encore leads because her Level 0
 * skill only buffs Encore's own cards, and the script plays none — each of
 * the other starting Leaders reacts to a colour the opponent lays somewhere,
 * and a surprise point of damage would make the text's arithmetic wrong.
 */
export const SPARRING_PARTNER = ["Encore", "Jinshi", "Rover (M)"];
export const SPARRING_FILLER = ["SD02-013", "SD02-018", "SD02-020"];

// --- Where things are on the board ------------------------------------------

const MINE = ".player-zone:not(.mirrored)";
const THEIRS = ".player-zone.mirrored";

export const at = {
  hand: (color: string) => `${MINE} .hand-card[data-color="${color}"]`,
  handCard: (id: string) => `${MINE} .hand-card[data-card-id="${id}"]`,
  anyHand: `${MINE} .hand-card`,
  handBadges: `${MINE} .hand-card .color-badge`,
  handCosts: `${MINE} .hand-card .stat-pill.cost`,
  handStats: `${MINE} .hand-card .stat-row`,
  handStatsOf: (color: string) => `${MINE} .hand-card[data-color="${color}"] .stat-row`,
  character: (name: string) => `${MINE} .character-slot[data-name="${name}"]`,
  leader: `${MINE} .character-slot.leader`,
  characters: `${MINE} .characters-group`,
  pool: `${MINE} .pile[data-pile="pool"]`,
  deck: `${MINE} .pile[data-pile="deck"]`,
  trash: `${MINE} .pile[data-pile="trash"]`,
  concerto: `${MINE} .charge-area`,
  mySlot: `${MINE} .own-action-slot`,
  theirSlot: `${THEIRS} .own-action-slot`,
  myLife: `${MINE} .hp`,
  theirLife: `${THEIRS} .hp`,
  theirHand: `${THEIRS} .hand`,
  myAdvantage: `${MINE} .advantage-badge`,
  theirAdvantage: `${THEIRS} .advantage-badge`,
  goBattle: ".control-move-battle",
  skipBattle: ".control-secondary-move",
  pass: ".control-pass",
  endTurn: ".control-move-end",
  phases: ".phase-track",
  /** One tab of the phase track: draw, main, battle, judgement, combo, end. */
  phase: (step: string) => `.phase-track-step[data-step="${step}"]`,
  detail: ".detail-panel",
};

// --- Common moments -----------------------------------------------------------

/** How long the clash cut-in runs (ClashRevealFx), plus a beat. */
export const AFTER_REVEAL = 2100;
/** How long the Level Up cut-in runs (LevelUpFx), plus a beat. */
export const AFTER_LEVEL_UP = 2800;

export const revealed = (state: MatchState) => state.phase !== "counter";
export const theyCommitted = (state: MatchState) => Boolean(state.committed.p2);
/** The player's turn has started and reached the Action (Main) Phase. */
export const myMainPhase = (state: MatchState) => state.turnPlayerId === "p1" && state.phase === "action";
