// Run: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, TYPES, stats, flatten } from '../js/workouts.js';
import { workoutToFit, crc16 } from '../js/fit.js';
import { suggest } from '../js/suggest.js';

test('every type/duration/level produces a workout of exactly the requested length', () => {
  for (const t of TYPES) for (const m of [20, 30, 45, 60, 90, 120, 180]) for (let level = 1; level <= 5; level++) for (let seed = 1; seed <= 8; seed++) {
    const w = generate({ type: t.id, minutes: m, level, seed });
    assert.equal(stats(w, 250).duration, m * 60, `${t.id} ${m} L${level} s${seed}`);
    assert.ok(flatten(w.items).every((s) => s.dur > 0 && s.pct > 0));
  }
});

test('FIT file has valid header and CRCs', () => {
  const bytes = workoutToFit(generate({ type: 'vo2max', minutes: 60, seed: 3 }), { ftp: 250 });
  assert.equal(bytes[0], 14);
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), '.FIT');
  const dataSize = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
  assert.equal(bytes.length, 14 + dataSize + 2);
  assert.equal(crc16(bytes.slice(0, 12)), bytes[12] | (bytes[13] << 8));
  assert.equal(crc16(bytes), 0); // CRC over the whole file incl. trailing CRC is 0
});

test('suggests an easy day after a hard one', () => {
  const y = new Date(); y.setDate(y.getDate() - 1);
  const date = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  const s = suggest([{ date, type: 'vo2max', level: 3, minutes: 60, tss: 80 }], { weekdayMinutes: 60, weekendMinutes: 90, weeklyTss: 400 });
  assert.ok(['endurance', 'recovery'].includes(s[0].type));
});
