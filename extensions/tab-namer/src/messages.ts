export interface GetCurrentTabTitleOverrideRequest {
  type: "getCurrentTabTitleOverride";
}

export interface SetCurrentTabTitleOverrideRequest {
  type: "setCurrentTabTitleOverride";
  title: string;
}

export interface ClearCurrentTabTitleOverrideRequest {
  type: "clearCurrentTabTitleOverride";
}

export type PopupRequest =
  | GetCurrentTabTitleOverrideRequest
  | SetCurrentTabTitleOverrideRequest
  | ClearCurrentTabTitleOverrideRequest;

export interface PopupResponse {
  ok: boolean;
  title?: string;
  error?: string;
}

export interface ApplyTitleOverrideRequest {
  type: "applyTitleOverride";
  title: string;
}

export interface ClearTitleOverrideRequest {
  type: "clearTitleOverride";
}

export type ContentRequest = ApplyTitleOverrideRequest | ClearTitleOverrideRequest;
