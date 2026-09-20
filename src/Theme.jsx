import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { Moon, Sun } from "lucide-react";

const ThemeContext = createContext(null);
const storageKey = "nudge-theme";

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content =
      theme === "dark" ? "#19181d" : "#f6f5f2";
  }, [theme]);
  useEffect(() => {
    const sync = (event) => {
      if (event.key === storageKey || event.key === null)
        setTheme(event.newValue === "light" ? "light" : "dark");
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  function chooseTheme(value) {
    setTheme(value);
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      /* Still works when storage is unavailable. */
    }
  }
  return (
    <ThemeContext.Provider value={{ theme, chooseTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeToggle() {
  const { theme, chooseTheme } = useContext(ThemeContext);
  const next = theme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => chooseTheme(next)}
    >
      {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}

export function ThemeSettings() {
  const { theme, chooseTheme } = useContext(ThemeContext);
  return (
    <section className="panel appearance-panel" aria-label="Appearance">
      <div>
        <h2>Appearance</h2>
        <p className="muted">
          Your theme preference saves automatically in this browser.
        </p>
      </div>
      <div className="theme-options" role="group" aria-label="Color theme">
        <button
          type="button"
          className="theme-option"
          aria-pressed={theme === "light"}
          onClick={() => chooseTheme("light")}
        >
          <Sun size={19} />
          <span>
            Light<small>Warm, light surfaces</small>
          </span>
        </button>
        <button
          type="button"
          className="theme-option"
          aria-pressed={theme === "dark"}
          onClick={() => chooseTheme("dark")}
        >
          <Moon size={19} />
          <span>
            Dark<small>Soft charcoal surfaces</small>
          </span>
        </button>
      </div>
    </section>
  );
}
