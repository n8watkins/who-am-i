// The room socket handshake as a real browser performs it. Request addresses and headers end up
// in the platform's logs, so the session token may only travel inside the socket (its first
// message). Chrome's DevTools protocol shows the exact handshake the browser sends.
import { expect, test, type Page } from "@playwright/test";
import { createGame, joinGame, newPlayer } from "./support";

interface Wire {
  /** Every socket the page opened: its address, its handshake headers and the frames it sent. */
  sockets: Map<string, { url: string; headers: Record<string, string>; sent: string[] }>;
  /** Every HTTP request address the page asked for. */
  urls: string[];
}

async function recordWire(page: Page): Promise<Wire> {
  const wire: Wire = { sockets: new Map(), urls: [] };
  page.on("request", (request) => wire.urls.push(request.url()));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const socket = (id: string) => {
    if (!wire.sockets.has(id)) wire.sockets.set(id, { url: "", headers: {}, sent: [] });
    return wire.sockets.get(id)!;
  };
  cdp.on("Network.webSocketCreated", (e) => void (socket(e.requestId).url = e.url));
  cdp.on("Network.webSocketWillSendHandshakeRequest", (e) => void (socket(e.requestId).headers = e.request.headers as Record<string, string>));
  cdp.on("Network.webSocketFrameSent", (e) => void socket(e.requestId).sent.push(e.response.payloadData));
  return wire;
}

async function storedToken(page: Page, code: string): Promise<string> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), `whoami:session:${code}`);
  return (JSON.parse(raw!) as { token: string }).token;
}

function expectNoTokenOutside(wire: Wire, token: string) {
  const signature = token.split(".")[2]!;
  const outside = [...wire.urls, ...[...wire.sockets.values()].flatMap((s) => [s.url, ...Object.entries(s.headers).flat()])];
  expect(outside.length).toBeGreaterThan(0);
  for (const text of outside) {
    expect(text.includes(token), `token in ${text.slice(0, 120)}`).toBe(false);
    expect(text.includes(signature), `token signature in ${text.slice(0, 120)}`).toBe(false);
  }
}

test("the socket's address and headers carry no token; its first message does", async ({ browser }) => {
  const alice = await newPlayer(browser, { mobile: true });
  const bob = await newPlayer(browser, { mobile: true });
  const aliceWire = await recordWire(alice.page);
  const bobWire = await recordWire(bob.page);

  const { code, link } = await createGame(alice.page, { nickname: "Alice" });
  await joinGame(bob.page, link, "Bob");
  await expect(alice.page.getByTestId("slot-B")).toContainText("Bob");
  // A refresh opens a fresh socket the same way.
  await bob.page.reload();
  await expect(bob.page.getByTestId("slot-B")).toContainText("Bob (you)");
  await expect(alice.page.getByTestId("slot-B")).toContainText("Bob");

  for (const [page, wire, minSockets] of [[alice.page, aliceWire, 1], [bob.page, bobWire, 2]] as const) {
    const token = await storedToken(page, code);
    expectNoTokenOutside(wire, token);
    const sockets = [...wire.sockets.values()].filter((s) => s.url.endsWith(`/api/rooms/${code}/ws`));
    expect(sockets.length).toBeGreaterThanOrEqual(minSockets);
    for (const s of sockets) {
      const protocolHeader = Object.entries(s.headers).find(([k]) => k.toLowerCase() === "sec-websocket-protocol")?.[1];
      expect(protocolHeader).toBe("whoami.v2");
      expect(JSON.parse(s.sent[0]!)).toEqual({ type: "hello", token });
    }
  }

  await alice.context.close();
  await bob.context.close();
});

test("a page still on the old header handshake is closed with the room-closed code and gets nothing", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const { code } = await createGame(alice.page, { nickname: "Alice" });
  const token = await storedToken(alice.page, code);
  // Exactly what pages built before the fix do.
  const result = await alice.page.evaluate(
    ({ code, token }) =>
      new Promise<{ protocol: string; code: number; messages: number }>((resolve) => {
        const ws = new WebSocket(`ws://${location.host}/api/rooms/${code}/ws`, ["whoami.v1", `token.${token}`]);
        let messages = 0;
        ws.onmessage = () => void messages++;
        ws.onclose = (e) => resolve({ protocol: ws.protocol, code: e.code, messages });
      }),
    { code, token },
  );
  expect(result).toEqual({ protocol: "whoami.v1", code: 4000, messages: 0 });
  // The real page's own socket is unaffected.
  await expect(alice.page.getByTestId("room-code")).toHaveText(code);
  await alice.context.close();
});

test("an out-of-date page reloads once, then shows a reload screen instead of looping", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const { code } = await createGame(alice.page, { nickname: "Alice" });
  // Stand in for a future server that no longer speaks this page's handshake.
  let socketsRefused = 0;
  await alice.page.routeWebSocket(/\/api\/rooms\/[^/]+\/ws$/, (ws) => {
    ws.onMessage(() => {
      socketsRefused++;
      void ws.close({ code: 4004, reason: "expected_hello" });
    });
  });
  let loads = 0;
  alice.page.on("load", () => void loads++);
  await alice.page.reload();
  await expect(alice.page.getByRole("heading", { name: "This page is out of date" })).toBeVisible();
  // One reload by hand above, one by the page itself, and no more.
  expect(loads).toBe(2);
  expect(socketsRefused).toBe(2);
  await alice.page.waitForTimeout(1_500);
  expect(loads).toBe(2);
  expect(socketsRefused).toBe(2);
  expect(await storedToken(alice.page, code)).toBeTruthy();
  await alice.context.close();
});
