/* Engine Health - app.js
   Giao dien mot trang, dieu huong bang # (khong dung thu vien ngoai).
   Cau truc: tien ich, du lieu, man Tong quan, Dong co, Du lieu moi, Mo hinh, bo dinh tuyen. */
"use strict";

// Tien ich
const $ = (s, r = document) => r.querySelector(s);
const view = $("#view");
const MINUS = "−";
const fmt = (x, d = 1) => x.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (x, d = 1) => (x < 0 ? MINUS : "+") + fmt(Math.abs(x), d);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function store(key, value) {           // localStorage co the bi chan -> luon bao try/catch
  try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { return null; }
}

const LABEL = { crit: "Nguy cấp", warn: "Cảnh báo", ok: "Bình thường" };
const REC_SHORT = { crit: "Bảo trì ở lần dừng máy gần nhất", warn: "Đưa vào kế hoạch bảo trì", ok: "Vận hành bình thường" };
const REC_LONG = {
  crit: ["Lên lịch bảo trì trong đợt dừng máy gần nhất.", "Không giao thêm nhiệm vụ dài."],
  warn: ["Đưa vào kế hoạch bảo trì sắp tới.", "Đặt trước phụ tùng, nhân lực và tăng tần suất theo dõi."],
  ok: ["Tiếp tục vận hành.", "Theo dõi định kỳ."],
};
const DECISION_LABEL = { "Đồng ý khuyến nghị": "Đã đồng ý", "Hoãn": "Đã hoãn", "Bác bỏ khuyến nghị": "Đã bác bỏ" };
const RUL_MAX = 125;
const RUL_TIP = "Số chu kỳ vận hành còn lại trước khi hỏng, do mô hình dự đoán.";

let THR = { c: 30, w: 60 };
{ const c = parseInt(store("eh.c"), 10), w = parseInt(store("eh.w"), 10); if (c > 0 && w > c && w <= RUL_MAX) THR = { c, w }; }
const statusOf = (rul) => (rul <= THR.c ? "crit" : rul <= THR.w ? "warn" : "ok");
const errKey = { crit: "CRITICAL", warn: "WARNING", ok: "HEALTHY" };

// Tooltip dung chung: phan tu co data-tip, hoac goi showTip()
const tip = $("#tip");
function showTip(html, x, y) {
  tip.innerHTML = html; tip.classList.add("on");
  tip.style.left = Math.max(8, Math.min(x + 14, innerWidth - tip.offsetWidth - 8)) + "px";
  tip.style.top = Math.max(8, y - tip.offsetHeight - 14) + "px";
}
const hideTip = () => tip.classList.remove("on");
document.addEventListener("mousemove", (e) => { const t = e.target.closest && e.target.closest("[data-tip]"); t ? showTip(t.dataset.tip, e.clientX, e.clientY) : (e.target.closest && e.target.closest("[data-skip-tip]") ? 0 : hideTip()); });
document.addEventListener("focusin", (e) => { const t = e.target.closest("[data-tip]"); if (t) { const r = t.getBoundingClientRect(); showTip(t.dataset.tip, r.left, r.top); } });
document.addEventListener("focusout", hideTip);

let toastTimer;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 3200); }

function countUp(el, to, ms = 700, d = 0) {
  if (reduceMotion) { el.textContent = fmt(to, d); return; }
  const t0 = performance.now();
  const step = (t) => { const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(to * e, d); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// Du lieu (goi may chu)
async function api(path, options) {
  let res;
  try { res = await fetch(path, options); } catch (e) { throw new Error("Không kết nối được máy chủ. Kiểm tra máy chủ đang chạy rồi thử lại."); }
  let body = null; try { body = await res.json(); } catch (e) { /* khong co noi dung */ }
  if (!res.ok) throw new Error((body && body.detail) || "Máy chủ báo lỗi. Thử lại sau ít phút.");
  return body;
}
let fleetPromise = null;
const getFleet = (force = false) => (fleetPromise = !force && fleetPromise ? fleetPromise : api("/api/fleet"));

let FLEET_ROWS = null;
function renderMeta(fleet) {
  $("#meta").innerHTML = `<span>Dữ liệu <b>NASA C-MAPSS FD001</b>, mô phỏng</span><i></i><span>Mô hình <b>${esc(fleet.model)}</b></span>`;
  $("#foot-model").textContent = `Mô hình ${fleet.model}`;
  FLEET_ROWS = fleet.rows;
  updateShell();
}
// Thanh trang thai tren dau trang, dai mau chan trang va quy tac canh bao: tinh lai theo nguong hien tai
function updateShell() {
  if (!FLEET_ROWS) return;
  const c = { crit: 0, warn: 0, ok: 0 };
  FLEET_ROWS.forEach((r) => c[statusOf(r.rul)]++);
  $("#hd-status").innerHTML = ["crit", "warn", "ok"].map((k) =>
    `<a class="hs ${k}" href="#/" data-tip="${c[k]} động cơ ở mức ${LABEL[k].toLowerCase()}"><b>${c[k]}</b><span>${LABEL[k]}</span></a>`).join("");
  const n = FLEET_ROWS.length, st = $("#foot-stripe");
  if (!st.childElementCount) st.innerHTML = "<i></i><i></i><i></i>";
  ["crit", "warn", "ok"].forEach((k, i) => { st.children[i].style.width = (c[k] / n * 100) + "%"; });
  $("#foot-rule").textContent = `Nguy cấp: RUL ${THR.c} chu kỳ trở xuống. Cảnh báo: đến ${THR.w} chu kỳ.`;
}
const skeleton = (h) => `<div class="skel" style="height:${h}px"></div>`;
function errorBox(msg) {
  return `<div class="panel state-box"><div class="t-h3">Không tải được dữ liệu</div><p>${esc(msg)}</p><button class="btn primary" data-retry>Tải lại</button></div>`;
}
view.addEventListener("click", (e) => { if (e.target.closest("[data-retry]")) route(); });

// Man 1: tong quan
async function viewOverview() {
  view.innerHTML = `<div class="hero"><div><h1 class="t-h1">Đang tính RUL cho 100 động cơ</h1><p class="muted">Vài giây đầu tiên cần để nạp mô hình</p></div></div>${skeleton(420)}<div style="height:24px"></div>${skeleton(480)}`;
  let fleet;
  try { fleet = await getFleet(); } catch (e) { view.innerHTML = errorBox(e.message); return; }
  renderMeta(fleet);
  const rows = fleet.rows;                         // da xep theo RUL tang dan
  let filter = "all", shown = 12, query = "", first = true;

  const counts = () => { const c = { crit: 0, warn: 0, ok: 0 }; rows.forEach((r) => c[statusOf(r.rul)]++); return c; };

  view.innerHTML = `
  <div class="view-in">
    <div class="hero"><div><h1 class="t-h1" id="h1"></h1><p class="muted">Trong ${rows.length} động cơ, tính tại chu kỳ cuối đã ghi nhận</p></div></div>
    <section class="panel"><div class="kpis" id="kpis"></div>
      <div class="skyline-wrap">
        <div class="sk-head"><span class="t-label">RUL từng động cơ, thấp đến cao</span><span class="t-cap">Mỗi cột một động cơ · đơn vị chu kỳ</span></div>
        <div class="skyline" id="skyline" data-skip-tip></div>
        <div class="sk-axis"><span class="t-cap" id="ax-l"></span><span class="t-cap" id="ax-r"></span></div>
      </div></section>
    <section class="panel" style="margin-top:var(--s5)">
      <div class="listhead"><h2 class="t-h2">Danh sách ưu tiên bảo trì</h2>
        <div class="tools"><span class="seg" id="seg" role="group" aria-label="Lọc theo trạng thái"></span>
          <label class="field">Tìm <input class="wide" id="q" placeholder="Số động cơ" inputmode="numeric" autocomplete="off"></label>
          <label class="field" data-tip="Ngưỡng RUL (chu kỳ). Đổi ngưỡng thì số liệu tính lại ngay.">Nguy cấp <input id="tc" inputmode="numeric" value="${THR.c}"></label>
          <label class="field" data-tip="Ngưỡng RUL (chu kỳ). Đổi ngưỡng thì số liệu tính lại ngay.">Cảnh báo <input id="tw" inputmode="numeric" value="${THR.w}"></label>
          <button class="btn" id="csv">Xuất CSV</button></div></div>
      <div class="form-error" id="thr-err" style="padding:0 var(--s5)" role="alert"></div>
      <table class="fleet"><thead><tr>
        <th style="width:72px">Hạng</th><th style="width:96px">Động cơ</th><th class="sorted" style="width:240px" data-tip="${esc(RUL_TIP)}">RUL dự đoán (chu kỳ)</th>
        <th class="r" style="width:136px">Chu kỳ hiện tại</th><th style="width:140px">Trạng thái</th><th>Cảm biến lệch nhiều nhất</th><th style="width:140px">Xác nhận</th></tr></thead>
        <tbody id="rows"></tbody></table>
      <div class="foot"><span id="count"></span><button class="btn ghost" id="more"></button></div>
    </section>
    <p class="srcnote">Dữ liệu NASA C-MAPSS FD001 (tập test), mô phỏng, không phải dữ liệu vận hành thật.</p>
  </div>`;

  function renderKpis() {
    const c = counts(), n = rows.length;
    $("#h1").textContent = c.crit + c.warn === 0 ? "Không có động cơ nào cần xử lý" : `${c.crit + c.warn} động cơ cần xử lý`;
    const defs = [["crit", `RUL ${THR.c} chu kỳ trở xuống`], ["warn", `RUL từ ${THR.c + 1} đến ${THR.w} chu kỳ`], ["ok", `RUL trên ${THR.w} chu kỳ`]];
    $("#kpis").innerHTML = defs.map(([k, s]) => `<div class="kpi ${k}"><div class="lab">${LABEL[k]}</div><div class="big" data-to="${c[k]}">${first ? 0 : c[k]}</div>
      <div class="sub"><span class="t-cap">${s}</span><span class="t-cap num">${fmt(c[k] / n * 100, 0)}% đội máy</span></div>
      <div class="meter"><i style="transform:scaleX(${first ? 0 : c[k] / n})"></i></div></div>`).join("");
    if (first) document.querySelectorAll(".kpi").forEach((k, i) => {
      const key = ["crit", "warn", "ok"][i];
      countUp(k.querySelector(".big"), c[key]);
      requestAnimationFrame(() => requestAnimationFrame(() => { k.querySelector(".meter i").style.transform = `scaleX(${c[key] / n})`; }));
    });
    const defsSeg = [["all", "Tất cả", n], ["crit", LABEL.crit, c.crit], ["warn", LABEL.warn, c.warn], ["ok", LABEL.ok, c.ok]];
    $("#seg").innerHTML = defsSeg.map(([k, l, v]) => `<button data-k="${k}" aria-pressed="${filter === k}">${l}<span class="n">${v}</span></button>`).join("");
  }
  function renderSkyline() {
    const sk = $("#skyline");
    sk.innerHTML = rows.map((r, i) => `<div class="col ${statusOf(r.rul)}" data-i="${i}" style="height:${Math.max(4, r.rul / RUL_MAX * 100)}%;animation-delay:${first ? i * 8 : 0}ms"></div>`).join("") +
      [THR.w, THR.c].map((v) => `<div class="guide" style="bottom:${v / RUL_MAX * 100}%"><span>${v}</span></div>`).join("");
    const lo = rows[0], hi = rows[rows.length - 1];
    $("#ax-l").textContent = `Thấp nhất: #${lo.unit}, ${fmt(lo.rul)} chu kỳ`;
    $("#ax-r").textContent = `Cao nhất: #${hi.unit}, ${fmt(hi.rul)} chu kỳ`;
  }
  function rowHtml(r, rank) {
    const s = statusOf(r.rul);
    const sens = `<span data-tip="${esc(r.sensor_name)}. Lệch ${signed(r.z)} độ lệch chuẩn so với lúc động cơ còn khỏe.">${esc(r.sensor)} · ${signed(r.z)} độ lệch chuẩn</span>`;
    const dec = r.decision ? `<span>${DECISION_LABEL[r.decision] || esc(r.decision)}</span>` : `<span class="muted">Chưa xác nhận</span>`;
    return `<tr tabindex="0" data-unit="${r.unit}" aria-label="Mở động cơ ${r.unit}"><td class="num muted">${rank + 1}</td><td class="engine-id">#${r.unit}</td>
      <td><div class="rulcell"><span class="v">${fmt(r.rul)}</span><div class="meter"><i style="width:${Math.max(3, r.rul / RUL_MAX * 100)}%;background:var(--${s})"></i></div></div></td>
      <td class="r num">${r.cycle}</td><td><span class="chip ${s}">${LABEL[s]}</span></td><td>${sens}</td><td>${dec}</td></tr>`;
  }
  function renderTable() {
    let list = rows.map((r, i) => ({ r, i })).filter((x) => filter === "all" || statusOf(x.r.rul) === filter);
    if (query) list = list.filter((x) => String(x.r.unit).startsWith(query));
    const part = list.slice(0, shown);
    $("#rows").innerHTML = part.map((x) => rowHtml(x.r, x.i)).join("") ||
      `<tr><td colspan="7" style="height:88px;text-align:center;cursor:default" class="muted">Không có động cơ khớp. Đổi bộ lọc hoặc số động cơ.</td></tr>`;
    $("#count").textContent = `Hiển thị ${part.length} trên ${list.length} động cơ`;
    const more = $("#more"); more.style.visibility = list.length > shown ? "visible" : "hidden"; more.textContent = `Xem cả ${list.length} động cơ`;
  }
  const openRow = (e) => { const tr = e.target.closest("tr[data-unit]"); if (tr) location.hash = `#/engine/${tr.dataset.unit}`; };
  $("#rows").addEventListener("click", openRow);
  $("#rows").addEventListener("keydown", (e) => { if (e.key === "Enter") openRow(e); });
  $("#seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { filter = b.dataset.k; shown = 12; renderKpis(); renderTable(); } });
  $("#more").onclick = () => { shown = rows.length; renderTable(); };
  $("#q").oninput = (e) => { query = e.target.value.trim().replace("#", ""); shown = 12; renderTable(); };
  function readThr() {
    const c = parseInt($("#tc").value, 10), w = parseInt($("#tw").value, 10), ok = c > 0 && w > c && w <= RUL_MAX;
    $("#tc").setAttribute("aria-invalid", !ok); $("#tw").setAttribute("aria-invalid", !ok);
    $("#thr-err").textContent = ok ? "" : "Ngưỡng cảnh báo phải lớn hơn ngưỡng nguy cấp và không quá 125.";
    if (ok) { THR = { c, w }; store("eh.c", c); store("eh.w", w); updateShell(); renderKpis(); renderSkyline(); renderTable(); }
  }
  $("#tc").oninput = readThr; $("#tw").oninput = readThr;
  $("#csv").onclick = () => {
    const head = ["Hạng", "Động cơ", "RUL dự đoán (chu kỳ)", "Chu kỳ hiện tại", "Trạng thái", "Cảm biến lệch nhiều nhất", "Độ lệch chuẩn", "Xác nhận"];
    const lines = rows.map((r, i) => [i + 1, r.unit, r.rul, r.cycle, LABEL[statusOf(r.rul)], r.sensor, r.z, DECISION_LABEL[r.decision] || "Chưa xác nhận"].join(","));
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "danh_sach_uu_tien.csv"; a.click(); URL.revokeObjectURL(a.href);
  };
  $("#skyline").addEventListener("mousemove", (e) => {
    const c = e.target.closest(".col"); if (!c) return hideTip();
    const r = rows[+c.dataset.i];
    showTip(`Động cơ #${r.unit} · RUL <b>${fmt(r.rul)}</b> chu kỳ · ${LABEL[statusOf(r.rul)]}`, e.clientX, e.clientY);
  });
  $("#skyline").addEventListener("mouseleave", hideTip);
  $("#skyline").addEventListener("click", (e) => { const c = e.target.closest(".col"); if (c) location.hash = `#/engine/${rows[+c.dataset.i].unit}`; });

  renderKpis(); renderSkyline(); renderTable(); first = false;
}

// Man 2: dong co
// Vi tri cac cam bien tren hinh dong co: moi tram (station) gom cac cam bien dat tai do
const STATIONS = [
  { id: "fan", x: 75, y: 50, label: "Quạt", full: "Quạt (fan)", sensors: ["s_8", "s_13"] },
  { id: "lpc", x: 165, y: 66, label: "LPC", full: "Máy nén áp suất thấp (LPC)", sensors: ["s_2"] },
  { id: "hpc", x: 255, y: 72, label: "HPC", full: "Máy nén áp suất cao (HPC)", sensors: ["s_3", "s_7", "s_9", "s_11", "s_14", "s_17"] },
  { id: "cmb", x: 335, y: 66, label: "Buồng đốt", full: "Buồng đốt", sensors: ["s_12"] },
  { id: "hpt", x: 390, y: 62, label: "HPT", full: "Tua-bin áp suất cao (HPT)", sensors: ["s_20"] },
  { id: "lpt", x: 440, y: 56, label: "LPT", full: "Tua-bin áp suất thấp (LPT)", sensors: ["s_4", "s_21"] },
  { id: "byp", x: 350, y: 44, label: "Bypass", full: "Ống bypass", sensors: ["s_15"] },
];

function schematicSvg() {
  const body = `
    <path d="M30,52 C30,40 60,32 110,32 L470,32 C520,32 560,62 575,95 C560,128 520,158 470,158 L110,158 C60,158 30,150 30,138 Z" fill="var(--subtle)" stroke="var(--line-strong)" stroke-width="1.5"/>
    <ellipse cx="52" cy="95" rx="16" ry="11" fill="var(--ink-600)"/>
    <g class="fan-blades">${[48, 66, 84, 104, 124, 142].map((y) => `<rect x="60" y="${y - 40}" width="5" height="22" fill="var(--ink-500)" opacity=".55"/>`).join("")}</g>
    <line x1="68" y1="95" x2="470" y2="95" stroke="var(--ink-500)" stroke-width="2"/>
    <polygon points="120,70 210,78 210,112 120,120" fill="var(--panel)" stroke="var(--ink-500)" stroke-width="1.5"/>
    <polygon points="215,80 295,86 295,104 215,110" fill="var(--panel)" stroke="var(--ink-500)" stroke-width="1.5"/>
    <rect x="300" y="76" width="70" height="38" rx="6" fill="var(--panel)" stroke="var(--ink-500)" stroke-width="1.5"/>
    <polygon points="375,78 405,72 405,118 375,112" fill="var(--panel)" stroke="var(--ink-500)" stroke-width="1.5"/>
    <polygon points="410,72 470,64 470,126 410,118" fill="var(--panel)" stroke="var(--ink-500)" stroke-width="1.5"/>
    <polygon points="475,70 560,92 560,98 475,120" fill="var(--panel)" stroke="var(--ink-500)" stroke-width="1.5"/>`;
  const st = STATIONS.map((s) => `<g class="station" data-st="${s.id}" tabindex="0">
      <circle class="pulse" cx="${s.x}" cy="${s.y}" r="6" fill="var(--primary)" opacity="0"/>
      <circle class="dot" cx="${s.x}" cy="${s.y}" r="5.5" fill="var(--panel)" stroke="var(--ink-500)" stroke-width="1.5"/>
      <text x="${s.x}" y="${s.id === "byp" ? 24 : 182}" text-anchor="middle">${s.label}</text></g>`).join("");
  return `<svg viewBox="20 6 570 194" role="img" aria-label="Sơ đồ động cơ turbofan và vị trí các cảm biến">${body}${st}</svg>`;
}

async function viewEngine(unitArg) {
  let fleet;
  try { fleet = await getFleet(); } catch (e) { view.innerHTML = errorBox(e.message); return; }
  renderMeta(fleet);
  if (!unitArg) { location.replace(`#/engine/${fleet.rows[0].unit}`); return; }
  const unit = +unitArg;
  const order = fleet.rows.map((r) => r.unit), pos = order.indexOf(unit);
  if (pos < 0) {
    view.innerHTML = `<div class="panel state-box"><div class="t-h3">Không có động cơ #${esc(unitArg)}</div><p>Đội máy có 100 động cơ, đánh số từ 1 đến 100.</p><a class="btn primary" style="display:inline-flex;align-items:center;text-decoration:none" href="#/">Về Tổng quan</a></div>`; return;
  }
  view.innerHTML = `<div class="hero"><div><h1 class="t-h1">Động cơ #${unit}</h1></div></div>${skeleton(150)}<div style="height:24px"></div>${skeleton(380)}`;
  let d;
  try { d = await api(`/api/engine/${unit}`); } catch (e) { view.innerHTML = errorBox(e.message); return; }

  const n = d.cycles.length, last = n - 1;
  let cur = last, playing = null, showTrue = true, firstPaint = true, picked = "";
  const prev = order[pos - 1], next = order[pos + 1];

  view.innerHTML = `
  <div class="view-in">
    <div class="eng-head">
      <div class="eng-title"><h1 class="t-h1">Động cơ #${unit}</h1><span id="chip"></span></div>
      <div class="eng-nav">
        <a class="btn" style="display:inline-flex;align-items:center;text-decoration:none" ${prev ? `href="#/engine/${prev}"` : "aria-disabled='true' tabindex='-1' disabled"}>Động cơ trước</a>
        <a class="btn" style="display:inline-flex;align-items:center;text-decoration:none" ${next ? `href="#/engine/${next}"` : "aria-disabled='true' tabindex='-1' disabled"}>Động cơ sau</a>
        <label class="field">Tìm <input class="wide" id="go" placeholder="Số động cơ" inputmode="numeric" autocomplete="off"></label>
      </div>
    </div>
    <div class="form-error" id="go-err" role="alert"></div>
    <div class="cards">
      <section class="panel card"><span class="lab" data-tip="${esc(RUL_TIP)}">RUL dự đoán</span><div class="big"><span id="rul">0</span><small>chu kỳ</small></div>
        <span class="t-cap" id="at"></span><div class="rul-scale" id="scale"></div></section>
      <section class="panel card"><span class="lab">Hành động khuyến nghị</span><div class="act" id="act1"></div><div class="act act-more" id="act2"></div></section>
      <section class="panel card err"><span class="lab" data-tip="Sai số trung bình của mô hình trên các động cơ cùng mức, khi nghiệm thu.">Sai số điển hình</span><div class="big"><span id="err"></span><small>chu kỳ</small></div></section>
    </div>
    <div class="grid-2">
      <section class="panel panel-pad chart">
        <div class="panel-head"><h2 class="t-h3">RUL dự đoán theo chu kỳ</h2>
          <div class="replay-bar"><span class="replay-note" id="rnote"></span>
            <button class="btn ghost" id="now" hidden>Về hiện tại</button>
            <button class="btn" id="true" aria-pressed="true">Ẩn RUL thật</button>
            <button class="btn primary" id="play">Phát lại vòng đời</button></div></div>
        <div id="chart"></div>
      </section>
      <section class="panel panel-pad schem"><div class="panel-head"><h2 class="t-h3">Vị trí cảm biến lệch</h2></div>
        <div id="schem">${schematicSvg()}</div>
        <div class="stlist" id="stlist"></div><p class="t-cap" style="margin-top:var(--s3)">Điểm màu là nơi đặt cảm biến lệch nhiều nhất. Rê chuột vào điểm để xem chi tiết.</p></section>
    </div>
    <div class="grid-2b">
      <section class="panel panel-pad"><div class="panel-head"><h2 class="t-h3">Cảm biến lệch nhiều nhất</h2><span class="t-cap">So với động cơ còn khỏe</span></div><div id="sens"></div></section>
      <section class="panel panel-pad"><div class="panel-head"><h2 class="t-h3">Quyết định của kỹ sư</h2></div>
        <form id="form" class="form-grid" novalidate>
          <div class="radio" id="radio" role="radiogroup" aria-label="Quyết định">
            ${["Đồng ý khuyến nghị", "Hoãn", "Bác bỏ khuyến nghị"].map((o) => `<label><input type="radio" name="dec" value="${o}">${o}</label>`).join("")}</div>
          <div><label class="lbl" for="who">Người xác nhận</label><input class="txt" id="who" autocomplete="name" placeholder="Họ và tên" value="${esc(store("eh.who") || "")}"></div>
          <div><label class="lbl" for="why">Lý do <span class="muted">(bắt buộc khi bác bỏ khuyến nghị)</span></label><textarea class="txt" id="why" rows="2" placeholder="Ghi ngắn gọn"></textarea></div>
          <div class="form-error" id="ferr" role="alert"></div>
          <div class="replay-note" id="fnote" hidden></div>
          <button class="btn primary" id="save" type="submit">Lưu quyết định</button>
        </form>
        <div id="hist"></div>
      </section></div>
  </div>`;

  const statusAt = (i) => statusOf(d.rul[i]);
  const topSensors = (i) => Object.keys(d.z).map((s) => [s, d.z[s][i]]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5);

  // ---- RUL + khuyen nghi + sai so ----
  function renderCards() {
    const s = statusAt(cur), v = d.rul[cur];
    $("#chip").innerHTML = `<span class="chip lg ${s}">${LABEL[s]}</span>`;
    const rulEl = $("#rul");
    if (firstPaint) countUp(rulEl, v, 800, 1); else rulEl.textContent = fmt(v);
    $("#at").textContent = `Đang ở chu kỳ ${d.cycles[cur]}`;
    const sc = $("#scale"), pct = (x) => (x / RUL_MAX * 100).toFixed(2) + "%";
    sc.innerHTML = `<div class="meter"><i id="rfill" style="width:${firstPaint ? 0 : Math.max(2, v / RUL_MAX * 100)}%;background:var(--${s});transition:width var(--t-slow) var(--ease)"></i></div>
      <span class="tick" style="left:${pct(THR.c)}"></span><span class="tick" style="left:${pct(THR.w)}"></span>
      <span class="tl" style="left:${pct(THR.c)}">${THR.c}</span><span class="tl" style="left:${pct(THR.w)}">${THR.w}</span>`;
    if (firstPaint) requestAnimationFrame(() => requestAnimationFrame(() => { $("#rfill").style.width = Math.max(2, v / RUL_MAX * 100) + "%"; }));
    else $("#rfill").style.transition = "none";
    $("#act1").textContent = REC_LONG[s][0]; $("#act2").textContent = REC_LONG[s][1];
    $("#err").textContent = "± " + fmt(d.typical_error[errKey[s]]);
  }

  // ---- bieu do RUL ----
  const W = 760, H = 300, L = 44, R = 70, T = 14, B = 34;
  const x0 = d.cycles[0], x1 = d.cycles[last];
  const X = (c) => L + (c - x0) / (x1 - x0) * (W - L - R);
  const Y = (v) => T + (1 - v / 130) * (H - T - B);
  function drawChart() {
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="RUL dự đoán của động cơ ${unit} theo chu kỳ">`;
    s += `<rect x="${L}" y="${Y(THR.c)}" width="${W - L - R}" height="${Y(0) - Y(THR.c)}" fill="var(--crit-tint)"/>`;
    s += `<rect x="${L}" y="${Y(THR.w)}" width="${W - L - R}" height="${Y(THR.c) - Y(THR.w)}" fill="var(--warn-tint)"/>`;
    [0, 30, 60, 90, 125].forEach((v) => { s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`; });
    const step = Math.max(10, Math.round((x1 - x0) / 5 / 10) * 10);
    for (let c = Math.ceil(x0 / step) * step; c <= x1; c += step) s += `<text x="${X(c)}" y="${H - 10}" text-anchor="middle">${c}</text>`;
    s += `<text x="${W - R}" y="${H - 10}" text-anchor="end">chu kỳ</text>`;
    s += `<text x="${L + 8}" y="${Y(THR.w) + 15}" style="fill:var(--warn-text);font-family:var(--font-ui);font-weight:500">Cảnh báo</text><text x="${L + 8}" y="${Y(THR.c) + 15}" style="fill:var(--crit-text);font-family:var(--font-ui);font-weight:500">Nguy cấp</text>`;
    if (showTrue) {
      s += `<polyline fill="none" stroke="var(--ink-500)" stroke-width="1.5" stroke-dasharray="5 4" points="${d.cycles.map((c, i) => `${X(c)},${Y(d.rul_true[i])}`).join(" ")}"/>`;
      s += `<text x="${X(x1) + 8}" y="${Y(d.rul_true[last]) + 14}" style="font-family:var(--font-ui);font-weight:500">Thực tế</text>`;
    }
    s += `<polyline fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round" points="${d.cycles.map((c, i) => `${X(c)},${Y(d.rul[i])}`).join(" ")}"/>`;
    s += `<text x="${X(x1) + 8}" y="${Y(d.rul[last]) - 6}" style="fill:var(--primary);font-family:var(--font-ui);font-weight:600">Dự đoán</text>`;
    s += `<g id="cursor"></g><rect id="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" data-skip-tip style="cursor:crosshair"/></svg>`;
    $("#chart").innerHTML = s;
    const hit = $("#hit");
    const idxAt = (e) => { const r = hit.getBoundingClientRect(); const f = (e.clientX - r.left) / r.width; return Math.max(0, Math.min(last, Math.round(f * last))); };
    hit.addEventListener("mousemove", (e) => { const i = idxAt(e); showTip(`Chu kỳ <b>${d.cycles[i]}</b> · RUL dự đoán <b>${fmt(d.rul[i])}</b>${showTrue ? ` · RUL thật <b>${fmt(d.rul_true[i])}</b>` : ""}`, e.clientX, e.clientY); });
    hit.addEventListener("mouseleave", hideTip);
    hit.addEventListener("click", (e) => { stop(); setCursor(idxAt(e)); });
    drawCursor();
  }
  function drawCursor() {
    const c = d.cycles[cur], s = statusAt(cur);
    $("#cursor").innerHTML = `<line x1="${X(c)}" x2="${X(c)}" y1="${T}" y2="${H - B}" stroke="var(--ink-900)" stroke-width="1" opacity=".5"/>
      <circle cx="${X(c)}" cy="${Y(d.rul[cur])}" r="5" fill="var(--panel)" stroke="var(--${s === "ok" ? "primary" : s})" stroke-width="2.5"/>`;
  }

  // ---- cam bien lech nhieu nhat + hinh dong co ----
  function sparkline(s) {
    const m = d.mean[s], lo = Math.min(...m), hi = Math.max(...m), w = 200, h = 28, rng = hi - lo || 1;
    const px = (i) => (i / last * (w - 6) + 3).toFixed(1), py = (v) => (h - 4 - (v - lo) / rng * (h - 8)).toFixed(1);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="var(--ink-500)" stroke-width="1.3" vector-effect="non-scaling-stroke" points="${m.map((v, i) => px(i) + "," + py(v)).join(" ")}"/>
      <circle cx="${px(cur)}" cy="${py(m[cur])}" r="3" fill="var(--primary)"/></svg>`;
  }
  const tier = (z) => (Math.abs(z) >= 3 ? "crit" : Math.abs(z) >= 2 ? "warn" : "ink");
  function renderSensors(animate) {
    const top = topSensors(cur), maxZ = Math.max(4, ...top.map((t) => Math.abs(t[1])));
    $("#sens").innerHTML = top.map(([s, z]) => {
      const meta = d.sensors[s], pct = Math.abs(z) / maxZ * 50, col = tier(z) === "ink" ? "var(--ink-500)" : `var(--${tier(z)})`;
      return `<div class="sens-row"><div class="nm"><b>${esc(meta.code)}</b><span>${esc(meta.name)}</span></div>
        <div><div class="zbar ${animate ? "" : "on"}" id="zb-${s}"><i class="axis"></i><i class="fill" style="background:${col};--o:${z < 0 ? "right" : "left"};${z < 0 ? `right:50%` : `left:50%`};width:${pct}%"></i></div>${sparkline(s)}</div>
        <div class="sens-val">${signed(z)}<span>độ lệch chuẩn</span></div></div>`;
    }).join("");
    if (animate) requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll(".zbar").forEach((z) => z.classList.add("on"))));
    // hinh dong co: tram nao co cam bien trong top 5 thi sang len
    const hot = {};
    top.forEach(([s, z]) => { STATIONS.forEach((st) => { if (st.sensors.includes(s)) (hot[st.id] = hot[st.id] || []).push([d.sensors[s].code, z]); }); });
    STATIONS.forEach((st) => {
      const g = $(`.station[data-st="${st.id}"]`), items = hot[st.id], dot = g.querySelector(".dot"), pulse = g.querySelector(".pulse");
      g.classList.toggle("hot", !!items);
      const t = items ? tier(items.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a))[1]) : "";
      const color = items ? (t === "ink" ? "var(--primary)" : `var(--${t})`) : "";
      dot.setAttribute("fill", items ? color : "var(--panel)"); dot.setAttribute("stroke", items ? color : "var(--ink-500)");
      pulse.setAttribute("fill", color || "var(--primary)"); pulse.setAttribute("opacity", items ? ".5" : "0");
      g.dataset.tip = esc(st.full) + (items ? ": " + items.map(([c, z]) => `${esc(c)} ${signed(z)}`).join(", ") : ": không có cảm biến lệch nhiều");
    });
    $("#stlist").innerHTML = STATIONS.filter((st) => hot[st.id]).map((st) =>
      `<div class="st"><b>${esc(st.full)}</b><span>${hot[st.id].map(([c, z]) => `${esc(c)} ${signed(z)}`).join(", ")}</span></div>`).join("");
  }

  // ---- bieu mau quyet dinh + lich su ----
  function renderHistory() {
    const h = d.history;
    $("#hist").innerHTML = h.length ? `<table class="hist"><thead><tr><th>Thời gian</th><th>Quyết định</th><th>Người xác nhận</th><th>Lý do</th></tr></thead><tbody>${
      h.map((r) => `<tr><td class="num">${esc(r.thoi_gian)}</td><td>${esc(r.quyet_dinh)}</td><td>${esc(r.nguoi_xac_nhan)}</td><td>${esc(r.ghi_chu)}</td></tr>`).join("")}</tbody></table>`
      : `<p class="t-cap" style="margin-top:var(--s4)">Chưa có quyết định nào cho động cơ này.</p>`;
  }
  function syncForm() {
    const atNow = cur === last;
    $("#save").disabled = !atNow;
    $("#fnote").hidden = atNow;
    $("#fnote").textContent = `Quyết định áp dụng cho chu kỳ hiện tại (${d.cycles[last]}). Bấm "Về hiện tại" để lưu.`;
    $("#now").hidden = atNow; $("#rnote").textContent = atNow ? "" : `Đang xem lại chu kỳ ${d.cycles[cur]}`;
  }
  $("#radio").addEventListener("change", () => { document.querySelectorAll("#radio label").forEach((l) => l.classList.toggle("on", l.querySelector("input").checked)); });
  $("#form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const dec = (document.querySelector("#radio input:checked") || {}).value, who = $("#who").value.trim(), why = $("#why").value.trim();
    const err = $("#ferr"); err.textContent = ""; $("#who").removeAttribute("aria-invalid"); $("#why").removeAttribute("aria-invalid");
    if (!dec) { err.textContent = "Chọn một quyết định trước khi lưu."; return; }
    if (!who) { err.textContent = "Nhập tên người xác nhận trước khi lưu."; $("#who").setAttribute("aria-invalid", "true"); return; }
    if (dec === "Bác bỏ khuyến nghị" && !why) { err.textContent = "Nhập lý do khi bác bỏ khuyến nghị."; $("#why").setAttribute("aria-invalid", "true"); return; }
    $("#save").disabled = true;
    try {
      await api("/api/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unit, decision: dec, engineer: who, reason: why, critical: THR.c, warning: THR.w }) });
      store("eh.who", who); toast(`Đã lưu quyết định cho động cơ #${unit}.`);
      $("#form").reset(); $("#who").value = who; document.querySelectorAll("#radio label").forEach((l) => l.classList.remove("on"));
      d.history = (await api(`/api/engine/${unit}`)).history; renderHistory(); getFleet(true);
    } catch (ex) { err.textContent = ex.message; }
    syncForm();
  });

  // ---- phat lai vong doi ----
  function setCursor(i) { cur = i; renderCards(); drawCursor(); renderSensors(false); syncForm(); }
  function stop() { if (playing) { clearInterval(playing); playing = null; $("#play").textContent = "Phát lại vòng đời"; } }
  $("#play").onclick = () => {
    if (playing) { stop(); return; }
    if (cur >= last) cur = 0;
    $("#play").textContent = "Dừng";
    const stepBy = Math.max(1, Math.round(n / 110));
    playing = setInterval(() => { const nx = Math.min(last, cur + stepBy); setCursor(nx); if (nx >= last) stop(); }, 40);
    setCursor(cur);
  };
  $("#now").onclick = () => { stop(); setCursor(last); };
  $("#true").onclick = (e) => { showTrue = !showTrue; e.target.textContent = showTrue ? "Ẩn RUL thật" : "Hiện RUL thật"; e.target.setAttribute("aria-pressed", showTrue); drawChart(); };
  $("#go").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const v = parseInt($("#go").value.replace("#", ""), 10);
    if (order.includes(v)) location.hash = `#/engine/${v}`; else $("#go-err").textContent = `Không có động cơ #${$("#go").value.trim() || "?"} trong đội máy.`;
  });

  renderCards(); drawChart(); renderSensors(true); renderHistory(); syncForm(); firstPaint = false;
  view._cleanup = stop;     // roi trang thi dung phat lai
}

// Man 3: du lieu moi
const pct = (x, d = 1) => fmt(x * 100, d) + "%";
const pctA = (x) => pct(x, x > 0 && x < 0.01 ? 2 : 1);     // so nho hon 1% giu 2 chu so thap phan
const CHECK_LABEL = {
  format: "Định dạng 26 cột số",
  missing: "Ô dữ liệu trống",
  gaps: "Chu kỳ liên tục",
  length: "Đủ 30 chu kỳ để dự đoán",
  range: "Nằm trong vùng dữ liệu đã huấn luyện",
};
const CHECK_STATUS = { ok: ["ok", "Đạt"], warn: ["warn", "Lưu ý"], fail: ["crit", "Không đạt"], na: ["none", "Chưa đủ dữ liệu"] };
function checkValue(c, limit) {
  if (c.key === "format") return c.value;
  if (c.key === "missing") return c.value === 0 ? "Không có" : `${pct(c.value, 2)} ô trống, đã điền bằng giá trị gần nhất trước đó`;
  if (c.key === "gaps") return c.value === 0 ? "Không gián đoạn" : `${c.value} chỗ gián đoạn`;
  if (c.key === "length") return c.value.length === 0 ? "Tất cả động cơ đủ" : `Chưa dự đoán: ${c.value.map((u) => "#" + u).join(", ")}`;
  return `${pctA(c.value)} số đo nằm ngoài, giới hạn ${pct(limit, 0)}`;
}
const chipOf = (st) => `<span class="chip ${CHECK_STATUS[st][0]}">${CHECK_STATUS[st][1]}</span>`;
function downloadCsv(name, head, lines) {
  const blob = new Blob(["﻿" + [head.join(","), ...lines.map((l) => l.join(","))].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
function driftBars(list, limit) {
  const max = Math.max(limit * 2, ...list.map((r) => r.share));
  return `<div class="bars">${list.map((r) => `<div class="bar-row" data-tip="${esc(r.name)}">
    <span class="bar-name">${esc(r.sensor)}</span>
    <div class="bar-track"><i style="width:${Math.max(r.share > 0 ? 1 : 0, r.share / max * 100)}%" class="${r.share > limit ? "over" : ""}"></i><b style="left:${limit / max * 100}%"></b></div>
    <span class="bar-val num">${pctA(r.share)}</span></div>`).join("")}</div>`;
}

function viewUpload() {
  getFleet().then(renderMeta).catch(() => {});      // thanh trang thai tren dau trang
  view.innerHTML = `
  <div class="view-in">
    <div class="hero"><div><h1 class="t-h1">Dữ liệu mới</h1><p class="muted">Tải file cảm biến, hệ thống kiểm tra chất lượng rồi dự đoán RUL</p></div></div>
    <ol class="stepper" id="steps"><li data-s="1">Chọn file</li><li data-s="2">Kiểm tra dữ liệu</li><li data-s="3">Kết quả</li></ol>
    <section class="panel panel-pad">
      <label class="drop" id="drop">
        <input type="file" id="file" accept=".txt,.csv" hidden>
        <span class="drop-main">Kéo file vào đây hoặc <u>chọn file</u></span>
        <span class="t-cap">File .txt hoặc .csv, 26 cột theo định dạng C-MAPSS, tối đa 20 MB</span>
      </label>
      <div class="samples"><span class="t-cap">Chưa có file? Dùng file mẫu:</span>
        <button class="btn" data-sample="fd001" data-tip="3 động cơ cùng điều kiện vận hành với dữ liệu huấn luyện">Mẫu FD001, 3 động cơ</button>
        <button class="btn" data-sample="fd002" data-tip="3 động cơ bay ở 6 điều kiện vận hành khác, dùng để thử cơ chế chặn">Mẫu FD002, điều kiện khác</button></div>
    </section>
    <div id="out"></div>
    <p class="srcnote">Kết quả kiểm tra lô gần nhất được đưa vào trang Mô hình để giám sát dữ liệu đầu vào.</p>
  </div>`;
  const out = $("#out");
  const setStep = (n) => document.querySelectorAll("#steps li").forEach((li) => {
    const s = +li.dataset.s; li.classList.toggle("done", s < n); li.classList.toggle("on", s === n);
  });
  setStep(1);

  async function run(promise, label) {
    setStep(2);
    out.innerHTML = `<section class="panel panel-pad" style="margin-top:var(--s5)"><p class="t-label" style="margin-bottom:var(--s3)">Đang kiểm tra ${esc(label)}</p>${skeleton(160)}</section>`;
    let d;
    try { d = await promise; } catch (e) {
      setStep(1);
      out.innerHTML = `<section class="panel state-box" style="margin-top:var(--s5)"><div class="t-h3">Không xử lý được file</div><p>${esc(e.message)}</p><button class="btn primary" id="again">Chọn file khác</button></section>`;
      $("#again").onclick = () => $("#file").click();
      return;
    }
    setStep(3);
    render(d);
  }
  function render(d) {
    const checks = `<section class="panel" style="margin-top:var(--s5)">
      <div class="listhead"><h2 class="t-h2">Kiểm tra dữ liệu</h2><span class="t-cap">${esc(d.file)} · ${d.n_rows} dòng · ${d.n_units} động cơ</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:34%">Hạng mục</th><th>Kết quả</th><th style="width:140px">Đánh giá</th></tr></thead><tbody>
      ${d.checks.map((c) => `<tr><td>${CHECK_LABEL[c.key]}</td><td>${esc(checkValue(c, d.limit))}</td><td>${chipOf(c.status)}</td></tr>`).join("")}
      </tbody></table></div></section>`;
    let result;
    if (d.blocked) {
      result = `<section class="panel blocked" style="margin-top:var(--s5)"><div class="panel-pad">
        <h2 class="t-h2">Chưa trả kết quả dự đoán</h2>
        <p class="lead">${pctA(d.checks.find((c) => c.key === "range").value)} số đo nằm ngoài vùng dữ liệu đã huấn luyện, vượt giới hạn ${pct(d.limit, 0)}. Mô hình chỉ học điều kiện vận hành của FD001, nên dự đoán trên lô này không đáng tin.</p>
        <p class="t-label" style="margin:var(--s4) 0 var(--s2)">Cảm biến lệch khỏi vùng huấn luyện nhiều nhất</p>${driftBars(d.drift, d.limit)}
        <div class="row-actions"><a class="btn primary linkbtn" href="#/model">Xem trang Giám sát</a><button class="btn" id="again">Chọn file khác</button></div></div></section>`;
    } else {
      const rows = d.rows;
      result = `<section class="panel" style="margin-top:var(--s5)">
        <div class="listhead"><h2 class="t-h2">RUL dự đoán, mô hình ${esc(d.model)}</h2><div class="tools"><button class="btn" id="again">Chọn file khác</button><button class="btn" id="csv">Xuất CSV</button></div></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:110px">Động cơ</th><th class="r" style="width:120px">Chu kỳ cuối</th><th style="width:200px">RUL dự đoán (chu kỳ)</th><th style="width:140px">Trạng thái</th><th>Cảm biến lệch nhiều nhất</th></tr></thead><tbody>
        ${rows.map((r) => {
          if (r.rul === null) return `<tr><td class="engine-id">#${r.unit}</td><td class="r num">${r.cycle}</td><td class="muted">Chưa đủ 30 chu kỳ</td><td><span class="chip none">Chưa dự đoán</span></td><td class="muted">Tiếp tục thu thập dữ liệu</td></tr>`;
          const s = statusOf(r.rul);
          return `<tr><td class="engine-id">#${r.unit}</td><td class="r num">${r.cycle}</td><td><span class="num strong">${fmt(r.rul)}</span> <span class="t-cap">± ${fmt(d.typical_error[errKey[s]])}</span></td>
            <td><span class="chip ${s}">${LABEL[s]}</span></td><td><span data-tip="${esc(r.sensor_name)}">${esc(r.sensor)} · ${signed(r.z)} độ lệch chuẩn</span></td></tr>`;
        }).join("")}</tbody></table></div>
        <div class="foot"><span class="t-cap">Trạng thái theo ngưỡng hiện tại: nguy cấp ≤ ${THR.c}, cảnh báo ≤ ${THR.w} chu kỳ</span></div></section>`;
    }
    out.innerHTML = checks + result;
    $("#again").onclick = () => $("#file").click();
    const csv = $("#csv");
    if (csv) csv.onclick = () => downloadCsv("ket_qua_du_lieu_moi.csv", ["Động cơ", "Chu kỳ cuối", "RUL dự đoán (chu kỳ)", "Trạng thái", "Cảm biến lệch nhiều nhất", "Độ lệch chuẩn"],
      d.rows.map((r) => [r.unit, r.cycle, r.rul === null ? "" : r.rul, r.rul === null ? "Chưa dự đoán" : LABEL[statusOf(r.rul)], r.sensor, r.z]));
  }
  function send(f) {
    if (!f) return;
    if (!/\.(txt|csv)$/i.test(f.name)) { setStep(1); out.innerHTML = `<section class="panel state-box" style="margin-top:var(--s5)"><div class="t-h3">Sai loại file</div><p>Chỉ nhận file .txt hoặc .csv. File đã chọn: ${esc(f.name)}</p></section>`; return; }
    const fd = new FormData(); fd.append("file", f);
    run(api("/api/upload", { method: "POST", body: fd }), f.name);
  }
  $("#file").onchange = (e) => { send(e.target.files[0]); e.target.value = ""; };
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => send(e.dataTransfer.files[0]));
  document.querySelectorAll("[data-sample]").forEach((b) => b.onclick = () => run(api(`/api/sample/${b.dataset.sample}`, { method: "POST" }), b.textContent));
}

// Man 4: mo hinh (giam sat va nghiem thu)
const RULE_DEF = {
  drift: { lab: "Dữ liệu ngoài vùng huấn luyện", val: (r) => pctA(r.value), lim: (r) => `Giới hạn ${pct(r.limit, 0)}` },
  rmse: { lab: "Sai số RMSE trên động cơ đã biết RUL thật", val: (r) => `${fmt(r.value)} <small>chu kỳ</small>`, lim: (r) => `Giới hạn ${r.limit} chu kỳ · ${r.n} động cơ test` },
  recall: { lab: "Bắt đúng động cơ nguy cấp", val: (r) => pct(r.value, 0), lim: (r) => `Tối thiểu ${pct(r.limit, 0)} · ${r.n} động cơ có RUL ≤ 30` },
  reject: { lab: "Kỹ sư bác bỏ khuyến nghị", val: (r) => (r.n ? pct(r.value, 0) : "—"), lim: (r) => `Giới hạn ${pct(r.limit, 0)} · ${r.n} quyết định, cần tối thiểu 5` },
};
const CRITERIA = [
  ["RMSE <= 20 va tot hon baseline", "RMSE ≤ 20 chu kỳ và tốt hơn baseline", "Model"],
  ["Recall canh bao >= 80%", "Bắt đúng ≥ 80% động cơ nguy cấp", "System"],
  ["False alarm <= 10%", "Báo động giả ≤ 10%", "System"],
  ["Latency < 1 giay", "Thời gian dự đoán < 1 giây", "System"],
  ["0 su co ngoai ke hoach (mo phong)", "0 sự cố ngoài kế hoạch (mô phỏng)", "Industrial"],
  ["Chi phi thap hon preventive", "Chi phí thấp hơn bảo trì định kỳ", "Industrial"],
];
const LIMITS = [
  "Chỉ dùng được cho điều kiện vận hành giống FD001. Trên FD002, sai số tăng nhiều lần, nên hệ thống chặn kết quả khi dữ liệu ra ngoài vùng huấn luyện.",
  "Dữ liệu là mô phỏng của NASA, chưa kiểm chứng trên động cơ thật.",
  "LSTM cần đủ 30 chu kỳ lịch sử. Động cơ mới lắp chưa có dự đoán.",
  "Ngưỡng cảnh báo và tỉ lệ chi phí 1 : 5 là giả định, cần hiệu chỉnh với đơn vị khai thác.",
  "Huấn luyện lại chưa tự động: khi một quy tắc giám sát không đạt, nhóm chạy lại Notebook 02 đến 04 với dữ liệu mới có nhãn.",
];

async function viewModel(tabArg) {
  view.innerHTML = `<div class="hero"><div><h1 class="t-h1">Mô hình</h1></div></div>${skeleton(200)}<div style="height:24px"></div>${skeleton(360)}`;
  let d, fleet;
  try { [d, fleet] = await Promise.all([api("/api/model"), getFleet()]); } catch (e) { view.innerHTML = errorBox(e.message); return; }
  renderMeta(fleet);
  const tab = tabArg === "acceptance" ? "acceptance" : "monitor";
  const fails = d.rules.filter((r) => r.status === "fail");
  const src = d.rules[0].source;
  const srcText = src.kind === "upload" ? `lô ${esc(src.file)}, lúc ${esc(src.time)}` : "đội máy 100 động cơ FD001";
  view.innerHTML = `
  <div class="view-in">
    <div class="hero"><div>
      <h1 class="t-h1">${fails.length ? "Cần xem xét huấn luyện lại" : "Mô hình đang hoạt động trong giới hạn"}</h1>
      <p class="muted">Mô hình ${esc(d.model)} · ${fails.length ? `${fails.length}/4 quy tắc không đạt` : `${d.rules.filter((r) => r.status === "ok").length}/4 quy tắc đạt${d.rules.some((r) => r.status === "na") ? ", 1 quy tắc chưa đủ dữ liệu" : ""}`} · dữ liệu đầu vào: ${srcText}</p></div>
      <span class="seg" role="tablist"><button data-tab="monitor" aria-pressed="${tab === "monitor"}">Giám sát</button><button data-tab="acceptance" aria-pressed="${tab === "acceptance"}">Nghiệm thu</button></span></div>
    <div id="tab"></div>
  </div>`;
  document.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { location.hash = b.dataset.tab === "monitor" ? "#/model" : "#/model/acceptance"; });
  $("#tab").innerHTML = tab === "monitor" ? monitorHtml(d, fails) : acceptanceHtml(d);
  const csv = $("#log-csv");
  if (csv) csv.onclick = () => downloadCsv("nhat_ky_quyet_dinh.csv", ["Thời gian", "Động cơ", "Chu kỳ", "RUL dự đoán", "Trạng thái", "Quyết định", "Người xác nhận", "Ghi chú"],
    d.decisions.map((r) => [r.thoi_gian, r.dong_co, r.chu_ky, r.rul_du_doan, r.trang_thai, r.quyet_dinh, r.nguoi_xac_nhan, `"${String(r.ghi_chu).replace(/"/g, '""')}"`]));
}

function monitorHtml(d, fails) {
  const cards = d.rules.map((r) => {
    const def = RULE_DEF[r.key];
    return `<section class="panel rule ${r.status}"><div class="rule-top"><span class="lab">${def.lab}</span>${chipOf(r.status)}</div>
      <div class="big">${def.val(r)}</div><span class="t-cap">${def.lim(r)}</span></section>`;
  }).join("");
  const retrain = fails.length
    ? `<section class="panel panel-pad notice crit"><h2 class="t-h3">Đề xuất huấn luyện lại</h2><p>Quy tắc không đạt: ${fails.map((r) => RULE_DEF[r.key].lab.toLowerCase()).join("; ")}. Thu thập dữ liệu có nhãn cho điều kiện mới, chạy lại Notebook 02 đến 04 và nghiệm thu lại trước khi thay mô hình đang chạy.</p></section>`
    : `<section class="panel panel-pad notice"><h2 class="t-h3">Chưa cần huấn luyện lại</h2><p>Huấn luyện lại được đề xuất khi có ít nhất một quy tắc không đạt. Bước này hiện làm thủ công bằng Notebook 02 đến 04.</p></section>`;
  const log = d.decisions.length
    ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:160px">Thời gian</th><th style="width:90px">Động cơ</th><th class="r" style="width:110px">RUL lúc đó</th><th style="width:120px">Trạng thái</th><th style="width:170px">Quyết định</th><th style="width:160px">Người xác nhận</th><th>Ghi chú</th></tr></thead><tbody>
      ${d.decisions.map((r) => `<tr><td class="num">${esc(r.thoi_gian)}</td><td><a class="engine-id" href="#/engine/${r.dong_co}">#${r.dong_co}</a></td><td class="r num">${fmt(+r.rul_du_doan)}</td>
        <td>${esc({ CRITICAL: "Nguy cấp", WARNING: "Cảnh báo", HEALTHY: "Bình thường" }[r.trang_thai] || r.trang_thai)}</td><td>${esc(r.quyet_dinh)}</td><td>${esc(r.nguoi_xac_nhan)}</td><td class="muted">${esc(r.ghi_chu)}</td></tr>`).join("")}
      </tbody></table></div>`
    : `<div class="state-box"><div class="t-h3">Chưa có quyết định nào</div><p>Kỹ sư xác nhận khuyến nghị ở màn Động cơ. Quyết định được lưu vào nhật ký này.</p></div>`;
  return `<div class="rules">${cards}</div>${retrain}
    <div class="grid-2m">
      <section class="panel panel-pad"><div class="panel-head"><h2 class="t-h3">Số đo ngoài vùng huấn luyện, theo cảm biến</h2><span class="t-cap">Vạch dọc là giới hạn ${pct(d.rules[0].limit, 0)}</span></div>${driftBars(d.drift, d.rules[0].limit)}</section>
      <section class="panel"><div class="listhead"><h2 class="t-h3">Nhật ký quyết định của kỹ sư</h2>${d.decisions.length ? `<button class="btn" id="log-csv">Xuất CSV</button>` : ""}</div>${log}</section>
    </div>`;
}

function acceptanceHtml(d) {
  const models = ["Linear Regression", "Random Forest", "LSTM"];
  const accRows = CRITERIA.map(([k, lab, lvl]) => `<tr><td>${lab}</td><td class="muted">${lvl}</td>${models.map((m) => `<td class="${m === d.final_model ? "final" : ""}">${d.acceptance[m][k] ? chipOf("ok") : chipOf("fail")}</td>`).join("")}</tr>`).join("");
  const allRow = `<tr class="total"><td>Đạt tất cả tiêu chí</td><td></td>${models.map((m) => { const ok = Object.values(d.acceptance[m]).every(Boolean); return `<td class="${m === d.final_model ? "final" : ""}">${ok ? chipOf("ok") : chipOf("fail")}</td>`; }).join("")}</tr>`;
  const cmp = d.compare.map((r) => `<tr class="${r.model === d.final_model ? "final-row" : ""}"><td>${esc(r.model)}${r.model === d.final_model ? ` <span class="chip ok">Đang triển khai</span>` : ""}</td>
    <td class="r num">${fmt(r.MAE)}</td><td class="r num">${fmt(r.RMSE)}</td><td class="r num">${fmt(r.R2, 2)}</td><td class="r num">${fmt(r.NASA_score, 0)}</td>
    <td class="r num">${r.recall === null ? "—" : pct(r.recall, 0)}</td><td class="r num">${r.false_alarm === null ? "—" : pct(r.false_alarm)}</td><td class="r num">${r.latency_ms === null ? "—" : fmt(r.latency_ms)}</td></tr>`).join("");
  const fm = d.final_model, best = d.compare.find((r) => r.model === fm), base = d.compare.find((r) => r.model.startsWith("Baseline"));
  const stage = d.stage_mae[fm], stKeys = Object.keys(stage);
  const pol = d.policy, prKey = `Predictive - ${fm}`, pvKey = Object.keys(pol).find((k) => k.startsWith("Preventive"));
  const polRows = [["Reactive", "Chạy đến khi hỏng"], [pvKey, "Định kỳ, mốc " + d.assumptions.preventive_interval_T + " chu kỳ"], [prKey, `Theo dự đoán ${fm}`]].map(([k, lab]) => `<tr><td>${lab}</td>
    <td class="r num">${pol[k].Su_co_ngoai_ke_hoach}/${d.assumptions.n_engines}</td><td class="r num">${fmt(pol[k]["Ti_le_su_dung_tuoi_tho_%"], 0)}%</td><td class="r num">${fmt(pol[k].Chi_phi_tren_1000_chu_ky)}</td></tr>`).join("");
  const rob = d.robustness, robKeys = [["Nhieu 0%", "Dữ liệu gốc"], ["Nhieu 5%", "Thêm nhiễu 5%"], ["Nhieu 10%", "Thêm nhiễu 10%"], ["Mat 30% du lieu", "Mất 30% số đo"], [Object.keys(rob).find((k) => k.startsWith("FD002")), "Dữ liệu FD002"]];
  return `
    <section class="panel"><div class="listhead"><h2 class="t-h2">Tiêu chí chấp nhận</h2><span class="t-cap">Đặt trước khi đánh giá, kiểm tra trên 100 động cơ test</span></div>
      <div class="tbl-wrap"><table class="tbl acc"><thead><tr><th>Tiêu chí</th><th style="width:110px">Mức</th>${models.map((m) => `<th style="width:150px" class="${m === d.final_model ? "final" : ""}">${m}</th>`).join("")}</tr></thead><tbody>${accRows}${allRow}</tbody></table></div></section>
    <section class="panel" style="margin-top:var(--s5)"><div class="listhead"><h2 class="t-h2">So sánh mô hình trên tập test</h2><span class="t-cap">RUL thật giới hạn 125 · cảnh báo khi RUL ≤ 30</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:250px">Mô hình</th><th class="r">MAE</th><th class="r">RMSE</th><th class="r">R²</th><th class="r" data-tip="Phạt nặng dự đoán muộn hơn dự đoán sớm. Càng thấp càng tốt.">NASA score</th><th class="r">Bắt đúng nguy cấp</th><th class="r">Báo động giả</th><th class="r">Thời gian (ms)</th></tr></thead><tbody>${cmp}</tbody></table></div></section>
    <div class="levels">
      <section class="panel panel-pad"><span class="t-label muted">Mức mô hình</span><div class="lv-big">${fmt(best.RMSE)} <small>RMSE, chu kỳ</small></div>
        <p class="t-cap">Baseline dự đoán trung bình: ${fmt(base.RMSE)}</p>
        <div class="lv-list">${stKeys.map((k, i) => `<div><span>${["RUL 0–30", "RUL 31–60", "RUL 61–125"][i]}</span><b class="num">MAE ${fmt(stage[k])}</b></div>`).join("")}</div></section>
      <section class="panel panel-pad"><span class="t-label muted">Mức hệ thống</span><div class="lv-big">${pct(best.recall, 0)} <small>bắt đúng nguy cấp</small></div>
        <p class="t-cap">Ngưỡng cảnh báo RUL ≤ 30 chu kỳ</p>
        <div class="lv-list"><div><span>Báo động giả</span><b class="num">${pct(best.false_alarm)}</b></div><div><span>Thời gian một lần dự đoán</span><b class="num">${fmt(best.latency_ms)} ms</b></div></div></section>
      <section class="panel panel-pad"><span class="t-label muted">Mức công nghiệp</span><div class="lv-big">${pol[prKey].Su_co_ngoai_ke_hoach} <small>sự cố ngoài kế hoạch</small></div>
        <p class="t-cap">Mô phỏng ${d.assumptions.n_engines} động cơ validation, chi phí giả định ${d.assumptions.cost_planned} : ${d.assumptions.cost_unplanned}</p>
        <div class="tbl-wrap"><table class="tbl mini"><thead><tr><th>Chiến lược</th><th class="r">Sự cố</th><th class="r">Tuổi thọ dùng</th><th class="r">Chi phí / 1.000 chu kỳ</th></tr></thead><tbody>${polRows}</tbody></table></div></section>
    </div>
    <div class="grid-2m">
      <section class="panel"><div class="listhead"><h2 class="t-h3">Độ bền của ${esc(fm)} khi dữ liệu xấu đi</h2></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tình huống</th><th class="r" style="width:160px">RMSE (chu kỳ)</th></tr></thead><tbody>
        ${robKeys.map(([k, lab]) => `<tr><td>${lab}</td><td class="r num">${fmt(rob[k][fm])}</td></tr>`).join("")}</tbody></table></div></section>
      <section class="panel panel-pad"><h2 class="t-h3" style="margin-bottom:var(--s3)">Giới hạn đã biết</h2><ul class="limits">${LIMITS.map((t) => `<li>${t}</li>`).join("")}</ul></section>
    </div>
    <p class="srcnote">Số liệu lấy từ reports/metrics.json do Notebook 04 tạo ra.</p>`;
}

// Bo dinh tuyen
function route() {
  if (view._cleanup) { view._cleanup(); view._cleanup = null; }
  hideTip();
  const [, page, arg] = (location.hash || "#/").split("/");
  const name = page === "engine" ? "engine" : page === "upload" ? "upload" : page === "model" ? "model" : "overview";
  document.querySelectorAll(".nav a").forEach((a) => (a.dataset.nav === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  window.scrollTo(0, 0);
  if (name === "engine") viewEngine(arg); else if (name === "upload") viewUpload(); else if (name === "model") viewModel(arg); else viewOverview();
  document.title = { overview: "Tổng quan", engine: arg ? `Động cơ #${arg}` : "Động cơ", upload: "Dữ liệu mới", model: arg === "acceptance" ? "Nghiệm thu mô hình" : "Giám sát mô hình" }[name] + " · Engine Health";
}
addEventListener("hashchange", route);
route();
