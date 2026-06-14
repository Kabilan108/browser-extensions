# Browser Extensions

Monorepo for small browser extensions.

## Layout

- `extensions/chrome/*`: Chrome extension packages.
- `extensions/firefox/*`: Firefox extension packages.

## Extensions

- `extensions/chrome/tab-namer`: assign a custom name to the current Chrome tab.
- `extensions/firefox/narrate`: listen to any article with synchronized highlighting (Inworld TTS).

## Build

```sh
bun install
bun run check
```

## Commands

```sh
bun run typecheck
bun run build
```

Root scripts run the matching script in every package under `extensions/`.

## Load an Extension in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select the extension package's `dist` directory, such as `extensions/chrome/tab-namer/dist`.

## Load an Extension in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose Load Temporary Add-on.
3. Select the extension package's manifest from its build output.
