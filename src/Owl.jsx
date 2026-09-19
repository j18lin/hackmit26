import { useEffect, useId, useState } from "react";
import { ArrowUpRight, Moon, Sparkles } from "lucide-react";
import { ThemeToggle } from "./Theme.jsx";

// SVG keeps the owl crisp at every size and lets its wings animate independently.
export function Owl({ className = "" }) {
  const id = useId().replaceAll(":", "");
  return (
    <svg
      className={`owl-illustration ${className}`}
      viewBox="0 0 360 330"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`${id}-body`}
          x1="130"
          y1="62"
          x2="257"
          y2="282"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ac8aed" />
          <stop offset=".45" stopColor="#7953bd" />
          <stop offset="1" stopColor="#40246d" />
        </linearGradient>
        <linearGradient
          id={`${id}-wing`}
          x1="72"
          y1="153"
          x2="119"
          y2="255"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#9470d4" />
          <stop offset="1" stopColor="#402564" />
        </linearGradient>
        <linearGradient
          id={`${id}-face`}
          x1="150"
          y1="97"
          x2="205"
          y2="202"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#e6d6ff" />
          <stop offset="1" stopColor="#b594df" />
        </linearGradient>
        <radialGradient id={`${id}-belly`}>
          <stop stopColor="#b490df" />
          <stop offset="1" stopColor="#8960bd" />
        </radialGradient>
        <radialGradient id={`${id}-eye`}>
          <stop stopColor="#38234f" />
          <stop offset="1" stopColor="#171125" />
        </radialGradient>
      </defs>
      <ellipse
        className="owl-ground"
        cx="180"
        cy="304"
        rx="87"
        ry="10"
        fill="#a381ef"
        opacity=".14"
      />
      <g
        className="owl-feet"
        stroke="#e7b780"
        strokeWidth="7"
        strokeLinecap="round"
      >
        <path d="M143 282v12m-9-3 9-8 9 8M218 282v12m-9-3 9-8 9 8" />
      </g>
      <g className="owl-wing owl-wing-left">
        <path
          d="M112 143C68 138 48 190 64 248c26-8 48-33 59-69Z"
          fill={`url(#${id}-wing)`}
          stroke="#b59adc"
          strokeOpacity=".2"
        />
        <path
          d="M80 208c1 13 4 21 7 27m6-42c0 12 3 22 6 27"
          stroke="#b094d5"
          strokeOpacity=".35"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
      <g className="owl-wing owl-wing-right">
        <path
          d="M248 143c44-5 64 47 48 105-26-8-48-33-59-69Z"
          fill={`url(#${id}-wing)`}
          stroke="#b59adc"
          strokeOpacity=".2"
        />
        <path
          d="M280 208c-1 13-4 21-7 27m-6-42c0 12-3 22-6 27"
          stroke="#b094d5"
          strokeOpacity=".35"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
      <path
        d="M99 114 93 48l55 30c20-8 44-8 64 0l55-30-6 66c21 26 24 76 16 110-9 44-44 66-97 66s-88-22-97-66c-8-34-5-84 16-110Z"
        fill={`url(#${id}-body)`}
        stroke="#c4a4f2"
        strokeOpacity=".3"
        strokeWidth="2"
      />
      <path
        d="m105 65 10 40 26-21-36-19Zm150 0-10 40-26-21 36-19Z"
        fill="#d5b9ff"
        opacity=".55"
      />
      <ellipse cx="180" cy="226" rx="58" ry="53" fill={`url(#${id}-belly)`} />
      <g
        stroke="#dfc4ff"
        strokeOpacity=".4"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m151 221 5 6 5-6m14 0 5 6 5-6m14 0 5 6 5-6m-46 20 5 6 5-6m14 0 5 6 5-6m-22 19 5 5 5-5" />
      </g>
      <path
        d="M180 113c-26-35-78-23-83 18-4 35 27 65 58 61l25-12 25 12c31 4 62-26 58-61-5-41-57-53-83-18Z"
        fill={`url(#${id}-face)`}
      />
      <g className="owl-eyes">
        <circle cx="138" cy="145" r="28" fill="#e9bd85" />
        <circle cx="222" cy="145" r="28" fill="#e9bd85" />
        <circle cx="138" cy="145" r="24" fill={`url(#${id}-eye)`} />
        <circle cx="222" cy="145" r="24" fill={`url(#${id}-eye)`} />
        <circle cx="145" cy="136" r="8" fill="#fff7ec" />
        <circle cx="229" cy="136" r="8" fill="#fff7ec" />
        <circle cx="130" cy="155" r="3" fill="#c4a0f0" />
        <circle cx="214" cy="155" r="3" fill="#c4a0f0" />
      </g>
      <path d="m169 171 11-8 11 8-11 16-11-16Z" fill="#efbf82" />
      <path d="m180 164 11 7-11 16v-23Z" fill="#d59b67" />
      <path
        d="M108 109c10-10 24-13 37-7m70 0c13-6 27-3 37 7"
        stroke="#f1e2ff"
        strokeOpacity=".6"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <ellipse cx="110" cy="179" rx="10" ry="5" fill="#d899c6" opacity=".6" />
      <ellipse cx="250" cy="179" rx="10" ry="5" fill="#d899c6" opacity=".6" />
    </svg>
  );
}

export function OwlCompanion({ mini = false }) {
  return (
    <div className={`owl-companion ${mini ? "mini" : ""}`}>
      <div className="owl-halo" />
      <span className="owl-spark one">✦</span>
      <span className="owl-spark two">✧</span>
      <span className="owl-spark three">·</span>
      <Owl />
    </div>
  );
}

export function OwlIntro({ onEnter }) {
  const [flying, setFlying] = useState(false);
  useEffect(() => {
    if (!flying) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = setTimeout(onEnter, reduced ? 100 : 1550);
    return () => clearTimeout(timer);
  }, [flying, onEnter]);
  return (
    <div className={`owl-intro ${flying ? "departing" : ""}`}>
      <div className="night-stars" aria-hidden="true">
        {Array.from({ length: 28 }, (_, i) => (
          <i
            key={i}
            style={{
              left: `${(i * 37 + 7) % 100}%`,
              top: `${(i * 23 + 11) % 95}%`,
              animationDelay: `${i % 5}s`,
              width: i % 4 === 0 ? 3 : 2,
              height: i % 4 === 0 ? 3 : 2,
            }}
          />
        ))}
      </div>
      <header className="intro-header">
        <div className="brand">
          <img src="/icon.svg" alt="" />
          <span>
            nudge<span className="brand-dot">.</span>
          </span>
        </div>
        <div className="theme-header-actions">
          <ThemeToggle />
          <button className="intro-skip" onClick={onEnter}>
            Skip intro <ArrowUpRight size={15} />
          </button>
        </div>
      </header>
      <div className="intro-content">
        <div className="intro-eyebrow">
          <Moon size={13} /> A LITTLE WISER. EVERY DAY.
        </div>
        <h1>
          Better habits.
          <br />
          <span>On a softer wing.</span>
        </h1>
        <p>
          A watchful little friend for your everyday.
          <br />
          Small nudges. A little more you.
        </p>
        <div className="intro-perch">
          <div className="intro-orbit orbit-a" />
          <div className="intro-orbit orbit-b" />
          <span className="intro-star star-a">✦</span>
          <span className="intro-star star-b">✧</span>
          <span className="intro-star star-c">✦</span>
          <button
            className="owl-launch"
            onClick={() => setFlying(true)}
            disabled={flying}
            aria-label="Enter Nudge — let your owl fly"
          >
            <span className="owl-flight">
              <Owl />
            </span>
          </button>
          <div className="perch-glow" />
        </div>
        <div className="intro-invitation" aria-live="polite">
          <span className="intro-click-ring" />
          <span>
            {flying
              ? "Let’s spread those wings…"
              : "Click your owl to come on in"}
          </span>
        </div>
        <div className="intro-caption">
          <Sparkles size={12} /> YOUR HABIT COMPANION, DAY & NIGHT
        </div>
      </div>
      <footer className="intro-footer">
        <span>Gentle nudges. Lasting change.</span>
        <span>MADE WITH CARE · HACKMIT 2026</span>
      </footer>
    </div>
  );
}
