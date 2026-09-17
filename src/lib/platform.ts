// Whether we're running inside the Tauri shell rather than a plain browser
// tab. Window decorations are off in tauri.conf.json, so the app draws its
// own minimize/maximize/close buttons — but only here. On the web the OS
// chrome isn't ours to draw, and the header shouldn't reserve room for
// buttons that will never appear.
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
