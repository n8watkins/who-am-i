import { useEffect, useState } from "react";
import { NicknameSchema, type RoomPreview } from "../../shared/protocol";
import { MODE_LABELS, matchLabel, timerLabel } from "../components/SettingsForm";
import { Banner, Button, Card, Dialog, Shell, Spinner, TextField } from "../components/ui";
import { api, ApiRequestError, clearSession, loadNickname, loadSession, saveNickname, saveSession, type StoredSession } from "../lib/api";
import { navigate } from "../lib/router";
import { useRoom } from "../lib/useRoom";
import { Game } from "./Game";
import { Lobby } from "./Lobby";
import { MatchSummary, RoundSummary } from "./Summaries";

export function RoomPage({ code }: { code: string }) {
  const [session, setSession] = useState<StoredSession | null>(() => loadSession(code));
  if (!session) return <JoinRoom code={code} onJoined={setSession} />;
  return (
    <RoomScreen
      key={session.token}
      code={code}
      session={session}
      onSessionInvalid={() => {
        clearSession(code);
        setSession(null);
      }}
    />
  );
}

function JoinRoom({ code, onJoined }: { code: string; onJoined: (s: StoredSession) => void }) {
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [nickname, setNickname] = useState(loadNickname);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .preview(code)
      .then((p) => !cancelled && setPreview(p))
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiRequestError) setLoadError({ status: err.status, message: err.message });
        else setLoadError({ status: 0, message: "Could not load the room." });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = NicknameSchema.safeParse(nickname);
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? "Enter a nickname");
      return;
    }
    setNameError(null);
    setBusy(true);
    setError(null);
    try {
      const res = await api.join(code, parsed.data);
      saveNickname(parsed.data);
      const session = { token: res.token, playerId: res.playerId };
      saveSession(code, session);
      onJoined(session);
    } catch (err) {
      if (err instanceof ApiRequestError && err.body.error === "room_full") {
        setPreview((p) => (p ? { ...p, full: true } : p));
      }
      setError(err instanceof ApiRequestError ? err.message : "Could not join. Try again.");
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <Shell>
        <Card className="mt-6 text-center">
          <h1 className="text-2xl font-extrabold">{loadError.status === 404 ? "Room not found" : "Something went wrong"}</h1>
          <p className="mt-2 text-muted">
            {loadError.status === 404 ? `There is no active room with the code ${code}. It may have expired.` : loadError.message}
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Button onClick={() => navigate("/join")}>Try another code</Button>
            <Button variant="secondary" onClick={() => navigate("/new")}>
              Create a new game
            </Button>
          </div>
        </Card>
      </Shell>
    );
  }
  if (!preview) return <Shell><Spinner label="Finding the room" /></Shell>;

  if (preview.full) {
    return (
      <Shell>
        <Card className="mt-6 text-center">
          <h1 className="text-2xl font-extrabold">This room is full</h1>
          <p className="mt-2 text-muted">Room {code} already has two players. Who Am I? is a two-player game.</p>
          <div className="mt-6">
            <Button block onClick={() => navigate("/new")}>
              Start your own game
            </Button>
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-muted">Room {code}</p>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {preview.hostNickname ? `Join ${preview.hostNickname}'s game` : "Join this game"}
          </h1>
        </div>
        <Card>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="font-bold text-muted">Category</dt>
              <dd className="text-base font-extrabold">{preview.pack.name}</dd>
            </div>
            <div>
              <dt className="font-bold text-muted">Mode</dt>
              <dd className="text-base font-extrabold">{MODE_LABELS[preview.settings.mode].name}</dd>
            </div>
            <div>
              <dt className="font-bold text-muted">Timer</dt>
              <dd className="text-base font-extrabold">{timerLabel(preview.settings)}</dd>
            </div>
            <div>
              <dt className="font-bold text-muted">Match</dt>
              <dd className="text-base font-extrabold">{matchLabel(preview.settings)}</dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-line pt-4 text-sm text-muted">
            Opponent: <strong className="text-ink">{preview.hostNickname ?? "waiting"}</strong>
          </p>
        </Card>
        <Card>
          <TextField
            label="Your nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={20}
            autoComplete="nickname"
            placeholder="e.g. Alex"
            error={nameError}
            autoFocus
          />
        </Card>
        {error && (
          <Banner tone="error" role="alert">
            {error}
          </Banner>
        )}
        <Button type="submit" size="lg" block disabled={busy}>
          {busy ? "Joining..." : "Join game"}
        </Button>
      </form>
    </Shell>
  );
}

function RoomScreen({ code, session, onSessionInvalid }: { code: string; session: StoredSession; onSessionInvalid: () => void }) {
  const room = useRoom(code, session);
  const { view, fatal, error, clearError, connection } = room;
  const [leaveOpen, setLeaveOpen] = useState(false);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 6000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  useEffect(() => {
    if (fatal === "left") {
      clearSession(code);
      navigate("/", { replace: true });
    }
  }, [fatal, code]);

  if (fatal === "expired" || fatal === "unauthorized") {
    return (
      <Shell>
        <Card className="mt-6 text-center">
          <h1 className="text-2xl font-extrabold">{fatal === "expired" ? "This room has closed" : "Your seat is no longer available"}</h1>
          <p className="mt-2 text-muted">
            {fatal === "expired"
              ? "Rooms close after an hour without activity."
              : "Your session for this room is no longer valid. You can try to join again."}
          </p>
          <div className="mt-6 flex flex-col gap-3">
            {fatal === "unauthorized" && <Button onClick={onSessionInvalid}>Join again</Button>}
            <Button variant={fatal === "unauthorized" ? "secondary" : "primary"} onClick={() => { clearSession(code); navigate("/new"); }}>
              Create a new game
            </Button>
          </div>
        </Card>
      </Shell>
    );
  }

  if (!view) return <Shell><Spinner label="Connecting to the room" /></Shell>;

  const leave = async () => {
    setLeaveOpen(false);
    const ok = await room.send("player.leave");
    if (ok) {
      clearSession(code);
      navigate("/", { replace: true });
    }
  };

  const status = view.status;
  const content =
    status === "lobby" ? (
      <Lobby room={room} view={view} />
    ) : status === "round_summary" ? (
      <RoundSummary room={room} view={view} />
    ) : status === "match_summary" ? (
      <MatchSummary room={room} view={view} />
    ) : (
      <Game room={room} view={view} />
    );

  return (
    <Shell
      wide={status !== "lobby"}
      aside={
        <Button variant="ghost" onClick={() => setLeaveOpen(true)} aria-label="Leave room">
          Leave
        </Button>
      }
    >
      <div className="space-y-3" aria-live="polite">
        {connection === "reconnecting" && (
          <Banner tone="warn" role="status">
            Connection lost. Reconnecting...
          </Banner>
        )}
        {error && (
          <Banner tone="error" role="alert" onDismiss={clearError}>
            {error}
          </Banner>
        )}
      </div>
      <div className={connection === "reconnecting" || error ? "mt-3" : ""}>{content}</div>
      <Dialog open={leaveOpen} onClose={() => setLeaveOpen(false)} title="Leave this room?">
        <p className="text-muted">
          {status === "lobby"
            ? "Your seat will be freed for someone else."
            : "This ends the current match for both players. Your seat will be freed."}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setLeaveOpen(false)}>
            Stay
          </Button>
          <Button variant="danger" onClick={leave}>
            Leave room
          </Button>
        </div>
      </Dialog>
    </Shell>
  );
}
