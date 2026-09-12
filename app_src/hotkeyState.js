// Photoshop 27.9.1 dropped ScriptUI.environment.keyboardState.keyName: the
// property reads as undefined while the modifier flags survived, so the host
// answers "aCTRLaSHIFTa" for Ctrl+Shift+X and every binding with a main key
// (F2, Ctrl+Enter, Shift+X) went dead while Win+Ctrl kept working. On Windows
// the foreground watcher reads the held key through GetAsyncKeyState and it is
// spliced in here, in the host's own "aKEYa" format, so matching and recording
// keep one vocabulary.
const MODIFIER_KEYS = ["WIN", "CTRL", "ALT", "SHIFT"];

const withWatcherKey = (state, key) => {
  if (!key || typeof state !== "string" || state.charAt(0) !== "a") return state;
  // An older host that still names the key wins over the watcher
  const hasMainKey = state.split("a").some((part) => part && MODIFIER_KEYS.indexOf(part) === -1);
  return hasMainKey ? state : state + key + "a";
};

export { withWatcherKey };
