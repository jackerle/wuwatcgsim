// Imports printed card data from the public wuwatcgdb card database into the
// set files under src/sets.
//
// Only the PRINTED side is imported: name, stats, and the ability text with
// its keywords parsed out of the leading [Tags]. `resolve` is never written —
// what an ability does is code, and code is written by hand. Until then the
// engine surfaces the imported text and the players apply it themselves.
//
// Cards you have already filled in (name is not empty) are left completely
// alone, so this is safe to re-run.
//
// Run with: npm run import:cards
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PRINTED_TAG_KEYWORD } from "../src/cards";
import type { CardKeyword } from "../src/cards";

const HERE = dirname(fileURLToPath(import.meta.url));
const SETS_DIR = join(HERE, "..", "src", "sets");
// The site is a thin client over a public Supabase REST table, so we ask that
// directly instead of driving a browser. Key is the publishable anon key the
// site ships in its own front-end bundle.
const SITE = "https://wuwatcgdb.lovable.app/";
const API = "https://qbyfcsypsnljlbewsrim.supabase.co/rest/v1/cards";
const ANON_KEY = "sb_publishable_pl-4lp-7BT1UApZf6tq8Ww_5nuomTv7";

// --- the source shape ------------------------------------------------------

interface SourceAbility {
  text?: string;
  text_en?: string;
}
interface SourceCard {
  code?: string;
  name?: string;
  name_en?: string;
  card_type?: string;
  rarity?: string;
  tags?: string[];
  abilities?: SourceAbility[];
  stats?: Record<string, string>;
  sources?: string[];
}

// --- mapping ---------------------------------------------------------------

/**
 * "[Leader Skill]" is printed on its own line, but it is not a separate
 * ability: it says the card's abilities only work while its character is the
 * active leader. So it becomes the `leader` keyword on the card's real
 * effects, and the bare marker line is dropped. PRINTED_TAG_KEYWORD maps it
 * to `leader` as well, for the UI's sake — this is checked first, because
 * only here does it also swallow the line it was printed on.
 */
const LEADER_SKILL_TAGS = new Set(["leader skill"]);

const COLOR_TO_ENGLISH: Record<string, "red" | "green" | "blue"> = {
  แดง: "red",
  เขียว: "green",
  ฟ้า: "blue",
  น้ำเงิน: "blue",
};

/**
 * `tags` mixes three different things together: the character the card
 * belongs to, its element, and its printed subtype. Only the subtype is
 * interesting here, so the other two are filtered out by name.
 */
const ELEMENT_TAGS = new Set(["spectro", "fusion", "havoc", "glacio", "aero", "electro"]);
const SUBTYPE_FIXES: Record<string, string> = { "nornal attack": "Normal Attack" };

const WEAPONS = ["sword", "broadblade", "pistols", "gauntlets", "rectifier"];
const ELEMENTS = ["aero", "glacio", "fusion", "electro", "havoc", "spectro"];

/** The source spells a few of these differently, including outright typos. */
const WEAPON_ALIASES: Record<string, string> = {
  pistol: "pistols",
  boardblade: "broadblade",
  broadsword: "broadblade",
  gauntlet: "gauntlets",
};

/** Card numbers the source has typed wrong. */
const CODE_FIXES: Record<string, string> = { "BP01-0076": "BP01-076" };

/**
 * Parallel-art filenames per card number, read off the images we already
 * downloaded. The source database has no notion of alternate printings.
 */
function parallelArt(): Map<string, string[]> {
  const byCode = new Map<string, string[]>();
  const dir = join(HERE, "..", "..", "client", "public", "cards");
  for (const file of readdirSync(dir)) {
    const match = /^([A-Za-z]{2}[0-9]{2})-([0-9]{3})(_[0-9A-Za-z]+)\.(jpg|png)$/i.exec(file);
    if (!match) continue;
    const code = `${match[1].toUpperCase()}-${match[2]}`;
    const list = byCode.get(code) ?? [];
    list.push(file.replace(/\.(jpg|png)$/i, ""));
    byCode.set(code, list);
  }
  for (const list of byCode.values()) list.sort();
  return byCode;
}

const PARALLELS = parallelArt();

interface Parsed {
  keywords: CardKeyword[];
  subtypes: string[];
  /** The x in "+2[follow-up attack]", when the card prints one. */
  followCount?: number;
  unknownTags: string[];
  /** The card printed a bare "[Leader Skill]" marker line. */
  leaderSkill: boolean;
}

/** Pulls the leading [Tags] off an ability line. */
function parseTags(text: string): Parsed {
  const keywords: CardKeyword[] = [];
  const subtypes: string[] = [];
  const unknownTags: string[] = [];
  let followCount: number | undefined;
  let leaderSkill = false;

  for (const match of text.matchAll(/\[([^\]]+)\]/g)) {
    const raw = match[1].trim();
    const key = raw.toLowerCase();

    if (LEADER_SKILL_TAGS.has(key)) {
      if (!keywords.includes("leader")) keywords.push("leader");
      leaderSkill = true;
      continue;
    }
    // A tag can be written as a pair: "[Enter] / [Level up]".
    const mapped = PRINTED_TAG_KEYWORD[key];
    if (!mapped) {
      unknownTags.push(raw);
      continue;
    }
    if (!keywords.includes(mapped)) keywords.push(mapped);

    if (mapped === "follow") {
      // Printed as "+8 [follow-up attack]", "+1[follow-up attack]" or just
      // "2[follow-up attack]" — the plus is not always there.
      const before = text.slice(0, match.index ?? 0);
      const amount = before.match(/\+?(\d+)\s*$/);
      followCount = amount ? Number(amount[1]) : 1;
    }
  }

  return { keywords, subtypes, followCount, unknownTags, leaderSkill };
}

function quote(value: string): string {
  return JSON.stringify(value);
}

interface Review {
  code: string;
  issue: string;
}

const review: Review[] = [];

function renderCard(card: SourceCard, set: string): string | null {
  const raw = card.code?.trim();
  if (!raw) return null;
  const code = CODE_FIXES[raw] ?? raw;
  if (code !== raw) review.push({ code, issue: `source had the number as "${raw}"` });

  const alt = PARALLELS.get(code) ?? [];
  const altLine =
    alt.length > 0 ? `
    altImageIds: [${alt.map(quote).join(", ")}],` : "";

  const stats = card.stats ?? {};
  const isCharacter = card.card_type === "Character";
  const rarity = (card.rarity ?? "").split("★").length - 1;

  const cardSubtypes: string[] = [];
  const parsedAbilities = (card.abilities ?? [])
    .map((ability) => ({ ability, text: (ability.text ?? "").trim() }))
    .filter((entry) => entry.text)
    .map((entry) => ({ ...entry, parsed: parseTags(entry.text) }));

  // A bare "[Leader Skill]" line gates the whole card, not just its own line.
  const cardIsLeaderSkill = parsedAbilities.some(
    (entry) => entry.parsed.leaderSkill && !entry.text.replace(/\[[^\]]+\]/g, "").trim()
  );

  const effectLines: string[] = [];
  for (const { ability, text, parsed } of parsedAbilities) {
    cardSubtypes.push(...parsed.subtypes);
    for (const tag of parsed.unknownTags) {
      review.push({ code, issue: `unmapped tag [${tag}]` });
    }

    // A line that is nothing but tags carries no ability of its own. The
    // "[Leader Skill]" marker is the common case; it has already been folded
    // into every other effect as the `leader` keyword.
    const stripped = text.replace(/\[[^\]]+\]/g, "").trim();
    if (!stripped) continue;

    const keywords = [...parsed.keywords];
    if (cardIsLeaderSkill && !keywords.includes("leader")) keywords.unshift("leader");
    // An ability with no timing tag at all states something that is simply
    // always true ("Encore's red cards get +1 damage"), which is what
    // `passive` means. Without it the engine would never look at the line.
    if (keywords.length === 0) keywords.push("passive");
    const condition = keywords.map(quote).join(", ");
    const follow =
      parsed.followCount !== undefined ? `\n        followCount: ${parsed.followCount},` : "";
    const textEn = ability.text_en?.trim();
    const textField = textEn
      ? `{\n          th: ${quote(text)},\n          en: ${quote(textEn)},\n        }`
      : `{ th: ${quote(text)} }`;

    effectLines.push(
      `      {\n        condition: [${condition}],${follow}\n        text: ${textField},\n      },`
    );
  }

  const effects =
    effectLines.length > 0 ? `[\n${effectLines.join("\n")}\n    ]` : "[]";

  const common = [
    `    id: ${quote(code)},`,
    `    name: ${quote(card.name_en || card.name || "")},`,
  ];

  if (isCharacter) {
    const level = Number(stats.Level);
    if (!Number.isInteger(level) || level < 0 || level > 2) {
      review.push({ code, issue: `level "${stats.Level}" is not 0-2` });
    }
    const rawWeapon = (stats.Weapon ?? "").toLowerCase();
    const weapon = WEAPON_ALIASES[rawWeapon] ?? rawWeapon;
    const element = (stats.Attribute ?? "").toLowerCase();
    if (stats.Weapon && !WEAPONS.includes(weapon)) {
      review.push({ code, issue: `unknown weapon "${stats.Weapon}"` });
    }
    if (stats.Attribute && !ELEMENTS.includes(element)) {
      review.push({ code, issue: `unknown attribute "${stats.Attribute}"` });
    }

    return `  defineCard({
    type: "leader",
${common.join("\n")}
    character: ${quote(card.tags?.[0] ?? card.name_en ?? card.name ?? "")},
    set: ${quote(set)},
    imageId: ${quote(code)},${altLine}
    level: ${Number.isInteger(level) && level >= 0 && level <= 2 ? level : 0},${
      rarity > 0 ? `\n    rarity: ${rarity},` : ""
    }${WEAPONS.includes(weapon) ? `\n    weapon: ${quote(weapon)},` : ""}${
      ELEMENTS.includes(element) ? `\n    element: ${quote(element)},` : ""
    }
    effects: ${effects},
  }),`;
  }

  const color = COLOR_TO_ENGLISH[(stats.Coloe ?? "").trim()];
  if (!color) review.push({ code, issue: `unknown colour "${stats.Coloe}"` });
  // Blue prints no Speed by design; anything else missing one is a data gap.
  if (!stats.Speed && color !== "blue") {
    review.push({ code, issue: "no Speed printed on the source row" });
  }

  const exclusive = stats["Exclusive Character name"]?.trim();
  const characterNames = new Set(
    [exclusive, card.name, card.name_en].filter(Boolean).map((v) => v!.toLowerCase())
  );
  const fromTags = (card.tags ?? [])
    .map((tag) => SUBTYPE_FIXES[tag.trim().toLowerCase()] ?? tag.trim())
    .filter(
      (tag) =>
        tag && !ELEMENT_TAGS.has(tag.toLowerCase()) && !characterNames.has(tag.toLowerCase())
    );
  const subtypeList = [...new Set([...cardSubtypes, ...fromTags])];

  return `  defineCard({
    type: "action",
${common.join("\n")}
    character: ${exclusive ? quote(exclusive) : "null"},
    set: ${quote(set)},
    imageId: ${quote(code)},${altLine}
    cost: ${Number(stats.cost) || 0},
    color: ${quote(color ?? "red")},
    speed: ${color === "blue" ? "null" : Number(stats.Speed) || 0},
    attack: ${Number(stats.attack) || 0},${
      rarity > 0 ? `\n    rarity: ${rarity},` : ""
    }${subtypeList.length ? `\n    subtypes: [${subtypeList.map(quote).join(", ")}],` : ""}
    effects: ${effects},
  }),`;
}

// --- fetch -----------------------------------------------------------------

async function fetchCards(): Promise<SourceCard[]> {
  const response = await fetch(`${API}?select=*&order=sort_order.asc`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  if (!response.ok) {
    throw new Error(`${API} responded ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as SourceCard[];
}

// --- main ------------------------------------------------------------------

async function main() {
const cards = await fetchCards();
if (cards.length === 0) {
  console.error("No cards came back from the site — nothing written.");
  process.exit(1);
}
console.log(`Fetched ${cards.length} cards from ${SITE}\n`);

const bySet = new Map<string, SourceCard[]>();
for (const card of cards) {
  const set = card.sources?.[0] ?? card.code?.split("-")[0];
  if (!set) continue;
  const list = bySet.get(set) ?? [];
  list.push(card);
  bySet.set(set, list);
}

let written = 0;
let preserved = 0;

for (const [set, list] of [...bySet.entries()].sort()) {
  const path = join(SETS_DIR, `${set}.ts`);
  if (!existsSync(path)) {
    console.log(`${set}: no set file — run npm run sync:cards first`);
    continue;
  }

  const existing = readFileSync(path, "utf8");
  // The importer never writes `resolve`, so a card that has one was worked on
  // by hand. Those are worth protecting; everything else is imported data and
  // can safely be refreshed.
  const handWritten = new Set<string>();
  for (const match of existing.matchAll(/^ {4}id: "([^"]+)"/gm)) {
    const blockStart = existing.lastIndexOf("  defineCard({", match.index ?? 0);
    const blockEnd = existing.indexOf("\n  }),", match.index ?? 0);
    if (blockStart < 0 || blockEnd < 0) continue;
    if (existing.slice(blockStart, blockEnd).includes("resolve:")) {
      handWritten.add(match[1]);
    }
  }

  const rendered: string[] = [];
  const kept: string[] = [];

  for (const card of list.sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""))) {
    const code = card.code?.trim();
    if (!code) continue;
    if (handWritten.has(code)) {
      kept.push(code);
      continue;
    }
    const block = renderCard(card, set);
    if (block) rendered.push(block);
  }

  // Keep the hand-written entries exactly as they are, drop the empty stubs,
  // and append everything imported.
  const keptBlocks: string[] = [];
  for (const code of kept) {
    const start = existing.indexOf(`  defineCard({\n    type:`);
    void start;
    const marker = existing.indexOf(`id: "${code}"`);
    const blockStart = existing.lastIndexOf("  defineCard({", marker);
    const blockEnd = existing.indexOf("  }),", marker) + "  }),".length;
    if (blockStart >= 0 && blockEnd > blockStart) {
      keptBlocks.push(existing.slice(blockStart, blockEnd));
    }
  }

  const header = existing.slice(0, existing.indexOf("export const"));
  const body = [...keptBlocks, ...rendered].join("\n");
  writeFileSync(path, `${header}export const ${set}: CardDef[] = [\n${body}\n];\n`, "utf8");

  written += rendered.length;
  preserved += keptBlocks.length;
  console.log(`${set}: ${rendered.length} imported, ${keptBlocks.length} hand-written kept`);
}

console.log(`\n${written} card(s) imported, ${preserved} left untouched.`);

if (review.length > 0) {
  console.log(`\n${review.length} thing(s) to look at by hand:`);
  const seen = new Set<string>();
  for (const item of review) {
    const line = `   ${item.code}: ${item.issue}`;
    if (seen.has(line)) continue;
    seen.add(line);
    console.log(line);
  }
}
}

main();
