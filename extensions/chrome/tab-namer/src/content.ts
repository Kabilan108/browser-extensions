import type { ContentRequest } from "./messages";

const titleElement = document.querySelector("title") ?? document.head.appendChild(document.createElement("title"));

let titleOverride: string | undefined;
let originalTitle = document.title;
let applyingOverride = false;

const applyTitleOverride = (title: string): void => {
  titleOverride = title;
  applyingOverride = true;
  document.title = title;
  applyingOverride = false;
};

const clearTitleOverride = (): void => {
  titleOverride = undefined;
  document.title = originalTitle;
};

const observer = new MutationObserver(() => {
  if (applyingOverride) {
    return;
  }

  if (!titleOverride) {
    originalTitle = document.title;
    return;
  }

  if (document.title !== titleOverride) {
    originalTitle = document.title;
    applyTitleOverride(titleOverride);
  }
});

observer.observe(titleElement, {
  childList: true,
  characterData: true,
  subtree: true,
});

chrome.runtime.onMessage.addListener((message: ContentRequest) => {
  if (message.type === "applyTitleOverride") {
    applyTitleOverride(message.title);
    return;
  }

  clearTitleOverride();
});
