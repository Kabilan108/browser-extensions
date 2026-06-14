import type { Voice } from "./inworld";
import { loadSettings } from "./messages";

const FALLBACK_VOICES: Pick<Voice, "voiceId" | "displayName">[] = [
  { voiceId: "Ashley", displayName: "Ashley — warm, natural" },
  { voiceId: "Dennis", displayName: "Dennis — smooth, calm" },
  { voiceId: "Alex", displayName: "Alex — energetic" },
];

const apiKeyInput = mustGet<HTMLInputElement>("api-key");
const modelSelect = mustGet<HTMLSelectElement>("model");
const voiceSelect = mustGet<HTMLSelectElement>("voice");
const refreshButton = mustGet<HTMLButtonElement>("refresh-voices");
const previewButton = mustGet<HTMLButtonElement>("preview");
const statusLine = mustGet<HTMLParagraphElement>("status");

function mustGet<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`Missing element #${id}`);
  return el as T;
}

let statusTimer: number | undefined;

function showStatus(message: string, kind: "info" | "error" = "info"): void {
  statusLine.textContent = message;
  statusLine.dataset.kind = kind;
  window.clearTimeout(statusTimer);
  if (kind === "info") {
    statusTimer = window.setTimeout(() => {
      statusLine.textContent = "";
    }, 2500);
  }
}

function renderVoices(voices: Pick<Voice, "voiceId" | "displayName">[], selected: string): void {
  voiceSelect.replaceChildren();
  const seen = new Set<string>();
  for (const voice of voices) {
    if (seen.has(voice.voiceId)) continue;
    seen.add(voice.voiceId);
    const option = document.createElement("option");
    option.value = voice.voiceId;
    option.textContent = voice.displayName;
    voiceSelect.append(option);
  }
  if (!seen.has(selected)) {
    const option = document.createElement("option");
    option.value = selected;
    option.textContent = selected;
    voiceSelect.append(option);
  }
  voiceSelect.value = selected;
}

async function save(): Promise<void> {
  await chrome.storage.local.set({
    apiKey: apiKeyInput.value.trim(),
    modelId: modelSelect.value,
    voiceId: voiceSelect.value,
  });
  showStatus("Saved.");
}

async function refreshVoices(): Promise<void> {
  refreshButton.disabled = true;
  showStatus("Fetching voices…");
  try {
    await save();
    const response = (await chrome.runtime.sendMessage({ type: "list-voices" })) as {
      voices?: Voice[];
      error?: string;
    };
    if (response.error !== undefined || response.voices === undefined) {
      throw new Error(response.error ?? "No voices returned.");
    }
    const voices = response.voices.map((voice) => ({
      voiceId: voice.voiceId,
      displayName:
        voice.description === ""
          ? voice.displayName
          : `${voice.displayName} — ${voice.description}`,
    }));
    await chrome.storage.local.set({ voices });
    renderVoices(voices, voiceSelect.value);
    showStatus(`Loaded ${voices.length} English voices.`);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    refreshButton.disabled = false;
  }
}

async function previewVoice(): Promise<void> {
  previewButton.disabled = true;
  showStatus("Generating preview…");
  try {
    await save();
    const response = (await chrome.runtime.sendMessage({
      type: "preview-voice",
      voiceId: voiceSelect.value,
      modelId: modelSelect.value,
    })) as { audio?: string; error?: string };
    if (response.error !== undefined || response.audio === undefined) {
      throw new Error(response.error ?? "No audio returned.");
    }
    const audio = new Audio(`data:audio/mpeg;base64,${response.audio}`);
    await audio.play();
    showStatus("Playing preview.");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    previewButton.disabled = false;
  }
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  apiKeyInput.value = settings.apiKey;
  modelSelect.value = settings.modelId;
  if (modelSelect.value === "") modelSelect.value = "inworld-tts-1.5-max";

  const stored = await chrome.storage.local.get("voices");
  const voices = Array.isArray(stored.voices)
    ? (stored.voices as Pick<Voice, "voiceId" | "displayName">[])
    : FALLBACK_VOICES;
  renderVoices(voices, settings.voiceId);

  apiKeyInput.addEventListener("change", () => void save());
  modelSelect.addEventListener("change", () => void save());
  voiceSelect.addEventListener("change", () => void save());
  refreshButton.addEventListener("click", () => void refreshVoices());
  previewButton.addEventListener("click", () => void previewVoice());
}

void init();
