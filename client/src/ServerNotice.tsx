// A strip across the top for something the server has to say about itself.
// So far that is one thing: "I am about to restart".
//
// Mounted beside App rather than inside it. App returns a different screen
// from a dozen places, and a notice about the server has to sit over all of
// them — including a board mid-match — so it cannot be something any one
// screen renders. `position: fixed` also keeps it out of #root's flex
// layout, so nothing below it moves when it appears.

import { useEffect, useState } from "react";
import type { ServerNotice as Notice } from "@wuwatcg/shared";
import { socket } from "./socket";
import { useLang } from "./i18n/LanguageContext";
import "./ServerNotice.css";

export function ServerNotice() {
  const { t } = useLang();
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const onNotice = (next: Notice) => setNotice(next);
    // The socket is back, so whatever the notice was warning about has
    // happened and is over. This is also what clears the banner on the far
    // side of the restart it was announcing.
    const onConnect = () => setNotice(null);
    socket.on("serverNotice", onNotice);
    socket.on("connect", onConnect);
    return () => {
      socket.off("serverNotice", onNotice);
      socket.off("connect", onConnect);
    };
  }, []);

  if (!notice) return null;
  return (
    <div className="server-notice" role="status">
      {t("notice.restarting")}
    </div>
  );
}
