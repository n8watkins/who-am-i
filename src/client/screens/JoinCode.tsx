import { useState } from "react";
import { ROOM_CODE_LENGTH, RoomCodeSchema } from "../../shared/protocol";
import { Button, Card, Shell, TextField } from "../components/ui";
import { navigate } from "../lib/router";

export function JoinCode() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = RoomCodeSchema.safeParse(code);
    if (!parsed.success) {
      setError(`Room codes are ${ROOM_CODE_LENGTH} letters and numbers.`);
      return;
    }
    navigate(`/r/${parsed.data}`);
  };
  return (
    <Shell>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <h1 className="text-3xl font-extrabold tracking-tight">Join a game</h1>
        <Card>
          <TextField
            label="Room code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={8}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="ABC123"
            hint="Ask the host for the code shown in their lobby."
            error={error}
            className="font-mono tracking-[0.3em]"
            autoFocus
          />
        </Card>
        <Button type="submit" size="lg" block>
          Continue
        </Button>
      </form>
    </Shell>
  );
}
