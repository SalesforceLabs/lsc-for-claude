// Pure map maths for IpadMap: the Web Mercator view MapKit draws, MapKit's showAnnotations fit, and marker clustering.
// Constants were measured from device captures (Home Up Next map, Accounts map) and checked against city positions to <1pt.

export interface MapView {
  /** Centre of the view. */
  lat: number;
  lon: number;
  /** Points per degree of longitude (360 * ppd = the world's width at this zoom). */
  ppd: number;
  width: number;
  height: number;
}

export interface MapPoint {
  lat: number;
  lon: number;
}

const RAD = 180 / Math.PI;

export const mercY = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** Latitude of a Mercator ordinate. */
export const mercLat = (m: number): number => (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * RAD;

export function project(v: MapView, lat: number, lon: number): { x: number; y: number } {
  return { x: v.width / 2 + (lon - v.lon) * v.ppd, y: v.height / 2 - (mercY(lat) - mercY(v.lat)) * v.ppd * RAD };
}

export function unproject(v: MapView, x: number, y: number): MapPoint {
  return { lat: mercLat(mercY(v.lat) - ((y - v.height / 2) / v.ppd) / RAD), lon: v.lon + (x - v.width / 2) / v.ppd };
}

/** MKMapView's default region on the Home Up Next map with nothing to plot: measured from the iPad (US-centred, 12.48pt per degree, 764pt wide). */
export const DEFAULT_CENTER: MapPoint = { lat: 37.1, lon: -95.83 };
export const DEFAULT_PPD = 12.48;

export function defaultView(width: number, height: number): MapView {
  return { ...DEFAULT_CENTER, ppd: DEFAULT_PPD, width, height };
}

/**
 * AccountsMap.updateVisibleRegionToShowAllAnnotations -> showAnnotations(_, animated: false): the box around the pins, centred, padded
 * by MapKit's margin (measured 1.3x on the iPad with pins in Hawaii and the Bay Area) and fitted to the view. A single pin gets a city-scale view.
 */
export const FIT_PADDING = 1.33;
export const SINGLE_PIN_PPD = 60;

export function fitView(points: MapPoint[], width: number, height: number): MapView {
  if (!points.length) return defaultView(width, height);
  const lons = points.map((p) => p.lon);
  const ms = points.map((p) => mercY(p.lat));
  const lon0 = Math.min(...lons);
  const lon1 = Math.max(...lons);
  const m0 = Math.min(...ms);
  const m1 = Math.max(...ms);
  const center = { lat: mercLat((m0 + m1) / 2), lon: (lon0 + lon1) / 2 };
  const dLon = (lon1 - lon0) * FIT_PADDING;
  const dMerc = (m1 - m0) * RAD * FIT_PADDING; // in degrees-equivalent so both axes share one scale
  if (dLon <= 0 && dMerc <= 0) return { ...center, ppd: SINGLE_PIN_PPD, width, height };
  const ppd = Math.min(width / (dLon || Infinity), height / (dMerc || Infinity));
  return { ...center, ppd: Math.min(ppd, SINGLE_PIN_PPD * 4), width, height };
}

export interface Pin<T = unknown> extends MapPoint {
  id: string;
  data?: T;
}

export interface Cluster<T = unknown> extends MapPoint {
  members: Pin<T>[];
}

/** Marker views are about 32pt wide; MapKit merges the ones that would overlap into a cluster (MKClusterAnnotation sits at the members' centroid). */
export const CLUSTER_RADIUS = 34;

export function clusterPins<T>(pins: Pin<T>[], v: MapView, radius = CLUSTER_RADIUS): Cluster<T>[] {
  const out: { x: number; y: number; members: Pin<T>[] }[] = [];
  for (const p of pins) {
    const { x, y } = project(v, p.lat, p.lon);
    const hit = out.find((c) => Math.hypot(c.x - x, c.y - y) < radius);
    if (hit) {
      hit.members.push(p);
      hit.x = hit.members.reduce((s, m) => s + project(v, m.lat, m.lon).x, 0) / hit.members.length;
      hit.y = hit.members.reduce((s, m) => s + project(v, m.lat, m.lon).y, 0) / hit.members.length;
    } else out.push({ x, y, members: [p] });
  }
  return out.map((c) => ({
    members: c.members,
    lat: c.members.reduce((s, m) => s + m.lat, 0) / c.members.length,
    lon: c.members.reduce((s, m) => s + m.lon, 0) / c.members.length,
  }));
}

/** Tile zoom (256px tiles) of a view, the scale Natural Earth's label min_zoom is written for. */
export const tileZoom = (ppd: number): number => Math.log2((ppd * 360) / 256);

/** A point is a valid coordinate for a pin: the device query drops null and 0 latitudes and longitudes (AccountsMapFetchQueryCreator). */
export function plottable(lat: unknown, lon: unknown): boolean {
  return typeof lat === "number" && typeof lon === "number" && lat !== 0 && lon !== 0 && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}
