// Hand-placed map labels for IpadMap: Natural Earth has no label points for states or seafloor features.
// Positions were measured from the iPad's Apple Maps captures (Home Up Next map, Accounts map) and written as latitude / longitude.

/** State and province abbreviations at state-centroid positions: [text, lat, lon]. */
export const REGION_LABELS: [string, number, number][] = [
  ["AL", 32.8, -86.8], ["AZ", 34.3, -111.7], ["AR", 34.9, -92.4], ["CA", 37.1, -120.2], ["CO", 39, -105.5], ["CT", 41.6, -72.7],
  ["DE", 39, -75.5], ["FL", 28.6, -82.4], ["GA", 32.7, -83.4], ["ID", 44.4, -114.6], ["IL", 40, -89.2], ["IN", 39.9, -86.3],
  ["IA", 42, -93.5], ["KS", 38.5, -98.4], ["KY", 37.5, -85.3], ["LA", 31, -92], ["ME", 45.3, -69.2], ["MD", 39, -76.8],
  ["MA", 42.3, -71.8], ["MI", 44, -85], ["MN", 46, -94.5], ["MS", 32.7, -89.7], ["MO", 38.5, -92.5], ["MT", 47, -109.6],
  ["NE", 41.5, -99.8], ["NV", 39.5, -117], ["NH", 43.7, -71.6], ["NJ", 40.1, -74.5], ["NM", 34.4, -106.1], ["NY", 42.9, -75.5],
  ["NC", 35.5, -79.4], ["ND", 47.5, -100.4], ["OH", 40.3, -82.8], ["OK", 35.6, -97.5], ["OR", 43.9, -120.6], ["PA", 41, -77.8],
  ["RI", 41.7, -71.5], ["SC", 33.9, -80.9], ["SD", 44.4, -100.2], ["TN", 35.8, -86.4], ["TX", 31.5, -99.3], ["UT", 39.3, -111.7],
  ["VT", 44, -72.7], ["VA", 37.5, -78.8], ["WA", 47.4, -120.5], ["WV", 38.6, -80.6], ["WI", 44.6, -89.8], ["WY", 43, -107.5],
  ["ON", 49.76, -85.98], ["NB", 46.6, -66.4], ["BC", 54, -125], ["AB", 55, -115], ["SK", 54, -106], ["MB", 54, -98], ["QC", 52, -72],
];

/** Country names, drawn in spaced capitals: [text, lat, lon]. */
export const COUNTRY_LABELS: [string, number, number][] = [
  ["UNITED STATES", 39.37, -101.36],
  ["MEXICO", 24.38, -102.16],
  ["CANADA", 58, -105],
];

/** Water names (italic). `lines` stacks the words. */
export const WATER_LABELS: { lines: string[]; lat: number; lon: number }[] = [
  { lines: ["Gulf of", "America"], lat: 25.76, lon: -89.26 },
  { lines: ["North", "Pacific", "Ocean"], lat: 21.98, lon: -140.13 },
];

/** Seafloor features the iPad labels along a line: text drawn from `from` to `to` with wide letter spacing. */
export const LINE_LABELS: { text: string; from: [number, number]; to: [number, number]; kind: "sea" | "land" }[] = [
  { text: "MENDOCINO SEASCARP", from: [40.128, -152.274], to: [39.991, -143.141], kind: "sea" },
  { text: "MENDOCINO FRACTURE ZONE", from: [38.609, -152.657], to: [39.441, -141.305], kind: "sea" },
  { text: "PIONEER FRACTURE ZONE", from: [37.908, -143.09], to: [38.549, -133.014], kind: "sea" },
  { text: "MURRAY FRACTURE ZONE", from: [30.689, -149.06], to: [32.311, -139.264], kind: "sea" },
  { text: "MOLOKAI FRACTURE ZONE", from: [22.877, -147.427], to: [24.406, -137.325], kind: "sea" },
  { text: "ROCKY MOUNTAINS", from: [51.9, -116.9], to: [40.84, -107.48], kind: "land" },
];

/** Cities the Home Up Next map labels at its default region (Apple Maps' own pick; Natural Earth's ranking differs). */
export const HOME_CITIES = new Set([
  "Calgary", "Winnipeg", "Vancouver", "Seattle", "Portland", "San Francisco", "Salt Lake City", "Las Vegas", "Los Angeles", "San Diego", "Phoenix",
  "Minneapolis", "Kansas City", "St. Louis", "Chicago", "Detroit", "Toronto", "London", "Ottawa", "Montreal", "Boston", "New York", "Philadelphia",
  "Washington, D.C.", "Charlotte", "Dallas", "Houston", "San Antonio", "New Orleans", "Miami", "Monterrey",
]);
