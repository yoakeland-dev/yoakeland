// A person's picture lives on the server in the upload bucket and is named "upload:<sha256>".
// The name never changes meaning, so a picture is fetched once and kept for the session.
import { SvelteMap } from "svelte/reactivity";

const UPLOAD = /^upload:[0-9a-f]{64}$/;
const pictures = new SvelteMap<string, string>();
const asked = new Set<string>();
let fetcher: ((avatar: string) => boolean) | null = null;

export const isUploadAvatar = (avatar: string | undefined): boolean => !!avatar && UPLOAD.test(avatar);

/** ipc.ts registers how to ask the server for a picture; it says whether a request went out. */
export function setAvatarFetcher(fn: (avatar: string) => boolean) {
  fetcher = fn;
}

/** An <img src> for an avatar: a data URL as it is, an upload reference once its picture has
 * arrived (and a request for it is on its way until then), "" for anything else. A reply that
 * has no picture is not asked for again. */
export function avatarSrc(avatar: string | undefined): string {
  if (!avatar) return "";
  if (avatar.startsWith("data:")) return avatar;
  if (!UPLOAD.test(avatar)) return "";
  const hit = pictures.get(avatar);
  if (hit !== undefined) return hit;
  if (!asked.has(avatar) && fetcher?.(avatar)) asked.add(avatar);
  return "";
}

/** The server's answer to get_avatar. */
export function storeAvatar(avatar: string, data: string | undefined) {
  if (data) pictures.set(avatar, data);
}
