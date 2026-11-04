import { useState } from "react";
import { DEFAULT_SETTINGS, NicknameSchema, type Settings } from "../../shared/protocol";
import { DifficultyPicker, MoreOptions, optionsSummary, PackPicker, StylePicker } from "../components/SettingsForm";
import { Banner, Button, Card, Dialog, Shell, TextField } from "../components/ui";
import { api, ApiRequestError, loadNickname, saveNickname, saveSession } from "../lib/api";
import { navigate } from "../lib/router";

export function Create() {
  const [nickname, setNickname] = useState(loadNickname);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

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
    <Shell wide>
      <form onSubmit={submit} noValidate>
        <h1 className="mb-4 text-3xl font-extrabold tracking-tight">New game</h1>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_21rem] md:items-start md:gap-6">
          <Card className="p-4 sm:p-5">
            <PackPicker value={settings} onChange={setSettings} />
          </Card>
          <Card className="space-y-4 p-4 sm:p-5">
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
            <StylePicker value={settings} onChange={setSettings} />
            <DifficultyPicker value={settings} onChange={setSettings} />
            <div>
              <p className="text-sm font-semibold text-muted" data-testid="options-summary">{optionsSummary(settings)}</p>
              <Button variant="ghost" className="-ml-5 !min-h-9 !py-1" onClick={() => setMoreOpen(true)}>
                More options
              </Button>
            </div>
            {error && (
              <Banner tone="error" role="alert">
                {error}
              </Banner>
            )}
            <Button type="submit" size="lg" block disabled={busy}>
              {busy ? "Creating..." : "Create game"}
            </Button>
          </Card>
        </div>
      </form>
      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="More options">
        <MoreOptions value={settings} onChange={setSettings} />
        <div className="mt-5">
          <Button block onClick={() => setMoreOpen(false)}>
            Done
          </Button>
        </div>
      </Dialog>
    </Shell>
  );
}
