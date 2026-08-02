import React from "react";
import { FiX } from "react-icons/fi";

import ColorField from "./colorField";
import { locale } from "../../utils";
import { CUSTOM_THEME_KEYS } from "../../themeColors";
import { normalizeCustomTheme } from "../../themePresets";

// Inline editor for a user-made theme. Only the key colors are exposed: the
// rest of the palette (borders, muted text, gutters…) is derived from them so
// a custom theme keeps the same internal consistency as the built-in presets.
const ThemeEditor = React.memo(function ThemeEditor(props) {
  const { theme, onChange, onClose } = props;
  const colors = theme.colors;

  const update = (patch) => onChange(normalizeCustomTheme({ ...theme, ...patch }));
  const changeKey = (id) => (color) => update({ keys: { ...theme.keys, [id]: color } });

  return (
    <div className="settings-theme-editor">
      <div className="settings-theme-editor-head">
        <input
          type="text"
          className="topcoat-text-input--large"
          value={theme.label}
          maxLength={32}
          placeholder={locale.settingsThemeName || "Theme name"}
          onChange={(e) => update({ label: e.target.value })}
        />
        <div className="settings-theme-editor-modes">
          {["dark", "light"].map((mode) => (
            <button
              type="button"
              key={mode}
              className={"topcoat-button--large" + (theme.mode === mode ? " m-active" : "")}
              onClick={() => update({ mode })}
            >
              {mode === "dark"
                ? locale.settingsThemeModeDark || "Dark"
                : locale.settingsThemeModeLight || "Light"}
            </button>
          ))}
        </div>
        <button type="button" className="settings-theme-editor-close" onClick={onClose} title={locale.close || "Close"}>
          <FiX size={16} />
        </button>
      </div>

      <div className="settings-theme-editor-body">
        <div className="settings-theme-editor-colors">
          {CUSTOM_THEME_KEYS.map((key) => (
            <ColorField
              key={key.id}
              label={locale[key.label] || key.fallback}
              value={theme.keys[key.id]}
              onChange={changeKey(key.id)}
            />
          ))}
        </div>

        <div className="settings-theme-editor-preview" style={{ backgroundColor: colors.surface }}>
          <div className="settings-theme-editor-preview-bar" style={{ backgroundColor: colors.panel, borderColor: colors.border }}>
            <i style={{ backgroundColor: colors.accent }} />
            <i style={{ backgroundColor: colors.muted }} />
            <i style={{ backgroundColor: colors.muted }} />
          </div>
          <div className="settings-theme-editor-preview-code" style={{ backgroundColor: colors.codeBg }}>
            <div className="settings-theme-editor-preview-row" style={{ backgroundColor: colors.codeCurrent }}>
              <span style={{ backgroundColor: colors.codeCurrentText }} />
            </div>
            <div className="settings-theme-editor-preview-row">
              <span style={{ backgroundColor: colors.codeText }} />
            </div>
            <div className="settings-theme-editor-preview-row" style={{ backgroundColor: colors.codePage }}>
              <span style={{ backgroundColor: colors.codeMuted }} />
            </div>
            <div className="settings-theme-editor-preview-row">
              <span style={{ backgroundColor: colors.codeMuted }} />
            </div>
          </div>
          <div className="settings-theme-editor-preview-foot">
            <span className="m-pill" style={{ backgroundColor: colors.accent, color: colors.accentText }}>
              {locale.settingsThemePreview || "Preview"}
            </span>
            <span className="m-input" style={{ backgroundColor: colors.input, borderColor: colors.borderStrong }} />
          </div>
        </div>
      </div>
    </div>
  );
});

export default ThemeEditor;
