// Stremflix TV: runs in web.stremio.com before the page's own scripts. It stands in for Stremio Enhanced
// (the plugin API Stremflix expects), loads the built-in Stremflix plugin, fits the page to a TV, and hands
// every stream to the app's native player, keeping Stremio's watch progress in step.
(function () {
  "use strict";
  if (window.__dxbiTv) return;
  const native = window.DxbiTV;
  if (!native) return;

  const PLUGIN = "dxbi.plugin.js";
  const tv = (window.__dxbiTv = {});

  // ---------------------------------------------------------------------------
  // Fit the page to the TV: lay it out 1280 CSS pixels wide (a 10-foot size on any screen)
  // ---------------------------------------------------------------------------
  const VIEWPORT = /dxbi-mobile\//.test(navigator.userAgent)
    ? "width=device-width, initial-scale=1" : "width=1280, user-scalable=no";
  function fitViewport() {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      if (!document.head) return;
      meta = document.createElement("meta");
      meta.name = "viewport";
      document.head.append(meta);
    }
    if (meta.content !== VIEWPORT) meta.content = VIEWPORT;
  }
  new MutationObserver(fitViewport).observe(document.documentElement, { childList: true, subtree: true });
  fitViewport();

  // ---------------------------------------------------------------------------
  // What Stremio Enhanced provides and Stremflix relies on
  // ---------------------------------------------------------------------------

  // Stremio's router changes the address with pushState, which fires no event: Stremflix listens for hashchange
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event("hashchange"));
      return result;
    };
  }

  // Stremio drops window.core on some screens: keep the first working copy
  const permanent = (window.__permanentCore = { getState: null, dispatch: null });
  let services;
  Object.defineProperty(window, "services", {
    configurable: true,
    get() { return services; },
    set(value) {
      services = value;
      const core = value && value.core;
      if (core && core.getState && !permanent.getState) permanent.getState = core.getState.bind(core);
      if (core && core.dispatch && !permanent.dispatch) permanent.dispatch = core.dispatch.bind(core);
    },
  });
  const core = () => {
    const live = window.core || (services && services.core);
    return {
      getState: (live && live.getState && live.getState.bind(live)) || permanent.getState,
      dispatch: (live && live.dispatch && live.dispatch.bind(live)) || permanent.dispatch,
    };
  };

  const schemas = {};
  const savedListeners = {};

  function readSettings(plugin) {
    try { return JSON.parse(native.getSettings(plugin) || "{}") || {}; } catch (_) { return {}; }
  }

  const api = {
    info: (plugin, message) => console.log(`[${plugin}]`, message),
    warn: (plugin, message) => console.warn(`[${plugin}]`, message),
    error: (plugin, message) => console.error(`[${plugin}]`, message),
    getSetting: async (plugin, key) => {
      const value = readSettings(plugin)[key];
      return value === undefined ? null : value;
    },
    getSettings: async (plugin) => readSettings(plugin),
    saveSetting: async (plugin, key, value) => {
      native.saveSetting(plugin, key, JSON.stringify(value === undefined ? null : value));
      const all = readSettings(plugin);
      for (const callback of savedListeners[plugin] || []) {
        try { callback(all); } catch (err) { console.error(err); }
      }
      return true;
    },
    registerSettings: async (plugin, schema) => { schemas[plugin] = schema; },
    onSettingsSaved: (plugin, callback) => { (savedListeners[plugin] = savedListeners[plugin] || []).push(callback); },
    showAlert: (type, title, message, buttons) => dialog({ title, message, buttons: buttons && buttons.length ? buttons : ["OK"] }),
    showPrompt: (plugin, title, message, defaultValue) => dialog({ title, message, buttons: ["OK", "Cancel"], input: defaultValue == null ? "" : String(defaultValue) })
      .then((r) => (r && r.button === 0 ? r.value : null)),
    // Stremflix's "Open in mpv / VLC" goes to the app's own player here
    launchExternalPlayer: async (player, url) => {
      native.play(JSON.stringify({ url, title: document.title || "Stremflix" }));
      return { success: true };
    },
    getExternalPlayerPaths: async () => ({ vlc: null, mpv: null }),
    applyTheme: () => {},
    getGpuRenderer: async () => "auto",
    setGpuRenderer: async () => {},
  };
  window.StremioEnhancedAPI = api;

  // ---------------------------------------------------------------------------
  // Dialogs (alerts, prompts, settings): plain page elements, so the remote's arrows and OK work
  // ---------------------------------------------------------------------------
  const STYLE = `
    html.dx-tv-fast *, html.dx-tv-fast *::before, html.dx-tv-fast *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
    html.dx-tv-fast [class*="meta-item-container"], html.dx-tv-fast [class*="meta-item-container"] * { transition-duration: 0s !important; }
    /* The theme shows See All only while a mouse is over its row: a remote never hovers */
    html.dx-tv #app [class*="meta-row"] [class*="see-all-container"] { opacity: 1 !important; transform: none !important; }
    html.dx-tv a[title="See All"]:focus { outline: 3px solid var(--dx-accent, #68e2cd) !important; outline-offset: 4px; background: #243d42 !important; color: white !important; }
    html.dx-tv [class*="meta-item-container"] a:focus { outline: 3px solid var(--dx-accent, #68e2cd) !important; outline-offset: -3px; }
    html.dx-tv [class*="selectable-inputs-container"] [tabindex]:focus, html.dx-tv .dxl-tools :focus { outline: 3px solid var(--dx-accent, #68e2cd) !important; outline-offset: -3px; background: #243d42 !important; color: #fff !important; }
    html.dx-tv a[class*="nav-tab-button"]:focus { outline: none !important; background: transparent !important; box-shadow: none !important; color: #fff !important; opacity: 1 !important; }
    html.dx-tv a[class*="nav-tab-button"], html.dx-tv a[class*="nav-tab-button"] [class*="label"], html.dx-tv a[class*="nav-tab-button"] [class*="icon"] { transition: none !important; }
    html.dx-tv a[class*="nav-tab-button"]:focus [class*="label"], html.dx-tv a[class*="nav-tab-button"]:focus [class*="icon"] { color: #fff !important; opacity: 1 !important; }
    .dxtv-modal { position: fixed; inset: 0; z-index: 2147483600; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.72); font-family: Inter, system-ui, sans-serif; }
    .dxtv-sheet { width: min(640px, 86vw); max-height: 84vh; overflow: auto; padding: 28px 30px; border-radius: 14px; background: #1c1c1c; color: #fff; box-shadow: 0 24px 80px rgba(0,0,0,.6); }
    .dxtv-sheet h2 { margin: 0 0 10px; font-size: 24px; font-weight: 700; }
    .dxtv-sheet p { margin: 0 0 18px; color: #c8c8c8; font-size: 16px; line-height: 1.5; white-space: pre-line; }
    .dxtv-sheet input[type=text] { width: 100%; box-sizing: border-box; margin: 0 0 18px; padding: 12px 14px; border: 2px solid #444; border-radius: 8px; background: #111; color: #fff; font-size: 17px; }
    .dxtv-sheet input[type=text]:focus { border-color: #fff; outline: none; }
    .dxtv-buttons { display: flex; flex-wrap: wrap; gap: 12px; justify-content: flex-end; }
    .dxtv-btn { padding: 11px 22px; border: 0; border-radius: 8px; background: rgba(255,255,255,.14); color: #fff; font: 600 16px Inter, system-ui, sans-serif; cursor: pointer; transition: transform .15s, background-color .15s; }
    .dxtv-btn:focus { outline: none; background: #fff; color: #000; transform: scale(1.06); }
    .dxtv-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; width: 100%; margin: 0 0 8px; padding: 14px 16px; border: 0; border-radius: 10px; background: rgba(255,255,255,.06); color: #fff; text-align: left; font: 500 16px Inter, system-ui, sans-serif; cursor: pointer; }
    .dxtv-row:focus { outline: none; background: rgba(255,255,255,.18); transform: scale(1.015); }
    .dxtv-row small { display: block; margin-top: 4px; color: #9a9a9a; font-size: 13px; line-height: 1.4; }
    .dxtv-row b { flex: none; color: #e50914; font-weight: 700; }
    .dxtv-settings-entry { margin: 0 0 24px; }
    /* No streaming server runs on the TV itself (debrid streams don't need one): no nagging bar */
    [class*="board-warning-container"] { display: none !important; }
    /* Household profile: its avatar stands in for the Stremio account picture, header and menu */
    .dxtv-avatar { position: relative; overflow: hidden; background: linear-gradient(145deg, var(--dxtv-a1), var(--dxtv-a2)) !important; }
    .dxtv-avatar img { visibility: hidden; }
    .dxtv-avatar::after { content: attr(data-initial); position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font: 700 1.05em Inter, system-ui, sans-serif; }
    [class*="nav-menu-container"] .dxtv-avatar::after { font-size: 1.6em; }
    html.dx-tv nav [class*="nav-menu-popup-label"]:focus { outline: none !important; }
    html.dx-tv nav [class*="nav-menu-popup-label"]:focus .dxtv-avatar, html.dx-tv nav [class*="nav-menu-popup-label"]:focus [class*="avatar"] { outline: 3px solid #fff; outline-offset: 3px; }
    .dxtv-whoami { margin: 0 0 2px; color: #fff; font: 600 18px Inter, system-ui, sans-serif; }
    /* Signing a profile's Stremio account out is done from Manage Profiles, not here */
    .dxtv-household [class*="user-info-details"] [class*="buttons-container"] { display: none !important; }
    .dxtv-household [class*="user-info-details"] [class*="email-label"] { opacity: .6; font-size: 13px; }
    /* While a stream is being found: the title's backdrop, its name and a spinner, never a black page */
    .dxtv-starting { position: fixed; inset: 0; z-index: 2147483500; background: #000 center / cover no-repeat; }
    .dxtv-starting::before { content: ""; position: absolute; inset: 0; background: linear-gradient(0deg, rgba(0,0,0,.95), rgba(0,0,0,.6) 50%, rgba(0,0,0,.3)); }
    /* Same place and size as the native player's start screen that follows (activity_player.xml), so
       the hand-over doesn't jump: on a 1280-wide page, 1dp of a 1080p TV is 1.33px */
    .dxtv-starting-info { position: absolute; left: 85px; right: 85px; bottom: 75px; color: #fff; font-family: Roboto, system-ui, sans-serif; }
    .dxtv-starting-info i { display: block; box-sizing: border-box; width: 53px; height: 53px; margin-bottom: 27px; border: 4px solid rgba(255,255,255,.25); border-top-color: #fff; border-radius: 50%; animation: dxtv-spin .9s linear infinite; }
    .dxtv-starting-info b { display: block; font-size: 45px; font-weight: 700; line-height: 1.17; }
    .dxtv-starting-info span { display: block; margin-top: 8px; color: rgba(255,255,255,.8); font-size: 24px; }
    @keyframes dxtv-spin { to { transform: rotate(360deg); } }
    .dxtv-toast { position: fixed; left: 50%; bottom: 48px; z-index: 2147483600; transform: translateX(-50%); padding: 14px 22px; border-radius: 10px; background: rgba(20,20,20,.94); color: #fff; font: 500 16px Inter, system-ui, sans-serif; box-shadow: 0 10px 40px rgba(0,0,0,.5); }
  `;
  function ensureStyle() {
    if (document.getElementById("dxtv-style")) return;
    const style = document.createElement("style");
    style.id = "dxtv-style";
    style.textContent = STYLE;
    (document.head || document.documentElement).append(style);
  }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let openModal = null;

  // Resolves with the button index (or { button, value } when there's an input); -1 when dismissed
  async function dialog({ title, message, buttons, input }) {
    ensureStyle();
    closeModal();
    // One dialog at a time: Stremio's own (a promotion, an addon to install) goes first, since it
    // holds on to the remote's focus while it's open
    while (document.querySelector('[class*="modal-container"]')) await new Promise((r) => setTimeout(r, 400));
    return new Promise((resolve) => {
      const el = document.createElement("div");
      el.className = "dxtv-modal";
      el.innerHTML = `<div class="dxtv-sheet" role="dialog">
        <h2>${esc(title)}</h2>${message ? `<p>${esc(String(message).replace(/<[^>]+>/g, ""))}</p>` : ""}
        ${input != null ? `<input type="text" value="${esc(input)}">` : ""}
        <div class="dxtv-buttons">${buttons.map((b, i) => `<button class="dxtv-btn" data-i="${i}">${esc(b)}</button>`).join("")}</div>
      </div>`;
      const field = el.querySelector("input");
      const finish = (i) => {
        el.remove();
        if (openModal && openModal.el === el) openModal = null;
        resolve(input != null ? { button: i, value: field ? field.value : "" } : i);
      };
      el.addEventListener("click", (e) => {
        const b = e.target.closest("[data-i]");
        if (b) finish(Number(b.dataset.i));
      });
      document.body.append(el);
      openModal = { el, dismiss: () => finish(-1) };
      const first = field || el.querySelector(".dxtv-btn");
      first.focus();
      // a dialog of Stremio's that just closed hands focus back a moment later: take it again
      for (const ms of [150, 450]) setTimeout(() => { if (el.isConnected && !el.contains(document.activeElement)) first.focus(); }, ms);
    });
  }

  function closeModal() {
    if (openModal) openModal.dismiss();
  }

  function toast(text, ms = 4500) {
    ensureStyle();
    document.querySelectorAll(".dxtv-toast").forEach((n) => n.remove());
    const el = document.createElement("div");
    el.className = "dxtv-toast";
    el.textContent = text;
    document.body.append(el);
    setTimeout(() => el.remove(), ms);
  }

  // Stremflix's settings: an entry at the top of Stremio's Settings, opening a list made for the remote
  // Options for Stremflix's in-page player, which the TV doesn't use (it has its own player)
  const DESKTOP_ONLY = new Set(["playerExtras", "enhance", "seekPreviews", "skipButtons", "autoSkip", "subtitleStyle", "subtitleFont",
    "convertVideo", "subtitlesStart", "hdrSubtitles", "pictureSound", "streamStats", "preloadNext", "upNext", "skipFiller",
    "rememberPlayback", "playerKeys", "pip", "externalPlayer", "remainingTime", "watchParty", "partyFollow", "partyActivity", "partySounds"]);

  function settingsSheet() {
    const plugin = PLUGIN.replace(/\.plugin\.js$/, "");
    const schema = (schemas[plugin] || []).filter((o) => !DESKTOP_ONLY.has(o.key));
    ensureStyle();
    closeModal();
    const el = document.createElement("div");
    el.className = "dxtv-modal";
    const values = () => readSettings(plugin);
    const shown = (o, v) => {
      if (o.type === "toggle") return v ? "On" : "Off";
      if (o.type === "select") return ((o.options || []).find((x) => x.value === v) || {}).label || v;
      return v ? "Set" : "Not set";
    };
    const render = (focusKey) => {
      const current = values();
      el.innerHTML = `<div class="dxtv-sheet" role="dialog"><h2>Stremflix settings</h2>
        ${schema.map((o) => {
          const v = current[o.key] === undefined ? o.defaultValue : current[o.key];
          return `<button class="dxtv-row" data-key="${esc(o.key)}"><span>${esc(o.label)}${o.description ? `<small>${esc(o.description)}</small>` : ""}</span><b>${esc(shown(o, v))}</b></button>`;
        }).join("")}
        <div class="dxtv-buttons"><button class="dxtv-btn" data-close>Done</button></div></div>`;
      const target = (focusKey && el.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)) || el.querySelector(".dxtv-row, .dxtv-btn");
      if (target) target.focus();
    };
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-close]")) { closeModal(); return; }
      const row = e.target.closest("[data-key]");
      if (!row) return;
      const o = schema.find((x) => x.key === row.dataset.key);
      const current = values();
      const v = current[o.key] === undefined ? o.defaultValue : current[o.key];
      if (o.type === "toggle") {
        await api.saveSetting(plugin, o.key, !v);
      } else if (o.type === "select") {
        const options = o.options || [];
        const next = options[(options.findIndex((x) => x.value === v) + 1) % options.length];
        if (next) await api.saveSetting(plugin, o.key, next.value);
      } else {
        el.style.display = "none";
        openModal = null;
        const r = await dialog({ title: o.label, message: o.description || "", buttons: ["Save", "Cancel"], input: v || "" });
        el.style.display = "";
        openModal = { el, dismiss: () => { el.remove(); openModal = null; } };
        if (r && r.button === 0) await api.saveSetting(plugin, o.key, r.value.trim());
      }
      render(o.key);
    });
    document.body.append(el);
    openModal = { el, dismiss: () => { el.remove(); openModal = null; } };
    render();
  }

  function ensureSettingsEntry() {
    if (!/^#\/settings/.test(location.hash)) return;
    const content = document.querySelector('[class*="settings-content"] [class*="sections-container"]');
    if (!content || content.querySelector(".dxtv-settings-entry")) return;
    ensureStyle();
    const entry = document.createElement("button");
    entry.className = "dxtv-row dxtv-settings-entry";
    entry.innerHTML = `<span>Stremflix settings<small>Look, Home rows, previews, trailers, reviews, sounds and more</small></span><b>Open</b>`;
    entry.addEventListener("click", settingsSheet);
    content.prepend(entry);
  }

  // ---------------------------------------------------------------------------
  // Playback: every stream plays in the app's native player. Stremio's own player screen stays
  // underneath, silent, so its watch progress (Continue Watching, watched marks) keeps working.
  // ---------------------------------------------------------------------------
  let handoff = null; // { hash, video id } of the stream the native player has

  // Stremio's in-page video never plays while the native player has the stream
  const realPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if ((handoff || window.__dxbiTvPendingClose) && /^#\/player\//.test(location.hash)) {
      this.muted = true;
      try { this.pause(); } catch (_) { /* not ready */ }
      return Promise.resolve();
    }
    return realPlay.apply(this, arguments);
  };

  function silenceWebPlayer() {
    document.querySelectorAll('[class*="player-container"] video').forEach((v) => {
      v.muted = true;
      if (!v.paused) v.pause();
    });
  }

  function dispatch(action) {
    const d = core().dispatch;
    if (!d) return;
    try { d(action, "player"); } catch (err) { console.warn("[Stremflix TV] dispatch failed", err); }
  }

  async function playerState() {
    const get = core().getState;
    if (!get) return null;
    try { return await get("player"); } catch (_) { return null; }
  }

  function subtitleLabel(lang) {
    try { return new Intl.DisplayNames(["en"], { type: "language" }).of(lang) || lang; } catch (_) { return lang; }
  }

  // Addons can offer dozens of subtitle files: keep up to three per language, with the Stremio
  // subtitle language (and English) first, so the TV's subtitle menu stays short
  async function pickSubtitles(list) {
    let preferred = "";
    try {
      const ctx = await core().getState("ctx");
      preferred = (ctx && ctx.profile && ctx.profile.settings && ctx.profile.settings.subtitlesLanguage) || "";
    } catch (_) { /* no preference */ }
    const rank = (lang) => (lang === preferred ? 0 : /^(eng|en)$/.test(lang) ? 1 : 2);
    const count = {};
    const out = [];
    for (const sub of list.filter((x) => x && x.url).sort((a, b) => rank(a.lang || "") - rank(b.lang || ""))) {
      const lang = sub.lang || "";
      count[lang] = (count[lang] || 0) + 1;
      if (count[lang] > 3) continue;
      // "English", "English 2", "English 3"
      out.push({ url: sub.url, lang, label: subtitleLabel(lang) + (count[lang] > 1 ? ` ${count[lang]}` : "") });
      if (out.length >= 45) break;
    }
    return out;
  }

  // The screen between pressing a source and the native player taking over
  let starting = null;
  function showStarting(meta, detail) {
    ensureStyle();
    if (!starting) {
      starting = document.createElement("div");
      starting.className = "dxtv-starting";
      starting.innerHTML = '<div class="dxtv-starting-info"><i></i><b></b><span></span></div>';
      document.body.append(starting);
    }
    const art = meta && (meta.background || meta.poster);
    if (art && /^https:\/\//.test(art)) starting.style.backgroundImage = `url("${art.replace(/["\\]/g, "")}")`;
    starting.querySelector("b").textContent = (meta && meta.name) || "";
    starting.querySelector("span").textContent = detail || "Finding the stream";
  }
  function hideStarting(delay = 0) {
    const el = starting;
    starting = null;
    if (el) setTimeout(() => el.remove(), delay);
  }

  async function startHandoff() {
    const hash = location.hash;
    if (!/^#\/player\//.test(hash) || (handoff && handoff.hash === hash)) return;
    handoff = { hash, pending: true };
    showStarting(null);
    let state = null;
    // The player screen fills in over a moment: wait until the stream is known, and give the
    // title's details (name, episode, saved position) a few seconds more to arrive
    let known = 0;
    for (let i = 0; i < 60 && location.hash === hash; i++) {
      state = await playerState();
      const stream = state && state.selected && state.selected.stream;
      const streamKnown = stream && (stream.url || (state.stream && state.stream.type === "Ready") || stream.infoHash || stream.externalUrl);
      const loaded = state && state.metaItem && state.metaItem.content;
      if (loaded && starting) showStarting(loaded, streamKnown ? "Starting" : "Finding the stream");
      if (streamKnown) {
        known++;
        const metaReady = state.metaItem && state.metaItem.type !== "Loading";
        if ((metaReady && state.libraryItem !== undefined) || known >= 12) break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (location.hash !== hash) { handoff = null; hideStarting(); return; }
    // nothing playable turned up: back to the sources, saying so (never a black page)
    const leave = (message) => {
      handoff = null;
      hideStarting();
      if (message) toast(message, 7000);
      history.back();
    };
    if (!state || !state.selected) { leave("This source didn't answer. Pick another one."); return; }
    silenceWebPlayer();

    const stream = state.selected.stream || {};
    const ready = state.stream && state.stream.type === "Ready" && state.stream.content;
    let url = (ready && ready.url) || stream.url || null;
    if (!url && stream.infoHash) {
      leave("This source needs a streaming server, which this TV doesn't have. Pick a source marked instant or cached.");
      return;
    }
    if (!url && stream.externalUrl) {
      native.openExternal(stream.externalUrl);
      leave(null);
      return;
    }
    if (!url) { leave("This source didn't give a playable link. Pick another one."); return; }

    const meta = state.metaItem && state.metaItem.type === "Ready" ? state.metaItem.content : (state.metaItem && state.metaItem.content) || {};
    const videoId = state.selected.streamRequest && state.selected.streamRequest.path && state.selected.streamRequest.path.id;
    const video = (meta.videos || []).find((v) => v.id === videoId);
    const lib = state.libraryItem && state.libraryItem.state;
    const resumeMs = lib && lib.video_id === videoId && lib.timeOffset > 0 ? lib.timeOffset : 0;
    const headers = (stream.behaviorHints && stream.behaviorHints.proxyHeaders && stream.behaviorHints.proxyHeaders.request) || {};
    // the stream's own subtitle files first, then the subtitle addons'
    const subtitles = await pickSubtitles([...(stream.subtitles || []), ...(state.subtitles || [])]);
    const episode = video && video.season != null ? `S${video.season} E${video.episode}${video.title || video.name ? ` · ${video.title || video.name}` : ""}` : "";

    // Stremio's player settings: the audio language (preferred over the file's own pick), and
    // binge-watching / how early Up Next shows
    let prefs = {};
    try {
      const ctx = await core().getState("ctx");
      prefs = (ctx && ctx.profile && ctx.profile.settings) || {};
    } catch (_) { /* no preferences */ }
    const audioLanguage = prefs.audioLanguage || "";
    const subtitlesLanguage = prefs.subtitlesLanguage || "";

    // A series: its episodes (for the player's Episodes panel) and the next one (Next Episode, Up Next)
    let series = null;
    if (videoId && (meta.videos || []).length > 1) {
      const pick = (v) => v && {
        id: v.id, season: Number(v.season) || 0, episode: Number(v.episode) || 0,
        title: v.title || v.name || "", thumb: /^https:\/\//.test(v.thumbnail || "") ? v.thumbnail : "", watched: !!v.watched,
      };
      series = {
        current: videoId,
        episodes: meta.videos.filter((v) => v.season != null && v.episode != null && !v.upcoming).slice(0, 1500).map(pick),
        next: state.nextVideo ? pick(state.nextVideo) : null,
        binge: prefs.bingeWatching !== false,
        notifyMs: Number(prefs.nextVideoNotificationDuration) || 35000,
      };
    }

    handoff = { hash, videoId, started: Date.now() };
    if (window.__householdAdapter) {
      const identity = await window.__householdAdapter.identity();
      if (identity) native.verifyIdentity(identity);
    }
    if (location.hash !== hash) return;
    native.play(JSON.stringify({
      returnContext: {
        hash, current: videoId, next: state.nextVideo && state.nextVideo.id,
        metaId: state.selected.metaRequest && state.selected.metaRequest.path && state.selected.metaRequest.path.id,
        type: state.selected.streamRequest && state.selected.streamRequest.path && state.selected.streamRequest.path.type,
        addon: state.selected.streamRequest && state.selected.streamRequest.base,
        group: stream.behaviorHints && stream.behaviorHints.bingeGroup,
      },
      audioLanguage,
      subtitlesLanguage,
      series,
      url,
      title: meta.name || state.title || stream.title || "Stremflix",
      subtitle: episode,
      startMs: resumeMs,
      headers,
      subtitles,
      background: meta.background || meta.poster || "",
    }));
    // the native player opens over it with the same backdrop; this goes once it has
    hideStarting(1500);
  }

  // The native player reports where it is every few seconds, and once more when it closes
  tv.onProgress = (timeMs, durationMs, paused) => {
    if (!handoff || !/^#\/player\//.test(location.hash)) return;
    silenceWebPlayer();
    dispatch({ action: "Player", args: { action: "TimeChanged", args: { time: Math.max(0, Math.round(timeMs)), duration: Math.max(0, Math.round(durationMs)), device: "dxbi-tv" } } });
    dispatch({ action: "Player", args: { action: "PausedChanged", args: { paused: !!paused } } });
  };

  // [then]: what the viewer picked in the player: "next", or "episode:<video id>"
  tv.onClosed = async (timeMs, durationMs, ended, error, then, context = null) => {
    const onPlayer = !!handoff && /^#\/player\//.test(location.hash);
    if (onPlayer) {
      if (timeMs > 0) tv.onProgress(timeMs, durationMs, true);
      if (ended) dispatch({ action: "Player", args: { action: "Ended" } });
      if (window.__householdAdapter) window.__householdAdapter.sample({ position: timeMs / 1000, duration: durationMs / 1000, paused: true })
        .then(s => { if (s) native.householdProgress(JSON.stringify(s)); }).catch(() => {});
    }
    handoff = null;
    hideStarting();
    const target = (onPlayer || context) && then ? await episodeTarget(then, context) : null;
    // in place of this player in the history, as Stremio's own player does: Back still leads to the title
    if (target) {
      await followEpisode(target);
      return;
    }
    if (context && context.metaId) location.replace(episodeSources(context, context.current));
    else if (onPlayer) history.back();
    if (error) toast(`This stream couldn't play: ${error}. Try another one.`, 7000);
  };

  // Where an episode plays: straight into the player when Stremio can match the source (binge-
  // watching's same-addon pick), else its sources page, with the best one already selected
  function episodeSources(context, id) {
    return `#/detail/${encodeURIComponent(context.type)}/${encodeURIComponent(context.metaId)}/${encodeURIComponent(id)}`;
  }

  async function episodeTarget(then, context = null) {
    const state = await playerState();
    let video;
    if (state && then === "next") {
      video = state.nextVideo;
      if (video) dispatch({ action: "Player", args: { action: "NextVideo" } });
    } else if (state) {
      const id = then.replace(/^episode:/, "");
      const meta = state.metaItem && state.metaItem.content;
      video = state.nextVideo && state.nextVideo.id === id ? state.nextVideo :
        ((meta && meta.videos) || []).find((v) => v.id === id);
    }
    const links = (video && video.deepLinks) || {};
    const link = links.player || links.metaDetailsStreams;
    if (!link) {
      const id = then === "next" ? context && context.next : then.replace(/^episode:/, "");
      return context && context.metaId && id ? {
        link: episodeSources(context, id), direct: false, videoId: id,
        group: context.group, addon: context.addon, meta: null,
      } : null;
    }
    return {
      link, direct: !!links.player, videoId: video.id,
      group: state.selected && state.selected.stream && state.selected.stream.behaviorHints && state.selected.stream.behaviorHints.bingeGroup,
      addon: state.selected && state.selected.streamRequest && state.selected.streamRequest.base,
      meta: state.metaItem && state.metaItem.content,
    };
  }

  let restoringNativePlayback = false;
  tv.restoreNativePlayback = async (packet) => {
    const context = packet.context;
    if (handoff && (!context || location.hash === context.hash)) {
      return tv.onClosed(packet.timeMs, packet.durationMs, packet.ended, packet.error, packet.then, context);
    }
    window.__dxbiTvPendingClose = packet;
    if (context?.hash && location.hash !== context.hash) location.replace(context.hash);
    return restoreNativePlayback();
  };

  async function restoreNativePlayback() {
    if (restoringNativePlayback || !window.__dxbiTvPendingClose) return;
    restoringNativePlayback = true;
    const packet = window.__dxbiTvPendingClose;
    const context = packet.context;
    showStarting(null, "Restoring episode selection");
    try {
      for (let i = 0; i < 60; i++) {
        if (context?.hash && location.hash !== context.hash) {
          window.__dxbiTvPendingClose = null;
          hideStarting();
          return;
        }
        const state = await playerState();
        if (state?.selected?.streamRequest?.path?.id === context?.current && state.metaItem?.type === "Ready") {
          handoff = { hash: location.hash, videoId: context.current };
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      window.__dxbiTvPendingClose = null;
      await tv.onClosed(packet.timeMs, packet.durationMs, packet.ended, packet.error, packet.then, context);
    } finally { restoringNativePlayback = false; }
  }

  async function followEpisode(target) {
    const route = target.link.startsWith("#") ? target.link : `#${target.link}`;
    location.replace(route);
    if (target.direct || !target.group || !target.addon) return;
    showStarting(target.meta, "Finding the same source");
    const get = core().getState;
    try {
      const deadline = Date.now() + 15000;
      while (location.hash === route && Date.now() < deadline) {
        const state = await get("meta_details");
        if (location.hash !== route) return;
        if (state && state.selected && state.selected.streamPath && state.selected.streamPath.id === target.videoId) {
          const groups = (state.streams || []).filter((g) => g.addon && g.addon.transportUrl === target.addon);
          for (const group of groups) {
            const ready = group.content && group.content.type === "Ready" && group.content.content;
            const match = Array.isArray(ready) && ready.find((s) => s.behaviorHints &&
              s.behaviorHints.bingeGroup === target.group && s.deepLinks && typeof s.deepLinks.player === "string");
            if (match) {
              const link = match.deepLinks.player;
              location.replace(link.startsWith("#") ? link : `#${link}`);
              return;
            }
          }
          if (groups.length && groups.every((g) => g.content && g.content.type !== "Loading")) return;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (_) { /* leave the episode's sources available if the addon did not answer */ }
    finally { hideStarting(); }
  }

  // ---------------------------------------------------------------------------
  // The remote's Back button: closes what's open, otherwise goes back a screen.
  // Returns false on Home, where the app decides (it leaves).
  // ---------------------------------------------------------------------------
  tv.back = () => {
    if (openModal) { closeModal(); return true; }
    const sheet = document.querySelector(".dxe-modal");
    if (sheet) {
      const close = sheet.querySelector("[data-act=close]");
      if (close) close.click(); else sheet.remove();
      return true;
    }
    if (window.__dxbi && typeof window.__dxbi.closePreview === "function" && window.__dxbi.closePreview()) return true;
    // Stremio's own dialogs (addon install, promotions…) close with their × button
    const stremioModal = document.querySelector('[class*="modal-container"]');
    if (stremioModal) {
      const close = stremioModal.querySelector('[class*="close-button"]');
      if (close) { close.click(); return true; }
    }
    const menu = document.querySelector('[class*="menu-container"][class*="open"], [class*="popup-menu-container"], [class*="nav-menu-container"]');
    if (menu) {
      const profileMenu = menu.matches('[class*="nav-menu-container"]');
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      // back to the avatar that opened the profile menu
      // (after Stremio has finished closing it, which drops the focus)
      if (profileMenu) setTimeout(() => avatarLabel()?.focus(), 60);
      return true;
    }
    const route = (location.hash || "#/").replace(/^#\/?/, "").split(/[/?]/)[0];
    if (!route || route === "board") return false;
    history.back();
    return true;
  };

  // ---------------------------------------------------------------------------
  // Who's watching, the way a streaming service shows it: the profile's avatar at the top right,
  // and in its menu the profile's name with Switch Profile first. Menu on the remote opens it.
  // ---------------------------------------------------------------------------
  const profile = (() => { try { return JSON.parse(native.profile() || "{}") || {}; } catch (_) { return {}; } })();
  const AVATAR_COLORS = { teal: ["#26a49b", "#16655e"], plum: ["#a478c6", "#68428a"], coral: ["#ee8b73", "#b84a52"], blue: ["#5c9ce6", "#315baf"], gold: ["#e8bb5b", "#b77a29"] };

  function paintAvatar(el) {
    if (!el || el.classList.contains("dxtv-avatar") || !profile.name) return;
    const [a1, a2] = AVATAR_COLORS[profile.avatar] || AVATAR_COLORS.teal;
    el.classList.add("dxtv-avatar");
    el.style.setProperty("--dxtv-a1", a1);
    el.style.setProperty("--dxtv-a2", a2);
    el.dataset.initial = Array.from(profile.name)[0].toUpperCase();
  }

  // Stremio keeps the screens you've left in the page, hidden, each with its own top bar: the one
  // on screen is the visible one, not the first
  const shown = (selector) => [...document.querySelectorAll(selector)].find((n) => n.checkVisibility());
  const avatarLabel = () => shown('nav [class*="nav-menu-popup-label"]');

  function ensureProfileUi() {
    if (!profile.name) return;
    document.querySelectorAll('nav [class*="nav-menu-popup-label"] [class*="avatar"]').forEach(paintAvatar);
    const menu = shown('[class*="nav-menu-container"]');
    if (!menu || menu.querySelector(".dxtv-switch")) return;
    ensureStyle();
    menu.classList.add("dxtv-household");
    paintAvatar(menu.querySelector('[class*="user-info-container"] [class*="avatar"]'));
    const details = menu.querySelector('[class*="user-info-details"]');
    if (details && !details.querySelector(".dxtv-whoami")) {
      const name = document.createElement("div");
      name.className = "dxtv-whoami";
      name.textContent = profile.name;
      details.prepend(name);
    }
    // one of Stremio's own entries (the look of its icon and label), not one added here
    const template = menu.querySelector('[class*="nav-menu-option-container"]:not(.dxe-menu-item):not(.dxtv-switch)');
    if (!template) return;
    const item = document.createElement("div");
    item.className = template.className.replace(/\bdxe-menu-item\b/, "") + " dxtv-switch";
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.title = "Switch Profile";
    item.innerHTML = `<svg class="${esc((template.querySelector("svg") || { getAttribute: () => "" }).getAttribute("class") || "")}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="M21 3l-7 7"/><path d="M8 21H3v-5"/><path d="M3 21l7-7"/></svg><div class="${esc((template.querySelector('[class*="nav-menu-option-label"]') || {}).className || "")}">Switch Profile</div>`;
    item.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); native.switchProfile(); });
    // the remote's OK is Enter, which a div doesn't turn into a click by itself
    item.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); item.click(); } });
    template.parentElement.prepend(item);
    // opened from the avatar with the remote: start on Switch Profile
    const active = document.activeElement;
    if (!active || active === document.body || active.closest('nav [class*="nav-menu-popup-label"]')) item.focus();
  }

  tv.profileMenu = () => {
    const label = avatarLabel();
    if (!label) return;
    if (!shown('[class*="nav-menu-container"]')) label.click();
    const focusSwitch = (tries) => {
      const item = document.querySelector(".dxtv-switch");
      if (item) item.focus();
      else if (tries > 0) setTimeout(() => focusSwitch(tries - 1), 80);
    };
    setTimeout(() => { ensureProfileUi(); focusSwitch(10); }, 0);
  };

  // ---------------------------------------------------------------------------
  // Load the built-in Stremflix plugin once the page is up, the way Stremio Enhanced does
  // ---------------------------------------------------------------------------
  function loadPlugin() {
    if (document.getElementById(PLUGIN)) return;
    const source = native.pluginSource();
    if (!source) return;
    const base = PLUGIN.replace(/\.plugin\.js$/, "");
    const script = document.createElement("script");
    script.id = PLUGIN;
    script.textContent = `(function () {
      const StremioEnhancedAPI = {
        logger: {
          info: (m) => window.StremioEnhancedAPI.info(${JSON.stringify(base)}, m),
          warn: (m) => window.StremioEnhancedAPI.warn(${JSON.stringify(base)}, m),
          error: (m) => window.StremioEnhancedAPI.error(${JSON.stringify(base)}, m),
        },
        getSetting: (key) => window.StremioEnhancedAPI.getSetting(${JSON.stringify(base)}, key),
        saveSetting: (key, value) => window.StremioEnhancedAPI.saveSetting(${JSON.stringify(base)}, key, value),
        registerSettings: (schema) => window.StremioEnhancedAPI.registerSettings(${JSON.stringify(base)}, schema),
        onSettingsSaved: (cb) => window.StremioEnhancedAPI.onSettingsSaved(${JSON.stringify(base)}, cb),
        showAlert: window.StremioEnhancedAPI.showAlert,
        showPrompt: (t, m, d) => window.StremioEnhancedAPI.showPrompt(${JSON.stringify(base)}, t, m, d),
      };
      try {
        ${source}
      } catch (err) {
        console.error("[Stremflix TV] plugin crashed", err);
      }
    })();`;
    document.body.append(script);
  }

  function onRoute() {
    ensureSettingsEntry();
    if (window.__dxbiTvPendingClose) restoreNativePlayback();
    else if (/^#\/player\//.test(location.hash)) startHandoff();
  }

  window.addEventListener("hashchange", onRoute);
  const start = () => {
    ensureStyle();
    loadPlugin();
    onRoute();
    new MutationObserver(() => { ensureSettingsEntry(); ensureProfileUi(); }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();
