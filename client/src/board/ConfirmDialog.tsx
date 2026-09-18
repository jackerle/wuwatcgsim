import { useLang } from "../i18n/LanguageContext";

/**
 * A plain yes/no stop before a move that cannot be taken back.
 *
 * Moving the turn on is the case this exists for: leaving the Main Phase
 * throws away a Charge, a Level Up and a Switch you had not used yet, and
 * declining the clash gives up the attack. Both used to be one click on a
 * button labelled with a noun.
 *
 * Reuses the engine question dialog's chrome — to a player these are the
 * same kind of moment, so they should not look like different software.
 */
export function ConfirmDialog({
  prompt,
  detail,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  prompt: string;
  /** The consequence, when it is worth spelling out. */
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useLang();
  return (
    <div className="choice-backdrop" role="dialog" aria-modal="true">
      <div className="choice-dialog">
        <p className="choice-prompt">{prompt}</p>
        {detail && <p className="choice-detail">{detail}</p>}
        <div className="choice-actions">
          <button type="button" className="choice-no" onClick={onCancel}>
            {cancelLabel ?? t("confirmDialog.cancel")}
          </button>
          <button type="button" className="choice-yes" onClick={onConfirm}>
            {confirmLabel ?? t("confirmDialog.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
