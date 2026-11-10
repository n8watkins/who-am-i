// Applies the saved or system theme before first paint (see src/kit/client/theme.ts).
(function () {
  var pref = null;
  try {
    pref = localStorage.getItem("kit:theme");
  } catch {
    // Storage blocked: follow the system.
  }
  var dark = pref === "dark" || (pref !== "light" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();
