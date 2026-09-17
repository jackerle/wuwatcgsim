import { CardArt } from "./CardImage";
import { useHoverPreview } from "./HoverPreviewContext";

/**
 * Large card preview, docked beside the board. Always reserves its layout
 * space (a fixed-width flex column) so the board doesn't shift width when
 * a hover starts/stops — it just shows/hides the image inside.
 *
 * CardArt rather than a bare <img>: 27 cards have no file under their base
 * imageId and only exist as parallel art, and this panel is the one place
 * that used to show them broken.
 */
export function HoverPreviewPanel() {
  const { hovered } = useHoverPreview();

  return (
    <div className="hover-preview-panel">
      {hovered && <CardArt card={hovered} />}
    </div>
  );
}
