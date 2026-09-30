// CycloneShield AI — scenario tracks & exposure dataset
// Tracks are approximate reconstructions of IMD best-track data (6-hourly, rounded) for
// demonstration. Exposure assets are an illustrative dataset anchored on real towns; in
// production they are replaced by OpenStreetMap / Bhuvan / GEE exports (see /gee).

const SCENARIOS = {
  fani: {
    name: "ESCS Fani (May 2019) — Odisha",
    landfallIndex: 7,
    // t = hours relative to landfall, v = max sustained wind (kt), p = central pressure (hPa), rm = radius of max wind (km)
    track: [
      { t: -72, lat: 13.0, lon: 86.0, v: 100, p: 955, rm: 30 },
      { t: -60, lat: 14.2, lon: 85.6, v: 115, p: 945, rm: 28 },
      { t: -48, lat: 15.3, lon: 85.2, v: 125, p: 937, rm: 25 },
      { t: -36, lat: 16.6, lon: 84.9, v: 130, p: 934, rm: 24 },
      { t: -24, lat: 17.8, lon: 85.0, v: 125, p: 937, rm: 25 },
      { t: -12, lat: 18.9, lon: 85.3, v: 120, p: 940, rm: 26 },
      { t: -4,  lat: 19.5, lon: 85.6, v: 115, p: 944, rm: 27 },
      { t: 0,   lat: 19.8, lon: 85.8, v: 110, p: 948, rm: 28 },
      { t: 6,   lat: 20.4, lon: 86.1, v: 90,  p: 965, rm: 35 },
      { t: 12,  lat: 21.1, lon: 86.6, v: 70,  p: 980, rm: 45 },
      { t: 18,  lat: 21.9, lon: 87.3, v: 55,  p: 990, rm: 55 },
      { t: 24,  lat: 22.8, lon: 88.2, v: 45,  p: 994, rm: 60 },
      { t: 36,  lat: 24.2, lon: 89.5, v: 35,  p: 998, rm: 70 }
    ]
  },
  amphan: {
    name: "SuCS Amphan (May 2020) — West Bengal",
    landfallIndex: 7,
    track: [
      { t: -72, lat: 13.5, lon: 86.3, v: 140, p: 925, rm: 22 },
      { t: -60, lat: 14.6, lon: 86.4, v: 135, p: 930, rm: 24 },
      { t: -48, lat: 15.9, lon: 86.6, v: 120, p: 940, rm: 28 },
      { t: -36, lat: 17.3, lon: 87.0, v: 110, p: 950, rm: 32 },
      { t: -24, lat: 18.8, lon: 87.4, v: 100, p: 958, rm: 35 },
      { t: -12, lat: 20.3, lon: 87.8, v: 95,  p: 962, rm: 38 },
      { t: -4,  lat: 21.2, lon: 88.0, v: 90,  p: 965, rm: 40 },
      { t: 0,   lat: 21.65, lon: 88.2, v: 85, p: 968, rm: 42 },
      { t: 6,   lat: 22.4, lon: 88.5, v: 70,  p: 978, rm: 48 },
      { t: 12,  lat: 23.2, lon: 88.9, v: 55,  p: 988, rm: 55 },
      { t: 24,  lat: 24.8, lon: 89.5, v: 40,  p: 996, rm: 65 }
    ]
  }
};

// Coastal settlements: elevation (m), distance to coast (km), shelf = continental-shelf
// surge amplification (shallow Sundarbans/Hooghly > steep Andhra), pop = people (approx.)
const TOWNS = [
  { id: "puri",     name: "Puri",            district: "Puri",            state: "Odisha", lat: 19.81, lon: 85.83, elev: 3,  coast: 0.5, shelf: 1.0, pop: 200000, lang: "Odia" },
  { id: "konark",   name: "Konark",          district: "Puri",            state: "Odisha", lat: 19.89, lon: 86.09, elev: 4,  coast: 3,   shelf: 1.0, pop: 17000,  lang: "Odia" },
  { id: "satapada", name: "Satapada (Chilika)", district: "Puri",         state: "Odisha", lat: 19.67, lon: 85.44, elev: 2,  coast: 1.5, shelf: 1.1, pop: 25000,  lang: "Odia" },
  { id: "bbsr",     name: "Bhubaneswar",     district: "Khordha",         state: "Odisha", lat: 20.30, lon: 85.82, elev: 45, coast: 55,  shelf: 1.0, pop: 1000000, lang: "Odia" },
  { id: "cuttack",  name: "Cuttack",         district: "Cuttack",         state: "Odisha", lat: 20.46, lon: 85.88, elev: 36, coast: 65,  shelf: 1.0, pop: 700000, lang: "Odia" },
  { id: "astarang", name: "Astaranga",       district: "Puri",            state: "Odisha", lat: 19.98, lon: 86.37, elev: 2,  coast: 1,   shelf: 1.1, pop: 30000,  lang: "Odia" },
  { id: "jsp",      name: "Jagatsinghpur",   district: "Jagatsinghpur",   state: "Odisha", lat: 20.26, lon: 86.17, elev: 9,  coast: 25,  shelf: 1.2, pop: 60000,  lang: "Odia" },
  { id: "paradip",  name: "Paradip",         district: "Jagatsinghpur",   state: "Odisha", lat: 20.26, lon: 86.67, elev: 3,  coast: 0.5, shelf: 1.3, pop: 70000,  lang: "Odia" },
  { id: "kendra",   name: "Kendrapara",      district: "Kendrapara",      state: "Odisha", lat: 20.50, lon: 86.42, elev: 6,  coast: 30,  shelf: 1.3, pop: 50000,  lang: "Odia" },
  { id: "bhadrak",  name: "Bhadrak",         district: "Bhadrak",         state: "Odisha", lat: 21.06, lon: 86.50, elev: 14, coast: 30,  shelf: 1.3, pop: 110000, lang: "Odia" },
  { id: "balasore", name: "Balasore",        district: "Balasore",        state: "Odisha", lat: 21.49, lon: 86.93, elev: 16, coast: 15,  shelf: 1.4, pop: 145000, lang: "Odia" },
  { id: "gopalpur", name: "Gopalpur",        district: "Ganjam",          state: "Odisha", lat: 19.26, lon: 84.90, elev: 5,  coast: 0.5, shelf: 0.8, pop: 8000,   lang: "Odia" },
  { id: "berham",   name: "Berhampur",       district: "Ganjam",          state: "Odisha", lat: 19.31, lon: 84.79, elev: 24, coast: 12,  shelf: 0.8, pop: 360000, lang: "Odia" },
  { id: "digha",    name: "Digha",           district: "Purba Medinipur", state: "West Bengal", lat: 21.63, lon: 87.51, elev: 4, coast: 0.5, shelf: 1.8, pop: 40000, lang: "Bengali" },
  { id: "contai",   name: "Contai",          district: "Purba Medinipur", state: "West Bengal", lat: 21.78, lon: 87.75, elev: 5, coast: 8,   shelf: 1.8, pop: 95000, lang: "Bengali" },
  { id: "haldia",   name: "Haldia",          district: "Purba Medinipur", state: "West Bengal", lat: 22.03, lon: 88.06, elev: 4, coast: 12,  shelf: 2.2, pop: 200000, lang: "Bengali" },
  { id: "sagar",    name: "Sagar Island",    district: "South 24 Parganas", state: "West Bengal", lat: 21.65, lon: 88.08, elev: 2, coast: 1, shelf: 2.6, pop: 212000, lang: "Bengali" },
  { id: "kakdwip",  name: "Kakdwip",         district: "South 24 Parganas", state: "West Bengal", lat: 21.87, lon: 88.19, elev: 3, coast: 8, shelf: 2.6, pop: 280000, lang: "Bengali" },
  { id: "gosaba",   name: "Gosaba (Sundarbans)", district: "South 24 Parganas", state: "West Bengal", lat: 22.16, lon: 88.80, elev: 2, coast: 20, shelf: 2.8, pop: 250000, lang: "Bengali" },
  { id: "dharbour", name: "Diamond Harbour", district: "South 24 Parganas", state: "West Bengal", lat: 22.19, lon: 88.19, elev: 5, coast: 40, shelf: 2.4, pop: 45000, lang: "Bengali" },
  { id: "kolkata",  name: "Kolkata",         district: "Kolkata",         state: "West Bengal", lat: 22.57, lon: 88.36, elev: 9, coast: 90,  shelf: 2.2, pop: 4500000, lang: "Bengali" },
  { id: "srikak",   name: "Srikakulam",      district: "Srikakulam",      state: "Andhra Pradesh", lat: 18.30, lon: 83.90, elev: 18, coast: 12, shelf: 0.7, pop: 150000, lang: "Telugu" },
  { id: "vizag",    name: "Visakhapatnam",   district: "Visakhapatnam",   state: "Andhra Pradesh", lat: 17.69, lon: 83.22, elev: 10, coast: 1, shelf: 0.6, pop: 2000000, lang: "Telugu" }
];

// Asset archetypes: criticality weight, fragility medians (lognormal) for wind (m/s),
// flood depth (m) and rainfall (mm), and whether the asset depends on grid power.
const ASSET_TYPES = {
  substation: { label: "Power substation",     icon: "⚡", crit: 1.0, wind: [52, 0.25], flood: [0.6, 0.40], rain: [450, 0.40], power: false },
  hospital:   { label: "Hospital / CHC",       icon: "✚", crit: 1.0, wind: [65, 0.30], flood: [1.0, 0.40], rain: [500, 0.40], power: true },
  shelter:    { label: "Cyclone shelter",      icon: "⌂", crit: 0.9, wind: [75, 0.30], flood: [1.5, 0.40], rain: [600, 0.40], power: false },
  road:       { label: "Arterial road link",   icon: "═", crit: 0.8, wind: [42, 0.35], flood: [0.3, 0.50], rain: [260, 0.35], power: false },
  water:      { label: "Water treatment plant",icon: "💧", crit: 0.8, wind: [60, 0.30], flood: [0.8, 0.40], rain: [450, 0.40], power: true },
  telecom:    { label: "Telecom tower",        icon: "📡", crit: 0.7, wind: [48, 0.30], flood: [1.0, 0.40], rain: [600, 0.40], power: true },
  port:       { label: "Port / fishing harbour", icon: "⚓", crit: 0.7, wind: [55, 0.30], flood: [1.5, 0.40], rain: [700, 0.40], power: true }
};

// Deterministic pseudo-random so the dataset is reproducible
function _rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function buildAssets() {
  const r = _rng(42);
  const assets = [];
  TOWNS.forEach(tw => {
    const types = ["substation", "hospital", "shelter", "water", "telecom"];
    if (tw.coast <= 1.5) types.push("port");
    if (tw.pop > 500000) types.push("hospital", "substation");
    types.forEach((ty, i) => {
      const dx = (r() - 0.5) * 0.08, dy = (r() - 0.5) * 0.08;
      assets.push({
        id: `${tw.id}-${ty}-${i}`, type: ty, town: tw.id, name: `${ASSET_TYPES[ty].label} — ${tw.name}`,
        district: tw.district, state: tw.state, lat: tw.lat + dy, lon: tw.lon + dx,
        elev: Math.max(0.5, tw.elev + (r() - 0.5) * 2), coast: Math.max(0.2, tw.coast + (r() - 0.5) * 2),
        shelf: tw.shelf,
        served: Math.round(tw.pop * (ty === "shelter" ? 0.02 : ty === "hospital" ? 0.3 : 0.5)),
        capacity: ty === "shelter" ? 800 + Math.round(r() * 1200) : undefined
      });
    });
  });
  // Arterial road links (NH-16 / NH-116B / SH corridors) between consecutive towns
  const links = [["gopalpur","berham"],["berham","satapada"],["satapada","puri"],["puri","bbsr"],["puri","konark"],["konark","astarang"],["bbsr","cuttack"],["cuttack","jsp"],["jsp","paradip"],["cuttack","kendra"],["kendra","bhadrak"],["bhadrak","balasore"],["balasore","digha"],["digha","contai"],["contai","haldia"],["haldia","kolkata"],["kolkata","dharbour"],["dharbour","kakdwip"],["kakdwip","sagar"],["dharbour","gosaba"],["srikak","berham"],["vizag","srikak"]];
  const T = Object.fromEntries(TOWNS.map(t => [t.id, t]));
  links.forEach(([a, b]) => {
    const A = T[a], B = T[b];
    assets.push({
      id: `road-${a}-${b}`, type: "road", name: `Road link ${A.name} ↔ ${B.name}`, district: A.district, state: A.state,
      lat: (A.lat + B.lat) / 2, lon: (A.lon + B.lon) / 2, path: [[A.lat, A.lon], [B.lat, B.lon]],
      elev: (A.elev + B.elev) / 2, coast: Math.min(A.coast, B.coast) + 2, shelf: (A.shelf + B.shelf) / 2,
      served: Math.round((A.pop + B.pop) * 0.15), towns: [a, b]
    });
  });
  return assets;
}

// Parametric insurance policies (e.g. state disaster risk pools, fisher cooperatives,
// MSME clusters). Payout triggers on modelled peak 1-min wind at the insured point.
const POLICIES = [
  { id: "P1", holder: "Puri Fisher Cooperative",           lat: 19.80, lon: 85.85, sum: 50000000,  },
  { id: "P2", holder: "Paradip MSME Cluster",              lat: 20.27, lon: 86.65, sum: 120000000, },
  { id: "P3", holder: "Ganjam Salt Farmers Collective",    lat: 19.30, lon: 84.88, sum: 30000000,  },
  { id: "P4", holder: "Sundarbans Women SHG Federation",   lat: 22.10, lon: 88.70, sum: 40000000,  },
  { id: "P5", holder: "Digha Hospitality Association",     lat: 21.63, lon: 87.52, sum: 80000000,  },
  { id: "P6", holder: "Balasore Horticulture FPO",         lat: 21.48, lon: 86.92, sum: 25000000,  }
];
const PAYOUT_TIERS = [ { wind: 33, pct: 0.25, label: "Tier 1 (≥33 m/s, SCS)" }, { wind: 42, pct: 0.5, label: "Tier 2 (≥42 m/s, VSCS)" }, { wind: 50, pct: 1.0, label: "Tier 3 (≥50 m/s, ESCS)" } ];
