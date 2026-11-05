// Minimal FIT encoder for structured workout files (.fit, file type "workout").
// Spec: Garmin FIT SDK — messages file_id (0), workout (26), workout_step (27).
import { flatten } from './workouts.js';

const BASE = {
  enum: [0x00, 1],
  uint8: [0x02, 1],
  uint16: [0x84, 2],
  uint32: [0x86, 4],
  uint32z: [0x8c, 4],
  string: [0x07, 0],
};

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

export function crc16(bytes, crc = 0) {
  for (const b of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[b & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf];
  }
  return crc;
}

function encodeString(str, size) {
  let bytes = new TextEncoder().encode(str);
  if (bytes.length > size - 1) {
    let n = size - 1;
    while (n > 0 && (bytes[n] & 0xc0) === 0x80) n--; // don't cut a UTF-8 sequence in half
    bytes = bytes.slice(0, n);
  }
  const out = new Uint8Array(size);
  out.set(bytes);
  return out;
}

class FitWriter {
  constructor() {
    this.buf = [];
    this.defs = {};
  }
  u8(v) { this.buf.push(v & 0xff); }
  u16(v) { this.u8(v); this.u8(v >>> 8); }
  u32(v) { this.u16(v & 0xffff); this.u16((v >>> 16) & 0xffff); }

  // fields: [fieldNum, baseType, value, size?]
  message(local, global, fields) {
    const sig = global + ':' + fields.map((f) => `${f[0]}/${f[1]}/${f[3] || ''}`).join(',');
    if (this.defs[local] !== sig) {
      this.u8(0x40 | local); // definition message header
      this.u8(0); // reserved
      this.u8(0); // little endian
      this.u16(global);
      this.u8(fields.length);
      for (const [num, type, , size] of fields) {
        const [bt, sz] = BASE[type];
        this.u8(num);
        this.u8(type === 'string' ? size : sz);
        this.u8(bt);
      }
      this.defs[local] = sig;
    }
    this.u8(local); // data message header
    for (const [, type, value, size] of fields) {
      if (type === 'enum' || type === 'uint8') this.u8(value);
      else if (type === 'uint16') this.u16(value);
      else if (type === 'uint32' || type === 'uint32z') this.u32(value);
      else if (type === 'string') for (const b of encodeString(value, size)) this.u8(b);
    }
  }

  finish() {
    const data = this.buf;
    const header = [14, 0x10];
    const profile = 2132;
    header.push(profile & 0xff, profile >> 8);
    header.push(data.length & 0xff, (data.length >> 8) & 0xff, (data.length >> 16) & 0xff, (data.length >>> 24) & 0xff);
    header.push(0x2e, 0x46, 0x49, 0x54); // ".FIT"
    const hcrc = crc16(header);
    header.push(hcrc & 0xff, hcrc >> 8);
    const all = [...header, ...data];
    const crc = crc16(all);
    all.push(crc & 0xff, crc >> 8);
    return new Uint8Array(all);
  }
}

const FIT_EPOCH = 631065600; // 1989-12-31T00:00:00Z
const INTENSITY = { active: 0, rest: 1, warmup: 2, cooldown: 3 };

/**
 * Encode a workout to FIT bytes.
 * targetMode 'watts' writes absolute watts (computed from `ftp`);
 * targetMode 'percent' writes %FTP so the Edge uses its own FTP setting.
 */
export function workoutToFit(workout, { ftp, targetMode = 'watts', name } = {}) {
  const w = new FitWriter();
  const now = Math.floor(Date.now() / 1000) - FIT_EPOCH;

  // file_id
  w.message(0, 0, [
    [0, 'enum', 5], // type = workout
    [1, 'uint16', 255], // manufacturer = development
    [2, 'uint16', 0], // product
    [3, 'uint32z', (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0], // serial number
    [4, 'uint32', now], // time_created
  ]);

  // Lay out FIT steps; repeat blocks become their steps followed by a "repeat until steps complete" step.
  const fitSteps = [];
  for (const it of workout.items) {
    if (it.repeat) {
      const from = fitSteps.length;
      fitSteps.push(...it.steps);
      if (it.repeat > 1) fitSteps.push({ repeatFrom: from, count: it.repeat });
    } else fitSteps.push(it);
  }

  // workout
  w.message(1, 26, [
    [4, 'enum', 2], // sport = cycling
    [11, 'enum', 6], // sub_sport = indoor_cycling
    [6, 'uint16', fitSteps.length], // num_valid_steps
    [8, 'string', name || workout.name, 32], // wkt_name
  ]);

  const target = (pct) => (targetMode === 'percent' ? Math.round(pct * 100) : Math.round(pct * ftp) + 1000);
  fitSteps.forEach((s, i) => {
    if (s.repeatFrom !== undefined) {
      w.message(3, 27, [
        [254, 'uint16', i], // message_index
        [1, 'enum', 6], // duration_type = repeat_until_steps_cmplt
        [2, 'uint32', s.repeatFrom], // duration_step
        [4, 'uint32', s.count], // repeat_steps
      ]);
      return;
    }
    // ±2.5% window around the target (the Edge drives ERG to the middle of the range)
    const lo = target(s.pct * 0.975);
    const hi = target(s.pct * 1.025);
    w.message(2, 27, [
      [254, 'uint16', i],
      [0, 'string', s.name, 16], // wkt_step_name
      [1, 'enum', 0], // duration_type = time
      [2, 'uint32', s.dur * 1000], // duration_time (ms)
      [3, 'enum', 4], // target_type = power
      [4, 'uint32', 0], // target_value 0 => custom range
      [5, 'uint32', lo], // custom_target_power_low
      [6, 'uint32', hi], // custom_target_power_high
      [7, 'enum', INTENSITY[s.intensity] ?? 0],
    ]);
  });

  return w.finish();
}

export function fitFileName(workout) {
  const slug = workout.name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `${slug || 'workout'}.fit`;
}

export { flatten };
