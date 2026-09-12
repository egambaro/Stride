const { useState, useEffect } = React;

const C = {
  bg: "#0E0F13", panel: "#16181F", line: "#242833",
  ink: "#F2F3F5", mute: "#8A90A0", faint: "#565C6B",
  signal: "#E4FF4F", cardio: "#5AA9FF", strength: "#FF8A5A", grip: "#B98CFF",
};
const F = { display: '"Archivo", system-ui, sans-serif', body: '"Inter", system-ui, sans-serif' };

const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ── Session log (completed / skipped workouts) ───────────────────
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
function loadLog() { return store.get("log_v2", {}); } // { "2026-06-01": {status:"done"|"skip", name} }
function saveLog(l) { store.set("log_v2", l); }

const bmi = (kg, cm) => (!kg || !cm ? null : +(kg / ((cm / 100) ** 2)).toFixed(1));
function bmiBand(v) {
  if (v == null) return { label: "—", note: "" };
  if (v < 18.5) return { label: "Sottopeso", note: "sotto la norma" };
  if (v < 25) return { label: "Normopeso", note: "nella norma" };
  if (v < 30) return { label: "Sovrappeso", note: "sopra la norma" };
  return { label: "Obesità", note: "molto sopra la norma" };
}
const maxHR = (age) => (age ? Math.round(208 - 0.7 * age) : null);
const zone = (age, lo, hi) => { const m = maxHR(age); return m ? `${Math.round(m * lo)}–${Math.round(m * hi)} bpm` : "—"; };
const paceBase = (lvl) => [4.5, 5.5, 6.5][lvl] ?? 5.5;
const paceFast = (lvl) => [6.0, 7.5, 9.0][lvl] ?? 7.5;

const RACES = {
  sprint: { label: "Sprint", km: 5, obstacles: 20 },
  super: { label: "Super", km: 10, obstacles: 25 },
  beast: { label: "Beast", km: 21, obstacles: 30 },
  custom: { label: "Personalizzata", km: 10, obstacles: 25 },
};

function weeksTo(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const ms = d - now;
  if (ms < 0) return -1;
  return Math.ceil(ms / (7 * 24 * 3600 * 1000));
}

function phaseFor(w) {
  if (w == null) return null;
  if (w < 0) return { key: "done", name: "Gara passata", desc: "Imposta una nuova data gara." };
  if (w <= 1) return { key: "taper", name: "Scarico (taper)", desc: "Volume ridotto, intensità mantenuta. Arriva fresco alla gara." };
  if (w <= 4) return { key: "peak", name: "Specifico gara", desc: "Simulazioni: cardio + ostacoli in circuito, grip sotto fatica." };
  if (w <= 9) return { key: "build", name: "Costruzione forza", desc: "Carichi e volume in salita su trazione, spinta e core." };
  return { key: "base", name: "Base aerobica", desc: "Motore aerobico e fondamentali. Costruisci la base." };
}

const LIB = {
  pull: { base: ["Australian pull up 3×10", "Chin up 3× max", "Dead hang 3×30\""],
          build: ["Pull up 4×6–8", "Chin up front iso 3×10\"", "Australian wide 3×12"],
          peak: ["Wide pull up 3× max", "Pull up anelli 3×8", "Muscle up tecnica 4×2"] },
  push: { base: ["Push up 3×10", "Dip su parallele 3×8", "Push up larghi 3×12"],
          build: ["Dip 4×8", "Dip anelli 3×6", "Push up stretti 3×15"],
          peak: ["Dip bar 3× max", "Dip anelli 3×8", "Muscle up 4×2"] },
  core: { base: ["Leg raise 3×10", "Plank 3×40\"", "Compressioni a terra 3×30\""],
          build: ["Toes to bar 3×10", "Dragon flag 3×20\" iso", "Jesolo crunch 2×(30\"+20\" iso)"],
          peak: ["Dragon flag 3× max", "Toes to bar 3×12", "Candela 3×30\""] },
  grip: { base: ["Dead hang 3×30\"", "Australian tenuta 3×20\""],
          build: ["Dead hang 3×45\"", "Wide pull up iso 3×3\"", "Aquila di sangue 3×10"],
          peak: ["Monkey bar simulazione 3× tratto", "Dead hang zavorrato 3×30\"", "Chin up front iso 3×10\""] },
};
const phaseKeyToLib = (k) => (k === "base" ? "base" : k === "build" ? "build" : "peak");

function buildWeek(p) {
  const w = weeksTo(p.raceDate);
  const ph = phaseFor(w);
  if (!ph || ph.key === "done") return { phase: ph, weeks: w, days: [] };

  const race = RACES[p.raceType] || RACES.super;
  const km = +p.raceKm || race.km;
  const obst = +p.raceObstacles || race.obstacles;
  const lvl = +p.level;
  const dayNames = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
  const chosen = Array.isArray(p.trainDays) && p.trainDays.length ? [...p.trainDays].sort((a, b) => a - b) : [0, 2, 4];
  const freq = chosen.length;
  const lib = phaseKeyToLib(ph.key);
  const taper = ph.key === "taper";
  const weak = p.weakness;

  const pull = LIB.pull[lib], push = LIB.push[lib], core = LIB.core[lib], grip = LIB.grip[lib];
  const pick = (arr, n) => arr.slice(0, n);
  const longMin = Math.min(70, Math.round(km * (ph.key === "base" ? 4 : ph.key === "build" ? 4.5 : 5)));

  const cardio = {
    long: { type: "cardio", title: "Fondo lungo tapis roulant",
      speed: `${paceBase(lvl)} km/h`, incline: `${p.defaultIncline}`, duration: taper ? Math.round(longMin * 0.6) : longMin,
      target: zone(+p.age, 0.6, 0.72),
      detail: `Ritmo costante, resistenza gara (${km} km). Inclinazione ${p.defaultIncline}%.` },
    intervals: { type: "cardio", title: "Intervalli in salita",
      speed: `${paceBase(lvl)}↔${paceFast(lvl)} km/h`, incline: `${p.defaultIncline}→${p.defaultIncline + 5}`, duration: taper ? 16 : 26,
      target: zone(+p.age, 0.8, 0.9),
      detail: `${taper ? 6 : 10}× (1' veloce ${paceFast(lvl)} km/h a incl. ${p.defaultIncline + 5}% · 2' recupero). Simula gli strappi tra ostacoli.` },
    hill: { type: "cardio", title: "Salite lunghe (dislivello gara)",
      speed: `${paceBase(lvl)} km/h`, incline: `${p.defaultIncline + 7}`, duration: taper ? 14 : 22,
      target: zone(+p.age, 0.7, 0.82),
      detail: `Camminata veloce ripida. La Spartan ha molto dislivello. Incl. ${p.defaultIncline + 7}%.` },
  };

  const S = (title, exs, isGrip) => ({ type: isGrip ? "grip" : "strength", title, exercises: exs, detail: taper ? "Volume ridotto: fermati 2 rip prima del cedimento." : "Recupero 60–90\" tra le serie." });

  const gyms = [
    { name: "Trazione + core", blocks: [S("Trazione (sbarra/anelli)", pick(pull, 2)), S("Core", pick(core, 2)), S("Grip", pick(grip, 1), true)] },
    { name: "Spinta + core", blocks: [S("Spinta (dip/push)", pick(push, 2)), S("Core", pick(core, 2))] },
    { name: "Full body ostacoli", blocks: [S("Trazione", pick(pull, 1)), S("Spinta", pick(push, 1)), S("Grip / monkey bar", pick(grip, 2), true), S("Core", pick(core, 1))] },
  ];
  if (weak === "pull") gyms.unshift({ name: "Focus TRAZIONE + grip", blocks: [S("Trazione (priorità)", pick(pull, 3)), S("Grip", pick(grip, 2), true)] });
  if (weak === "push") gyms.unshift({ name: "Focus SPINTA", blocks: [S("Spinta (priorità)", pick(push, 3)), S("Core", pick(core, 1))] });

  const cardioSlots = weak === "endurance" ? Math.ceil(freq / 2) + 1 : Math.max(2, Math.floor(freq / 2));
  const cardioSeq = [cardio.intervals, cardio.long, cardio.hill];

  const zipped = [];
  let cN = Math.min(cardioSlots, freq), gN = freq - cN, ct = 0, gt = 0, toggle = true;
  for (let i = 0; i < freq; i++) {
    if ((toggle && ct < cN) || gt >= gN) { zipped.push("c"); ct++; } else { zipped.push("g"); gt++; }
    toggle = !toggle;
  }
  const out = []; let ci = 0, gi = 0;
  zipped.forEach((kind, i) => {
    const label = dayNames[chosen[i]] ?? dayNames[i];
    if (kind === "c") { const b = cardioSeq[ci % 3]; out.push({ day: label, name: b.title, blocks: [b] }); ci++; }
    else { const g = gyms[gi % gyms.length]; out.push({ day: label, name: g.name, blocks: g.blocks }); gi++; }
  });
  return { phase: ph, weeks: w, km, obst, days: out };
}

function Field({ label, children }) {
  return (<label style={{ display: "block", marginBottom: 16 }}>
    <span style={{ fontSize: 12, color: C.mute, fontFamily: F.body, display: "block", marginBottom: 6 }}>{label}</span>
    {children}</label>);
}
const inputStyle = { width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.line}`, color: C.ink, padding: "12px 14px", borderRadius: 10, fontSize: 16, fontFamily: F.body, outline: "none" };
function Seg({ options, value, onChange }) {
  return (<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
    {options.map((o) => { const a = value === o.v; return (
      <button key={o.v} onClick={() => onChange(o.v)} style={{ flex: "1 1 auto", minWidth: 56, padding: "10px 12px", borderRadius: 10, cursor: "pointer", fontFamily: F.body, fontSize: 14, border: `1px solid ${a ? C.signal : C.line}`, background: a ? C.signal : "transparent", color: a ? C.bg : C.mute, fontWeight: a ? 600 : 500 }}>{o.l}</button>); })}
  </div>);
}
function DayPicker({ value, onChange }) {
  const labels = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
  const toggle = (i) => {
    const has = value.includes(i);
    let next = has ? value.filter((x) => x !== i) : [...value, i];
    if (next.length === 0) return; // keep at least one day
    onChange(next.sort((a, b) => a - b));
  };
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {labels.map((l, i) => { const a = value.includes(i); return (
        <button key={i} onClick={() => toggle(i)}
          style={{ flex: 1, padding: "12px 0", borderRadius: 10, cursor: "pointer", fontFamily: F.body, fontSize: 13, border: `1px solid ${a ? C.signal : C.line}`, background: a ? C.signal : "transparent", color: a ? C.bg : C.mute, fontWeight: a ? 700 : 500 }}>{l}</button>); })}
    </div>
  );
}
const h2 = { fontFamily: F.display, fontSize: 28, fontWeight: 800, color: C.ink, margin: "0 0 4px", letterSpacing: "-.01em" };
const sub = { fontFamily: F.body, fontSize: 14, color: C.mute, margin: "0 0 22px", lineHeight: 1.5 };
const cta = { width: "100%", padding: 16, borderRadius: 12, border: "none", background: C.signal, color: C.bg, fontFamily: F.display, fontSize: 16, fontWeight: 700, cursor: "pointer" };

function Race({ p, setP, onBuild }) {
  const set = (k) => (e) => setP({ ...p, [k]: e.target.value });
  const w = weeksTo(p.raceDate); const ph = phaseFor(w);
  return (
    <div>
      <h2 style={h2}>Gara</h2>
      <p style={sub}>Imposta l'obiettivo. Il programma si costruisce a ritroso dalla data.</p>
      <Field label="Data della gara"><input style={inputStyle} type="date" value={p.raceDate} onChange={set("raceDate")} /></Field>
      <Field label="Tipo di Spartan">
        <Seg value={p.raceType} onChange={(v) => setP({ ...p, raceType: v, raceKm: RACES[v].km, raceObstacles: RACES[v].obstacles })}
          options={[{ v: "sprint", l: "Sprint ~5k" }, { v: "super", l: "Super ~10k" }, { v: "beast", l: "Beast ~21k" }, { v: "custom", l: "Altro" }]} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Lunghezza gara (km)"><input style={inputStyle} type="number" inputMode="numeric" value={p.raceKm} onChange={set("raceKm")} /></Field>
        <Field label="Numero ostacoli"><input style={inputStyle} type="number" inputMode="numeric" value={p.raceObstacles} onChange={set("raceObstacles")} /></Field>
      </div>
      <Field label={`Giorni di allenamento${(p.trainDays?.length) ? ` · ${p.trainDays.length} a settimana` : ""}`}>
        <DayPicker value={p.trainDays || [0, 2, 4]} onChange={(v) => setP({ ...p, trainDays: v })} />
      </Field>
      <Field label="Punto debole su cui insistere">
        <Seg value={p.weakness} onChange={(v) => setP({ ...p, weakness: v })} options={[{ v: "balanced", l: "Bilanciato" }, { v: "endurance", l: "Fiato" }, { v: "pull", l: "Trazione/grip" }, { v: "push", l: "Spinta" }]} />
      </Field>
      {w != null && w >= 0 && ph && (
        <div style={{ padding: 18, borderRadius: 14, background: C.panel, border: `1px solid ${C.line}`, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontFamily: F.display, fontSize: 52, fontWeight: 800, color: C.signal, lineHeight: 1 }}>{w}</span>
            <span style={{ fontFamily: F.display, fontSize: 18, color: C.ink, fontWeight: 600 }}>settimane alla gara</span>
          </div>
          <div style={{ marginTop: 12, fontFamily: F.body, fontSize: 14, color: C.ink, fontWeight: 600 }}>Fase attuale: {ph.name}</div>
          <div style={{ marginTop: 4, fontFamily: F.body, fontSize: 13, color: C.mute, lineHeight: 1.5 }}>{ph.desc}</div>
        </div>
      )}
      {w === -1 && <div style={{ padding: 16, borderRadius: 12, background: C.panel, border: `1px solid ${C.strength}`, marginBottom: 20, color: C.ink, fontFamily: F.body, fontSize: 14 }}>La data è nel passato. Impostane una futura.</div>}
      <button onClick={onBuild} style={cta}>Aggiorna il piano</button>
    </div>
  );
}

function Profile({ p, setP }) {
  const set = (k) => (e) => setP({ ...p, [k]: e.target.value });
  const b = bmi(+p.weight, +p.height), band = bmiBand(b), mhr = maxHR(+p.age);
  return (
    <div>
      <h2 style={h2}>Profilo</h2>
      <p style={sub}>Dati per calcolare zone cardio, ritmi e volumi.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Altezza (cm)"><input style={inputStyle} type="number" inputMode="numeric" value={p.height} onChange={set("height")} placeholder="175" /></Field>
        <Field label="Peso (kg)"><input style={inputStyle} type="number" inputMode="numeric" value={p.weight} onChange={set("weight")} placeholder="72" /></Field>
        <Field label="Età"><input style={inputStyle} type="number" inputMode="numeric" value={p.age} onChange={set("age")} placeholder="34" /></Field>
        <Field label="Sesso"><Seg value={p.sex} onChange={(v) => setP({ ...p, sex: v })} options={[{ v: "m", l: "Uomo" }, { v: "f", l: "Donna" }]} /></Field>
      </div>
      <Field label="Livello attuale"><Seg value={+p.level} onChange={(v) => setP({ ...p, level: v })} options={[{ v: 0, l: "Principiante" }, { v: 1, l: "Intermedio" }, { v: 2, l: "Avanzato" }]} /></Field>
      <Field label={`Inclinazione base tapis roulant · ${p.defaultIncline}%`}>
        <input type="range" min={0} max={12} step={1} value={p.defaultIncline} onChange={(e) => setP({ ...p, defaultIncline: +e.target.value })} style={{ width: "100%", accentColor: C.signal }} />
      </Field>
      <div style={{ marginTop: 8, padding: 18, borderRadius: 14, background: C.panel, border: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontFamily: F.body, fontSize: 12, color: C.mute }}>Indice di massa corporea</span>
          <span style={{ fontFamily: F.body, fontSize: 12, color: C.faint }}>{band.note}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 6 }}>
          <span style={{ fontFamily: F.display, fontSize: 52, fontWeight: 800, color: b ? C.signal : C.faint, lineHeight: 1 }}>{b ?? "—"}</span>
          <span style={{ fontFamily: F.display, fontSize: 20, color: C.ink, fontWeight: 600 }}>{band.label}</span>
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 20, flexWrap: "wrap" }}>
          <Stat k="FC max stimata" v={mhr ? `${mhr} bpm` : "—"} />
          <Stat k="Zona brucia grassi" v={zone(+p.age, 0.6, 0.7)} />
          <Stat k="Zona soglia" v={zone(+p.age, 0.8, 0.9)} />
        </div>
      </div>
    </div>
  );
}
function Stat({ k, v }) {
  return (<div><div style={{ fontFamily: F.body, fontSize: 11, color: C.faint }}>{k}</div>
    <div style={{ fontFamily: F.body, fontSize: 15, color: C.ink, fontWeight: 600, marginTop: 2 }}>{v}</div></div>);
}

function Plan({ p, onMark, todayStatus }) {
  const [open, setOpen] = useState(0);
  if (!p.age || !p.height || !p.weight) return <Empty text="Completa il Profilo per generare il piano." />;
  if (!p.raceDate) return <Empty text="Imposta la data della gara nella sezione Gara." />;
  const { phase, weeks, km, obst, days } = buildWeek(p);
  if (weeks === -1 || !phase || phase.key === "done") return <Empty text="La data gara è passata. Aggiornala nella sezione Gara." />;
  return (
    <div>
      <h2 style={h2}>Settimana</h2>
      <p style={sub}>{phase.name} · {weeks} sett. alla gara · {km} km · {obst} ostacoli</p>
      <div style={{ padding: 14, borderRadius: 12, background: C.panel, border: `1px solid ${C.line}`, marginBottom: 16 }}>
        <span style={{ fontFamily: F.body, fontSize: 13, color: C.mute, lineHeight: 1.5 }}>{phase.desc}</span>
      </div>
      {days.map((s, i) => {
        const isOpen = open === i;
        return (
          <div key={i} style={{ border: `1px solid ${isOpen ? C.signal : C.line}`, borderRadius: 14, marginBottom: 12, overflow: "hidden", background: C.panel }}>
            <button onClick={() => setOpen(isOpen ? -1 : i)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
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
                      <span style={{ width: 8, height: 8, borderRadius: 8, background: bl.type === "cardio" ? C.cardio : bl.type === "grip" ? C.grip : C.strength }} />
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
                      <ul style={{ margin: 0, paddingLeft: 18, color: C.ink, fontFamily: F.body, fontSize: 14, lineHeight: 1.8 }}>
                        {bl.exercises.map((ex, k) => <li key={k}>{ex}</li>)}
                      </ul>
                    )}
                    <p style={{ margin: "10px 0 0", fontFamily: F.body, fontSize: 13, color: C.mute, lineHeight: 1.5 }}>{bl.detail}</p>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button onClick={() => onMark("done", s.name)}
                    style={{ flex: 1, padding: "12px 0", borderRadius: 10, cursor: "pointer", fontFamily: F.body, fontSize: 14, fontWeight: 700, border: `1px solid ${todayStatus === "done" ? C.signal : C.line}`, background: todayStatus === "done" ? C.signal : "transparent", color: todayStatus === "done" ? C.bg : C.ink }}>
                    ✓ Fatto oggi
                  </button>
                  <button onClick={() => onMark("skip", s.name)}
                    style={{ flex: 1, padding: "12px 0", borderRadius: 10, cursor: "pointer", fontFamily: F.body, fontSize: 14, fontWeight: 600, border: `1px solid ${todayStatus === "skip" ? C.strength : C.line}`, background: todayStatus === "skip" ? C.strength : "transparent", color: todayStatus === "skip" ? C.bg : C.mute }}>
                    Saltato
                  </button>
                </div>
                {todayStatus && <div style={{ marginTop: 10, fontFamily: F.body, fontSize: 12, color: C.faint, textAlign: "center" }}>Registrato per oggi. Tocca di nuovo per annullare.</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
function Metric({ k, v, wide }) {
  return (<div style={{ gridColumn: wide ? "1 / -1" : "auto" }}>
    <div style={{ fontFamily: F.body, fontSize: 11, color: C.faint }}>{k}</div>
    <div style={{ fontFamily: F.body, fontSize: 15, color: C.ink, fontWeight: 600, marginTop: 2 }}>{v}</div></div>);
}
function Empty({ text }) { return <div style={{ padding: 40, textAlign: "center", color: C.mute, fontFamily: F.body, fontSize: 15, lineHeight: 1.6 }}>{text}</div>; }

function Calendar({ log, onSetDay }) {
  const [cur, setCur] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [sel, setSel] = useState(null); // selected day key being edited
  const monthNames = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
  const dow = ["L", "M", "M", "G", "V", "S", "D"];

  const first = new Date(cur.y, cur.m, 1);
  const startPad = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(cur.y, cur.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const key = (d) => `${cur.y}-${String(cur.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const tk = todayKey();

  // stats (all-time)
  const entries = Object.values(log);
  const done = entries.filter((e) => e.status === "done").length;
  const skip = entries.filter((e) => e.status === "skip").length;
  const total = done + skip;
  const adherence = total ? Math.round((done / total) * 100) : 0;

  // current streak of consecutive done days ending today or yesterday
  let streak = 0;
  {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    // allow streak to count back from today; stop at first non-done day that has any record gap
    for (let i = 0; i < 400; i++) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (log[k] && log[k].status === "done") { streak++; d.setDate(d.getDate() - 1); }
      else if (i === 0 && (!log[k])) { d.setDate(d.getDate() - 1); } // today not logged yet: keep looking back one day
      else break;
    }
  }

  const move = (delta) => setCur((c) => { const m = c.m + delta; return { y: c.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }; });

  return (
    <div>
      <h2 style={h2}>Calendario</h2>
      <p style={sub}>La tua costanza reale. Verde = fatto, arancio = saltato.</p>

      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <div style={{ flex: 1, padding: 16, borderRadius: 14, background: C.panel, border: `1px solid ${C.line}` }}>
          <div style={{ fontFamily: F.display, fontSize: 40, fontWeight: 800, color: C.signal, lineHeight: 1 }}>{streak}</div>
          <div style={{ fontFamily: F.body, fontSize: 12, color: C.mute, marginTop: 4 }}>giorni di fila</div>
        </div>
        <div style={{ flex: 1, padding: 16, borderRadius: 14, background: C.panel, border: `1px solid ${C.line}` }}>
          <div style={{ fontFamily: F.display, fontSize: 40, fontWeight: 800, color: C.ink, lineHeight: 1 }}>{adherence}<span style={{ fontSize: 20 }}>%</span></div>
          <div style={{ fontFamily: F.body, fontSize: 12, color: C.mute, marginTop: 4 }}>aderenza · {done}/{total}</div>
        </div>
      </div>

      <div style={{ padding: 16, borderRadius: 14, background: C.panel, border: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <button onClick={() => move(-1)} style={navBtn}>‹</button>
          <span style={{ fontFamily: F.display, fontSize: 17, fontWeight: 700, color: C.ink }}>{monthNames[cur.m]} {cur.y}</span>
          <button onClick={() => move(1)} style={navBtn}>›</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, marginBottom: 6 }}>
          {dow.map((d, i) => <div key={i} style={{ textAlign: "center", fontFamily: F.body, fontSize: 11, color: C.faint }}>{d}</div>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const k = key(d);
            const e = log[k];
            const isToday = k === tk;
            const isFuture = k > tk;
            let bg = "transparent", col = C.mute, bd = C.line;
            if (e?.status === "done") { bg = C.signal; col = C.bg; bd = C.signal; }
            else if (e?.status === "skip") { bg = C.strength; col = C.bg; bd = C.strength; }
            const selected = sel === k;
            return (
              <button key={i} disabled={isFuture} onClick={() => setSel(selected ? null : k)}
                style={{ aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 9, background: bg, border: `1px solid ${selected ? C.ink : (isToday && !e ? C.signal : bd)}`, fontFamily: F.body, fontSize: 13, fontWeight: e ? 700 : 500, color: isFuture ? C.faint : col, cursor: isFuture ? "default" : "pointer", opacity: isFuture ? 0.4 : 1, padding: 0 }}>
                {d}
              </button>
            );
          })}
        </div>
      </div>

      {sel && (
        <div style={{ marginTop: 14, padding: 16, borderRadius: 14, background: C.panel, border: `1px solid ${C.ink}` }}>
          <div style={{ fontFamily: F.body, fontSize: 13, color: C.mute, marginBottom: 12 }}>
            {(() => { const [yy, mm, dd] = sel.split("-"); return `${+dd} ${monthNames[+mm - 1]} ${yy}`; })()}
            {log[sel]?.name ? ` · ${log[sel].name}` : ""}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { onSetDay(sel, "done"); }}
              style={{ flex: 1, padding: "11px 0", borderRadius: 10, cursor: "pointer", fontFamily: F.body, fontSize: 14, fontWeight: 700, border: `1px solid ${log[sel]?.status === "done" ? C.signal : C.line}`, background: log[sel]?.status === "done" ? C.signal : "transparent", color: log[sel]?.status === "done" ? C.bg : C.ink }}>
              ✓ Fatto
            </button>
            <button onClick={() => { onSetDay(sel, "skip"); }}
              style={{ flex: 1, padding: "11px 0", borderRadius: 10, cursor: "pointer", fontFamily: F.body, fontSize: 14, fontWeight: 600, border: `1px solid ${log[sel]?.status === "skip" ? C.strength : C.line}`, background: log[sel]?.status === "skip" ? C.strength : "transparent", color: log[sel]?.status === "skip" ? C.bg : C.mute }}>
              Saltato
            </button>
            {log[sel] && (
              <button onClick={() => { onSetDay(sel, null); }}
                style={{ padding: "11px 14px", borderRadius: 10, cursor: "pointer", fontFamily: F.body, fontSize: 14, fontWeight: 500, border: `1px solid ${C.line}`, background: "transparent", color: C.faint }}>
                Rimuovi
              </button>
            )}
          </div>
          <div style={{ marginTop: 10, fontFamily: F.body, fontSize: 12, color: C.faint }}>Allenamento libero o fatto per conto tuo: segnalo qui.</div>
        </div>
      )}

      {total === 0 && <p style={{ marginTop: 16, fontFamily: F.body, fontSize: 13, color: C.faint, textAlign: "center" }}>Tocca un giorno per segnare un allenamento, oppure usa i pulsanti nel Piano.</p>}
    </div>
  );
}
const navBtn = { width: 36, height: 36, borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, fontSize: 20, cursor: "pointer", lineHeight: 1 };

function App() {
  const [tab, setTab] = useState("plan");
  const [p, setP] = useState(() => store.get("profile_v3", {
    height: "", weight: "", age: "", sex: "m", level: 1,
    raceDate: "", raceType: "super", raceKm: 10, raceObstacles: 25,
    trainDays: [0, 2, 4], weakness: "balanced", defaultIncline: 3,
  }));
  useEffect(() => store.set("profile_v3", p), [p]);

  const [log, setLog] = useState(() => loadLog());
  useEffect(() => saveLog(log), [log]);
  const tk = todayKey();
  const todayStatus = log[tk]?.status || null;
  const mark = (status, name) => {
    setLog((prev) => {
      const next = { ...prev };
      if (next[tk]?.status === status) delete next[tk]; // toggle off
      else next[tk] = { status, name };
      return next;
    });
  };
  const setDay = (dayKey, status) => {
    setLog((prev) => {
      const next = { ...prev };
      if (status === null) delete next[dayKey];
      else if (next[dayKey]?.status === status) delete next[dayKey]; // toggle off
      else next[dayKey] = { status, name: next[dayKey]?.name || "Allenamento libero" };
      return next;
    });
  };

  const tabs = [{ id: "plan", l: "Piano" }, { id: "race", l: "Gara" }, { id: "cal", l: "Diario" }, { id: "profile", l: "Profilo" }];
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink }}>
      <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
      <header style={{ padding: "22px 20px 14px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 20, letterSpacing: "-.02em" }}>STRIDE<span style={{ color: C.signal }}>.</span></span>
        <span style={{ fontFamily: F.body, fontSize: 12, color: C.faint }}>Spartan training</span>
      </header>
      <main style={{ maxWidth: 520, margin: "0 auto", padding: "8px 20px 110px" }}>
        {tab === "plan" && <Plan p={p} onMark={mark} todayStatus={todayStatus} />}
        {tab === "race" && <Race p={p} setP={setP} onBuild={() => setTab("plan")} />}
        {tab === "cal" && <Calendar log={log} onSetDay={setDay} />}
        {tab === "profile" && <Profile p={p} setP={setP} />}
      </main>
      <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(14,15,19,.92)", backdropFilter: "blur(10px)", borderTop: `1px solid ${C.line}`, display: "flex", padding: "10px 12px calc(10px + env(safe-area-inset-bottom))" }}>
        <div style={{ display: "flex", maxWidth: 520, margin: "0 auto", width: "100%", gap: 8 }}>
          {tabs.map((t) => { const a = tab === t.id; return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: F.body, fontSize: 14, fontWeight: a ? 700 : 500, background: a ? C.panel : "transparent", color: a ? C.signal : C.mute }}>{t.l}</button>); })}
        </div>
      </nav>
    </div>
  );
}


ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
