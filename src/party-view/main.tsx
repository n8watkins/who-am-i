// The room view's page (index.html beside the module a party room mounts, public/view.js).
import "@fontsource-variable/nunito";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isBigScreen, partyHost } from "./host";
import { PartyApp } from "./PartyApp";
import "./styles.css";

// The game's own site sets the theme before first paint with a script; here it follows the phone.
document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const host = partyHost();
const root = document.getElementById("root")!;
if (host) {
  // The big screen is read from across the room: every size in rem grows with the screen (styles.css).
  // A member watching as a screen from their own phone (a seat of their own) is laid out as a phone.
  if (isBigScreen(host.you)) document.documentElement.dataset.screen = "big";
  createRoot(root).render(
    <StrictMode>
      <PartyApp host={host} />
    </StrictMode>,
  );
} else {
  root.textContent = "This page shows a match of Who Am I? inside a party room.";
}
