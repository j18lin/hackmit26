import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { ThemeToggle } from "./Theme.jsx";
import { owlShapes, owlViewBox } from "../shared/owl-art.js";

export function Owl({ className = "" }) {
  return (
    <svg
      className={`owl-illustration ${className}`}
      viewBox={owlViewBox}
      fill="none"
      aria-hidden="true"
    >
      {owlShapes.map(({ className: group, parts }) => (
        <g key={group} className={group}>
          {parts.map((shape, index) =>
            shape.points ? (
              <polygon key={index} {...shape} />
            ) : (
              <circle key={index} {...shape} />
            ),
          )}
        </g>
      ))}
    </svg>
  );
}

export function OwlCompanion({ mini = false }) {
  return (
    <div className={`owl-companion ${mini ? "mini" : ""}`}>
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
      <header className="intro-header">
        <div className="brand">
          <img src="/icon.svg" alt="" />
          <span>
            owlert<span className="brand-dot">.</span>
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
        <div className="intro-eyebrow">MEET YOUR EVERYDAY LOOKOUT</div>
        <h1>
          A little more aware.
          <br />
          <span>One habit at a time.</span>
        </h1>
        <p>Notice your patterns. Take a break. Start again.</p>
        <div className="intro-perch">
          <button
            className="owl-launch"
            onClick={() => setFlying(true)}
            disabled={flying}
            aria-label="Enter Owlert — let your owl fly"
          >
            <span className="owl-flight">
              <Owl />
            </span>
          </button>
        </div>
        <div className="intro-invitation" aria-live="polite">
          <span>
            {flying ? "See you inside." : "Click the owl to get started"}
          </span>
          <ArrowUpRight size={15} aria-hidden="true" />
        </div>
      </div>
      <footer className="intro-footer">
        <span>Your habit companion.</span>
        <span>HACKMIT 2026</span>
      </footer>
    </div>
  );
}
