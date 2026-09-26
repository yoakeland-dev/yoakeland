// File icons come from material-icon-theme (VS Code's Material Icon Theme), resolved the way VS
// Code does: exact file name first, then the longest dotted suffix ("d.ts" before "ts").
// Folders use Tabler icons by name instead (see FOLDER_ICONS), to match the rest of the UI.
import { fileExtensions, fileNames } from "material-icon-theme/dist/material-icons.json";

// Emitted as files, not inlined: see assetsInlineLimit in vite.config.js.
const urls = import.meta.glob("/node_modules/material-icon-theme/icons/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const names = fileNames as Record<string, string>;
const exts = fileExtensions as Record<string, string>;

export function fileIconUrl(fileName: string): string {
  const name = fileName.toLowerCase();
  let icon = names[name];
  for (let i = name.indexOf("."); !icon && i >= 0; i = name.indexOf(".", i + 1)) icon = exts[name.slice(i + 1)];
  return urls[`/node_modules/material-icon-theme/icons/${icon ?? "file"}.svg`] ?? urls["/node_modules/material-icon-theme/icons/file.svg"];
}

// Folder names with a fitting Tabler icon; anything else is a plain folder.
const FOLDER_ICONS: Record<string, string> = {
  src: "folder-code",
  lib: "folder-code",
  app: "folder-code",
  cmd: "folder-code",
  pkg: "folder-code",
  internal: "folder-code",
  components: "folder-code",
  config: "folder-cog",
  configs: "folder-cog",
  ".config": "folder-cog",
  settings: "folder-cog",
  scripts: "folder-cog",
  test: "folder-check",
  tests: "folder-check",
  __tests__: "folder-check",
  spec: "folder-check",
  e2e: "folder-check",
  dist: "folder-bolt",
  build: "folder-bolt",
  out: "folder-bolt",
  target: "folder-bolt",
  bin: "folder-bolt",
  public: "folder-share",
  static: "folder-share",
  assets: "folder-star",
  images: "folder-star",
  vendor: "folder-down",
  node_modules: "brand-npm",
  ".github": "brand-github",
  ".vscode": "brand-vscode",
  docker: "brand-docker",
};

export function folderIcon(name: string, open: boolean): string {
  return FOLDER_ICONS[name.toLowerCase()] ?? (open ? "folder-open" : "folder");
}
