/**
 * CycloneShield AI — Google Earth Engine exposure & vulnerability layer
 * Paste into https://code.earthengine.google.com and Run.
 *
 * Produces, for the Bay of Bengal coast (Odisha / West Bengal / Andhra Pradesh):
 *   1. Low-elevation coastal zone (LECZ) masks at 2 m / 5 m / 10 m (SRTM / Copernicus DEM)
 *   2. Population exposed per LECZ band (WorldPop 100 m)
 *   3. Built-up & cropland exposure (ESA WorldCover 10 m)
 *   4. Pre-/post-event flood extent from Sentinel-1 SAR (change detection) for validation
 *   5. Near-real-time rainfall accumulation (GPM IMERG) for the forecast window
 *   6. Per-district export table (FAO GAUL L2) consumed by the CycloneShield front-end
 */

// ---------------- Parameters ----------------
var AOI = ee.Geometry.Rectangle([82.5, 16.5, 91.0, 24.5]);
var EVENT_START = '2019-05-01', EVENT_END = '2019-05-05';   // Cyclone Fani
var PRE_START = '2019-04-01', PRE_END = '2019-04-25';
Map.centerObject(AOI, 7);

// ---------------- 1. Elevation & low-elevation coastal zones ----------------
var dem = ee.ImageCollection('COPERNICUS/DEM/GLO30').select('DEM').mosaic().clip(AOI);
var lecz2 = dem.lte(2).selfMask(), lecz5 = dem.lte(5).selfMask(), lecz10 = dem.lte(10).selfMask();
Map.addLayer(lecz10, {palette: ['#fde68a']}, 'LECZ ≤10 m', false);
Map.addLayer(lecz5,  {palette: ['#f97316']}, 'LECZ ≤5 m');
Map.addLayer(lecz2,  {palette: ['#dc2626']}, 'LECZ ≤2 m');

// ---------------- 2. Population exposure ----------------
var pop = ee.ImageCollection('WorldPop/GP/100m/pop').filter(ee.Filter.eq('country', 'IND'))
  .filter(ee.Filter.eq('year', 2020)).mosaic().clip(AOI);
var popLECZ5 = pop.updateMask(dem.lte(5));

// ---------------- 3. Land cover exposure ----------------
var lc = ee.ImageCollection('ESA/WorldCover/v200').first().clip(AOI);
var builtUp = lc.eq(50).selfMask(), cropland = lc.eq(40).selfMask();
Map.addLayer(builtUp.updateMask(dem.lte(5)), {palette: ['#a21caf']}, 'Built-up in LECZ ≤5 m');

// ---------------- 4. Sentinel-1 SAR flood mapping (validation of surge/rain model) ----------------
function s1(start, end) {
  return ee.ImageCollection('COPERNICUS/S1_GRD').filterBounds(AOI).filterDate(start, end)
    .filter(ee.Filter.eq('instrumentMode', 'IW')).filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .select('VV').median().focal_median(50, 'circle', 'meters');
}
var before = s1(PRE_START, PRE_END), after = s1(EVENT_START, '2019-05-10');
var permanentWater = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('seasonality').gte(10);
var flood = after.subtract(before).lt(-3).and(after.lt(-16)).and(permanentWater.not()).selfMask();
Map.addLayer(flood, {palette: ['#0ea5e9']}, 'SAR-detected flooding');

// ---------------- 5. GPM IMERG rainfall accumulation ----------------
var rain = ee.ImageCollection('NASA/GPM_L3/IMERG_V07').filterDate(EVENT_START, EVENT_END)
  .select('precipitation').sum().multiply(0.5).clip(AOI);   // half-hourly mm/h -> mm
Map.addLayer(rain, {min: 0, max: 300, palette: ['#e0f2fe', '#38bdf8', '#1d4ed8', '#7c3aed']}, 'IMERG event rainfall (mm)', false);

// ---------------- 6. District-level exposure table ----------------
var districts = ee.FeatureCollection('FAO/GAUL/2015/level2').filterBounds(AOI)
  .filter(ee.Filter.inList('ADM1_NAME', ['Orissa', 'West Bengal', 'Andhra Pradesh']));
var stack = ee.Image.cat([
  pop.rename('pop_total'),
  popLECZ5.rename('pop_lecz5'),
  pop.updateMask(dem.lte(2)).rename('pop_lecz2'),
  builtUp.multiply(ee.Image.pixelArea()).divide(1e6).rename('builtup_km2'),
  cropland.updateMask(dem.lte(5)).multiply(ee.Image.pixelArea()).divide(1e6).rename('crop_lecz5_km2'),
  flood.multiply(ee.Image.pixelArea()).divide(1e6).rename('sar_flood_km2'),
  rain.rename('rain_mm')
]);
var table = stack.reduceRegions({collection: districts, reducer: ee.Reducer.sum().combine({reducer2: ee.Reducer.mean(), sharedInputs: true}), scale: 100, tileScale: 8});
print('District exposure (first 10)', table.limit(10));
Export.table.toDrive({collection: table, description: 'cycloneshield_district_exposure', fileFormat: 'GeoJSON'});

// ---------------- 7. Critical infrastructure from OSM-derived GEE assets (optional) ----------------
// Upload OSM extracts (power=substation, amenity=hospital, building=shelter, highway=trunk|primary)
// as table assets and sample DEM/LECZ/flood per feature:
// var infra = ee.FeatureCollection('users/<you>/odisha_critical_infra');
// Export.table.toDrive({collection: dem.addBands(flood.unmask(0)).sampleRegions({collection: infra, scale: 30}), description: 'infra_exposure'});
