// Workout generator. All power values are fractions of FTP (1.0 = 100% FTP).
// A workout is a list of items; an item is either a step
//   { name, dur (seconds), pct, intensity: 'warmup'|'active'|'rest'|'cooldown' }
// or a repeat block { repeat: n, steps: [step, ...] } (no nesting — matches what FIT supports).

export const TYPES = [
  { id: 'recovery', label: 'Recovery', load: 'easy', blurb: 'Very easy spin to flush the legs. Keep it truly easy.' },
  { id: 'endurance', label: 'Endurance', load: 'easy', blurb: 'Aerobic base. Builds fat oxidation and fatigue resistance.' },
  { id: 'tempo', label: 'Tempo', load: 'medium', blurb: 'Steady, comfortably hard. Muscular endurance.' },
  { id: 'sweetspot', label: 'Sweet Spot', load: 'medium', blurb: 'High aerobic stimulus for moderate fatigue. Raises FTP.' },
  { id: 'threshold', label: 'Threshold', load: 'hard', blurb: 'Right around FTP. Raises and extends your threshold.' },
  { id: 'vo2max', label: 'VO2max', load: 'hard', blurb: 'Hard intervals that raise your aerobic ceiling.' },
  { id: 'anaerobic', label: 'Anaerobic', load: 'hard', blurb: 'Short, very hard efforts and sprints. Top-end power.' },
];

export const typeById = (id) => TYPES.find((t) => t.id === id);

export const ZONES = [
  { max: 0.55, id: 'z1', label: 'Recovery' },
  { max: 0.76, id: 'z2', label: 'Endurance' },
  { max: 0.88, id: 'z3', label: 'Tempo' },
  { max: 0.95, id: 'z4a', label: 'Sweet Spot' },
  { max: 1.06, id: 'z4', label: 'Threshold' },
  { max: 1.21, id: 'z5', label: 'VO2max' },
  { max: Infinity, id: 'z6', label: 'Anaerobic' },
];
export const zoneOf = (pct) => ZONES.find((z) => pct < z.max) || ZONES[ZONES.length - 1];

export function mulberry32(seed) {
  let a = Math.imul(seed >>> 0, 0x9e3779b1) >>> 0; // scramble so nearby seeds diverge
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const S = (name, dur, pct, intensity = 'active') => ({ name, dur: Math.round(dur), pct: round2(pct), intensity });
const round2 = (x) => Math.round(x * 100) / 100;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const min = (m) => m * 60;
const pctStr = (p) => `${Math.round(p * 100)}%`;
const durStr = (s) => (s % 60 === 0 ? `${s / 60}'` : s < 60 ? `${s}"` : `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}"`);

// Pick from an array ordered easy→hard, centred on the difficulty level (1–5), with a little randomness.
function pickByLevel(arr, level, rng, jitter = 1) {
  const base = Math.round(((level - 1) / 4) * (arr.length - 1));
  const j = rng() < 0.5 ? 0 : rng() < 0.5 ? -jitter : jitter;
  return clamp(base + j, 0, arr.length - 1);
}

const blockDur = (items) =>
  items.reduce((t, it) => t + (it.repeat ? it.repeat * it.steps.reduce((a, s) => a + s.dur, 0) : it.dur), 0);

// Choose interval length/reps that fill the main set as fully as possible, staying close to the
// level's preferred length. Work intervals may be stretched by up to 25% (in `grain` steps) to fill time.
function fitIntervals(rng, main, candidates, startIdx, restFor, minReps, maxReps, grain = 60) {
  let best = null;
  const lo = Math.max(0, startIdx - 1), hi = Math.min(candidates.length - 1, startIdx + 1);
  for (let i = lo; i <= hi; i++) {
    const base = candidates[i];
    const rest = restFor(base);
    const reps = Math.min(maxReps, Math.floor(main / (base + rest)));
    if (reps < minReps) continue;
    const stretched = Math.floor((main / reps - rest) / grain) * grain;
    const work = Math.max(base, Math.min(stretched, Math.floor((base * 1.25) / grain) * grain));
    const left = main - reps * (work + rest);
    const score = left + Math.abs(i - startIdx) * 120 + rng() * 300; // prefer level's choice + good fill, with some variety
    if (!best || score < best.score) best = { work, rest, reps, score };
  }
  if (best) return best;
  for (let i = startIdx; i >= 0; i--) {
    const work = candidates[i];
    const rest = restFor(work);
    const reps = Math.min(maxReps, Math.floor(main / (work + rest)));
    if (reps >= minReps) return { work, rest, reps };
  }
  // Not even one of the shortest fits: one interval that fills the main set.
  let rest = Math.min(restFor(candidates[0]), Math.round(main / 3 / 60) * 60);
  let work = Math.floor((main - rest) / 60) * 60;
  const reps = Math.min(maxReps, Math.floor(main / (candidates[0] + restFor(candidates[0]))));
  if (reps >= 1) return { work: candidates[0], rest: restFor(candidates[0]), reps };
  return { work: Math.max(60, work), rest: Math.max(60, rest), reps: 1 };
}

// ---------- main sets ----------

const BUILDERS = {
  recovery(main, level, rng) {
    const pct = 0.45 + 0.025 * Math.min(level, 4);
    if (main >= min(15) && rng() < 0.5) {
      const cycle = min(5);
      const reps = Math.floor(main / cycle);
      return {
        title: `Recovery spin + spin-ups`,
        items: [{ repeat: reps, steps: [S('Easy spin', cycle - 30, pct), S('Spin-up 100rpm', 30, pct)] }],
      };
    }
    return { title: `Recovery spin @${pctStr(pct)}`, items: [S('Easy spin', main, pct)] };
  },

  endurance(main, level, rng) {
    const pct = 0.64 + 0.015 * (level - 1);
    const r = rng();
    if (main >= min(20) && level >= 3 && r < 0.4) {
      const reps = Math.floor(main / min(10));
      return {
        title: `Endurance w/ ${reps} tempo bursts`,
        items: [{ repeat: reps, steps: [S('Endurance', min(9), pct), S('Burst', min(1), 0.88)] }],
      };
    }
    if (main >= min(20) && r < 0.7) {
      const reps = Math.floor(main / min(10));
      return {
        title: `Rolling endurance`,
        items: [{ repeat: reps, steps: [S('Endurance', min(5), pct - 0.04), S('Endurance+', min(5), pct + 0.05)] }],
      };
    }
    if (main >= min(20)) {
      const reps = Math.floor(main / min(10));
      return {
        title: `Endurance + cadence drills`,
        items: [{ repeat: reps, steps: [S('Endurance', min(8), pct), S('Cadence 100+', min(2), pct)] }],
      };
    }
    return { title: `Endurance @${pctStr(pct)}`, items: [S('Endurance', main, pct)] };
  },

  tempo(main, level, rng) {
    const works = [10, 12, 15, 20, 25, 30, 40].map(min);
    const pct = 0.8 + 0.017 * (level - 1);
    const f = fitIntervals(rng, main, works, pickByLevel(works, level, rng), () => min(5), 2, 6);
    return {
      title: `${f.reps}x${durStr(f.work)} Tempo @${pctStr(pct)}`,
      items: [{ repeat: f.reps, steps: [S('Tempo', f.work, pct), S('Recover', f.rest, 0.6, 'rest')] }],
    };
  },

  sweetspot(main, level, rng) {
    const works = [6, 8, 10, 12, 15, 20, 30].map(min);
    const pct = 0.88 + 0.0125 * (level - 1);
    const restFor = (w) => clamp(Math.round(w / 3 / 60) * 60, min(3), min(6));
    const f = fitIntervals(rng, main, works, pickByLevel(works, level, rng), restFor, 2, 6);
    if (level >= 3 && f.work % min(5) === 0 && rng() < 0.4) {
      const steps = [];
      for (let k = 0; k < f.work / min(5); k++) steps.push(S('Sweet Spot', 270, pct), S('Surge', 30, 1.05));
      steps.push(S('Recover', f.rest, 0.55, 'rest'));
      return { title: `${f.reps}x${durStr(f.work)} Sweet Spot w/ surges`, items: [{ repeat: f.reps, steps }] };
    }
    return {
      title: `${f.reps}x${durStr(f.work)} Sweet Spot @${pctStr(pct)}`,
      items: [{ repeat: f.reps, steps: [S('Sweet Spot', f.work, pct), S('Recover', f.rest, 0.55, 'rest')] }],
    };
  },

  threshold(main, level, rng) {
    const restFor = (w) => clamp(Math.round(w / 2 / 60) * 60, min(3), min(5));
    if (level >= 3 && rng() < 0.45) {
      // Over-unders: 2' under / 1' over
      const works = [6, 9, 12, 15].map(min);
      const f = fitIntervals(rng, main, works, pickByLevel(works, level, rng), restFor, 2, 5, 180);
      const over = 1.04 + 0.01 * (level - 3);
      const steps = [];
      for (let k = 0; k < f.work / min(3); k++) steps.push(S('Under', min(2), 0.95), S('Over', min(1), over));
      steps.push(S('Recover', f.rest, 0.55, 'rest'));
      return { title: `${f.reps}x${durStr(f.work)} Over-Unders`, items: [{ repeat: f.reps, steps }] };
    }
    const works = [5, 6, 8, 10, 12, 15, 20].map(min);
    const pct = 0.95 + 0.0175 * (level - 1);
    const f = fitIntervals(rng, main, works, pickByLevel(works, level, rng), restFor, 2, 6);
    return {
      title: `${f.reps}x${durStr(f.work)} Threshold @${pctStr(pct)}`,
      items: [{ repeat: f.reps, steps: [S('Threshold', f.work, pct), S('Recover', f.rest, 0.55, 'rest')] }],
    };
  },

  vo2max(main, level, rng) {
    const r = rng();
    // 30/15s in sets of 13 (Rønnestad)
    if (r < 0.33 && main >= min(13)) {
      const set = 13 * 45;
      const setRest = min(3);
      const sets = clamp(Math.floor((main + setRest) / (set + setRest)), 1, level >= 3 ? 3 : 2);
      const on = 1.15 + 0.02 * (level - 1);
      const items = [];
      for (let k = 0; k < sets; k++) {
        items.push({ repeat: 13, steps: [S('ON', 30, on), S('off', 15, 0.5, 'rest')] });
        if (k < sets - 1) items.push(S('Set rest', setRest, 0.5, 'rest'));
      }
      return { title: `${sets}x13x30/15 @${pctStr(on)}`, items };
    }
    // 40/20s in 8-minute sets
    if (r < 0.55 && main >= min(8)) {
      const set = 8 * 60;
      const setRest = min(4);
      const sets = clamp(Math.floor((main + setRest) / (set + setRest)), 1, 3);
      const on = 1.15 + 0.02 * (level - 1);
      const items = [];
      for (let k = 0; k < sets; k++) {
        items.push({ repeat: 8, steps: [S('ON', 40, on), S('off', 20, 0.5, 'rest')] });
        if (k < sets - 1) items.push(S('Set rest', setRest, 0.5, 'rest'));
      }
      return { title: `${sets}x8x40/20 @${pctStr(on)}`, items };
    }
    const works = [120, 180, 180, 240, 300];
    const f = fitIntervals(rng, main, works, pickByLevel(works, level, rng), (w) => Math.max(w, 120), 2, 8);
    const pct = clamp(1.28 - (f.work / 60) * 0.04, 1.06, 1.2) + 0.01 * (level - 3);
    return {
      title: `${f.reps}x${durStr(f.work)} VO2max @${pctStr(pct)}`,
      items: [{ repeat: f.reps, steps: [S('VO2max', f.work, pct), S('Recover', f.rest, 0.5, 'rest')] }],
    };
  },

  anaerobic(main, level, rng) {
    const r = rng();
    if (r < 0.33) {
      const reps = clamp(Math.floor(main / min(5)), 1, 4 + level);
      return {
        title: `${reps}x15" Sprints`,
        items: [{ repeat: reps, steps: [S('SPRINT', 15, 2.0), S('Recover', min(5) - 15, 0.5, 'rest')] }],
      };
    }
    if (r < 0.66) {
      const reps = clamp(Math.floor(main / 180), 1, 6 + level);
      const pct = 1.4 + 0.025 * (level - 1);
      return {
        title: `${reps}x30" Anaerobic @${pctStr(pct)}`,
        items: [{ repeat: reps, steps: [S('Anaerobic', 30, pct), S('Recover', 150, 0.5, 'rest')] }],
      };
    }
    const reps = clamp(Math.floor(main / min(4)), 1, 4 + level);
    const pct = 1.25 + 0.025 * (level - 1);
    return {
      title: `${reps}x1' Anaerobic @${pctStr(pct)}`,
      items: [{ repeat: reps, steps: [S('Anaerobic', 60, pct), S('Recover', min(3), 0.5, 'rest')] }],
    };
  },
};

function warmup(type, sec) {
  const load = typeById(type).load;
  if (load === 'easy') {
    return [S('Warm up', sec / 2, 0.45, 'warmup'), S('Warm up', sec - Math.round(sec / 2), 0.55, 'warmup')];
  }
  if (load === 'hard' && sec >= min(8)) {
    const rest = sec - min(2);
    const a = Math.round(rest * 0.4), b = Math.round(rest * 0.3);
    return [
      S('Warm up', a, 0.5, 'warmup'),
      S('Warm up', b, 0.6, 'warmup'),
      S('Warm up', rest - a - b, 0.7, 'warmup'),
      S('Opener', 60, 1.0, 'warmup'),
      S('Easy', 60, 0.55, 'warmup'),
    ];
  }
  const a = Math.round(sec * 0.4), b = Math.round(sec * 0.3);
  return [S('Warm up', a, 0.5, 'warmup'), S('Warm up', b, 0.6, 'warmup'), S('Warm up', sec - a - b, 0.7, 'warmup')];
}

function cooldown(sec) {
  const a = Math.round(sec / 2);
  return [S('Cool down', a, 0.55, 'cooldown'), S('Cool down', sec - a, 0.45, 'cooldown')];
}

/**
 * Generate a workout.
 * @param {object} o { type, minutes, level (1-5), seed, warmupMin, cooldownMin }
 */
export function generate({ type, minutes, level = 3, seed = 1, warmupMin = 10, cooldownMin = 5 }) {
  const total = Math.round(minutes) * 60;
  const rng = mulberry32(seed);
  let wu = min(warmupMin), cd = min(cooldownMin);
  if (wu + cd > total * 0.4) {
    wu = Math.round((total * 0.25) / 60) * 60;
    cd = Math.round((total * 0.15) / 60) * 60;
  }
  const main = total - wu - cd;
  const built = BUILDERS[type](main, level, rng);
  const used = blockDur(built.items);
  let left = main - used;

  const pre = [], post = [];
  const fill = (d) => S('Endurance', d, 0.62);
  if (left >= min(6)) {
    const p = Math.round(left / 2 / 60) * 60;
    pre.push(fill(p));
    post.push(fill(left - p));
    left = 0;
  } else if (left >= 60) {
    post.push(fill(left));
    left = 0;
  }
  const cdSteps = cooldown(cd + left); // absorb any sub-minute remainder

  const items = [...warmup(type, wu), ...pre, ...built.items, ...post, ...cdSteps];
  return { type, level, minutes: Math.round(minutes), seed, name: built.title, items };
}

// ---------- analysis ----------

export function flatten(items) {
  const out = [];
  for (const it of items) {
    if (it.repeat) for (let i = 0; i < it.repeat; i++) out.push(...it.steps);
    else out.push(it);
  }
  return out;
}

export function stats(workout, ftp) {
  const steps = flatten(workout.items);
  const dur = steps.reduce((t, s) => t + s.dur, 0);
  // Normalized power approximation: 4th-power mean of step power (good enough for blocky ERG workouts).
  const p4 = steps.reduce((t, s) => t + s.dur * Math.pow(s.pct, 4), 0) / dur;
  const intensityFactor = Math.pow(p4, 0.25);
  const avg = steps.reduce((t, s) => t + s.dur * s.pct, 0) / dur;
  const tss = (dur / 3600) * intensityFactor * intensityFactor * 100;
  const zoneTime = {};
  for (const s of steps) zoneTime[zoneOf(s.pct).id] = (zoneTime[zoneOf(s.pct).id] || 0) + s.dur;
  return {
    duration: dur,
    if: intensityFactor,
    tss: Math.round(tss),
    avgWatts: Math.round(avg * ftp),
    np: Math.round(intensityFactor * ftp),
    kj: Math.round((avg * ftp * dur) / 1000),
    zoneTime,
  };
}

export const watts = (pct, ftp) => Math.round(pct * ftp);
export { durStr };
