import { useEffect, useState } from "react";

type Theme = "dark" | "light";
const storageKey = "agentcommons-theme";
/** Scalar (the embedded API reference) reads its own key from the same origin's storage. */
const scalarKey = "colorMode";

function read(): Theme {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* Storage can be disabled; the document default applies. */
  }
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
/** Apply the stored theme before the first paint so pages never flash. */
export function applyStoredTheme(): void {
  if (typeof document === "undefined") return;
  const theme = read();
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(scalarKey, theme);
  } catch {
    /* ignore */
  }
}
function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(storageKey, theme);
    localStorage.setItem(scalarKey, theme);
  } catch {
    /* Theme still applies to this page. */
  }
  window.dispatchEvent(
    new CustomEvent("agentcommons:theme", { detail: theme }),
  );
}
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setState] = useState<Theme>("dark");
  useEffect(() => {
    setState(read());
    const listener = (event: Event) => {
      const detail: unknown =
        event instanceof CustomEvent ? event.detail : null;
      if (detail === "dark" || detail === "light") setState(detail);
    };
    window.addEventListener("agentcommons:theme", listener);
    return () => {
      window.removeEventListener("agentcommons:theme", listener);
    };
  }, []);
  return {
    theme,
    toggle: () => {
      setTheme(theme === "dark" ? "light" : "dark");
    },
  };
}
