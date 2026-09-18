import { useEffect, useState } from "react";
import type { DeckList } from "@wuwatcg/shared";
import { renderDeckImage } from "./deckImage";
import { useLang } from "../i18n/LanguageContext";

/**
 * Turns the deck being built into one PNG and shows it — a leader row up
 * top, every card below with its copy count, ready to download or drop
 * straight into a chat. Reuses the transfer dialog's own chrome, since to a
 * player this is the same kind of "get this deck out of the app" moment
 * Import/Export already are.
 */
export function ShareDeckDialog({ deck, onClose }: { deck: DeckList; onClose: () => void }) {
  const { t } = useLang();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canCopyImage = typeof navigator !== "undefined" && !!navigator.clipboard?.write && typeof ClipboardItem !== "undefined";

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    renderDeckImage(deck, {
      leaders: t("deckBuilder.shareLeaders"),
      cards: t("deckBuilder.shareCards"),
      total: (n) => t("deckBuilder.shareTotal", n),
    }).then((dataUrl) => {
      if (!cancelled) setUrl(dataUrl);
    });
    return () => {
      cancelled = true;
    };
    // Regenerates on a language switch too, so the section labels baked
    // into the image (drawn once, not live text) match.
  }, [deck, t]);

  async function copyImage() {
    if (!url) return;
    try {
      const blob = await (await fetch(url)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setCopied(true);
    } catch {
      // Not every browser allows writing images to the clipboard — the
      // download button beside this is the fallback that always works.
    }
  }

  return (
    <div className="deck-dialog-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="deck-dialog share-deck-dialog" onClick={(event) => event.stopPropagation()}>
        <h3>{t("deckBuilder.shareTitle")}</h3>
        <div className="share-deck-preview">
          {url ? (
            <img src={url} alt={deck.name} />
          ) : (
            <p className="deck-dialog-hint">{t("deckBuilder.shareGenerating")}</p>
          )}
        </div>
        <div className="deck-dialog-actions">
          <button type="button" onClick={onClose}>
            {t("common.close")}
          </button>
          {url && canCopyImage && (
            <button type="button" onClick={copyImage}>
              {copied ? t("deckBuilder.copied") : t("deckBuilder.shareCopyImage")}
            </button>
          )}
          {url && (
            <a className="primary" href={url} download={`${deck.name || "deck"}.png`}>
              {t("deckBuilder.shareDownload")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
