# Narrate

Listen to any article in Zen (or Firefox) with synchronized highlighting. Extracts the
readable article from the current page, reads it aloud with Inworld TTS, tints the
paragraph being read, and karaoke-highlights each word as it is spoken.

## Features

- Floating overlay player: play/pause, previous/next paragraph, speed (0.75×–2×),
  paragraph counter with a progress ring, settings, close.
- Paragraph + word-level highlighting via the CSS Custom Highlight API (no DOM
  mutation, works on React/hydrated sites). Word timing comes from Inworld's
  word-level timestamps.
- Auto-scroll follows the reading position; backs off while you scroll manually.
- Audio is synthesized per paragraph with the next two paragraphs prefetched, and
  cached in IndexedDB (keyed by model + voice + text) so re-listens are free.
- Article extraction with Mozilla Readability, mapped back to live DOM nodes by
  order-aware text matching.

## Setup

1. Build: `bun install && bun run build` (from the repo root or this package).
2. Load in Zen: open `about:debugging#/runtime/this-firefox` → Load Temporary
   Add-on → select `extensions/firefox/narrate/dist/manifest.json`.
3. Get an Inworld API key: [platform.inworld.ai → API Keys](https://platform.inworld.ai/api-keys),
   copy the **Base64** credentials.
4. Open the extension's settings (gear icon on the overlay, or the add-on's
   Preferences page) and paste the key. Pick a model and voice; use
   **Refresh voice list** to pull every English voice and **Preview voice** to try one.

## Usage

- Click the Narrate toolbar button, or press **Alt+Shift+R**, on any article page.
- Reading starts from the top; use ⏮/⏭ to move by paragraph.
- Press the shortcut (or toolbar button) again to close the player and stop.

## Costs

Inworld TTS-1.5 pricing is roughly $5–10 per 1M characters. A typical longform
article (~36k chars) costs about $0.20–0.40 to synthesize once; cached re-listens
are free. The audio cache keeps the most recent ~600 paragraph chunks.

## Architecture

- `src/background.ts` — MV3 event page: holds the `Audio` player (immune to page
  CSP), fetches the Inworld API (`host_permissions`), prefetch queue, IndexedDB
  cache, and a per-port `Player` session. A 15s keepalive ping from the content
  script stops Firefox from suspending the event page mid-playback (its idle timer
  only resets on *incoming* activity).
- `src/content.ts` — extraction (Readability on a cloned document → text-matched
  back to live block elements), chunking (≤1800 chars, sentence-aware via
  `Intl.Segmenter`), highlight rendering, shadow-DOM overlay UI.
- `src/options.ts` + `public/options.html` — API key, model, voice management.
- `public/page.css` — `::highlight()` rules injected via `scripting.insertCSS`.

## Development

```sh
bun run typecheck
bun run build
bunx web-ext run --source-dir dist --firefox "$(command -v zen-beta)" --start-url <article-url>
```

`web-ext run` reloads the extension automatically when `dist/` changes.
