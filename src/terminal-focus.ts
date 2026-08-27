export type TerminalFocusObservation = {
  neutral?: boolean;
  blocked?: boolean;
};

/**
 * Keeps terminal focus intent across full DOM renders.
 *
 * A requested focus is durable until the matching xterm input really receives
 * focus. This matters when a modal or an intermediate render temporarily makes
 * the terminal unavailable. A neutral focus (body/app root) does not erase the
 * last focused terminal, while an intentional focus on another control does.
 */
export class TerminalFocusTracker {
  private focusedKey: string | null = null;
  private requestedKey: string | null = null;

  observe(key: string | null, observation: TerminalFocusObservation = {}) {
    if (key) {
      this.focusedKey = key;
      return;
    }
    // A modal temporarily owns focus. Closing it rebuilds the DOM while its
    // focused control is still the active element, so clearing here would lose
    // the terminal that must receive focus once the modal disappears.
    if (!observation.neutral && !observation.blocked) this.focusedKey = null;
  }

  request(key: string) {
    this.requestedKey = key;
    this.focusedKey = key;
  }

  target(blocked = false) {
    if (blocked) return null;
    return this.requestedKey ?? this.focusedKey;
  }

  confirm(key: string) {
    this.focusedKey = key;
    if (this.requestedKey === key) this.requestedKey = null;
  }

  forget(key: string) {
    if (this.focusedKey === key) this.focusedKey = null;
    if (this.requestedKey === key) this.requestedKey = null;
  }

  snapshot() {
    return { focusedKey: this.focusedKey, requestedKey: this.requestedKey };
  }
}
