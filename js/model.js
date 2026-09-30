// CycloneShield AI — physics-informed hazard & impact engine (runs fully in the browser)
// 1. Parametric wind field: normalised Holland (1980) profile + forward-motion asymmetry
// 2. Storm surge: pressure-deficit/shelf-amplification surge with alongshore & right-of-track weighting,
//    tide + wave set-up, and inland attenuation vs ground elevation  -> inundation depth
// 3. Rainfall: R-CLIPER–style radial rain-rate model integrated hourly along the track
// 4. Damage pathways: lognormal fragility curves per asset type (wind / flood / rain)
//    + cascading dependencies (grid -> hospitals, water, telecom; roads -> shelter access)
// 5. Ensemble (Monte-Carlo track & intensity perturbation) -> exceedance probabilities

const KT = 0.514444, R_EARTH = 6371;
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

function haversine(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}
function bearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
function offsetPoint(lat, lon, brgDeg, distKm) {
  const d = distKm / R_EARTH, b = rad(brgDeg), la = rad(lat), lo = rad(lon);
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return [deg(la2), deg(lo2)];
}
function normCdf(x) { // Abramowitz-Stegun erf approximation
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return 0.5 * (1 + Math.sign(x) * y);
}
const fragility = (x, [median, beta]) => x <= 0 ? 0 : normCdf(Math.log(x / median) / beta);

// ---------- Track handling ----------
function perturbTrack(track, { shiftKm = 0, intensity = 1, timeShift = 0 } = {}) {
  return track.map((p, i) => {
    const a = track[Math.max(0, i - 1)], b = track[Math.min(track.length - 1, i + 1)];
    const hdg = bearing(a.lat, a.lon, b.lat, b.lon);
    const [lat, lon] = shiftKm ? offsetPoint(p.lat, p.lon, hdg + 90, shiftKm) : [p.lat, p.lon];
    const v = p.v * intensity;
    return { ...p, t: p.t + timeShift, lat, lon, v, p: 1010 - (1010 - p.p) * intensity };
  });
}

function customTrack({ lat, lon, heading, vmax, speed }) {
  // Build a straight synthetic track that makes landfall at (lat, lon) at t=0
  const pts = [];
  for (let t = -72; t <= 36; t += 6) {
    const [la, lo] = offsetPoint(lat, lon, heading, speed * t);
    const land = t > 0;
    const v = land ? Math.max(30, vmax * Math.exp(-0.095 * t)) : vmax * (t < -48 ? 0.85 : 1); // Kaplan-DeMaria-style decay
    const p = 1010 - 0.0048 * Math.pow(v, 2) * 1.6; // wind-pressure relation (approx., kt)
    pts.push({ t, lat: la, lon: lo, v, p: Math.min(1004, p), rm: 25 + (land ? t * 1.2 : 0) });
  }
  return pts;
}

function stateAt(track, t) {
  if (t <= track[0].t) return { ...track[0], ...motion(track, 0) };
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i], b = track[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t);
      const s = { t, lat: a.lat + f * (b.lat - a.lat), lon: a.lon + f * (b.lon - a.lon), v: a.v + f * (b.v - a.v), p: a.p + f * (b.p - a.p), rm: a.rm + f * (b.rm - a.rm) };
      return { ...s, ...motion(track, i) };
    }
  }
  return { ...track[track.length - 1], ...motion(track, track.length - 2) };
}
function motion(track, i) {
  const a = track[i], b = track[Math.min(i + 1, track.length - 1)];
  const dist = haversine(a.lat, a.lon, b.lat, b.lon), dt = Math.max(1, b.t - a.t);
  return { heading: bearing(a.lat, a.lon, b.lat, b.lon), vt: dist / dt / 3.6 }; // vt in m/s
}

// ---------- Hazards ----------
function windAt(s, lat, lon, coastKm = 0) {
  const r = Math.max(1, haversine(s.lat, s.lon, lat, lon));
  const vmax = s.v * KT;
  const B = Math.min(2.5, Math.max(1.0, 1.5 + (980 - s.p) / 120));
  const x = Math.pow(s.rm / r, B);
  let v = vmax * Math.sqrt(x * Math.exp(1 - x));
  // Northern-hemisphere asymmetry: stronger to the right of motion
  const theta = rad(bearing(s.lat, s.lon, lat, lon) - s.heading);
  v += 0.5 * s.vt * Math.sin(theta) * Math.min(1, r / s.rm);
  const landFactor = 1 - 0.22 * Math.min(1, coastKm / 40); // surface roughness inland
  return Math.max(0, v * landFactor);
}

function surgeAt(track, landfall, asset, tide) {
  const dP = Math.max(0, 1010 - landfall.p);
  const peak = 0.033 * dP * asset.shelf + 0.012 * landfall.v * KT * 0.5; // pressure + wind set-up (m)
  const d = haversine(landfall.lat, landfall.lon, asset.lat, asset.lon);
  const theta = rad(bearing(landfall.lat, landfall.lon, asset.lat, asset.lon) - landfall.heading);
  const right = Math.sin(theta) > 0 ? 1 : 0.4;
  const along = Math.exp(-Math.pow(d / (3.2 * landfall.rm), 2)) * right;
  const coastalLevel = peak * along + tide;
  const level = coastalLevel * Math.exp(-asset.coast / (5 * asset.shelf));
  // inundation of the low-lying fringe of each settlement (≈60% of its mean elevation)
  return { surge: peak * along, level, depth: Math.max(0, level - 0.6 * asset.elev) };
}

function rainRate(s, lat, lon) { // mm/h
  const r = haversine(s.lat, s.lon, lat, lon);
  const r0 = 2 + 0.14 * s.v * KT;
  return r <= s.rm ? r0 : r0 * Math.exp(-(r - s.rm) / 100);
}

// ---------- Full scenario run ----------
function runScenario(track, opts = {}) {
  const tide = opts.tide ?? 0.8;
  const lfIdx = track.findIndex(p => p.t === 0);
  const t0 = track[0].t, t1 = track[track.length - 1].t;
  const landfall = stateAt(track, 0);
  const states = [];
  for (let t = t0; t <= t1; t += 1) states.push(stateAt(track, t));

  const assets = opts.assets.map(a => {
    let maxW = 0, rain = 0, onset = null;
    for (const s of states) {
      const w = windAt(s, a.lat, a.lon, a.coast);
      if (w > maxW) maxW = w;
      if (onset === null && w >= 17.5) onset = s.t; // gale force (34 kt)
      rain += rainRate(s, a.lat, a.lon);
    }
    const sg = surgeAt(track, landfall, a, tide);
    const T = ASSET_TYPES[a.type];
    const pw = fragility(maxW, T.wind), pf = fragility(sg.depth, T.flood), pr = fragility(rain, T.rain);
    const pDirect = 1 - (1 - pw) * (1 - pf) * (1 - pr);
    const driver = [["wind", pw], ["storm-surge flooding", pf], ["rainfall flooding", pr]].sort((x, y) => y[1] - x[1])[0][0];
    return { ...a, maxWind: maxW, rain, surge: sg.surge, depth: sg.depth, onset, pw, pf, pr, pDirect, driver };
  });

  // Cascading dependencies
  const byTown = {};
  assets.forEach(a => { if (a.town) (byTown[a.town] ||= []).push(a); });
  const roads = assets.filter(a => a.type === "road");
  assets.forEach(a => {
    let p = a.pDirect, cascade = null;
    if (ASSET_TYPES[a.type].power && a.town) {
      const subs = byTown[a.town].filter(x => x.type === "substation");
      const pSub = subs.length ? Math.min(...subs.map(x => x.pDirect)) : 0;
      const pc = 1 - (1 - p) * (1 - 0.6 * pSub); // 40% have backup generation
      if (pc - p > 0.1) cascade = `grid outage (substation ${Math.round(pSub * 100)}%)`;
      p = pc;
    }
    if (a.type === "shelter" && a.town) {
      const rds = roads.filter(r => r.towns.includes(a.town));
      const pRoad = rds.length ? Math.max(...rds.map(r => r.pDirect)) : 0;
      const pc = 1 - (1 - p) * (1 - 0.5 * pRoad);
      if (pc - p > 0.1) cascade = `access road cut (${Math.round(pRoad * 100)}%)`;
      p = pc;
    }
    a.pService = p; a.cascade = cascade;
    a.risk = Math.round(100 * p * ASSET_TYPES[a.type].crit * Math.min(1, Math.log10(a.served + 10) / 6));
  });

  // Town / district roll-up
  const towns = TOWNS.map(tw => {
    const probe = { ...tw, type: "shelter" };
    let maxW = 0, rain = 0, onset = null;
    for (const s of states) {
      const w = windAt(s, tw.lat, tw.lon, tw.coast);
      if (w > maxW) maxW = w;
      if (onset === null && w >= 17.5) onset = s.t;
      rain += rainRate(s, tw.lat, tw.lon);
    }
    const sg = surgeAt(track, landfall, probe, tide);
    const kutcha = 0.35; // share of vulnerable (kutcha) housing — from Census HLO, configurable
    const evacFrac = Math.min(1, (sg.depth > 0.3 ? 1 : sg.depth / 0.3) + (maxW >= 42 ? 1 : maxW >= 33 ? 0.6 : maxW >= 25 ? 0.25 : 0) * kutcha);
    const evac = Math.round(tw.pop * evacFrac * (tw.coast < 20 ? 1 : 0.35));
    const shelters = (byTown[tw.id] || []).filter(a => a.type === "shelter");
    const cap = shelters.reduce((s, a) => s + a.capacity * (1 - a.pService), 0) * 6; // incl. schools/public buildings
    let level = "Green";
    if (maxW >= 17.5 || rain >= 115) level = "Yellow";
    if (maxW >= 28 || sg.depth > 0.3 || rain >= 204) level = "Orange";
    if (maxW >= 42 || sg.depth > 1.0) level = "Red";
    return { ...tw, maxWind: maxW, rain, surge: sg.surge, depth: sg.depth, onset, evac, shelterCap: Math.round(cap), level,
      evacDeadline: onset !== null ? onset - 6 : null };
  });

  // Parametric insurance
  const payouts = POLICIES.map(p => {
    let maxW = 0; for (const s of states) maxW = Math.max(maxW, windAt(s, p.lat, p.lon, 2));
    const tier = [...PAYOUT_TIERS].reverse().find(tr => maxW >= tr.wind);
    return { ...p, maxWind: maxW, tier: tier ? tier.label : "No trigger", payout: tier ? p.sum * tier.pct : 0 };
  });

  return { track, landfall, states, assets, towns, payouts, lfIdx };
}

// ---------- Ensemble for uncertainty ----------
function runEnsemble(track, opts, members = 30, leadHours = 48) {
  const r = _rng(7);
  const gauss = () => { let u = 0, v = 0; while (!u) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const sigmaKm = 25 + leadHours * 1.1;  // ~IMD mean track error growth
  const counts = Object.fromEntries(TOWNS.map(t => [t.id, { w33: 0, d05: 0 }]));
  const tracks = [];
  for (let m = 0; m < members; m++) {
    const tr = perturbTrack(track, { shiftKm: gauss() * sigmaKm, intensity: 1 + gauss() * 0.1 });
    tracks.push(tr);
    const lf = stateAt(tr, 0);
    TOWNS.forEach(tw => {
      let maxW = 0;
      for (let t = -24; t <= 24; t += 2) maxW = Math.max(maxW, windAt(stateAt(tr, t), tw.lat, tw.lon, tw.coast));
      const sg = surgeAt(tr, lf, tw, opts.tide ?? 0.8);
      if (maxW >= 33) counts[tw.id].w33++;
      if (sg.depth >= 0.5) counts[tw.id].d05++;
    });
  }
  const prob = {};
  Object.entries(counts).forEach(([k, c]) => prob[k] = { w33: c.w33 / members, d05: c.d05 / members });
  return { prob, tracks, sigmaKm };
}

// Wind-field grid for the map
function windGrid(s, bbox = [16.5, 82.5, 25, 91], step = 0.2) {
  const cells = [];
  for (let la = bbox[0]; la < bbox[2]; la += step)
    for (let lo = bbox[1]; lo < bbox[3]; lo += step) {
      const w = windAt(s, la + step / 2, lo + step / 2, 0);
      if (w >= 12) cells.push({ la, lo, w });
    }
  return cells;
}
