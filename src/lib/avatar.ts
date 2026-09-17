// Peer avatars travel as a data URL over the wire (SPEC.md §2a `auth`,
// `set_peer_avatar`) — the backend does zero image processing, so the client
// must downscale before sending. `profileAvatar` (state.svelte.ts) holds
// either a short emoji glyph or an uploaded photo, already downscaled to the
// house-convention 96x96 by `photoAvatarDataUrl` at upload time; emoji still
// get rendered into a same-size PNG lazily, right before sending, since
// there's no image to downscale for them.
const AVATAR_SIZE = 96;

/** An uploaded avatar is stored/sent as a data URL; an emoji glyph is stored
 * as plain text and only turned into one when it's about to be sent. */
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

/** Center-crops `file` to a square and downscales it to 96x96 (§2a's house
 * convention) so an uploaded photo stays a small, fast-to-broadcast JPEG
 * instead of shipping its original resolution to every connected peer. */
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

/** Sends `profileAvatar` as-is if it's already a 96x96 data URL, otherwise
 * renders the emoji into one first — the one place that distinction matters
 * for outbound traffic (peer_list, §3.2). */
export function outgoingAvatarDataUrl(avatar: string): string {
  return isPhotoAvatar(avatar) ? avatar : emojiAvatarDataUrl(avatar);
}
