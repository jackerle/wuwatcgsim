import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@wuwatcg/shared";
import { useLang } from "../i18n/LanguageContext";

/**
 * Table talk.
 *
 * `messages` is null when there is nobody to talk to — both players are at the
 * same screen and can just speak — so the panel says so rather than offering
 * a box that sends into the void.
 */
export function ChatPanel({
  messages,
  onSend,
}: {
  messages: ChatMessage[] | null;
  onSend: (text: string) => void;
}) {
  const { t } = useLang();
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  // Follow the conversation down as it grows, the way a chat should.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages?.length]);

  if (!messages) {
    return (
      <div className="side-panel chat-panel">
        <div className="side-panel-header">Chat</div>
        <div className="side-panel-body placeholder">{t("chatPanel.sameScreen")}</div>
      </div>
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  }

  return (
    <div className="side-panel chat-panel">
      <div className="side-panel-header">Chat</div>
      <div className="side-panel-body chat-log">
        {messages.length === 0 ? (
          <div className="placeholder">{t("chatPanel.empty")}</div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="chat-line">
              <span className="chat-from">{message.from}</span>
              <span className="chat-text">{message.text}</span>
            </div>
          ))
        )}
        <div ref={bottom} />
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("chatPanel.placeholder")}
          maxLength={300}
        />
        <button type="submit" disabled={!draft.trim()}>
          {t("chatPanel.send")}
        </button>
      </form>
    </div>
  );
}
