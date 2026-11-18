/**
 * Studio's stand-in for the CLM player's Common.js. LSC Mobile copies its own Common.js into every page
 * folder as Common_3i0p1.js and adds a script tag for it to each slide's <head> (lifesciences-ios
 * CLMDownloadService.swift addTextToHTMLFiles / injectCommonJS). That file isn't ours to ship, so this
 * one is written from the API slides call (SlideRequestParser.swift): the same global `PresentationPlayer`
 * with the same methods. Calls go to the preview over postMessage instead of `webkit.messageHandlers.nativeCall`.
 *
 * Studio-only additions, since the slide runs in a desktop frame rather than a WKWebView:
 * - it reports the slide's `<meta name="viewport" width>`, so the preview can scale the frame as WebKit does;
 * - it reports short horizontal drags as swipes (the app's pan gesture sits over the web view);
 * - it cancels link taps and reports them (the app opens http/https/file links full screen and never in the slide).
 */
export const CLM_BRIDGE_FILE = "Common_3i0p1.js";

/** The `<head>` replacement LSC Mobile writes into each top-level slide (CLMDownloadService.swift:116-120). */
export const CLM_BRIDGE_TAG = `<script src="${CLM_BRIDGE_FILE}" type="text/javascript"></script>`;

/** Adds the bridge's script tag right after `<head>`, as the app does; a slide that already loads it, or has no `<head>`, gets it first. */
export function injectBridgeTag(html: string): string {
  if (html.includes(CLM_BRIDGE_FILE)) return html;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (!head) return CLM_BRIDGE_TAG + html;
  const end = head.index + head[0].length;
  return html.slice(0, end) + CLM_BRIDGE_TAG + html.slice(end);
}

export const CLM_BRIDGE_JS = String.raw`(function () {
  if (window.PresentationPlayer && window.PresentationPlayer.__studio) return;
  var seq = 0;
  function post(request, params) {
    try { parent.postMessage({ __clm: 1, request: request, params: params || {} }, "*"); } catch (e) {}
  }
  // The app calls back a named global; slides pass a name or a function.
  function callbackName(cb) {
    if (typeof cb === "function") {
      var name = "__studioClmCallback" + (++seq);
      window[name] = cb;
      return name;
    }
    return typeof cb === "string" ? cb : null;
  }
  var listeners = {};
  var P = {
    __studio: true,
    gotoSlide: function (sequenceId, slideName, animation) {
      post("gotoSlide", {
        pageId: sequenceId == null || sequenceId === "" ? null : String(sequenceId),
        slideName: slideName == null || slideName === "" ? null : String(slideName),
        animation: animation == null ? null : String(animation)
      });
    },
    goNextPage: function () { post("goNextPage"); },
    goPreviousPage: function () { post("goPreviousPage"); },
    fetchWithParams: function (query, parameters, callbackMethod) {
      post("fetchWithParams", { query: query, queryParameters: parameters, callbackMethod: callbackName(callbackMethod) });
    },
    upsert: function (objects, callbackMethod) { post("upsert", { objects: objects, callbackMethod: callbackName(callbackMethod) }); },
    createVisit: function (callback) { post("createVisit", { callbackMethod: callbackName(callback) }); },
    saveState: function (state) { post("saveState", { state: state == null ? "" : String(state) }); },
    startTrackingPage: function (pageid) { post("startTrackingPage", { pageid: pageid }); },
    stopTrackingPage: function () { post("stopTrackingPage"); },
    trackInteraction: function (payload) { post("trackInteraction", { payload: payload }); },
    updateFeedback: function (type) { post("updateFeedback", { type: type }); },
    launchApprovedEmail: function () { post("launchApprovedEmail"); },
    launchEmails: function (templates) { post("launchEmails", { templates: templates || [] }); },
    getSurveyFlowJson: function (json) { post("getSurveyFlowJson", { json: json }); },
    setSurveyFlowJson: function (json, state) { post("setSurveyFlowJson", { json: json, state: state || "save" }); },
    alert: function (message) { post("alert", { message: message == null ? "" : String(message) }); },
    logError: function (message) { post("logError", { message: message == null ? "" : String(message) }); },
    disableDismiss: function () { post("disableDismiss"); },
    enableDismiss: function () { post("enableDismiss"); },
    defineNoSwipeRegion: function (regionId, x, y, width, height) {
      post("defineNoSwipeRegion", { regionId: String(regionId), x: +x, y: +y, width: +width, height: +height });
    },
    destroyNoSwipeRegion: function (regionId) { post("destroyNoSwipeRegion", { regionId: String(regionId) }); },
    pauseVideoPlayback: function () {
      var v = document.querySelectorAll("video");
      for (var i = 0; i < v.length; i++) { try { v[i].pause(); } catch (e) {} }
    },
    addAction: function () { post("addAction"); },
    registerEventListener: function (eventType, fn) {
      if (typeof fn !== "function") return;
      (listeners[eventType] = listeners[eventType] || []).push(fn);
    },
    executeEvent: function (eventType, param) {
      var list = (listeners[eventType] || []).slice();
      for (var i = 0; i < list.length; i++) { try { list[i](param); } catch (e) { P.logError(String(e && e.message || e)); } }
    }
  };
  window.PresentationPlayer = P;

  window.addEventListener("error", function (e) {
    P.logError((e && e.message) || "Script error");
  });

  // Replies and native events from the preview.
  window.addEventListener("message", function (e) {
    if (e.source !== parent) return;
    var d = e.data;
    if (!d || d.__clm !== 1) return;
    if (d.event) { P.executeEvent(d.event, d.param); return; }
    if (d.callback && /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(d.callback)) {
      var fn = window, parts = d.callback.split(".");
      for (var i = 0; i < parts.length && fn; i++) fn = fn[parts[i]];
      if (typeof fn === "function") { try { fn(d.value); } catch (err) { P.logError(String(err && err.message || err)); } }
    }
  });

  function reportViewport() {
    var meta = document.querySelector('meta[name="viewport"]');
    var m = meta && /(?:^|[,;\s])width\s*=\s*(\d+)/i.exec(meta.getAttribute("content") || "");
    // A number: the meta width; null: device-width (scale 1); 0: no viewport tag (WebKit lays out at 980).
    post("__viewport", { width: m ? +m[1] : meta && /device-width/i.test(meta.getAttribute("content") || "") ? null : 0 });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", reportViewport);
  else reportViewport();

  // Short horizontal drags are swipes; the preview applies the app's limits and no-swipe regions.
  var start = null;
  window.addEventListener("pointerdown", function (e) {
    if (e.isPrimary) start = { x: e.clientX, y: e.clientY, t: Date.now() };
  }, true);
  window.addEventListener("pointerup", function (e) {
    if (!start || !e.isPrimary) return;
    var s = start; start = null;
    post("__swipe", { x: s.x, y: s.y, dx: e.clientX - s.x, dy: e.clientY - s.y, ms: Date.now() - s.t });
  }, true);

  // The app never follows a link inside the slide.
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (!href || href.charAt(0) === "#" || /^javascript:/i.test(href)) return;
    e.preventDefault();
    post("__link", { href: a.href || href });
  }, true);
})();
`;
