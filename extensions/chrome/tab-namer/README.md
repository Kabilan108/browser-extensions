# Tab Namer

A small Manifest V3 Chrome extension for assigning a custom name to the current tab.

The extension changes `document.title`, which is what Chrome displays for normal web page tabs. Chrome does not let extensions rename internal browser tab objects directly, so restricted pages such as `chrome://...` and the Chrome Web Store cannot be renamed.

## Build

From the repo root:

```sh
bun run build
```

From this package:

```sh
bun run build
```

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select `extensions/chrome/tab-namer/dist`.

## Use

Open a normal `http://` or `https://` page, click the Tab Namer toolbar icon, enter a name, and save. The custom name is scoped to that live tab and is cleared when the tab closes.

The default keyboard shortcut is `Ctrl+Shift+Y` on Linux/Windows and `MacCtrl+Shift+Y` on macOS. Change it from `chrome://extensions/shortcuts`.
