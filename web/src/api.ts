export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export interface Me {
  username: string;
  must_change_password: boolean;
}

export interface Note {
  path: string;
  content: string;
  modified_at: string;
}

export interface NoteMeta {
  path: string;
  title: string;
  modified_at: string;
}

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
}

export interface Asset {
  id: string;
  url: string;
  markdown: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
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
    throw new ApiError(res.status, code);
  }
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean }>("/api/health"),
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
  getNote: (path: string) => request<Note>(`/api/notes/${encodeNotePath(path)}`),
  putNote: (path: string, content: string) =>
    request<Note>(`/api/notes/${encodeNotePath(path)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  createNote: (path: string, content?: string) =>
    request<Note>("/api/notes", {
      method: "POST",
      body: JSON.stringify({ path, content }),
    }),
  daily: (date: string) => request<Note>(`/api/notes/daily/${date}`),
  putDaily: (date: string, content: string) =>
    request<Note>(`/api/notes/daily/${date}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  search: (q: string) => request<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
  backlinks: (path: string) => request<NoteMeta[]>(`/api/backlinks/${encodeNotePath(path)}`),
  uploadAsset: async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<Asset>("/api/assets", { method: "POST", body });
  },
};

export function encodeNotePath(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}
