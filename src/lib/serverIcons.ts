// Server avatar icons: Phosphor's filled set, curated. The server stores only the name (see
// ServerIcon in types.ts); this file is the one place that knows which names exist. The glob
// below is the whole list, so adding an icon is adding its name to it. It is a literal because
// Vite only bundles the files a static glob names, not the pack's 1,500 icons.
const files = import.meta.glob(
  "/node_modules/@phosphor-icons/core/assets/fill/{hard-drives,desktop-tower,desktop,laptop,cloud,cloud-lightning,database,cpu,terminal-window,globe-hemisphere-west,plug,lightning,wifi-high,lock-key,shield-check,house,house-line,buildings,storefront,warehouse,factory,ghost,cat,dog,bird,butterfly,fish,horse,rabbit,cow,paw-print,bug,cactus,plant,flower-lotus,leaf,tree-palm,tree-evergreen,pizza,hamburger,coffee,cookie,ice-cream,cake,pepper,orange,cherries,rocket,rocket-launch,planet,moon,sun,snowflake,drop,flame,fire,sparkle,star,heart,diamond,crown,skull,alien,robot,game-controller,music-note,headphones,camera,film-slate,palette,paint-brush,brain,atom,flask,magic-wand,lightbulb,compass,key,hammer,wrench,gear,anchor,airplane,car,bicycle,boat,train,book-open,graduation-cap,trophy,flag,flag-banner,lighthouse,tent,mountains,umbrella,cube,cube-focus,package,lego-smiley,smiley,smiley-wink,fingerprint,tornado,rainbow,cloud-sun,eye,binoculars,microscope,dna,hard-drive,computer-tower,monitor,memory,circuitry,network,terminal,code,plugs-connected,stack,git-branch,broadcast,fan}-fill.svg",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** icon name -> inline SVG (fill="currentColor"). */
export const SERVER_ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, svg]) => [path.slice(path.lastIndexOf("/") + 1, -"-fill.svg".length), svg]),
);

/** The machine-and-network icons people look for first, with the words they'd search ("server"
 * isn't a Phosphor name). Listed first in the picker; every key must also be in the glob. */
const TECH: Record<string, string> = {
  "hard-drives": "server storage nas rack",
  "hard-drive": "disk drive storage",
  "desktop-tower": "server pc computer tower",
  "computer-tower": "server pc computer tower",
  "desktop": "desktop computer pc",
  "monitor": "screen display",
  "laptop": "laptop computer notebook",
  "cloud": "cloud vps remote",
  "database": "db sql storage",
  "cpu": "processor chip",
  "memory": "ram chip",
  "circuitry": "circuit board hardware",
  "network": "lan nodes",
  "terminal-window": "terminal shell console cli",
  "terminal": "shell console cli",
  "code": "dev programming",
  "plugs-connected": "connection plug",
  "stack": "layers",
  "git-branch": "git",
  "globe-hemisphere-west": "web internet world",
  "wifi-high": "wireless network",
  "broadcast": "signal",
  "fan": "cooling",
  "lightning": "power electric",
  "shield-check": "security",
  "cube": "container docker box",
  "package": "container docker box",
};

export const SERVER_ICON_NAMES = [
  ...Object.keys(TECH).filter((n) => n in SERVER_ICONS),
  ...Object.keys(SERVER_ICONS).sort().filter((n) => !(n in TECH)),
];

/** Whether `query` (trimmed, lowercased) matches an icon's name or, for the tech set, its search words. */
export const serverIconMatches = (name: string, query: string): boolean =>
  `${name.replaceAll("-", " ")} ${TECH[name] ?? ""}`.includes(query);

/** A name from the server this build doesn't ship (newer client elsewhere) draws as initials. */
export const serverIconSvg = (name: string | undefined): string | undefined => (name ? SERVER_ICONS[name] : undefined);
