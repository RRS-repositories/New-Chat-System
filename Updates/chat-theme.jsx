/**
 * chat-theme.jsx — drop-in theme layer for the Chat web app (React 18).
 * Bridges the approved prototype (chat-app-redesign-v2.html) into web/src.
 *
 * Install:
 *   1. Save THEME_CSS below as web/src/styles/theme.css and import it in main.tsx.
 *   2. Wrap the app in <ThemeProvider> (App.tsx).
 *   3. Render <AppearanceSettings/> inside the existing user-settings dialog.
 * No dependencies beyond React. TS users: rename to .tsx, types are trivial.
 */
import React, { createContext, useContext, useEffect, useState } from "react";

export const ACCENTS = {
  violet:  { label: "Violet",  swatch: "linear-gradient(120deg,#8F76F5,#6C4DE6)" },
  ocean:   { label: "Ocean",   swatch: "linear-gradient(120deg,#3FA3FF,#0B84F3)" },
  sunset:  { label: "Sunset",  swatch: "linear-gradient(120deg,#FF7A45,#FF4365)" },
  emerald: { label: "Emerald", swatch: "linear-gradient(120deg,#35E09A,#0FB573)" },
  magenta: { label: "Magenta", swatch: "linear-gradient(120deg,#FF5BCB,#E31FA9)" },
};
const KEY = "chatTheme";
const load = () => {
  try { return { mode: "light", accent: "violet", ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { mode: "light", accent: "violet" }; }
};

const ThemeCtx = createContext(null);
export const useTheme = () => useContext(ThemeCtx);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(load);
  useEffect(() => {
    document.body.dataset.mode = theme.mode;
    document.body.dataset.accent = theme.accent;
    try { localStorage.setItem(KEY, JSON.stringify(theme)); } catch {}
  }, [theme]);
  return (
    <ThemeCtx.Provider value={{
      ...theme,
      setMode:   (mode)   => setTheme(t => ({ ...t, mode })),
      setAccent: (accent) => setTheme(t => ({ ...t, accent })),
    }}>{children}</ThemeCtx.Provider>
  );
}

/** Mode toggle + accent swatches — drop into the settings dialog. */
export function AppearanceSettings() {
  const { mode, accent, setMode, setAccent } = useTheme();
  return (
    <>
      <div className="ap-h">APPEARANCE</div>
      <div className="togrow">
        <span className="tx"><b>Mode</b><span>Workspace background</span></span>
        <div className="seg">
          {["light", "dark"].map(m => (
            <button key={m} type="button" className={mode === m ? "on" : ""}
              onClick={() => setMode(m)}>{m === "light" ? "Light" : "Dark"}</button>
          ))}
        </div>
      </div>
      <div className="togrow" style={{ alignItems: "flex-start" }}>
        <span className="tx"><b>Theme colour</b><span>Accents, buttons and sidebar</span></span>
      </div>
      <div className="swr">
        {Object.entries(ACCENTS).map(([k, a]) => (
          <button key={k} type="button" title={a.label} aria-label={`${a.label} theme`}
            className={`swb ${accent === k ? "on" : ""}`}
            style={{ background: a.swatch }} onClick={() => setAccent(k)} />
        ))}
      </div>
    </>
  );
}

/** Paste as web/src/styles/theme.css — identical tokens to the approved prototype. */
export const THEME_CSS = `
:root{
  --side:#171B38; --side-2:#12152C; --side-hi:rgba(255,255,255,.07);
  --paper:#FFFFFF; --paper-2:#F6F6FC; --paper-3:#EDEEF8;
  --ink:#171A2E; --mut:#696F8E; --dim:#9CA1BE;
  --line:#EAEBF4; --line-2:#DEE0EF;
  --hov:#F8F8FD; --glass:rgba(255,255,255,.86); --glass-2:rgba(255,255,255,.93);
  --violet:#6C4DE6; --violet-2:#8F76F5; --violet-3:#B9A6FF; --violet-ink:#4A31B8; --vrgb:108,77,230;
  --grad:linear-gradient(120deg,#8F76F5 0%,#6C4DE6 55%,#5B3BDF 100%);
  --violet-soft:#F2EEFF; --violet-soft-2:#E7E0FF;
  --green:#1FA75A; --amber:#E8930C; --red:#E5484D;
  --dk:#0B0E20; --dk-2:#141836; --dk-glass:rgba(19,23,52,.76); --dk-line:rgba(255,255,255,.1);
  --dk-text:#F3F4FB; --dk-mut:#9AA3C7;
  --sh:0 12px 38px -14px rgba(23,27,56,.30);
  --sh-sm:0 5px 18px -7px rgba(23,27,56,.26);
  --sh-lg:0 32px 90px -24px rgba(12,15,34,.55);
}
body[data-accent="ocean"]{--violet:#0B84F3;--violet-2:#3FA3FF;--violet-3:#9ED1FF;--violet-ink:#085FBD;--vrgb:11,132,243;--violet-soft:#EAF4FF;--violet-soft-2:#D7EBFF;--grad:linear-gradient(120deg,#3FA3FF 0%,#0B84F3 55%,#0A6AD1 100%);--side:#0F1D38;--side-2:#0A152B}
body[data-accent="sunset"]{--violet:#FF4365;--violet-2:#FF7A45;--violet-3:#FFB3C0;--violet-ink:#C2184B;--vrgb:255,67,101;--violet-soft:#FFEFF1;--violet-soft-2:#FFDFE4;--grad:linear-gradient(120deg,#FF7A45 0%,#FF4365 55%,#E12A54 100%);--side:#2A0F22;--side-2:#1B0917}
body[data-accent="emerald"]{--violet:#0FB573;--violet-2:#35E09A;--violet-3:#9FF0CC;--violet-ink:#077A4D;--vrgb:15,181,115;--violet-soft:#E8FBF2;--violet-soft-2:#D1F5E6;--grad:linear-gradient(120deg,#35E09A 0%,#0FB573 55%,#0B9A61 100%);--side:#0B241E;--side-2:#071914}
body[data-accent="magenta"]{--violet:#E31FA9;--violet-2:#FF5BCB;--violet-3:#FFADE4;--violet-ink:#AC0F7E;--vrgb:227,31,169;--violet-soft:#FDEDF8;--violet-soft-2:#FBDCF1;--grad:linear-gradient(120deg,#FF5BCB 0%,#E31FA9 55%,#C2138F 100%);--side:#2A0C24;--side-2:#1A0716}
body[data-mode="dark"]{
  --paper:#161A33;--paper-2:#11142A;--paper-3:#0D1022;
  --ink:#EEF0FB;--mut:#9FA6CB;--dim:#6E759B;
  --line:rgba(255,255,255,.09);--line-2:rgba(255,255,255,.16);
  --hov:rgba(255,255,255,.05);--glass:rgba(15,18,39,.85);--glass-2:rgba(21,25,50,.95);
  --violet-soft:rgba(var(--vrgb),.18);--violet-soft-2:rgba(var(--vrgb),.32);
  --violet-ink:var(--violet-3);
  --sh:0 12px 38px -14px rgba(0,0,0,.55);--sh-sm:0 5px 18px -7px rgba(0,0,0,.5);--sh-lg:0 32px 90px -24px rgba(0,0,0,.72);
}
body[data-mode="dark"] mark{background:rgba(255,196,77,.26);color:#FFD88A}
/* Usage notes for S1: headers/menus/toasts use var(--glass)/var(--glass-2);
   row hovers use var(--hov); surfaces --paper/-2/-3; never hardcode light hex. */
/* appearance controls */
.ap-h{font-size:10.5px;font-weight:900;letter-spacing:.1em;color:var(--dim);margin:14px 2px 4px}
.seg{display:flex;background:var(--paper-3);border:1px solid var(--line);border-radius:11px;padding:3px;gap:2px}
.seg button{padding:6px 14px;border-radius:8px;font-weight:800;font-size:12px;color:var(--mut);border:0;background:transparent;cursor:pointer}
.seg button.on{background:var(--paper);color:var(--ink);box-shadow:var(--sh-sm)}
.swr{display:flex;gap:11px;padding:6px 2px 2px}
.swb{width:33px;height:33px;border-radius:50%;flex:0 0 auto;border:0;cursor:pointer;box-shadow:inset 0 0 0 2px rgba(255,255,255,.55);transition:transform .12s}
.swb:hover{transform:scale(1.1)}
.swb.on{box-shadow:0 0 0 2px var(--paper),0 0 0 4.5px var(--violet)}
`;
