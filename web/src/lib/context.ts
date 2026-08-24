export type DeviceClass = "phone" | "tablet" | "desktop";
export type Surface = "editor" | "park" | "quick";

export type WeatherNow = {
  weather_code: number;
  weather_label: string;
  temp_c: number;
};

export type GeoFix = {
  lat: number;
  lon: number;
  accuracy_m?: number;
  at: number;
};

export type ContextStamp = {
  captured_at: string;
  local_time: string;
  timezone: string;
  device: DeviceClass;
  surface: Surface;
  lat?: number;
  lon?: number;
  accuracy_m?: number;
};

const FIX_MAX_AGE = 10 * 60 * 1000;

let lastFix: GeoFix | null = null;
let lastWeather: WeatherNow | null = null;
let watching = false;
let whereHook: (() => void) | null = null;

export function setWhereHook(fn: (() => void) | null) {
  whereHook = fn;
}

export function runWhereHook() {
  whereHook?.();
}

export function setLastWeather(weather: WeatherNow | null) {
  lastWeather = weather;
}

export function getLastWeather(): WeatherNow | null {
  return lastWeather;
}

export function deviceClass(width = typeof window === "undefined" ? 1024 : window.innerWidth): DeviceClass {
  if (width < 640) return "phone";
  if (width < 960) return "tablet";
  return "desktop";
}

export function timezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function localTime(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}`;
}

export function capturedAt(now = new Date()): string {
  return now.toISOString();
}

export function formatWhereStamp(now = new Date(), weather = lastWeather): string {
  const tz = timezone().split("/").pop() || timezone();
  const base = `${localTime(now)} ${tz}`;
  if (!weather) return base;
  return `${base} · ${Math.round(weather.temp_c)}°C, ${weather.weather_label}`;
}

export function currentFix(now = Date.now()): GeoFix | null {
  if (!lastFix) return null;
  if (now - lastFix.at > FIX_MAX_AGE) return null;
  return lastFix;
}

export function stamp(surface: Surface, now = new Date()): ContextStamp {
  const fix = currentFix(now.getTime());
  return {
    captured_at: capturedAt(now),
    local_time: localTime(now),
    timezone: timezone(),
    device: deviceClass(),
    surface,
    lat: fix?.lat,
    lon: fix?.lon,
    accuracy_m: fix?.accuracy_m,
  };
}

export function splitParagraphs(content: string): string[] {
  if (!content) return [];
  return content.split("\n");
}

export function lineRange(content: string, ordinal: number): { from: number; to: number } | null {
  const lines = splitParagraphs(content);
  if (ordinal < 0 || ordinal >= lines.length) return null;
  let from = 0;
  for (let i = 0; i < ordinal; i += 1) from += lines[i].length + 1;
  return { from, to: from + lines[ordinal].length };
}

export function startGeoWatch() {
  if (watching || typeof navigator === "undefined" || !navigator.geolocation) return;
  watching = true;
  navigator.geolocation.watchPosition(
    (pos) => {
      lastFix = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy,
        at: Date.now(),
      };
    },
    () => {
      watching = false;
    },
    { enableHighAccuracy: true, maximumAge: 60_000 },
  );
}

export function rememberFix(fix: GeoFix) {
  lastFix = fix;
}

export function contextLine(event: {
  local_time: string;
  timezone: string;
  device?: string;
  weather_label?: string;
  temp_c?: number;
}): string {
  const tz = event.timezone.split("/").pop() || event.timezone;
  const bits = [`${event.local_time} ${tz}`];
  if (event.device) bits.push(event.device);
  if (event.weather_label && event.temp_c != null) {
    bits.push(`${Math.round(event.temp_c)}°C, ${event.weather_label}`);
  }
  return bits.join(" · ");
}

export function resetGeoForTests() {
  lastFix = null;
  lastWeather = null;
  watching = false;
  whereHook = null;
}
