/*
 * TeamSync — mesin perencanaan (fungsi murni, tanpa DOM).
 * Dipakai app.js di browser dan bisa diuji langsung dengan Node.
 *
 * Konsep:
 *  - Beban poin  : bobot tugas aktif ÷ kapasitas poin (beban kerja saat ini).
 *  - Beban jam   : sisa jam tugas disebar ke hari kerja tersedia antara tanggal mulai
 *                  dan tenggat, dibandingkan dengan jam kerja tersedia per periode
 *                  (hari kerja − cuti − libur) × jam/hari − tugas rutin.
 *  - Keadilan    : Indeks Jain atas utilisasi relatif (beban ÷ kapasitas), plus Gini.
 */
(function (root) {
"use strict";
const DAY = 864e5;
const pad = n => String(n).padStart(2, "0");
const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parse = s => new Date(s + "T00:00:00");
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
const isWeekend = s => { const g = parse(s).getDay(); return g === 0 || g === 6; };
const REMAIN = { todo: 1, progress: 0.6, review: 0.2, done: 0 };
const MAX_SPAN = 400; // batas aman iterasi tanggal

function workdays(from, to, hol) {
  const out = [];
  if (!from || !to || to < from) return out;
  let d = from;
  for (let i = 0; d <= to && i < MAX_SPAN; i++, d = addDays(d, 1)) if (!isWeekend(d) && !hol.has(d)) out.push(d);
  return out;
}
function nextWorkday(s, hol) { let d = s; for (let i = 0; i < 30 && (isWeekend(d) || hol.has(d)); i++) d = addDays(d, 1); return d; }

/* ---------- Skill ---------- */
const norm = s => String(s || "").trim().toLowerCase();
function skillList(v) {
  const arr = Array.isArray(v) ? v : String(v || "").split(/[,;\n]/);
  const seen = new Set(), out = [];
  for (const x of arr) { const t = String(x).trim(); const k = norm(t); if (t && !seen.has(k)) { seen.add(k); out.push(t); } }
  return out;
}
function skillMatch(req, have) {
  const R = skillList(req), H = new Set(skillList(have).map(norm));
  if (!R.length) return { ratio: 1, matched: [], missing: [], none: true };
  const matched = R.filter(r => H.has(norm(r))), missing = R.filter(r => !H.has(norm(r)));
  return { ratio: matched.length / R.length, matched, missing, none: false };
}

/* ---------- Konteks ---------- */
function makeCtx(st) {
  const today = st.today || iso(new Date());
  const hol = new Set((st.cfg.holidays || []).filter(Boolean));
  const leaveDays = {};
  for (const l of st.leaves || []) {
    if (!l.startDate || !l.endDate) continue;
    const set = leaveDays[l.memberId] ||= new Set();
    let d = l.startDate;
    for (let i = 0; d <= l.endDate && i < MAX_SPAN; i++, d = addDays(d, 1)) set.add(d);
  }
  // status hari ini (Cuti/Sakit/Izin) dianggap tidak tersedia hari ini
  for (const m of st.members) if (m.status && m.status !== "Aktif") (leaveDays[m.id] ||= new Set()).add(today);
  return { members: st.members, tasks: st.tasks, leaves: st.leaves || [], cfg: st.cfg, today, hol, leaveDays, _daily: new Map(), _loads: null };
}
function invalidate(ctx) { ctx._daily = new Map(); ctx._loads = null; }
const absentToday = (ctx, m) => (m.status && m.status !== "Aktif") || !!ctx.leaveDays[m.id]?.has(ctx.today);

/* ---------- Beban poin (saat ini) ---------- */
function level(cfg, p) { return p > cfg.red ? "red" : p >= cfg.yellow ? "yellow" : "green"; }
function loads(ctx) {
  if (ctx._loads) return ctx._loads;
  const L = {}, bf = ctx.cfg.backupFactor;
  for (const m of ctx.members) L[m.id] = { pic: 0, bak: 0, picN: 0, bakN: 0 };
  for (const t of ctx.tasks) {
    if (t.status === "done") continue;
    if (L[t.picId]) { L[t.picId].pic += t.weight || 0; L[t.picId].picN++; }
    if (t.backupId && L[t.backupId]) { L[t.backupId].bak += (t.weight || 0) * bf; L[t.backupId].bakN++; }
  }
  for (const m of ctx.members) { const x = L[m.id]; x.total = x.pic + x.bak; x.pct = m.capacity ? x.total / m.capacity * 100 : 0; x.level = level(ctx.cfg, x.pct); }
  return (ctx._loads = L);
}

/* ---------- Kalender & jam ---------- */
const remainingHours = t => (+t.hours || 0) * (REMAIN[t.status] ?? 1);
function taskWindow(t, today) {
  let s = t.startDate || (t.createdAt ? String(t.createdAt).slice(0, 10) : today);
  if (s < today) s = today;
  let e = t.deadline || addDays(s, 13);
  if (e < s) e = s; // tenggat terlewat: sisa pekerjaan jatuh hari ini
  return [s, e];
}
// sisa jam tugas disebar ke hari kerja PIC yang tersedia di jendela tugas
function taskDaily(ctx, t) {
  const key = t.id + "|" + t.picId + "|" + t.deadline + "|" + t.startDate + "|" + t.status + "|" + t.hours;
  if (ctx._daily.has(key)) return ctx._daily.get(key);
  const [s, e] = taskWindow(t, ctx.today);
  let days = workdays(s, e, ctx.hol);
  const lv = ctx.leaveDays[t.picId];
  const free = lv ? days.filter(d => !lv.has(d)) : days;
  if (free.length) days = free; // jika PIC cuti sepanjang jendela, beban tetap tercatat (terlihat bentrok)
  if (!days.length) days = [nextWorkday(s, ctx.hol)];
  const r = { days, per: remainingHours(t) / days.length };
  ctx._daily.set(key, r);
  return r;
}
function availability(ctx, m, from, to) {
  const days = workdays(from, to, ctx.hol);
  const lv = ctx.leaveDays[m.id];
  const leave = lv ? days.filter(d => lv.has(d)).length : 0;
  const work = days.length - leave;
  const routine = (+m.routineHours || 0) * work / 5;
  return { days: days.length, leave, work, routine, hours: Math.max(0, work * (+m.hoursPerDay || 7) - routine) };
}
function periodUtil(ctx, m, from, to, extraHours = 0) {
  const a = availability(ctx, m, from, to);
  let pic = 0, bak = 0;
  const bf = ctx.cfg.backupFactor;
  for (const t of ctx.tasks) {
    if (t.status === "done" || (t.picId !== m.id && t.backupId !== m.id)) continue;
    const { days, per } = taskDaily(ctx, t);
    const n = days.reduce((c, d) => c + (d >= from && d <= to ? 1 : 0), 0);
    if (!n) continue;
    if (t.picId === m.id) pic += n * per; else bak += n * per * bf;
  }
  const demand = pic + bak + extraHours;
  return { ...a, pic, bak, demand, pct: a.hours ? demand / a.hours * 100 : (demand > 0 ? 999 : 0) };
}
function periods(today, mode, n) {
  const out = [];
  if (mode === "month") {
    const d0 = parse(today);
    for (let i = 0; i < n; i++) {
      const s = new Date(d0.getFullYear(), d0.getMonth() + i, 1), e = new Date(d0.getFullYear(), d0.getMonth() + i + 1, 0);
      out.push({ from: iso(s), to: iso(e), label: s.toLocaleDateString("id-ID", { month: "short", year: "2-digit" }) });
    }
  } else {
    const d = parse(today); const dow = (d.getDay() + 6) % 7; const mon = addDays(today, -dow);
    for (let i = 0; i < n; i++) {
      const s = addDays(mon, 7 * i), e = addDays(s, 6);
      out.push({ from: s, to: e, label: parse(s).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) });
    }
  }
  return out;
}
function planGrid(ctx, pers) {
  const g = {};
  for (const m of ctx.members) g[m.id] = pers.map(p => periodUtil(ctx, m, p.from, p.to));
  return g;
}

/* ---------- Keadilan beban ---------- */
function fairness(vals) {
  const x = vals.filter(v => Number.isFinite(v));
  const n = x.length;
  if (!n) return null;
  const sum = x.reduce((a, b) => a + b, 0), mean = sum / n;
  const sumsq = x.reduce((a, b) => a + b * b, 0);
  const jain = sumsq ? (sum * sum) / (n * sumsq) : 1;
  let gsum = 0; for (const a of x) for (const b of x) gsum += Math.abs(a - b);
  const gini = mean ? gsum / (2 * n * n * mean) : 0;
  const std = Math.sqrt(x.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { n, mean, std, cv: mean ? std / mean : 0, gini, jain, index: Math.round(jain * 100), min: Math.min(...x), max: Math.max(...x), spread: Math.max(...x) - Math.min(...x) };
}
// utilisasi poin anggota yang tersedia (tidak cuti hari ini)
function teamFairness(ctx) {
  const L = loads(ctx);
  const ms = ctx.members.filter(m => !absentToday(ctx, m) && m.capacity);
  return { ...(fairness(ms.map(m => L[m.id].pct)) || { index: 100, gini: 0, mean: 0, spread: 0, n: 0, jain: 1 }), members: ms.map(m => ({ id: m.id, pct: L[m.id].pct })) };
}

/* ---------- Rekomendasi penugasan ---------- */
function rank(ctx, t, role = "pic", exclude = []) {
  const c = ctx.cfg, L = loads(ctx), bf = c.backupFactor;
  const [ws, we] = taskWindow(t, ctx.today);
  const rem = remainingHours({ ...t, status: t.status || "todo" });
  return ctx.members.filter(m => !exclude.includes(m.id)).map(m => {
    const l = L[m.id] || { total: 0, pct: 0 };
    const self = role === "pic" ? t.picId === m.id : t.backupId === m.id; // tugas ini sudah tercatat pada orang ini
    const addPts = self ? 0 : role === "pic" ? (t.weight || 0) : (t.weight || 0) * bf;
    const after = m.capacity ? (l.total + addPts) / m.capacity * 100 : 999;
    const w0 = periodUtil(ctx, m, ws, we);
    const addH = self ? 0 : role === "pic" ? rem : rem * bf;
    const wAfter = w0.hours ? (w0.demand + addH) / w0.hours * 100 : (w0.demand + addH > 0 ? 999 : 0);
    const sk = skillMatch(t.skills, m.skills);
    const absent = absentToday(ctx, m);
    const leaveFrac = w0.days ? w0.leave / w0.days : 0;
    const peak = Math.max(after, Math.min(wAfter, 999));
    let score = peak; const notes = [];
    if (absent) { score += 1000; notes.push("tidak tersedia hari ini"); }
    if (leaveFrac >= 0.5) { score += 500; notes.push(`cuti ${w0.leave} dari ${w0.days} hari kerja periode tugas`); }
    else if (w0.leave) { score += leaveFrac * 100; notes.push(`cuti ${w0.leave} hari dalam periode tugas`); }
    if (!sk.none) {
      const w = role === "pic" ? 1 : 0.6;
      if (sk.ratio === 0) { score += 400 * w; notes.push("tidak punya skill " + sk.missing.join(", ")); } // lebih berat dari overload: kompetensi didahulukan
      else if (sk.ratio < 1) { score += (1 - sk.ratio) * 45 * w; notes.push("kurang skill " + sk.missing.join(", ")); }
      else { score -= 10; notes.push("skill cocok"); }
    }
    if (peak > c.red) { score += 200 + (Math.min(peak, 400) - c.red) * 3; notes.push("akan melewati batas merah"); } // makin jauh di atas batas, makin berat
    if (role === "pic") {
      const k = t.complexity || 3;
      if (k >= 4 && m.level === "Junior") { score += 20; notes.push("kompleksitas tinggi untuk Junior"); }
      if (k >= 4 && (m.level === "Senior" || m.level === "Lead")) score -= 8;
      if (k <= 2 && m.level === "Senior") score += 6;
    }
    return { m, l, after, w0, wAfter, peak, sk, absent, score, notes };
  }).sort((a, b) => a.score - b.score);
}
const fitOf = (cfg, r) => r.absent ? ["Tidak tersedia", "crit"] : (!r.sk.none && r.sk.ratio === 0) ? ["Skill tidak cocok", "crit"] : r.peak > cfg.red ? ["Overload", "crit"] : (!r.sk.none && r.sk.ratio < 1) ? ["Skill sebagian", "warn"] : r.peak >= cfg.yellow ? ["Cukup", "warn"] : ["Ideal", "ok"];

/* PIC terhalang: tidak tersedia hari ini, atau cuti menutupi ≥50% sisa hari kerja / hari tenggat */
function picBlock(ctx, t) {
  const m = ctx.members.find(x => x.id === t.picId);
  if (!m || t.status === "done") return null;
  // status hari ini (tanpa jadwal) = durasi tidak diketahui → selalu terhalang
  if (m.status && m.status !== "Aktif") return { kind: "absent", text: "PIC sedang " + m.status };
  const lv = ctx.leaveDays[m.id]; if (!lv) return null;
  const [s, e] = taskWindow(t, ctx.today);
  const days = workdays(s, e, ctx.hol); if (!days.length) return null;
  const off = days.filter(d => lv.has(d));
  if (!off.length || (off.length / days.length < 0.5 && !lv.has(e))) return null; // masih ada cukup waktu setelah kembali
  const now = lv.has(ctx.today);
  return { kind: now ? "absent" : "upcoming", text: `PIC ${now ? "sedang cuti" : "akan cuti"}: ${off.length} dari ${days.length} hari kerja sebelum tenggat`, from: off[0], to: off[off.length - 1] };
}

/* ---------- Simulator what-if ---------- */
const clone = o => JSON.parse(JSON.stringify(o));
function snapshot(ctx, pers) {
  const L = loads(ctx); const f = teamFairness(ctx);
  const per = {};
  for (const m of ctx.members) {
    const w = pers.map(p => periodUtil(ctx, m, p.from, p.to).pct);
    per[m.id] = { pct: L[m.id].pct, level: L[m.id].level, weeks: w, peakWeek: Math.max(0, ...w.map(v => Math.min(v, 999))) };
  }
  const active = ctx.members.filter(m => !absentToday(ctx, m));
  const weekFair = pers.map((p, i) => fairness(active.map(m => per[m.id].weeks[i]).filter(v => v < 999)));
  return {
    fair: f, per, weekFair,
    overload: ctx.members.filter(m => L[m.id].pct > ctx.cfg.red).length,
    overloadWeeks: ctx.members.reduce((c, m) => c + per[m.id].weeks.filter(v => v > ctx.cfg.red).length, 0),
    blocked: ctx.tasks.filter(t => picBlock(ctx, t)).length
  };
}
function simulate(st, scenario, helpers) {
  const { weightOf, urgencyFromDeadline } = helpers;
  const pers = periods(st.today, "week", 4);
  const base = makeCtx(st);
  const before = snapshot(base, pers);
  const s2 = clone({ members: st.members, tasks: st.tasks, leaves: st.leaves || [], cfg: st.cfg, today: st.today });
  const name = id => (s2.members.find(m => m.id === id) || {}).name || "—";
  const changes = [], warnings = [], newLeaves = [], newTasks = [];
  // 1) cuti
  for (const ev of scenario.events.filter(e => e.type === "leave")) {
    if (!ev.memberId || !ev.start || !(ev.days > 0)) continue;
    const l = { id: "sim-l" + newLeaves.length, memberId: ev.memberId, startDate: ev.start, endDate: addDays(ev.start, ev.days - 1), type: ev.leaveType || "Cuti", note: "Simulasi" };
    s2.leaves.push(l); newLeaves.push(l);
  }
  // 2) tenggat dimajukan
  for (const ev of scenario.events.filter(e => e.type === "deadline")) {
    const t = s2.tasks.find(x => x.id === ev.taskId); if (!t || !t.deadline || !(ev.days > 0)) continue;
    let nd = addDays(t.deadline, -ev.days); if (nd < st.today) nd = st.today;
    const old = { deadline: t.deadline, weight: t.weight };
    t.deadline = nd;
    if (t.urgencyMode !== "manual") { t.urgency = urgencyFromDeadline(nd); t.weight = weightOf(t.complexity, t.urgency, t.hours); }
    changes.push({ kind: "deadline", taskId: t.id, title: t.title, from: old.deadline, to: nd, weightFrom: old.weight, weightTo: t.weight, urgency: t.urgency });
  }
  // 3) tugas baru
  for (const ev of scenario.events.filter(e => e.type === "task")) {
    const n = Math.max(1, Math.min(20, +ev.count || 1));
    for (let i = 0; i < n; i++) {
      const dl = addDays(st.today, Math.max(0, +ev.deadlineDays || 7));
      const u = urgencyFromDeadline(dl);
      const t = { id: "sim-t" + newTasks.length, title: (ev.title || "Tugas baru") + (n > 1 ? ` #${i + 1}` : ""), desc: "", complexity: +ev.complexity || 3, urgency: u, urgencyMode: "auto", hours: +ev.hours || 8, startDate: st.today, deadline: dl, skills: skillList(ev.skills), status: "todo", picId: null, backupId: null, handovers: [], sim: true };
      t.weight = weightOf(t.complexity, u, t.hours);
      s2.tasks.push(t); newTasks.push(t);
    }
  }
  let ctx = makeCtx(s2);
  const move = (t, to, reason, kind) => {
    const from = t.picId;
    const oldBak = t.backupId;
    t.picId = to;
    if (t.backupId === to) t.backupId = null;
    invalidate(ctx);
    if (!t.backupId || t.backupId === from) {
      const b = rank(ctx, t, "backup", [to, from]).find(r => !r.absent);
      t.backupId = b ? b.m.id : null; invalidate(ctx);
    }
    changes.push({ kind, taskId: t.id, title: t.title, from, to, backupFrom: oldBak, backupTo: t.backupId, reason, sim: !!t.sim });
  };
  // 4) PIC terhalang (cuti/tidak tersedia) → Backup bila layak, jika tidak kandidat terbaik
  for (const t of s2.tasks.filter(t => t.status !== "done" && !t.sim).sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))) {
    const blk = picBlock(ctx, t); if (!blk) continue;
    const cands = rank(ctx, t, "pic", [t.picId]);
    const bak = cands.find(r => r.m.id === t.backupId);
    const best = cands.find(r => r.score < 1000);
    const bakOk = bak && bak.score < 1000 && bak.peak <= ctx.cfg.red && (!best || bak.sk.ratio >= best.sk.ratio);
    const pick = bakOk ? bak : best;
    const severe = ctx.cfg.red * 1.2;
    if (pick && pick.peak > severe) warnings.push(`"${t.title}": pengganti yang paling sesuai (${name(pick.m.id)}) akan mencapai ${Math.round(pick.peak)}%. Tugas dibiarkan pada ${name(t.picId)}; pertimbangkan memundurkan tenggat atau menambah orang.`);
    else if (pick) move(t, pick.m.id, blk.text + (pick === bak ? "; Backup mengambil alih" : "; dialihkan ke kandidat paling sesuai") + (!pick.sk.none && pick.sk.missing.length ? `; kurang skill ${pick.sk.missing.join(", ")}` : ""), "reassign");
    else warnings.push(`"${t.title}": tidak ada pengganti yang tersedia saat ${name(t.picId)} cuti.`);
  }
  // 5) penugasan tugas baru, terberat lebih dulu
  for (const t of [...newTasks].sort((a, b) => b.weight - a.weight)) {
    const r = rank(ctx, t, "pic")[0];
    if (!r) { warnings.push("Belum ada anggota tim."); break; }
    t.picId = r.m.id; invalidate(ctx);
    const b = rank(ctx, t, "backup", [r.m.id]).find(x => !x.absent); t.backupId = b ? b.m.id : null; invalidate(ctx);
    changes.push({ kind: "assign", taskId: t.id, title: t.title, to: t.picId, backupTo: t.backupId, weight: t.weight, reason: r.notes.join("; "), sim: true });
    if (!r.sk.none && r.sk.ratio === 0) warnings.push(`"${t.title}": tidak ada anggota dengan skill ${r.sk.missing.join(", ")}.`);
    if (r.peak > ctx.cfg.red) warnings.push(`"${t.title}": semua kandidat akan melewati batas merah; pertimbangkan menggeser tenggat.`);
  }
  // 6) redistribusi untuk keadilan: pindahkan tugas To Do dari yang paling terbebani
  if (scenario.optimize) {
    for (let step = 0; step < 8; step++) {
      const L = loads(ctx); const f0 = teamFairness(ctx);
      const avail = ctx.members.filter(m => !absentToday(ctx, m));
      const donors = [...avail].sort((a, b) => L[b.id].pct - L[a.id].pct).filter(m => L[m.id].pct > Math.max(f0.mean + 10, ctx.cfg.yellow));
      let best = null;
      for (const d of donors) for (const t of s2.tasks.filter(t => t.picId === d.id && t.status === "todo")) {
        const skFrom = skillMatch(t.skills, d.skills).ratio;
        for (const r of rank(ctx, t, "pic", [d.id])) {
          if (r.absent || r.peak > ctx.cfg.yellow || r.sk.ratio < skFrom || r.score >= 500) continue;
          const keepP = t.picId, keepB = t.backupId;
          t.picId = r.m.id; if (t.backupId === r.m.id) t.backupId = d.id; invalidate(ctx);
          const gain = teamFairness(ctx).jain - f0.jain;
          t.picId = keepP; t.backupId = keepB; invalidate(ctx);
          if (gain > 0.004 && (!best || gain > best.gain)) best = { t, r, d, gain };
        }
      }
      if (!best) break;
      move(best.t, best.r.m.id, `meratakan beban: ${name(best.d.id)} ${Math.round(L[best.d.id].pct)}% → ${name(best.r.m.id)} ${Math.round(best.r.l.pct)}%`, "rebalance");
    }
  }
  invalidate(ctx);
  const after = snapshot(ctx, pers);
  return { before, after, changes, warnings, periods: pers, newTasks, newLeaves, state: s2 };
}

const api = { addDays, diffDays, workdays, taskDaily, skillList, skillMatch, makeCtx, invalidate, absentToday, loads, level, remainingHours, taskWindow, availability, periodUtil, periods, planGrid, fairness, teamFairness, rank, fitOf, picBlock, simulate };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.TSPlan = api;
})(typeof window !== "undefined" ? window : globalThis);
