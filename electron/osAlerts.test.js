// Run with: node --test electron/
import assert from "node:assert/strict";
import test from "node:test";
import { createOsAlerts } from "./osAlerts.js";

function harness({ focused = false, supported = true } = {}) {
  const shown = [];
  class FakeNotification {
    static isSupported() {
      return supported;
    }
    constructor(opts) {
      this.opts = opts;
      this.handlers = {};
      this.closed = false;
    }
    on(ev, fn) {
      this.handlers[ev] = fn;
    }
    show() {
      shown.push(this);
    }
    close() {
      this.closed = true;
      this.handlers.close?.();
    }
  }
  const state = { focused };
  const opened = [];
  const badges = [];
  const alerts = createOsAlerts({
    Notification: FakeNotification,
    isFocused: () => state.focused,
    onOpen: (t) => opened.push(t),
    setBadge: (n) => badges.push(n),
  });
  return { alerts, shown, state, opened, badges };
}

const req = (over = {}) => ({ connectionId: "c1", id: "n1", priority: "urgent", title: "Permission needed: bash", body: "Chat: rm -rf build", sessionId: "s1", projectPath: "/p", ...over });

test("an unfocused window gets an audible alert for urgent, a silent one for normal", () => {
  const h = harness();
  assert.equal(h.alerts.show(req()), "shown");
  assert.equal(h.alerts.show(req({ sessionId: "s2", priority: "normal", title: "Response ready" })), "shown");
  assert.equal(h.shown[0].opts.silent, false);
  assert.equal(h.shown[1].opts.silent, true);
});

test("nothing is raised while the window is focused, for quiet entries, or without support", () => {
  const focused = harness({ focused: true });
  assert.equal(focused.alerts.show(req()), "focused");
  const idle = harness();
  assert.equal(idle.alerts.show(req({ priority: "quiet" })), "quiet");
  assert.equal(harness({ supported: false }).alerts.show(req()), "unsupported");
  assert.equal(focused.shown.length + idle.shown.length, 0);
});

test("one live alert per chat: a newer one replaces the older", () => {
  const h = harness();
  h.alerts.show(req({ id: "a" }));
  h.alerts.show(req({ id: "b", title: "Turn error", body: "boom" }));
  h.alerts.show(req({ id: "c", sessionId: "s2" }));
  assert.equal(h.shown[0].closed, true);
  assert.equal(h.shown[1].closed, false);
  assert.equal(h.shown[2].closed, false);
});

test("clicking opens that chat on that connection", () => {
  const h = harness();
  h.alerts.show(req());
  h.shown[0].handlers.click();
  assert.deepEqual(h.opened, [{ connectionId: "c1", sessionId: "s1", projectPath: "/p" }]);
});

test("returning to the window closes what's pending; the badge is a clean non-negative count", () => {
  const h = harness();
  h.alerts.show(req());
  h.alerts.show(req({ sessionId: "s2" }));
  h.alerts.closeAll();
  assert.ok(h.shown.every((n) => n.closed));
  h.alerts.badge(3.7);
  h.alerts.badge(-2);
  h.alerts.badge("x");
  assert.deepEqual(h.badges, [3, 0, 0]);
});

test("long text is clipped", () => {
  const h = harness();
  h.alerts.show(req({ body: "x".repeat(1000) }));
  assert.ok(h.shown[0].opts.body.length <= 240);
});
