import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Cigarette,
  Clock3,
  Download,
  Dumbbell,
  Eye,
  Footprints,
  Hand,
  LayoutDashboard,
  Mic,
  Leaf,
  Link2,
  LoaderCircle,
  LogOut,
  Monitor,
  Moon,
  MoreHorizontal,
  Plus,
  Radio,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sprout,
  Target,
  Trash2,
  TrendingUp,
  Undo2,
  Volume2,
  X,
} from "lucide-react";
import "./styles.css";
import "./owl-theme.css";
import "./light-theme.css";
import { ThemeProvider, ThemeSettings, ThemeToggle } from "./Theme.jsx";
import { OwlCompanion, OwlIntro } from "./Owl.jsx";
import { habitPresets, habitFromPreset } from "../shared/habit-presets.js";

const icons = {
  posture: Activity,
  screen: Eye,
  mindfulness: Hand,
  movement: Footprints,
  hydration: Leaf,
  sleep: Moon,
  smoking: Cigarette,
  lifting: Dumbbell,
  other: Target,
};
const labels = {
  posture: "Posture",
  screen: "Screen time",
  mindfulness: "Mindfulness",
  movement: "Movement",
  hydration: "Hydration",
  sleep: "Sleep",
  smoking: "Smoking",
  lifting: "Lifting technique",
  other: "Personal",
};
const navItems = [
  ["Overview", LayoutDashboard],
  ["My habits", Sprout],
  ["Insights", TrendingUp],
  ["Notifications", Bell],
  ["Devices & robot", Monitor],
];
const blankHabit = {
  name: "",
  description: "",
  category: "posture",
  dailyLimit: 5,
  reminderMinutes: 0,
  active: true,
};
async function api(url, method = "GET", body) {
  const response = await fetch(`/api${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Cannot reach Nudge. Check that the server is running.");
  }
  if (!response.ok)
    throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}
async function playApiAudio(url, method = "GET", body) {
  const response = await fetch(`/api${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    let data;
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    throw new Error(data.error || "Something went wrong. Please try again.");
  }
  const audio = new Audio(URL.createObjectURL(await response.blob()));
  audio.addEventListener("ended", () => URL.revokeObjectURL(audio.src), {
    once: true,
  });
  await audio.play();
  return audio;
}
function dateKey(date, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
}
function relative(date) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(date)) / 60000));
  return min < 1
    ? "Just now"
    : min < 60
      ? `${min}m ago`
      : min < 1440
        ? `${Math.floor(min / 60)}h ago`
        : `${Math.floor(min / 1440)}d ago`;
}
function Logo({ small = false }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <img src="/icon.svg" alt="" />
      <span>
        nudge<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
function Modal({ title, onClose, children }) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function App() {
  const [showIntro, setShowIntro] = useState(() => {
    try {
      return sessionStorage.getItem("nudge-owl-welcomed") !== "yes";
    } catch {
      return true;
    }
  });
  const enterWorkspace = useCallback(() => {
    try {
      sessionStorage.setItem("nudge-owl-welcomed", "yes");
    } catch {
      /* Storage may be disabled. */
    }
    setShowIntro(false);
    requestAnimationFrame(() => {
      const heading = document.querySelector("h1");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    });
  }, []);
  const [session, setSession] = useState(null),
    [state, setState] = useState(null),
    [page, setPage] = useState("Overview");
  const [error, setError] = useState(""),
    [toast, setToast] = useState(null),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null),
    [connect, setConnect] = useState(false),
    [help, setHelp] = useState(false),
    [robotKey, setRobotKey] = useState(""),
    [voiceCheck, setVoiceCheck] = useState(null);
  const [filter, setFilter] = useState("All habits"),
    [installPrompt, setInstallPrompt] = useState(null);
  async function load() {
    const data = await api("/state");
    setState(data);
    return data;
  }
  useEffect(() => {
    api("/session")
      .then(async (s) => {
        setSession(s);
        if (s.authenticated) await load();
      })
      .catch((e) => setError(e.message));
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    const install = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", install);
    return () => window.removeEventListener("beforeinstallprompt", install);
  }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    const timer = setInterval(() => {
      load().catch((e) => setError(e.message));
    }, 15000);
    return () => clearInterval(timer);
  }, [session?.authenticated]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  async function act(fn, message) {
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      await load();
      if (message)
        setToast({
          text: typeof message === "function" ? message(result) : message,
        });
      return result;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function logHabit(habit) {
    const result = await act(() =>
      api("/events", "POST", { habitId: habit.id }),
    );
    if (result)
      setToast({
        text: `${habit.name} logged. Awareness is a good first step.`,
        undo: result.id,
      });
  }
  async function testNudge() {
    await act(
      () => api("/notifications/test", "POST"),
      (r) =>
        r.devices === 0
          ? "Connect a device first to receive a test nudge."
          : `Push service accepted ${r.sent} notification${r.sent === 1 ? "" : "s"}${r.failed ? `; ${r.failed} failed` : ""}. Check your devices.`,
    );
  }
  if (showIntro) return <OwlIntro onEnter={enterWorkspace} />;
  if (!session || (session.authenticated && !state))
    return (
      <div className="loading">
        <Logo />
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button
              className="button primary"
              onClick={() => location.reload()}
            >
              Try again
            </button>
          </>
        ) : (
          <LoaderCircle className="spin" />
        )}
      </div>
    );
  if (!session.authenticated)
    return (
      <div className="auth-page">
        <div className="auth-top">
          <Logo />
          <div className="theme-header-actions">
            <span className="auth-tagline">YOUR EVERYDAY COMPANION</span>
            <ThemeToggle />
          </div>
        </div>
        <div className="auth-grid">
          <div>
            <div className="eyebrow">
              <span className="status-dot" /> SMALL STEPS. REAL CHANGE.
            </div>
            <h1>
              A little awareness.
              <br />A healthier <em>you.</em>
            </h1>
            <p>
              Meet the companion that helps you notice your habits, find your
              rhythm, and make a little progress every day.
            </p>
            <OwlCompanion />
            <div className="auth-foot">
              <ShieldCheck size={17} /> A private space for your everyday
              progress.
            </div>
          </div>
          <form
            className="auth-card"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const form = new FormData(e.currentTarget);
              try {
                await api("/session", "POST", {
                  name: form.get("name"),
                  password: form.get("password"),
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                });
                await load();
                setSession({ setup: true, authenticated: true });
              } catch (err) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <span className="icon-tile green">
              <Sprout />
            </span>
            <h2>
              {session.setup ? "Welcome back." : "Make yourself at home."}
            </h2>
            <p>
              {session.setup
                ? "Use your workspace passphrase to pick up where you left off, on any device."
                : "Create your personal workspace. Connect your phone and laptop with the same passphrase."}
            </p>
            {!session.setup && (
              <label>
                Your first name
                <input
                  name="name"
                  placeholder="e.g. Jayden"
                  maxLength={40}
                  required
                  autoComplete="given-name"
                />
              </label>
            )}
            <label>
              Workspace passphrase
              <input
                name="password"
                type="password"
                minLength={10}
                maxLength={128}
                placeholder="At least 10 characters"
                required
                autoComplete={
                  session.setup ? "current-password" : "new-password"
                }
              />
            </label>
            {!session.setup && (
              <small>
                Save this passphrase. You’ll use it to sign in on your other
                devices.
              </small>
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary wide" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  {session.setup ? "Open my dashboard" : "Start my journey"}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
            <span className="auth-caption">
              A HACKMIT 2026 PROJECT · BUILT WITH CARE
            </span>
          </form>
        </div>
      </div>
    );
  const timezone = state.settings.timezone;
  const today = dateKey(new Date(), timezone);
  const todayEvents = state.events.filter(
    (e) => dateKey(e.createdAt, timezone) === today,
  );
  const active = state.habits.filter((h) => h.active);
  const countFor = (id) => todayEvents.filter((e) => e.habitId === id).length;
  const onTrack = active.filter((h) => countFor(h.id) < h.dailyLimit).length;
  const enabledDevices = state.devices.filter((d) => d.enabled);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date()),
  );
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const filtered = state.habits.filter(
    (h) =>
      filter === "All habits" || (filter === "Active" ? h.active : !h.active),
  );
  const navigation = (value) => {
    setPage(value);
    setError("");
  };
  function habitCards(habits) {
    return (
      <div className="habit-grid">
        {habits.map((h) => {
          const Icon = icons[h.category];
          const count = countFor(h.id);
          const reached = count >= h.dailyLimit;
          return (
            <article
              className={`habit-card ${!h.active ? "paused" : ""}`}
              key={h.id}
            >
              <div className="habit-top">
                <span className={`icon-tile ${h.category}`}>
                  <Icon size={21} />
                </span>
                <span
                  className={`pill ${!h.active ? "neutral" : reached ? "amber" : "green"}`}
                >
                  {!h.active
                    ? "Paused"
                    : reached
                      ? "Time for a reset"
                      : "On track"}
                </span>
                <button
                  className="icon-button habit-menu"
                  aria-label={`Edit ${h.name}`}
                  onClick={() => setEditing(h)}
                >
                  <MoreHorizontal size={21} />
                </button>
                {state.voice?.configured && (
                  <button
                    className="icon-button habit-menu"
                    aria-label={`Hear ${h.name} nudge`}
                    onClick={() =>
                      playApiAudio("/voice/speak", "POST", {
                        text:
                          h.description ||
                          `Check in with your ${h.name.toLowerCase()} habit.`,
                      }).catch((error) => setError(error.message))
                    }
                  >
                    <Volume2 size={18} />
                  </button>
                )}
              </div>
              <h3>{h.name}</h3>
              <p>
                {h.description || "A little awareness makes room for change."}
              </p>
              <div className="habit-count">
                <strong>
                  {count}
                  <span> / {h.dailyLimit}</span>
                </strong>
                <span>occurrences today</span>
              </div>
              <div className="progress-track">
                <span
                  style={{
                    width: `${Math.min(100, (count / h.dailyLimit) * 100)}%`,
                  }}
                  className={reached ? "over" : ""}
                />
              </div>
              <div className="habit-bottom">
                <span>
                  <Clock3 size={13} />
                  {h.reminderMinutes
                    ? `Nudge every ${h.reminderMinutes}m`
                    : "Nudge at daily limit"}
                </span>
                <button
                  disabled={busy || !h.active}
                  onClick={() => logHabit(h)}
                >
                  <Plus size={15} /> Log
                </button>
                {state.voice?.configured && h.category === "sleep" && (
                  <button
                    disabled={busy || !h.active}
                    onClick={() => setVoiceCheck(h)}
                  >
                    <Mic size={15} /> Voice check
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    );
  }
  function activityList(limit = 5) {
    return (
      <div className="activity-list">
        {state.events.slice(0, limit).map((event) => {
          const habit = state.habits.find((h) => h.id === event.habitId);
          const Icon = icons[habit?.category] || Activity;
          return (
            <div className="activity-row" key={event.id}>
              <span className={`icon-tile small ${habit?.category}`}>
                <Icon size={17} />
              </span>
              <div>
                <strong>{habit?.name || "Habit"} logged</strong>
                <span>
                  {event.source === "robot"
                    ? "Robot detected an occurrence"
                    : "You checked in. That counts."}
                </span>
              </div>
              <time>{relative(event.createdAt)}</time>
              <button
                className="icon-button"
                aria-label={`Undo ${habit?.name} entry`}
                onClick={() =>
                  act(
                    () => api(`/events/${event.id}`, "DELETE"),
                    "Entry removed.",
                  )
                }
                disabled={busy}
              >
                <Undo2 size={15} />
              </button>
            </div>
          );
        })}
        {!state.events.length && (
          <div className="empty">
            <span className="icon-tile green">
              <Sprout />
            </span>
            <h3>Your next small step starts here.</h3>
            <p>
              Log a habit when you notice it. Your check-ins will appear here.
            </p>
          </div>
        )}
      </div>
    );
  }
  function chart() {
    const keys = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - (6 - i));
      return d.toISOString().slice(0, 10);
    });
    const values = keys.map(
      (key) =>
        state.events.filter((e) => dateKey(e.createdAt, timezone) === key)
          .length,
    );
    const max = Math.max(4, ...values);
    return (
      <div
        className="chart"
        aria-label="Occurrences logged over the past seven days"
      >
        <div className="chart-grid">
          <span>{max}</span>
          <span>{Math.round(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="chart-bars">
          {keys.map((key, i) => (
            <div className="chart-column" key={key}>
              <div className="bar-space">
                <span
                  className={`chart-bar ${i === 6 ? "current" : ""}`}
                  style={{
                    height: `${values[i] ? Math.max(5, (values[i] / max) * 100) : 2}%`,
                  }}
                  title={`${key}: ${values[i]} occurrences`}
                >
                  {values[i] > 0 && <b>{values[i]}</b>}
                </span>
              </div>
              <span className={i === 6 ? "today-label" : ""}>
                {new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
                  weekday: "short",
                  timeZone: "UTC",
                })}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navItems.map(([label, Icon]) => (
            <button
              className={page === label ? "selected" : ""}
              key={label}
              onClick={() => navigation(label)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {label === "Notifications" && enabledDevices.length > 0 && (
                <span className="nav-count">{enabledDevices.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-companion">
          <span className="sidebar-companion-icon">
            <img className="companion-mark" src="/icon.svg" alt="" />
          </span>
          <strong>
            A little companion.
            <br />A big difference.
          </strong>
          <p>
            A watchful little friend
            <br />
            for your everyday.
          </p>
          <button onClick={() => setShowIntro(true)}>
            Say hello to your owl <ArrowRight size={14} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            onClick={() => navigation("Settings")}
            className={page === "Settings" ? "selected" : ""}
          >
            <Settings2 size={18} /> Settings
          </button>
          <button onClick={() => setHelp(true)}>
            <CircleHelp size={18} /> Help & getting started
          </button>
          <div className="profile">
            <span className="avatar">
              {state.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{state.name}’s workspace</strong>
              <small>A little better, every day</small>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                try {
                  await api("/session", "DELETE");
                  setSession({ setup: true, authenticated: false });
                  setState(null);
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            My workspace <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-right">
            <ThemeToggle />
            <span className="live-status">
              <span className="status-dot" /> Workspace online
            </span>
            <span className="divider" />
            <button
              className="icon-button"
              aria-label="Open notifications"
              onClick={() => navigation("Notifications")}
            >
              <Bell size={19} />
            </button>
            <span className="avatar small">
              {state.name.slice(0, 1).toUpperCase()}
            </span>
          </div>
        </header>
        <main>
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={18} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "Overview" ? dateLabel : "SMALL STEPS. REAL CHANGE."}
              </div>
              <h1>
                {page === "Overview" ? (
                  <>
                    {greeting}, {state.name}{" "}
                    <span className="greeting-sun">☀</span>
                  </>
                ) : (
                  page
                )}
              </h1>
              <p>
                {
                  {
                    Overview:
                      "A little more awareness. A little better, every day.",
                    "My habits":
                      "Notice the patterns. Make room for better ones.",
                    Insights: "Your patterns, one check-in at a time.",
                    Notifications: "A gentle reminder, wherever you are.",
                    "Devices & robot": "One companion. All your devices.",
                    Settings: "Make Nudge feel like you.",
                  }[page]
                }
              </p>
            </div>
            {["Overview", "My habits"].includes(page) && (
              <button
                className="button primary"
                onClick={() => setEditing(blankHabit)}
              >
                <Plus size={17} /> Add habit
              </button>
            )}
          </div>
          {page === "Overview" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <span className="hero-label">
                    <Moon size={14} /> A LITTLE WISER, ONE DAY AT A TIME
                  </span>
                  <h2>
                    Small nudges.
                    <br />
                    Softer landings.
                  </h2>
                  <p>
                    You don’t have to change everything at once.
                    <br />
                    Just notice, reset, and keep growing.
                  </p>
                  <button
                    className="button hero-button"
                    onClick={() => navigation("My habits")}
                  >
                    Let’s check in <ArrowRight size={16} />
                  </button>
                </div>
                <button
                  className="hero-owl-button"
                  aria-label="Replay your owl’s welcome"
                  onClick={() => setShowIntro(true)}
                >
                  <OwlCompanion />
                </button>
                <div className="hero-note">
                  <span className="status-dot" /> Your owl’s got your back
                </div>
              </section>
              <div className="stats-grid">
                <Stat
                  icon={Sprout}
                  label="Habits you’re tracking"
                  value={active.length}
                  sub="One small step at a time"
                />
                <Stat
                  icon={Target}
                  label="Within your daily limits"
                  value={`${onTrack}/${active.length}`}
                  sub={
                    todayEvents.length
                      ? "Based on your logged check-ins"
                      : "Ready for your first check-in"
                  }
                  tone="mint"
                />
                <Stat
                  icon={Activity}
                  label="Check-ins today"
                  value={todayEvents.length}
                  sub="Every moment of awareness counts"
                  tone="peach"
                />
                <Stat
                  icon={Link2}
                  label="Connected devices"
                  value={state.devices.length}
                  sub={`${enabledDevices.length} ready to receive nudges`}
                  tone="lavender"
                />
              </div>
              <div className="section-heading">
                <div>
                  <h2>
                    Your habits{" "}
                    <span className="count-badge">{active.length}</span>
                  </h2>
                  <p>A little attention goes a long way.</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => navigation("My habits")}
                >
                  View all habits <ArrowRight size={15} />
                </button>
              </div>
              {active.length ? (
                habitCards(active.slice(0, 4))
              ) : (
                <EmptyHabits onAdd={() => setEditing(blankHabit)} />
              )}
              <div className="bottom-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>A week of awareness</h2>
                      <p>Logged occurrences · fewer can mean progress</p>
                    </div>
                    <span className="subtle-chip">Last 7 days</span>
                  </div>
                  {chart()}
                  <div className="chart-caption">
                    <span className="legend-dot" /> Habit occurrences{" "}
                    <span>Consistency begins with noticing.</span>
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Recent activity</h2>
                      <p>Little moments that add up.</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigation("Insights")}
                    >
                      View all <ArrowRight size={14} />
                    </button>
                  </div>
                  {activityList(3)}
                </section>
              </div>
            </>
          )}
          {page === "My habits" && (
            <>
              <div className="filter-tabs">
                {["All habits", "Active", "Paused"].map((f) => (
                  <button
                    key={f}
                    className={filter === f ? "active" : ""}
                    onClick={() => setFilter(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
              {filtered.length ? (
                habitCards(filtered)
              ) : (
                <EmptyHabits onAdd={() => setEditing(blankHabit)} />
              )}
              <div className="info-strip">
                <Leaf size={19} />
                <p>
                  Daily limits are personal intentions. Log an occurrence when
                  you notice a habit; Nudge offers a gentle reset when you reach
                  your limit.
                </p>
              </div>
              <section className="preset-library" aria-label="Habit presets">
                <div className="section-heading">
                  <div>
                    <h2>Start with a preset</h2>
                    <p>Pick a pattern to notice. Customize it before adding.</p>
                  </div>
                  <span className="subtle-chip">8 starting points</span>
                </div>
                <div className="preset-grid">
                  {habitPresets.map((preset) => {
                    const Icon = icons[preset.category];
                    const added = state.habits.some(
                      (h) =>
                        h.name.trim().toLowerCase() ===
                        preset.name.toLowerCase(),
                    );
                    return (
                      <button
                        key={preset.key}
                        className="preset-card"
                        disabled={added}
                        onClick={() => setEditing(habitFromPreset(preset))}
                        aria-label={
                          added
                            ? `${preset.name} already added`
                            : `Use ${preset.name} preset`
                        }
                      >
                        <span className={`icon-tile ${preset.category}`}>
                          <Icon size={20} />
                        </span>
                        <span className="preset-copy">
                          <strong>{preset.name}</strong>
                          <span>{preset.hint}</span>
                          {preset.future && (
                            <small>ElevenLabs voice challenge · planned</small>
                          )}
                        </span>
                        {added ? <Check size={17} /> : <Plus size={17} />}
                      </button>
                    );
                  })}
                </div>
              </section>
            </>
          )}
          {page === "Insights" && (
            <>
              <div className="stats-grid three">
                <Stat
                  icon={Activity}
                  label="Check-ins this week"
                  value={
                    state.events.filter(
                      (e) => Date.now() - new Date(e.createdAt) < 7 * 86400000,
                    ).length
                  }
                  sub="Awareness is where change begins"
                />
                <Stat
                  icon={Bot}
                  label="Robot observations"
                  value={
                    state.events.filter((e) => e.source === "robot").length
                  }
                  sub="In the last 31 days"
                  tone="lavender"
                />
                <Stat
                  icon={Target}
                  label="Within limits today"
                  value={`${onTrack}/${active.length}`}
                  sub="Based on logged occurrences"
                  tone="mint"
                />
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Your week, at a glance</h2>
                    <p>
                      Logged occurrences across all habits. An empty day means
                      no entries, not necessarily no habits.
                    </p>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => {
                      const blob = new Blob(
                        [
                          JSON.stringify(
                            {
                              exportedAt: new Date().toISOString(),
                              timezone,
                              habits: state.habits,
                              events: state.events,
                            },
                            null,
                            2,
                          ),
                        ],
                        { type: "application/json" },
                      );
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `nudge-check-ins-${today}.json`;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }}
                  >
                    <Download size={16} /> Export 31 days
                  </button>
                </div>
                {chart()}
              </section>
              <section className="panel space-top">
                <div className="panel-heading">
                  <div>
                    <h2>Your check-in history</h2>
                    <p>
                      Last 31 days · use the undo button to remove an accidental
                      entry.
                    </p>
                  </div>
                </div>
                {activityList(100)}
              </section>
            </>
          )}
          {page === "Notifications" && (
            <>
              <section className="notification-hero">
                <span className="icon-tile green">
                  <Bell />
                </span>
                <div>
                  <h2>A nudge in the right place.</h2>
                  <p>
                    Gentle reminders reach every enabled phone and laptop, even
                    when this tab is closed.
                  </p>
                </div>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={testNudge}
                >
                  <Radio size={16} /> Send test nudge
                </button>
              </section>
              <div className="bottom-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Where your nudges go</h2>
                      <p>
                        {enabledDevices.length} enabled device
                        {enabledDevices.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setConnect(true)}
                    >
                      <Plus size={15} /> Connect
                    </button>
                  </div>
                  <DeviceList state={state} busy={busy} act={act} />
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Your quiet time</h2>
                      <p>Space to switch off. We’ll respect it.</p>
                    </div>
                    <Clock3 size={21} />
                  </div>
                  <div className="quiet-display">
                    {String(state.settings.quietStart).padStart(2, "0")}:00{" "}
                    <span>→</span>{" "}
                    {String(state.settings.quietEnd).padStart(2, "0")}:00
                  </div>
                  <p className="muted">
                    {timezone.replaceAll("_", " ")} ·{" "}
                    {state.settings.notifications
                      ? "Automatic nudges enabled"
                      : "Automatic nudges paused"}
                  </p>
                  <button
                    className="text-button"
                    onClick={() => navigation("Settings")}
                  >
                    Manage preferences <ArrowRight size={15} />
                  </button>
                </section>
              </div>
              <section className="panel space-top">
                <div className="panel-heading">
                  <div>
                    <h2>Nudge history</h2>
                    <p>
                      Push service results across your connected devices. Test
                      nudges bypass quiet time.
                    </p>
                  </div>
                </div>
                {state.notifications.length ? (
                  state.notifications.map((n) => (
                    <div className="activity-row" key={n.id}>
                      <span className="icon-tile small green">
                        <Bell size={17} />
                      </span>
                      <div>
                        <strong>{n.title}</strong>
                        <span>
                          {n.sent} accepted by push service
                          {n.failed ? ` · ${n.failed} failed` : ""} · {n.reason}
                        </span>
                      </div>
                      <time>{relative(n.createdAt)}</time>
                    </div>
                  ))
                ) : (
                  <div className="empty">
                    <Bell size={25} />
                    <h3>All quiet for now.</h3>
                    <p>Connect a device and send your first test nudge.</p>
                  </div>
                )}
              </section>
            </>
          )}
          {page === "Devices & robot" && (
            <>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Your connected devices</h2>
                    <p>
                      Open this workspace on each device, then connect it here.
                    </p>
                  </div>
                  <button
                    className="button primary"
                    onClick={() => setConnect(true)}
                  >
                    <Plus size={16} /> Connect this device
                  </button>
                </div>
                <DeviceList state={state} busy={busy} act={act} />
                <div className="info-strip">
                  <Smartphone size={20} />
                  <p>
                    For phone notifications, use an HTTPS URL. On iPhone, open
                    in Safari, choose Share → Add to Home Screen, then open
                    Nudge from that icon and connect.
                  </p>
                </div>
              </section>
              <div className="integrations-grid">
                <section className="panel robot-panel">
                  <div className="panel-heading">
                    <span className="icon-tile green">
                      <Bot />
                    </span>
                    <span
                      className={`pill ${state.robot.lastSeen ? "green" : "neutral"}`}
                    >
                      {state.robot.lastSeen
                        ? `Last seen ${relative(state.robot.lastSeen)}`
                        : "Ready to connect"}
                    </span>
                  </div>
                  <h2>Meet your future desk buddy.</h2>
                  <p>
                    Your robot can send habit observations straight to this
                    dashboard. Each observation can trigger the same gentle
                    nudges.
                  </p>
                  <OwlCompanion mini />
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        state.robot.configured &&
                        !confirm(
                          "Replace your robot key? The old key will stop working.",
                        )
                      )
                        return;
                      const result = await act(() => api("/robot/key", "POST"));
                      if (result) setRobotKey(result.key);
                    }}
                  >
                    <Link2 size={16} />
                    {state.robot.configured
                      ? "Replace robot key"
                      : "Generate robot key"}
                  </button>
                </section>
                <section className="panel future-panel">
                  <span className="icon-tile lavender">
                    <Volume2 />
                  </span>
                  <span className="eyebrow">THE NEXT CHAPTER</span>
                  <h2>
                    A conversation,
                    <br />
                    not just a notification.
                  </h2>
                  <p>
                    Voice nudges and wake-up checks are powered by ElevenLabs
                    and enabled by setting ELEVENLABS_API_KEY on the server.
                  </p>
                  <div className="roadmap-row">
                    <CheckCheck size={18} />
                    <span>Dashboard & cross-device nudges</span>
                    <span className="pill green">Built</span>
                  </div>
                  <div className="roadmap-row">
                    <Radio size={18} />
                    <span>Robot event API</span>
                    <span className="pill green">Ready</span>
                  </div>
                  <div className="roadmap-row">
                    <Volume2 size={18} />
                    <span>ElevenLabs voice companion</span>
                    {state.voice?.configured ? (
                      <span className="pill green">Connected</span>
                    ) : (
                      <span className="pill neutral">Add API key</span>
                    )}
                  </div>
                  <div className="roadmap-row">
                    <Bot size={18} />
                    <span>Arduino habit detection</span>
                    <span className="pill neutral">Planned</span>
                  </div>
                </section>
              </div>
            </>
          )}
          {page === "Settings" && (
            <Settings
              state={state}
              busy={busy}
              act={act}
              installPrompt={installPrompt}
              setInstallPrompt={setInstallPrompt}
            />
          )}
          <footer>
            <span>
              <Sprout size={14} /> A little better, every day.
            </span>
            <span>Made with care · HackMIT 2026</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              onClick={() =>
                act(
                  () => api(`/events/${toast.undo}`, "DELETE"),
                  "Entry removed.",
                )
              }
            >
              Undo
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {editing && (
        <HabitModal
          habit={editing}
          existingHabits={state.habits}
          onClose={() => setEditing(null)}
          busy={busy}
          act={act}
        />
      )}
      {connect && (
        <ConnectModal
          publicKey={state.publicKey}
          onClose={() => setConnect(false)}
          act={act}
          busy={busy}
        />
      )}
      {voiceCheck && (
        <VoiceCheckModal
          habit={voiceCheck}
          onClose={() => setVoiceCheck(null)}
          act={act}
          reload={load}
          setError={setError}
        />
      )}
      {help && (
        <Modal title="Small steps start here" onClose={() => setHelp(false)}>
          <div className="help-content">
            <p>
              1. <strong>Make it yours.</strong> Add habits you want to reduce.
              Set a daily occurrence limit and an optional reminder interval.
            </p>
            <p>
              2. <strong>Notice and log.</strong> Tap Log whenever you notice a
              habit. You can undo accidental entries from your activity history.
            </p>
            <p>
              3. <strong>Connect your devices.</strong> Sign into the same
              workspace on your phone and laptop, then choose Connect this
              device on each one.
            </p>
            <p>
              4. <strong>Find your rhythm.</strong> Review your check-ins under
              Insights, and set quiet hours under Settings.
            </p>
            <div className="info-strip">
              This is a habit-awareness prototype, not a medical device. Arduino
              detection is a future feature; voice needs an ElevenLabs key on
              the server.
            </div>
          </div>
        </Modal>
      )}
      {robotKey && (
        <Modal title="Your robot connection" onClose={() => setRobotKey("")}>
          <div className="help-content">
            <p>
              Save this key now. It is shown once. Keep it on your robot or
              backend, never in public frontend code.
            </p>
            <label>
              Robot API key
              <textarea readOnly value={robotKey} />
            </label>
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(robotKey);
                  setToast({ text: "Robot key copied." });
                } catch {
                  setError("Copy the key from the field manually.");
                }
              }}
            >
              Copy key
            </button>
            <p>
              Send a POST to <code>/api/robot/events</code> with{" "}
              <code>Authorization: Bearer YOUR_KEY</code> and a habit ID:
            </p>
            <pre>
              {JSON.stringify(
                { habitId: state.habits[0]?.id || "YOUR_HABIT_ID" },
                null,
                2,
              )}
            </pre>
            <p>Habit IDs</p>
            {state.habits.map((h) => (
              <div className="key-row" key={h.id}>
                <strong>{h.name}</strong>
                <code>{h.id}</code>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
function Stat({ icon: Icon, label, value, sub, tone = "green" }) {
  return (
    <div className="stat-card">
      <div>
        <span className="stat-label">{label}</span>
        <strong>{value}</strong>
        <small>{sub}</small>
      </div>
      <span className={`icon-tile ${tone}`}>
        <Icon size={20} />
      </span>
    </div>
  );
}
function EmptyHabits({ onAdd }) {
  return (
    <div className="panel empty">
      <Sprout size={28} />
      <h3>Make space for your first habit.</h3>
      <p>Start small. Pick one pattern you’d like to notice.</p>
      <button className="button primary" onClick={onAdd}>
        <Plus size={16} /> Add a habit
      </button>
    </div>
  );
}
function DeviceList({ state, busy, act }) {
  return state.devices.length ? (
    <div>
      {state.devices.map((d) => (
        <div className="device-row" key={d.id}>
          <span
            className={`icon-tile ${d.kind === "phone" ? "lavender" : "green"}`}
          >
            {d.kind === "phone" ? (
              <Smartphone size={21} />
            ) : (
              <Monitor size={21} />
            )}
          </span>
          <div>
            <strong>{d.name}</strong>
            <small>
              {d.enabled ? "Nudges enabled" : "Nudges paused"} · {d.kind}
            </small>
          </div>
          <button
            role="switch"
            aria-checked={Boolean(d.enabled)}
            aria-label={`Nudges for ${d.name}`}
            className={`toggle ${d.enabled ? "on" : ""}`}
            disabled={busy}
            onClick={() =>
              act(() =>
                api(`/devices/${d.id}`, "PATCH", { enabled: !d.enabled }),
              )
            }
          >
            <span />
          </button>
          <button
            className="icon-button danger"
            aria-label={`Disconnect ${d.name}`}
            disabled={busy}
            onClick={() => {
              if (confirm(`Disconnect ${d.name} from notifications?`))
                act(
                  () => api(`/devices/${d.id}`, "DELETE"),
                  "Device disconnected.",
                );
            }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
    </div>
  ) : (
    <div className="empty">
      <Monitor size={27} />
      <h3>Your nudges need a home.</h3>
      <p>Connect this device to receive your first reminder.</p>
    </div>
  );
}
function VoiceCheckModal({ habit, onClose, act, reload, setError }) {
  const [challenge, setChallenge] = useState(null);
  const [result, setResult] = useState(null);
  const [answer, setAnswer] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const recorder = useRef(null);
  const stream = useRef(null);
  const chunks = useRef([]);
  const held = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    act(() => api("/voice/challenge", "POST", { habitId: habit.id })).then(
      async (data) => {
        if (!mounted.current) return;
        setLoading(false);
        if (!data) {
          setFailed(true);
          return;
        }
        setChallenge(data);
        setSeconds(
          Math.max(
            0,
            Math.ceil((new Date(data.expiresAt) - Date.now()) / 1000),
          ),
        );
        playApiAudio(`/voice/challenge/${data.id}/audio`).catch(() => {});
      },
    );
    return () => {
      mounted.current = false;
      stream.current?.getTracks().forEach((track) => track.stop());
      if (recorder.current?.state === "recording") recorder.current.stop();
    };
  }, [habit.id]);

  useEffect(() => {
    if (!challenge) return;
    const timer = setInterval(() => {
      setSeconds(
        Math.max(
          0,
          Math.ceil((new Date(challenge.expiresAt) - Date.now()) / 1000),
        ),
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [challenge]);

  async function submitText(event) {
    event.preventDefault();
    if (!challenge || !answer.trim() || result) return;
    const data = await act(() =>
      api(`/voice/challenge/${challenge.id}/answer`, "POST", {
        answer: answer.trim(),
      }),
    );
    if (data) {
      setResult(data);
      await reload();
    }
  }

  async function submitAudio(blob) {
    const response = await fetch(
      `/api/voice/challenge/${challenge.id}/answer`,
      {
        method: "POST",
        headers: { "Content-Type": blob.type || "audio/webm" },
        body: blob,
      },
    );
    let data;
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok)
      throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }

  async function startRecording(event) {
    event.preventDefault();
    if (
      !challenge ||
      result ||
      recording ||
      typeof MediaRecorder === "undefined"
    )
      return;
    held.current = true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (!held.current || !mounted.current) {
        s.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = s;
      const supported =
        typeof MediaRecorder.isTypeSupported === "function" &&
        MediaRecorder.isTypeSupported("audio/webm");
      recorder.current = supported
        ? new MediaRecorder(stream.current, { mimeType: "audio/webm" })
        : new MediaRecorder(stream.current);
      chunks.current = [];
      recorder.current.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      recorder.current.onstop = async () => {
        const blob = new Blob(chunks.current, {
          type: recorder.current?.mimeType || "audio/webm",
        });
        stream.current?.getTracks().forEach((track) => track.stop());
        stream.current = null;
        try {
          const data = await act(() => submitAudio(blob));
          if (data) {
            setResult(data);
            await reload();
          }
        } catch (error) {
          setError(error.message);
        }
      };
      recorder.current.start();
      setRecording(true);
    } catch (error) {
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      setError(error.message);
    }
  }

  function stopRecording() {
    held.current = false;
    if (recorder.current?.state === "recording") {
      setRecording(false);
      recorder.current.stop();
    }
  }

  return (
    <Modal title={`Voice check · ${habit.name}`} onClose={onClose}>
      <div className="voice-check modal-form">
        {loading ? (
          <LoaderCircle className="spin" />
        ) : failed ? (
          <>
            <p className="muted">Couldn't start the voice check.</p>
            <button className="button secondary" onClick={onClose}>
              Close
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              {challenge?.prompt}
              <small>
                {seconds ? `${seconds}s remaining` : "Challenge expired"}
              </small>
            </p>
            <button
              className="button secondary"
              disabled={!challenge || Boolean(result)}
              onClick={() =>
                playApiAudio(`/voice/challenge/${challenge.id}/audio`).catch(
                  (error) => setError(error.message),
                )
              }
            >
              <Volume2 size={16} /> Play again
            </button>
            <form onSubmit={submitText}>
              <label>
                Type your answer
                <input
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="e.g. twelve"
                  disabled={Boolean(result)}
                />
              </label>
              <button
                className="button primary"
                disabled={!answer.trim() || Boolean(result)}
              >
                Answer
              </button>
            </form>
            {typeof MediaRecorder !== "undefined" && (
              <button
                className={`button ${recording ? "primary recording" : "secondary"}`}
                disabled={!challenge || Boolean(result)}
                onPointerDown={startRecording}
                onPointerUp={stopRecording}
                onPointerCancel={stopRecording}
                onPointerLeave={stopRecording}
              >
                <Mic size={16} />{" "}
                {recording ? "Release to answer" : "Hold to speak"}
              </button>
            )}
            {result && (
              <div
                className={`voice-result ${result.correct ? "correct" : "incorrect"}`}
              >
                <strong>{result.message}</strong>
                {!result.correct && (
                  <span>
                    Heard “{result.heard || "nothing"}”; expected{" "}
                    <strong>{result.expected}</strong>.
                    {result.logged ? " An occurrence was logged." : ""}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
function HabitModal({ habit, existingHabits, onClose, busy, act }) {
  const [form, setForm] = useState({ ...habit }),
    [formError, setFormError] = useState("");
  const update = (key, value) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const selectedPreset = habitPresets.find(
    (preset) => preset.key === form.presetKey,
  );
  return (
    <Modal
      title={habit.id ? "A little habit tune-up" : "One small step"}
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const result = await act(
            () =>
              api(
                habit.id ? `/habits/${habit.id}` : "/habits",
                habit.id ? "PUT" : "POST",
                form,
              ),
            habit.id ? "Habit updated." : "Your new habit is ready.",
          );
          if (result) onClose();
          else
            setFormError(
              "Could not save. Check your connection and inputs, then try again.",
            );
        }}
      >
        <p className="muted">
          Choose a habit you want to reduce. A gentle reminder can help you
          reset.
        </p>
        {!habit.id && (
          <div className="preset-picker">
            <label>
              Start with a preset
              <select
                value={form.presetKey || ""}
                onChange={(e) => {
                  const preset = habitPresets.find(
                    (item) => item.key === e.target.value,
                  );
                  setForm(preset ? habitFromPreset(preset) : { ...blankHabit });
                  setFormError("");
                }}
              >
                <option value="">Custom habit — start from scratch</option>
                {habitPresets.map((preset) => {
                  const added = existingHabits.some(
                    (h) =>
                      h.name.trim().toLowerCase() === preset.name.toLowerCase(),
                  );
                  return (
                    <option
                      key={preset.key}
                      value={preset.key}
                      disabled={added}
                    >
                      {preset.name}
                      {added ? " — already added" : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            {selectedPreset && (
              <p className="preset-hint">{selectedPreset.hint}</p>
            )}
            {selectedPreset?.future && (
              <div className="preset-future">
                <Volume2 size={17} />
                <p>{selectedPreset.future}</p>
              </div>
            )}
            <small>
              Starting settings are editable. Daily limits trigger reminders;
              they are not health targets. Scheduled nudges start off.
            </small>
          </div>
        )}
        <label>
          Habit name
          <input
            autoFocus
            value={form.name}
            maxLength={60}
            required
            placeholder="e.g. Reaching for my phone"
            onChange={(e) => update("name", e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            Category
            <select
              value={form.category}
              onChange={(e) => update("category", e.target.value)}
            >
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Daily occurrence limit
            <input
              type="number"
              min={1}
              max={100}
              required
              value={form.dailyLimit}
              onChange={(e) => update("dailyLimit", Number(e.target.value))}
            />
          </label>
        </div>
        <label>
          Your gentle reminder
          <textarea
            maxLength={180}
            value={form.description}
            placeholder="Take a breath. You’ve got this."
            onChange={(e) => update("description", e.target.value)}
          />
        </label>
        <label>
          Scheduled nudges
          <select
            value={form.reminderMinutes}
            onChange={(e) => update("reminderMinutes", Number(e.target.value))}
          >
            <option value={0}>Off — only nudge at my daily limit</option>
            <option value={15}>Every 15 minutes</option>
            <option value={30}>Every 30 minutes</option>
            <option value={60}>Every hour</option>
            <option value={120}>Every 2 hours</option>
            <option value={240}>Every 4 hours</option>
            <option value={1440}>Every 24 hours</option>
          </select>
        </label>
        {habit.id && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => update("active", e.target.checked)}
            />{" "}
            Actively track this habit
          </label>
        )}
        {formError && (
          <div className="form-error" role="alert">
            {formError}
          </div>
        )}
        <div className="modal-actions">
          {habit.id && (
            <button
              type="button"
              className="text-button danger"
              disabled={busy}
              onClick={async () => {
                if (
                  confirm(
                    `Delete ${habit.name} and all its history? This cannot be undone.`,
                  )
                ) {
                  const result = await act(
                    () => api(`/habits/${habit.id}`, "DELETE"),
                    "Habit deleted.",
                  );
                  if (result) onClose();
                }
              }}
            >
              <Trash2 size={16} /> Delete
            </button>
          )}
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Saving…" : habit.id ? "Save changes" : "Add habit"}
            <Check size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ConnectModal({ publicKey, onClose, act, busy }) {
  const phone = /Android|iPhone|iPad/i.test(navigator.userAgent);
  const [name, setName] = useState(phone ? "My phone" : "My laptop"),
    [kind, setKind] = useState(phone ? "phone" : "laptop"),
    [error, setError] = useState(""),
    [connecting, setConnecting] = useState(false);
  async function connectDevice(e) {
    e.preventDefault();
    setError("");
    setConnecting(true);
    try {
      if (!window.isSecureContext)
        throw new Error(
          "Notifications need HTTPS. Open the secure deployment URL on this device.",
        );
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      )
        throw new Error(
          "Push is unavailable here. On iPhone, add Nudge to your Home Screen and open it there. Otherwise try Chrome, Edge, Firefox, or Safari.",
        );
      const permission = await Notification.requestPermission();
      if (permission !== "granted")
        throw new Error(
          "Notifications are blocked. Allow them in your browser’s site settings, then try again.",
        );
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
        const raw = atob(
          (publicKey + padding).replaceAll("-", "+").replaceAll("_", "/"),
        );
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)),
        });
      }
      const result = await act(
        () =>
          api("/devices", "POST", {
            name,
            kind,
            subscription: subscription.toJSON(),
          }),
        "Device connected. Send a test nudge to try it out.",
      );
      if (result) onClose();
      else setError("Could not register this device. Please try again.");
    } catch (err) {
      setError(err.message);
    } finally {
      setConnecting(false);
    }
  }
  return (
    <Modal title="Bring your nudges with you" onClose={onClose}>
      <form className="modal-form" onSubmit={connectDevice}>
        <p className="muted">
          This connects the device you’re using right now. Repeat on your phone
          or laptop to receive nudges there, too.
        </p>
        <label>
          Device name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
          />
        </label>
        <label>
          Device type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="laptop">Laptop / desktop</option>
            <option value="phone">Phone / tablet</option>
          </select>
        </label>
        <div className="info-strip">
          <Smartphone size={22} />
          <p>
            iPhone: Share → Add to Home Screen, then open Nudge from its icon
            before connecting. Phone push requires HTTPS.
          </p>
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button className="button primary wide" disabled={busy || connecting}>
          {connecting ? (
            <>
              <LoaderCircle className="spin" size={17} /> Connecting…
            </>
          ) : (
            <>
              <Bell size={17} /> Enable notifications on this device
            </>
          )}
        </button>
      </form>
    </Modal>
  );
}
function Settings({ state, busy, act, installPrompt, setInstallPrompt }) {
  const [form, setForm] = useState(state.settings);
  return (
    <div className="settings-layout">
      <ThemeSettings />
      <form
        className="panel settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          act(() => api("/settings", "PUT", form), "Preferences saved.");
        }}
      >
        <h2>A little space, when you need it.</h2>
        <p className="muted">
          Your preferences apply to all connected devices.
        </p>
        <div className="setting-line">
          <div>
            <strong>Automatic nudges</strong>
            <p>Habit limits and scheduled reminders.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.notifications}
            aria-label="Automatic nudges"
            className={`toggle ${form.notifications ? "on" : ""}`}
            onClick={() =>
              setForm({ ...form, notifications: !form.notifications })
            }
          >
            <span />
          </button>
        </div>
        <label>
          Workspace timezone
          <input
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            required
            placeholder="America/New_York"
          />
        </label>
        <div className="form-grid">
          <label>
            Quiet hours begin
            <select
              value={form.quietStart}
              onChange={(e) =>
                setForm({ ...form, quietStart: Number(e.target.value) })
              }
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option value={i} key={i}>
                  {String(i).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
          <label>
            Quiet hours end
            <select
              value={form.quietEnd}
              onChange={(e) =>
                setForm({ ...form, quietEnd: Number(e.target.value) })
              }
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option value={i} key={i}>
                  {String(i).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
        </div>
        <small>
          Set the same start and end time to turn off quiet hours. Test nudges
          always send to enabled devices.
        </small>
        <button className="button primary" disabled={busy}>
          <Check size={16} /> Save preferences
        </button>
      </form>
      <div className="panel install-panel">
        <span className="icon-tile lavender">
          <Smartphone />
        </span>
        <h2>A home for your habits.</h2>
        <p>Install Nudge for easy access and a calmer, focused experience.</p>
        {installPrompt ? (
          <button
            className="button secondary"
            onClick={async () => {
              await installPrompt.prompt();
              await installPrompt.userChoice;
              setInstallPrompt(null);
            }}
          >
            Install Nudge <Download size={16} />
          </button>
        ) : (
          <div className="info-strip">
            Use your browser’s Install app option. On iPhone, open Safari and
            choose Share → Add to Home Screen.
          </div>
        )}
        <p className="muted">
          Your check-ins are stored on this app’s server. This prototype uses
          one shared personal workspace; share its passphrase only with people
          you trust.
        </p>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
);
