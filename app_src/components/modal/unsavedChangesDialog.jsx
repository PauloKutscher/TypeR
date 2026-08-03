import React from "react";
import { FiAlertTriangle } from "react-icons/fi";

import { locale } from "../../utils";

const UnsavedChangesDialog = React.memo(function UnsavedChangesDialog({ onConfirm, onCancel }) {
  const cancelButtonRef = React.useRef(null);

  React.useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    cancelButtonRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  return (
    <div
      className="settings-confirm-overlay unsaved-changes-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-changes-title"
      onClick={onCancel}
    >
      <div
        className="settings-confirm-dialog hostBgdLight"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-confirm-icon">
          <FiAlertTriangle size={26} />
        </div>
        <div id="unsaved-changes-title" className="settings-confirm-title">
          {locale.settingsUnsavedChanges || "Unsaved changes"}
        </div>
        <div className="settings-confirm-text">
          {locale.unsavedChangesMessage || "You have unsaved changes. If you close this window, they will be lost."}
        </div>
        <div className="settings-confirm-actions">
          <button ref={cancelButtonRef} type="button" className="topcoat-button--large" onClick={onCancel}>
            {locale.cancel || "Cancel"}
          </button>
          <button
            type="button"
            className="topcoat-button--large--cta settings-confirm-danger"
            onClick={onConfirm}
          >
            {locale.unsavedChangesConfirm || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
});

export default UnsavedChangesDialog;
