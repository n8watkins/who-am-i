import { useMemo, useRef, useState } from "react";
import { qrPath } from "../lib/qr";
import { roomUrl } from "../lib/router";
import { Button } from "./ui";

type CopyTarget = "link" | "code";

const COPIED_MS = 2000;
const spaced = (text: string) => text.split("").join(" ");

export function Invite({
  code,
  pin,
  seatFree,
  isHost,
  busy,
  onNewPin,
}: {
  code: string;
  pin: string | null;
  seatFree: boolean;
  isHost: boolean;
  busy: boolean;
  onNewPin: () => void;
}) {
  const url = roomUrl(code);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  const copy = async (text: string, target: CopyTarget) => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setCopyFailed(false);
      setCopied(target);
      timer.current = setTimeout(() => setCopied(null), COPIED_MS);
    } catch {
      setCopied(null);
      setCopyFailed(true);
      if (linkRef.current) getSelection()?.selectAllChildren(linkRef.current);
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: "Who Am I?", text: "Join my Who Am I? game", url });
    } catch {
      // Cancelled: the share sheet is the only feedback the player needs.
    }
  };

  const canShare = typeof navigator.share === "function";
  const { host, pathname } = new URL(url);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          {pin ? (
            <>
              <p className="text-sm font-extrabold uppercase tracking-wide text-muted">PIN</p>
              <p className="font-mono text-5xl font-black tracking-[0.1em] text-brand-ink" data-testid="room-pin" aria-label={`PIN ${spaced(pin)}`}>
                {pin}
              </p>
              <p className="mt-2 text-sm font-semibold text-muted">
                or code{" "}
                <span className="font-mono font-extrabold tracking-wider text-ink" data-testid="room-code" aria-label={`Room code ${spaced(code)}`}>
                  {code}
                </span>
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-extrabold uppercase tracking-wide text-muted">Room code</p>
              <p className="font-mono text-4xl font-black tracking-[0.1em] text-brand-ink" data-testid="room-code" aria-label={`Room code ${spaced(code)}`}>
                {code}
              </p>
            </>
          )}
          {isHost && pin && (
            <Button variant="ghost" className="-ml-5 mt-1" disabled={busy} onClick={onNewPin}>
              New PIN
            </Button>
          )}
        </div>
        {seatFree && <QrCode url={url} code={code} />}
      </div>

      <div className={`mt-4 grid gap-2.5 ${canShare ? "grid-cols-3" : "grid-cols-2"}`}>
        {canShare && (
          <Button variant="secondary" onClick={share}>
            Share
          </Button>
        )}
        <Button variant="secondary" onClick={() => copy(url, "link")}>
          <CopyLabel done={copied === "link"} label="Copy link" />
        </Button>
        <Button variant="secondary" onClick={() => copy(code, "code")}>
          <CopyLabel done={copied === "code"} label="Copy code" />
        </Button>
      </div>

      <a ref={linkRef} href={url} data-testid="invite-link" className="mt-3 flex justify-center text-sm font-semibold text-muted">
        <span className="min-w-0 truncate">{host}</span>
        <span className="shrink-0">{pathname}</span>
      </a>
      {copyFailed && <p className="mt-1 text-center text-sm font-semibold text-coral">Press and hold to copy</p>}
      <span className="sr-only" role="status">
        {copied ? `${copied === "code" ? "Code" : "Link"} copied` : ""}
      </span>
    </div>
  );
}

function CopyLabel({ done, label }: { done: boolean; label: string }) {
  if (!done) return label;
  return (
    <>
      <span aria-hidden="true">{"✓"}</span> Copied
    </>
  );
}

/** Always dark on white with a quiet zone, whatever the theme, so every scanner can read it. */
function QrCode({ url, code }: { url: string; code: string }) {
  const { d, size } = useMemo(() => qrPath(url), [url]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`QR code that opens room ${spaced(code)}`}
      data-testid="room-qr"
      shapeRendering="crispEdges"
      className="size-36 shrink-0 rounded-xl bg-white"
    >
      <path d={d} fill="#000" />
    </svg>
  );
}
