// The Tutorial screen: a list of lessons, and a lesson being played.
//
// A lesson is a real match on the real board (PlayGame), with the guide laid
// over it — see director.ts for how the script keeps the match on course.

import { useEffect, useState } from "react";
import { PlayGame } from "../game/PlayGame";
import { useLang } from "../i18n/LanguageContext";
import { GuideOverlay } from "./GuideOverlay";
import { LESSONS } from "./lessons";
import { useTutorialMatch } from "./useTutorialMatch";
import type { Lesson } from "./director";
import "../menu/MainMenu.css";
import "./Tutorial.css";

// Which lessons this browser has finished. A convenience only — losing it
// just means the ticks are gone, so every access is allowed to fail.
const DONE_KEY = "wuwatcg.tutorialDone";

function finishedLessons(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function markFinished(id: string): void {
  try {
    const done = new Set(finishedLessons());
    done.add(id);
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
  } catch {
    // Private window or blocked storage: the lesson still counts, it is just
    // not remembered.
  }
}

function LessonGame({ lesson, onLeave }: { lesson: Lesson; onLeave: () => void }) {
  const { lang, t } = useLang();
  const tutorial = useTutorialMatch(lesson);

  useEffect(() => {
    if (tutorial.finished) markFinished(lesson.id);
  }, [tutorial.finished, lesson.id]);

  return (
    <main className="page board-page">
      <PlayGame match={tutorial.match} onLeave={onLeave} />
      {tutorial.step ? (
        <GuideOverlay
          step={tutorial.step}
          index={tutorial.index}
          total={tutorial.total}
          nudges={tutorial.nudges}
          onNext={tutorial.next}
          onExit={onLeave}
        />
      ) : (
        <div className="tut-done-backdrop">
          <div className="tut-done" role="dialog" aria-modal="true">
            <h2>{t("tutorial.doneTitle")}</h2>
            <p>{t("tutorial.doneBody", lesson.title[lang])}</p>
            <div className="tut-done-actions">
              <button type="button" onClick={tutorial.match.restart}>
                {t("tutorial.again")}
              </button>
              <button type="button" className="primary" onClick={onLeave}>
                {t("tutorial.backToLessons")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export function Tutorial({ onBack }: { onBack: () => void }) {
  const { lang, t } = useLang();
  const [playing, setPlaying] = useState<Lesson | null>(null);
  // Read again whenever the list comes back into view, so a lesson just
  // finished shows its tick.
  const done = playing ? [] : finishedLessons();

  if (playing) {
    return <LessonGame key={playing.id} lesson={playing} onLeave={() => setPlaying(null)} />;
  }

  return (
    <main className="page play-page">
      <div className="play-panel">
        <div className="play-head">
          <h1>{t("tutorial.title")}</h1>
          <span className="play-spacer" />
          <button type="button" onClick={onBack}>
            {t("common.back")}
          </button>
        </div>

        <p className="tut-intro">{t("tutorial.intro")}</p>

        {LESSONS.map((lesson, i) => (
          <section key={lesson.id} className="play-card tut-lesson">
            <div className="room-row">
              <div className="room-row-main">
                <div className="room-row-host">
                  {i + 1}. {lesson.title[lang]}
                  {done.includes(lesson.id) && <span className="tut-tick"> ✓ {t("tutorial.finished")}</span>}
                </div>
                <div className="room-row-sub">{lesson.blurb[lang]}</div>
              </div>
              <button type="button" className="primary" onClick={() => setPlaying(lesson)}>
                {done.includes(lesson.id) ? t("tutorial.replay") : t("tutorial.start")}
              </button>
            </div>
          </section>
        ))}

        <p className="play-empty">{t("tutorial.more")}</p>
      </div>
    </main>
  );
}
