// The "report a bug" form: a few words from the player, sent to the server,
// which posts them to the developers' Discord channel (server/src/bugReport.ts)
// together with the match they were playing.

import { useState } from "react";
import { createPortal } from "react-dom";
import type { BugReportError } from "@wuwatcg/shared";
import { socket } from "../socket";
import { rememberedName } from "../identity";
import { useLang } from "../i18n/LanguageContext";
import type { StringKey } from "../i18n/strings";
import "./BugReport.css";

const MAX_LENGTH = 2000;

const ERROR_TEXT: Record<BugReportError, StringKey> = {
  empty: "bugReport.errorEmpty",
  cooldown: "bugReport.errorCooldown",
  unavailable: "bugReport.errorUnavailable",
  failed: "bugReport.errorFailed",
};

export function BugReport({
  where,
  snapshot,
  onClose,
}: {
  /** Which screen it was opened from, for whoever reads the report. */
  where: string;
  /** A local game to attach whole — see BugReport.snapshot in shared. */
  snapshot?: () => unknown;
  onClose: () => void;
}) {
  const { t, lang } = useLang();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | BugReportError>("idle");

  const send = () => {
    if (!text.trim()) {
      setStatus("empty");
      return;
    }
    setStatus("sending");
    let attached: unknown;
    try {
      attached = snapshot?.();
    } catch {
      attached = undefined;
    }
    socket.timeout(15_000).emit(
      "reportBug",
      {
        text: text.trim(),
        playerName: rememberedName() || undefined,
        where,
        lang,
        userAgent: navigator.userAgent,
        snapshot: attached,
      },
      (timedOut, result) => {
        if (timedOut) setStatus("failed");
        else setStatus("error" in result ? result.error : "sent");
      }
    );
  };

  const sent = status === "sent";
  const dialog = (
    <div className="bug-backdrop" role="dialog" aria-modal="true" aria-labelledby="bug-title">
      <div className="bug-dialog">
        <h2 id="bug-title">{t("bugReport.title")}</h2>
        {sent ? (
          <p className="bug-status ok">{t("bugReport.sent")}</p>
        ) : (
          <>
            <p className="bug-hint">{t("bugReport.hint")}</p>
            <textarea
              value={text}
              maxLength={MAX_LENGTH}
              placeholder={t("bugReport.placeholder")}
              autoFocus
              onChange={(event) => setText(event.target.value)}
            />
            {status !== "idle" && status !== "sending" && (
              <p className="bug-status error">{t(ERROR_TEXT[status])}</p>
            )}
          </>
        )}
        <div className="bug-actions">
          <button type="button" onClick={onClose}>
            {sent ? t("common.close") : t("confirmDialog.cancel")}
          </button>
          {!sent && (
            <button type="button" className="primary" disabled={status === "sending"} onClick={send}>
              {status === "sending" ? t("bugReport.sending") : t("bugReport.send")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
  return createPortal(dialog, document.body);
}
