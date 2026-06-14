export const DEFAULT_MODEL_ID = "inworld-tts-1.5-max";
export const DEFAULT_VOICE_ID = "Ashley";

export interface Settings {
  apiKey: string;
  modelId: string;
  voiceId: string;
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(["apiKey", "modelId", "voiceId"]);
  return {
    apiKey: typeof stored.apiKey === "string" ? stored.apiKey : "",
    modelId:
      typeof stored.modelId === "string" && stored.modelId !== "" ? stored.modelId : DEFAULT_MODEL_ID,
    voiceId:
      typeof stored.voiceId === "string" && stored.voiceId !== "" ? stored.voiceId : DEFAULT_VOICE_ID,
  };
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface ChunkInput {
  text: string;
}

export type PlayerCommand =
  | { type: "start"; chunks: ChunkInput[]; index: number }
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; index: number }
  | { type: "setRate"; rate: number }
  | { type: "ping" };

export type PlayerStatus = "loading" | "playing" | "paused" | "ended";

export type PlayerEvent =
  | { type: "status"; status: PlayerStatus }
  | { type: "chunk"; index: number; words: WordTiming[] }
  | { type: "tick"; index: number; time: number }
  | { type: "error"; message: string };

export type RuntimeRequest =
  | { type: "open-options" }
  | { type: "list-voices" }
  | { type: "preview-voice"; voiceId: string; modelId: string };

export const PORT_NAME = "narrate";
