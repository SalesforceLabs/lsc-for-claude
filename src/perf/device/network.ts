/**
 * Network condition shaping for the first-sync simulator: latency per request
 * and a downlink/uplink bandwidth cap shared by every request in flight, so four
 * tables downloading at once split the link the way they would on a real one.
 *
 * Model (kept simple on purpose):
 *  - Latency: each request costs one RTT, half before the request is sent and
 *    half once the response has arrived (the first-byte trip back).
 *  - Bandwidth: a token bucket per direction, shared by all requests. Bytes are
 *    taken in small slices, so concurrent streams interleave and each gets a fair
 *    share. A transport that streams (see session.ts) takes per chunk while it
 *    reads, which backs the real TCP connection off; one that does not (a mocked
 *    http) takes the whole body after the fact.
 *  - Shaping only adds time. If this machine's link is already slower than the
 *    profile, the result reflects the real link.
 *
 * Packet loss is not modelled.
 */

export type NetworkProfileId = "none" | "3g" | "4g" | "5g" | "wifi" | "custom";

export interface NetworkProfile {
  id: Exclude<NetworkProfileId, "custom">;
  label: string;
  rttMs: number;
  downMbps: number;
  upMbps: number;
}

/**
 * Preset numbers are APPROXIMATE. They follow the presets that ship with Apple's
 * Network Link Conditioner (3G: 780 kbps down / 330 kbps up, 100 ms each way; LTE:
 * 50 Mbps down / 10 Mbps up; Wi-Fi: 40 Mbps down / 33 Mbps up, ~1 ms) as recalled,
 * not read from a file: this machine has no copy of the profiles. 5G is not an
 * Apple preset and is a typical mid-band figure. Correct them here if you have a
 * citable source.
 */
export const NETWORK_PROFILES: readonly NetworkProfile[] = [
  { id: "none", label: "None (this machine's connection)", rttMs: 0, downMbps: 0, upMbps: 0 },
  { id: "3g", label: "3G", rttMs: 200, downMbps: 0.78, upMbps: 0.33 },
  { id: "4g", label: "4G/LTE", rttMs: 100, downMbps: 50, upMbps: 10 },
  { id: "5g", label: "5G", rttMs: 30, downMbps: 200, upMbps: 30 },
  { id: "wifi", label: "Wi-Fi", rttMs: 2, downMbps: 40, upMbps: 33 },
];

export const CUSTOM_PROFILE_LABEL = "Custom";

/** What the caller asks for. */
export interface NetworkOptions {
  profile: NetworkProfileId;
  /** Custom only (also overrides a preset's value when given). */
  rttMs?: number;
  downMbps?: number;
  upMbps?: number;
}

/** The settings a run used, recorded in its result. */
export interface NetworkSettings {
  profile: NetworkProfileId;
  label: string;
  rttMs: number;
  downMbps: number;
  upMbps: number;
  /** True for the built-in presets, whose numbers are approximate. */
  approximate: boolean;
}

export const NETWORK_LIMITATION =
  "Network shaping can only slow this machine's connection down. If the real link is already slower than the profile, the result reflects the real link.";

const MAX_RTT_MS = 5000;
const MIN_MBPS = 0.05;
const MAX_MBPS = 10000;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Validate and resolve options to concrete numbers; `undefined` (or "none") means no shaping. */
export function resolveNetwork(opts: NetworkOptions | undefined): NetworkSettings | undefined {
  if (!opts || opts.profile === "none") return undefined;
  if (opts.profile === "custom") {
    if (!finite(opts.rttMs) || !finite(opts.downMbps) || !finite(opts.upMbps)) {
      throw new Error("A custom network profile needs rttMs, downMbps and upMbps.");
    }
    return {
      profile: "custom",
      label: CUSTOM_PROFILE_LABEL,
      rttMs: clamp(opts.rttMs, 0, MAX_RTT_MS),
      downMbps: clamp(opts.downMbps, MIN_MBPS, MAX_MBPS),
      upMbps: clamp(opts.upMbps, MIN_MBPS, MAX_MBPS),
      approximate: false,
    };
  }
  const preset = NETWORK_PROFILES.find((p) => p.id === opts.profile);
  if (!preset) throw new Error(`Unknown network profile "${String(opts.profile)}".`);
  return {
    profile: preset.id,
    label: preset.label,
    rttMs: finite(opts.rttMs) ? clamp(opts.rttMs, 0, MAX_RTT_MS) : preset.rttMs,
    downMbps: finite(opts.downMbps) ? clamp(opts.downMbps, MIN_MBPS, MAX_MBPS) : preset.downMbps,
    upMbps: finite(opts.upMbps) ? clamp(opts.upMbps, MIN_MBPS, MAX_MBPS) : preset.upMbps,
    approximate: true,
  };
}

/** One-line description for the UI, history rows and the report. */
export function describeNetwork(n: NetworkSettings | undefined): string {
  if (!n) return "None (this machine's connection)";
  const mbps = (v: number) => (v < 10 ? v.toFixed(2).replace(/\.?0+$/, "") : String(Math.round(v)));
  return `${n.label}${n.approximate ? " (approximate)" : ""}: ${n.rttMs} ms RTT, ${mbps(n.downMbps)}/${mbps(n.upMbps)} Mbps down/up`;
}

export interface Clock {
  /** Monotonic milliseconds. */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export const realClock: Clock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const BYTES_PER_MBIT = 125_000;

/**
 * Shared rate limiter. `take(n)` returns once n bytes may pass. Tokens may go
 * negative (debt), so concurrent takers queue behind each other in proportion to
 * what they asked for; callers take in slices so streams interleave.
 */
export class TokenBucket {
  readonly bytesPerSecond: number;
  /** Largest credit that can build up while idle. */
  readonly burstBytes: number;
  /** Bytes a caller should take at a time (about 10 ms of the link). */
  readonly sliceBytes: number;
  private tokens: number;
  private last: number;

  constructor(
    mbps: number,
    private readonly clock: Clock = realClock
  ) {
    this.bytesPerSecond = Math.max(1, mbps * BYTES_PER_MBIT);
    this.sliceBytes = Math.round(clamp(this.bytesPerSecond / 100, 1024, 65536));
    this.burstBytes = this.sliceBytes;
    this.tokens = this.burstBytes;
    this.last = clock.now();
  }

  async take(bytes: number): Promise<void> {
    if (bytes <= 0) return;
    const t = this.clock.now();
    this.tokens = Math.min(
      this.burstBytes,
      this.tokens + ((t - this.last) / 1000) * this.bytesPerSecond
    );
    this.last = t;
    this.tokens -= bytes;
    if (this.tokens >= 0) return;
    await this.clock.sleep((-this.tokens / this.bytesPerSecond) * 1000);
  }

  /** Take `bytes` in slices, so other streams get their turn. */
  async takeSliced(bytes: number): Promise<void> {
    for (let left = bytes; left > 0; left -= this.sliceBytes)
      await this.take(Math.min(left, this.sliceBytes));
  }
}

/** One shaper per simulation run: its buckets are the link every request shares. */
export class NetworkShaper {
  readonly down: TokenBucket;
  readonly up: TokenBucket;

  constructor(
    readonly settings: NetworkSettings,
    private readonly clock: Clock = realClock
  ) {
    this.down = new TokenBucket(settings.downMbps, clock);
    this.up = new TokenBucket(settings.upMbps, clock);
  }

  /** Half the RTT: the trip out before a request, or the trip back before its response. */
  async halfRtt(): Promise<void> {
    if (this.settings.rttMs > 0) await this.clock.sleep(this.settings.rttMs / 2);
  }
}

/**
 * A note when the measured transfer rate fell well short of the profile's, which
 * means this machine's own link was the limit. Needs a transfer long enough to
 * measure.
 */
export function realLinkNote(
  settings: NetworkSettings,
  bytes: number,
  seconds: number
): string | undefined {
  if (bytes < 1024 * 1024 || seconds <= 0) return undefined;
  const measured = (bytes * 8) / 1_000_000 / seconds;
  if (measured >= settings.downMbps * 0.8) return undefined;
  return (
    `The metadata download ran at about ${measured.toFixed(1)} Mbps, below the ${settings.label} profile's ${settings.downMbps} Mbps ` +
    `(request latency included), so this machine's connection (or the server) may be slower than the profile and the timings reflect it.`
  );
}
