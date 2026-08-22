export function imageFileFromList(
  items: ArrayLike<{ type: string; getAsFile: () => File | null }>,
): File | null {
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}

export function insertAt(content: string, index: number, inserted: string): string {
  const at = Math.max(0, Math.min(index, content.length));
  const prefix = at > 0 && !content.slice(at - 1, at).match(/\s/) ? "\n" : "";
  const suffix = content.slice(at, at + 1) && !content.slice(at, at + 1).match(/\s/) ? "\n" : "";
  return `${content.slice(0, at)}${prefix}${inserted}${suffix}${content.slice(at)}`;
}

export function isAllowedImage(file: File): boolean {
  return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type);
}
