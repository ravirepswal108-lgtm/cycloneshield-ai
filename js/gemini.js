// CycloneShield AI — Gemini multimodal reasoning layer + advisory dispatch
// Calls the Gemini API (Google AI Studio key, kept only in the user's browser memory).
// If no key is supplied, a deterministic rule-based generator produces the same advisory schema,
// so the prototype is always demo-able offline.

const GEMINI = {
  endpoint: (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,

  async generate({ key, model, prompt, image }) {
    const parts = [{ text: prompt }];
    if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.b64 } });
    const res = await fetch(this.endpoint(model, key), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0.3, responseMimeType: "application/json" } })
    });
    if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    const txt = j.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
    return JSON.parse(txt.replace(/^```json|```$/g, "").trim());
  },

  buildPrompt(result, scenarioName) {
    const towns = result.towns.filter(t => t.level !== "Green").map(t => ({
      town: t.name, district: t.district, state: t.state, language: t.lang, alert: t.level,
      peak_wind_ms: +t.maxWind.toFixed(1), storm_surge_m: +t.surge.toFixed(2), inundation_depth_m: +t.depth.toFixed(2),
      rainfall_mm: Math.round(t.rain), gale_onset_h_rel_landfall: t.onset, evacuate_people: t.evac, shelter_capacity: t.shelterCap
    }));
    const critical = result.assets.filter(a => a.pService > 0.35).sort((a, b) => b.risk - a.risk).slice(0, 15).map(a => ({
      asset: a.name, p_service_loss: +a.pService.toFixed(2), main_driver: a.driver, cascade: a.cascade
    }));
    return `You are the decision-support officer of a State Emergency Operations Centre (India, Bay of Bengal).
A physics-based model produced this pre-landfall impact forecast for ${scenarioName}.
Landfall: ${result.landfall.lat.toFixed(2)}N ${result.landfall.lon.toFixed(2)}E, ${Math.round(result.landfall.v)} kt, ${Math.round(result.landfall.p)} hPa.
TOWNS: ${JSON.stringify(towns)}
CRITICAL_INFRASTRUCTURE_AT_RISK: ${JSON.stringify(critical)}
If an image is attached, it is a satellite/radar/photo observation: describe what it shows and whether it changes the risk picture.
Return STRICT JSON: {"situation_summary": string (<=80 words),
"image_assessment": string or null,
"advisories": [{"district": string, "alert": "Red|Orange|Yellow", "headline": string, "actions": [string x3-5], "local_language": string, "local_language_sms": string (<=300 chars, in that language's script), "english_sms": string (<=300 chars)}],
"infrastructure_actions": [{"asset": string, "action": string, "deadline_h_before_landfall": number}],
"damage_pathways": [string x3] }
Follow IMD/NDMA terminology. Be specific with times relative to landfall (T-hours).`;
  }
};

// ---------- Offline rule-based generator (same schema) ----------
const LOCAL_SMS = {
  Odia: d => `ସତର୍କତା: ${d} ରେ ଘୂର୍ଣ୍ଣିବାତ୍ୟା। ତୁରନ୍ତ ନିକଟସ୍ଥ ବାତ୍ୟା ଆଶ୍ରୟସ୍ଥଳୀକୁ ଯାଆନ୍ତୁ। ମାଛ ଧରିବାକୁ ସମୁଦ୍ରକୁ ଯାଆନ୍ତୁ ନାହିଁ। ସାହାଯ୍ୟ: 1070`,
  Bengali: d => `সতর্কতা: ${d} এলাকায় ঘূর্ণিঝড়। অবিলম্বে নিকটতম ত্রাণ শিবিরে যান। সমুদ্রে মাছ ধরতে যাবেন না। সাহায্য: 1070`,
  Telugu: d => `హెచ్చరిక: ${d} లో తుఫాను. వెంటనే సమీప తుఫాను ఆశ్రయానికి వెళ్ళండి. చేపల వేటకు సముద్రంలోకి వెళ్ళవద్దు. సహాయం: 1070`
};

function offlineAdvisories(result, scenarioName) {
  const byDist = {};
  result.towns.filter(t => t.level !== "Green").forEach(t => {
    const d = byDist[t.district] ||= { district: t.district, state: t.state, lang: t.lang, towns: [], level: "Yellow", evac: 0, onset: null, maxW: 0, depth: 0, rain: 0 };
    d.towns.push(t.name); d.evac += t.evac; d.maxW = Math.max(d.maxW, t.maxWind); d.depth = Math.max(d.depth, t.depth); d.rain = Math.max(d.rain, t.rain);
    if (t.onset !== null) d.onset = d.onset === null ? t.onset : Math.min(d.onset, t.onset);
    const rank = { Yellow: 1, Orange: 2, Red: 3 }; if (rank[t.level] > rank[d.level]) d.level = t.level;
  });
  const order = { Red: 0, Orange: 1, Yellow: 2 };
  const advisories = Object.values(byDist).sort((a, b) => order[a.level] - order[b.level]).map(d => {
    const onset = d.onset !== null ? `T${d.onset >= 0 ? "+" : ""}${d.onset}h` : "n/a";
    const actions = [];
    if (d.level === "Red") actions.push(`Complete evacuation of ~${d.evac.toLocaleString("en-IN")} people from low-lying/kutcha houses by ${d.onset !== null ? "T" + (d.onset - 6) + "h" : "T-12h"}`);
    if (d.depth > 0.3) actions.push(`Storm-surge inundation up to ${d.depth.toFixed(1)} m expected — clear coastal belt within 5 km`);
    if (d.maxW >= 28) actions.push(`Pre-position NDRF/ODRAF teams, tree-cutters and DG sets; peak winds ~${Math.round(d.maxW * 3.6)} km/h`);
    if (d.rain >= 115) actions.push(`Heavy rain ~${Math.round(d.rain)} mm: pre-deploy dewatering pumps, close low culverts`);
    actions.push("Total suspension of fishing; recall all boats; close schools & tourism activities");
    return {
      district: d.district, alert: d.level,
      headline: `${d.level} alert: ${d.district} (${d.towns.join(", ")}) — gales from ${onset} relative to landfall`,
      actions, local_language: d.lang, local_language_sms: LOCAL_SMS[d.lang](d.district),
      english_sms: `${d.level.toUpperCase()} ALERT ${d.district}: Cyclone winds ~${Math.round(d.maxW * 3.6)} km/h from ${onset}. ${d.depth > 0.3 ? "Surge flooding likely. " : ""}Move to nearest cyclone shelter now. No fishing. Helpline 1070.`
    };
  });
  const infra = result.assets.filter(a => a.pService > 0.4).sort((a, b) => b.risk - a.risk).slice(0, 10).map(a => ({
    asset: a.name,
    action: a.type === "substation" ? "Pre-emptive controlled shutdown, sandbag yard, stage mobile substation & line crews" :
            a.type === "hospital" ? "Shift ICU/dialysis patients, fuel DG for 72h, move equipment above ground floor" :
            a.type === "road" ? "Stage JCBs & tree-cutters at both ends; declare alternate evacuation route" :
            a.type === "telecom" ? "Deploy cell-on-wheels & battery banks; enable intra-circle roaming" :
            a.type === "water" ? "Fill clear-water reservoirs, stock chlorine, arrange water tankers" :
            a.type === "port" ? "Suspend operations, secure vessels & cranes, hoist signal flags" : "Verify structure, stock 72h supplies, arrange generator",
    deadline_h_before_landfall: a.onset !== null ? Math.max(0, -(a.onset - 6)) : 12
  }));
  const top = result.assets.slice().sort((a, b) => b.risk - a.risk);
  const pathways = [];
  const sub = top.find(a => a.type === "substation"); if (sub) pathways.push(`${sub.name}: ${sub.driver} → grid outage → hospitals, water plants and telecom in ${sub.district} on backup power`);
  const rd = top.find(a => a.type === "road"); if (rd) pathways.push(`${rd.name}: ${rd.driver} (tree-fall/overtopping) → evacuation & relief convoys delayed → shelters isolated`);
  const coastal = result.towns.slice().sort((a, b) => b.depth - a.depth)[0]; if (coastal) pathways.push(`${coastal.name}: surge ${coastal.surge.toFixed(1)} m + tide → ${coastal.depth.toFixed(1)} m inundation → saline intrusion of farmland & drinking-water sources`);
  const worst = result.towns.slice().sort((a, b) => b.maxWind - a.maxWind)[0];
  return {
    situation_summary: `${scenarioName}: landfall near ${result.landfall.lat.toFixed(1)}°N ${result.landfall.lon.toFixed(1)}°E at ~${Math.round(result.landfall.v * 1.852)} km/h. ` +
      `Highest winds at ${worst.name} (~${Math.round(worst.maxWind * 3.6)} km/h). ${advisories.filter(a => a.alert === "Red").length} districts on Red alert; ` +
      `~${result.towns.reduce((s, t) => s + t.evac, 0).toLocaleString("en-IN")} people need evacuation; ${result.assets.filter(a => a.pService > 0.5).length} critical assets likely to lose service.`,
    image_assessment: null, advisories, infrastructure_actions: infra, damage_pathways: pathways, source: "offline rule engine"
  };
}

// ---------- CAP 1.2 (Common Alerting Protocol) for dispatch to SACHET / cell broadcast ----------
function toCAP(adv, result, idx) {
  const sev = { Red: "Extreme", Orange: "Severe", Yellow: "Moderate" }[adv.alert];
  const now = new Date().toISOString().replace(/\.\d+Z$/, "+00:00");
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>CYCLONESHIELD-${Date.now()}-${idx}</identifier>
  <sender>cycloneshield@sdma.example</sender>
  <sent>${now}</sent><status>Exercise</status><msgType>Alert</msgType><scope>Public</scope>
  <info>
    <language>en-IN</language><category>Met</category><event>Tropical Cyclone</event>
    <responseType>Evacuate</responseType><urgency>Expected</urgency><severity>${sev}</severity><certainty>Likely</certainty>
    <headline>${esc(adv.headline)}</headline>
    <description>${esc(adv.english_sms)}</description>
    <instruction>${esc(adv.actions.join("; "))}</instruction>
    <area><areaDesc>${esc(adv.district)}</areaDesc></area>
  </info>
</alert>`;
}
