import { error } from "@sveltejs/kit";
import { dev } from "$app/environment";

// The dev-only harness below: its pages write fake state into the live app, so a packaged build
// answers 404 instead of mounting them.
export function load() {
  if (!dev) error(404, "Not found");
}
