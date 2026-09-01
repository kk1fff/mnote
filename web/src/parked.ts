import { ref } from "vue";
import { api, type Parked } from "./api";

export const parkedItems = ref<Parked[]>([]);
export const pendingExcerpt = ref<string | null>(null);

export type ParkContext = {
  source_id?: string;
  source_title?: string;
  source_folder?: string;
  excerpt?: string;
};

let contextProvider: (() => ParkContext | null) | null = null;

export function setParkContext(fn: (() => ParkContext | null) | null) {
  contextProvider = fn;
}

export function parkContext(): ParkContext {
  return contextProvider?.() ?? {};
}

let showCaptureFn: ((ctx?: ParkContext) => void) | null = null;

export function registerCapture(fn: ((ctx?: ParkContext) => void) | null) {
  showCaptureFn = fn;
}

export function showParkCapture(ctx?: ParkContext) {
  showCaptureFn?.(ctx);
}

let showListFn: ((id?: number) => void) | null = null;

export function registerParkedList(fn: ((id?: number) => void) | null) {
  showListFn = fn;
}

export function showParkedList(id?: number) {
  showListFn?.(id);
}

export async function refreshParked() {
  parkedItems.value = await api.listParked();
}
