(() => {
"use strict";
/* ---------- Konstanta & util ---------- */
const DEFAULT_CFG = { yellow: 70, red: 90, backupFactor: 0.2, kCoef: 0.25, uCoef: 0.15, caps: { Junior: 100, Middle: 125, Senior: 150, Lead: 120 } };
const LEVELS = ["Junior", "Middle", "Senior", "Lead"];
const STATUSES = ["Aktif", "Cuti", "Sakit", "Izin"];
const TSTAT = [["todo", "To Do"], ["progress", "In Progress"], ["review", "Review"], ["done", "Done"]];
const TLABEL = Object.fromEntries(TSTAT);
const KLAB = ["", "Sangat mudah", "Mudah", "Sedang", "Sulit", "Sangat sulit"];
const ULAB = ["", "Longgar", "Normal", "Penting", "Mendesak", "Kritis"];
const AV = ["#2f4bd1", "#0f8b8d", "#b4498a", "#c26a12", "#5b6dd8", "#2c8a4f", "#8a4fd1", "#c23b4b", "#3b7bbf", "#7b8a1f"];

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ymd = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const shift = n => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const r1 = n => Math.round(n * 10) / 10;
const pctTxt = n => Math.round(n) + "%";
const initials = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const avColor = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV[h % AV.length]; };
function dayDiff(dl) { if (!dl) return null; const a = new Date(dl + "T00:00:00"); const b = new Date(ymd(new Date()) + "T00:00:00"); return Math.round((a - b) / 864e5); }
function fmtDate(s) { if (!s) return "—"; const d = s.length <= 10 ? new Date(s + "T00:00:00") : new Date(s); return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }); }
function fmtTime(s) { const d = new Date(s); return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }); }
function dueLabel(dl) { const d = dayDiff(dl); if (d === null) return ["", ""]; if (d < 0) return ["Terlambat " + -d + " hari", "late"]; if (d === 0) return ["Hari ini", "soon"]; if (d === 1) return ["Besok", "soon"]; return [d + " hari lagi", d <= 3 ? "soon" : ""]; }

/* ---------- Rumus ---------- */
function urgencyFromDeadline(dl) { const d = dayDiff(dl); if (d === null) return 2; if (d <= 1) return 5; if (d <= 3) return 4; if (d <= 7) return 3; if (d <= 14) return 2; return 1; }
function factors(k, u) { const c = S.cfg; return { kf: 1 + c.kCoef * (k - 1), uf: 1 + c.uCoef * (u - 1) }; }
function weightOf(k, u, h) { const { kf, uf } = factors(k, u); return Math.max(1, Math.round(h * kf * uf)); }
function level(p) { return p > S.cfg.red ? "red" : p >= S.cfg.yellow ? "yellow" : "green"; }
const LV_TXT = { green: "Aman", yellow: "Mendekati batas", red: "Overload" };
const LV_PILL = { green: "ok", yellow: "warn", red: "crit" };

/* ---------- State ---------- */
const S = {
  mode: "loading", members: [], tasks: [], logs: [], leaves: [], profiles: [], claims: {}, cfg: structuredClone(DEFAULT_CFG),
  loads: {}, alerts: [], me: { id: null, isLead: false, canWrite: true }, asMember: false,
  route: "dashboard", composerOpen: false, draft: null, filters: { q: "", member: "", mine: false },
  period: 30, logType: "", ready: { members: false, tasks: false }, stale: false, seenAlerts: null, readOnlyHit: false,
  ctx: null, fair: null, sim: { events: [], optimize: true, result: null, dirty: false }, planMode: "week", planSel: null
};
const mem = id => S.members.find(m => m.id === id);
const nm = id => mem(id)?.name || "—";
const myMemberId = () => S.me.id ? S.claims[S.me.id] || null : (S.mode === "local" ? S.localClaim || null : null);
const isLead = () => S.me.isLead && !S.asMember;
const canWrite = () => S.me.canWrite && !S.readOnlyHit;
const canProgress = t => canWrite() && (isLead() || [t.picId, t.backupId].includes(myMemberId()));

const P = window.TSPlan;
const todayStr = () => ymd(new Date());
const ctxFrom = st => P.makeCtx({ members: st.members, tasks: st.tasks, leaves: st.leaves || [], cfg: S.cfg, today: todayStr() });
function compute() {
  S.ctx = ctxFrom(S);
  S.loads = P.loads(S.ctx);
  S.fair = P.teamFairness(S.ctx);
  const L = S.loads, groups = {};
  for (const t of S.tasks) {
    if (t.status === "done") continue;
    const p = mem(t.picId); if (!p) continue;
    const reasons = []; let kind = null;
    const blk = P.picBlock(S.ctx, t);
    if (blk) { reasons.push(blk.kind === "upcoming" ? `${blk.text} (${fmtDate(blk.from)}–${fmtDate(blk.to)})` : blk.text); kind = blk.kind; }
    if (L[p.id] && L[p.id].pct > S.cfg.red) { reasons.push("beban PIC " + pctTxt(L[p.id].pct)); kind ||= "overload"; }
    if (!reasons.length) continue;
    const g = (groups[p.id] ||= { p, kinds: new Set(), tasks: [] });
    g.kinds.add(kind); g.tasks.push({ t, reasons, kind });
  }
  const order = g => g.kinds.has("absent") ? 0 : g.kinds.has("upcoming") ? 1 : 2;
  S.alerts = Object.values(groups).map(g => ({ ...g, absent: g.kinds.has("absent"), upcoming: !g.kinds.has("absent") && g.kinds.has("upcoming") })).sort((a, b) => order(a) - order(b));
}
const alertTasks = () => S.alerts.flatMap(g => g.tasks);
const absentNow = m => !!m && P.absentToday(S.ctx, m);
const rankFor = (task, role, exclude = []) => P.rank(S.ctx, task, role, exclude);
// indeks keadilan setelah perubahan hipotetis (tanpa menyentuh data)
function fairAfter(mutate) {
  const st = JSON.parse(JSON.stringify({ members: S.members, tasks: S.tasks, leaves: S.leaves }));
  mutate(st);
  return P.teamFairness(ctxFrom(st)).index;
}
const fairMeta = after => ({ fairBefore: S.fair ? S.fair.index : null, fairAfter: after });

/* ---------- Penyimpanan: Supabase, atau memori untuk mode pratinjau ---------- */
const CONF = window.TEAMSYNC_CONFIG || {};
let sb = null, channel = null;
const TABLE = { members: "members", tasks: "tasks", logs: "activity_logs", settings: "settings", profiles: "profiles", leaves: "leaves" };
const KEYMAP = { desc: "descr", by: "by_user" };
const RKEYMAP = Object.fromEntries(Object.entries(KEYMAP).map(([a, b]) => [b, a]));
const toRow = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [KEYMAP[k] || k.replace(/[A-Z]/g, c => "_" + c.toLowerCase()), v]));
const fromRow = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [RKEYMAP[k] || k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));
const newId = p => sb ? crypto.randomUUID() : rid(p);
const local = { members: new Map(), tasks: new Map(), logs: new Map(), leaves: new Map() };
function syncLocal() {
  S.members = [...local.members.values()]; S.tasks = [...local.tasks.values()];
  S.logs = [...local.logs.values()].sort((a, b) => b.at.localeCompare(a.at));
  S.leaves = [...local.leaves.values()];
  refresh();
}
function handleErr(e) {
  const msg = e?.message || "";
  if (e?.code === "42501" || /row-level security/i.test(msg)) toast("Anda tidak memiliki izin untuk perubahan ini.", "crit");
  else if (e?.code === "23505") toast("Profil anggota ini sudah ditautkan ke akun lain.", "crit");
  else if (e?.code === "P0001") toast(msg, "crit");
  else if (/JWT|session|token/i.test(msg)) toast("Sesi Anda berakhir. Silakan masuk lagi.", "crit");
  else toast("Gagal menyimpan: " + (msg || "periksa koneksi internet") + ".", "crit");
}
async function run(q) { const { data, error } = await q; if (error) { handleErr(error); throw error; } return data; }
async function changed(q, key) {
  const d = await run(q.select("id"));
  if (!d || !d.length) { toast("Perubahan tidak diizinkan atau data sudah tidak ada.", "crit"); throw new Error("no rows"); }
  queue(key); return d;
}
async function put(col, id, data) {
  if (sb) {
    if (col === "settings") { await run(sb.from("settings").upsert({ id: 1, config: data, updated_at: new Date().toISOString() })); return queue("settings"); }
    if (col === "logs") { const { by, ...rest } = data; await run(sb.from("activity_logs").insert(toRow(rest))); return queue("logs"); }
    await run(sb.from(TABLE[col]).upsert(toRow({ id, ...data }))); return queue(col);
  }
  if (col === "settings") { S.cfg = mergeCfg(data); return refresh(); }
  local[col].set(id, { id, ...data }); syncLocal();
}
async function patch(col, id, data) {
  if (sb) return changed(sb.from(TABLE[col]).update(toRow(data)).eq("id", id), col);
  const cur = local[col]?.get(id); if (cur) local[col].set(id, { ...cur, ...data }); syncLocal();
}
async function del(col, id) {
  if (sb) return changed(sb.from(TABLE[col]).delete().eq("id", id), col);
  local[col].delete(id); syncLocal();
}
async function log(type, text, extra = {}) {
  const e = { at: new Date().toISOString(), type, text, by: S.me.id || null, byMember: myMemberId(), ...extra };
  try { await put("logs", rid("l"), e); } catch {}
}
function mergeCfg(d) { const c = structuredClone(DEFAULT_CFG); if (d) { Object.assign(c, d); c.caps = { ...DEFAULT_CFG.caps, ...(d.caps || {}) }; } return c; }

/* Sinkronisasi: ambil tabel, lalu dengarkan perubahan realtime */
const FETCH = {
  members: () => sb.from("members").select("*").order("name"),
  tasks: () => sb.from("tasks").select("*").order("created_at", { ascending: false }).limit(5000),
  logs: () => sb.from("activity_logs").select("*").order("at", { ascending: false }).limit(400),
  settings: () => sb.from("settings").select("config").eq("id", 1).maybeSingle(),
  profiles: () => sb.from("profiles").select("id,email,display_name,role,member_id").order("created_at"),
  leaves: () => sb.from("leaves").select("*").gte("end_date", ymd(shift(-120))).order("start_date").limit(2000)
};
async function fetchTable(name) {
  if (!sb || !S.me.id) return;
  const { data, error } = await FETCH[name]();
  if (error) { console.error(name, error); S.stale = true; S.lastErr = `${name}: ${error.code || ""} ${error.message || ""}`.trim(); renderBanner(); return; }
  if (name === "members") { S.members = data.map(fromRow); S.ready.members = true; }
  else if (name === "tasks") { S.tasks = data.map(fromRow); S.ready.tasks = true; }
  else if (name === "logs") S.logs = data.map(fromRow);
  else if (name === "leaves") S.leaves = data.map(fromRow);
  else if (name === "settings") S.cfg = mergeCfg(data?.config);
  else if (name === "profiles") {
    S.profiles = data.map(fromRow);
    S.claims = Object.fromEntries(S.profiles.filter(p => p.memberId).map(p => [p.id, p.memberId]));
    const me = S.profiles.find(p => p.id === S.me.id);
    if (me) { const was = S.me.isLead; S.me.isLead = me.role === "lead"; S.me.name = me.displayName || ""; if (was !== S.me.isLead && S.ready.members) setRoute(); }
  }
  refresh();
  if (name === "logs" && S.route === "laporan") renderLog();
}
const pending = {};
function queue(name) { if (!sb) return; clearTimeout(pending[name]); pending[name] = setTimeout(() => fetchTable(name), 200); }

/* ---------- Data contoh ---------- */
function demoData() {
  const K = {}; const kid = k => K[k] ||= newId("m");
  const iso = (dOff, h = 10) => { const d = shift(dOff); d.setHours(h, 15, 0, 0); return d.toISOString(); };
  const M = [
    ["m_rina", "Rina Kartika", "Senior", "Backend, Arsitektur", "Aktif"],
    ["m_dimas", "Dimas Prasetyo", "Middle", "Frontend, UI", "Aktif"],
    ["m_sari", "Sari Wulandari", "Junior", "QA, Dokumentasi", "Aktif"],
    ["m_bayu", "Bayu Nugroho", "Senior", "Data, Integrasi", "Cuti"],
    ["m_ayu", "Ayu Lestari", "Junior", "Frontend", "Aktif"],
    ["m_fajar", "Fajar Hidayat", "Middle", "Backend, Payment", "Aktif"]
  ].map(([id, name, lv, skills, status]) => ({ id: kid(id), name, level: lv, capacity: DEFAULT_CFG.caps[lv], skills, status, demo: true, createdAt: iso(-40) }));
  const T = [];
  const mk = (title, k, u, h, dl, pic, bak, status, cr, done, extra = {}) => T.push({
    id: newId("t"), title, desc: "", complexity: k, urgency: u, urgencyMode: "manual", hours: h, deadline: ymd(shift(dl)),
    weight: weightOf(k, u, h), picId: kid(pic), backupId: kid(bak), status, createdAt: iso(cr, 9), doneAt: done != null ? iso(done, 16) : null,
    handovers: [], demo: true, ...extra
  });
  mk("Integrasi payment gateway", 5, 4, 24, 3, "m_fajar", "m_rina", "progress", -6);
  mk("Refactor modul notifikasi", 4, 3, 16, 6, "m_fajar", "m_dimas", "todo", -3);
  mk("Perbaikan bug checkout", 3, 5, 6, 1, "m_fajar", "m_sari", "progress", -1);
  mk("Pipeline laporan bulanan", 4, 3, 12, 5, "m_bayu", "m_rina", "progress", -8);
  mk("Desain skema database v2", 4, 2, 20, 9, "m_rina", "m_fajar", "progress", -5);
  mk("Review keamanan API", 3, 3, 8, 4, "m_rina", "m_bayu", "review", -7);
  mk("Halaman dashboard admin", 3, 3, 16, 7, "m_dimas", "m_ayu", "progress", -4);
  mk("Komponen form reusable", 2, 2, 10, 12, "m_dimas", "m_sari", "todo", -2);
  mk("Redesign alur onboarding", 3, 4, 14, 3, "m_dimas", "m_ayu", "todo", -2);
  mk("Audit aksesibilitas", 2, 2, 6, 10, "m_dimas", "m_ayu", "todo", -1);
  mk("Test case modul checkout", 2, 4, 8, 2, "m_sari", "m_dimas", "progress", -3);
  mk("Dokumentasi API publik", 2, 2, 10, 8, "m_sari", "m_rina", "todo", -2);
  mk("Landing page kampanye", 2, 3, 12, 6, "m_ayu", "m_dimas", "progress", -4);
  mk("Setup CI/CD", 4, 3, 12, -10, "m_rina", "m_fajar", "done", -20, -12);
  mk("Migrasi server staging", 4, 4, 16, -8, "m_fajar", "m_rina", "done", -18, -6, { handovers: [{ from: kid("m_bayu"), to: kid("m_fajar"), at: iso(-9, 11), reason: "PIC sedang Cuti" }] });
  mk("Halaman login", 2, 3, 8, -14, "m_dimas", "m_ayu", "done", -22, -15);
  mk("Uji regresi sprint 14", 2, 4, 10, -3, "m_sari", "m_ayu", "done", -10, -4);
  mk("Ikon & ilustrasi fitur baru", 1, 2, 6, -2, "m_ayu", "m_dimas", "done", -9, -3);
  mk("Optimasi query laporan", 3, 3, 10, -15, "m_bayu", "m_rina", "done", -25, -16);
  mk("Perbaikan tampilan mobile", 2, 3, 8, -21, "m_ayu", "m_dimas", "done", -28, -20);
  mk("Seeder data uji", 2, 2, 6, -12, "m_sari", "m_dimas", "done", -19, -13);
  const L = [];
  const lg = (at, type, text, extra = {}) => L.push({ id: rid("l"), at, type, text, by: null, byMember: null, demo: true, ...extra });
  for (const t of T) {
    lg(t.createdAt, "task_new", `Tugas baru "${t.title}" (${t.weight} poin) ditetapkan ke ${M.find(m => m.id === t.picId).name}, backup ${M.find(m => m.id === t.backupId).name}.`, { taskId: t.id });
    if (t.doneAt) lg(t.doneAt, "status", `"${t.title}" dipindahkan ke Done.`, { taskId: t.id, byMember: t.picId });
  }
  lg(iso(-9, 11), "handover", `Handover: "Migrasi server staging" dialihkan dari Bayu Nugroho ke Fajar Hidayat (PIC sedang Cuti).`);
  lg(iso(-1, 8), "member", "Status Bayu Nugroho berubah: Aktif → Cuti.");
  // skill, tanggal mulai, jam kerja, tugas rutin, dan jadwal cuti contoh
  const SK = {
    "Integrasi payment gateway": ["Backend", "Payment"], "Refactor modul notifikasi": ["Backend"], "Perbaikan bug checkout": ["Backend", "Payment"],
    "Pipeline laporan bulanan": ["Data", "Integrasi"], "Desain skema database v2": ["Backend", "Arsitektur"], "Review keamanan API": ["Backend", "Arsitektur"],
    "Halaman dashboard admin": ["Frontend", "UI"], "Komponen form reusable": ["Frontend"], "Redesign alur onboarding": ["UI", "Frontend"],
    "Audit aksesibilitas": ["Frontend", "QA"], "Test case modul checkout": ["QA"], "Dokumentasi API publik": ["Dokumentasi"], "Landing page kampanye": ["Frontend"],
    "Setup CI/CD": ["Backend"], "Migrasi server staging": ["Backend", "Integrasi"], "Halaman login": ["Frontend"], "Uji regresi sprint 14": ["QA"],
    "Ikon & ilustrasi fitur baru": ["UI"], "Optimasi query laporan": ["Data"], "Perbaikan tampilan mobile": ["Frontend"], "Seeder data uji": ["QA", "Backend"]
  };
  T.forEach(t => { t.skills = SK[t.title] || []; t.startDate = ymd(new Date(t.createdAt)); });
  const ROUT = { m_rina: [4, "Rapat arsitektur mingguan"], m_dimas: [2, "Sinkronisasi desain"], m_sari: [3, "Dukungan pengguna"] };
  M.forEach(m => { const key = Object.keys(K).find(k => K[k] === m.id); m.hoursPerDay = key === "m_sari" ? 6 : 7; m.routineHours = ROUT[key]?.[0] || 0; m.routineNote = ROUT[key]?.[1] || ""; });
  const LV = [
    { id: newId("l"), memberId: kid("m_bayu"), startDate: ymd(shift(-1)), endDate: ymd(shift(6)), type: "Cuti", note: "Cuti tahunan", demo: true },
    { id: newId("l"), memberId: kid("m_dimas"), startDate: ymd(shift(2)), endDate: ymd(shift(4)), type: "Cuti", note: "Acara keluarga", demo: true },
    { id: newId("l"), memberId: kid("m_rina"), startDate: ymd(shift(16)), endDate: ymd(shift(20)), type: "Cuti", note: "Cuti akhir tahun", demo: true }
  ];
  return { M, T, L, K, LV };
}
async function loadDemo() {
  const { M, T, L, LV } = demoData();
  if (!sb) { M.forEach(m => local.members.set(m.id, m)); T.forEach(t => local.tasks.set(t.id, t)); L.forEach(l => local.logs.set(l.id, l)); LV.forEach(l => local.leaves.set(l.id, l)); syncLocal(); return; }
  toast("Memuat data contoh…");
  try {
    await run(sb.from("members").insert(M.map(toRow)));
    await run(sb.from("tasks").insert(T.map(toRow)));
    await run(sb.from("leaves").insert(LV.map(toRow)));
    await run(sb.from("activity_logs").insert(L.map(({ id, by, ...l }) => toRow(l))));
    ["members", "tasks", "logs", "leaves"].forEach(queue);
    toast("Data contoh dimuat. Hapus kapan saja lewat tombol di bagian atas.", "ok");
  } catch {}
}
async function clearDemo() {
  if (!sb) { for (const c of ["members", "tasks", "logs", "leaves"]) for (const [k, v] of local[c]) if (v.demo) local[c].delete(k); return syncLocal(); }
  try {
    await run(sb.from("tasks").delete().eq("demo", true));
    await run(sb.from("leaves").delete().eq("demo", true));
    await run(sb.from("activity_logs").delete().eq("demo", true));
    await run(sb.from("members").delete().eq("demo", true));
    ["members", "tasks", "logs", "profiles", "leaves"].forEach(queue);
    toast("Data contoh dihapus.", "ok");
  } catch {}
}

/* ---------- Render: kerangka ---------- */
function refresh() {
  compute();
  notifyAlerts();
  renderWho(); renderBanner(); renderNavCount();
  VIEWS[S.route]?.update();
}
function setRoute() {
  const r = (location.hash || "#dashboard").slice(1);
  S.route = VIEWS[r] ? r : "dashboard";
  document.querySelectorAll("#nav a").forEach(a => a.toggleAttribute("aria-current", a.dataset.route === S.route) || a.setAttribute("aria-current", a.dataset.route === S.route ? "page" : ""));
  document.querySelectorAll("#nav a").forEach(a => { if (a.dataset.route === S.route) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  $("#view").innerHTML = VIEWS[S.route].mount();
  VIEWS[S.route].update();
  window.scrollTo(0, 0);
}
function renderNavCount() { const n = alertTasks().length; const el = $("#nav-alerts"); el.hidden = !n; el.textContent = n; }
function renderWho() {
  const me = myMemberId(); const lead = S.me.isLead;
  if (sb && !S.me.id) { $("#who").innerHTML = ""; return; }
  const roleTxt = isLead() ? ["Team Lead", ""] : ["Anggota", "member"];
  const locked = sb && !lead && !!me;
  const opts = S.members.map(m => `<option value="${esc(m.id)}" ${m.id === me ? "selected" : ""}>${esc(m.name)}</option>`).join("");
  $("#who").innerHTML = `<div class="whobox">
    <label>Peran Anda</label>
    <span class="role-tag ${roleTxt[1]}">${roleTxt[0]}</span>
    ${sb ? `<span class="note" style="overflow-wrap:anywhere">${esc(S.me.name || S.me.email || "")}</span>` : ""}
    ${S.members.length ? `<div class="claim-wrap field"><span>Saya adalah</span><select id="claim-sel" aria-label="Pilih profil anggota Anda" ${locked ? "disabled" : ""}><option value="">— pilih profil —</option>${opts}</select>${locked ? `<small>Untuk mengganti, hubungi Team Lead.</small>` : ""}</div>` : ""}
    ${lead ? `<label class="switch"><input type="checkbox" id="preview-member" ${S.asMember ? "checked" : ""}> Pratinjau tampilan anggota</label>` : ""}
    ${sb ? `<button class="btn sm" data-act="logout">Keluar</button>` : ""}
  </div>`;
}
function renderBanner() {
  const parts = [];
  if (S.mode === "local") parts.push(`<div class="banner"><b>Mode pratinjau.</b> ${CONF.supabaseUrl ? "Pustaka Supabase gagal dimuat, jadi" : `Supabase belum dikonfigurasi di <span class="mono">config.js</span>, jadi`} data contoh hanya ada di memori dan hilang saat halaman dimuat ulang.</div>`);
  if (S.stale) parts.push(`<div class="banner warn"><b>Koneksi ke database terganggu.</b> Tampilan mungkin belum terbaru; sistem terus mencoba tersambung.${S.lastErr ? `<span class="mono" style="font-size:.76rem;overflow-wrap:anywhere">Detail: ${esc(S.lastErr)}</span>` : ""}</div>`);
  if (S.mode === "db" && isLead() && S.members.some(m => m.demo)) parts.push(`<div class="banner">Data contoh sedang aktif. <button class="btn sm" data-act="clear-demo">Hapus data contoh</button></div>`);
  $("#banner").innerHTML = parts.join("");
}

/* ---------- Komponen ---------- */
function avatar(m, cls = "") { return `<span class="avatar ${cls}" style="--av:${avColor(m?.id || "x")}">${esc(initials(m?.name))}</span>`; }
function meter(L, cap, add = 0, slim = false) {
  const scale = 120, sc = v => Math.max(0, Math.min(v, scale)) / scale * 100;
  const picP = cap ? L.pic / cap * 100 : 0, bakP = cap ? L.bak / cap * 100 : 0, addP = cap ? add / cap * 100 : 0;
  const lv = level(picP + bakP + addP);
  return `<div class="meter lv-${lv} ${slim ? "slim" : ""}" role="img" aria-label="Beban ${pctTxt(picP + bakP)} dari kapasitas">
    <div class="track">
      <div class="fill pic" style="width:${sc(picP)}%"></div>
      <div class="fill bak" style="left:${sc(picP)}%;width:${sc(picP + bakP) - sc(picP)}%"></div>
      ${add ? `<div class="fill add" style="left:${sc(picP + bakP)}%;width:${sc(picP + bakP + addP) - sc(picP + bakP)}%"></div>` : ""}
    </div>
    <i class="tick" style="left:${sc(S.cfg.yellow)}%"></i><i class="tick red" style="left:${sc(S.cfg.red)}%"></i>
    ${slim ? "" : `<span class="tick-l" style="left:${sc(S.cfg.yellow)}%">${S.cfg.yellow}</span><span class="tick-l" style="left:${sc(S.cfg.red)}%">${S.cfg.red}</span><span class="tick-l" style="left:${sc(100)}%">100</span>`}
  </div>`;
}
function statusPill(st) { const c = st === "Aktif" ? "ok" : st === "Sakit" ? "crit" : "warn"; return `<span class="pill ${c}">${esc(st || "Aktif")}</span>`; }
function chip(m, bak = false) { if (!m) return `<span class="chip bak">— belum ada</span>`; return `<span class="chip ${bak ? "bak" : ""}" title="${bak ? "Backup" : "PIC"}: ${esc(m.name)}">${avatar(m)}${bak ? "Backup · " : ""}${esc(m.name.split(" ")[0])}</span>`; }
function emptyTeam() {
  return `<div class="empty">
    <h2>Belum ada anggota tim</h2>
    <p>${isLead() ? "Mulai dengan memasukkan profil anggota dan kapasitas maksimalnya. Setelah itu, sistem menghitung beban dan merekomendasikan penugasan." : "Team Lead belum memasukkan anggota tim. Halaman ini terisi otomatis setelahnya."}</p>
    ${isLead() && canWrite() ? `<div class="row"><button class="btn primary" data-act="add-member">Tambah anggota</button><button class="btn" data-act="load-demo">Muat data contoh</button></div>` : ""}
  </div>`;
}
function loadingBlock() { return `<div class="empty"><p>Memuat data tim…</p></div>`; }
const loaded = () => S.mode === "local" || (S.ready.members && S.ready.tasks);

/* ---------- View: Dashboard ---------- */
const VIEWS = {};
VIEWS.dashboard = {
  mount: () => `
    <header class="page-head">
      <div><p class="eyebrow">Dashboard kapasitas</p><h1>Beban kerja tim, real-time</h1>
      <p class="lede">Setiap tugas aktif langsung dihitung terhadap kapasitas personal. Garis putus-putus menandai ambang kuning dan merah.</p></div>
      <div class="legend" id="dash-legend"></div>
    </header>
    <section class="kpis" id="dash-kpis"></section>
    <section id="dash-alerts" class="alerts"></section>
    <section class="panel" id="dash-fair" hidden></section>
    <section class="members-grid" id="dash-members"></section>`,
  update() {
    $("#dash-legend").innerHTML = `<span><i class="swatch lv-green"></i>Aman &lt; ${S.cfg.yellow}%</span><span><i class="swatch lv-yellow"></i>Mendekati ${S.cfg.yellow}–${S.cfg.red}%</span><span><i class="swatch lv-red"></i>Overload &gt; ${S.cfg.red}%</span><span><i class="swatch striped"></i>Beban siaga backup (${Math.round(S.cfg.backupFactor * 100)}%)</span>`;
    $("#dash-fair").hidden = true;
    if (!loaded()) { $("#dash-members").innerHTML = loadingBlock(); $("#dash-kpis").innerHTML = ""; $("#dash-alerts").innerHTML = ""; return; }
    if (!S.members.length) { $("#dash-kpis").innerHTML = ""; $("#dash-alerts").innerHTML = ""; $("#dash-members").innerHTML = emptyTeam(); $("#dash-members").style.display = "block"; return; }
    $("#dash-members").style.display = "";
    const act = S.members.filter(m => !absentNow(m));
    const totLoad = S.members.reduce((s, m) => s + S.loads[m.id].total, 0), totCap = act.reduce((s, m) => s + (m.capacity || 0), 0);
    const reds = S.members.filter(m => S.loads[m.id].level === "red").length, yel = S.members.filter(m => S.loads[m.id].level === "yellow").length;
    const active = S.tasks.filter(t => t.status !== "done"), pts = active.reduce((s, t) => s + (t.weight || 0), 0);
    const nAl = alertTasks().length;
    const util = totCap ? totLoad / totCap * 100 : 0;
    $("#dash-kpis").innerHTML = `
      <div class="kpi ${util > S.cfg.red ? "crit" : util >= S.cfg.yellow ? "warn" : ""}"><span class="k-label">Utilisasi tim</span><span class="k-val">${pctTxt(util)}</span><span class="k-sub">${Math.round(totLoad)} / ${totCap} poin (anggota aktif)</span></div>
      <div class="kpi ${reds ? "crit" : ""}"><span class="k-label">Overload</span><span class="k-val">${reds}</span><span class="k-sub">anggota di atas ${S.cfg.red}%</span></div>
      <div class="kpi ${yel ? "warn" : ""}"><span class="k-label">Mendekati batas</span><span class="k-val">${yel}</span><span class="k-sub">anggota ${S.cfg.yellow}–${S.cfg.red}%</span></div>
      <div class="kpi"><span class="k-label">Tugas aktif</span><span class="k-val">${active.length}</span><span class="k-sub">${pts} poin beban</span></div>
      <div class="kpi ${nAl ? "crit" : ""}"><span class="k-label">Perlu handover</span><span class="k-val">${nAl}</span><span class="k-sub">${S.members.filter(absentNow).length} anggota tidak hadir hari ini</span></div>
      <div class="kpi ${S.fair.index < 75 ? "crit" : S.fair.index < 90 ? "warn" : ""}"><span class="k-label">Indeks keadilan</span><span class="k-val">${S.fair.index}</span><span class="k-sub">Gini ${S.fair.gini.toFixed(2)} · ${fairLabel(S.fair.index)}</span></div>`;
    renderFairPanel();
    $("#dash-alerts").innerHTML = S.alerts.length ? `<h2>Eskalasi otomatis</h2>` + S.alerts.map(alertGroup).join("") : "";
    const sorted = [...S.members].sort((a, b) => S.loads[b.id].pct - S.loads[a.id].pct);
    const [wk0, wk1] = P.periods(todayStr(), "week", 2);
    $("#dash-members").innerHTML = sorted.map(m => {
      const L = S.loads[m.id];
      const u0 = P.periodUtil(S.ctx, m, wk0.from, wk0.to), u1 = P.periodUtil(S.ctx, m, wk1.from, wk1.to);
      return `<article class="mcard lv-${L.level}">
        <div class="mc-top">${avatar(m)}<div><h3>${esc(m.name)}</h3><p>${esc(m.level)} · kapasitas ${m.capacity} poin${m.id === myMemberId() ? " · <b>Anda</b>" : ""}</p></div>${statusPill(m.status)}</div>
        ${meter(L, m.capacity)}
        <div class="mc-nums"><span class="big">${pctTxt(L.pct)}</span><span>${r1(L.total)} / ${m.capacity} poin</span></div>
        <div class="mc-break"><span><i class="swatch lv-${L.level}"></i>PIC <b>${L.pic}</b> · ${L.picN} tugas</span><span><i class="swatch striped lv-${L.level}"></i>Siaga <b>${r1(L.bak)}</b> · ${L.bakN} backup</span><span class="pill ${LV_PILL[L.level]}">${LV_TXT[L.level]}</span></div>
        <div class="mc-weeks"><a href="#kalender">Jam kerja</a>${weekChip("Minggu ini", u0)}${weekChip("Minggu depan", u1)}</div>
      </article>`;
    }).join("");
  }
};
function fairLabel(i) { return i >= 90 ? "merata" : i >= 75 ? "cukup merata" : "timpang"; }
function weekChip(label, u) {
  const lv = u.hours ? P.level(S.cfg, u.pct) : "none";
  return `<span class="wchip h-${lv}" title="${esc(label)}: ${r1(u.demand)} dari ${r1(u.hours)} jam tersedia${u.leave ? `, cuti ${u.leave} hari` : ""}">${esc(label)} <b>${u.hours ? pctTxt(u.pct) : "cuti"}</b></span>`;
}
function fairStrip(members, mean) {
  const W = 640, H = 92, L = 18, R = 18, max = Math.max(120, ...members.map(x => Math.min(x.pct, 200)));
  const x = v => L + Math.min(v, max) / max * (W - L - R);
  let g = `<rect x="${x(S.cfg.yellow)}" y="10" width="${x(S.cfg.red) - x(S.cfg.yellow)}" height="52" class="z-warn"/><rect x="${x(S.cfg.red)}" y="10" width="${x(max) - x(S.cfg.red)}" height="52" class="z-crit"/>`;
  for (let v = 0; v <= max; v += 20) g += `<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="10" y2="62"/><text x="${x(v)}" y="78" text-anchor="middle">${v}%</text>`;
  g += `<line class="mean" x1="${x(mean)}" x2="${x(mean)}" y1="4" y2="66"/><text class="mean-t" x="${x(mean)}" y="90" text-anchor="middle">rata-rata ${Math.round(mean)}%</text>`;
  [...members].sort((a, b) => a.pct - b.pct).forEach((it, i) => {
    const m = mem(it.id); const cy = 22 + (i % 3) * 14;
    g += `<g><title>${esc(m?.name)}: ${pctTxt(it.pct)}</title><circle cx="${x(it.pct)}" cy="${cy}" r="6.5" fill="${avColor(it.id)}"/><text class="ini" x="${x(it.pct)}" y="${cy + 3}" text-anchor="middle">${esc(initials(m?.name))}</text></g>`;
  });
  return `<div class="strip"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sebaran utilisasi kapasitas per anggota">${g}</svg></div>`;
}
function renderFairPanel() {
  const el = $("#dash-fair"); const f = S.fair;
  if (!el || !f || f.n < 2) { if (el) el.hidden = true; return; }
  el.hidden = false;
  const hist = S.logs.filter(l => l.meta && l.meta.fairBefore != null && l.meta.fairAfter != null).slice(0, 5);
  el.innerHTML = `<div class="panel-head"><div><p class="eyebrow">Workload Fairness Index</p><h2>Keadilan beban tim</h2></div>
      ${isLead() ? `<button class="btn" data-act="sim-optimize">Cari redistribusi yang lebih adil</button>` : ""}</div>
    <div class="fair-grid">
      <div class="fair-metrics">
        <div><span class="k-label">Indeks keadilan</span><b class="num">${f.index}</b><small>100 = utilisasi semua anggota sama</small></div>
        <div><span class="k-label">Ketimpangan (Gini)</span><b class="num">${f.gini.toFixed(2)}</b><small>0 = merata, 1 = timpang total</small></div>
        <div><span class="k-label">Rentang utilisasi</span><b class="num">${Math.round(f.min)}–${Math.round(f.max)}%</b><small>selisih ${Math.round(f.spread)} poin persen</small></div>
        <div><span class="k-label">Simpangan baku</span><b class="num">${Math.round(f.std)}%</b><small>dari rata-rata ${Math.round(f.mean)}%</small></div>
      </div>
      <div style="min-width:0">${fairStrip(f.members, f.mean)}
        <p class="note">Dihitung dari utilisasi relatif (beban ÷ kapasitas) ${f.n} anggota yang hadir hari ini, bukan dari jumlah tugas.</p></div>
    </div>
    ${hist.length ? `<div class="field"><span>Perubahan setelah redistribusi terakhir</span><div class="fair-hist">${hist.map(l => { const d = l.meta.fairAfter - l.meta.fairBefore; return `<div><time>${esc(fmtTime(l.at))}</time><span>${esc(l.text.length > 90 ? l.text.slice(0, 88) + "…" : l.text)}</span><b class="num">${l.meta.fairBefore} → ${l.meta.fairAfter} <span class="delta ${d > 0 ? "up" : d < 0 ? "down" : ""}">${d > 0 ? "+" : ""}${d}</span></b></div>`; }).join("")}</div></div>` : ""}`;
}
function alertGroup(g) {
  const L = S.loads[g.p.id];
  const st = g.p.status !== "Aktif" ? g.p.status : "cuti";
  const title = g.absent ? `${esc(g.p.name)} sedang ${esc(st)}` : g.upcoming ? `${esc(g.p.name)} akan cuti sebelum tenggat` : `${esc(g.p.name)} melewati batas merah (${pctTxt(L.pct)})`;
  const sub = g.absent ? `${g.tasks.length} tugas aktif harus diambil alih backup.` : g.upcoming ? "Siapkan handover sebelum cuti dimulai." : `Alihkan sebagian tugas ke backup sampai beban di bawah ${S.cfg.red}%.`;
  return `<div class="alert ${g.absent ? "" : "warn"}">
    <div class="alert-head"><span class="pill ${g.absent ? "crit" : "warn"}">${g.absent ? "Tidak hadir" : g.upcoming ? "Cuti mendatang" : "Overload"}</span><h3>${title}</h3><span class="muted" style="font-size:.82rem">${sub}</span></div>
    ${g.tasks.map(({ t, reasons }) => handoverRow(t, reasons)).join("")}
  </div>`;
}
function skillGap(t, m) { const sk = P.skillMatch(t.skills, m?.skills); return !sk.none && sk.missing.length ? ` · kurang skill ${sk.missing.join(", ")}` : ""; }
function handoverRow(t, reasons) {
  const b = mem(t.backupId); const me = myMemberId();
  const bOk = b && !absentNow(b);
  const after = b ? (S.loads[b.id].total - t.weight * S.cfg.backupFactor + t.weight) / b.capacity * 100 : 0;
  let action = "";
  if (canWrite() && bOk && (isLead() || me === b.id)) action = `<button class="btn sm ${me === b.id && !isLead() ? "primary" : "warn"}" data-act="handover" data-id="${esc(t.id)}">${me === b.id && !isLead() ? "Ambil alih tugas" : "Alihkan ke " + esc(b.name.split(" ")[0])}</button>`;
  else if (canWrite() && !bOk && isLead()) action = `<button class="btn sm" data-act="open-task" data-id="${esc(t.id)}">Tetapkan ulang</button>`;
  else if (bOk) action = `<span class="note">Menunggu ${esc(b.name.split(" ")[0])} atau Team Lead</span>`;
  return `<div class="alert-task"><div class="t"><b>${esc(t.title)}</b><small>${t.weight} poin · ${esc(reasons.join(", "))} · ${bOk ? `Backup ${esc(b.name)}: beban jadi ${pctTxt(after)}${skillGap(t, b)}` : b ? `Backup ${esc(b.name)} juga tidak hadir` : "Belum ada backup"}</small></div>${action}</div>`;
}

/* ---------- View: Papan tugas ---------- */
function newDraft() { return { title: "", desc: "", k: 3, startDate: ymd(new Date()), deadline: ymd(shift(7)), uMode: "auto", u: 3, hours: 8, skills: "", pic: null, bak: null, picManual: false, bakManual: false, err: "" }; }
VIEWS.tugas = {
  mount() {
    S.draft ||= newDraft();
    const d = S.draft;
    return `
    <header class="page-head">
      <div><p class="eyebrow">Distribusi tugas terbuka</p><h1>Papan tugas</h1>
      <p class="lede">Semua anggota melihat siapa mengerjakan apa. PIC dan backup memperbarui progres; Team Lead membuat tugas dan menetapkan penanggung jawab.</p></div>
      <div id="composer-toggle"></div>
    </header>
    <section class="panel" id="composer" ${S.composerOpen ? "" : "hidden"}>
      <div class="panel-head"><div><p class="eyebrow">Kalkulator pembobotan</p><h2>Tugas baru</h2></div><button class="btn ghost sm" data-act="toggle-composer">Tutup</button></div>
      <form class="composer" id="composer-form" novalidate>
        <div style="display:flex;flex-direction:column;gap:14px;min-width:0">
          <label class="field"><span>Judul tugas</span><input type="text" id="d-title" value="${esc(d.title)}" placeholder="mis. Integrasi API pembayaran" maxlength="120"></label>
          <label class="field"><span>Deskripsi (opsional)</span><textarea id="d-desc" maxlength="1000" placeholder="Lingkup dan definisi selesai">${esc(d.desc)}</textarea></label>
          <div class="field"><span>Kompleksitas</span>
            <div class="seg" role="radiogroup" aria-label="Kompleksitas">${[1, 2, 3, 4, 5].map(k => `<label title="${KLAB[k]}"><input type="radio" name="d-k" value="${k}" ${d.k === k ? "checked" : ""}>${k} · ${KLAB[k]}</label>`).join("")}</div>
          </div>
          <div class="field"><span>Skill yang dibutuhkan</span>
            <input type="text" id="d-skills" value="${esc(d.skills)}" placeholder="mis. Backend, QA" maxlength="120">
            <div class="chips" id="skill-chips"></div>
          </div>
          <div class="grid4">
            <label class="field"><span>Mulai</span><input type="date" id="d-start" value="${esc(d.startDate)}"></label>
            <label class="field"><span>Tenggat</span><input type="date" id="d-deadline" value="${esc(d.deadline)}"></label>
            <label class="field"><span>Urgensi</span><select id="d-umode"><option value="auto" ${d.uMode === "auto" ? "selected" : ""}>Otomatis</option>${[1, 2, 3, 4, 5].map(u => `<option value="${u}" ${d.uMode === String(u) ? "selected" : ""}>${u} · ${ULAB[u]}</option>`).join("")}</select></label>
            <label class="field"><span>Estimasi durasi (jam)</span><input type="number" id="d-hours" min="0.5" max="400" step="0.5" value="${d.hours}"></label>
          </div>
          <div class="calc" id="calc"></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
          <div class="panel-head"><h3>Rekomendasi penugasan</h3><span class="note">Skill, beban poin, dan jam kerja di periode tugas</span></div>
          <div class="rec-list" id="recs"></div>
          <div class="summary" id="assign-summary"></div>
        </div>
      </form>
    </section>
    <section style="display:flex;flex-direction:column;gap:12px">
      <div class="toolbar">
        <input type="search" id="f-q" placeholder="Cari tugas" value="${esc(S.filters.q)}" aria-label="Cari tugas">
        <select id="f-member" aria-label="Filter anggota"></select>
        <label class="switch"><input type="checkbox" id="f-mine" ${S.filters.mine ? "checked" : ""}> Hanya tugas saya</label>
        <span class="note" id="board-count"></span>
      </div>
      <div class="board" id="board"></div>
    </section>`;
  },
  update() {
    $("#composer-toggle").innerHTML = isLead() && canWrite() && S.members.length ? `<button class="btn primary" data-act="toggle-composer">${S.composerOpen ? "Sembunyikan form" : "+ Tugas baru"}</button>` : "";
    if (!(isLead() && canWrite())) $("#composer").hidden = true; else $("#composer").hidden = !S.composerOpen;
    const fm = $("#f-member"); const v = S.filters.member;
    fm.innerHTML = `<option value="">Semua anggota</option>` + S.members.map(m => `<option value="${esc(m.id)}" ${m.id === v ? "selected" : ""}>${esc(m.name)}</option>`).join("");
    $("#f-mine").closest("label").hidden = !myMemberId();
    if (!S.composerOpen || $("#composer").hidden) {} else updateComposer();
    updateBoard();
  }
};
function updateBoard() {
  const el = $("#board"); if (!el) return;
  if (!loaded()) { el.innerHTML = loadingBlock(); return; }
  if (!S.members.length) { el.style.display = "block"; el.innerHTML = emptyTeam(); return; }
  el.style.display = "";
  const q = S.filters.q.trim().toLowerCase(), fmem = S.filters.member, mine = S.filters.mine && myMemberId();
  const flagged = new Set(alertTasks().map(x => x.t.id));
  const list = S.tasks.filter(t => (!q || t.title.toLowerCase().includes(q)) && (!fmem || t.picId === fmem || t.backupId === fmem) && (!mine || t.picId === mine || t.backupId === mine));
  $("#board-count").textContent = `${list.length} tugas`;
  el.innerHTML = TSTAT.map(([k, l]) => {
    let items = list.filter(t => t.status === k);
    items.sort(k === "done" ? (a, b) => (b.doneAt || "").localeCompare(a.doneAt || "") : (a, b) => (a.deadline || "9").localeCompare(b.deadline || "9"));
    const more = k === "done" && items.length > 12 ? items.length - 12 : 0; if (more) items = items.slice(0, 12);
    const pts = list.filter(t => t.status === k).reduce((s, t) => s + (t.weight || 0), 0);
    return `<div class="col"><div class="col-head"><span>${l}</span><span class="num">${list.filter(t => t.status === k).length} · ${pts} poin</span></div>
      ${items.map(t => taskCard(t, flagged.has(t.id))).join("") || `<p class="empty-col">Kosong</p>`}
      ${more ? `<p class="empty-col">+${more} tugas selesai lainnya di Laporan</p>` : ""}</div>`;
  }).join("");
}
function taskCard(t, flag) {
  const [dl, dc] = t.status === "done" ? ["Selesai " + fmtDate(t.doneAt), ""] : dueLabel(t.deadline);
  return `<article class="tcard ${flag ? "flag" : ""}" data-act="open-task" data-id="${esc(t.id)}" tabindex="0">
    <h4>${esc(t.title)}</h4>
    <div class="tmeta"><span class="wbadge">${t.weight} poin</span><span>K${t.complexity} · U${t.urgency} · ${t.hours} jam</span><span class="due ${dc}">${esc(dl)}</span>${flag ? `<span class="pill crit">Perlu handover</span>` : ""}</div>
    ${(t.skills || []).length ? `<div class="chips sm">${t.skills.map(x => `<span class="skill">${esc(x)}</span>`).join("")}</div>` : ""}
    <div class="people">${chip(mem(t.picId))}${chip(mem(t.backupId), true)}</div>
    ${canProgress(t) ? `<select data-status="${esc(t.id)}" aria-label="Ubah status ${esc(t.title)}">${TSTAT.map(([k, l]) => `<option value="${k}" ${t.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>` : ""}
  </article>`;
}
function teamSkills() { const seen = new Map(); for (const m of S.members) for (const x of P.skillList(m.skills)) if (!seen.has(x.toLowerCase())) seen.set(x.toLowerCase(), x); return [...seen.values()].sort((a, b) => a.localeCompare(b)); }
function draftU() { const d = S.draft; return d.uMode === "auto" ? urgencyFromDeadline(d.deadline) : +d.uMode; }
function updateComposer() {
  const d = S.draft; if (!$("#calc")) return;
  const u = draftU(), h = Math.max(0, +d.hours || 0), w = h ? weightOf(d.k, u, h) : 0, { kf, uf } = factors(d.k, u);
  const dd = dayDiff(d.deadline);
  $("#calc").innerHTML = `<span class="eyebrow">Total bobot tugas</span>
    <div class="wt"><span class="num">${w}</span><span class="muted">poin beban kerja</span></div>
    <div class="formula">${h} jam × ${kf.toFixed(2)} (kompleksitas ${d.k}) × ${uf.toFixed(2)} (urgensi ${u}${d.uMode === "auto" ? `, tenggat ${dd === null ? "—" : dd < 0 ? "lewat" : dd + " hari"}` : ""}) = ${r1(h * kf * uf)} → ${w}</div>
    <div class="note">Backup menanggung beban siaga ${Math.round(S.cfg.backupFactor * 100)}% = ${r1(w * S.cfg.backupFactor)} poin.</div>`;
  if (!S.members.length) { $("#recs").innerHTML = `<p class="note">Tambahkan anggota tim terlebih dahulu.</p>`; $("#assign-summary").innerHTML = ""; return; }
  const need = P.skillList(d.skills);
  const allSk = teamSkills(), needK = new Set(need.map(x => x.toLowerCase()));
  $("#skill-chips").innerHTML = allSk.length ? allSk.map(x => `<button type="button" data-act="toggle-skill" data-v="${esc(x)}" aria-pressed="${needK.has(x.toLowerCase())}">${esc(x)}</button>`).join("") : `<span class="note">Isi keahlian anggota di halaman Tim agar bisa dicocokkan.</span>`;
  const task = { weight: w, hours: h, complexity: d.k, status: "todo", startDate: d.startDate, deadline: d.deadline, skills: need };
  const ranked = rankFor(task, "pic");
  if (!d.picManual || !mem(d.pic)) d.pic = ranked[0]?.m.id || null;
  const bRank = rankFor({ ...task, picId: d.pic }, "backup", [d.pic]);
  if (!d.bakManual || !mem(d.bak) || d.bak === d.pic) { d.bak = bRank[0]?.m.id || null; d.bakManual = false; }
  const [ws, we] = P.taskWindow(task, todayStr());
  const noSkill = need.length && ranked.every(r => r.sk.ratio === 0);
  const top = ranked[0];
  const skilledFull = need.length && !noSkill && top && top.sk.ratio > 0 && top.peak > S.cfg.red;
  $("#recs").innerHTML = (skilledFull ? `<div class="banner warn">Anggota yang punya skill <b>${esc(need.join(", "))}</b> sedang penuh. Rekomendasi tetap mengutamakan kompetensi; pertimbangkan memundurkan tenggat, mengalihkan tugas lain miliknya, atau memasang Backup sebagai pendamping.</div>` : "") + (noSkill ? `<div class="banner warn">Belum ada anggota dengan skill <b>${esc(need.join(", "))}</b>. Rekomendasi hanya berdasarkan beban; pertimbangkan pendampingan atau pelatihan.</div>` : "") + ranked.map((r, i) => {
    const isPic = r.m.id === d.pic, isBak = r.m.id === d.bak;
    const fit = P.fitOf(S.cfg, r);
    const winAfter = isBak ? (r.w0.hours ? (r.w0.demand + h * S.cfg.backupFactor) / r.w0.hours * 100 : 999) : r.wAfter;
    const ptsAfter = isBak ? (r.l.total + w * S.cfg.backupFactor) / r.m.capacity * 100 : r.after;
    const skl = r.sk.none ? "" : r.sk.matched.map(x => `<span class="skill ok">${esc(x)}</span>`).join("") + r.sk.missing.map(x => `<span class="skill miss">${esc(x)}</span>`).join("");
    return `<div class="rec ${isPic ? "sel-pic" : isBak ? "sel-bak" : ""}">
      <span class="rank">${i + 1}</span>
      <div class="who"><b>${esc(r.m.name)} <span class="pill ${fit[1]}">${fit[0]}</span></b><small>${esc(r.m.level)}${skl ? "" : " · " + esc(r.m.skills || "—")}</small>${skl ? `<div class="chips sm">${skl}</div>` : ""}</div>
      <div class="acts"><button type="button" class="btn sm" data-act="pick-pic" data-id="${esc(r.m.id)}" aria-pressed="${isPic}">PIC</button><button type="button" class="btn sm" data-act="pick-bak" data-id="${esc(r.m.id)}" aria-pressed="${isBak}" ${isPic ? "disabled" : ""}>Backup</button></div>
      ${meter(r.l, r.m.capacity, isBak ? w * S.cfg.backupFactor : w, true)}
      <div class="proj"><span class="num">Poin ${pctTxt(r.l.pct)} → ${pctTxt(ptsAfter)}</span><span class="num">Jam ${fmtDate(ws)}–${fmtDate(we)}: ${r.w0.hours ? `${pctTxt(r.w0.pct)} → ${pctTxt(winAfter)}` : "cuti penuh"}</span><span>${esc(r.notes.join(" · "))}</span></div>
    </div>`;
  }).join("");
  const pm = mem(d.pic), bm = mem(d.bak);
  $("#assign-summary").innerHTML = `<div class="who-line">PIC <b>${esc(pm?.name || "—")}</b> ${d.picManual ? `<span class="pill plain">dipilih manual</span>` : `<span class="pill ok">rekomendasi sistem</span>`}<br>Backup <b>${esc(bm?.name || "—")}</b> ${d.bakManual ? `<span class="pill plain">dipilih manual</span>` : `<span class="pill ok">rekomendasi sistem</span>`}</div>
    <div class="row">${d.err ? `<span class="error-text">${esc(d.err)}</span>` : ""}<button type="submit" class="btn primary">Buat &amp; tetapkan</button></div>`;
}
async function submitTask() {
  const d = S.draft; const u = draftU(); const h = +d.hours;
  d.err = !d.title.trim() ? "Isi judul tugas." : !(h > 0) ? "Estimasi durasi harus lebih dari 0 jam." : !d.deadline ? "Pilih tenggat." : d.startDate && d.startDate > d.deadline ? "Tanggal mulai harus sebelum tenggat." : !d.pic ? "Pilih PIC." : d.bak === d.pic ? "Backup harus berbeda dari PIC." : "";
  if (d.err) return updateComposer();
  const w = weightOf(d.k, u, h); const id = newId("t");
  const t = { title: d.title.trim(), desc: d.desc.trim(), complexity: d.k, urgency: u, urgencyMode: d.uMode === "auto" ? "auto" : "manual", hours: h, startDate: d.startDate || ymd(new Date()), deadline: d.deadline, skills: P.skillList(d.skills), weight: w, picId: d.pic, backupId: d.bak || null, status: "todo", createdAt: new Date().toISOString(), doneAt: null, createdBy: S.me.id || null, handovers: [], autoPicked: !d.picManual };
  const meta = fairMeta(fairAfter(st => st.tasks.push({ ...t, id })));
  try {
    await put("tasks", id, t);
    log("task_new", `Tugas baru "${t.title}" (${w} poin) ditetapkan ke ${nm(t.picId)}, backup ${nm(t.backupId)}${t.autoPicked ? " sesuai rekomendasi sistem" : ""}.`, { taskId: id, meta });
    const after = S.loads[t.picId] ? S.loads[t.picId].pct : 0;
    toast(`"${t.title}" ditetapkan ke ${nm(t.picId)} (beban ${pctTxt(after)}).`, after > S.cfg.red ? "crit" : "ok");
    S.draft = newDraft(); S.composerOpen = false; setRoute();
  } catch {}
}
async function setStatus(id, st) {
  const t = S.tasks.find(x => x.id === id); if (!t || t.status === st) return;
  try {
    await patch("tasks", id, { status: st, doneAt: st === "done" ? new Date().toISOString() : null });
    log("status", `"${t.title}" dipindahkan dari ${TLABEL[t.status]} ke ${TLABEL[st]}.`, { taskId: id });
  } catch {}
}
async function handover(id) {
  const t = S.tasks.find(x => x.id === id); if (!t || !t.backupId) return;
  const from = t.picId, to = t.backupId;
  const reason = alertTasks().find(x => x.t.id === id)?.reasons.join(", ") || "dialihkan Team Lead";
  const nb = rankFor(t, "backup", [from, to]).find(r => !r.absent)?.m.id || null;
  const meta = fairMeta(fairAfter(st => { const x = st.tasks.find(y => y.id === id); x.picId = to; x.backupId = nb; }));
  if (sb) {
    try { await run(sb.rpc("handover_task", { p_task: id, p_new_backup: nb, p_reason: reason, p_meta: meta })); queue("tasks"); queue("logs"); toast(`${nm(to)} kini PIC "${t.title}". Indeks keadilan ${meta.fairBefore} → ${meta.fairAfter}.`, "ok"); } catch {}
    return;
  }
  try {
    await patch("tasks", id, { picId: to, backupId: nb, handovers: [...(t.handovers || []), { from, to, at: new Date().toISOString(), reason, by: S.me.id || null }] });
    log("handover", `Handover: "${t.title}" dialihkan dari ${nm(from)} ke ${nm(to)} (${reason}). Backup baru: ${nm(nb)}.`, { taskId: id, meta });
    toast(`${nm(to)} kini PIC "${t.title}". Indeks keadilan ${meta.fairBefore} → ${meta.fairAfter}.`, "ok");
  } catch {}
}

/* ---------- View: Tim ---------- */
VIEWS.tim = {
  mount: () => `
    <header class="page-head">
      <div><p class="eyebrow">Setup kapasitas</p><h1>Tim &amp; kapasitas</h1>
      <p class="lede">Kapasitas poin menjadi pembagi beban saat ini; jam kerja per hari, tugas rutin, dan jadwal cuti menjadi dasar kalender kapasitas. Keahlian dipakai untuk mencocokkan tugas.</p></div>
      <div id="tim-actions" class="row"></div>
    </header>
    <section id="tim-table"></section>
    <section class="panel" id="tim-accounts" hidden></section>
    <section class="panel" id="tim-cfg"></section>`,
  update() {
    $("#tim-actions").innerHTML = isLead() && canWrite() ? `<button class="btn primary" data-act="add-member">+ Tambah anggota</button>` : "";
    if (!loaded()) { $("#tim-table").innerHTML = loadingBlock(); return; }
    $("#tim-table").innerHTML = !S.members.length ? emptyTeam() : `<div class="tablewrap"><table>
      <thead><tr><th>Anggota</th><th>Level</th><th class="n">Kapasitas</th><th>Status</th><th class="n">Beban</th><th style="min-width:150px">Meter</th><th>Keahlian</th><th class="n">Jam/hari</th><th>Tugas rutin</th>${isLead() && canWrite() ? "<th></th>" : ""}</tr></thead>
      <tbody>${[...S.members].sort((a, b) => a.name.localeCompare(b.name)).map(m => { const L = S.loads[m.id]; return `<tr>
        <td><div class="namecell">${avatar(m)}<div><b>${esc(m.name)}</b><small>${L.picN} PIC · ${L.bakN} backup${m.demo ? " · contoh" : ""}</small></div></div></td>
        <td>${esc(m.level)}</td><td class="n">${m.capacity}</td><td>${statusPill(m.status)}</td>
        <td class="n">${pctTxt(L.pct)}</td><td>${meter(L, m.capacity, 0, true)}</td><td>${P.skillList(m.skills).map(x => `<span class="skill">${esc(x)}</span>`).join(" ") || "—"}</td>
        <td class="n">${r1(+m.hoursPerDay || 7)}</td><td class="muted">${+m.routineHours ? `${r1(+m.routineHours)} j/mgg${m.routineNote ? " · " + esc(m.routineNote) : ""}` : "—"}</td>
        ${isLead() && canWrite() ? `<td><button class="btn sm" data-act="open-member" data-id="${esc(m.id)}">Ubah</button></td>` : ""}</tr>`; }).join("")}</tbody></table></div>`;
    renderAccounts();
    if (!document.activeElement || !$("#tim-cfg").contains(document.activeElement)) renderCfg();
  }
};
function renderAccounts() {
  const el = $("#tim-accounts"); if (!el) return;
  el.hidden = !(sb && isLead());
  if (el.hidden) return;
  const taken = new Set(S.profiles.map(p => p.memberId).filter(Boolean));
  el.innerHTML = `<div class="panel-head"><div><p class="eyebrow">Akses</p><h2>Akun &amp; peran</h2></div><span class="note">${S.profiles.length} akun terdaftar</span></div>
    <p class="note">Untuk mengundang anggota, bagikan alamat aplikasi ini. Mereka mendaftar dengan email, lalu muncul di sini. Tautkan setiap akun ke profil anggotanya agar notifikasi handover sampai ke orang yang tepat.</p>
    <div class="tablewrap"><table><thead><tr><th>Akun</th><th>Peran</th><th>Profil anggota</th></tr></thead><tbody>
    ${S.profiles.map(p => `<tr><td><b>${esc(p.displayName || "—")}</b>${p.id === S.me.id ? " <span class=\"pill plain\">Anda</span>" : ""}<div class="note">${esc(p.email || "")}</div></td>
      <td><select data-role="${esc(p.id)}" aria-label="Peran ${esc(p.displayName)}"><option value="member" ${p.role === "member" ? "selected" : ""}>Anggota</option><option value="lead" ${p.role === "lead" ? "selected" : ""}>Team Lead</option></select></td>
      <td><select data-link="${esc(p.id)}" aria-label="Profil anggota ${esc(p.displayName)}"><option value="">— belum ditautkan —</option>${S.members.map(m => `<option value="${esc(m.id)}" ${m.id === p.memberId ? "selected" : ""} ${taken.has(m.id) && m.id !== p.memberId ? "disabled" : ""}>${esc(m.name)}</option>`).join("")}</select></td></tr>`).join("")}
    </tbody></table></div>`;
}
async function setRole(id, role) { try { await patch("profiles", id, { role }); toast("Peran diperbarui.", "ok"); } catch { queue("profiles"); } }
async function setLink(id, memberId) { try { await patch("profiles", id, { memberId: memberId || null }); toast("Tautan profil diperbarui.", "ok"); } catch { queue("profiles"); } }
function renderCfg() {
  const c = S.cfg, ed = isLead() && canWrite(), dis = ed ? "" : "disabled";
  $("#tim-cfg").innerHTML = `
    <div class="panel-head"><div><p class="eyebrow">Aturan sistem</p><h2>Ambang &amp; rumus pembobotan</h2></div>${ed ? "" : `<span class="note">Hanya Team Lead yang dapat mengubah</span>`}</div>
    <form id="cfg-form" style="display:flex;flex-direction:column;gap:16px">
      <div class="grid3">
        <label class="field"><span>Ambang kuning (%)</span><input type="number" id="c-yellow" min="10" max="150" value="${c.yellow}" ${dis}></label>
        <label class="field"><span>Ambang merah (%)</span><input type="number" id="c-red" min="20" max="200" value="${c.red}" ${dis}><small>Di atas nilai ini, PIC memicu handover.</small></label>
        <label class="field"><span>Beban siaga backup (%)</span><input type="number" id="c-bf" min="0" max="100" value="${Math.round(c.backupFactor * 100)}" ${dis}></label>
        <label class="field"><span>Koefisien kompleksitas</span><input type="number" id="c-k" step="0.05" min="0" max="2" value="${c.kCoef}" ${dis}><small>Faktor = 1 + koef × (K − 1)</small></label>
        <label class="field"><span>Koefisien urgensi</span><input type="number" id="c-u" step="0.05" min="0" max="2" value="${c.uCoef}" ${dis}><small>Faktor = 1 + koef × (U − 1)</small></label>
      </div>
      <div class="field"><span>Kapasitas bawaan per level (poin)</span>
        <div class="grid3" style="grid-template-columns:repeat(4,minmax(0,1fr))">${LEVELS.map(l => `<label class="field"><small>${l}</small><input type="number" id="c-cap-${l}" min="10" max="1000" value="${c.caps[l]}" ${dis}></label>`).join("")}</div>
      </div>
      <label class="field"><span>Hari libur tim (tidak dihitung sebagai hari kerja)</span><textarea id="c-hol" rows="2" placeholder="2026-12-25, 2027-01-01" ${dis}>${esc((c.holidays || []).join(", "))}</textarea><small>Format TTTT-BB-HH, pisahkan dengan koma.</small></label>
      <p class="note">Rumus: <span class="mono">Bobot = Jam × (1 + ${c.kCoef}·(K−1)) × (1 + ${c.uCoef}·(U−1))</span>. Urgensi otomatis: tenggat ≤1 hari = 5, ≤3 = 4, ≤7 = 3, ≤14 = 2, lebih lama = 1.</p>
      ${ed ? `<div class="row"><button class="btn primary" type="submit">Simpan aturan</button><span class="note">Mengubah kapasitas bawaan tidak mengubah anggota yang sudah ada.</span></div>` : ""}
    </form>`;
}
async function saveCfg() {
  const n = id => +$(id).value;
  const c = { yellow: n("#c-yellow"), red: n("#c-red"), backupFactor: n("#c-bf") / 100, kCoef: n("#c-k"), uCoef: n("#c-u"), caps: Object.fromEntries(LEVELS.map(l => [l, n("#c-cap-" + l)])),
    holidays: [...new Set(($("#c-hol").value.match(/\d{4}-\d{2}-\d{2}/g) || []))].sort() };
  if (!(c.yellow > 0 && c.red > c.yellow)) return toast("Ambang merah harus lebih besar dari ambang kuning.", "crit");
  try { await put("settings", "config", c); log("member", `Aturan diperbarui: kuning ${c.yellow}%, merah ${c.red}%, siaga backup ${Math.round(c.backupFactor * 100)}%.`); toast("Aturan disimpan.", "ok"); } catch {}
}

/* ---------- View: Laporan ---------- */
VIEWS.laporan = {
  mount: () => `
    <header class="page-head">
      <div><p class="eyebrow">Transparansi &amp; akuntabilitas</p><h1>Log &amp; laporan kinerja</h1>
      <p class="lede">Evaluasi berbasis data: poin yang diselesaikan, ketepatan waktu, dan handover. Semua anggota dapat membaca halaman ini.</p></div>
      <div class="row"><div class="seg" id="period">${[[7, "7 hari"], [30, "30 hari"], [90, "90 hari"], [0, "Semua"]].map(([v, l]) => `<button type="button" data-act="period" data-v="${v}" aria-pressed="${S.period === v}">${l}</button>`).join("")}</div><button class="btn" data-act="export">Ekspor CSV</button></div>
    </header>
    <section class="panel"><div class="panel-head"><h2>Evaluasi per anggota</h2><span class="note" id="rep-range"></span></div><div id="rep-table"></div>
      <p class="note">Indeks kinerja = 60% × (poin selesai ÷ poin tertinggi di tim) + 40% × ketepatan waktu. Anggota tanpa tugas selesai pada periode ini tidak diberi indeks.</p></section>
    <section class="panel chart"><div class="panel-head"><h2>Poin selesai vs. tepat waktu</h2><div class="legend"><span><i class="swatch" style="--c:var(--accent)"></i>Poin selesai</span><span><i class="swatch" style="--c:var(--ok)"></i>Poin selesai tepat waktu</span></div></div><div id="rep-chart"></div></section>
    <section class="panel"><div class="panel-head"><h2>Log aktivitas</h2>
      <select id="log-type" style="width:auto" aria-label="Filter jenis log"><option value="">Semua aktivitas</option><option value="task_new">Tugas baru</option><option value="status">Perubahan progres</option><option value="handover">Handover</option><option value="member">Tim &amp; aturan</option></select></div>
      <div class="log" id="log"></div></section>`,
  update() {
    $("#log-type").value = S.logType;
    if (!loaded()) { $("#rep-table").innerHTML = loadingBlock(); return; }
    const rows = evaluate(S.period);
    $("#rep-range").textContent = S.period ? `${fmtDate(ymd(shift(-S.period)))} – ${fmtDate(ymd(new Date()))}` : "Sejak awal";
    $("#rep-table").innerHTML = !rows.length ? emptyTeam() : `<div class="tablewrap"><table>
      <thead><tr><th>Anggota</th><th class="n">Selesai</th><th class="n">Poin selesai</th><th class="n">Tepat waktu</th><th class="n">Rata-rata durasi</th><th class="n">Handover masuk / keluar</th><th class="n">Beban kini</th><th class="n">Indeks</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td><div class="namecell">${avatar(r.m, "sm")}<div><b>${esc(r.m.name)}</b><small>${esc(r.m.level)}</small></div></div></td>
        <td class="n">${r.n}</td><td class="n">${r.pts}</td><td class="n">${r.n ? pctTxt(r.onTime) : "—"}</td><td class="n">${r.n ? r1(r.lead) + " hr" : "—"}</td>
        <td class="n">${r.hoIn} / ${r.hoOut}</td><td class="n"><span class="pill ${LV_PILL[S.loads[r.m.id].level]}">${pctTxt(S.loads[r.m.id].pct)}</span></td><td class="n"><b>${r.idx === null ? "—" : Math.round(r.idx)}</b></td></tr>`).join("")}</tbody></table></div>`;
    $("#rep-chart").innerHTML = rows.length ? chartSvg(rows) : "";
    renderLog();
  }
};
function evaluate(days) {
  const since = days ? Date.now() - days * 864e5 : 0;
  const rows = S.members.map(m => {
    const done = S.tasks.filter(t => t.status === "done" && t.picId === m.id && t.doneAt && Date.parse(t.doneAt) >= since);
    const pts = done.reduce((s, t) => s + (t.weight || 0), 0);
    const ot = done.filter(t => !t.deadline || ymd(new Date(t.doneAt)) <= t.deadline);
    const lead = done.length ? done.reduce((s, t) => s + (Date.parse(t.doneAt) - Date.parse(t.createdAt)) / 864e5, 0) / done.length : 0;
    let hoIn = 0, hoOut = 0;
    for (const t of S.tasks) for (const h of t.handovers || []) { if (Date.parse(h.at) < since) continue; if (h.to === m.id) hoIn++; if (h.from === m.id) hoOut++; }
    return { m, n: done.length, pts, otPts: ot.reduce((s, t) => s + (t.weight || 0), 0), onTime: done.length ? ot.length / done.length * 100 : 0, lead, hoIn, hoOut };
  });
  const max = Math.max(1, ...rows.map(r => r.pts));
  rows.forEach(r => r.idx = r.n ? 60 * r.pts / max + 0.4 * r.onTime : null);
  return rows.sort((a, b) => (b.idx ?? -1) - (a.idx ?? -1));
}
function chartSvg(rows) {
  const W = 720, rowH = 34, top = 24, left = 150, right = 40, H = top + rows.length * rowH + 10;
  const max = Math.max(10, ...rows.map(r => r.pts)); const step = max <= 50 ? 10 : max <= 150 ? 25 : max <= 400 ? 50 : 100;
  const niceMax = Math.ceil(max / step) * step; const x = v => left + v / niceMax * (W - left - right);
  let g = "";
  for (let v = 0; v <= niceMax; v += step) g += `<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="${top - 6}" y2="${H - 6}"/><text x="${x(v)}" y="${top - 10}" text-anchor="middle">${v}</text>`;
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    g += `<text class="lbl" x="${left - 10}" y="${y + 16}" text-anchor="end">${esc(r.m.name.length > 18 ? r.m.name.slice(0, 17) + "…" : r.m.name)}</text>
      <rect class="bar" x="${left}" y="${y + 4}" width="${Math.max(0, x(r.pts) - left)}" height="10" rx="3"/>
      <rect class="bar2" x="${left}" y="${y + 16}" width="${Math.max(0, x(r.otPts) - left)}" height="10" rx="3"/>
      <text x="${x(r.pts) + 6}" y="${y + 13}">${r.pts}</text>`;
  });
  return `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik poin selesai per anggota" style="min-width:520px">${g}</svg></div>`;
}
async function renderLog() {
  const el = $("#log"); if (!el) return;
  const items = S.logs.filter(l => !S.logType || l.type === S.logType).slice(0, 150);
  if (!items.length) { el.innerHTML = `<p class="note">Belum ada aktivitas tercatat.</p>`; return; }
  const prof = id => S.profiles.find(p => p.id === id);
  el.innerHTML = items.map(l => {
    const actor = l.demo ? "Sistem (contoh)" : l.byMember && mem(l.byMember) ? mem(l.byMember).name : l.by ? (prof(l.by)?.displayName || "Pengguna terhapus") : S.mode === "local" ? "Anda" : "Sistem";
    const fm = l.meta && l.meta.fairBefore != null && l.meta.fairAfter != null ? l.meta : null;
    const fd = fm ? fm.fairAfter - fm.fairBefore : 0;
    return `<div class="log-item"><span class="dot ${esc(l.type)}"></span><div><div>${esc(l.text)}</div><div class="actor">oleh ${esc(actor)}${fm ? ` · indeks keadilan ${fm.fairBefore} → ${fm.fairAfter} <b class="delta ${fd > 0 ? "up" : fd < 0 ? "down" : ""}">${fd > 0 ? "+" : ""}${fd}</b>` : ""}</div></div><time datetime="${esc(l.at)}">${esc(fmtTime(l.at))}</time></div>`;
  }).join("");
}
async function exportCsv() {
  const rows = evaluate(S.period);
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [["Anggota", "Level", "Kapasitas", "Tugas selesai", "Poin selesai", "Tepat waktu (%)", "Rata-rata durasi (hari)", "Handover masuk", "Handover keluar", "Beban kini (%)", "Indeks"].map(q).join(",")];
  rows.forEach(r => lines.push([r.m.name, r.m.level, r.m.capacity, r.n, r.pts, Math.round(r.onTime), r1(r.lead), r.hoIn, r.hoOut, Math.round(S.loads[r.m.id].pct), r.idx === null ? "" : Math.round(r.idx)].map(q).join(",")));
  const name = `teamsync-laporan-${S.period ? S.period + "hari" : "semua"}-${ymd(new Date())}.csv`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- View: Kalender kapasitas ---------- */
VIEWS.kalender = {
  mount: () => `
    <header class="page-head">
      <div><p class="eyebrow">Capacity planning</p><h1>Kalender kapasitas</h1>
      <p class="lede">Sisa jam tiap tugas disebar ke hari kerja PIC antara tanggal mulai dan tenggat, lalu dibandingkan dengan jam tersedia: hari kerja dikurangi cuti dan libur, dikali jam per hari, dikurangi tugas rutin.</p></div>
      <div class="seg" role="group" aria-label="Rentang kalender">${[["week", "8 minggu"], ["month", "4 bulan"]].map(([v, l]) => `<button type="button" data-act="plan-mode" data-v="${v}" aria-pressed="${S.planMode === v}">${l}</button>`).join("")}</div>
    </header>
    <section class="panel">
      <div class="panel-head"><h2>Utilisasi jam kerja per ${S.planMode === "month" ? "bulan" : "minggu"}</h2>
        <div class="legend"><span><i class="swatch lv-green"></i>&lt; ${S.cfg.yellow}%</span><span><i class="swatch lv-yellow"></i>${S.cfg.yellow}–${S.cfg.red}%</span><span><i class="swatch lv-red"></i>&gt; ${S.cfg.red}%</span><span>Klik sel untuk rincian</span></div></div>
      <div id="plan-grid"></div>
      <div id="plan-detail"></div>
    </section>
    <section class="panel" id="leave-panel"></section>`,
  update() {
    const g = $("#plan-grid"); if (!g) return;
    if (!loaded()) { g.innerHTML = loadingBlock(); return; }
    if (!S.members.length) { g.innerHTML = emptyTeam(); $("#plan-detail").innerHTML = ""; renderLeavePanel(); return; }
    const pers = P.periods(todayStr(), S.planMode, S.planMode === "month" ? 4 : 8);
    const grid = P.planGrid(S.ctx, pers);
    const ms = [...S.members].sort((a, b) => a.name.localeCompare(b.name));
    const sel = S.planSel;
    g.innerHTML = `<div class="tablewrap heat"><table>
      <thead><tr><th>Anggota</th>${pers.map((p, i) => `<th class="c">${esc(p.label)}${i === 0 ? `<small>${S.planMode === "month" ? "bulan ini" : "minggu ini"}</small>` : ""}</th>`).join("")}</tr></thead>
      <tbody>${ms.map(m => `<tr><td><div class="namecell">${avatar(m, "sm")}<div><b>${esc(m.name)}</b><small>${r1(+m.hoursPerDay || 7)} j/hari${+m.routineHours ? ` · rutin ${r1(+m.routineHours)} j/mgg` : ""}</small></div></div></td>
        ${grid[m.id].map((u, i) => { const lv = u.hours ? P.level(S.cfg, u.pct) : "none"; const on = sel && sel.m === m.id && sel.i === i;
          return `<td class="cell"><button type="button" class="h-${lv}" data-act="plan-cell" data-m="${esc(m.id)}" data-i="${i}" aria-pressed="${on}" title="${esc(m.name)}, ${esc(pers[i].label)}: ${r1(u.demand)} dari ${r1(u.hours)} jam">${u.hours ? pctTxt(Math.min(u.pct, 999)) : u.leave ? "Cuti" : "—"}${u.leave && u.hours ? `<small>cuti ${u.leave} hr</small>` : ""}</button></td>`; }).join("")}</tr>`).join("")}</tbody>
      <tfoot><tr><td><b>Indeks keadilan</b><small class="note"> per periode</small></td>${pers.map((p, i) => { const f = P.fairness(ms.map(m => grid[m.id][i]).filter(u => u.hours > 0).map(u => u.pct)); return `<td class="c num">${f ? f.index : "—"}</td>`; }).join("")}</tr></tfoot>
    </table></div>`;
    const d = $("#plan-detail");
    if (!sel || !mem(sel.m) || !pers[sel.i]) { d.innerHTML = `<p class="note">Pilih sel untuk melihat tugas yang mengisi periode tersebut.</p>`; }
    else {
      const m = mem(sel.m), p = pers[sel.i], u = grid[m.id][sel.i];
      const rows = S.tasks.filter(t => t.status !== "done" && (t.picId === m.id || t.backupId === m.id)).map(t => {
        const { days, per } = P.taskDaily(S.ctx, t); const n = days.filter(x => x >= p.from && x <= p.to).length;
        const pic = t.picId === m.id; return { t, pic, h: n * per * (pic ? 1 : S.cfg.backupFactor) };
      }).filter(x => x.h > 0.05).sort((a, b) => b.h - a.h);
      d.innerHTML = `<div class="plan-detail"><h3>${esc(m.name)} · ${fmtDate(p.from)}–${fmtDate(p.to)}</h3>
        <p class="note mono">Tersedia ${r1(u.hours)} jam = (${u.days} hari kerja − ${u.leave} hari cuti) × ${r1(+m.hoursPerDay || 7)} jam − ${r1(u.routine)} jam rutin · Terisi ${r1(u.demand)} jam (${u.hours ? pctTxt(u.pct) : "—"})</p>
        ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>Tugas</th><th>Peran</th><th class="n">Jam di periode ini</th><th>Tenggat</th></tr></thead><tbody>${rows.map(x => `<tr><td><a href="#kalender" data-act="open-task" data-id="${esc(x.t.id)}">${esc(x.t.title)}</a></td><td>${x.pic ? "PIC" : `Backup (siaga ${Math.round(S.cfg.backupFactor * 100)}%)`}</td><td class="n">${r1(x.h)}</td><td>${fmtDate(x.t.deadline)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Tidak ada tugas yang jatuh di periode ini.</p>`}</div>`;
    }
    renderLeavePanel();
  }
};
function renderLeavePanel() {
  const el = $("#leave-panel"); if (!el) return;
  const me = myMemberId(), lead = isLead() && canWrite();
  const opts = lead ? S.members : S.members.filter(m => m.id === me);
  const today = todayStr();
  const list = S.leaves.filter(l => l.endDate >= today && mem(l.memberId)).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const formFocused = el.contains(document.activeElement) && document.activeElement.closest("#leave-form");
  const hol = new Set(S.cfg.holidays || []);
  const listHtml = list.length ? `<div class="tablewrap"><table><thead><tr><th>Anggota</th><th>Tanggal</th><th>Jenis</th><th class="n">Hari kerja</th><th>Dampak</th><th></th></tr></thead><tbody>${list.map(l => {
      const hit = S.tasks.filter(t => t.picId === l.memberId && (() => { const b = P.picBlock(S.ctx, t); return b && b.from <= l.endDate && b.to >= l.startDate; })()).length;
      const canDel = canWrite() && (lead || l.memberId === me);
      return `<tr><td><div class="namecell">${avatar(mem(l.memberId), "sm")}<b>${esc(nm(l.memberId))}</b></div></td><td>${fmtDate(l.startDate)} – ${fmtDate(l.endDate)}${l.startDate <= today ? ` <span class="pill crit">berlangsung</span>` : ""}</td><td>${esc(l.type)}${l.note ? `<small class="note"> · ${esc(l.note)}</small>` : ""}</td><td class="n">${P.workdays(l.startDate, l.endDate, hol).length}</td><td>${hit ? `<span class="pill warn">${hit} tugas perlu handover</span>` : `<span class="note">aman</span>`}</td><td>${canDel ? `<button class="btn sm danger" data-act="del-leave" data-id="${esc(l.id)}">Hapus</button>` : ""}</td></tr>`;
    }).join("")}</tbody></table></div>` : `<p class="note">Belum ada cuti terjadwal.</p>`;
  if (formFocused) { const L = $("#leave-list"); if (L) L.innerHTML = listHtml; return; }
  el.innerHTML = `<div class="panel-head"><div><p class="eyebrow">Ketersediaan</p><h2>Jadwal cuti, sakit &amp; izin</h2></div><span class="note">Mengurangi jam tersedia dan memicu peringatan handover</span></div>
    ${canWrite() && opts.length ? `<form id="leave-form" class="leave-form" novalidate>
      <label class="field"><span>Anggota</span><select id="l-member">${opts.map(m => `<option value="${esc(m.id)}" ${m.id === me ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Mulai</span><input type="date" id="l-start" value="${today}"></label>
      <label class="field"><span>Sampai</span><input type="date" id="l-end" value="${today}"></label>
      <label class="field"><span>Jenis</span><select id="l-type">${["Cuti", "Sakit", "Izin"].map(x => `<option>${x}</option>`).join("")}</select></label>
      <label class="field"><span>Keterangan</span><input type="text" id="l-note" maxlength="120" placeholder="opsional"></label>
      <button class="btn primary" type="submit">Jadwalkan</button>
    </form>` : `<p class="note">${canWrite() ? "Pilih profil Anda di “Saya adalah” untuk mengajukan cuti sendiri." : ""}</p>`}
    <div id="leave-list">${listHtml}</div>`;
}
async function saveLeave() {
  const memberId = $("#l-member").value, startDate = $("#l-start").value, endDate = $("#l-end").value || startDate, type = $("#l-type").value, note = $("#l-note").value.trim();
  if (!memberId || !startDate) return toast("Pilih anggota dan tanggal mulai.", "crit");
  if (endDate < startDate) return toast("Tanggal selesai harus sama atau setelah tanggal mulai.", "crit");
  const st = JSON.parse(JSON.stringify({ members: S.members, tasks: S.tasks, leaves: S.leaves }));
  st.leaves.push({ memberId, startDate, endDate, type });
  const c2 = ctxFrom(st);
  const hit = S.tasks.filter(t => t.picId === memberId && P.picBlock(c2, t) && !P.picBlock(S.ctx, t)).length;
  try {
    await put("leaves", newId("l"), { memberId, startDate, endDate, type, note, createdAt: new Date().toISOString() });
    log("member", `${type} dijadwalkan: ${nm(memberId)} ${fmtDate(startDate)}–${fmtDate(endDate)}${note ? ` (${note})` : ""}.`);
    toast(hit ? `${type} ${nm(memberId)} tersimpan. ${hit} tugas perlu disiapkan handover; lihat Dashboard.` : `${type} ${nm(memberId)} tersimpan.`, hit ? "crit" : "ok");
    $("#l-note").value = "";
  } catch {}
}
async function deleteLeave(btn) {
  if (!btn.classList.contains("armed")) { btn.classList.add("armed"); btn.textContent = "Yakin?"; return; }
  const l = S.leaves.find(x => x.id === btn.dataset.id);
  try { await del("leaves", btn.dataset.id); if (l) log("member", `Jadwal ${l.type.toLowerCase()} ${nm(l.memberId)} ${fmtDate(l.startDate)}–${fmtDate(l.endDate)} dihapus.`); } catch {}
}

/* ---------- View: Simulasi what-if ---------- */
VIEWS.simulasi = {
  mount: () => `
    <header class="page-head">
      <div><p class="eyebrow">What-if scenario</p><h1>Simulasi skenario</h1>
      <p class="lede">Uji dampak cuti, tugas baru, atau tenggat yang dimajukan. Sistem menyusun alokasi yang disarankan dan membandingkannya dengan kondisi sekarang, tanpa mengubah data sebenarnya.</p></div>
    </header>
    <section class="panel">
      <div class="panel-head"><h2>Kejadian dalam skenario</h2>
        <div class="row"><button class="btn sm" data-act="sim-add" data-v="leave">+ Pegawai cuti</button><button class="btn sm" data-act="sim-add" data-v="task">+ Tugas baru</button><button class="btn sm" data-act="sim-add" data-v="deadline">+ Tenggat dimajukan</button></div></div>
      <div id="sim-events" class="sim-events"></div>
      <div class="row sim-run">
        <label class="switch"><input type="checkbox" id="sim-opt" ${S.sim.optimize ? "checked" : ""}> Sertakan redistribusi otomatis agar beban lebih merata</label>
        <span style="flex:1"></span>
        <button class="btn" data-act="sim-reset">Kosongkan</button>
        <button class="btn primary" data-act="sim-run">Jalankan simulasi</button>
      </div>
    </section>
    <section id="sim-result"></section>`,
  update() {
    const ev = $("#sim-events"); if (!ev) return;
    if (!ev.contains(document.activeElement)) renderSimEvents();
    renderSimResult();
  }
};
function simAdd(type) {
  const today = todayStr();
  const firstM = (S.members.find(m => !absentNow(m)) || S.members[0])?.id || "";
  const act = S.tasks.filter(t => t.status !== "done" && t.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const ev = type === "leave" ? { type, memberId: firstM, start: today, days: 7, leaveType: "Cuti" }
    : type === "task" ? { type, title: "Tugas baru", count: 3, complexity: 3, hours: 8, deadlineDays: 7, skills: "" }
    : { type, taskId: act[0]?.id || "", days: 3 };
  S.sim.events.push(ev); S.sim.dirty = true;
  renderSimEvents(); renderSimResult();
}
function simField(t) {
  const ev = S.sim.events[+t.dataset.ev]; if (!ev) return;
  ev[t.dataset.k] = t.type === "number" ? +t.value : t.value;
  S.sim.dirty = true; renderSimResult();
}
function renderSimEvents() {
  const el = $("#sim-events"); if (!el) return;
  if (!S.sim.events.length) { el.innerHTML = `<p class="note">Belum ada kejadian. Tambahkan dari tombol di atas, atau langsung jalankan simulasi untuk mencari redistribusi yang lebih adil.</p>`; return; }
  const mOpts = sel => S.members.map(m => `<option value="${esc(m.id)}" ${m.id === sel ? "selected" : ""}>${esc(m.name)}</option>`).join("");
  const tOpts = sel => S.tasks.filter(t => t.status !== "done" && t.deadline).map(t => `<option value="${esc(t.id)}" ${t.id === sel ? "selected" : ""}>${esc(t.title)} (${fmtDate(t.deadline)})</option>`).join("");
  el.innerHTML = S.sim.events.map((e, i) => {
    const a = k => `data-ev="${i}" data-k="${k}"`;
    let body = "";
    if (e.type === "leave") body = `<span class="ev-tag">Cuti</span>
      <label class="field"><span>Anggota</span><select ${a("memberId")}>${mOpts(e.memberId)}</select></label>
      <label class="field"><span>Mulai</span><input type="date" ${a("start")} value="${esc(e.start)}"></label>
      <label class="field"><span>Lama (hari)</span><input type="number" min="1" max="60" ${a("days")} value="${e.days}"></label>
      <label class="field"><span>Jenis</span><select ${a("leaveType")}>${["Cuti", "Sakit", "Izin"].map(x => `<option ${x === e.leaveType ? "selected" : ""}>${x}</option>`).join("")}</select></label>`;
    else if (e.type === "task") body = `<span class="ev-tag">Tugas baru</span>
      <label class="field"><span>Judul</span><input type="text" maxlength="80" ${a("title")} value="${esc(e.title)}"></label>
      <label class="field"><span>Jumlah</span><input type="number" min="1" max="20" ${a("count")} value="${e.count}"></label>
      <label class="field"><span>Kompleksitas</span><select ${a("complexity")}>${[1, 2, 3, 4, 5].map(k => `<option value="${k}" ${+e.complexity === k ? "selected" : ""}>${k} · ${KLAB[k]}</option>`).join("")}</select></label>
      <label class="field"><span>Jam per tugas</span><input type="number" min="0.5" max="200" step="0.5" ${a("hours")} value="${e.hours}"></label>
      <label class="field"><span>Tenggat (hari lagi)</span><input type="number" min="0" max="180" ${a("deadlineDays")} value="${e.deadlineDays}"></label>
      <label class="field"><span>Skill</span><input type="text" maxlength="80" ${a("skills")} value="${esc(e.skills)}" placeholder="mis. QA"></label>`;
    else body = `<span class="ev-tag">Tenggat maju</span>
      <label class="field wide"><span>Tugas</span><select ${a("taskId")}>${tOpts(e.taskId)}</select></label>
      <label class="field"><span>Dimajukan (hari)</span><input type="number" min="1" max="60" ${a("days")} value="${e.days}"></label>`;
    return `<div class="sim-ev">${body}<button class="btn sm ghost" data-act="sim-del" data-i="${i}" aria-label="Hapus kejadian">Hapus</button></div>`;
  }).join("");
}
function runSim() {
  if (!S.members.length) return toast("Tambahkan anggota tim terlebih dahulu.", "crit");
  S.sim.result = P.simulate({ members: S.members, tasks: S.tasks, leaves: S.leaves, cfg: S.cfg, today: todayStr() }, { events: S.sim.events, optimize: S.sim.optimize }, { weightOf, urgencyFromDeadline });
  S.sim.dirty = false;
  if (S.route === "simulasi") { VIEWS.simulasi.update(); $("#sim-result")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
}
function renderSimResult() {
  const el = $("#sim-result"); if (!el) return;
  const r = S.sim.result;
  if (!r) { el.innerHTML = `<div class="empty"><h2>Belum ada hasil</h2><p>Hasil simulasi muncul di sini: perbandingan indeks keadilan, beban per anggota, dan daftar perubahan alokasi yang disarankan.</p></div>`; return; }
  const b = r.before, a = r.after;
  const card = (label, x, y, better, fx = v => v, sub = "") => { const d = y - x; const good = better === "up" ? d > 0 : d < 0; return `<div class="kpi"><span class="k-label">${label}</span><span class="k-val">${fx(x)} → ${fx(y)}</span><span class="k-sub"><b class="delta ${d === 0 ? "" : good ? "up" : "down"}">${d === 0 ? "tetap" : (d > 0 ? "+" : "") + fx(d)}</b>${sub}</span></div>`; };
  const nmS = id => (r.state.members.find(m => m.id === id) || {}).name || "—";
  const kinds = { assign: "Penugasan baru", reassign: "Pengalihan", rebalance: "Redistribusi", deadline: "Tenggat" };
  const changes = r.changes.map(c => `<li class="chg ${c.kind}"><span class="pill plain">${kinds[c.kind]}</span><div><b>${esc(c.title)}</b>${
      c.kind === "deadline" ? ` · tenggat ${fmtDate(c.from)} → ${fmtDate(c.to)}, bobot ${c.weightFrom} → ${c.weightTo} poin`
      : c.kind === "assign" ? ` (${c.weight} poin) → PIC <b>${esc(nmS(c.to))}</b>, backup ${esc(nmS(c.backupTo))}`
      : ` · PIC ${esc(nmS(c.from))} → <b>${esc(nmS(c.to))}</b>${c.backupTo !== c.backupFrom ? `, backup ${esc(nmS(c.backupTo))}` : ""}`}
      ${c.reason ? `<small>${esc(c.reason)}</small>` : ""}</div></li>`).join("");
  const rows = r.state.members.map(m => {
    const x = b.per[m.id], y = a.per[m.id]; const d = y.pct - x.pct;
    return `<tr><td><div class="namecell">${avatar(m, "sm")}<b>${esc(m.name)}</b></div></td>
      <td class="cmp"><div class="cmpbar"><i class="lv-${x.level}" style="width:${Math.min(x.pct, 150) / 1.5}%"></i></div><div class="cmpbar after"><i class="lv-${y.level}" style="width:${Math.min(y.pct, 150) / 1.5}%"></i></div></td>
      <td class="n">${pctTxt(x.pct)} → <b>${pctTxt(y.pct)}</b> <span class="delta ${Math.abs(d) < 0.5 ? "" : d < 0 ? "up" : "down"}">${Math.abs(d) < 0.5 ? "" : (d > 0 ? "+" : "") + Math.round(d)}</span></td>
      ${y.weeks.map((v, i) => `<td class="cell"><span class="h-${v >= 999 ? "none" : P.level(S.cfg, v)}" title="Sebelum: ${x.weeks[i] >= 999 ? "cuti" : pctTxt(x.weeks[i])}">${v >= 999 ? "cuti" : pctTxt(v)}</span></td>`).join("")}</tr>`;
  }).join("");
  el.innerHTML = `${S.sim.dirty ? `<div class="banner warn">Skenario sudah berubah sejak simulasi terakhir. Klik <b>Jalankan simulasi</b> untuk memperbarui hasil.</div>` : ""}
    <div class="panel">
      <div class="panel-head"><div><p class="eyebrow">Hasil simulasi · data asli belum berubah</p><h2>Sebelum vs. sesudah</h2></div>
        ${isLead() && canWrite() && r.changes.length ? `<button class="btn primary" data-act="sim-apply">Terapkan ${r.changes.length} perubahan ke data</button>` : ""}</div>
      <div class="kpis">
        ${card("Indeks keadilan", b.fair.index, a.fair.index, "up")}
        ${card("Ketimpangan (Gini)", +b.fair.gini.toFixed(2), +a.fair.gini.toFixed(2), "down", v => (+v).toFixed(2))}
        ${card("Anggota overload", b.overload, a.overload, "down")}
        ${card("Minggu-anggota > " + S.cfg.red + "%", b.overloadWeeks, a.overloadWeeks, "down", v => v, " · 4 minggu")}
        ${card("Tugas terhalang cuti", b.blocked, a.blocked, "down")}
      </div>
      ${r.warnings.length ? `<div class="banner warn"><div><b>Perlu perhatian:</b><ul class="warn-list">${r.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul></div></div>` : ""}
      <div class="tablewrap"><table class="simtable"><thead><tr><th>Anggota</th><th style="min-width:140px">Beban poin (atas: sekarang, bawah: skenario)</th><th class="n">Utilisasi</th>${r.periods.map(p => `<th class="c">Jam ${esc(p.label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="field"><span>Perubahan alokasi yang disarankan (${r.changes.length})</span>${r.changes.length ? `<ul class="chg-list">${changes}</ul>` : `<p class="note">Tidak ada perubahan yang disarankan; alokasi sekarang sudah paling sesuai untuk skenario ini.</p>`}</div>
    </div>`;
}
async function applySim(btn) {
  const r = S.sim.result; if (!r) return;
  if (!btn.classList.contains("armed")) { btn.classList.add("armed"); btn.textContent = `Klik lagi untuk menerapkan ${r.changes.length} perubahan`; return; }
  btn.disabled = true;
  const now = new Date().toISOString(), final = id => r.state.tasks.find(x => x.id === id);
  try {
    for (const l of r.newLeaves) await put("leaves", newId("l"), { memberId: l.memberId, startDate: l.startDate, endDate: l.endDate, type: l.type, note: "Dari simulasi", createdAt: now });
    for (const t of r.newTasks) { const f = final(t.id); await put("tasks", newId("t"), { title: f.title, desc: "", complexity: f.complexity, urgency: f.urgency, urgencyMode: "auto", hours: f.hours, startDate: f.startDate, deadline: f.deadline, skills: f.skills, weight: f.weight, picId: f.picId, backupId: f.backupId, status: "todo", createdAt: now, doneAt: null, createdBy: S.me.id || null, handovers: [], autoPicked: true }); }
    const touched = [...new Set(r.changes.filter(c => !c.sim && c.taskId).map(c => c.taskId))];
    for (const id of touched) {
      const f = final(id), o = S.tasks.find(x => x.id === id); if (!f || !o) continue;
      const p = {};
      if (f.deadline !== o.deadline) { p.deadline = f.deadline; p.urgency = f.urgency; p.weight = f.weight; }
      if (f.picId !== o.picId) { p.picId = f.picId; p.handovers = [...(o.handovers || []), { from: o.picId, to: f.picId, at: now, reason: r.changes.filter(c => c.taskId === id && c.reason).map(c => c.reason).pop() || "hasil simulasi", by: S.me.id || null }]; }
      if ((f.backupId || null) !== (o.backupId || null)) p.backupId = f.backupId || null;
      if (Object.keys(p).length) await patch("tasks", id, p);
    }
    const cnt = k => r.changes.filter(c => c.kind === k).length;
    log("handover", `Hasil simulasi diterapkan: ${cnt("assign")} tugas baru, ${cnt("reassign") + cnt("rebalance")} pengalihan, ${cnt("deadline")} perubahan tenggat, ${r.newLeaves.length} jadwal cuti.`, { meta: { fairBefore: r.before.fair.index, fairAfter: r.after.fair.index } });
    toast(`Simulasi diterapkan. Indeks keadilan ${r.before.fair.index} → ${r.after.fair.index}.`, "ok");
    S.sim = { events: [], optimize: true, result: null, dirty: false };
    location.hash = "#dashboard";
  } catch { btn.disabled = false; }
}

/* ---------- Modal ---------- */
function openModal(html) { const m = $("#modal"); m.innerHTML = `<div class="modal-bg" data-act="modal-bg"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`; m.hidden = false; setTimeout(() => m.querySelector("input,select,button:not(.ghost)")?.focus(), 30); }
function closeModal() { $("#modal").hidden = true; $("#modal").innerHTML = ""; }
function memberModal(id) {
  const m = id ? mem(id) : { name: "", level: "Junior", capacity: S.cfg.caps.Junior, status: "Aktif", skills: "" };
  const L = id ? S.loads[id] : null;
  openModal(`<div class="modal-head"><div><p class="eyebrow">${id ? "Ubah profil" : "Anggota baru"}</p><h2>${id ? esc(m.name) : "Tambah anggota tim"}</h2></div><button class="btn ghost sm" data-act="close-modal" aria-label="Tutup">Tutup</button></div>
    <form id="member-form" data-id="${esc(id || "")}" style="display:flex;flex-direction:column;gap:14px">
      <label class="field"><span>Nama</span><input type="text" id="m-name" value="${esc(m.name)}" maxlength="60" required></label>
      <div class="grid2">
        <label class="field"><span>Level pengalaman</span><select id="m-level">${LEVELS.map(l => `<option ${l === m.level ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="field"><span>Kapasitas maksimal (poin)</span><input type="number" id="m-cap" min="10" max="1000" value="${m.capacity}"><small>Bawaan level: ${LEVELS.map(l => l + " " + S.cfg.caps[l]).join(", ")}</small></label>
        <label class="field"><span>Status</span><select id="m-status">${STATUSES.map(s => `<option ${s === m.status ? "selected" : ""}>${s}</option>`).join("")}</select>${L && L.picN ? `<small>Status selain Aktif memicu handover untuk ${L.picN} tugas PIC.</small>` : ""}</label>
        <label class="field"><span>Keahlian</span><input type="text" id="m-skills" value="${esc(m.skills || "")}" maxlength="80" placeholder="mis. Backend, QA"><small>Pisahkan dengan koma. Dipakai untuk mencocokkan tugas.</small></label>
        <label class="field"><span>Jam kerja efektif per hari</span><input type="number" id="m-hpd" min="1" max="12" step="0.5" value="${+m.hoursPerDay || 7}"></label>
        <label class="field"><span>Tugas rutin (jam per minggu)</span><input type="number" id="m-rout" min="0" max="60" step="0.5" value="${+m.routineHours || 0}"><small>Rapat, dukungan, laporan rutin, dll.</small></label>
      </div>
      <label class="field"><span>Keterangan tugas rutin</span><input type="text" id="m-routn" value="${esc(m.routineNote || "")}" maxlength="120" placeholder="mis. Rapat mingguan, piket helpdesk"></label>
      ${id ? `<p class="note">Jadwal cuti diatur di halaman <a href="#kalender" data-act="close-modal">Kalender kapasitas</a>.</p>` : ""}
      <p class="error-text" id="m-err"></p>
      <div class="modal-foot">${id ? `<button type="button" class="btn danger" data-act="del-member" data-id="${esc(id)}">Hapus anggota</button>` : "<span></span>"}<div class="row"><button type="button" class="btn" data-act="close-modal">Batal</button><button class="btn primary" type="submit">Simpan</button></div></div>
    </form>`);
}
async function saveMember(form) {
  const id = form.dataset.id; const old = id ? mem(id) : null;
  const data = { name: $("#m-name").value.trim(), level: $("#m-level").value, capacity: +$("#m-cap").value, status: $("#m-status").value, skills: P.skillList($("#m-skills").value).join(", "), hoursPerDay: +$("#m-hpd").value || 7, routineHours: +$("#m-rout").value || 0, routineNote: $("#m-routn").value.trim() };
  if (!(data.hoursPerDay >= 1 && data.hoursPerDay <= 12)) return $("#m-err").textContent = "Jam kerja per hari antara 1 dan 12.";
  if (!(data.routineHours >= 0 && data.routineHours <= 60)) return $("#m-err").textContent = "Tugas rutin antara 0 dan 60 jam per minggu.";
  if (!data.name) return $("#m-err").textContent = "Isi nama anggota.";
  if (!(data.capacity >= 10)) return $("#m-err").textContent = "Kapasitas minimal 10 poin.";
  const nid = id || newId("m");
  try {
    if (old) await patch("members", nid, data); else await put("members", nid, { createdAt: new Date().toISOString(), ...data });
    closeModal();
    if (!old) log("member", `${data.name} bergabung sebagai ${data.level} dengan kapasitas ${data.capacity} poin.`);
    else {
      if (old.status !== data.status) {
        log("member", `Status ${data.name} berubah: ${old.status} → ${data.status}.`);
        const n = S.tasks.filter(t => t.status !== "done" && t.picId === nid).length;
        if (data.status !== "Aktif" && n) toast(`${data.name} ${data.status}: ${n} tugas perlu handover ke backup.`, "crit");
      }
      if (old.capacity !== data.capacity) log("member", `Kapasitas ${data.name} diubah: ${old.capacity} → ${data.capacity} poin.`);
    }
    toast(old ? "Profil disimpan." : `${data.name} ditambahkan.`, "ok");
  } catch {}
}
async function deleteMember(btn) {
  if (!btn.classList.contains("armed")) { btn.classList.add("armed"); const n = S.tasks.filter(t => t.status !== "done" && (t.picId === btn.dataset.id || t.backupId === btn.dataset.id)).length; btn.textContent = n ? `Yakin? ${n} tugas aktif kehilangan penanggung jawab` : "Klik lagi untuk menghapus"; return; }
  const m = mem(btn.dataset.id); try { await del("members", btn.dataset.id); closeModal(); log("member", `${m?.name || "Anggota"} dihapus dari tim.`); } catch {}
}
function taskModal(id) {
  const t = S.tasks.find(x => x.id === id); if (!t) return;
  const ed = isLead() && canWrite(); const flag = alertTasks().find(x => x.t.id === id);
  const opts = (sel, none) => (none ? `<option value="">— tidak ada —</option>` : "") + S.members.map(m => `<option value="${esc(m.id)}" ${m.id === sel ? "selected" : ""}>${esc(m.name)} (${pctTxt(S.loads[m.id].pct)}${m.status !== "Aktif" ? ", " + esc(m.status) : ""})</option>`).join("");
  const [dl, dc] = dueLabel(t.deadline);
  openModal(`<div class="modal-head"><div><p class="eyebrow">Tiket tugas · ${TLABEL[t.status]}</p><h2>${esc(t.title)}</h2></div><button class="btn ghost sm" data-act="close-modal">Tutup</button></div>
    ${t.desc ? `<p>${esc(t.desc)}</p>` : ""}
    <dl class="kv">
      <div><dt>Bobot</dt><dd class="num">${t.weight} poin</dd></div>
      <div><dt>Kompleksitas</dt><dd>${t.complexity} · ${KLAB[t.complexity]}</dd></div>
      <div><dt>Urgensi</dt><dd>${t.urgency} · ${ULAB[t.urgency]}</dd></div>
      <div><dt>Estimasi</dt><dd class="num">${t.hours} jam</dd></div>
      <div><dt>Tenggat</dt><dd>${fmtDate(t.deadline)} ${t.status !== "done" ? `<span class="due ${dc}" style="font-size:.76rem">${dl}</span>` : ""}</dd></div>
      <div><dt>Mulai</dt><dd>${fmtDate(t.startDate || t.createdAt)}</dd></div>
    </dl>
    ${(t.skills || []).length ? `<div class="chips">${t.skills.map(x => { const ok = !P.skillMatch([x], mem(t.picId)?.skills).missing.length; return `<span class="skill ${ok ? "ok" : "miss"}" title="${ok ? "dimiliki PIC" : "tidak dimiliki PIC"}">${esc(x)}</span>`; }).join("")}</div>` : ""}
    ${flag ? `<div class="alert">${handoverRow(t, flag.reasons)}</div>` : ""}
    <form id="task-form" data-id="${esc(t.id)}" style="display:flex;flex-direction:column;gap:14px">
      <div class="grid3">
        <label class="field"><span>Status</span><select id="t-status" ${canProgress(t) ? "" : "disabled"}>${TSTAT.map(([k, l]) => `<option value="${k}" ${t.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="field"><span>PIC</span><select id="t-pic" ${ed ? "" : "disabled"}>${opts(t.picId)}</select></label>
        <label class="field"><span>Backup</span><select id="t-bak" ${ed ? "" : "disabled"}>${opts(t.backupId, true)}</select></label>
      </div>
      ${ed ? `<div class="grid3"><label class="field"><span>Mulai</span><input type="date" id="t-start" value="${esc(t.startDate || "")}"></label><label class="field"><span>Tenggat</span><input type="date" id="t-deadline" value="${esc(t.deadline || "")}"></label><label class="field"><span>Skill dibutuhkan</span><input type="text" id="t-skills" value="${esc((t.skills || []).join(", "))}" maxlength="120"></label></div>` : ""}
      ${(t.handovers || []).length ? `<div class="field"><span>Riwayat handover</span>${t.handovers.map(h => `<div class="note">${fmtTime(h.at)} · ${esc(nm(h.from))} → ${esc(nm(h.to))} (${esc(h.reason)})</div>`).join("")}</div>` : ""}
      <p class="error-text" id="t-err"></p>
      <div class="modal-foot">${ed ? `<button type="button" class="btn danger" data-act="del-task" data-id="${esc(t.id)}">Hapus tugas</button>` : "<span></span>"}<div class="row"><button type="button" class="btn" data-act="close-modal">Tutup</button>${canProgress(t) ? `<button class="btn primary" type="submit">Simpan</button>` : ""}</div></div>
    </form>`);
}
async function saveTask(form) {
  const t = S.tasks.find(x => x.id === form.dataset.id); if (!t) return closeModal();
  const p = {}; const st = $("#t-status").value;
  if (isLead()) {
    const pic = $("#t-pic").value, bak = $("#t-bak").value || null, dl = $("#t-deadline")?.value || t.deadline;
    if (pic === bak) return $("#t-err").textContent = "PIC dan Backup harus orang yang berbeda.";
    if (pic !== t.picId) p.picId = pic; if (bak !== (t.backupId || null)) p.backupId = bak;
    if (dl !== t.deadline) { p.deadline = dl; if (t.urgencyMode !== "manual") { p.urgency = urgencyFromDeadline(dl); p.weight = weightOf(t.complexity, p.urgency, t.hours); } }
    const sd = $("#t-start")?.value || null; if (sd !== (t.startDate || null)) p.startDate = sd;
    if (sd && dl && sd > dl) return $("#t-err").textContent = "Tanggal mulai harus sebelum tenggat.";
    const sk = P.skillList($("#t-skills")?.value || ""); if (sk.join("|") !== (t.skills || []).join("|")) p.skills = sk;
  }
  if (st !== t.status) { p.status = st; p.doneAt = st === "done" ? new Date().toISOString() : null; }
  if (!Object.keys(p).length) return closeModal();
  const meta = ("picId" in p || "backupId" in p) ? fairMeta(fairAfter(st => Object.assign(st.tasks.find(x => x.id === t.id), p))) : null;
  try {
    await patch("tasks", t.id, p); closeModal();
    if (p.status) log("status", `"${t.title}" dipindahkan dari ${TLABEL[t.status]} ke ${TLABEL[p.status]}.`, { taskId: t.id });
    if ("picId" in p || "backupId" in p) log("handover", `Penetapan ulang "${t.title}": PIC ${nm(p.picId ?? t.picId)}, backup ${nm("backupId" in p ? p.backupId : t.backupId)}.`, { taskId: t.id, meta });
    toast("Tugas diperbarui.", "ok");
  } catch {}
}
async function deleteTask(btn) {
  if (!btn.classList.contains("armed")) { btn.classList.add("armed"); btn.textContent = "Klik lagi untuk menghapus"; return; }
  const t = S.tasks.find(x => x.id === btn.dataset.id); try { await del("tasks", btn.dataset.id); closeModal(); log("status", `Tugas "${t?.title}" dihapus.`); } catch {}
}

/* ---------- Notifikasi ---------- */
function toast(msg, kind = "") {
  const el = document.createElement("div"); el.className = "toast " + kind; el.setAttribute("role", "status");
  el.innerHTML = `<span></span><button class="x" aria-label="Tutup">×</button>`; el.firstChild.textContent = msg;
  el.querySelector(".x").onclick = () => el.remove();
  $("#toasts").appendChild(el); setTimeout(() => el.remove(), kind === "crit" ? 9000 : 5000);
}
function notifyAlerts() {
  if (!loaded()) return;
  const now = new Set(alertTasks().map(x => x.t.id + "|" + x.t.picId));
  if (S.seenAlerts) {
    const fresh = alertTasks().filter(x => !S.seenAlerts.has(x.t.id + "|" + x.t.picId));
    const me = myMemberId();
    if (fresh.length) {
      const mine = fresh.filter(x => x.t.backupId === me);
      if (mine.length) toast(`Anda backup untuk ${mine.length} tugas yang perlu diambil alih: ${mine.map(x => x.t.title).join(", ")}.`, "crit");
      else toast(`Eskalasi: ${fresh.length} tugas perlu handover (${fresh[0].reasons[0]}). Lihat Dashboard.`, "crit");
    }
  }
  S.seenAlerts = now;
}

/* ---------- Event ---------- */
document.addEventListener("click", e => {
  const a = e.target.closest("[data-act]"); if (!a) return;
  if (e.target.closest("select") && a.classList.contains("tcard")) return;
  const id = a.dataset.id;
  switch (a.dataset.act) {
    case "toggle-composer": S.composerOpen = !S.composerOpen; if (S.composerOpen) S.draft ||= newDraft(); VIEWS.tugas.update(); if (S.composerOpen) $("#d-title")?.focus(); break;
    case "pick-pic": S.draft.pic = id; S.draft.picManual = true; if (S.draft.bak === id) { S.draft.bak = null; S.draft.bakManual = false; } updateComposer(); break;
    case "pick-bak": S.draft.bak = id; S.draft.bakManual = true; updateComposer(); break;
    case "open-task": taskModal(id); break;
    case "handover": closeModal(); handover(id); break;
    case "add-member": memberModal(null); break;
    case "open-member": memberModal(id); break;
    case "del-member": deleteMember(a); break;
    case "del-task": deleteTask(a); break;
    case "close-modal": closeModal(); break;
    case "modal-bg": if (e.target === a) closeModal(); break;
    case "load-demo": loadDemo(); break;
    case "clear-demo": clearDemo(); break;
    case "period": S.period = +a.dataset.v; document.querySelectorAll("#period button").forEach(b => b.setAttribute("aria-pressed", b === a)); VIEWS.laporan.update(); break;
    case "export": exportCsv(); break;
    case "toggle-skill": { const cur = P.skillList(S.draft.skills); const k = a.dataset.v.toLowerCase(); const has = cur.some(x => x.toLowerCase() === k); S.draft.skills = (has ? cur.filter(x => x.toLowerCase() !== k) : [...cur, a.dataset.v]).join(", "); $("#d-skills").value = S.draft.skills; updateComposer(); break; }
    case "plan-mode": S.planMode = a.dataset.v; S.planSel = null; setRoute(); break;
    case "plan-cell": S.planSel = { m: a.dataset.m, i: +a.dataset.i }; VIEWS.kalender.update(); break;
    case "del-leave": deleteLeave(a); break;
    case "sim-add": simAdd(a.dataset.v); break;
    case "sim-del": S.sim.events.splice(+a.dataset.i, 1); S.sim.dirty = true; VIEWS.simulasi.update(); break;
    case "sim-run": runSim(); break;
    case "sim-reset": S.sim = { events: [], optimize: true, result: null, dirty: false }; VIEWS.simulasi.update(); break;
    case "sim-apply": applySim(a); break;
    case "sim-optimize": S.sim = { events: [], optimize: true, result: null, dirty: false }; location.hash = "#simulasi"; setTimeout(runSim, 0); break;
    case "logout": sb?.auth.signOut(); break;
    case "auth-view": showAuth(a.dataset.v); break;
  }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("#modal").hidden) closeModal();
  if ((e.key === "Enter" || e.key === " ") && e.target.classList?.contains("tcard")) { e.preventDefault(); taskModal(e.target.dataset.id); }
});
document.addEventListener("input", e => {
  const t = e.target, d = S.draft;
  if (t.id === "d-title") d.title = t.value;
  else if (t.id === "d-desc") d.desc = t.value;
  else if (t.id === "d-hours") { d.hours = t.value; updateComposer(); }
  else if (t.id === "f-q") { S.filters.q = t.value; updateBoard(); }
  else if (t.id === "d-skills") { d.skills = t.value; updateComposer(); }
  else if (t.dataset.ev !== undefined) simField(t);
});
document.addEventListener("change", e => {
  const t = e.target, d = S.draft;
  if (t.name === "d-k") { d.k = +t.value; updateComposer(); }
  else if (t.id === "d-deadline") { d.deadline = t.value; updateComposer(); }
  else if (t.id === "d-start") { d.startDate = t.value; updateComposer(); }
  else if (t.id === "sim-opt") { S.sim.optimize = t.checked; S.sim.dirty = true; VIEWS.simulasi.update(); }
  else if (t.dataset.ev !== undefined) simField(t);
  else if (t.id === "d-umode") { d.uMode = t.value; updateComposer(); }
  else if (t.id === "f-member") { S.filters.member = t.value; updateBoard(); }
  else if (t.id === "f-mine") { S.filters.mine = t.checked; updateBoard(); }
  else if (t.dataset.status) setStatus(t.dataset.status, t.value);
  else if (t.id === "log-type") { S.logType = t.value; renderLog(); }
  else if (t.id === "m-level") { const cap = $("#m-cap"); if (LEVELS.some(l => +cap.value === S.cfg.caps[l])) cap.value = S.cfg.caps[t.value]; }
  else if (t.id === "preview-member") { S.asMember = t.checked; S.composerOpen = false; setRoute(); refresh(); }
  else if (t.id === "claim-sel") claim(t.value);
  else if (t.dataset.role) setRole(t.dataset.role, t.value);
  else if (t.dataset.link !== undefined) setLink(t.dataset.link, t.value);
});
document.addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "composer-form") submitTask();
  else if (f.id === "member-form") saveMember(f);
  else if (f.id === "task-form") saveTask(f);
  else if (f.id === "cfg-form") saveCfg();
  else if (f.id === "auth-form") authSubmit(f);
  else if (f.id === "leave-form") saveLeave();
});
async function claim(memberId) {
  if (S.mode === "local") { S.localClaim = memberId || null; return refresh(); }
  if (!S.me.id) return;
  try { await patch("profiles", S.me.id, { memberId: memberId || null }); toast(memberId ? `Profil Anda: ${nm(memberId)}.` : "Profil dilepas.", "ok"); } catch { queue("profiles"); }
}
window.addEventListener("hashchange", setRoute);

/* ---------- Autentikasi ---------- */
function showAuth(view = "login", msg = "") {
  $(".app").hidden = true; closeModal();
  let el = $("#auth"); if (!el) { el = document.createElement("div"); el.id = "auth"; document.body.appendChild(el); }
  el.hidden = false;
  const email = `<label class="field"><span>Email</span><input type="email" id="a-email" autocomplete="email" required></label>`;
  const pass = (lbl, ac) => `<label class="field"><span>${lbl}</span><input type="password" id="a-pass" minlength="8" autocomplete="${ac}" required><small>Minimal 8 karakter.</small></label>`;
  const V = {
    login: ["Masuk ke TeamSync", email + `<label class="field"><span>Kata sandi</span><input type="password" id="a-pass" autocomplete="current-password" required></label>`, "Masuk",
      `<button type="button" class="btn ghost sm" data-act="auth-view" data-v="signup">Belum punya akun? Daftar</button><button type="button" class="btn ghost sm" data-act="auth-view" data-v="reset">Lupa kata sandi?</button>`],
    signup: ["Buat akun", `<label class="field"><span>Nama</span><input type="text" id="a-name" maxlength="60" autocomplete="name" required></label>` + email + pass("Kata sandi", "new-password") + `<p class="note">Akun pertama yang mendaftar otomatis menjadi Team Lead.</p>`, "Daftar",
      `<button type="button" class="btn ghost sm" data-act="auth-view" data-v="login">Sudah punya akun? Masuk</button>`],
    reset: ["Atur ulang kata sandi", email, "Kirim tautan reset", `<button type="button" class="btn ghost sm" data-act="auth-view" data-v="login">Kembali ke halaman masuk</button>`],
    newpass: ["Kata sandi baru", pass("Kata sandi baru", "new-password"), "Simpan kata sandi", ""]
  };
  const [title, fields, cta, links] = V[view];
  el.innerHTML = `<div class="auth-card">
    <div class="brand">${$(".brand svg").outerHTML}<div>TeamSync<small>Beban kerja yang adil</small></div></div>
    <h1>${title}</h1>
    ${msg ? `<div class="banner">${esc(msg)}</div>` : ""}
    <form id="auth-form" data-view="${view}" novalidate>${fields}<p class="error-text" id="a-err"></p><button class="btn primary" type="submit">${cta}</button></form>
    <div class="auth-links">${links}</div>
  </div>`;
  el.querySelector("input")?.focus();
}
function hideAuth() { const el = $("#auth"); if (el) el.hidden = true; $(".app").hidden = false; }
function authMsg(e) {
  const m = e?.message || "";
  if (/invalid login/i.test(m)) return "Email atau kata sandi salah.";
  if (/not confirmed/i.test(m)) return "Email belum dikonfirmasi. Buka tautan di kotak masuk Anda.";
  if (/already registered/i.test(m)) return "Email ini sudah terdaftar. Silakan masuk.";
  if (/at least|password should/i.test(m)) return "Kata sandi minimal 8 karakter.";
  if (/email rate limit/i.test(m)) return "Batas pengiriman email konfirmasi tercapai. Coba lagi sekitar 1 jam lagi, atau minta Team Lead menonaktifkan konfirmasi email di Supabase.";
  if (/rate limit/i.test(m)) return "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.";
  return m || "Terjadi kesalahan. Periksa koneksi lalu coba lagi.";
}
async function authSubmit(f) {
  const v = f.dataset.view, val = id => ($("#" + id)?.value || "").trim(), btn = f.querySelector("button[type=submit]");
  const err = t => { $("#a-err").textContent = t; };
  if (v !== "newpass" && !/^\S+@\S+\.\S+$/.test(val("a-email"))) return err("Masukkan alamat email yang valid.");
  if ((v === "signup" || v === "newpass") && val("a-pass").length < 8) return err("Kata sandi minimal 8 karakter.");
  if (v === "signup" && !val("a-name")) return err("Isi nama Anda.");
  btn.disabled = true;
  const back = location.origin + location.pathname;
  try {
    if (v === "login") { const { error } = await sb.auth.signInWithPassword({ email: val("a-email"), password: $("#a-pass").value }); if (error) err(authMsg(error)); }
    else if (v === "signup") {
      const { data, error } = await sb.auth.signUp({ email: val("a-email"), password: $("#a-pass").value, options: { data: { display_name: val("a-name") }, emailRedirectTo: back } });
      if (error) err(authMsg(error)); else if (!data.session) showAuth("login", "Akun dibuat. Buka email Anda dan klik tautan konfirmasi, lalu masuk.");
    }
    else if (v === "reset") { const { error } = await sb.auth.resetPasswordForEmail(val("a-email"), { redirectTo: back }); if (error) err(authMsg(error)); else showAuth("login", "Jika email terdaftar, tautan reset sudah dikirim."); }
    else if (v === "newpass") {
      const { error } = await sb.auth.updateUser({ password: $("#a-pass").value });
      if (error) err(authMsg(error)); else { toast("Kata sandi diperbarui.", "ok"); const { data } = await sb.auth.getSession(); if (data.session) { if (S.me.id === data.session.user.id) hideAuth(); else boot(data.session); } }
    }
  } finally { if (btn.isConnected) btn.disabled = false; }
}

/* ---------- Mulai ---------- */
function startLocal() {
  S.mode = "local"; S.me = { id: null, isLead: true, canWrite: true };
  const { M, T, L, K, LV } = demoData(); M.forEach(m => local.members.set(m.id, m)); T.forEach(t => local.tasks.set(t.id, t)); L.forEach(l => local.logs.set(l.id, l)); LV.forEach(l => local.leaves.set(l.id, l));
  S.localClaim = K.m_rina; syncLocal(); setRoute();
}
async function boot(session) {
  if (S.me.id === session.user.id) return hideAuth();
  teardown();
  S.me = { id: session.user.id, email: session.user.email, name: "", isLead: false, canWrite: true };
  hideAuth(); setRoute();
  const timer = setTimeout(() => { if (!loaded()) { S.stale = true; renderBanner(); } }, 10000);
  await fetchTable("profiles");
  await Promise.all(["members", "tasks", "settings", "logs", "leaves"].map(fetchTable));
  clearTimeout(timer);
  if (loaded() && !S.lastErr) S.stale = false;
  setRoute(); refresh();
  channel = sb.channel("teamsync-" + Math.random().toString(36).slice(2));
  for (const [t, k] of [["members", "members"], ["tasks", "tasks"], ["activity_logs", "logs"], ["settings", "settings"], ["profiles", "profiles"], ["leaves", "leaves"]])
    channel.on("postgres_changes", { event: "*", schema: "public", table: t }, () => queue(k));
  channel.subscribe(status => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { S.stale = true; renderBanner(); }
    else if (status === "SUBSCRIBED" && S.stale) { S.stale = false; S.lastErr = ""; ["profiles", "members", "tasks", "logs", "settings", "leaves"].forEach(queue); }
  });
}
function teardown() {
  if (channel) { sb.removeChannel(channel); channel = null; }
  Object.assign(S, { members: [], tasks: [], logs: [], leaves: [], profiles: [], claims: {}, seenAlerts: null, asMember: false, composerOpen: false, draft: null, ready: { members: false, tasks: false }, stale: false });
  S.me = { id: null, isLead: false, canWrite: true };
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && sb && S.me.id) ["profiles", "members", "tasks", "logs", "settings", "leaves"].forEach(queue); });
async function start() {
  setRoute(); renderWho();
  if (!(CONF.supabaseUrl && CONF.supabaseAnonKey && window.supabase)) {
    if (CONF.supabaseUrl && !window.supabase) toast("Pustaka Supabase gagal dimuat. Periksa koneksi internet.", "crit");
    return startLocal();
  }
  sb = window.supabase.createClient(CONF.supabaseUrl, CONF.supabaseAnonKey);
  S.mode = "db";
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") return setTimeout(() => showAuth("newpass"), 0);
    if (session) setTimeout(() => boot(session), 0);
    else { teardown(); showAuth("login"); }
  });
}
start();
})();
