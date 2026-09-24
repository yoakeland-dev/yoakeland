// The backend does zero image processing (SPEC.md §2a), so the client downscales to 96x96 before sending.
const AVATAR_SIZE = 96;

/** An uploaded avatar is a data URL; an emoji glyph is plain text, rendered into one only when sent. */
export function isPhotoAvatar(avatar: string): boolean {
  return avatar.startsWith("data:");
}

export function emojiAvatarDataUrl(emoji: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.font = `${AVATAR_SIZE * 0.7}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji || "🐣", AVATAR_SIZE / 2, AVATAR_SIZE / 2 + 2);
  return canvas.toDataURL("image/png");
}

/** Center-crops `file` to a square and downscales to 96x96 so it broadcasts as a small JPEG. */
export function photoAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_SIZE;
      canvas.height = AVATAR_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/** Sends `profileAvatar` as-is if it's already a data URL, otherwise renders the emoji into one first. */
export function outgoingAvatarDataUrl(avatar: string): string {
  return isPhotoAvatar(avatar) ? avatar : emojiAvatarDataUrl(avatar);
}
