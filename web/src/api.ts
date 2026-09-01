export class ApiError extends Error {
  status: number;
  code: string;
  body: unknown;

  constructor(status: number, code: string, body: unknown = null) {
    super(code);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export interface Me {
  username: string;
  must_change_password: boolean;
  token?: string;
}

let apiBase = "";
let sessionToken: string | null = null;

export function setApiBase(base: string | null) {
  apiBase = (base ?? "").replace(/\/$/, "");
}

export function getApiBase(): string {
  return apiBase;
}

export function setSessionToken(token: string | null) {
  sessionToken = token;
}

export function getSessionToken(): string | null {
  return sessionToken;
}

export function apiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${apiBase}${path}`;
}

export function rewriteApiUrls(text: string): string {
  if (!apiBase) return text;
  return text.replaceAll("/api/", `${apiBase}/api/`);
}

export function liveUrl(): string {
  if (apiBase) {
    const url = new URL("/api/live", apiBase);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (sessionToken) url.searchParams.set("token", sessionToken);
    return url.toString();
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const query = sessionToken ? `?token=${encodeURIComponent(sessionToken)}` : "";
  return `${proto}://${location.host}/api/live${query}`;
}

export interface Note {
  id: string;
  title: string;
  folder?: string;
  tags?: string[];
  content: string;
  modified_at: string;
}

export interface NoteMeta {
  id: string;
  title: string;
  folder?: string;
  tags?: string[];
  modified_at: string;
}

export interface TagSuggest {
  name: string;
  count: number;
  create?: boolean;
}

export interface SearchHit {
  id: string;
  title: string;
  snippet: string;
  kind?: string;
  parked_id?: number;
  context?: string;
}

export interface ContextBlock {
  id: string;
  ordinal?: number;
  preview: string;
  tmp_id?: string;
}

export interface ContextEvent {
  id: number;
  block_id: string;
  captured_at: string;
  local_time: string;
  timezone: string;
  device?: string;
  surface: string;
  lat?: number;
  lon?: number;
  weather_code?: number;
  weather_label?: string;
  temp_c?: number;
  source: string;
}

export interface NoteContext {
  blocks: ContextBlock[];
  events: ContextEvent[];
}

export interface WeatherNow {
  weather_code: number;
  weather_label: string;
  temp_c: number;
}

export interface Asset {
  id: string;
  url: string;
  markdown: string;
  filename: string;
  original_name: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  group: string;
  created_at: string;
}

export interface HistoryEntry {
  rev: string;
  created_at: string;
  bytes: number;
}

export interface HistoryRev {
  rev: string;
  created_at: string;
  bytes: number;
  title: string;
  folder: string;
  content: string;
}

export interface Parked {
  id: number;
  body: string;
  created_at: string;
  source_id?: string;
  source_title?: string;
  source_folder?: string;
  excerpt?: string;
  surface?: string;
  device?: string;
  local_time?: string;
  timezone?: string;
  lat?: number;
  lon?: number;
  accuracy_m?: number;
  weather_code?: number;
  weather_label?: string;
  temp_c?: number;
  tags?: string[];
}

function folderPath(folder: string): string {
  return folder
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

function isNote(data: unknown): data is Note {
  return (
    !!data &&
    typeof data === "object" &&
    "id" in data &&
    "title" in data &&
    "content" in data &&
    typeof (data as Note).id === "string"
  );
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // FormData can come from a different browser realm in desktop/webview clients.
  // Do not force JSON there: fetch must supply its multipart boundary.
  const isFormData =
    typeof FormData !== "undefined" &&
    (init.body instanceof FormData || Object.prototype.toString.call(init.body) === "[object FormData]");
  if (init.body && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (sessionToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }
  const res = await fetch(apiUrl(path), {
    ...init,
    headers,
    credentials: apiBase ? "omit" : "include",
  });
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new ApiError(res.status, "request_failed");
    }
  }
  if (!res.ok) {
    if (res.status === 401 && path !== "/api/auth/login" && path !== "/api/auth/me") {
      onUnauthorized?.();
    }
    const code =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: string }).error)
        : "request_failed";
    throw new ApiError(res.status, code, data);
  }
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean }>("/api/health"),
  setupStatus: () => request<{ needed: boolean }>("/api/setup"),
  setup: (username: string, password: string) =>
    request<Me>("/api/setup", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<Me>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  me: () => request<Me>("/api/auth/me"),
  changePassword: (password: string) =>
    request<Me>("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  listNotes: () => request<NoteMeta[]>("/api/notes"),
  titleSearch: (q: string) => request<NoteMeta[]>(`/api/notes/title-search?q=${encodeURIComponent(q)}`),
  recentNotes: () => request<NoteMeta[]>("/api/notes/recent"),
  favorites: () => request<NoteMeta[]>("/api/favorites"),
  favorite: (id: string) => request<void>(`/api/favorites/${encodeURIComponent(id)}`, { method: "PUT" }),
  unfavorite: (id: string) => request<void>(`/api/favorites/${encodeURIComponent(id)}`, { method: "DELETE" }),
  collapsedFolders: () => request<string[]>("/api/collapsed-folders"),
  collapseFolder: (folder: string) =>
    request<void>(`/api/collapsed-folders/${folderPath(folder)}`, { method: "PUT" }),
  expandFolder: (folder: string) =>
    request<void>(`/api/collapsed-folders/${folderPath(folder)}`, { method: "DELETE" }),
  getNote: (id: string) => request<Note>(`/api/notes/${encodeURIComponent(id)}`),
  putNote: (id: string, content: string) =>
    request<Note>(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  patchNote: (id: string, meta: { title?: string; folder?: string; tags?: string[] }) =>
    request<Note>(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(meta),
    }),
  suggestTags: (body: {
    note_id?: string;
    q?: string;
    title?: string;
    folder?: string;
    content?: string;
    cursor?: number;
    current_tags?: string[];
  }) =>
    request<TagSuggest[]>("/api/tags/suggest", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteNote: (id: string) =>
    request<void>(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" }),
  createNote: async (title: string, folder?: string, content?: string) => {
    try {
      return await request<Note>("/api/notes", {
        method: "POST",
        body: JSON.stringify({ title, folder, content }),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && isNote(err.body)) {
        return err.body;
      }
      throw err;
    }
  },
  daily: (date: string) => request<Note>(`/api/notes/daily/${date}`),
  putDaily: (date: string, content: string) =>
    request<Note>(`/api/notes/daily/${date}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  search: (q: string, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ q });
    for (const [key, value] of Object.entries(extra)) {
      if (value) params.set(key, value);
    }
    return request<SearchHit[]>(`/api/search?${params}`);
  },
  noteContext: (id: string) => request<NoteContext>(`/api/notes/${encodeURIComponent(id)}/context`),
  postNoteContext: (
    id: string,
    body: {
      paragraphs: string[];
      events: Array<{
        tmp_id: string;
        ordinal: number;
        captured_at: string;
        local_time: string;
        timezone: string;
        surface: string;
        device?: string;
        lat?: number;
        lon?: number;
        accuracy_m?: number;
        source?: string;
      }>;
    },
  ) =>
    request<NoteContext>(`/api/notes/${encodeURIComponent(id)}/context`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  weather: (lat: number, lon: number) =>
    request<WeatherNow>(`/api/weather?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`),
  backlinks: (id: string) => request<NoteMeta[]>(`/api/backlinks/${encodeURIComponent(id)}`),
  noteHistory: (id: string) =>
    request<HistoryEntry[]>(`/api/notes/${encodeURIComponent(id)}/history`),
  noteRevision: (id: string, rev: string) =>
    request<HistoryRev>(`/api/notes/${encodeURIComponent(id)}/history/${encodeURIComponent(rev)}`),
  restoreNote: (id: string, rev: string) =>
    request<Note>(`/api/notes/${encodeURIComponent(id)}/restore`, {
      method: "POST",
      body: JSON.stringify({ rev }),
    }),
  listParked: () => request<Parked[]>("/api/parked"),
  createParked: (body: {
    body: string;
    source_id?: string;
    source_title?: string;
    source_folder?: string;
    excerpt?: string;
    surface?: string;
    device?: string;
    local_time?: string;
    timezone?: string;
    lat?: number;
    lon?: number;
    accuracy_m?: number;
  }) => request<Parked>("/api/parked", { method: "POST", body: JSON.stringify(body) }),
  deleteParked: (id: number) =>
    request<void>(`/api/parked/${id}`, { method: "DELETE" }),
  parkedToNote: (id: number) => request<Note>(`/api/parked/${id}/note`, { method: "POST" }),
  listAssets: () => request<Asset[]>("/api/assets"),
  assetMeta: (id: string) => request<Asset>(`/api/assets/${encodeURIComponent(id)}/meta`),
  assetBacklinks: (id: string) => request<NoteMeta[]>(`/api/assets/${encodeURIComponent(id)}/backlinks`),
  uploadAsset: async (file: File, group = "") => {
    const body = new FormData();
    body.append("file", file);
    body.append("group", group);
    return request<Asset>("/api/assets", { method: "POST", body });
  },
};
