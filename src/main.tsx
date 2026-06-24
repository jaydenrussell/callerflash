import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ToastWindow } from "./components/ToastWindow";

// Two render modes share the same bundled HTML so Vite singlefile stays simple:
//   • Normal app:    index.html           → <App />
//   • Toast window:  index.html?toast=1   → <ToastWindow />
// The toast window is a frameless, transparent, always-on-top Electron
// BrowserWindow created by main.cjs for incoming-call toasts so they
// still appear when the main window is hidden to the system tray.
const isToastWindow =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("toast") === "1";

if (isToastWindow && typeof document !== "undefined") {
  // The toast window has no chrome; body must be transparent.
  document.body.classList.add("toast-window");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isToastWindow ? <ToastWindow /> : <App />}
  </StrictMode>
);
