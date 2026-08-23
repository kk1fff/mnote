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
}

export interface Note {
  id: string;
  title: string;
  folder?: string;
  content: string;
  modified_at: string;
}

export interface NoteMeta {
  id: string;
  title: string;
  folder?: string;
  modified_at: string;
}

export interface SearchHit {
  id: string;
  title: string;
  snippet: string;
}

export interface Asset {
  id: string;
  url: string;
  markdown: string;
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
    throw new ApiError(res.status, code, data);
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
  titleSearch: (q: string) => request<NoteMeta[]>(`/api/notes/title-search?q=${encodeURIComponent(q)}`),
  recentNotes: () => request<NoteMeta[]>("/api/notes/recent"),
  favorites: () => request<NoteMeta[]>("/api/favorites"),
  favorite: (id: string) => request<void>(`/api/favorites/${encodeURIComponent(id)}`, { method: "PUT" }),
  unfavorite: (id: string) => request<void>(`/api/favorites/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getNote: (id: string) => request<Note>(`/api/notes/${encodeURIComponent(id)}`),
  putNote: (id: string, content: string) =>
    request<Note>(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  patchNote: (id: string, meta: { title?: string; folder?: string }) =>
    request<Note>(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(meta),
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
  search: (q: string) => request<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
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
  }) => request<Parked>("/api/parked", { method: "POST", body: JSON.stringify(body) }),
  deleteParked: (id: number) =>
    request<void>(`/api/parked/${id}`, { method: "DELETE" }),
  parkedToNote: (id: number) => request<Note>(`/api/parked/${id}/note`, { method: "POST" }),
  uploadAsset: async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<Asset>("/api/assets", { method: "POST", body });
  },
};
