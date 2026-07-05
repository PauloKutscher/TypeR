import React from "react";
import { FiX } from "react-icons/fi";
import { locale, getHotkeyPressed } from "../../utils";

const MODIFIERS = ["WIN", "CTRL", "ALT", "SHIFT"];
const SPECIAL_KEYS = { "+": "PLUS", "-": "MINUS", "=": "EQUAL", "/": "DIVIDE", "*": "MULTIPLY" };
const IGNORED_KEYS = ["Meta", "Control", "Alt", "Shift", "AltGraph", "CapsLock", "Dead", "Process", "Unidentified"];

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

  React.useEffect(() => {
    const input = document.getElementById(`shortcut_${props.index}`);
    if (input) input.value = (props.value || []).join(" + ");
  }, [props.index, props.value]);

  const changeShortCut = (e) => {
    e.preventDefault();
    const input = e.target;
    const localKeys = getLocalKeys(e);
    input.value = localKeys.join(" + ");

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
    });
  };

  const clearShortcut = () => {
    hostQueryRef.current++;
    const input = document.getElementById(`shortcut_${props.index}`);
    if (input) input.value = "";
  };

  return (
    <React.Fragment key={props.index}>
      <div className="field-mini-label">{locale[`shortcut_${props.index}`]}</div>
      <div className="field-input shortcut-field">
        <input id={`shortcut_${props.index}`} defaultValue={props.value.join(" + ")} onKeyDown={changeShortCut} className="topcoat-textarea" />
        <button type="button" className="topcoat-icon-button--large--quiet" title={locale.delete} onClick={clearShortcut}>
          <FiX size={14} />
        </button>
      </div>
    </React.Fragment>
  );
};

export default Shortcut;
