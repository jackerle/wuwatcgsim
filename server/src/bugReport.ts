// Bug reports, delivered to a Discord channel through a webhook.
//
// A webhook is a URL that posts into one channel — no bot to run, nothing to
// log in to. It is a secret: anyone holding it can post there, so it lives in
// the server's .env (DISCORD_BUG_WEBHOOK_URL) and never in the client or git.
// Unset, reports are refused as "unavailable" rather than silently dropped.
//
// Each report carries the player's words plus a JSON file of the match it was
// sent from. The engine is deterministic, so that file is enough to rebuild
// the board exactly as the player saw it — which beats any description.

import type { BugReport, BugReportError } from "@wuwatcg/shared";
import type { RoomRecord } from "./roomManager.js";

const WEBHOOK = process.env.DISCORD_BUG_WEBHOOK_URL ?? "";

/**
 * The webhook belongs to a forum channel: each report opens a post of its
 * own, titled from what the player wrote, instead of one long channel of
 * messages. Only a first guess — when it is wrong Discord says so, and the
 * report is sent again the other way (see FORUM_NEEDS_TITLE).
 */
const FORUM = /^(1|true|yes)$/i.test(process.env.DISCORD_BUG_FORUM ?? "");

/**
 * Forum tags to put on every post, as a comma-separated list of tag ids
 * (right-click a tag → Copy ID, with Developer Mode on). Optional.
 */
const FORUM_TAGS = (process.env.DISCORD_BUG_FORUM_TAGS ?? "")
  .split(",")
  .map((tag) => tag.trim())
  .filter(Boolean);

/**
 * Discord's error codes for posting to the wrong kind of channel: a forum
 * webhook sent no post title, or an ordinary channel's webhook sent one.
 */
const FORUM_NEEDS_TITLE = 220001;
const NOT_A_FORUM = 220003;

/** Discord's limit on a forum post's title. */
const MAX_TITLE = 100;

/** One report a minute per player: enough to add a detail, not to flood. */
const COOLDOWN_MS = 60_000;
/** Discord's limit on an embed's description. */
const MAX_TEXT = 4000;
/** Past this the attachment is not worth what it costs to send. */
const MAX_ATTACHMENT = 5_000_000;

const lastReport = new Map<string, number>();

/**
 * A player's words, made unable to mention anyone.
 *
 * allowed_mentions below already stops them pinging, but "@everyone" would
 * still show as a highlighted mention; a zero-width space after every @ makes
 * it plain text. Role and user mentions (<@...>) are broken the same way.
 */
function defang(text: string): string {
  return text.replace(/@/g, "@\u200b");
}

/** "abc" → "abc", with the length capped and the tail marked. */
function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export async function sendBugReport(
  report: BugReport,
  who: { playerId: string; name: string | null; record: RoomRecord | null }
): Promise<BugReportError | null> {
  const text = defang(String(report.text ?? "").trim());
  if (!text) return "empty";
  if (!WEBHOOK) return "unavailable";

  const now = Date.now();
  const last = lastReport.get(who.playerId) ?? 0;
  if (now - last < COOLDOWN_MS) return "cooldown";
  lastReport.set(who.playerId, now);

  const record = who.record;
  const session = record?.session ?? null;
  const state = session?.state ?? null;

  const fields = [
    { name: "Player", value: cap(defang(who.name ?? "(not in a room)"), 100), inline: true },
    { name: "Room", value: record ? `${record.room.code} (${record.room.visibility})` : "-", inline: true },
    { name: "Where", value: cap(String(report.where ?? "-"), 100), inline: true },
    ...(state
      ? [
          {
            name: "Match",
            value: `turn ${state.turnNumber} · ${state.phase} · ${state.turnPlayerId}'s turn${state.winnerId ? ` · won by ${state.winnerId}` : ""}`,
            inline: false,
          },
        ]
      : []),
    { name: "Browser", value: cap(`${report.lang ?? "?"} · ${report.userAgent ?? "?"}`, 300), inline: false },
  ];

  // Everything needed to rebuild the board: for an online match the server's
  // own, whole state (both hands — this goes to the developers, not to the
  // other player); for a local one, what the browser sent.
  const attachment = JSON.stringify(
    {
      reportedAt: new Date(now).toISOString(),
      where: report.where,
      online: session
        ? {
            room: record?.room.code,
            seed: record?.seed,
            state: session.state,
            question: session.question,
            log: session.log,
          }
        : null,
      local: report.snapshot ?? null,
    },
    null,
    1
  );

  const post = (asForumPost: boolean): Promise<Response> => {
    const form = new FormData();
    form.append(
      "payload_json",
      JSON.stringify({
        username: "WuwaTCGSim bug report",
        // Nobody gets pinged by whatever a player types, @everyone included.
        allowed_mentions: { parse: [] },
        ...(asForumPost
          ? {
              // "[match (vs bot)] BP01-062 costs 2 with Advantage", first line only.
              thread_name: cap(`[${report.where ?? "?"}] ${text.split("\n")[0]}`, MAX_TITLE),
              ...(FORUM_TAGS.length > 0 ? { applied_tags: FORUM_TAGS } : {}),
            }
          : {}),
        embeds: [
          {
            title: "🐞 Bug report",
            description: cap(text, MAX_TEXT),
            color: 0xe05252,
            fields,
            timestamp: new Date(now).toISOString(),
          },
        ],
      })
    );
    if (attachment.length <= MAX_ATTACHMENT) {
      const name = `bug-${record?.room.code ?? "local"}-${now}.json`;
      form.append("files[0]", new Blob([attachment], { type: "application/json" }), name);
    }
    return fetch(WEBHOOK, { method: "POST", body: form });
  };

  try {
    let asForumPost = FORUM;
    let response = await post(asForumPost);
    // Guessed the channel wrong — a forum needs a post title, an ordinary
    // channel refuses one. Discord says which, so try once the other way
    // rather than lose the report over a setting.
    if (response.status === 400) {
      const body = await response.text();
      const code = (() => {
        try {
          return (JSON.parse(body) as { code?: number }).code;
        } catch {
          return undefined;
        }
      })();
      if (code === FORUM_NEEDS_TITLE || code === NOT_A_FORUM) {
        asForumPost = code === FORUM_NEEDS_TITLE;
        response = await post(asForumPost);
      } else {
        console.error("bug report: Discord answered 400", body);
        lastReport.delete(who.playerId);
        return "failed";
      }
    }
    if (!response.ok) {
      console.error(`bug report: Discord answered ${response.status}`, await response.text());
      lastReport.delete(who.playerId);
      return "failed";
    }
    return null;
  } catch (error) {
    console.error("bug report: could not reach Discord", error);
    // Not the player's fault: let them try again straight away.
    lastReport.delete(who.playerId);
    return "failed";
  }
}
