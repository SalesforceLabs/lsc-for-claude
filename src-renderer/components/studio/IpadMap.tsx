// An offline stand-in for the Apple Maps view the iPad shows (Home Up Next map, Accounts map view, account Map card).
// Vector base map from Natural Earth (public domain, see scripts/build-ipad-map-data.py), drawn in the device's Web Mercator view
// with the Apple Maps palette, labels and balloon markers. No network tiles: street-level detail is not available here.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import data from "./assets/ipad-map-data.json";
import tint from "./assets/ipad-map-tint.png";
import { clusterPins, defaultView, fitView, mercY, project, tileZoom, type MapView, type Pin } from "./ipad-map-geo";
import { COUNTRY_LABELS, HOME_CITIES, LINE_LABELS, REGION_LABELS, WATER_LABELS } from "./ipad-map-labels";
import "./ipad-map.css";

const RAD = 180 / Math.PI;
const TINT_BOX = { west: -180, east: -50, south: 10, north: 75 };

type Ring = [number, number][];
interface MapData {
  unit: number;
  land: number[][];
  lakes: number[][];
  rivers: number[][];
  borders: number[][];
  states: number[][];
  places: [string, number, number, number, number][];
}
const D = data as unknown as MapData;

function decode(e: number[]): Ring {
  const out: Ring = [];
  let x = e[0];
  let y = e[1];
  out.push([x / D.unit, y / D.unit]);
  for (let i = 2; i < e.length; i += 2) {
    x += e[i];
    y += e[i + 1];
    out.push([x / D.unit, y / D.unit]);
  }
  return out;
}

let decoded: Record<"land" | "lakes" | "rivers" | "borders" | "states", Ring[]> | undefined;
function layers() {
  decoded ??= {
    land: D.land.map(decode),
    lakes: D.lakes.map(decode),
    rivers: D.rivers.map(decode),
    borders: D.borders.map(decode),
    states: D.states.map(decode),
  };
  return decoded;
}

/** SVG path data for rings (as [lon, lat]) in the view's points; rings entirely outside the view are skipped. */
export function ringsPath(rings: Ring[], v: MapView, close: boolean): string {
  const parts: string[] = [];
  const margin = 40;
  for (const r of rings) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const pts = r.map(([lon, lat]) => {
      const p = project(v, lat, lon);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      return p;
    });
    if (maxX < -margin || minX > v.width + margin || maxY < -margin || minY > v.height + margin) continue;
    parts.push("M" + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("L") + (close ? "Z" : ""));
  }
  return parts.join("");
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const HOME = new Set([...HOME_CITIES].map(norm));
/** Natural Earth resolves these to the US namesakes (other coordinates); the device shows these ones. */
const FIXED_CITIES: Record<string, [number, number]> = { Vancouver: [49.28, -123.12], Portland: [45.52, -122.68] };

interface Label {
  text: string;
  lat: number;
  lon: number;
}

export function visibleCities(v: MapView, home: boolean): Label[] {
  const z = tileZoom(v.ppd);
  const out: Label[] = [];
  const seen = new Set<string>();
  for (const [name, lat0, lon0, minZoom] of D.places) {
    const n = norm(name);
    let lat = lat0;
    let lon = lon0;
    if (home) {
      if (!HOME.has(n) || seen.has(n)) continue;
      const fix = FIXED_CITIES[n];
      if (fix) [lat, lon] = fix;
    } else if (minZoom > z - 1.2) continue;
    const p = project(v, lat, lon);
    if (p.x < 6 || p.y < 6 || p.x > v.width - 6 || p.y > v.height - 6) continue;
    seen.add(n);
    out.push({ text: n, lat, lon });
  }
  // Skip labels whose text box would sit on an earlier (larger) one.
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  return out.filter((l) => {
    const p = project(v, l.lat, l.lon);
    const box = { x0: p.x - 3, x1: p.x + 9 + l.text.length * 5.6, y0: p.y - 8, y1: p.y + 8 };
    if (placed.some((q) => box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0)) return false;
    placed.push(box);
    return true;
  });
}

export type IpadMapPin = Pin;

export interface IpadMapProps {
  /** Pins to plot. With none, and `fit` off, the map shows the default US region the device opens on. */
  pins?: IpadMapPin[];
  /** Fit the view around the pins (MKMapView.showAnnotations) instead of the default region. */
  fit?: boolean;
  /** City labels limited to the ones the Home map shows at its default region. */
  home?: boolean;
  /** Size fallback in points before the element is measured. */
  width?: number;
  height?: number;
  /** A fixed view to draw instead of a computed one (e.g. a card with its own centre and zoom). */
  view?: Pick<MapView, "lat" | "lon" | "ppd">;
  showLabels?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function IpadMap({ pins = [], fit = false, home = false, width = 764, height = 510, view, showLabels = true, className, children }: IpadMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: width, h: height });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // offsetWidth/Height: the preview is CSS-scaled, which getBoundingClientRect would include.
    const read = () => setSize((s) => (el.offsetWidth && (s.w !== el.offsetWidth || s.h !== el.offsetHeight) ? { w: el.offsetWidth, h: el.offsetHeight } : s));
    read();
    const ro = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(read);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const v: MapView = useMemo(
    () => (view ? { ...view, width: size.w, height: size.h } : fit && pins.length ? fitView(pins, size.w, size.h) : defaultView(size.w, size.h)),
    [view, fit, pins, size.w, size.h],
  );

  const geo = useMemo(() => {
    const L = layers();
    return {
      land: ringsPath(L.land, v, true),
      lakes: ringsPath(L.lakes, v, true),
      rivers: ringsPath(L.rivers, v, false),
      borders: ringsPath(L.borders, v, false),
      states: ringsPath(L.states, v, false),
    };
  }, [v]);
  const cities = useMemo(() => (showLabels ? visibleCities(v, home) : []), [v, home, showLabels]);
  const clusters = useMemo(() => clusterPins(pins, v), [pins, v]);

  const nw = project(v, TINT_BOX.north, TINT_BOX.west);
  const tintW = (TINT_BOX.east - TINT_BOX.west) * v.ppd;
  const tintH = (mercY(TINT_BOX.north) - mercY(TINT_BOX.south)) * RAD * v.ppd;
  const showStates = v.ppd >= 9;
  const regionLabels = showLabels && v.ppd >= 9 && v.ppd < 40;
  const countryLabels = showLabels && v.ppd < 30;
  const lineLabels = showLabels && v.ppd >= 9 && v.ppd < 40;
  const inside = (p: { x: number; y: number }) => p.x > 0 && p.y > 0 && p.x < size.w && p.y < size.h;

  return (
    <div ref={ref} className={`studio-ipad-map ${className ?? ""}`} aria-label="Map">
      <svg width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} className="studio-ipad-map-svg">
        <defs>
          <clipPath id="studio-ipad-map-land">
            <path d={geo.land} />
          </clipPath>
          <filter id="studio-ipad-map-shore" x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        <rect width={size.w} height={size.h} className="ocean" />
        <path d={geo.land} className="shore" filter="url(#studio-ipad-map-shore)" />
        <g clipPath="url(#studio-ipad-map-land)">
          <rect width={size.w} height={size.h} className="land" />
          <image href={tint} x={nw.x} y={nw.y} width={tintW} height={tintH} preserveAspectRatio="none" />
        </g>
        <path d={geo.lakes} className="lake" />
        <path d={geo.rivers} className="river" />
        {showStates && <path d={geo.states} className="state" />}
        <path d={geo.borders} className="border" />
        {lineLabels &&
          LINE_LABELS.map((l) => {
            const a = project(v, l.from[0], l.from[1]);
            const b = project(v, l.to[0], l.to[1]);
            if (!inside(a) && !inside(b)) return null;
            const id = `studio-ipad-map-line-${l.text.replace(/\W/g, "")}`;
            return (
              <g key={l.text} className={`line-label ${l.kind}`}>
                <path id={id} d={`M${a.x} ${a.y}L${b.x} ${b.y}`} fill="none" />
                <text>
                  <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
                    {l.text}
                  </textPath>
                </text>
              </g>
            );
          })}
        {regionLabels &&
          REGION_LABELS.map(([t, lat, lon]) => {
            const p = project(v, lat, lon);
            return inside(p) ? (
              <text key={t} x={p.x} y={p.y} className="region-label" textAnchor="middle">
                {t}
              </text>
            ) : null;
          })}
        {countryLabels &&
          COUNTRY_LABELS.map(([t, lat, lon]) => {
            const p = project(v, lat, lon);
            return inside(p) ? (
              <text key={t} x={p.x} y={p.y} className="country-label" textAnchor="middle">
                {t}
              </text>
            ) : null;
          })}
        {showLabels &&
          WATER_LABELS.map((w) => {
            const p = project(v, w.lat, w.lon);
            return inside(p) ? (
              <text key={w.lines.join(" ")} className="water-label" textAnchor="middle">
                {w.lines.map((ln, i) => (
                  <tspan key={ln} x={p.x} y={p.y + i * 15}>
                    {ln}
                  </tspan>
                ))}
              </text>
            ) : null;
          })}
        {cities.map((c) => {
          const p = project(v, c.lat, c.lon);
          return (
            <g key={c.text} className="city">
              <circle cx={p.x} cy={p.y} r="2.6" />
              <text x={p.x + 7} y={p.y + 4}>
                {c.text}
              </text>
            </g>
          );
        })}
        {clusters.map((c) => {
          const p = project(v, c.lat, c.lon);
          const n = c.members.length;
          return (
            <g key={c.members[0].id} className="marker" transform={`translate(${p.x} ${p.y})`}>
              <path d="M0 0L-5 -9H5Z" className="tail" />
              <circle cy="-24" r="16" className="halo" />
              <circle cy="-24" r="13.500" className="disc" />
              {n > 1 ? (
                <text y="-19.500" textAnchor="middle" className="count">
                  {n}
                </text>
              ) : (
                <circle cy="-24" r="6" className="dot" />
              )}
            </g>
          );
        })}
      </svg>
      <span className="studio-ipad-map-mark">
        <b></b>Maps
        <u>Legal</u>
      </span>
      {children}
    </div>
  );
}
