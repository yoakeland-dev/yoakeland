/** Release notes shown once after an upgrade. Add an entry per release; a version without one shows nothing. */
export interface WhatsNewEntry {
  title: string;
  /** Header graphic, e.g. "whatsnew/0.1.6.png" (file in static/whatsnew/, any size, about 2.6:1 looks best; very tall ones crop at 14rem); a gradient with the logo when omitted. */
  image?: string;
  items: { icon: string; title: string; body: string }[];
}

export const WHATS_NEW: Record<string, WhatsNewEntry> = {
  "0.2.0": {
    title: "Share your server",
    image: "whatsnew/0.2.0.png",
    items: [
      { icon: "users", title: "People, not just devices", body: "Give each person a name, a picture and their own chats. Pair their device in one card." },
      { icon: "shield-check", title: "Three levels of trust", body: "Limited, Trusted or Full, per person and per device." },
      { icon: "arrows-exchange", title: "Borrow a model", body: "Use a provider from another of your servers, relayed through this device. You choose what each server may borrow." },
      { icon: "book-2", title: "Chapters for long chats", body: "Old conversation folds into titled chapters the agent can reopen when it needs them." },
      { icon: "clock", title: "Scheduled turns", body: "Have an agent run on a schedule while you're away." },
      { icon: "app-window", title: "Live pages in chat", body: "Agents can hand you a small interactive page, not just text." },
      { icon: "checks", title: "A todo list you can watch", body: "The agent's plan stays in a panel as it works." },
    ],
  },
  // Draft from the unreleased work, check the wording before tagging.
  "0.1.7": {
    title: "Any agent, one place",
    image: "whatsnew/0.1.7.png",
    items: [
      { icon: "robot", title: "Add any agent", body: "Claude, Codex, anything in the ACP registry, an API key or your own command, from one Providers page." },
      { icon: "switch-horizontal", title: "Switch models mid-chat", body: "Change model whenever you like. A divider marks where the conversation switched." },
      { icon: "arrows-minimize", title: "Simple view", body: "Everything the agent did before its answer folds into one dropdown. Open it when you want the details." },
      { icon: "list-search", title: "Jump around long chats", body: "A minimap beside the chat has one tick per prompt. Click one to go there." },
      { icon: "server", title: "Icons for your servers", body: "Pick an icon and colour for each server. Every device you use sees the same one." },
      { icon: "refresh", title: "Update notices", body: "The app tells you when a new version is out, and Settings can update a local server in one click." },
    ],
  },
};

const KEY = "yoake.lastSeenVersion";

/** The entry to show for this launch, or null. A first run only records the version. */
export function pendingWhatsNew(current: string): WhatsNewEntry | null {
  try {
    // Versions before 0.1.7 didn't record one: saved settings mean an upgrade, not a first run.
    const seen = localStorage.getItem(KEY) ?? (localStorage.getItem("yoake.settings") ? "0" : null);
    localStorage.setItem(KEY, current);
    return seen && seen !== current ? (WHATS_NEW[current] ?? null) : null;
  } catch {
    return null;
  }
}
