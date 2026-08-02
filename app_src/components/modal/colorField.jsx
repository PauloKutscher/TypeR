import React from "react";
import { SketchPicker } from "react-color";

import { locale } from "../../utils";
import { toHex } from "../../themeColors";

const DEFAULT_PRESETS = [
  "#ffffff", "#dcf1d1", "#cfe4fb", "#ffe9b3", "#ffd0d0", "#e6d9ff",
  "#1e1e1e", "#2d2d30", "#264f78", "#2d5a27", "#5b8def", "#007acc",
];

// Swatch button opening a color picker popover. Used by the theme customizer
// and by the page line color setting.
const ColorField = React.memo(function ColorField(props) {
  const { label, value, onChange, presetColors, clearable, onClear, disabled } = props;
  const [open, setOpen] = React.useState(false);
  const color = value || "";

  const change = (nextColor) => {
    onChange(toHex(nextColor.hex || nextColor));
  };

  return (
    <div className={"settings-color-field" + (disabled ? " m-disabled" : "")}>
      {label && <span className="settings-color-field-label">{label}</span>}
      <div className="settings-color-field-control">
        <button
          type="button"
          className="settings-color-swatch"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          title={color || (locale.settingsColorPick || "Pick a color")}
        >
          <span
            className={"settings-color-swatch-fill" + (color ? "" : " m-empty")}
            style={color ? { backgroundColor: color } : undefined}
          />
        </button>
        <span className="settings-color-value">{color || (locale.settingsColorDefault || "Default")}</span>
        {clearable && color && (
          <button
            type="button"
            className="settings-color-clear topcoat-button--large"
            onClick={() => {
              setOpen(false);
              onClear();
            }}
          >
            {locale.settingsColorReset || "Reset"}
          </button>
        )}
        {open && (
          <React.Fragment>
            <div className="settings-color-popover-overlay" onClick={() => setOpen(false)} />
            <div className="settings-color-popover">
              <SketchPicker
                disableAlpha={true}
                color={color || "#ffffff"}
                presetColors={presetColors || DEFAULT_PRESETS}
                onChange={change}
              />
            </div>
          </React.Fragment>
        )}
      </div>
    </div>
  );
});

export default ColorField;
