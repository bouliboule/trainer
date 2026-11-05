// Suggests today's workout from recent history.
// history entries: { date: 'YYYY-MM-DD', type, level, minutes, tss }
import { typeById } from './workouts.js';

const DAY = 86400000;
const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);

// Rotation of quality sessions; the least recently done one comes up next.
const QUALITY = ['sweetspot', 'threshold', 'vo2max', 'tempo', 'anaerobic'];
const QUALITY_WEIGHT = { sweetspot: 0, threshold: 1, vo2max: 1, tempo: 3, anaerobic: 4 }; // lower = preferred

export function suggest(history, settings, today = new Date()) {
  const todayKey = dayKey(today);
  const past = history.filter((h) => h.date <= todayKey).sort((a, b) => (a.date < b.date ? 1 : -1));
  const ago = (h) => daysBetween(h.date, todayKey);
  const isWeekend = [0, 6].includes(today.getDay());
  const baseMinutes = isWeekend ? settings.weekendMinutes : settings.weekdayMinutes;

  const last7 = past.filter((h) => ago(h) < 7);
  const tss7 = last7.reduce((t, h) => t + (h.tss || 0), 0);
  const doneToday = past.filter((h) => ago(h) === 0);
  const yesterday = past.filter((h) => ago(h) === 1);
  const load = (h) => typeById(h.type)?.load;
  const yHard = yesterday.some((h) => load(h) === 'hard' || (h.tss || 0) >= 90);
  const yMed = yesterday.some((h) => load(h) === 'medium');

  // consecutive days ridden up to yesterday
  let streak = 0;
  while (past.some((h) => ago(h) === streak + 1)) streak++;

  const hardIn2 = past.filter((h) => ago(h) >= 1 && ago(h) <= 2 && load(h) !== 'easy').length;
  const levelFor = (type) => {
    const prev = past.find((h) => h.type === type);
    if (!prev) return 3;
    const d = ago(prev);
    if (d <= 14) return Math.min(5, prev.level + 1); // progress if done recently
    if (d > 28) return Math.max(1, prev.level - 1); // ease back in after a gap
    return prev.level;
  };
  const nextQuality = () => {
    const scored = QUALITY.map((t) => {
      const lastDone = past.find((h) => h.type === t);
      const days = lastDone ? ago(lastDone) : 99;
      return { t, score: Math.min(days, 21) - QUALITY_WEIGHT[t] * 2 };
    }).sort((a, b) => b.score - a.score);
    return scored.map((s) => s.t);
  };
  const mk = (type, minutes, why, level = levelFor(type)) => ({ type, minutes, level, why });

  const out = [];
  if (doneToday.length) {
    out.push(mk('recovery', 30, 'You already trained today — if you want more, keep it very easy.', 1));
    out.push(mk('endurance', 45, 'Extra aerobic volume without adding much fatigue.', 2));
    return out;
  }
  if (streak >= 4) {
    out.push(mk('recovery', 45, `${streak} days in a row — your body adapts when you rest.`, 1));
    out.push(mk('endurance', baseMinutes, 'If you feel fresh, an easy aerobic ride.', 2));
    return out;
  }
  if (yHard || hardIn2 >= 2) {
    const why = yHard ? 'Yesterday was hard — recover today so the next quality day counts.' : 'Two intense days recently — time for an easy day.';
    out.push(mk('endurance', Math.max(45, baseMinutes), why, 2));
    out.push(mk('recovery', 40, 'Feeling tired? A short spin to flush the legs.', 1));
    return out;
  }
  if (tss7 > (settings.weeklyTss || 400) * 1.1) {
    out.push(mk('endurance', baseMinutes, `7-day load is ${tss7} TSS, above your target — keep it aerobic.`, 2));
    out.push(mk('recovery', 40, 'Or take it very easy.', 1));
    return out;
  }

  const [q1, q2] = nextQuality();
  if (yMed) {
    // after a medium day, prefer a different stimulus, ideally not two quality days in a row
    out.push(mk('endurance', baseMinutes, 'Medium session yesterday — an aerobic day keeps you fresh for the next one.', 3));
    out.push(mk(q1, baseMinutes, `Or, if you feel good: ${typeById(q1).label} is due.`));
    return out;
  }
  const lastQ = past.find((h) => load(h) !== 'easy');
  const since = lastQ ? ago(lastQ) : null;
  out.push(
    mk(q1, baseMinutes, since === null ? `No recent intensity logged — ${typeById(q1).label} is a great place to start.` : `${since} days since your last quality session — ${typeById(q1).label} is next in the rotation.`),
  );
  out.push(mk(q2, baseMinutes, `Alternative: ${typeById(q2).label}.`));
  out.push(mk('endurance', isWeekend ? Math.max(90, baseMinutes) : baseMinutes, 'Not feeling it? Aerobic base is never wasted.', 3));
  return out;
}

export { dayKey };
