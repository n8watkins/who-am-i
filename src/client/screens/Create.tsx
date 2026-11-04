import { useState } from "react";
import { DEFAULT_SETTINGS, NicknameSchema, type Settings } from "../../shared/protocol";
import { SettingsForm } from "../components/SettingsForm";
import { Banner, Button, Card, Shell, TextField } from "../components/ui";
import { api, ApiRequestError, loadNickname, saveNickname, saveSession } from "../lib/api";
import { navigate } from "../lib/router";

export function Create() {
  const [nickname, setNickname] = useState(loadNickname);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      const res = await api.createRoom({ nickname: parsed.data, settings });
      saveNickname(parsed.data);
      saveSession(res.view.code, { token: res.token, playerId: res.playerId });
      navigate(`/r/${res.view.code}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not create the game. Try again.");
      setBusy(false);
    }
  };

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <h1 className="text-3xl font-extrabold tracking-tight">New game</h1>
        <Card>
          <TextField
            label="Your nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={20}
            autoComplete="nickname"
            placeholder="e.g. Sam"
            error={nameError}
            autoFocus
          />
        </Card>
        <Card>
          <SettingsForm value={settings} onChange={setSettings} />
        </Card>
        {error && (
          <Banner tone="error" role="alert">
            {error}
          </Banner>
        )}
        <div className="sticky bottom-0 -mx-4 bg-gradient-to-t from-paper via-paper to-paper/0 px-4 pb-4 pt-6 sm:static sm:mx-0 sm:bg-none sm:p-0">
          <Button type="submit" size="lg" block disabled={busy}>
            {busy ? "Creating..." : "Create game"}
          </Button>
        </div>
      </form>
    </Shell>
  );
}
