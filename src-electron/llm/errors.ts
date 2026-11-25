import type { ApiStyle } from "./connection.js";

/** An HTTP error from a model API, with a message a user can act on. */
export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string
  ) {
    super(message);
  }
}

interface ErrorContext {
  /** e.g. "The gateway", "Anthropic", "OpenAI" */
  service: string;
  url: string;
  style: ApiStyle;
  model?: string;
}

function shorten(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Pull `error.message` out of an Anthropic- or OpenAI-style error body. */
function bodyMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const message =
      typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? parsed.message);
    if (message) return message;
  } catch {
    // not JSON
  }
  return body;
}

/** Error text for a request over the model's context window (Anthropic, Bedrock, OpenAI, LiteLLM wordings). */
const CONTEXT_FULL =
  /prompt is too long|context.?window|context_length_exceeded|maximum context length|too many (input )?tokens/i;

/**
 * Error text saying the model itself is unknown or unavailable. A 400 that only mentions the model
 * ("tool_choice … is not supported for this model") is about the request, not the model.
 */
const MODEL_UNKNOWN =
  /model\b[^.]{0,80}\b(?:not found|does not exist|doesn(?:'|’)?t exist|not available|unavailable|not supported\b(?! for this model)|is invalid|not recogni[sz]ed|no access|not allowed)|(?:invalid|unknown|unsupported|no such) model|model (?:id|name) (?:is )?invalid|not a valid model|access to (?:the |this )?model|model_not_found/i;

export function describeHttpError(
  status: number,
  body: string,
  ctx: ErrorContext
): ProviderHttpError {
  const detail = shorten(bodyMessage(body));
  const mentionsModel = ctx.model !== undefined && /model/i.test(detail);
  let message: string;
  if (status === 401 || status === 403) {
    message = `${ctx.service} rejected the credentials (HTTP ${status}). Check the API key or token.`;
  } else if ((status === 400 || status === 413) && CONTEXT_FULL.test(detail)) {
    message = `The conversation is now too long for the model to read (HTTP ${status}). Start a new session, and ask for less at once (for example, a narrower query).`;
  } else if ((status === 404 && mentionsModel) || (status === 400 && mentionsModel && MODEL_UNKNOWN.test(detail))) {
    message = `${ctx.service} doesn't serve the model "${ctx.model}". Pick another model.`;
  } else if (status === 404) {
    const hint = ctx.style === "openai" ? " OpenAI-compatible base URLs usually end in /v1." : "";
    message = `Nothing answered at ${ctx.url} (HTTP 404). Check the base URL.${hint}`;
  } else if (status === 429) {
    message = `${ctx.service} is rate-limiting requests or the account is out of quota (HTTP 429).`;
  } else if (status >= 500) {
    message = `${ctx.service} had a server error (HTTP ${status}). Try again in a moment.`;
  } else {
    message = `${ctx.service} returned HTTP ${status}.`;
  }
  return new ProviderHttpError(detail ? `${message} Details: ${detail}` : message, status, detail);
}

/** A failed `fetch` (no HTTP response at all), explained. */
export function describeNetworkError(error: unknown, url: string): Error {
  const err = error as { message?: string; cause?: { code?: string; message?: string } };
  const code = err?.cause?.code ?? "";
  const text = `${err?.message ?? ""} ${err?.cause?.message ?? ""}`;
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // keep the raw URL
  }
  if (code === "ENOTFOUND" || /ERR_NAME_NOT_RESOLVED/.test(text)) {
    return new Error(
      `Couldn't find ${host}. Check the base URL, or connect to your company's VPN.`
    );
  }
  if (code === "ECONNREFUSED" || /ERR_CONNECTION_REFUSED/.test(text)) {
    return new Error(`Nothing is listening at ${host}. Is the server running?`);
  }
  if (/CERT|certificate|ISSUER/i.test(code + text)) {
    return new Error(
      `${host}'s TLS certificate isn't trusted on this computer. Ask IT to install your company's root certificate in the system keychain.`
    );
  }
  if (/timed? ?out|ETIMEDOUT|ERR_TIMED_OUT/i.test(code + text)) {
    return new Error(`${host} didn't answer in time. Check your network or VPN.`);
  }
  return new Error(`Couldn't reach ${host}: ${shorten(text || String(error))}`);
}

/** The endpoint answered and rejected the key or token. */
export function isAuthError(error: unknown): boolean {
  return error instanceof ProviderHttpError && (error.status === 401 || error.status === 403);
}
