// The guide: a card of text beside the board, and a glowing ring around
// whatever on the board it is talking about.
//
// The rings find their targets by CSS selector every frame rather than being
// wired into the board's components — the board stays exactly the board a
// real match uses, and a card that moves (dealt, dragged, laid down) is
// followed wherever it goes.

import { useEffect, useRef, useState } from "react";
import { getCard, type CardDef } from "@wuwatcg/shared";
import { CardArt } from "../board/CardImage";
import type { HoverPreviewCard } from "../board/HoverPreviewContext";
import { useLang } from "../i18n/LanguageContext";
import type { GuideFigure, GuideStep, Text } from "./director";

interface Ring {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Room left around a target, so the ring does not sit on its edge. */
const RING_PAD = 4;

/** Every on-screen box the selectors match, re-measured each frame. */
function useRings(selectors: string[] | undefined): Ring[] {
  const [rings, setRings] = useState<Ring[]>([]);
  const last = useRef("");
  const key = (selectors ?? []).join("\n");

  useEffect(() => {
    if (!key) {
      last.current = "";
      setRings([]);
      return;
    }
    let frame = 0;
    const measure = () => {
      const found: Ring[] = [];
      for (const selector of key.split("\n")) {
        document.querySelectorAll(selector).forEach((element) => {
          const box = element.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) return;
          found.push({
            top: Math.round(box.top - RING_PAD),
            left: Math.round(box.left - RING_PAD),
            width: Math.round(box.width + RING_PAD * 2),
            height: Math.round(box.height + RING_PAD * 2),
          });
        });
      }
      // Only a real change re-renders: most frames nothing has moved.
      const signature = JSON.stringify(found);
      if (signature !== last.current) {
        last.current = signature;
        setRings(found);
      }
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [key]);

  return rings;
}

function preview(card: CardDef): HoverPreviewCard {
  return {
    cardId: card.id,
    imageId: card.imageId,
    name: card.name,
    kind: card.type === "action" ? "action" : "character",
  };
}

/** Red beats green beats blue beats red, as three dots and three arrows. */
function Triangle() {
  const { lang } = useLang();
  const name = lang === "th" ? { red: "แดง", green: "เขียว", blue: "น้ำเงิน" } : { red: "Red", green: "Green", blue: "Blue" };
  const beats = lang === "th" ? "ชนะ" : "beats";
  // Dots at the corners of an equilateral triangle; each arrow runs from the
  // winner to the colour it beats, stopping short of both dots.
  const at = { red: [100, 26], green: [172, 150], blue: [28, 150] } as const;
  const arrow = (from: keyof typeof at, to: keyof typeof at) => {
    const [x1, y1] = at[from];
    const [x2, y2] = at[to];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    const cut = 30 / length;
    return (
      <line
        key={`${from}-${to}`}
        x1={x1 + dx * cut}
        y1={y1 + dy * cut}
        x2={x2 - dx * cut}
        y2={y2 - dy * cut}
        className={`tut-arrow tut-arrow-${from}`}
        markerEnd={`url(#tut-head-${from})`}
      />
    );
  };
  return (
    <svg className="tut-triangle" viewBox="0 0 200 180" role="img" aria-label={`${name.red} ${beats} ${name.green}, ${name.green} ${beats} ${name.blue}, ${name.blue} ${beats} ${name.red}`}>
      <defs>
        {(["red", "green", "blue"] as const).map((color) => (
          <marker key={color} id={`tut-head-${color}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className={`tut-head-${color}`} />
          </marker>
        ))}
      </defs>
      {arrow("red", "green")}
      {arrow("green", "blue")}
      {arrow("blue", "red")}
      {(["red", "green", "blue"] as const).map((color) => (
        <g key={color}>
          <circle cx={at[color][0]} cy={at[color][1]} r="22" className={`tut-dot tut-dot-${color}`} />
          <text x={at[color][0]} y={at[color][1] + 4} textAnchor="middle" className="tut-dot-label">
            {name[color]}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Summary() {
  const { lang } = useLang();
  const rows =
    lang === "th"
      ? [
          ["สีต่างกัน", "แดง > เขียว > น้ำเงิน > แดง"],
          ["แดง/เขียว สีเดียวกัน", "Speed สูงกว่าชนะ"],
          ["Speed เท่ากัน", "เจ้าของเทิร์นชนะ"],
          ["น้ำเงิน/น้ำเงิน", "เสมอ — ไม่มีอะไรเกิดขึ้น"],
          ["ผู้ชนะ", "ทำดาเมจเท่าการ์ดที่ชนะ + ได้ Advantage เทิร์นถัดไป"],
          ["ชนะด้วยแดง", "Follow-up ไม่จำกัด"],
          ["ชนะด้วยเขียว/น้ำเงิน", "Follow-up ตาม [Follow X] เท่านั้น"],
          ["Follow-up", "ต้องเป็นการ์ดแดง ดาเมจเข้าตรง"],
        ]
      : [
          ["Different colours", "Red > Green > Blue > Red"],
          ["Red/green, same colour", "Higher Speed wins"],
          ["Equal Speed", "The turn player wins"],
          ["Blue vs blue", "A draw — nothing happens"],
          ["The winner", "Deals the winning card's damage + Advantage next turn"],
          ["Won with red", "Unlimited follow-ups"],
          ["Won with green/blue", "Only its [Follow X]"],
          ["A follow-up", "Always a red card; damage goes straight in"],
        ];
  return (
    <table className="tut-summary">
      <tbody>
        {rows.map(([when, then]) => (
          <tr key={when}>
            <th>{when}</th>
            <td>{then}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Two columns of lesson text: a keyword and what it means, say. */
function Table({ rows }: { rows: [Text, Text][] }) {
  const { lang } = useLang();
  return (
    <table className="tut-summary">
      <tbody>
        {rows.map(([when, then]) => (
          <tr key={when.en}>
            <th>{when[lang]}</th>
            <td>{then[lang]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Figure({ figure }: { figure: GuideFigure }) {
  if (figure.kind === "triangle") return <Triangle />;
  if (figure.kind === "summary") return <Summary />;
  if (figure.kind === "table") return <Table rows={figure.rows} />;
  const cards = figure.cards.map((id) => getCard(id)).filter((card): card is CardDef => Boolean(card));
  return (
    <div className="tut-cards">
      {cards.map((card, index) => (
        <span key={`${card.id}-${index}`} className="tut-card-wrap">
          {figure.vs && index === 1 && <span className="tut-vs">VS</span>}
          <CardArt card={preview(card)} className="tut-card" />
        </span>
      ))}
    </div>
  );
}

export function GuideOverlay({
  step,
  index,
  total,
  nudges,
  onNext,
  onExit,
}: {
  step: GuideStep;
  index: number;
  total: number;
  nudges: number;
  onNext: () => void;
  onExit: () => void;
}) {
  const { lang, t } = useLang();
  const [shown, setShown] = useState(!step.delayMs);
  const [collapsed, setCollapsed] = useState(false);
  const [shaking, setShaking] = useState(false);

  // A step that explains a reveal waits for the reveal to finish playing.
  useEffect(() => {
    setShown(!step.delayMs);
    setCollapsed(false);
    if (!step.delayMs) return;
    const timer = window.setTimeout(() => setShown(true), step.delayMs);
    return () => window.clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    if (nudges === 0) return;
    setShaking(true);
    setCollapsed(false);
    const timer = window.setTimeout(() => setShaking(false), 500);
    return () => window.clearTimeout(timer);
  }, [nudges]);

  const rings = useRings(shown ? step.highlight : undefined);
  const reading = "next" in step.advance;
  const last = index === total - 1;

  return (
    <>
      {shown && reading && <div className="tut-scrim" aria-hidden="true" />}
      {rings.map((ring, i) => (
        <div key={i} className="tut-ring" style={ring} aria-hidden="true" />
      ))}
      {shown && (
        <aside
          className={`tut-box ${shaking ? "tut-shake" : ""} ${collapsed ? "tut-collapsed" : ""}`}
          data-step={step.id}
          // What the step is waiting for, for a test driving the page.
          data-move={"move" in step.advance ? step.advance.move.kind : undefined}
          data-move-card={"move" in step.advance ? step.advance.move.card : undefined}
          data-move-color={"move" in step.advance ? step.advance.move.color : undefined}
          aria-live="polite"
        >
          <header className="tut-head">
            <span className="tut-count">
              {index + 1} / {total}
            </span>
            <h2 className="tut-title">{step.title[lang]}</h2>
            <button
              type="button"
              className="tut-icon"
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? t("tutorial.expand") : t("tutorial.collapse")}
              aria-label={collapsed ? t("tutorial.expand") : t("tutorial.collapse")}
            >
              {collapsed ? "▴" : "▾"}
            </button>
          </header>
          {!collapsed && (
            <>
              {step.figure && <Figure figure={step.figure} />}
              <div className="tut-body">
                {step.body[lang].split("\n").map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
              <footer className="tut-foot">
                <button type="button" className="tut-exit" onClick={onExit}>
                  {t("tutorial.exit")}
                </button>
                {reading ? (
                  <button type="button" className="primary" onClick={onNext} autoFocus>
                    {last ? t("tutorial.finish") : t("tutorial.next")}
                  </button>
                ) : (
                  <span className="tut-waiting">
                    {"move" in step.advance ? t("tutorial.yourMove") : t("tutorial.watch")}
                  </span>
                )}
              </footer>
            </>
          )}
        </aside>
      )}
    </>
  );
}
