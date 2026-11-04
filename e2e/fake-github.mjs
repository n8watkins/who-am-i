// A stand-in for GitHub's OAuth endpoints, used only by the E2E tests.
import { URL } from "node:url";
import { createServer } from "node:http";

const PORT = 8789;
createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/login/oauth/authorize") {
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", "fake-code");
    back.searchParams.set("state", url.searchParams.get("state"));
    res.writeHead(302, { Location: back.toString() }).end();
  } else if (url.pathname === "/login/oauth/access_token") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ access_token: "fake-token" }));
  } else if (url.pathname === "/user") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ id: 4242, login: "alice-dev", name: "Alice Dev", avatar_url: null }));
  } else {
    res.writeHead(url.pathname === "/health" ? 200 : 404).end();
  }
}).listen(PORT, "127.0.0.1");
