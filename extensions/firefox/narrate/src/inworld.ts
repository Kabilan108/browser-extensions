import type { Settings, WordTiming } from "./messages";

const API_BASE = "https://api.inworld.ai";

export interface SynthesisResult {
  audio: ArrayBuffer;
  words: WordTiming[];
}

export interface Voice {
  voiceId: string;
  displayName: string;
  langCode: string;
  gender: string;
  description: string;
}

interface SynthesizeResponse {
  audioContent?: string;
  timestampInfo?: {
    wordAlignment?: {
      words?: string[];
      wordStartTimeSeconds?: number[];
      wordEndTimeSeconds?: number[];
    };
  };
}

export async function synthesize(text: string, settings: Settings): Promise<SynthesisResult> {
  const response = await fetch(`${API_BASE}/tts/v1/voice`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voiceId: settings.voiceId,
      modelId: settings.modelId,
      audioConfig: { audioEncoding: "MP3", sampleRateHertz: 44100 },
      timestampType: "WORD",
    }),
  });
  if (!response.ok) {
    throw new Error(await apiError(response));
  }
  const payload = (await response.json()) as SynthesizeResponse;
  if (typeof payload.audioContent !== "string" || payload.audioContent === "") {
    throw new Error("Inworld returned no audio.");
  }
  const alignment = payload.timestampInfo?.wordAlignment;
  const names = alignment?.words ?? [];
  const starts = alignment?.wordStartTimeSeconds ?? [];
  const ends = alignment?.wordEndTimeSeconds ?? [];
  const words: WordTiming[] = [];
  for (let i = 0; i < names.length; i++) {
    const word = names[i];
    const start = starts[i];
    const end = ends[i];
    if (word === undefined || start === undefined || end === undefined) continue;
    words.push({ word, start, end });
  }
  return { audio: fromBase64(payload.audioContent), words };
}

export async function listVoices(apiKey: string): Promise<Voice[]> {
  const response = await fetch(`${API_BASE}/voices/v1/voices?pageSize=2000`, {
    headers: { Authorization: `Basic ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(await apiError(response));
  }
  const payload = (await response.json()) as { voices?: Record<string, unknown>[] };
  const voices: Voice[] = [];
  for (const raw of payload.voices ?? []) {
    const voiceId = typeof raw.voiceId === "string" ? raw.voiceId : "";
    if (voiceId === "") continue;
    const langCode = typeof raw.langCode === "string" ? raw.langCode : "";
    if (langCode !== "" && !langCode.toUpperCase().startsWith("EN")) continue;
    voices.push({
      voiceId,
      displayName:
        typeof raw.displayName === "string" && raw.displayName !== "" ? raw.displayName : voiceId,
      langCode,
      gender: typeof raw.gender === "string" ? raw.gender : "",
      description: typeof raw.description === "string" ? raw.description : "",
    });
  }
  voices.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return voices;
}

async function apiError(response: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await response.json()) as { message?: string };
    if (typeof body.message === "string") detail = body.message;
  } catch {
    detail = "";
  }
  if (response.status === 401 || response.status === 403) {
    return "Inworld rejected the API key — check it in Narrate's settings.";
  }
  return `Inworld error ${response.status}${detail === "" ? "" : `: ${detail}`}`;
}

function fromBase64(data: string): ArrayBuffer {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}
