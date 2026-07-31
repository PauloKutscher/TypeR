import React from "react";
import { FiX } from "react-icons/fi";
import { locale, getHotkeyPressed } from "../../utils";

const MODIFIERS = ["WIN", "CTRL", "ALT", "SHIFT"];
const SPECIAL_KEYS = { "+": "PLUS", "-": "MINUS", "=": "EQUAL", "/": "DIVIDE", "*": "MULTIPLY" };
const IGNORED_KEYS = ["Meta", "Control", "Alt", "Shift", "AltGraph", "CapsLock", "Dead", "Process", "Unidentified"];

const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "");

// Stored key names -> short human-friendly keycap labels (cosmetic only,
// the stored value keeps the host vocabulary)
const KEY_LABELS = {
  WIN: IS_MAC ? "Cmd" : "Win",
  CTRL: "Ctrl",
  SHIFT: "Shift",
  ALT: IS_MAC ? "Opt" : "Alt",
  ENTER: "Enter",
  TAB: "Tab",
  SPACE: "Space",
  ESCAPE: "Esc",
  BACKSPACE: "Bksp",
  DELETE: "Del",
  PLUS: "+",
  MINUS: "-",
  EQUAL: "=",
  DIVIDE: "/",
  MULTIPLY: "*",
  ARROWUP: "↑",
  ARROWDOWN: "↓",
  ARROWLEFT: "←",
  ARROWRIGHT: "→",
};

const keyLabel = (key) => KEY_LABELS[String(key).toUpperCase()] || key;

const getLocalKeys = (e) => {
  const keys = [];
  if (e.metaKey) keys.push("WIN");
  if (e.ctrlKey) keys.push("CTRL");
  if (e.altKey) keys.push("ALT");
  if (e.shiftKey) keys.push("SHIFT");
  if (e.key && !IGNORED_KEYS.includes(e.key)) {
    if (SPECIAL_KEYS[e.key]) {
      keys.push(SPECIAL_KEYS[e.key]);
    } else if ((e.keyCode >= 48 && e.keyCode <= 57) || (e.keyCode >= 65 && e.keyCode <= 90)) {
      // Letters and digits: the virtual key code names the key itself, while
      // e.key is the produced character, which Shift/Alt distort (e.g. Alt+Z
      // gives "Ω" on macOS) into names the Photoshop poller never reports
      keys.push(String.fromCharCode(e.keyCode));
    } else {
      keys.push(e.key.toUpperCase());
    }
  }
  return keys;
};

// Same "aWINaCTRLaZa" format as the hotkey poller
const parseHostKeys = (state) => {
  if (!state || typeof state !== "string" || state.indexOf("a") !== 0) return [];
  const keys = state.split("a");
  keys.shift();
  keys.pop();
  return keys.filter((key) => key);
};

const Shortcut = (props) => {
  const hostQueryRef = React.useRef(0);
  // Mirrors the hidden input's value so the keycaps can render reactively
  const [displayKeys, setDisplayKeys] = React.useState(props.value || []);
  const [recording, setRecording] = React.useState(false);

  React.useEffect(() => {
    const input = document.getElementById(`shortcut_${props.index}`);
    if (input) input.value = (props.value || []).join(" + ");
    setDisplayKeys(props.value || []);
  }, [props.index, props.value]);

  const changeShortCut = (e) => {
    e.preventDefault();
    const input = e.target;
    const localKeys = getLocalKeys(e);
    input.value = localKeys.join(" + ");
    setDisplayKeys(localKeys);

    // Shortcuts are matched at runtime against ScriptUI's keyboardState key
    // names, which can differ from browser key names (layout, Alt symbols,
    // function keys). Ask the host what it sees for the held combo and store
    // that, so recording and matching share the same vocabulary.
    const requestId = ++hostQueryRef.current;
    getHotkeyPressed((state) => {
      if (requestId !== hostQueryRef.current) return;
      if (document.activeElement !== input) return;
      const hostKeys = parseHostKeys(state);
      if (!hostKeys.length) return;
      const hostHasMainKey = hostKeys.some((key) => !MODIFIERS.includes(key));
      // The main key may already be released when the host samples the
      // keyboard; fall back to the locally captured name for it
      const keys = hostHasMainKey ? hostKeys : hostKeys.concat(localKeys.filter((key) => !MODIFIERS.includes(key)));
      input.value = keys.join(" + ");
      setDisplayKeys(keys);
    });
  };

  const clearShortcut = () => {
    hostQueryRef.current++;
    const input = document.getElementById(`shortcut_${props.index}`);
    if (input) input.value = "";
    setDisplayKeys([]);
  };

  const label = locale[`shortcut_${props.index}`];
  return (
    <div className="shortcut-row" key={props.index}>
      <div className="shortcut-row-label" title={label}>{label}</div>
      <div className={"shortcut-capture" + (recording ? " m-recording" : "")}>
        <input
          id={`shortcut_${props.index}`}
          defaultValue={(props.value || []).join(" + ")}
          onKeyDown={changeShortCut}
          onFocus={() => setRecording(true)}
          onBlur={() => setRecording(false)}
        />
        <div className="shortcut-keys">
          {displayKeys.length ? (
            displayKeys.map((key, i) => (
              <React.Fragment key={`${key}_${i}`}>
                {i > 0 && <span className="shortcut-plus">+</span>}
                <kbd className="shortcut-key">{keyLabel(key)}</kbd>
              </React.Fragment>
            ))
          ) : (
            <span className="shortcut-empty">
              {recording
                ? locale.shortcutPressKeys || "Press keys..."
                : locale.shortcutNotSet || "Not set"}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        className="topcoat-icon-button--large--quiet shortcut-clear"
        title={locale.delete}
        onClick={clearShortcut}
      >
        <FiX size={14} />
      </button>
    </div>
  );
};

export default Shortcut;
