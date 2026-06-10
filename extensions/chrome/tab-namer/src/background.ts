import type { ContentRequest, PopupRequest, PopupResponse } from "./messages";

const titleKey = (tabId: number): string => `tab:${tabId}:title`;

const unsupportedPageMessage = "This page cannot be renamed by an extension.";

const isSupportedUrl = (url: string | undefined): boolean => {
  if (!url) {
    return false;
  }

  return url.startsWith("http://") || url.startsWith("https://");
};

const getActiveTab = async (): Promise<chrome.tabs.Tab | undefined> => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
};

const sendToTab = async (tabId: number, message: ContentRequest): Promise<void> => {
  await chrome.tabs.sendMessage(tabId, message);
};

const getStoredTitle = async (tabId: number): Promise<string | undefined> => {
  const key = titleKey(tabId);
  const result = await chrome.storage.session.get(key);
  const value = result[key];
  return typeof value === "string" ? value : undefined;
};

const setStoredTitle = async (tabId: number, title: string): Promise<void> => {
  await chrome.storage.session.set({ [titleKey(tabId)]: title });
};

const clearStoredTitle = async (tabId: number): Promise<void> => {
  await chrome.storage.session.remove(titleKey(tabId));
};

const withActiveSupportedTab = async (
  handler: (tab: chrome.tabs.Tab & { id: number }) => Promise<PopupResponse>,
): Promise<PopupResponse> => {
  const tab = await getActiveTab();

  if (!tab?.id || !isSupportedUrl(tab.url)) {
    return { ok: false, error: unsupportedPageMessage };
  }

  return handler(tab as chrome.tabs.Tab & { id: number });
};

const handlePopupRequest = async (request: PopupRequest): Promise<PopupResponse> => {
  if (request.type === "getCurrentTabTitleOverride") {
    return withActiveSupportedTab(async (tab) => {
      const title = await getStoredTitle(tab.id);
      return title ? { ok: true, title } : { ok: true };
    });
  }

  if (request.type === "setCurrentTabTitleOverride") {
    const title = request.title.trim();

    if (!title) {
      return { ok: false, error: "Enter a name before saving." };
    }

    return withActiveSupportedTab(async (tab) => {
      await setStoredTitle(tab.id, title);
      await sendToTab(tab.id, { type: "applyTitleOverride", title });
      return { ok: true, title };
    });
  }

  return withActiveSupportedTab(async (tab) => {
    await clearStoredTitle(tab.id);
    await sendToTab(tab.id, { type: "clearTitleOverride" });
    return { ok: true };
  });
};

chrome.runtime.onMessage.addListener((message: PopupRequest, _sender, sendResponse) => {
  handlePopupRequest(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unexpected extension error.";
      sendResponse({ ok: false, error: message });
    });

  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearStoredTitle(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !isSupportedUrl(tab.url)) {
    return;
  }

  void getStoredTitle(tabId).then((title) => {
    if (title) {
      return sendToTab(tabId, { type: "applyTitleOverride", title });
    }

    return undefined;
  });
});
