# Chrome Extensions

Monorepo for small Manifest V3 Chrome extensions.

## Extensions

- `extensions/tab-namer`: assign a custom name to the current tab.

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
4. Select the extension package's `dist` directory, such as `extensions/tab-namer/dist`.
