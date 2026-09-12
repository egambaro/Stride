const { useState, useEffect } = React;

// ── Design tokens ────────────────────────────────────────────────
// Palette grounded in "effort": ink for structure, a single molten
// signal color for active state / the thing that matters right now.
const C = {
  bg: "#0E0F13",
  panel: "#16181F",
  line: "#242833",
  ink: "#F2F3F5",
  mute: "#8A90A0",
  faint: "#565C6B",
  signal: "#E4FF4F", // lime signal — used only for the live/active element
  cardio: "#5AA9FF",
  strength: "#FF8A5A",
};

const F = {
  display: '"Archivo", system-ui, sans-serif',
  body: '"Inter", system-ui, sans-serif',
};

// ── Storage ──────────────────────────────────────────────────────
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ── Fitness math ─────────────────────────────────────────────────
function bmi(kg, cm) {
  if (!kg || !cm) return null;
  const m = cm / 100;
  return +(kg / (m * m)).toFixed(1);
}
function bmiBand(v) {
  if (v == null) return { label: "—", note: "" };
  if (v < 18.5) return { label: "Sottopeso", note: "sotto la norma" };
  if (v < 25) return { label: "Normopeso", note: "nella norma" };
  if (v < 30) return { label: "Sovrappeso", note: "sopra la norma" };
  return { label: "Obesità", note: "molto sopra la norma" };
}
function maxHR(age) { return age ? Math.round(208 - 0.7 * age) : null; }
function zone(age, lo, hi) {
  const m = maxHR(age);
  if (!m) return "—";
  return `${Math.round(m * lo)}–${Math.round(m * hi)} bpm`;
}

// Treadmill pace by fitness self-rating + goal, km/h
function paceFor(level) {
  return { base: [4.5, 5.5, 6.5][level], fast: [6.0, 7.5, 9.0][level] }[0] !== undefined
    ? { base: [4.5, 5.5, 6.5][level], fast: [6.0, 7.5, 9.0][level] }
    : { base: 5, fast: 7 };
}

// ── Plan generator ───────────────────────────────────────────────
const CALI = {
  push: { push_ups: "Piegamenti", incline_push: "Piegamenti inclinati", dips: "Dip su sedia", pike: "Pike push-up" },
  pull: { rows: "Rematore (tavolo/asciugamano)", superman: "Superman", reverse_snow: "Reverse snow angel" },
  legs: { squats: "Squat a corpo libero", lunges: "Affondi", calf: "Calf raise", glute: "Ponte glutei" },
  core: { plank: "Plank", mtn: "Mountain climber", leg_raise: "Leg raise", russian: "Russian twist" },
};

function repsFor(level) { return [ "8–10", "10–12", "12–15" ][level]; }
function setsFor(freq) { return freq >= 6 ? 3 : freq >= 4 ? 3 : 4; }

function buildWeek({ age, level, freq, goal, defaultIncline }) {
  const p = paceFor(level);
  const sets = setsFor(freq);
  const reps = repsFor(level);

  const cardioBlocks = {
    steady: {
      type: "cardio", title: "Camminata/corsa steady",
      incline: defaultIncline, speed: `${p.base} km/h`,
      duration: goal === "cardio" ? 35 : 25,
      target: zone(age, 0.6, 0.7),
      detail: `Ritmo costante. Inclinazione ${defaultIncline}%, ${p.base} km/h.`,
    },
    intervals: {
      type: "cardio", title: "Intervalli tapis roulant",
      incline: `${defaultIncline}→${defaultIncline + 4}`, speed: `${p.base}↔${p.fast} km/h`,
      duration: 24,
      target: zone(age, 0.7, 0.85),
      detail: `8× (1 min veloce ${p.fast} km/h a incl. ${defaultIncline + 4}% · 2 min recupero ${p.base} km/h a incl. ${defaultIncline}%).`,
    },
    hill: {
      type: "cardio", title: "Salite in camminata",
      incline: `${defaultIncline + 6}`, speed: `${p.base} km/h`,
      duration: 20, target: zone(age, 0.65, 0.8),
      detail: `Camminata veloce in salita. Inclinazione ${defaultIncline + 6}%.`,
    },
  };

  const strengthBlock = (groups, name) => ({
    type: "strength", title: name,
    sets, reps,
    exercises: groups.flatMap((g) => Object.values(CALI[g]).slice(0, 2)),
    detail: `${sets} serie × ${reps} rip · recupero 60–90s.`,
  });

  // Session templates (mixed cardio + strength)
  const templates = [
    { name: "Full body + steady", blocks: [cardioBlocks.steady, strengthBlock(["push", "legs", "core"], "Forza — Full body")] },
    { name: "Intervalli + upper", blocks: [cardioBlocks.intervals, strengthBlock(["push", "pull", "core"], "Forza — Parte alta")] },
    { name: "Salite + lower", blocks: [cardioBlocks.hill, strengthBlock(["legs", "core"], "Forza — Gambe & core")] },
    { name: "Steady lungo + core", blocks: [{ ...cardioBlocks.steady, duration: cardioBlocks.steady.duration + 10 }, strengthBlock(["core", "push"], "Forza — Core & push")] },
    { name: "Intervalli + full body", blocks: [cardioBlocks.intervals, strengthBlock(["legs", "pull", "core"], "Forza — Full body")] },
    { name: "Salite + upper", blocks: [cardioBlocks.hill, strengthBlock(["push", "pull"], "Forza — Parte alta")] },
  ];

  const days = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
  const pick = [];
  const spread = freq >= 6 ? [0,1,2,3,4,5] : freq >= 4 ? [0,2,4,6].slice(0,freq) : [0,3,5].slice(0,freq);
  for (let i = 0; i < freq; i++) pick.push({ day: days[spread[i] ?? i], ...templates[i % templates.length] });
  return pick;
}

// ── UI primitives ────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 16 }}>
      <span style={{ fontSize: 12, color: C.mute, fontFamily: F.body, letterSpacing: ".02em", display: "block", marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}
const inputStyle = {
  width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.line}`,
  color: C.ink, padding: "12px 14px", borderRadius: 10, fontSize: 16, fontFamily: F.body, outline: "none",
};
function Seg({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = value === o.v;
        return (
          <button key={o.v} onClick={() => onChange(o.v)}
            style={{
              flex: "1 1 auto", minWidth: 60, padding: "10px 12px", borderRadius: 10, cursor: "pointer",
              fontFamily: F.body, fontSize: 14, transition: "background .15s, color .15s",
              border: `1px solid ${active ? C.signal : C.line}`,
              background: active ? C.signal : "transparent",
              color: active ? C.bg : C.mute, fontWeight: active ? 600 : 500,
            }}>{o.l}</button>
        );
      })}
    </div>
  );
}

// ── Screens ──────────────────────────────────────────────────────
function Profile({ p, setP }) {
  const set = (k) => (e) => setP({ ...p, [k]: e.target.value });
  const b = bmi(+p.weight, +p.height);
  const band = bmiBand(b);
  const mhr = maxHR(+p.age);

  return (
    <div>
      <h2 style={h2}>Profilo</h2>
      <p style={sub}>Questi dati servono a calcolare zone cardio, ritmi e volumi del piano.</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Altezza (cm)"><input style={inputStyle} type="number" inputMode="numeric" value={p.height} onChange={set("height")} placeholder="175" /></Field>
        <Field label="Peso (kg)"><input style={inputStyle} type="number" inputMode="numeric" value={p.weight} onChange={set("weight")} placeholder="72" /></Field>
        <Field label="Età"><input style={inputStyle} type="number" inputMode="numeric" value={p.age} onChange={set("age")} placeholder="34" /></Field>
        <Field label="Sesso">
          <Seg value={p.sex} onChange={(v) => setP({ ...p, sex: v })}
            options={[{ v: "m", l: "Uomo" }, { v: "f", l: "Donna" }]} />
        </Field>
      </div>

      <Field label="Livello attuale">
        <Seg value={p.level} onChange={(v) => setP({ ...p, level: v })}
          options={[{ v: 0, l: "Principiante" }, { v: 1, l: "Intermedio" }, { v: 2, l: "Avanzato" }]} />
      </Field>

      <Field label="Obiettivo">
        <Seg value={p.goal} onChange={(v) => setP({ ...p, goal: v })}
          options={[{ v: "mixed", l: "Misto" }, { v: "cardio", l: "Cardio" }, { v: "strength", l: "Forza" }]} />
      </Field>

      {/* BMI readout — the one loud element */}
      <div style={{ marginTop: 8, padding: 18, borderRadius: 14, background: C.panel, border: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ fontFamily: F.body, fontSize: 12, color: C.mute }}>Indice di massa corporea</span>
          <span style={{ fontFamily: F.body, fontSize: 12, color: C.faint }}>{band.note}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 6 }}>
          <span style={{ fontFamily: F.display, fontSize: 52, fontWeight: 800, color: b ? C.signal : C.faint, lineHeight: 1 }}>
            {b ?? "—"}
          </span>
          <span style={{ fontFamily: F.display, fontSize: 20, color: C.ink, fontWeight: 600 }}>{band.label}</span>
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 20, flexWrap: "wrap" }}>
          <Stat k="FC max stimata" v={mhr ? `${mhr} bpm` : "—"} />
          <Stat k="Zona brucia grassi" v={zone(+p.age, 0.6, 0.7)} />
          <Stat k="Zona cardio" v={zone(+p.age, 0.7, 0.85)} />
        </div>
      </div>
    </div>
  );
}
function Stat({ k, v }) {
  return (
    <div>
      <div style={{ fontFamily: F.body, fontSize: 11, color: C.faint }}>{k}</div>
      <div style={{ fontFamily: F.body, fontSize: 15, color: C.ink, fontWeight: 600, marginTop: 2 }}>{v}</div>
    </div>
  );
}

function Setup({ p, setP, onBuild }) {
  const [incline, setIncline] = useState(p.defaultIncline ?? 2);
  return (
    <div>
      <h2 style={h2}>Allenamento</h2>
      <p style={sub}>Scegli quante sessioni vuoi fare e l'inclinazione di partenza del tapis roulant.</p>

      <Field label="Sessioni a settimana">
        <Seg value={p.freq} onChange={(v) => setP({ ...p, freq: v })}
          options={[{ v: 2, l: "2" }, { v: 3, l: "3" }, { v: 4, l: "4" }, { v: 5, l: "5" }, { v: 6, l: "6" }]} />
      </Field>

      <Field label={`Inclinazione tapis roulant · ${incline}%`}>
        <input type="range" min={0} max={12} step={1} value={incline}
          onChange={(e) => { const v = +e.target.value; setIncline(v); setP({ ...p, defaultIncline: v }); }}
          style={{ width: "100%", accentColor: C.signal }} />
        <div style={{ display: "flex", justifyContent: "space-between", color: C.faint, fontSize: 11, fontFamily: F.body, marginTop: 4 }}>
          <span>Piano · 0%</span><span>Salita · 12%</span>
        </div>
      </Field>

      <div style={{ padding: 14, borderRadius: 12, background: C.panel, border: `1px solid ${C.line}`, marginBottom: 20 }}>
        <p style={{ margin: 0, fontFamily: F.body, fontSize: 13, color: C.mute, lineHeight: 1.5 }}>
          L'app calcola ritmi, inclinazioni e ripetizioni. I valori di velocità e inclinazione vanno impostati a mano sul tapis roulant durante l'esecuzione.
        </p>
      </div>

      <button onClick={onBuild} style={cta}>Genera il piano settimanale</button>
    </div>
  );
}

function Plan({ p }) {
  if (!p.age || !p.height || !p.weight) {
    return <Empty text="Completa il profilo per generare un piano su misura." />;
  }
  const week = buildWeek({
    age: +p.age, level: +p.level, freq: +p.freq, goal: p.goal, defaultIncline: +(p.defaultIncline ?? 2),
  });
  const [open, setOpen] = useState(0);

  return (
    <div>
      <h2 style={h2}>Piano · {p.freq} sessioni</h2>
      <p style={sub}>Misto cardio + calisthenics. Tocca una sessione per i dettagli.</p>

      {week.map((s, i) => {
        const isOpen = open === i;
        return (
          <div key={i} style={{ border: `1px solid ${isOpen ? C.signal : C.line}`, borderRadius: 14, marginBottom: 12, overflow: "hidden", background: C.panel, transition: "border-color .15s" }}>
            <button onClick={() => setOpen(isOpen ? -1 : i)}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
              <div>
                <div style={{ fontFamily: F.body, fontSize: 11, color: C.faint, letterSpacing: ".08em" }}>{s.day}</div>
                <div style={{ fontFamily: F.display, fontSize: 19, color: C.ink, fontWeight: 700, marginTop: 2 }}>{s.name}</div>
              </div>
              <span style={{ color: C.signal, fontSize: 22, transform: isOpen ? "rotate(45deg)" : "none", transition: "transform .2s" }}>+</span>
            </button>

            {isOpen && (
              <div style={{ padding: "0 18px 18px" }}>
                {s.blocks.map((bl, j) => (
                  <div key={j} style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14, marginTop: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 8, background: bl.type === "cardio" ? C.cardio : C.strength }} />
                      <span style={{ fontFamily: F.body, fontSize: 14, fontWeight: 600, color: C.ink }}>{bl.title}</span>
                    </div>

                    {bl.type === "cardio" ? (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 8 }}>
                        <Metric k="Durata" v={`${bl.duration} min`} />
                        <Metric k="Velocità" v={bl.speed} />
                        <Metric k="Inclinazione" v={`${bl.incline}%`} />
                        <Metric k="Zona FC" v={bl.target} wide />
                      </div>
                    ) : (
                      <div>
                        <div style={{ display: "flex", gap: 18, marginBottom: 10 }}>
                          <Metric k="Serie" v={bl.sets} />
                          <Metric k="Ripetizioni" v={bl.reps} />
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 18, color: C.ink, fontFamily: F.body, fontSize: 14, lineHeight: 1.7 }}>
                          {bl.exercises.map((ex, k) => <li key={k}>{ex}</li>)}
                        </ul>
                      </div>
                    )}
                    <p style={{ margin: "10px 0 0", fontFamily: F.body, fontSize: 13, color: C.mute, lineHeight: 1.5 }}>{bl.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
function Metric({ k, v, wide }) {
  return (
    <div style={{ gridColumn: wide ? "1 / -1" : "auto" }}>
      <div style={{ fontFamily: F.body, fontSize: 11, color: C.faint }}>{k}</div>
      <div style={{ fontFamily: F.body, fontSize: 15, color: C.ink, fontWeight: 600, marginTop: 2 }}>{v}</div>
    </div>
  );
}
function Empty({ text }) {
  return <div style={{ padding: 40, textAlign: "center", color: C.mute, fontFamily: F.body, fontSize: 15 }}>{text}</div>;
}

// ── Shell ────────────────────────────────────────────────────────
const h2 = { fontFamily: F.display, fontSize: 28, fontWeight: 800, color: C.ink, margin: "0 0 4px", letterSpacing: "-.01em" };
const sub = { fontFamily: F.body, fontSize: 14, color: C.mute, margin: "0 0 22px", lineHeight: 1.5 };
const cta = { width: "100%", padding: "16px", borderRadius: 12, border: "none", background: C.signal, color: C.bg, fontFamily: F.display, fontSize: 16, fontWeight: 700, cursor: "pointer" };

function App() {
  const [tab, setTab] = useState("plan");
  const [p, setP] = useState(() => store.get("profile", {
    height: "", weight: "", age: "", sex: "m", level: 1, goal: "mixed", freq: 3, defaultIncline: 2,
  }));
  useEffect(() => store.set("profile", p), [p]);

  const tabs = [
    { id: "plan", l: "Piano" },
    { id: "setup", l: "Allenamento" },
    { id: "profile", l: "Profilo" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink }}>
      <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />

      <header style={{ padding: "22px 20px 14px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 20, letterSpacing: "-.02em" }}>
          STRIDE<span style={{ color: C.signal }}>.</span>
        </span>
        <span style={{ fontFamily: F.body, fontSize: 12, color: C.faint }}>tapis roulant + calisthenics</span>
      </header>

      <main style={{ maxWidth: 520, margin: "0 auto", padding: "8px 20px 110px" }}>
        {tab === "plan" && <Plan p={p} />}
        {tab === "setup" && <Setup p={p} setP={setP} onBuild={() => setTab("plan")} />}
        {tab === "profile" && <Profile p={p} setP={setP} />}
      </main>

      <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(14,15,19,.92)", backdropFilter: "blur(10px)", borderTop: `1px solid ${C.line}`, display: "flex", padding: "10px 12px calc(10px + env(safe-area-inset-bottom))" }}>
        <div style={{ display: "flex", maxWidth: 520, margin: "0 auto", width: "100%", gap: 8 }}>
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: F.body, fontSize: 14, fontWeight: active ? 700 : 500, background: active ? C.panel : "transparent", color: active ? C.signal : C.mute }}>
                {t.l}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}


ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
