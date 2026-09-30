// CycloneShield AI — UI controller
const $ = s => document.querySelector(s);
const fmt = n => Math.round(n).toLocaleString("en-IN");
const inr = n => "₹" + (n / 1e7).toFixed(2) + " Cr";
const tLab = t => `T${t >= 0 ? "+" : ""}${t}h`;
const colorP = p => p > 0.6 ? "#ef4444" : p > 0.3 ? "#f5a524" : "#9bcf53";
// Warm sequential ramp (no blue): sand → amber → ember → red → oxblood
const windColor = w => w < 17 ? "#fef3c7" : w < 25 ? "#fcd34d" : w < 33 ? "#f59e0b" : w < 42 ? "#ea580c" : w < 50 ? "#dc2626" : "#7f1d1d";

const ASSETS = buildAssets();
let RESULT = null, ENS = null, TRACK = null, SCN_NAME = "", ADVICE = null;
const dispatchLog = [];

// ---------- Map ----------
const map = L.map("map", { zoomControl: true, preferCanvas: true }).setView([20.3, 86.8], 7);
// ---- Base maps: offline outline (always), Esri dark (no key), Google Maps (with API key) ----
map.createPane("land"); map.getPane("land").style.zIndex = 150;
const landLayer = L.geoJSON(LAND_GEOJSON, { pane: "land", style: { color: "#4a4238", weight: 1, fillColor: "#1d1a17", fillOpacity: 1 }, interactive: false }).addTo(map);
const esriDark = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { attribution: "Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap · Natural Earth", maxZoom: 16 });
// Google dark style with warm tones — water is charcoal, not blue
const GOOGLE_DARK = [
  { elementType: "geometry", stylers: [{ color: "#1d1a17" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#a39a8e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#141210" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f0e0c" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#5c544a" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#3a332c" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#6b5a3e" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#5c544a" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] }
];
let baseLayer = null, googleLoading = null;
const store = { get: k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
function mapsKey() {
  const url = new URLSearchParams(location.search).get("mapsKey");
  return (url || store.get("cs_maps_key") || (window.CONFIG && CONFIG.GOOGLE_MAPS_API_KEY) || "").trim();
}
function loadGoogleMaps(key) {
  if (window.google && google.maps) return Promise.resolve();
  if (googleLoading) return googleLoading;
  googleLoading = new Promise((res, rej) => {
    window.__gmReady = res;
    window.gm_authFailure = () => { setMapsMsg("Google rejected this key — check billing, 'Maps JavaScript API' and website restrictions.", true); setBasemap("dark"); };
    const sc = document.createElement("script");
    sc.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__gmReady&loading=async&v=weekly`;
    sc.async = true; sc.onerror = () => { googleLoading = null; rej(new Error("Could not load Google Maps")); };
    document.head.appendChild(sc);
  });
  return googleLoading;
}
function setMapsMsg(t, bad) { const m = $("#mapsKeyMsg"); if (m) { m.textContent = t; m.className = "hint " + (bad ? "keybad" : "keyok"); } }
async function setBasemap(kind) {
  if (baseLayer) { map.removeLayer(baseLayer); baseLayer = null; }
  $("#basemap").value = kind;
  if (kind === "offline") return;
  if (kind === "dark") { baseLayer = esriDark.addTo(map); return; }
  const key = mapsKey();
  if (!key) { setMapsMsg("Paste a Google Maps API key below first.", true); $("#basemap").value = "dark"; baseLayer = esriDark.addTo(map); return; }
  try {
    await loadGoogleMaps(key);
    const type = kind.split("-")[1];
    baseLayer = L.gridLayer.googleMutant({ type, styles: type === "roadmap" ? GOOGLE_DARK : [], maxZoom: 20 }).addTo(map);
    setMapsMsg(`Google Maps (${type}) active.`, false);
  } catch (e) { setMapsMsg(e.message, true); $("#basemap").value = "dark"; baseLayer = esriDark.addTo(map); }
}
const L_wind = L.layerGroup().addTo(map), L_track = L.layerGroup().addTo(map), L_ens = L.layerGroup().addTo(map),
      L_assets = L.layerGroup().addTo(map), L_surge = L.layerGroup().addTo(map), L_storm = L.layerGroup().addTo(map);
L.control.layers(null, { "Wind field": L_wind, "Storm surge / inundation": L_surge, "Ensemble tracks": L_ens, "Infrastructure": L_assets }, { collapsed: true }).addTo(map);

function currentTrack() {
  const s = $("#scenario").value;
  let base;
  if (s === "custom") {
    base = customTrack({ lat: +$("#cLat").value, lon: +$("#cLon").value, heading: +$("#cHdg").value, vmax: +$("#cV").value, speed: +$("#cSpd").value });
    SCN_NAME = `Custom cyclone (${$("#cV").value} kt, landfall ${$("#cLat").value}N ${$("#cLon").value}E)`;
  } else { base = SCENARIOS[s].track; SCN_NAME = SCENARIOS[s].name; }
  return perturbTrack(base, { shiftKm: +$("#shift").value, intensity: +$("#intensity").value / 100 });
}

function run() {
  $("#intV").textContent = $("#intensity").value + "%";
  $("#shiftV").textContent = $("#shift").value + " km";
  $("#tideV").textContent = (+$("#tide").value).toFixed(1) + " m";
  TRACK = currentTrack();
  const opts = { assets: ASSETS, tide: +$("#tide").value };
  RESULT = runScenario(TRACK, opts);
  ENS = $("#ensemble").checked ? runEnsemble(TRACK, opts, 30, 48) : null;
  $("#tSlider").min = TRACK[0].t; $("#tSlider").max = TRACK[TRACK.length - 1].t;
  const mn = TRACK[0].t, mx = TRACK[TRACK.length - 1].t;
  $("#tlLf").style.left = `calc(${(0 - mn) / (mx - mn) * 100}% + ${7 - 14 * (0 - mn) / (mx - mn)}px)`;
  $("#scnChip").textContent = SCN_NAME;
  drawStatic(); drawTime(); renderPanels();
}

function drawStatic() {
  L_track.clearLayers(); L_ens.clearLayers(); L_assets.clearLayers(); L_surge.clearLayers();
  L.polyline(TRACK.map(p => [p.lat, p.lon]), { color: "#f3eee6", weight: 2.5, dashArray: "6 5" }).addTo(L_track);
  TRACK.forEach(p => L.circleMarker([p.lat, p.lon], { radius: 4, color: windColor(p.v * 0.514), fillOpacity: 1 })
    .bindTooltip(`${tLab(p.t)} · ${Math.round(p.v)} kt · ${Math.round(p.p)} hPa`).addTo(L_track));
  if (ENS) {
    ENS.tracks.forEach(tr => L.polyline(tr.map(p => [p.lat, p.lon]), { color: "#f5a524", weight: 1, opacity: 0.16 }).addTo(L_ens));
    const lf = RESULT.landfall;
    L.circle([lf.lat, lf.lon], { radius: ENS.sigmaKm * 1000 * 1.5, color: "#f5a524", weight: 1.2, dashArray: "4 4", fill: false })
      .bindTooltip("Landfall uncertainty cone (~1.5σ)").addTo(L_ens);
  }
  // Surge/inundation bubbles
  RESULT.towns.filter(t => t.surge > 0.2).forEach(t => {
    L.circle([t.lat, t.lon], { radius: 4000 + t.depth * 9000, color: "#e7dccb", weight: 1, dashArray: "2 3", fillColor: "#e7dccb", fillOpacity: Math.min(0.45, 0.08 + t.depth * 0.18) })
      .bindTooltip(`${t.name}: surge ${t.surge.toFixed(1)} m · inundation ${t.depth.toFixed(1)} m`).addTo(L_surge);
  });
  RESULT.assets.forEach(a => {
    const c = colorP(a.pService);
    const html = `<b>${a.name}</b><br>${a.district}, ${a.state}<br>Service-loss probability: <b style="color:${c}">${Math.round(a.pService * 100)}%</b><br>` +
      `Peak wind ${Math.round(a.maxWind * 3.6)} km/h · Inundation ${a.depth.toFixed(2)} m · Rain ${Math.round(a.rain)} mm<br>Main driver: ${a.driver}${a.cascade ? `<br>Cascade: ${a.cascade}` : ""}` +
      `<br>Gale onset: ${a.onset !== null ? tLab(a.onset) : "—"}`;
    if (a.path) L.polyline(a.path, { color: c, weight: a.pService > 0.3 ? 4 : 2, opacity: 0.85 }).bindPopup(html).addTo(L_assets);
    else L.circleMarker([a.lat, a.lon], { radius: a.type === "hospital" || a.type === "substation" ? 6 : 4.5, color: "#0f0e0c", weight: 1.2, fillColor: c, fillOpacity: 0.95 }).bindPopup(html).addTo(L_assets);
  });
}

function drawTime() {
  const t = +$("#tSlider").value;
  $("#tLabel").textContent = tLab(t);
  const s = stateAt(TRACK, t);
  $("#stormInfo").textContent = `${s.lat.toFixed(2)}°N ${s.lon.toFixed(2)}°E · ${Math.round(s.v)} kt (${Math.round(s.v * 1.852)} km/h) · ${Math.round(s.p)} hPa · moving ${Math.round(s.heading)}° @ ${Math.round(s.vt * 3.6)} km/h`;
  L_wind.clearLayers(); L_storm.clearLayers();
  windGrid(s).forEach(c => L.rectangle([[c.la, c.lo], [c.la + 0.2, c.lo + 0.2]], { stroke: false, fillColor: windColor(c.w), fillOpacity: Math.min(0.55, 0.1 + c.w / 100), interactive: false }).addTo(L_wind));
  L.marker([s.lat, s.lon], { icon: L.divIcon({ className: "", html: '<div class="storm-icon"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#f5a524" stroke-width="2.2" stroke-linecap="round"><path d="M12 12m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0"/><path d="M12 3c-5 0-9 3.2-9 7.5"/><path d="M21 13.5C21 17.8 17 21 12 21"/><path d="M4.5 16.5C6 19 9 20.6 12 21"/><path d="M19.5 7.5C18 5 15 3.4 12 3"/></svg></div>', iconSize: [34, 34], iconAnchor: [17, 17] }) }).addTo(L_storm);
}

// ---------- Panels ----------
function renderPanels() {
  const R = RESULT;
  const evac = R.towns.reduce((s, t) => s + t.evac, 0);
  const red = new Set(R.towns.filter(t => t.level === "Red").map(t => t.district)).size;
  const crit = R.assets.filter(a => a.pService > 0.5).length;
  const pay = R.payouts.reduce((s, p) => s + p.payout, 0);
  const maxSurge = Math.max(...R.towns.map(t => t.surge));
  $("#hdrStats").innerHTML = `<div><b>${Math.round(R.landfall.v * 1.852)} km/h</b><span>Landfall intensity</span></div><div><b>${red}</b><span>Red-alert districts</span></div><div><b>${fmt(evac)}</b><span>To evacuate</span></div><div><b>${crit}</b><span>Assets at risk</span></div><div><b>${inr(pay)}</b><span>Parametric payout</span></div>`;

  const topAssets = R.assets.slice().sort((a, b) => b.risk - a.risk).slice(0, 6);
  const earliest = R.towns.filter(t => t.level === "Red" && t.evacDeadline !== null).sort((a, b) => a.evacDeadline - b.evacDeadline)[0];
  $("#tab-overview").innerHTML = `
    <div class="kpis">
      <div class="kpi"><b>${maxSurge.toFixed(1)} m</b><span>Peak storm surge</span></div>
      <div class="kpi"><b>${fmt(Math.max(...R.towns.map(t => t.rain)))} mm</b><span>Max event rainfall</span></div>
      <div class="kpi"><b>${fmt(evac)}</b><span>People to evacuate</span></div>
      <div class="kpi"><b>${earliest ? tLab(earliest.evacDeadline) : "—"}</b><span>Earliest evacuation deadline ${earliest ? "(" + earliest.name + ")" : ""}</span></div>
    </div>
    <div class="note">${SCN_NAME}. Landfall ${R.landfall.lat.toFixed(2)}°N ${R.landfall.lon.toFixed(2)}°E. ${ENS ? `Ensemble track error σ ≈ ${Math.round(ENS.sigmaKm)} km at 48 h lead.` : ""}</div>
    <h3 class="sec">Highest-risk infrastructure</h3>
    ${topAssets.map(a => `<div class="card" style="padding:8px 10px"><b>${ASSET_TYPES[a.type].icon} ${a.name}</b><div class="hint">${Math.round(a.pService * 100)}% service-loss · driver: ${a.driver}${a.cascade ? " · cascade: " + a.cascade : ""}</div><div class="bar"><i style="width:${a.pService * 100}%;background:${colorP(a.pService)}"></i></div></div>`).join("")}
    <h3 class="sec">Asset exposure by type</h3>
    <table><tr><th>Type</th><th>Assets</th><th>&gt;50% loss</th><th>Mean loss</th></tr>
    ${Object.keys(ASSET_TYPES).map(k => { const xs = R.assets.filter(a => a.type === k); return `<tr><td>${ASSET_TYPES[k].icon} ${ASSET_TYPES[k].label}</td><td>${xs.length}</td><td>${xs.filter(a => a.pService > 0.5).length}</td><td>${Math.round(xs.reduce((s, a) => s + a.pService, 0) / xs.length * 100)}%</td></tr>`; }).join("")}</table>`;

  const order = { Red: 0, Orange: 1, Yellow: 2, Green: 3 };
  $("#tab-districts").innerHTML = `<table class="dt"><tr><th>Town / alert</th><th class="r">Wind<br>km/h</th><th class="r">Surge<br>/ flood m</th><th class="r">Evacuate</th><th class="r">Deadline</th></tr>
    ${R.towns.slice().sort((a, b) => order[a.level] - order[b.level] || b.maxWind - a.maxWind).map(t => `<tr class="click" data-lat="${t.lat}" data-lon="${t.lon}">
      <td><b>${t.name}</b> <span class="pill ${t.level}">${t.level}</span><div class="hint" style="margin:3px 0 0">${Math.round(t.rain)} mm rain${ENS ? ` · P(≥33 m/s) ${Math.round(ENS.prob[t.id].w33 * 100)}%` : ""}</div></td>
      <td class="num r">${Math.round(t.maxWind * 3.6)}</td><td class="num r">${t.surge.toFixed(1)} / ${t.depth.toFixed(1)}</td>
      <td class="num r">${fmt(t.evac)}${t.evac > t.shelterCap && t.evac > 0 ? ' <span title="Shelter capacity shortfall" style="color:var(--red)">⚠</span>' : ""}</td>
      <td class="num r">${t.evacDeadline !== null && t.level !== "Green" ? tLab(t.evacDeadline) : "—"}</td>
</tr>`).join("")}</table>
      <p class="hint">⚠ modelled evacuees exceed functional shelter capacity after damage · Deadline = gale-force onset − 6 h.</p>`;

  $("#tab-assets").innerHTML = `<table><tr><th>Asset</th><th>Loss %</th><th>Driver / cascade</th><th>Risk</th></tr>
    ${R.assets.slice().sort((a, b) => b.risk - a.risk).map(a => `<tr class="click" data-lat="${a.lat}" data-lon="${a.lon}"><td>${ASSET_TYPES[a.type].icon} ${a.name}<div class="hint">wind ${Math.round(a.maxWind * 3.6)} km/h · ${a.depth.toFixed(2)} m · ${Math.round(a.rain)} mm</div></td>
    <td style="color:${colorP(a.pService)};font-weight:700">${Math.round(a.pService * 100)}</td><td>${a.driver}${a.cascade ? `<div class="hint">↳ ${a.cascade}</div>` : ""}</td><td>${a.risk}</td></tr>`).join("")}</table>`;

  $("#tab-insurance").innerHTML = `<div class="note">Parametric triggers pay out on <b>modelled</b> peak wind at the insured location — so liquidity can be released <b>before landfall</b> for evacuation, livestock and boat protection, instead of weeks after loss assessment.</div>
    <div class="kpis"><div class="kpi"><b>${inr(pay)}</b><span>Pre-landfall payout estimate</span></div><div class="kpi"><b>${R.payouts.filter(p => p.payout > 0).length}/${R.payouts.length}</b><span>Policies triggered</span></div></div>
    <table><tr><th>Policy holder</th><th>Peak wind</th><th>Trigger</th><th>Payout</th></tr>${R.payouts.map(p => `<tr><td>${p.holder}<div class="hint">Sum insured ${inr(p.sum)}</div></td><td>${p.maxWind.toFixed(1)} m/s</td><td>${p.tier}</td><td><b>${inr(p.payout)}</b></td></tr>`).join("")}</table>
    <p class="hint">Tiers: ${PAYOUT_TIERS.map(t => t.label + " → " + t.pct * 100 + "%").join(" · ")}</p>`;

  document.querySelectorAll("tr.click").forEach(tr => tr.onclick = () => map.flyTo([+tr.dataset.lat, +tr.dataset.lon], 10));
  if (ADVICE) renderAdvice(ADVICE);
}

// ---------- Advisories ----------
async function generate() {
  const btn = $("#genBtn"); btn.disabled = true; btn.textContent = "Reasoning…";
  const key = $("#gKey").value.trim(), model = $("#gModel").value.trim();
  let out;
  try {
    if (key) {
      let image = null; const f = $("#gImg").files[0];
      if (f) image = await new Promise(res => { const r = new FileReader(); r.onload = () => res({ mime: f.type, b64: r.result.split(",")[1] }); r.readAsDataURL(f); });
      out = await GEMINI.generate({ key, model, prompt: GEMINI.buildPrompt(RESULT, SCN_NAME), image });
      out.source = `Gemini (${model})`;
    } else out = offlineAdvisories(RESULT, SCN_NAME);
  } catch (e) {
    out = offlineAdvisories(RESULT, SCN_NAME); out.source = "offline rule engine (Gemini error: " + e.message.slice(0, 120) + ")";
  }
  ADVICE = out; renderAdvice(out);
  document.querySelector('[data-tab="advisory"]').click();
  btn.disabled = false; btn.textContent = "Generate advisories";
}

function renderAdvice(o) {
  $("#tab-advisory").innerHTML = `<div class="note"><b>Situation</b> — ${o.situation_summary}<br><span class="hint">Source: ${o.source || "Gemini"}</span></div>
    ${o.image_assessment ? `<div class="card"><h4>🛰 Image assessment (multimodal)</h4>${o.image_assessment}</div>` : ""}
    <div class="btnrow" style="margin-bottom:10px"><button id="dispatchAll">📣 Dispatch all Red/Orange</button><button id="dlJson">⬇ JSON</button></div>
    ${(o.advisories || []).map((a, i) => `<div class="card"><h4><span class="pill ${a.alert}">${a.alert}</span> ${a.district}</h4><div>${a.headline}</div>
      <ul>${(a.actions || []).map(x => `<li>${x}</li>`).join("")}</ul>
      <div class="sms"><b>SMS (${a.local_language}):</b> ${a.local_language_sms}</div><div class="sms"><b>SMS (English):</b> ${a.english_sms}</div>
      <div class="btnrow"><button data-cap="${i}">CAP-XML</button><button data-disp="${i}">Dispatch</button></div></div>`).join("")}
    <h3 class="sec">Pre-landfall infrastructure hardening</h3>
    <table><tr><th>Asset</th><th>Action</th><th>By</th></tr>${(o.infrastructure_actions || []).map(x => `<tr><td>${x.asset}</td><td>${x.action}</td><td class="mono">T-${x.deadline_h_before_landfall}h</td></tr>`).join("")}</table>
    <h3 class="sec">Damage pathways</h3><ul>${(o.damage_pathways || []).map(x => `<li>${x}</li>`).join("")}</ul>
    <div class="log" id="log">${dispatchLog.join("<br>") || "Dispatch log — messages go to SACHET/CAP aggregator, cell-broadcast, SMS gateway and district WhatsApp groups (simulated)."}</div>`;
  document.querySelectorAll("[data-cap]").forEach(b => b.onclick = () => showModal(toCAP(o.advisories[+b.dataset.cap], RESULT, +b.dataset.cap)));
  document.querySelectorAll("[data-disp]").forEach(b => b.onclick = () => dispatch(o.advisories[+b.dataset.disp]));
  $("#dispatchAll").onclick = () => o.advisories.filter(a => a.alert !== "Yellow").forEach(dispatch);
  $("#dlJson").onclick = () => { const bl = new Blob([JSON.stringify(o, null, 2)], { type: "application/json" }); const u = URL.createObjectURL(bl); const a = document.createElement("a"); a.href = u; a.download = "cycloneshield-advisories.json"; a.click(); };
}
function dispatch(a) {
  const ts = new Date().toLocaleTimeString("en-IN");
  ["CAP→SACHET", "Cell-broadcast", "SMS gateway", "DDMA WhatsApp"].forEach(ch => dispatchLog.push(`[${ts}] ✓ ${a.alert.toUpperCase()} ${a.district} → ${ch}`));
  const l = $("#log"); if (l) { l.innerHTML = dispatchLog.join("<br>"); l.scrollTop = 1e6; }
}
function showModal(txt) { $("#mBody").textContent = txt; $("#modal").classList.remove("hidden"); }
$("#mClose").onclick = () => $("#modal").classList.add("hidden");

// ---------- Wiring ----------
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll("#tabs button, .tab").forEach(x => x.classList.remove("active"));
  b.classList.add("active"); $("#tab-" + b.dataset.tab).classList.add("active");
});
$("#scenario").onchange = () => {
  $("#customBox").classList.toggle("hidden", $("#scenario").value !== "custom");
  const s = $("#scenario").value; ADVICE = null;
  map.flyTo(s === "amphan" ? [21.9, 88.0] : s === "custom" ? [+$("#cLat").value, +$("#cLon").value] : [20.3, 86.2], 7);
  run();
};
["#intensity", "#shift", "#tide", "#ensemble", "#cLat", "#cLon", "#cHdg", "#cV", "#cSpd"].forEach(id => $(id).addEventListener("change", run));
["#intensity", "#shift", "#tide"].forEach(id => $(id).addEventListener("input", () => { $("#intV").textContent = $("#intensity").value + "%"; $("#shiftV").textContent = $("#shift").value + " km"; $("#tideV").textContent = (+$("#tide").value).toFixed(1) + " m"; }));
$("#tSlider").oninput = drawTime;
$("#genBtn").onclick = generate;
let timer = null;
$("#play").onclick = () => {
  if (timer) { clearInterval(timer); timer = null; $("#play").textContent = "▶"; return; }
  $("#play").textContent = "⏸";
  timer = setInterval(() => { const s = $("#tSlider"); s.value = +s.value >= +s.max ? s.min : +s.value + 2; drawTime(); }, 180);
};
// Map settings
$("#basemap").onchange = e => setBasemap(e.target.value);
$("#mapsKey").value = mapsKey();
$("#mapsKeyBtn").onclick = () => {
  const k = $("#mapsKey").value.trim();
  if (!k) { setMapsMsg("Key is empty.", true); return; }
  store.set("cs_maps_key", k); googleLoading = null;
  setBasemap($("#basemap").value.startsWith("google") ? $("#basemap").value : "google-roadmap");
};
setBasemap(mapsKey() && window.CONFIG && CONFIG.DEFAULT_BASEMAP ? CONFIG.DEFAULT_BASEMAP : (window.CONFIG && CONFIG.DEFAULT_BASEMAP && !CONFIG.DEFAULT_BASEMAP.startsWith("google") ? CONFIG.DEFAULT_BASEMAP : "dark"));
run();
