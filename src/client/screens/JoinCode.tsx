import { useState } from "react";
import { PinSchema, ROOM_CODE_LENGTH, PIN_LENGTH, RoomCodeSchema } from "../../shared/protocol";
import { Button, Card, Shell, TextField } from "../components/ui";
import { api, ApiRequestError } from "../lib/api";
import { navigate } from "../lib/router";

export function JoinCode() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (PinSchema.safeParse(trimmed).success) {
      setBusy(true);
      setError(null);
      try {
        const preview = await api.lookUpJoin(trimmed);
        navigate(`/r/${preview.code}`);
      } catch (err) {
        setBusy(false);
        setError(
          err instanceof ApiRequestError && err.status === 404
            ? "No open game has that PIN. Check it with the host."
            : err instanceof ApiRequestError
              ? err.message
              : "Could not look that up. Try again.",
        );
      }
      return;
    }
    const code = RoomCodeSchema.safeParse(trimmed);
    if (!code.success) {
      setError(`Enter the ${PIN_LENGTH}-digit PIN or the ${ROOM_CODE_LENGTH}-character room code.`);
      return;
    }
    navigate(`/r/${code.data}`);
  };

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <h1 className="text-3xl font-extrabold tracking-tight">Join a game</h1>
        <Card>
          {/* Stays a text field: room codes have letters, and a number pad would hide them. */}
          <TextField
            label="PIN or room code"
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            maxLength={8}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="4817"
            hint="Ask the host, or look at the big screen."
            error={error}
            className="font-mono tracking-[0.3em]"
            autoFocus
          />
        </Card>
        <Button type="submit" size="lg" block disabled={busy}>
          {busy ? "Finding the game..." : "Continue"}
        </Button>
      </form>
    </Shell>
  );
}
