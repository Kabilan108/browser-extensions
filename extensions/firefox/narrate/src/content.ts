import { Readability } from "@mozilla/readability";
import {
  PORT_NAME,
  type ChunkInput,
  type PlayerCommand,
  type PlayerEvent,
  type PlayerStatus,
  type WordTiming,
} from "./messages";

(() => {
  const globalKey = "__narrateToggle";
  const holder = globalThis as Record<string, unknown>;
  const existing = holder[globalKey];
  if (typeof existing === "function") {
    (existing as () => void)();
    return;
  }

  const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption";
  const MAX_CHUNK_CHARS = 1800;
  const RATES = [1, 1.25, 1.5, 1.75, 2, 0.75];

  interface Chunk {
    text: string;
    element: HTMLElement | null;
    startOffset: number;
  }

  interface WordSpan {
    start: number;
    end: number;
    timeStart: number;
  }

  // ---------------------------------------------------------------- extraction

  function normalize(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }

  function matchKey(text: string): string {
    return normalize(text).slice(0, 60).toLowerCase();
  }

  function leafBlocks(root: ParentNode): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)].filter(
      (el) => el.querySelector(BLOCK_SELECTOR) === null,
    );
  }

  function isVisible(el: HTMLElement): boolean {
    return el.getClientRects().length > 0;
  }

  interface ExtractedBlock {
    element: HTMLElement | null;
    text: string;
  }

  function collectBlocks(): ExtractedBlock[] {
    let articleRoot: HTMLElement | null = null;
    let articleTitle = "";
    try {
      const clone = document.cloneNode(true) as Document;
      const parsed = new Readability<HTMLElement>(clone, {
        serializer: (node) => node as HTMLElement,
      }).parse();
      articleRoot = parsed?.content ?? null;
      articleTitle = parsed?.title ?? "";
    } catch {
      articleRoot = null;
    }

    const live = leafBlocks(document.body).filter(isVisible);

    if (articleRoot === null) {
      return live
        .map((el) => ({ element: el, text: el.textContent ?? "" }))
        .filter((block) => normalize(block.text).length >= 30);
    }

    const extracted = leafBlocks(articleRoot)
      .map((el) => normalize(el.textContent ?? ""))
      .filter((text) => text.length >= 2);

    const blocks: ExtractedBlock[] = [];
    let cursor = 0;
    for (const text of extracted) {
      const key = matchKey(text);
      let matched: HTMLElement | null = null;
      for (let i = cursor; i < live.length; i++) {
        const candidate = live[i];
        if (candidate !== undefined && matchKey(candidate.textContent ?? "") === key) {
          matched = candidate;
          cursor = i + 1;
          break;
        }
      }
      blocks.push(
        matched !== null ? { element: matched, text: matched.textContent ?? "" } : { element: null, text },
      );
    }

    if (articleTitle !== "" && (blocks.length === 0 || matchKey(blocks[0]?.text ?? "") !== matchKey(articleTitle))) {
      const heading = [...document.querySelectorAll<HTMLElement>("h1, h2")].find(
        (el) => isVisible(el) && matchKey(el.textContent ?? "") === matchKey(articleTitle),
      );
      blocks.unshift(
        heading !== undefined
          ? { element: heading, text: heading.textContent ?? "" }
          : { element: null, text: articleTitle },
      );
    }

    return blocks;
  }

  function toChunks(blocks: ExtractedBlock[]): Chunk[] {
    const chunks: Chunk[] = [];
    for (const block of blocks) {
      if (normalize(block.text).length === 0) continue;
      for (const piece of splitText(block.text)) {
        chunks.push({ text: piece.text, element: block.element, startOffset: piece.start });
      }
    }
    return chunks;
  }

  function splitText(text: string): { text: string; start: number }[] {
    if (text.length <= MAX_CHUNK_CHARS) return [{ text, start: 0 }];
    const pieces: { text: string; start: number }[] = [];
    const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
    let pieceStart = 0;
    let pieceLength = 0;
    const flush = (): void => {
      if (pieceLength === 0) return;
      const piece = text.slice(pieceStart, pieceStart + pieceLength);
      if (piece.length > MAX_CHUNK_CHARS) {
        for (let at = 0; at < piece.length; at += MAX_CHUNK_CHARS) {
          pieces.push({ text: piece.slice(at, at + MAX_CHUNK_CHARS), start: pieceStart + at });
        }
      } else {
        pieces.push({ text: piece, start: pieceStart });
      }
      pieceStart += pieceLength;
      pieceLength = 0;
    };
    for (const segment of segmenter.segment(text)) {
      if (pieceLength > 0 && pieceLength + segment.segment.length > MAX_CHUNK_CHARS) flush();
      pieceLength += segment.segment.length;
    }
    flush();
    return pieces;
  }

  // ---------------------------------------------------------------- highlighting

  const supportsHighlightApi = typeof Highlight !== "undefined" && "highlights" in CSS;
  let paragraphHighlight: Highlight | null = null;
  let wordHighlight: Highlight | null = null;
  let fallbackElement: HTMLElement | null = null;
  let lastUserScroll = 0;

  function initHighlights(): void {
    if (!supportsHighlightApi) return;
    paragraphHighlight = new Highlight();
    wordHighlight = new Highlight();
    CSS.highlights.set("narrate-paragraph", paragraphHighlight);
    CSS.highlights.set("narrate-word", wordHighlight);
  }

  function clearHighlights(): void {
    paragraphHighlight?.clear();
    wordHighlight?.clear();
    if (fallbackElement !== null) {
      fallbackElement.removeAttribute("data-narrate-active");
      fallbackElement = null;
    }
  }

  function highlightParagraph(chunk: Chunk): void {
    clearHighlights();
    if (chunk.element === null) return;
    if (paragraphHighlight !== null) {
      const range = document.createRange();
      range.selectNodeContents(chunk.element);
      paragraphHighlight.add(range);
    } else {
      chunk.element.setAttribute("data-narrate-active", "");
      fallbackElement = chunk.element;
    }
    if (Date.now() - lastUserScroll > 4000) {
      chunk.element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function resolveOffset(element: HTMLElement, offset: number): { node: Text; offset: number } | null {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let last: Text | null = null;
    let node = walker.nextNode() as Text | null;
    while (node !== null) {
      if (remaining <= node.data.length) return { node, offset: remaining };
      remaining -= node.data.length;
      last = node;
      node = walker.nextNode() as Text | null;
    }
    return last !== null ? { node: last, offset: last.data.length } : null;
  }

  function highlightWord(chunk: Chunk, span: WordSpan): void {
    if (wordHighlight === null || chunk.element === null) return;
    const start = resolveOffset(chunk.element, span.start);
    const end = resolveOffset(chunk.element, span.end);
    if (start === null || end === null) return;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    wordHighlight.clear();
    wordHighlight.add(range);
  }

  function computeWordSpans(chunk: Chunk, words: WordTiming[]): WordSpan[] {
    const haystack = chunk.text.toLowerCase();
    const spans: WordSpan[] = [];
    let cursor = 0;
    for (const timing of words) {
      const needle = timing.word.trim().toLowerCase();
      if (needle === "" || !/[\p{L}\p{N}]/u.test(needle)) continue;
      const at = haystack.indexOf(needle, cursor);
      if (at === -1) continue;
      spans.push({
        start: chunk.startOffset + at,
        end: chunk.startOffset + at + needle.length,
        timeStart: timing.start,
      });
      cursor = at + needle.length;
    }
    return spans;
  }

  // ---------------------------------------------------------------- overlay UI

  const ICONS = {
    play: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5z"/></svg>',
    pause:
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 5h3.4v14H7zm6.6 0H17v14h-3.4z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M6 6h2v12H6zm14 0l-10 6 10 6z"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M16 6h2v12h-2zM4 6l10 6-10 6z"/></svg>',
    settings:
      '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 7h10m4 0h2M4 17h2m4 0h10"/><circle cx="16" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M6.5 6.5l11 11m0-11l-11 11"/></svg>',
  };

  const OVERLAY_STYLE = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .dock {
      position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
      z-index: 2147483647; display: flex; flex-direction: column; align-items: center; gap: 10px;
      font-family: "Avenir Next", "Seravek", "Segoe UI", "Cantarell", "Helvetica Neue", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .status {
      max-width: 420px; padding: 9px 16px; border-radius: 14px;
      background: rgba(20, 18, 15, 0.94); border: 1px solid rgba(255, 255, 255, 0.09);
      color: #d9d2c4; font-size: 12.5px; line-height: 1.45; text-align: center;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
      animation: narrate-rise 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.15);
    }
    .status[data-kind="error"] { color: #ffb3a3; }
    .status[hidden] { display: none; }
    .pill {
      display: flex; align-items: center; gap: 3px; padding: 9px 13px;
      border-radius: 999px; background: rgba(20, 18, 15, 0.94); color: #efe9dd;
      border: 1px solid rgba(255, 255, 255, 0.09);
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(14px);
      animation: narrate-rise 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.15);
    }
    @keyframes narrate-rise {
      from { opacity: 0; transform: translateY(16px) scale(0.95); }
    }
    button {
      appearance: none; background: none; border: 0; cursor: pointer; color: inherit;
      display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%;
      opacity: 0.72; transition: opacity 0.15s, background 0.15s, transform 0.12s;
      font: inherit;
    }
    button:hover { opacity: 1; background: rgba(255, 255, 255, 0.08); }
    button:active { transform: scale(0.92); }
    .play {
      width: 44px; height: 44px; margin: 0 4px; position: relative;
      background: #f2b13e; color: #181206; opacity: 1;
    }
    .play:hover { background: #ffc452; }
    .ring {
      position: absolute; inset: -5px; border-radius: 50%; pointer-events: none;
      background: conic-gradient(#f2b13e calc(var(--p, 0) * 1turn), rgba(255, 255, 255, 0.13) 0);
      mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
      -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
      transition: --p 0.3s;
    }
    .play.loading .icon { visibility: hidden; }
    .play.loading::after {
      content: ""; position: absolute; width: 18px; height: 18px; border-radius: 50%;
      border: 2.5px solid rgba(24, 18, 6, 0.25); border-top-color: #181206;
      animation: narrate-spin 0.7s linear infinite;
    }
    @keyframes narrate-spin { to { transform: rotate(1turn); } }
    .counter {
      font-variant-numeric: tabular-nums; font-size: 12px; letter-spacing: 0.05em;
      opacity: 0.55; margin: 0 9px 0 7px; white-space: nowrap; user-select: none;
    }
    .rate {
      width: auto; min-width: 40px; padding: 0 9px; border-radius: 999px;
      font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em;
      font-variant-numeric: tabular-nums;
    }
    .divider { width: 1px; height: 18px; background: rgba(255, 255, 255, 0.12); margin: 0 4px; }
  `;

  interface OverlayRefs {
    host: HTMLElement;
    pill: HTMLElement;
    status: HTMLElement;
    playButton: HTMLButtonElement;
    playIcon: HTMLElement;
    counter: HTMLElement;
    rateButton: HTMLButtonElement;
  }

  let overlay: OverlayRefs | null = null;

  function buildOverlay(): OverlayRefs {
    const host = document.createElement("div");
    host.setAttribute("data-narrate-overlay", "");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>${OVERLAY_STYLE}</style>
      <div class="dock">
        <div class="status" hidden></div>
        <div class="pill" role="toolbar" aria-label="Narrate player">
          <button data-action="prev" title="Previous paragraph">${ICONS.prev}</button>
          <button class="play" data-action="toggle" title="Play / pause">
            <span class="ring"></span><span class="icon">${ICONS.play}</span>
          </button>
          <button data-action="next" title="Next paragraph">${ICONS.next}</button>
          <span class="counter">— / —</span>
          <button class="rate" data-action="rate" title="Playback speed">1×</button>
          <span class="divider"></span>
          <button data-action="settings" title="Narrate settings">${ICONS.settings}</button>
          <button data-action="close" title="Stop and close">${ICONS.close}</button>
        </div>
      </div>`;
    document.documentElement.append(host);

    const query = <T extends HTMLElement>(selector: string): T => {
      const el = shadow.querySelector<T>(selector);
      if (el === null) throw new Error(`Narrate overlay is missing ${selector}`);
      return el;
    };
    const refs: OverlayRefs = {
      host,
      pill: query(".pill"),
      status: query(".status"),
      playButton: query<HTMLButtonElement>(".play"),
      playIcon: query(".play .icon"),
      counter: query(".counter"),
      rateButton: query<HTMLButtonElement>(".rate"),
    };
    shadow.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("button[data-action]");
      if (target !== null) handleAction(target.dataset.action ?? "");
    });
    return refs;
  }

  function setStatusMessage(message: string | null, kind: "info" | "error" = "info"): void {
    if (overlay === null) return;
    if (message === null) {
      overlay.status.hidden = true;
      return;
    }
    overlay.status.hidden = false;
    overlay.status.textContent = message;
    overlay.status.dataset.kind = kind;
  }

  function renderPlayState(): void {
    if (overlay === null) return;
    overlay.playButton.classList.toggle("loading", status === "loading");
    overlay.playIcon.innerHTML = status === "playing" || status === "loading" ? ICONS.pause : ICONS.play;
    overlay.counter.textContent = `${chunks.length === 0 ? "—" : currentIndex + 1} / ${chunks.length === 0 ? "—" : chunks.length}`;
    overlay.pill.style.setProperty("--p", chunks.length === 0 ? "0" : String((currentIndex + 1) / chunks.length));
  }

  // ---------------------------------------------------------------- controller

  let port: chrome.runtime.Port | null = null;
  let chunks: Chunk[] = [];
  let currentIndex = 0;
  let status: PlayerStatus | "idle" = "idle";
  let rateIndex = 0;
  let activeSpans: WordSpan[] = [];
  let activeSpanIndex = -1;
  let keepalive: number | null = null;

  function startKeepalive(): void {
    stopKeepalive();
    keepalive = window.setInterval(() => {
      send({ type: "ping" });
    }, 15000);
  }

  function stopKeepalive(): void {
    if (keepalive !== null) {
      window.clearInterval(keepalive);
      keepalive = null;
    }
  }

  function send(command: PlayerCommand): void {
    try {
      port?.postMessage(command);
    } catch {
      port = null;
    }
  }

  function connect(): chrome.runtime.Port {
    const fresh = chrome.runtime.connect({ name: PORT_NAME });
    fresh.onMessage.addListener((message) => {
      handleEvent(message as PlayerEvent);
    });
    fresh.onDisconnect.addListener(() => {
      if (port !== fresh) return;
      port = null;
      stopKeepalive();
      if (status === "playing" || status === "loading") {
        startPlayback(currentIndex);
      } else {
        status = "idle";
        renderPlayState();
      }
    });
    return fresh;
  }

  function startPlayback(index: number): void {
    port ??= connect();
    startKeepalive();
    const payload: ChunkInput[] = chunks.map((chunk) => ({ text: chunk.text }));
    send({ type: "start", chunks: payload, index });
    const rate = RATES[rateIndex];
    if (rate !== undefined && rate !== 1) send({ type: "setRate", rate });
  }

  function handleEvent(event: PlayerEvent): void {
    switch (event.type) {
      case "status":
        status = event.status;
        if (event.status === "ended") {
          currentIndex = 0;
          clearHighlights();
          setStatusMessage(null);
        }
        renderPlayState();
        break;
      case "chunk": {
        currentIndex = event.index;
        const chunk = chunks[event.index];
        if (chunk !== undefined) {
          highlightParagraph(chunk);
          activeSpans = computeWordSpans(chunk, event.words);
          activeSpanIndex = -1;
        }
        setStatusMessage(null);
        renderPlayState();
        break;
      }
      case "tick":
        onTick(event.index, event.time);
        break;
      case "error":
        status = "paused";
        setStatusMessage(event.message, "error");
        renderPlayState();
        break;
    }
  }

  function onTick(index: number, time: number): void {
    if (index !== currentIndex || activeSpans.length === 0) return;
    const chunk = chunks[index];
    if (chunk === undefined || chunk.element === null) return;
    let i = activeSpanIndex;
    const current = activeSpans[i];
    if (i < 0 || (current !== undefined && current.timeStart > time)) i = 0;
    while (i + 1 < activeSpans.length) {
      const next = activeSpans[i + 1];
      if (next === undefined || next.timeStart > time) break;
      i += 1;
    }
    if (i !== activeSpanIndex) {
      activeSpanIndex = i;
      const span = activeSpans[i];
      if (span !== undefined) highlightWord(chunk, span);
    }
  }

  function seekTo(index: number): void {
    if (port === null) {
      startPlayback(index);
    } else {
      send({ type: "seek", index });
    }
  }

  function handleAction(action: string): void {
    switch (action) {
      case "toggle":
        if (port === null) {
          startPlayback(currentIndex);
        } else if (status === "playing" || status === "loading") {
          send({ type: "pause" });
        } else if (status === "paused") {
          send({ type: "play" });
        } else {
          startPlayback(currentIndex);
        }
        break;
      case "prev":
        seekTo(Math.max(currentIndex - 1, 0));
        break;
      case "next":
        seekTo(Math.min(currentIndex + 1, chunks.length - 1));
        break;
      case "rate": {
        rateIndex = (rateIndex + 1) % RATES.length;
        const rate = RATES[rateIndex];
        if (rate !== undefined) {
          send({ type: "setRate", rate });
          if (overlay !== null) {
            overlay.rateButton.textContent = `${rate.toString().replace(/^0/, "")}×`;
          }
        }
        break;
      }
      case "settings":
        void chrome.runtime.sendMessage({ type: "open-options" });
        break;
      case "close":
        close();
        break;
    }
  }

  function open(): void {
    if (overlay !== null) return;
    overlay = buildOverlay();
    initHighlights();
    chunks = toChunks(collectBlocks());
    renderPlayState();
    if (chunks.length === 0) {
      setStatusMessage("Narrate couldn't find a readable article on this page.", "error");
      return;
    }
    startPlayback(0);
  }

  function close(): void {
    stopKeepalive();
    port?.disconnect();
    port = null;
    status = "idle";
    clearHighlights();
    overlay?.host.remove();
    overlay = null;
    chunks = [];
    currentIndex = 0;
    activeSpans = [];
    activeSpanIndex = -1;
  }

  function toggleOverlay(): void {
    if (overlay !== null) {
      close();
    } else {
      open();
    }
  }

  const markUserScroll = (): void => {
    lastUserScroll = Date.now();
  };
  window.addEventListener("wheel", markUserScroll, { passive: true });
  window.addEventListener("touchmove", markUserScroll, { passive: true });

  holder[globalKey] = toggleOverlay;
  open();
})();
