// An in-app stand-in for window.confirm(). The native dialog blocks the renderer and, in
// Electron on Linux/Windows, can leave the window not taking input afterwards. ConfirmHost renders it.
let pending = $state<{ message: string; resolve: (ok: boolean) => void } | null>(null);

export const confirmState = {
  get pending() {
    return pending;
  },
};

export function askConfirm(message: string): Promise<boolean> {
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { message, resolve };
  });
}

export function answerConfirm(ok: boolean) {
  const p = pending;
  pending = null;
  p?.resolve(ok);
}
