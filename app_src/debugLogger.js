// Runtime debug logger for TypeR. When enabled it traces every ExtendScript
// call sent to Photoshop (function, payload, duration, result), every
// Photoshop event received by the panel, and every app state action, into
// typer_debug.log next to the extension storage file. Toggled from the
// settings "Data" tab; everything is a no-op while disabled.

const MAX_VALUE_PREVIEW = 600;
const FLUSH_DELAY = 300;
const MAX_LOG_SIZE = 5 * 1024 * 1024;
// Fallback cap when Node fs is unavailable and the whole session log has to
// be kept in memory and rewritten through cep.fs
const MAX_MEMORY_LINES = 5000;

// Polled host functions fire several times per second and would flood the
// log: their call side is skipped and their result is only written when it
// differs from the previous one
const POLLED_FUNCTIONS = {
  getHotkeyPressed: true,
  getSelectionChanged: true,
};

const state = {
  enabled: false,
  installed: false,
  csInterface: null,
  extensionPath: null,
  logPath: null,
  nodeFs: null,
  pendingLines: [],
  flushTimer: null,
  memoryLines: [],
  callSeq: 0,
  lastPollResults: {},
};

const pad = (num, size) => String(num).padStart(size, "0");

const timestamp = () => {
  const d = new Date();
  return (
    pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2) + ":" +
    pad(d.getSeconds(), 2) + "." + pad(d.getMilliseconds(), 3)
  );
};

// One-line, size-capped rendering of any payload or result
const preview = (value) => {
  let text;
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch (e) {
      text = String(value);
    }
  }
  text = String(text).replace(/[\r\n]+/g, "\\n");
  if (text.length > MAX_VALUE_PREVIEW) {
    text = text.slice(0, MAX_VALUE_PREVIEW) + "… (+" + (text.length - MAX_VALUE_PREVIEW) + " chars)";
  }
  return text;
};

const flush = () => {
  if (state.flushTimer) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
  if (!state.pendingLines.length || !state.logPath) return;
  const lines = state.pendingLines;
  state.pendingLines = [];
  const chunk = lines.join("\n") + "\n";
  if (state.nodeFs) {
    try {
      state.nodeFs.appendFileSync(state.logPath, chunk);
      return;
    } catch (e) {
      // Fall through to the cep.fs full-rewrite path
    }
  }
  Array.prototype.push.apply(state.memoryLines, lines);
  if (state.memoryLines.length > MAX_MEMORY_LINES) {
    state.memoryLines.splice(0, state.memoryLines.length - MAX_MEMORY_LINES);
  }
  try {
    window.cep.fs.writeFile(state.logPath, state.memoryLines.join("\n") + "\n");
  } catch (e) {
    // Logging must never break the panel
  }
};

const writeLine = (category, message) => {
  if (!state.logPath) return;
  const line = "[" + timestamp() + "] [" + category + "] " + message;
  if (window.console && console.log) console.log("[TypeR debug]", line);
  state.pendingLines.push(line);
  if (!state.flushTimer) state.flushTimer = setTimeout(flush, FLUSH_DELAY);
};

// Prevent the file from growing forever across sessions: keep one rotated
// copy and start fresh past the size cap
const rotateIfHuge = () => {
  if (!state.nodeFs || !state.logPath) return;
  try {
    const stats = state.nodeFs.statSync(state.logPath);
    if (stats.size > MAX_LOG_SIZE) {
      const backupPath = state.logPath + ".1";
      try {
        state.nodeFs.unlinkSync(backupPath);
      } catch (e) {}
      state.nodeFs.renameSync(state.logPath, backupPath);
    }
  } catch (e) {
    // Missing file or fs error: nothing to rotate
  }
};

const installHooks = () => {
  if (state.installed || !state.csInterface) return;
  state.installed = true;
  const cs = state.csInterface;

  // Every Photoshop action goes through evalScript, so wrapping it captures
  // the full panel <-> host traffic without touching individual call sites
  const originalEvalScript = cs.evalScript.bind(cs);
  cs.evalScript = (script, callback) => {
    if (!state.enabled) return originalEvalScript(script, callback);
    const text = String(script);
    const parenIndex = text.indexOf("(");
    const name = (parenIndex === -1 ? text : text.slice(0, parenIndex)).trim();
    const isPolled = POLLED_FUNCTIONS[name] === true;
    const id = ++state.callSeq;
    const startTime = Date.now();
    if (!isPolled) {
      const args = parenIndex === -1 ? "" : " " + preview(text.slice(parenIndex));
      writeLine("host-call", "#" + id + " " + name + args);
    }
    return originalEvalScript(text, (result) => {
      const elapsed = Date.now() - startTime;
      if (isPolled) {
        const resultKey = typeof result === "string" ? result : preview(result);
        if (state.lastPollResults[name] !== resultKey) {
          state.lastPollResults[name] = resultKey;
          writeLine("host-poll", name + " -> " + preview(result) + " (" + elapsed + "ms)");
        }
      } else {
        writeLine("host-result", "#" + id + " " + name + " -> " + preview(result) + " (" + elapsed + "ms)");
      }
      if (typeof callback === "function") callback(result);
    });
  };

  const originalDispatchEvent = cs.dispatchEvent.bind(cs);
  cs.dispatchEvent = (event) => {
    if (state.enabled && event) {
      writeLine("cep-event", "dispatch " + event.type + (event.data ? " " + preview(event.data) : ""));
    }
    return originalDispatchEvent(event);
  };

  if (window.addEventListener) {
    window.addEventListener("beforeunload", flush);
  }
};

const initDebugLogger = (csInterface, extensionPath) => {
  state.csInterface = csInterface;
  state.extensionPath = extensionPath;
  state.logPath = extensionPath + "/typer_debug.log";
  try {
    const nodeRequire =
      (window.cep_node && window.cep_node.require) ||
      (typeof window.require === "function" ? window.require : null);
    if (nodeRequire) state.nodeFs = nodeRequire("fs");
  } catch (e) {
    state.nodeFs = null;
  }
  installHooks();
};

const setDebugLoggerEnabled = (value) => {
  const next = value === true;
  if (next === state.enabled) return;
  if (next) {
    rotateIfHuge();
    state.enabled = true;
    writeLine("logger", "=== TypeR debug logging enabled ===");
    writeLine("logger", "log file: " + state.logPath + (state.nodeFs ? " (append mode)" : " (cep.fs rewrite mode, last " + MAX_MEMORY_LINES + " lines)"));
  } else {
    writeLine("logger", "=== TypeR debug logging disabled ===");
    state.enabled = false;
    flush();
  }
};

const isDebugLoggerEnabled = () => state.enabled;

// General-purpose entry point for app code (state actions, PS events, ...)
const debugLog = (category, message, data) => {
  if (!state.enabled) return;
  writeLine(category, data !== undefined ? message + " " + preview(data) : message);
};

const getDebugLogPath = () => state.logPath;

const clearDebugLog = () => {
  state.pendingLines = [];
  state.memoryLines = [];
  state.lastPollResults = {};
  try {
    if (state.nodeFs) {
      state.nodeFs.writeFileSync(state.logPath, "");
    } else {
      window.cep.fs.writeFile(state.logPath, "");
    }
    if (state.enabled) writeLine("logger", "=== log cleared ===");
    return true;
  } catch (e) {
    return false;
  }
};

// Opens the extension folder in Explorer/Finder so the log file is one click
// away (openFolder is already provided by host.jsx for the updater)
const revealDebugLog = () => {
  flush();
  if (!state.csInterface || !state.extensionPath) return;
  state.csInterface.evalScript("openFolder(" + JSON.stringify(String(state.extensionPath)) + ")");
};

export {
  initDebugLogger,
  setDebugLoggerEnabled,
  isDebugLoggerEnabled,
  debugLog,
  getDebugLogPath,
  clearDebugLog,
  revealDebugLog,
};
