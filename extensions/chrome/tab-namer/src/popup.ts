import type { PopupRequest, PopupResponse } from "./messages";

const form = document.querySelector<HTMLFormElement>("#rename-form");
const input = document.querySelector<HTMLInputElement>("#title-input");
const saveButton = document.querySelector<HTMLButtonElement>("#save-button");
const clearButton = document.querySelector<HTMLButtonElement>("#clear-button");
const status = document.querySelector<HTMLParagraphElement>("#status");

if (!form || !input || !saveButton || !clearButton || !status) {
  throw new Error("Popup markup is incomplete.");
}

const sendRequest = async (request: PopupRequest): Promise<PopupResponse> => {
  return chrome.runtime.sendMessage(request);
};

const setStatus = (message: string): void => {
  status.textContent = message;
};

const setEnabled = (enabled: boolean): void => {
  input.disabled = !enabled;
  saveButton.disabled = !enabled;
  clearButton.disabled = !enabled;
};

const loadCurrentTitle = async (): Promise<void> => {
  const response = await sendRequest({ type: "getCurrentTabTitleOverride" });

  if (!response.ok) {
    setEnabled(false);
    setStatus(response.error ?? "This tab is unavailable.");
    return;
  }

  input.value = response.title ?? "";
  setStatus(response.title ? "Active" : "");
};

form.addEventListener("submit", (event) => {
  event.preventDefault();

  void (async () => {
    const response = await sendRequest({
      type: "setCurrentTabTitleOverride",
      title: input.value,
    });

    if (!response.ok) {
      setStatus(response.error ?? "Could not save the name.");
      return;
    }

    input.value = response.title ?? input.value.trim();
    setStatus("Saved");
  })();
});

clearButton.addEventListener("click", () => {
  void (async () => {
    const response = await sendRequest({ type: "clearCurrentTabTitleOverride" });

    if (!response.ok) {
      setStatus(response.error ?? "Could not clear the name.");
      return;
    }

    input.value = "";
    setStatus("Cleared");
  })();
});

void loadCurrentTitle();
