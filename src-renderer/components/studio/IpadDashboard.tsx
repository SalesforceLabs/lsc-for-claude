import React, { useLayoutEffect, useRef, useState } from "react";
import type { DashboardData, PublishedDashboard, PublishedDashboardComponent } from "./published-types";

/**
 * `embeddedDashboard` as LSC Mobile draws it: DashboardViewController's grid
 * of DashboardComponentViewController tiles, each a DGCharts chart built from
 * the report results (ReportChartType / ChartStyleProvides). Results are only
 * known for dashboards that run as a specified user; others get sample shapes.
 */

/** ChartColorProvider — a fixed list; the dashboard's own palette is ignored. */
const PALETTE = ["#4992FE", "#BA01FF", "#06A59A", "#3A49DA", "#FE5C4C", "#024D4C", "#3BA755", "#8A033E", "#E3066A", "#002775"];
const color = (i: number) => PALETTE[i % PALETTE.length];

type Kind = "donut" | "pie" | "line" | "column" | "bar" | "metric" | "gauge" | "table" | "unsupported";

function kindOf(chart: string): Kind {
  const c = chart.toLowerCase();
  if (c === "donut" || c === "pie" || c === "metric" || c === "gauge" || c === "table") return c;
  if (c.includes("line")) return "line";
  if (c === "column" || c.includes("stackedcolumn") || c.includes("verticalbar")) return "column";
  if (c === "bar" || c.includes("stackedbar")) return "bar";
  if (c === "flextable") return "table";
  return "unsupported";
}

/** metricString — short numbers (1.3K, 2.5M). */
function short(n: number): string {
  const abs = Math.abs(n);
  const fmt = (v: number, s: string) => `${Number(v.toFixed(1))}${s}`;
  if (abs >= 1e9) return fmt(n / 1e9, "B");
  if (abs >= 1e6) return fmt(n / 1e6, "M");
  if (abs >= 1e3) return fmt(n / 1e3, "K");
  return String(Math.round(n));
}

/** The element's laid-out size in points (unaffected by the screen's scale transform). */
function useSize<T extends HTMLElement>(): [React.RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

// ── Items ─────────────────────────────────────────────────────────────────────

interface Slice {
  label: string;
  value: number;
  display: string;
}

/** ReportChartViewModel: slices in grouping order; combineSmallGroups folds those under 3% into "Other". */
function slices(c: PublishedDashboardComponent, d: DashboardData): Slice[] {
  const s = d.series[0];
  if (!s) return [];
  const items = d.categories.map((label, i) => ({ label, value: s.values[i] ?? 0, display: s.labels[i] ?? "" }));
  if (!c.combineSmall) return items;
  const total = items.reduce((a, b) => a + b.value, 0);
  const small = items.filter((x) => total > 0 && x.value / total < 0.03);
  if (small.length === 0) return items;
  const other = small.reduce((a, b) => a + b.value, 0);
  return [...items.filter((x) => !small.includes(x)), { label: "Other", value: other, display: short(other) }];
}

interface LegendItem {
  label: string;
  color: string;
  marker: "circle" | "square" | "bar";
}

/** ChartCustomLegendProvider — slices for donuts, series for grouped lines and bars, none otherwise. */
function legendItems(kind: Kind, c: PublishedDashboardComponent, d: DashboardData | undefined): LegendItem[] {
  if (!d) return [];
  if (kind === "donut" || kind === "pie")
    return slices(c, d).map((s, i) => ({ label: s.value ? `${s.label} (${Math.trunc(s.value)})` : s.label, color: color(i), marker: "circle" }));
  const series = d.grouped || d.series.length > 1;
  if (!series) return [];
  const marker = kind === "line" ? "bar" : "square";
  if (kind !== "line" && kind !== "column" && kind !== "bar") return [];
  const items = d.series.map((s, i): LegendItem => ({ label: s.label, color: color(i), marker }));
  // ReportChartViewModel.setGroupingSort: the leaf groupings sorted case-insensitively (sortItems).
  return d.grouped ? items.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })) : items;
}

function Legend({ items, bottom }: { items: LegendItem[]; bottom: boolean }) {
  return (
    <div className={`studio-ipad-d-legend${bottom ? " studio-ipad-d-legend-bottom" : ""}`}>
      <div className="studio-ipad-d-legend-head">Legend</div>
      {items.map((it, i) => (
        <div key={i} className="studio-ipad-d-legend-item">
          <span>{it.label}</span>
          <i className={`studio-ipad-d-marker ${it.marker}`} style={{ background: it.color }} />
        </div>
      ))}
    </div>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────────

function arc(cx: number, cy: number, r: number, r0: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${cx + r * Math.sin(a)},${cy - r * Math.cos(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
  return r0 > 0
    ? `M${p(r, a0)}A${r},${r} 0 ${large} 1 ${p(r, a1)}L${p(r0, a1)}A${r0},${r0} 0 ${large} 0 ${p(r0, a0)}Z`
    : `M${cx},${cy}L${p(r, a0)}A${r},${r} 0 ${large} 1 ${p(r, a1)}Z`;
}

/** PieChartView: 12 o'clock, clockwise, hole 0.6, values inside in white (iPad: hidden at 5% or less). */
function Donut({ c, d, w, h, hole }: { c: PublishedDashboardComponent; d: DashboardData; w: number; h: number; hole: boolean }) {
  const items = slices(c, d);
  const total = items.reduce((a, b) => a + b.value, 0);
  const top = 20; // the measure label sits over the chart's top-left
  const r = Math.max(0, Math.min(w, h - top) / 2 - 10);
  const r0 = hole ? r * 0.6 : 0;
  const cx = w / 2;
  const cy = top + (h - top) / 2;
  let at = 0;
  return (
    <svg width={w} height={h} aria-hidden="true">
      {total > 0 &&
        items.map((s, i) => {
          const a0 = (at / total) * Math.PI * 2;
          at += s.value;
          const a1 = (at / total) * Math.PI * 2;
          const mid = (a0 + a1) / 2;
          const lr = (r + r0) / 2 || r * 0.6;
          return (
            <g key={i}>
              <path d={arc(cx, cy, r, r0, a0, a1)} fill={color(i)} />
              {c.showValues && s.value / total > 0.05 && (
                <text x={cx + lr * Math.sin(mid)} y={cy - lr * Math.cos(mid)} className="studio-ipad-d-slice" textAnchor="middle" dominantBaseline="central">
                  {s.display || short(s.value)}
                </text>
              )}
            </g>
          );
        })}
      {hole && c.showTotal && (
        <text x={cx} y={cy} className="studio-ipad-d-total" textAnchor="middle" dominantBaseline="central">
          {short(total)}
        </text>
      )}
    </svg>
  );
}

/** DGCharts AxisRenderer.computeAxisValues: 6 labels over a 10%-padded range, the interval rounded to one significant digit. */
function yTicks(max: number): { top: number; ticks: number[] } {
  const axisMax = Math.max(1, max * 1.1);
  const raw = axisMax / 6;
  const pw = 1 - Math.ceil(Math.log10(raw)); // roundToNextSignificant
  let step = Math.round(raw * 10 ** pw) / 10 ** pw;
  const mag = 10 ** Math.floor(Math.log10(step));
  if (Math.trunc(step / mag) > 5) step = Math.floor(10 * mag);
  const ticks: number[] = [];
  for (let v = 0; v <= axisMax + 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return { top: axisMax, ticks };
}

/** ChartValuesProviders: labels over 15 characters become 13 + "...". */
const xLabel = (s: string) => (s.length > 15 ? `${s.slice(0, 13)}...` : s || "-");

/** LineChartView / BarChartView with ChartStyleProvides' axes: left axis only, horizontal grid, x labels per item. */
function Cartesian({ kind, c, d, w, h }: { kind: "line" | "column"; c: PublishedDashboardComponent; d: DashboardData; w: number; h: number }) {
  const n = d.categories.length;
  const visible = Math.min(n, 11); // setVisibleXRangeMaximum(10): a range of 10, so 11 items; the rest scroll
  const stacked = kind === "column" && /stacked/i.test(c.groupBy);
  const sums = d.categories.map((_, i) => d.series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const max = Math.max(0, ...(stacked ? sums : d.series.flatMap((s) => s.values.map((v) => v ?? 0))));
  const { top, ticks } = yTicks(max);
  const rotate = n <= 3 ? 0 : n <= 12 ? -45 : -90;
  const longest = Math.max(1, ...d.categories.map((s) => xLabel(s).length));
  const labelW = Math.max(...ticks.map((t) => short(t).length)) * 6;
  const left = 15 + labelW + 6;
  const bottom = rotate === 0 ? 18 : Math.min(h * 0.4, longest * 5.6 * (rotate === -45 ? 0.72 : 1) + 12);
  const plotW = Math.max(0, w - left - 12);
  const plotH = Math.max(0, h - bottom - 12);
  const y = (v: number) => 12 + plotH - (v / top) * plotH;
  const slot = plotW / Math.max(1, visible);
  const lineX = (i: number) => left + (visible > 1 ? (i / (visible - 1)) * plotW : plotW / 2);
  const barX = (i: number) => left + (i + 0.5) * slot;
  const x = kind === "line" ? lineX : barX;
  const grouped = d.grouped || d.series.length > 1;
  const clip = `studio-ipad-d-clip-${c.id}`;
  return (
    <svg width={w} height={h} aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <rect x={left - 6} y={0} width={plotW + 12} height={h} />
        </clipPath>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} stroke="rgba(142,142,147,0.9)" strokeWidth="0.5" />
          <text x={left - 6} y={y(t)} className="studio-ipad-d-axis" textAnchor="end" dominantBaseline="central">
            {short(t)}
          </text>
        </g>
      ))}
      <g clipPath={`url(#${clip})`}>
        {kind === "line"
          ? [...d.series.keys()].reverse().map((si) => {
              const s = d.series[si];
              const pts = s.values.map((v, i) => [x(i), y(v ?? 0)] as const);
              const col = grouped ? color(si) : PALETTE[0];
              return (
                <g key={si}>
                  <polygon points={[...pts.map((p) => p.join(",")), `${x(n - 1)},${y(0)}`, `${x(0)},${y(0)}`].join(" ")} fill={col} opacity="0.33" />
                  <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={col} strokeWidth="1" />
                  {grouped && pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="4" fill={col} />)}
                </g>
              );
            })
          : d.categories.map((_, i) => {
              const m = d.series.length;
              if (stacked) {
                let base = 0;
                const bw = slot * 0.85;
                return d.series.map((s, si) => {
                  const v = s.values[i] ?? 0;
                  const y0 = y(base);
                  base += v;
                  return <rect key={`${i}.${si}`} x={barX(i) - bw / 2} y={y(base)} width={bw} height={Math.max(0, y0 - y(base))} fill={color(si)} />;
                });
              }
              // ChartDataProviderProtocol: grouped bars share the slot (group space 0.3, bar space 0.05).
              const bw = m > 1 ? slot * (0.7 / m - 0.05) : slot * [0.3, 0.4, 0.5, 0.6][Math.min(n, 5) - 1] || slot * 0.85;
              const start = barX(i) - (m > 1 ? slot * 0.35 : bw / 2);
              return d.series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const bx = m > 1 ? start + si * slot * (0.7 / m) + slot * 0.025 : start;
                return (
                  <g key={`${i}.${si}`}>
                    <rect x={bx} y={y(v)} width={bw} height={Math.max(0, y(0) - y(v))} fill={m > 1 || d.grouped ? color(si) : PALETTE[0]} />
                    {c.showValues && (
                      <text x={bx + bw / 2} y={y(v) - 4.5} className={`studio-ipad-d-value${m > 1 ? " big" : ""}`} textAnchor="middle">
                        {s.labels[i] || short(v)}
                      </text>
                    )}
                  </g>
                );
              });
            })}
      </g>
        {d.categories.slice(0, visible).map((label, i) => (
          <text
            key={i}
            className="studio-ipad-d-axis"
            textAnchor={rotate ? "end" : "middle"}
            transform={`translate(${x(i)},${12 + plotH + 6}) rotate(${rotate})`}
            dominantBaseline={rotate ? "central" : "hanging"}
          >
            {xLabel(label)}
          </text>
        ))}
    </svg>
  );
}

/** HorizontalBarChartView: first item at the top, labels unrotated. */
function HorizontalBars({ c, d, w, h }: { c: PublishedDashboardComponent; d: DashboardData; w: number; h: number }) {
  const n = Math.min(d.categories.length, 11);
  const max = Math.max(0, ...d.series.flatMap((s) => s.values.slice(0, n).map((v) => v ?? 0)));
  const { top, ticks } = yTicks(max);
  const left = Math.min(w * 0.35, Math.max(...d.categories.slice(0, n).map((s) => xLabel(s).length)) * 6 + 10);
  const plotW = Math.max(0, w - left - 20);
  const slot = (h - 30) / Math.max(1, n);
  const m = d.series.length;
  const bw = slot * (m > 1 ? 0.7 / m - 0.05 : 0.6);
  const xv = (v: number) => left + (v / top) * plotW;
  return (
    <svg width={w} height={h} aria-hidden="true">
      {ticks.map((t) => (
        <text key={t} x={xv(t)} y={h - 8} className="studio-ipad-d-axis" textAnchor="middle">
          {short(t)}
        </text>
      ))}
      {d.categories.slice(0, n).map((label, i) => (
        <g key={i}>
          <text x={left - 6} y={10 + (i + 0.5) * slot} className="studio-ipad-d-axis" textAnchor="end" dominantBaseline="central">
            {xLabel(label)}
          </text>
          {d.series.map((s, si) => (
            <rect
              key={si}
              x={left}
              y={10 + i * slot + (slot - bw * m) / 2 + si * bw}
              width={Math.max(0, xv(s.values[i] ?? 0) - left)}
              height={bw}
              fill={m > 1 || d.grouped ? color(si) : PALETTE[0]}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

/** DashboardMetricView / DashboardGaugeView: the total, 24pt. */
function Metric({ d, gauge, w, h }: { d: DashboardData; gauge: boolean; w: number; h: number }) {
  const value = d.total ?? "";
  if (!gauge) return <div className="studio-ipad-d-metric">{value}</div>;
  const r = Math.max(0, Math.min(w / 2, h) - 20);
  const cx = w / 2;
  const cy = h / 2 + r / 2;
  return (
    <svg width={w} height={h} aria-hidden="true">
      <path d={`M${cx - r},${cy}A${r},${r} 0 0 1 ${cx + r},${cy}`} fill="none" stroke="#c9c9c9" strokeWidth="12" />
      <text x={cx} y={cy - 6} className="studio-ipad-d-gauge" textAnchor="middle">
        {value}
      </text>
    </svg>
  );
}

/** DashboardTableView: 35pt header, 30pt rows. */
function Table({ d }: { d: DashboardData }) {
  return (
    <div className="studio-ipad-d-table">
      <div className="studio-ipad-d-table-row head">
        <span />
        {d.series.map((s) => (
          <span key={s.label}>{s.label}</span>
        ))}
      </div>
      {d.categories.map((label, i) => (
        <div key={i} className="studio-ipad-d-table-row">
          <span>{label}</span>
          {d.series.map((s) => (
            <span key={s.label}>{s.labels[i]}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** When the results aren't known (the dashboard runs as the viewer): sample data in the right chart type. */
function sample(kind: Kind, c: PublishedDashboardComponent): DashboardData {
  const categories = ["A", "B", "C", "D", "E", "F"].slice(0, kind === "donut" || kind === "pie" ? 4 : 6);
  const values = kind === "donut" || kind === "pie" ? [44, 34, 18, 4] : [28, 46, 38, 62, 50, 74];
  return {
    measures: [c.title],
    categories,
    grouped: false,
    series: [{ label: c.title, values, labels: values.map(String) }],
    total: String(values.reduce((a, b) => a + b, 0)),
  };
}

function Chart({ kind, c, d, w, h }: { kind: Kind; c: PublishedDashboardComponent; d: DashboardData; w: number; h: number }) {
  if (w <= 0 || h <= 0) return null;
  if (d.categories.length === 0 && kind !== "metric" && kind !== "gauge") return <div className="studio-ipad-d-nodata">No data available</div>;
  switch (kind) {
    case "donut":
    case "pie":
      return <Donut c={c} d={d} w={w} h={h} hole={kind === "donut"} />;
    case "line":
    case "column":
      return <Cartesian kind={kind} c={c} d={d} w={w} h={h} />;
    case "bar":
      return <HorizontalBars c={c} d={d} w={w} h={h} />;
    case "metric":
    case "gauge":
      return <Metric d={d} gauge={kind === "gauge"} w={w} h={h} />;
    case "table":
      return <Table d={d} />;
    default:
      return null;
  }
}

function MoreDots() {
  return (
    <span className="studio-ipad-h-more" aria-label="More">
      <svg width="18" height="4" viewBox="0 0 18 4" aria-hidden="true">
        <circle cx="2" cy="2" r="2" fill="currentColor" />
        <circle cx="9" cy="2" r="2" fill="currentColor" />
        <circle cx="16" cy="2" r="2" fill="currentColor" />
      </svg>
    </span>
  );
}

/** DashboardComponentViewController: title row, subtitle, chart (with its legend), footer. */
function Tile({ c }: { c: PublishedDashboardComponent }) {
  const kind = kindOf(c.chart);
  const known = !!c.data;
  const data = c.data ?? sample(kind, c);
  const legend = legendItems(kind, c, data);
  const bottom = c.legend === "Bottom";
  const [ref, size] = useSize<HTMLDivElement>();
  return (
    <div className="studio-ipad-h-tile">
      <div className="studio-ipad-h-tile-head">
        <span>{c.title}</span>
        <MoreDots />
      </div>
      {c.subtitle && <div className="studio-ipad-d-subtitle">{c.subtitle}</div>}
      {kind === "unsupported" ? (
        <div className="studio-ipad-d-nodata">{c.chart} chart type is not supported</div>
      ) : (
        <div className={`studio-ipad-d-body${bottom ? " studio-ipad-d-body-bottom" : ""}${known ? "" : " studio-ipad-d-sample"}`}>
          <div ref={ref} className="studio-ipad-d-chart">
            {(kind === "donut" || kind === "pie") && <div className="studio-ipad-d-measure">{data.measures[0]}</div>}
            <Chart kind={kind} c={c} d={data} w={size.w} h={size.h} />
          </div>
          {legend.length > 0 && <Legend items={legend} bottom={bottom} />}
        </div>
      )}
      {!known && kind !== "unsupported" && <div className="studio-ipad-d-note">Sample data — this dashboard shows each viewer their own results</div>}
    </div>
  );
}

/** SFComponentDashboardVC — the dashboard's own grid: x = column × width/numColumns, height = rowspan × rowHeight, each tile inset 10. */
export function Dashboard({ dashboard }: { dashboard?: PublishedDashboard }) {
  if (!dashboard) return null; // not in the cache's dashboards → the app renders nothing
  const rows = Math.max(0, ...dashboard.components.map((c) => c.row + c.rowspan));
  return (
    <div className="studio-ipad-h-dashboard" style={{ height: rows * dashboard.rowHeight }}>
      {dashboard.components.map((c, i) => (
        <div
          key={i}
          className="studio-ipad-h-tile-cell"
          style={{
            left: `${(c.column / dashboard.numColumns) * 100}%`,
            width: `${(c.colspan / dashboard.numColumns) * 100}%`,
            top: c.row * dashboard.rowHeight,
            height: c.rowspan * dashboard.rowHeight,
          }}
        >
          <Tile c={c} />
        </div>
      ))}
    </div>
  );
}
