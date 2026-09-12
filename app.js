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

// ── Exercise library with progressions (from gym whiteboard) ─────
// Each pattern lists variants ordered easy→hard; the engine picks by
// difficulty tier (0=base .. 3=peak) computed from level+phase.
// ── Exercise library with progressions (from gym whiteboard) ─────
// Each pattern lists variants ordered easy→hard; the engine picks by
// difficulty tier (0=base .. 3=peak) computed from level+phase.
const EX = {
  pull: ["Australian pull up", "Chin up", "Pull up", "Wide pull up", "Pull up anelli", "Muscle up tecnica"],
  push: ["Push up", "Push up larghi", "Dip parallele", "Dip", "Dip anelli", "Dip bar / muscle up"],
  legs: ["Squat corpo libero", "Affondi camminata", "Squat bulgaro", "Squat monopodalico", "Step-up zavorrato"],
  core: ["Plank", "Leg raise", "Toes to bar", "Dragon flag iso", "Dragon flag", "Candela lenta"],
  grip: ["Dead hang", "Australian tenuta", "Dead hang zavorrato", "Wide pull up iso", "Aquila di sangue", "Monkey bar simulazione"],
};

// difficulty tier 0..(len-1) from level(0..2) and phaseTier(0..2)
function variant(pattern, level, phaseTier) {
  const arr = EX[pattern];
  const idx = Math.min(arr.length - 1, Math.round((level + phaseTier) / 4 * (arr.length - 1)) + level);
  return arr[Math.min(arr.length - 1, idx)];
}

// sets/reps/rest scale with level, phaseTier and weekly progression (0..1)
function dose(kind, level, phaseTier, prog, deload) {
  const base = { pull: 3, push: 3, legs: 3, core: 3, grip: 3 }[kind] || 3;
  let sets = base + (level >= 2 ? 1 : 0) + (phaseTier >= 2 ? 1 : 0) + Math.round(prog);
  if (deload) sets = Math.max(2, sets - 1);
  const repMap = { // reps by phase focus
    base: ["12–15", "10–12", "8–10"],
    build: ["8–10", "6–8", "5–6"],
    peak: ["max", "8", "6"],
  };
  const rest = phaseTier >= 2 ? "45–60\"" : phaseTier === 1 ? "60–90\"" : "90\"";
  return { sets, rest };
}

// ── Cardio builder — scales with distance, phase, progression ─────
function cardioBlock(kind, p, ph, longMin, prog, deload) {
  const lvl = +p.level, inc = +p.defaultIncline;
  const taper = ph.key === "taper";
  const mult = deload ? 0.7 : 1;
  if (kind === "long") return {
    type: "cardio", title: "Fondo lungo tapis roulant",
    duration: Math.round((taper ? longMin * 0.6 : longMin) * mult),
    speed: `${paceBase(lvl)} km/h`, incline: `${inc}%`, target: zone(+p.age, 0.6, 0.72),
    detail: `Ritmo costante per la resistenza gara. Aumenta gradualmente la durata rispetto alla scorsa settimana.`,
  };
  if (kind === "intervals") {
    const raw = deload ? 6 : (taper ? 6 : 8 + Math.round(prog * 3) + lvl);
    const reps = Math.max(6, Math.min(12, raw));
    return {
      type: "cardio", title: "Intervalli in salita (VO2)",
      duration: 10 + reps * 3,
      speed: `${paceBase(lvl)}↔${paceFast(lvl)} km/h`, incline: `${inc}→${inc + 5}%`, target: zone(+p.age, 0.85, 0.95),
      detail: `${reps}× (1' forte a ${paceFast(lvl)} km/h incl. ${inc + 5}% · 2' recupero). Simula gli scatti tra ostacoli.`,
    };
  }
  if (kind === "tempo") return {
    type: "cardio", title: "Tempo run (soglia)",
    duration: deload ? 18 : 22 + Math.round(prog * 8),
    speed: `${(paceBase(lvl) + paceFast(lvl)) / 2} km/h`, incline: `${inc + 1}%`, target: zone(+p.age, 0.8, 0.88),
    detail: `Ritmo sostenuto e continuo appena sotto soglia. Alza il muro aerobico.`,
  };
  // hill
  return {
    type: "cardio", title: "Salite ripide (dislivello gara)",
    duration: deload ? 15 : 20 + Math.round(prog * 6),
    speed: `${paceBase(lvl)} km/h`, incline: `${inc + 7}%`, target: zone(+p.age, 0.72, 0.85),
    detail: `Camminata/corsa ripida. La Spartan ha molto dislivello: qui costruisci le gambe da salita.`,
  };
}

// ── Strength block builder ───────────────────────────────────────
function strBlock(title, patterns, p, ph, phaseTier, prog, deload, isGrip) {
  const lvl = +p.level;
  const repRow = { base: ["12–15", "10–12", "8–10"], build: ["8–10", "6–8", "5–6"], peak: ["6–8", "5", "max"] }[ph.key === "taper" ? "peak" : ph.key] || ["10–12"];
  const exercises = patterns.map((pat) => {
    const name = variant(pat, lvl, phaseTier);
    const d = dose(pat, lvl, phaseTier, prog, deload);
    const reps = pat === "core" || pat === "grip"
      ? (pat === "grip" ? `${20 + phaseTier * 10 + Math.round(prog * 10)}"` : ["30\"", "10–12", "max"][phaseTier])
      : repRow[Math.min(2, phaseTier)];
    return `${name} · ${d.sets}×${reps}`;
  });
  return {
    type: isGrip ? "grip" : "strength", title, exercises,
    detail: deload ? "Settimana di scarico: fermati 2-3 rip prima del cedimento." : `Recupero ${dose(patterns[0], lvl, phaseTier, prog, deload).rest} tra le serie.`,
  };
}

// ── Session templates by split, depending on weekly frequency ────
// Returns an ordered array of "session kinds" for the week.
function splitFor(freq, weak) {
  // each entry: { key, kind:'cardio'|'gym'|'combo', focus }
  const C_int = { kind: "cardio", sub: "intervals" };
  const C_long = { kind: "cardio", sub: "long" };
  const C_hill = { kind: "cardio", sub: "hill" };
  const C_tempo = { kind: "cardio", sub: "tempo" };
  const G_push = { kind: "gym", focus: "push" };
  const G_pull = { kind: "gym", focus: "pull" };
  const G_full = { kind: "gym", focus: "full" };
  const G_legs = { kind: "gym", focus: "legs" };
  const Combo = (f) => ({ kind: "combo", focus: f });

  let plan;
  switch (freq) {
    case 1: plan = [Combo("full")]; break;
    case 2: plan = [Combo("full"), C_int]; break;
    case 3: plan = [G_full, C_int, Combo("full")]; break; // full-body dense
    case 4: plan = [G_push, C_int, G_pull, C_long]; break; // upper split + 2 cardio
    case 5: plan = [G_push, C_int, G_pull, C_hill, G_legs]; break;
    case 6: plan = [G_push, C_int, G_pull, C_tempo, G_legs, C_long]; break;
    default: plan = [G_full, C_int, Combo("full")];
  }
  // weakness bias
  if (weak === "endurance") { // swap one gym for a cardio
    const gi = plan.findIndex((x) => x.kind === "gym" || x.kind === "combo");
    if (gi >= 0 && freq >= 3) plan[gi] = C_hill;
  }
  if (weak === "pull") plan = plan.map((x) => (x.kind === "gym" && x.focus === "push" ? G_full : x)).concat();
  return plan;
}

const phaseTierOf = (k) => (k === "base" ? 0 : k === "build" ? 1 : 2); // taper→2

function buildWeek(p) {
  const w = weeksTo(p.raceDate);
  const ph = phaseFor(w);
  if (!ph || ph.key === "done") return { phase: ph, weeks: w, days: [] };

  const race = RACES[p.raceType] || RACES.super;
  const km = +p.raceKm || race.km;
  const obst = +p.raceObstacles || race.obstacles;
  const dayNames = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
  const chosen = Array.isArray(p.trainDays) && p.trainDays.length ? [...p.trainDays].sort((a, b) => a - b) : [0, 2, 4];
  const freq = chosen.length;
  const weak = p.weakness;
  const phaseTier = phaseTierOf(ph.key);

  // weekly progression: how far into the CURRENT phase are we (0..1),
  // with every 4th week a deload
  const totalW = weeksTo(p.startDate || p.raceDate); // weeks from start not tracked; approximate via race
  const weekNo = (p.startDate ? Math.max(1, Math.ceil((Date.now() - new Date(p.startDate + "T00:00:00")) / (7 * 864e5))) : 1);
  const deload = weekNo % 4 === 0;
  // progression inside phase: base big, shrinks near race
  const prog = ph.key === "base" ? 0.3 : ph.key === "build" ? 0.6 : ph.key === "peak" ? 1 : 0.4;

  const longMin = Math.min(75, Math.round(km * (ph.key === "base" ? 4 : ph.key === "build" ? 4.5 : 5)));
  const combo = p.dayStyle === "combo"; // force combo, else use split's own kind

  const split = splitFor(freq, weak);

  const gymFocus = (focus) => {
    // returns array of blocks for a gym/combo day
    if (focus === "push") return [strBlock("Spinta", ["push", "push"], p, ph, phaseTier, prog, deload), strBlock("Core", ["core"], p, ph, phaseTier, prog, deload)];
    if (focus === "pull") return [strBlock("Trazione", ["pull", "pull"], p, ph, phaseTier, prog, deload), strBlock("Grip", ["grip"], p, ph, phaseTier, prog, deload, true), strBlock("Core", ["core"], p, ph, phaseTier, prog, deload)];
    if (focus === "legs") return [strBlock("Gambe", ["legs", "legs"], p, ph, phaseTier, prog, deload), strBlock("Core", ["core"], p, ph, phaseTier, prog, deload)];
    // full
    return [strBlock("Trazione", ["pull"], p, ph, phaseTier, prog, deload), strBlock("Spinta", ["push"], p, ph, phaseTier, prog, deload), strBlock("Gambe", ["legs"], p, ph, phaseTier, prog, deload), strBlock("Grip / core", ["grip", "core"], p, ph, phaseTier, prog, deload, true)];
  };

  const out = split.slice(0, freq).map((slot, i) => {
    const label = dayNames[chosen[i]] ?? dayNames[i];
    if (slot.kind === "cardio") {
      const b = cardioBlock(slot.sub, p, ph, longMin, prog, deload);
      return { day: label, name: b.title, blocks: [b] };
    }
    if (slot.kind === "combo" || combo) {
      // short cardio finisher + focused strength
      const cardioFin = cardioBlock(i % 2 ? "intervals" : "hill", p, ph, Math.round(longMin * 0.5), prog * 0.6, deload);
      cardioFin.duration = Math.min(cardioFin.duration, 20);
      cardioFin.title = "Cardio (finisher)";
      const blocks = [...gymFocus(slot.focus || "full").slice(0, 2), cardioFin];
      return { day: label, name: "Combo forza + cardio", blocks };
    }
    // gym
    return { day: label, name: gymName(slot.focus), blocks: gymFocus(slot.focus) };
  });

  return { phase: ph, weeks: w, km, obst, days: out, deload, weekNo };
}
function gymName(f) { return { push: "Spinta + core", pull: "Trazione + grip", legs: "Gambe + core", full: "Full body" }[f] || "Palestra"; }

// ── Gemini API helpers (browser-direct; key stays in localStorage) ─
// Google's generativelanguage endpoint permits browser CORS with the
// key as a query param, so a static PWA can call it directly.
const GEM_BASE = "https://generativelanguage.googleapis.com/v1beta";

async function gemListModels(key) {
  const r = await fetch(`${GEM_BASE}/models?key=${encodeURIComponent(key)}`);
  if (!r.ok) { const t = await r.text(); throw new Error(`${r.status}: ${t.slice(0, 160)}`); }
  const d = await r.json();
  return (d.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name.replace("models/", ""));
}

async function gemGenerate(key, model, parts, { json = false } = {}) {
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: json ? { responseMimeType: "application/json", temperature: 0.6 } : { temperature: 0.7 },
  };
  const r = await fetch(`${GEM_BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`${r.status}: ${t.slice(0, 200)}`); }
  const d = await r.json();
  const cand = d.candidates?.[0];
  if (!cand) throw new Error("Nessuna risposta dal modello.");
  return (cand.content?.parts || []).map((p) => p.text || "").join("").trim();
}

// strip ```json fences if present, then parse
function parseJSON(text) {
  const clean = text.replace(/```json\s*|\s*```/g, "").trim();
  return JSON.parse(clean);
}

// Convert a file (image) to base64 for inline_data
function fileToInlinePart(file) {
  return new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onload = () => res({ inline_data: { mime_type: file.type || "image/jpeg", data: rd.result.split(",")[1] } });
    rd.onerror = () => rej(new Error("Lettura file fallita"));
    rd.readAsDataURL(file);
  });
}

// ── High-level tasks ─────────────────────────────────────────────
function planContext(p, gen) {
  return `Atleta: ${p.age} anni, ${p.sex === "f" ? "donna" : "uomo"}, ${p.height} cm, ${p.weight} kg, livello ${["principiante", "intermedio", "avanzato"][+p.level]}.
Obiettivo: Spartan ${p.raceType} (${p.raceKm} km, ${p.raceObstacles} ostacoli) il ${p.raceDate}, tra ${gen.weeks} settimane, fase "${gen.phase?.name}".
Giorni/sett: ${p.trainDays?.length}. Punto debole: ${p.weakness}. Stile: ${p.dayStyle}.
Attrezzi palestra disponibili: sbarra, anelli, parallele, dip station, corpo libero. Tapis roulant a casa (inclinazione 0-12%).
Piano attuale generato dall'app:
${gen.days?.map((d) => `- ${d.day} · ${d.name}: ${d.blocks.map((b) => b.type === "cardio" ? `${b.title} ${b.duration}min` : `${b.title} [${(b.exercises || []).join("; ")}]`).join(" | ")}`).join("\n")}`;
}

async function aiRewritePlan(p, gen, key, model) {
  const prompt = `Sei un preparatore atletico esperto di Spartan Race e calisthenics.
${planContext(p, gen)}

Riscrivi il piano SETTIMANALE ottimizzandolo per questo atleta e questa fase. Usa SOLO gli attrezzi elencati.
Rispondi in JSON con questo schema esatto:
{"days":[{"day":"Lun","name":"...","blocks":[{"type":"cardio|strength|grip","title":"...","duration":30,"speed":"6 km/h","incline":"3%","target":"140-150 bpm","exercises":["Nome · 3×10"],"detail":"..."}]}]}
Per i blocchi cardio includi duration/speed/incline/target. Per strength/grip includi exercises (con serie×rip) e detail. Mantieni ${p.trainDays?.length} giorni. Testo in italiano.`;
  const txt = await gemGenerate(key, model, [{ text: prompt }], { json: true });
  const obj = parseJSON(txt);
  if (!obj.days || !Array.isArray(obj.days)) throw new Error("Formato risposta non valido.");
  return obj.days;
}

async function aiSwapExercise(exercise, p, key, model) {
  const prompt = `Atleta livello ${["principiante", "intermedio", "avanzato"][+p.level]}, prepara una Spartan Race.
Attrezzi: sbarra, anelli, parallele, dip station, corpo libero.
Proponi 4 esercizi ALTERNATIVI a "${exercise}" che allenino lo stesso pattern muscolare, con serie×ripetizioni adatte.
Rispondi in JSON: {"alternatives":["Nome · 3×10","..."]}. Solo italiano.`;
  const txt = await gemGenerate(key, model, [{ text: prompt }], { json: true });
  return parseJSON(txt).alternatives || [];
}

async function aiReadPhoto(file, p, key, model) {
  const img = await fileToInlinePart(file);
  const prompt = `Questa è la foto di uno schema di allenamento (lavagna/foglio) del mio allenatore, spesso in italiano con abbreviazioni (es. "3x10", "REC 2'", "ISO", "PP x2").
Leggi tutto lo schema e strutturalo in JSON pulito:
{"title":"...","sessions":[{"name":"...","exercises":["Nome · serie×rip o durata"]}],"notes":"eventuali note"}
Interpreta le abbreviazioni in modo sensato. Solo italiano.`;
  const txt = await gemGenerate(key, model, [{ text: prompt }, img], { json: true });
  return parseJSON(txt);
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
      <Field label="Stile delle giornate">
        <Seg value={p.dayStyle} onChange={(v) => setP({ ...p, dayStyle: v })} options={[{ v: "split", l: "Separati" }, { v: "combo", l: "Combo (cardio+forza)" }]} />
      </Field>
      <Field label="Inizio del programma"><input style={inputStyle} type="date" value={p.startDate} onChange={(e) => setP({ ...p, startDate: e.target.value })} /></Field>
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

      <AISettings p={p} setP={setP} />
    </div>
  );
}

function AISettings({ p, setP }) {
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState(null); // {ok, msg}
  const [models, setModels] = useState(p.aiModels || []);

  const test = async () => {
    if (!p.aiKey) { setStatus({ ok: false, msg: "Inserisci prima la API key." }); return; }
    setTesting(true); setStatus(null);
    try {
      const list = await gemListModels(p.aiKey.trim());
      const flash = list.find((m) => /flash/i.test(m) && /2\.\d|latest/i.test(m)) || list.find((m) => /flash/i.test(m)) || list[0];
      setModels(list);
      setP({ ...p, aiKey: p.aiKey.trim(), aiModels: list, aiModel: p.aiModel && list.includes(p.aiModel) ? p.aiModel : flash });
      setStatus({ ok: true, msg: `Connessa. ${list.length} modelli disponibili.` });
    } catch (e) {
      setStatus({ ok: false, msg: `Errore: ${e.message}` });
    } finally { setTesting(false); }
  };

  return (
    <div style={{ marginTop: 22, padding: 18, borderRadius: 14, background: C.panel, border: `1px solid ${C.line}` }}>
      <div style={{ fontFamily: F.display, fontSize: 17, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Coach IA (Gemini)</div>
      <div style={{ fontFamily: F.body, fontSize: 13, color: C.mute, marginBottom: 16, lineHeight: 1.5 }}>
        La chiave resta salvata solo su questo telefono. Serve per far rielaborare il piano, sostituire esercizi e leggere le foto degli schemi.
      </div>

      <Field label="Gemini API key">
        <input style={inputStyle} type="password" value={p.aiKey || ""} onChange={(e) => setP({ ...p, aiKey: e.target.value })} placeholder="AIza..." autoComplete="off" />
      </Field>

      <button onClick={test} disabled={testing} style={{ ...cta, opacity: testing ? 0.6 : 1, marginBottom: 12 }}>
        {testing ? "Verifica in corso…" : "Testa connessione"}
      </button>

      {status && (
        <div style={{ padding: "10px 12px", borderRadius: 10, marginBottom: 12, fontFamily: F.body, fontSize: 13, color: status.ok ? C.bg : C.ink, background: status.ok ? C.signal : "transparent", border: `1px solid ${status.ok ? C.signal : C.strength}` }}>
          {status.msg}
        </div>
      )}

      {models.length > 0 && (
        <Field label="Modello">
          <select value={p.aiModel || ""} onChange={(e) => setP({ ...p, aiModel: e.target.value })} style={{ ...inputStyle, appearance: "none" }}>
            {models.map((m) => <option key={m} value={m} style={{ background: C.bg }}>{m}</option>)}
          </select>
        </Field>
      )}

      <div style={{ fontFamily: F.body, fontSize: 12, color: C.faint, marginTop: 4, lineHeight: 1.5 }}>
        Ottieni una chiave gratuita su aistudio.google.com/apikey
      </div>
    </div>
  );
}
function Stat({ k, v }) {
  return (<div><div style={{ fontFamily: F.body, fontSize: 11, color: C.faint }}>{k}</div>
    <div style={{ fontFamily: F.body, fontSize: 15, color: C.ink, fontWeight: 600, marginTop: 2 }}>{v}</div></div>);
}

function Plan({ p, setP, onMark, todayStatus, aiPlan, setAiPlan }) {
  const [open, setOpen] = useState(0);
  const [busy, setBusy] = useState(null); // "rewrite" | "photo" | `swap-i-j-k`
  const [err, setErr] = useState(null);
  const [proposal, setProposal] = useState(null); // pending AI plan awaiting approval
  const [swap, setSwap] = useState(null); // {bi,bj,ek,alts}

  if (!p.age || !p.height || !p.weight) return <Empty text="Completa il Profilo per generare il piano." />;
  if (!p.raceDate) return <Empty text="Imposta la data della gara nella sezione Gara." />;
  const gen = buildWeek(p);
  const { phase, weeks, km, obst, deload, weekNo } = gen;
  if (weeks === -1 || !phase || phase.key === "done") return <Empty text="La data gara è passata. Aggiornala nella sezione Gara." />;

  const days = aiPlan || gen.days; // AI plan overrides engine plan when present
  const hasKey = !!p.aiKey;

  const runRewrite = async () => {
    setErr(null); setBusy("rewrite");
    try {
      const newDays = await aiRewritePlan(p, gen, p.aiKey.trim(), p.aiModel || "gemini-1.5-flash");
      setProposal(newDays);
    } catch (e) { setErr(`Coach IA: ${e.message}`); }
    finally { setBusy(null); }
  };
  const applyProposal = () => { setAiPlan(proposal); setProposal(null); setOpen(0); };

  const runPhoto = async (file) => {
    if (!file) return;
    setErr(null); setBusy("photo");
    try {
      const parsed = await aiReadPhoto(file, p, p.aiKey.trim(), p.aiModel || "gemini-1.5-flash");
      // turn parsed sessions into plan days appended
      const extra = (parsed.sessions || []).map((s, i) => ({
        day: parsed.title ? parsed.title.slice(0, 12) : `Coach ${i + 1}`,
        name: s.name || "Scheda allenatore",
        blocks: [{ type: "strength", title: s.name || "Scheda", exercises: s.exercises || [], detail: parsed.notes || "Importato dalla foto." }],
      }));
      if (!extra.length) throw new Error("Nessun esercizio riconosciuto nella foto.");
      setProposal([...(aiPlan || gen.days), ...extra]);
    } catch (e) { setErr(`Lettura foto: ${e.message}`); }
    finally { setBusy(null); }
  };

  const runSwap = async (bi, bj, ek, exercise) => {
    setErr(null); setBusy(`swap-${bi}-${bj}-${ek}`);
    try {
      const alts = await aiSwapExercise(exercise, p, p.aiKey.trim(), p.aiModel || "gemini-1.5-flash");
      setSwap({ bi, bj, ek, alts, original: exercise });
    } catch (e) { setErr(`Alternative: ${e.message}`); }
    finally { setBusy(null); }
  };
  const applySwap = (choice) => {
    const src = aiPlan || gen.days;
    const copy = src.map((d) => ({ ...d, blocks: d.blocks.map((b) => ({ ...b, exercises: b.exercises ? [...b.exercises] : b.exercises })) }));
    copy[swap.bi].blocks[swap.bj].exercises[swap.ek] = choice;
    setAiPlan(copy); setSwap(null);
  };

  return (
    <div>
      <h2 style={h2}>Settimana</h2>
      <p style={sub}>{phase.name} · settimana {weekNo}{deload ? " (scarico)" : ""} · {weeks} sett. alla gara · {km} km · {obst} ostacoli</p>

      {/* AI action bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <button onClick={hasKey ? runRewrite : null} disabled={!hasKey || busy}
          style={{ flex: "1 1 auto", padding: "12px", borderRadius: 10, border: `1px solid ${C.signal}`, background: hasKey ? C.signal : "transparent", color: hasKey ? C.bg : C.faint, fontFamily: F.body, fontSize: 14, fontWeight: 700, cursor: hasKey ? "pointer" : "default", opacity: busy === "rewrite" ? 0.6 : 1 }}>
          {busy === "rewrite" ? "Elaboro…" : "⚡ Rielabora con IA"}
        </button>
        <label style={{ flex: "1 1 auto", padding: "12px", borderRadius: 10, border: `1px solid ${C.line}`, background: "transparent", color: hasKey ? C.ink : C.faint, fontFamily: F.body, fontSize: 14, fontWeight: 600, cursor: hasKey ? "pointer" : "default", textAlign: "center", opacity: busy === "photo" ? 0.6 : 1 }}>
          {busy === "photo" ? "Leggo…" : "📷 Foto schema"}
          <input type="file" accept="image/*" disabled={!hasKey || busy} onChange={(e) => runPhoto(e.target.files?.[0])} style={{ display: "none" }} />
        </label>
      </div>
      {!hasKey && <div style={{ marginBottom: 14, fontFamily: F.body, fontSize: 12, color: C.faint }}>Aggiungi la Gemini API key nel Profilo per attivare le funzioni IA.</div>}
      {aiPlan && <button onClick={() => setAiPlan(null)} style={{ marginBottom: 14, padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.mute, fontFamily: F.body, fontSize: 13, cursor: "pointer" }}>↩ Torna al piano dell'app</button>}
      {err && <div style={{ padding: "10px 12px", borderRadius: 10, marginBottom: 14, fontFamily: F.body, fontSize: 13, color: C.ink, border: `1px solid ${C.strength}` }}>{err}</div>}

      {/* Proposal approval banner */}
      {proposal && (
        <div style={{ padding: 16, borderRadius: 14, background: C.panel, border: `1px solid ${C.signal}`, marginBottom: 16 }}>
          <div style={{ fontFamily: F.body, fontSize: 14, color: C.ink, fontWeight: 600, marginBottom: 4 }}>Nuova proposta dell'IA pronta</div>
          <div style={{ fontFamily: F.body, fontSize: 13, color: C.mute, marginBottom: 12, lineHeight: 1.5 }}>{proposal.length} giorni. Vuoi sostituire il piano attuale?</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={applyProposal} style={{ flex: 1, padding: "11px 0", borderRadius: 10, border: "none", background: C.signal, color: C.bg, fontFamily: F.body, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Applica</button>
            <button onClick={() => setProposal(null)} style={{ flex: 1, padding: "11px 0", borderRadius: 10, border: `1px solid ${C.line}`, background: "transparent", color: C.mute, fontFamily: F.body, fontSize: 14, cursor: "pointer" }}>Annulla</button>
          </div>
        </div>
      )}

      <div style={{ padding: 14, borderRadius: 12, background: C.panel, border: `1px solid ${C.line}`, marginBottom: 16 }}>
        <span style={{ fontFamily: F.body, fontSize: 13, color: C.mute, lineHeight: 1.5 }}>{aiPlan ? "Piano rielaborato dall'IA. Tocca un esercizio per sostituirlo." : phase.desc}</span>
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
                        <Metric k="Inclinazione" v={bl.incline} />
                        <Metric k="Zona FC" v={bl.target} wide />
                      </div>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 4, listStyle: "none" }}>
                        {(bl.exercises || []).map((ex, k) => {
                          const swapping = busy === `swap-${i}-${j}-${k}`;
                          return (
                            <li key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "6px 0", color: C.ink, fontFamily: F.body, fontSize: 14 }}>
                              <span>{ex}</span>
                              {hasKey && <button onClick={() => runSwap(i, j, k, ex)} disabled={busy}
                                style={{ flexShrink: 0, padding: "5px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.mute, fontFamily: F.body, fontSize: 12, cursor: "pointer", opacity: swapping ? 0.6 : 1 }}>
                                {swapping ? "…" : "↺ Cambia"}
                              </button>}
                            </li>
                          );
                        })}
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

      {/* Swap chooser modal */}
      {swap && (
        <div onClick={() => setSwap(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 520, background: C.panel, borderTopLeftRadius: 18, borderTopRightRadius: 18, border: `1px solid ${C.line}`, padding: 20, paddingBottom: "calc(20px + env(safe-area-inset-bottom))" }}>
            <div style={{ fontFamily: F.display, fontSize: 18, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Sostituisci esercizio</div>
            <div style={{ fontFamily: F.body, fontSize: 13, color: C.mute, marginBottom: 16 }}>Al posto di: {swap.original}</div>
            {swap.alts.map((a, i) => (
              <button key={i} onClick={() => applySwap(a)} style={{ width: "100%", textAlign: "left", padding: "14px 16px", borderRadius: 10, marginBottom: 8, border: `1px solid ${C.line}`, background: C.bg, color: C.ink, fontFamily: F.body, fontSize: 14, cursor: "pointer" }}>{a}</button>
            ))}
            <button onClick={() => setSwap(null)} style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: "transparent", color: C.mute, fontFamily: F.body, fontSize: 14, cursor: "pointer", marginTop: 4 }}>Chiudi</button>
          </div>
        </div>
      )}
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
  const [p, setP] = useState(() => store.get("profile_v5", {
    height: "", weight: "", age: "", sex: "m", level: 1,
    raceDate: "", raceType: "super", raceKm: 10, raceObstacles: 25,
    trainDays: [0, 2, 4], weakness: "balanced", defaultIncline: 3,
    startDate: todayKey(), dayStyle: "split",
  }));
  useEffect(() => store.set("profile_v5", p), [p]);

  const [log, setLog] = useState(() => loadLog());
  useEffect(() => saveLog(log), [log]);
  const [aiPlan, setAiPlan] = useState(() => store.get("aiplan_v1", null));
  useEffect(() => store.set("aiplan_v1", aiPlan), [aiPlan]);
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
        {tab === "plan" && <Plan p={p} setP={setP} onMark={mark} todayStatus={todayStatus} aiPlan={aiPlan} setAiPlan={setAiPlan} />}
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
