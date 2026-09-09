import { Moon, Sun } from "lucide-react";
import { copy } from "../../copy";
import { useTheme } from "../../lib/theme";
import { Button } from "../ui/button";

/** The one light/dark switch, shared by the public site, the account pages and the app. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={
        theme === "dark"
          ? copy.app.common.theme.light
          : copy.app.common.theme.dark
      }
    >
      {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
