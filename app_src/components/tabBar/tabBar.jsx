import "./tabBar.scss";

import React from "react";
import { FiPlus, FiX } from "react-icons/fi";

import { locale } from "../../utils";
import { useContext } from "../../context";

const TabBar = React.memo(function TabBar() {
  const context = useContext();
  const tabs = context.state.tabs || [];
  const currentTabId = context.state.currentTabId;
  const [editingId, setEditingId] = React.useState(null);
  const [editingName, setEditingName] = React.useState("");
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startRename = (tab) => {
    setEditingId(tab.id);
    setEditingName(tab.name);
  };

  const commitRename = () => {
    if (editingId) {
      context.dispatch({ type: "renameTab", id: editingId, name: editingName });
    }
    setEditingId(null);
  };

  const handleRenameKeyDown = (e) => {
    if (e.key === "Enter") commitRename();
    else if (e.key === "Escape") setEditingId(null);
  };

  const selectTab = (tab) => {
    if (tab.id !== currentTabId) {
      context.dispatch({ type: "switchTab", id: tab.id });
    }
  };

  const closeTab = (e, tab) => {
    e.stopPropagation();
    const hasContent = (tab.text || "").trim() || (tab.images || []).length;
    if (hasContent && !confirm(locale.tabCloseConfirm || "Close this tab? Its text and PSD sync will be lost.")) {
      return;
    }
    context.dispatch({ type: "deleteTab", id: tab.id });
  };

  const addTab = () => context.dispatch({ type: "addTab" });

  if (context.state.multiTabEnabled === false) return null;

  return (
    <div className="tab-bar hostBgdDark">
      <div className="tab-bar-list">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={"tab-bar-tab" + (tab.id === currentTabId ? " m-active hostBgdLight" : "")}
            onClick={() => selectTab(tab)}
            onDoubleClick={() => startRename(tab)}
            title={locale.tabRenameHint || "Double-click to rename"}
          >
            {(tab.images || []).length ? (
              <span className="tab-bar-sync-dot" title={locale.tabSynced || "PSDs are synced to this tab"} />
            ) : null}
            {editingId === tab.id ? (
              <input
                ref={inputRef}
                className="tab-bar-rename-input"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={handleRenameKeyDown}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="tab-bar-name">{tab.name}</span>
            )}
            {tabs.length > 1 && (
              <span className="tab-bar-close" title={locale.tabClose || "Close tab"} onClick={(e) => closeTab(e, tab)}>
                <FiX size={11} />
              </span>
            )}
          </div>
        ))}
        <button type="button" className="tab-bar-add" title={locale.tabAdd || "New tab"} onClick={addTab}>
          <FiPlus size={12} />
        </button>
      </div>
    </div>
  );
});

export default TabBar;
