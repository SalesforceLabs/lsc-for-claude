import { describe, expect, it } from "vitest";
import { clusterPins, defaultView, fitView, mercLat, mercY, plottable, project, tileZoom, unproject } from "../../../src-renderer/components/studio/ipad-map-geo";

describe("ipad map projection", () => {
  it("round-trips a point through project/unproject", () => {
    const v = defaultView(764, 510);
    const p = project(v, 41.88, -87.63);
    const q = unproject(v, p.x, p.y);
    expect(q.lat).toBeCloseTo(41.88, 6);
    expect(q.lon).toBeCloseTo(-87.63, 6);
  });

  it("puts the centre in the middle and mercLat inverts mercY", () => {
    const v = defaultView(764, 510);
    const c = project(v, v.lat, v.lon);
    expect(c.x).toBeCloseTo(382);
    expect(c.y).toBeCloseTo(255);
    expect(mercLat(mercY(33.3))).toBeCloseTo(33.3, 9);
  });

  it("matches the Home capture: Chicago lands near x 913, y 466 of the 1210pt screen", () => {
    // The map's left edge is at x 426 and its top at y 288 in the scrolled capture.
    const p = project(defaultView(766, 510), 41.88, -87.63);
    expect(426 + p.x).toBeGreaterThan(900);
    expect(426 + p.x).toBeLessThan(925);
    expect(288 + p.y).toBeGreaterThan(455);
    expect(288 + p.y).toBeLessThan(478);
  });
});

describe("showAnnotations fit", () => {
  const honolulu = { lat: 21.3, lon: -157.86 };
  const bay = [
    { lat: 37.33, lon: -121.89 },
    { lat: 37.79, lon: -122.41 },
  ];
  it("fits Hawaii and the Bay Area at about 19.6pt per degree", () => {
    const v = fitView([honolulu, ...bay], 923, 493);
    expect(v.ppd).toBeGreaterThan(18.5);
    expect(v.ppd).toBeLessThan(20.5);
  });
  it("falls back to the default region without pins and zooms to a city for one pin", () => {
    expect(fitView([], 764, 510)).toEqual(defaultView(764, 510));
    expect(fitView([bay[0]], 764, 510).ppd).toBeGreaterThan(50);
  });
});

describe("clustering", () => {
  const v = fitView(
    [
      { lat: 21.3, lon: -157.86 },
      { lat: 37.5, lon: -122.2 },
    ],
    923,
    493,
  );
  it("merges nearby pins at their centroid and keeps far ones apart", () => {
    const pins = [
      { id: "a", lat: 37.5, lon: -122.2 },
      { id: "b", lat: 37.51, lon: -122.19 },
      { id: "c", lat: 21.3, lon: -157.86 },
    ];
    const cl = clusterPins(pins, v);
    expect(cl.map((c) => c.members.length).sort()).toEqual([1, 2]);
    const two = cl.find((c) => c.members.length === 2)!;
    expect(two.lat).toBeCloseTo(37.505, 6);
  });
  it("splits the same pins once zoomed in", () => {
    const zoomed = { ...v, ppd: 4000, lat: 37.5, lon: -122.2 };
    const cl = clusterPins(
      [
        { id: "a", lat: 37.5, lon: -122.2 },
        { id: "b", lat: 37.51, lon: -122.19 },
      ],
      zoomed,
    );
    expect(cl).toHaveLength(2);
  });
});

describe("plottable and zoom", () => {
  it("drops null and zero coordinates like the device query", () => {
    expect(plottable(null, 5)).toBe(false);
    expect(plottable(0, -122)).toBe(false);
    expect(plottable(37.5, 0)).toBe(false);
    expect(plottable(37.5, -122.4)).toBe(true);
    expect(plottable(95, 10)).toBe(false);
  });
  it("converts points per degree to a tile zoom", () => {
    expect(tileZoom(256 / 360)).toBeCloseTo(0);
    expect(tileZoom(512 / 360)).toBeCloseTo(1);
  });
});
