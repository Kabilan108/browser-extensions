import { cacheKey, getCached, putCached } from "./cache";
import { listVoices, synthesize, toBase64, type SynthesisResult } from "./inworld";
import {
  loadSettings,
  PORT_NAME,
  type ChunkInput,
  type PlayerCommand,
  type PlayerEvent,
  type RuntimeRequest,
  type Settings,
} from "./messages";

const PREVIEW_TEXT = "Hi! This is the voice you picked for Narrate. Happy listening.";

chrome.action.onClicked.addListener((tab) => {
  void activate(tab);
});

async function activate(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["page.css"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch (error) {
    console.error("Narrate cannot run on this page.", error);
  }
}

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (response: unknown) => void) => {
    const request = message as RuntimeRequest;
    if (request.type === "open-options") {
      void chrome.runtime.openOptionsPage();
      return undefined;
    }
    if (request.type === "list-voices") {
      void (async () => {
        try {
          const settings = await loadSettings();
          if (settings.apiKey === "") throw new Error("Add your Inworld API key first.");
          sendResponse({ voices: await listVoices(settings.apiKey) });
        } catch (error) {
          sendResponse({ error: errorMessage(error) });
        }
      })();
      return true;
    }
    if (request.type === "preview-voice") {
      void (async () => {
        try {
          const settings = await loadSettings();
          if (settings.apiKey === "") throw new Error("Add your Inworld API key first.");
          const result = await synthesizeCached(PREVIEW_TEXT, {
            apiKey: settings.apiKey,
            modelId: request.modelId,
            voiceId: request.voiceId,
          });
          sendResponse({ audio: toBase64(result.audio) });
        } catch (error) {
          sendResponse({ error: errorMessage(error) });
        }
      })();
      return true;
    }
    return undefined;
  },
);

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  const player = new Player(port);
  port.onMessage.addListener((message) => {
    player.handle(message as PlayerCommand);
  });
  port.onDisconnect.addListener(() => {
    player.dispose();
  });
});

async function synthesizeCached(text: string, settings: Settings): Promise<SynthesisResult> {
  const key = await cacheKey([settings.modelId, settings.voiceId, text]);
  const cached = await getCached(key);
  if (cached) return { audio: cached.audio, words: cached.words };
  const result = await synthesize(text, settings);
  await putCached({ key, audio: result.audio, words: result.words, createdAt: Date.now() });
  return result;
}

class Player {
  private chunks: ChunkInput[] = [];
  private index = 0;
  private rate = 1;
  private session = 0;
  private settings: Settings | null = null;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private ticker: number | null = null;
  private readonly pending = new Map<number, Promise<SynthesisResult>>();

  constructor(private readonly port: chrome.runtime.Port) {}

  handle(command: PlayerCommand): void {
    switch (command.type) {
      case "start":
        void this.start(command.chunks, command.index);
        break;
      case "play":
        this.resume();
        break;
      case "pause":
        this.pause();
        break;
      case "seek":
        void this.playFrom(command.index);
        break;
      case "setRate":
        this.rate = command.rate;
        if (this.audio) this.audio.playbackRate = command.rate;
        break;
      case "ping":
        break;
    }
  }

  dispose(): void {
    this.session += 1;
    this.stopAudio();
    this.pending.clear();
  }

  private async start(chunks: ChunkInput[], index: number): Promise<void> {
    this.settings = await loadSettings();
    if (this.settings.apiKey === "") {
      this.post({ type: "error", message: "Add your Inworld API key in Narrate's settings." });
      return;
    }
    this.chunks = chunks;
    await this.playFrom(index);
  }

  private async playFrom(index: number): Promise<void> {
    if (this.settings === null || this.chunks.length === 0) return;
    this.index = Math.min(Math.max(index, 0), this.chunks.length - 1);
    const session = ++this.session;
    this.stopAudio();
    this.post({ type: "status", status: "loading" });

    let result: SynthesisResult;
    try {
      result = await this.ensure(this.index);
    } catch (error) {
      if (session === this.session) this.post({ type: "error", message: errorMessage(error) });
      return;
    }
    if (session !== this.session) return;

    const blob = new Blob([result.audio], { type: "audio/mpeg" });
    this.objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(this.objectUrl);
    this.audio = audio;
    audio.playbackRate = this.rate;
    audio.addEventListener("ended", () => {
      if (session !== this.session) return;
      if (this.index + 1 < this.chunks.length) {
        void this.playFrom(this.index + 1);
      } else {
        this.stopAudio();
        this.post({ type: "status", status: "ended" });
      }
    });

    this.post({ type: "chunk", index: this.index, words: result.words });
    try {
      await audio.play();
    } catch (error) {
      if (session === this.session) this.post({ type: "error", message: errorMessage(error) });
      return;
    }
    if (session !== this.session) return;
    this.post({ type: "status", status: "playing" });
    this.startTicker();
    this.prefetch();
  }

  private pause(): void {
    if (this.audio === null) return;
    this.audio.pause();
    this.stopTicker();
    this.post({ type: "status", status: "paused" });
  }

  private resume(): void {
    if (this.audio !== null) {
      void this.audio.play().then(
        () => {
          this.post({ type: "status", status: "playing" });
          this.startTicker();
        },
        (error: unknown) => this.post({ type: "error", message: errorMessage(error) }),
      );
    } else if (this.chunks.length > 0) {
      void this.playFrom(this.index);
    }
  }

  private async ensure(index: number): Promise<SynthesisResult> {
    const settings = this.settings;
    if (settings === null) throw new Error("Player is not started.");
    const chunk = this.chunks[index];
    if (chunk === undefined) throw new Error("Paragraph out of range.");
    let promise = this.pending.get(index);
    if (promise === undefined) {
      promise = synthesizeCached(chunk.text, settings);
      this.pending.set(index, promise);
      promise.catch(() => this.pending.delete(index));
    }
    for (const key of [...this.pending.keys()]) {
      if (key < index - 1) this.pending.delete(key);
    }
    return promise;
  }

  private prefetch(): void {
    for (const offset of [1, 2]) {
      const next = this.index + offset;
      if (next < this.chunks.length) {
        this.ensure(next).then(
          () => undefined,
          () => undefined,
        );
      }
    }
  }

  private startTicker(): void {
    this.stopTicker();
    this.ticker = window.setInterval(() => {
      if (this.audio !== null) {
        this.post({ type: "tick", index: this.index, time: this.audio.currentTime });
      }
    }, 100);
  }

  private stopTicker(): void {
    if (this.ticker !== null) {
      window.clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private stopAudio(): void {
    this.stopTicker();
    if (this.audio !== null) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio = null;
    }
    if (this.objectUrl !== null) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  private post(event: PlayerEvent): void {
    try {
      this.port.postMessage(event);
    } catch {
      return;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
