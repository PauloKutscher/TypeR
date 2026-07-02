import "./stylesBlock.scss";

import React from "react";
import deepClone from "../../deepClone";
import PropTypes from "prop-types";
import { ReactSortable } from "react-sortablejs";
import { FiArrowRightCircle, FiPlus, FiFolderPlus, FiChevronDown, FiChevronUp, FiCopy, FiEye, FiEyeOff, FiMinus } from "react-icons/fi";
import { MdEdit, MdLock } from "react-icons/md";
import { CiExport } from "react-icons/ci";

import config from "../../config";
import { locale, getActiveLayerText, setActiveLayerText, rgbToHex, getStyleObject } from "../../utils";
import { useContext } from "../../context";
import { buildFolderTree } from "../../folderUtils";

const StylesBlock = React.memo(function StylesBlock() {
  const context = useContext();
  const stylesByFolder = React.useMemo(() => {
    const map = new Map();
    (context.state.styles || []).forEach((style) => {
      const key = style.folder || "__unsorted__";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(style);
    });
    return map;
  }, [context.state.styles]);
  const unsortedStyles = stylesByFolder.get("__unsorted__") || [];
  const folderTree = React.useMemo(() => buildFolderTree(context.state.folders), [context.state.folders]);
  const hasContent = context.state.folders.length || context.state.styles.length;
  return (
    <React.Fragment>
      <div className="folders-list">
        {hasContent ? (
          <React.Fragment>
            {unsortedStyles.length > 0 && <FolderItem data={{ name: locale.noFolderTitle }} depth={0} stylesByFolder={stylesByFolder} />}
            <FolderTree folders={folderTree} parentId={null} depth={0} stylesByFolder={stylesByFolder} />
          </React.Fragment>
        ) : (
          <div className="styles-empty">
            <span>{locale.addStylesHint}</span>
          </div>
        )}
      </div>
      <div className="style-add hostBrdTopContrast style-btn-list">
        <button className="topcoat-button--large" onClick={() => context.dispatch({ type: "setModal", modal: "editFolder", data: { create: true } })}>
          <FiFolderPlus size={18} /> {locale.addFolder}
        </button>
        <button className="topcoat-button--large" onClick={() => context.dispatch({ type: "setModal", modal: "editStyle", data: { create: true } })}>
          <FiPlus size={18} /> {locale.addStyle}
        </button>
      </div>
    </React.Fragment>
  );
});

const styleDragMime = "application/x-typer-style-id";
let currentDraggingStyleId = null;

const hasStyleDragData = (event) => {
  return Array.from(event.dataTransfer.types || []).includes(styleDragMime);
};

const getDraggedStyleId = (event) => {
  return currentDraggingStyleId || event.dataTransfer.getData(styleDragMime) || event.dataTransfer.getData("text/plain");
};

const getStyleDropPosition = (event) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
};

const FolderTree = React.memo(function FolderTree({ folders, parentId, depth, stylesByFolder }) {
  const context = useContext();
  if (!folders || !folders.length) return null;
  const handleOrder = React.useCallback(
    (items) => {
      context.dispatch({ type: "reorderFolders", parentId, order: items.map((item) => item.id) });
    },
    [context.dispatch, parentId]
  );
  return (
    <ReactSortable className={"folders-sortable" + (depth > 0 ? " m-nested" : "")} list={folders} setList={handleOrder} animation={150}>
      {folders.map((folder) => (
        <FolderItem key={folder.id} data={folder} depth={depth} stylesByFolder={stylesByFolder} />
      ))}
    </ReactSortable>
  );
});
FolderTree.propTypes = {
  folders: PropTypes.array,
  parentId: PropTypes.oneOfType([PropTypes.string, PropTypes.oneOf([null])]),
  depth: PropTypes.number.isRequired,
  stylesByFolder: PropTypes.object.isRequired,
};

const FolderItem = React.memo(function FolderItem(props) {
  const context = useContext();
  const [dropActive, setDropActive] = React.useState(false);
  const [styleDropTarget, setStyleDropTarget] = React.useState(null);
  const openFolder = React.useCallback((e) => {
    e.stopPropagation();
    context.dispatch({ type: "setModal", modal: "editFolder", data: props.data });
  }, [context.dispatch, props.data]);

  const handleDragOver = React.useCallback((e) => {
    if (!hasStyleDragData(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropActive(true);
  }, []);

  const handleDragLeave = React.useCallback((e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDropActive(false);
  }, []);

  const handleStyleDrop = React.useCallback((e) => {
    if (!hasStyleDragData(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropActive(false);
    setStyleDropTarget(null);
    const styleId = getDraggedStyleId(e);
    if (!styleId) return;
    context.dispatch({ type: "moveStyleToFolder", id: styleId, folderId: props.data.id || null });
  }, [context.dispatch, props.data.id]);

  const styles = props.stylesByFolder.get(props.data.id || "__unsorted__") || [];
  const childFolders = props.data.children || [];

  const getStyleOrder = React.useCallback(
    (draggedStyleId, targetStyleId, position) => {
      const order = styles.map((style) => style.id).filter((id) => id !== draggedStyleId);
      const targetIndex = order.indexOf(targetStyleId);
      if (targetIndex === -1) return order.concat(draggedStyleId);
      order.splice(position === "before" ? targetIndex : targetIndex + 1, 0, draggedStyleId);
      return order;
    },
    [styles]
  );

  const handleStyleItemDragOver = React.useCallback((e, targetStyleId) => {
    if (!hasStyleDragData(e)) return;
    const draggedStyleId = getDraggedStyleId(e);
    if (!draggedStyleId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropActive(true);
    if (draggedStyleId === targetStyleId) {
      setStyleDropTarget(null);
      return;
    }
    setStyleDropTarget({ id: targetStyleId, position: getStyleDropPosition(e) });
  }, []);

  const handleStyleItemDrop = React.useCallback(
    (e, targetStyleId) => {
      if (!hasStyleDragData(e)) return;
      const draggedStyleId = getDraggedStyleId(e);
      if (!draggedStyleId) return;
      e.preventDefault();
      e.stopPropagation();
      if (draggedStyleId === targetStyleId) {
        setDropActive(false);
        setStyleDropTarget(null);
        return;
      }
      const position = getStyleDropPosition(e);
      setDropActive(false);
      setStyleDropTarget(null);
      context.dispatch({
        type: "moveStyleToFolder",
        id: draggedStyleId,
        folderId: props.data.id || null,
        order: getStyleOrder(draggedStyleId, targetStyleId, position),
      });
    },
    [context.dispatch, getStyleOrder, props.data.id]
  );

  const clearStyleDropTarget = React.useCallback(() => {
    setStyleDropTarget(null);
  }, []);

  const exportFolder = React.useCallback((e) => {
    e.stopPropagation();
    const pathSelect = window.cep.fs.showSaveDialogEx(false, false, ["json"], props.data.name + ".json");
    if (!pathSelect?.data) return false;
    const exportedFolder = {};
    exportedFolder.name = props.data.name;
    const exportedStyles = styles.map((style) => ({
      name: style.name,
      textProps: style.textProps,
      prefixes: style.prefixes || [],
      prefixColor: style.prefixColor,
      stroke: style.stroke,
    }));
    exportedFolder.exportedStyles = exportedStyles;
    window.cep.fs.writeFile(pathSelect.data, JSON.stringify(exportedFolder));
  }, [props.data.name, styles]);

  const duplicateFolder = React.useCallback((e) => {
    e.stopPropagation();
    context.dispatch({ type: "duplicateFolder", id: props.data.id });
  }, [context.dispatch, props.data.id]);

  const addSubfolder = React.useCallback((e) => {
    e.stopPropagation();
    context.dispatch({ type: "setModal", modal: "editFolder", data: { create: true, parentId: props.data.id } });
  }, [context.dispatch, props.data.id]);

  const toggleFolder = React.useCallback(() => {
    context.dispatch({ type: "toggleFolder", id: props.data.id });
  }, [context.dispatch, props.data.id]);

  const isUnsorted = !props.data.id;
  const isOpen = props.data.id ? context.state.openFolders.includes(props.data.id) : context.state.openFolders.includes("unsorted");
  const hasActive = context.state.currentStyleId ? !!styles.find((s) => s.id === context.state.currentStyleId) : false;
  return (
    <div
      className={"folder-item hostBrdContrast" + (isOpen ? " m-open" : "") + (props.depth ? " m-nested" : "") + (dropActive ? " m-drop-active" : "")}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleStyleDrop}
    >
      <div className="folder-header" style={{ paddingLeft: props.depth ? props.depth * 12 + 4 : 4 }} onClick={toggleFolder}>
        <div className="folder-marker">{isOpen ? <FiChevronUp size={18} /> : <FiChevronDown size={18} />}</div>
        <div className="folder-title">
          {hasActive ? <strong>{props.data.name}</strong> : <span>{props.data.name}</span>}
          <em className="folder-styles-count">({styles.length})</em>
        </div>
        <div className="folder-actions">
          {props.data.id ? (
            <>
              <button className="topcoat-icon-button--large--quiet" title={locale.addSubfolder || "Add subfolder"} onClick={addSubfolder}>
                <FiFolderPlus size={14} />
              </button>
              <button className="topcoat-icon-button--large--quiet" title={locale.exportFolder} onClick={exportFolder}>
                <CiExport size={14} />
              </button>
              <button className="topcoat-icon-button--large--quiet" title={locale.editFolder} onClick={openFolder}>
                <MdEdit size={14} />
              </button>
              <button className="topcoat-icon-button--large--quiet" title={locale.duplicateFolder} onClick={duplicateFolder}>
                <FiCopy size={14} />
              </button>
            </>
          ) : (
            <MdLock size={18} className="folder-locked" />
          )}
        </div>
      </div>
      {isOpen && (
        <div className="folder-content">
          {!!childFolders.length && props.data.id && (
            <div className="folder-subfolders hostBrdTopContrast">
              <FolderTree folders={childFolders} parentId={props.data.id} depth={props.depth + 1} stylesByFolder={props.stylesByFolder} />
            </div>
          )}
          <div className={"folder-styles hostBrdTopContrast" + (childFolders.length && props.data.id ? " m-with-subfolders" : "")}>
            <div className={"styles-list" + (!styles.length ? " m-empty" : "")}>
              {styles.map((style) => (
                <StyleItem
                  key={style.id}
                  active={context.state.currentStyleId === style.id}
                  dropPosition={styleDropTarget?.id === style.id ? styleDropTarget.position : null}
                  onDragOverStyle={handleStyleItemDragOver}
                  onDropStyle={handleStyleItemDrop}
                  onDragLeaveStyle={clearStyleDropTarget}
                  style={style}
                />
              ))}
              {!styles.length && (
                <div className="folder-styles-empty">
                  <span>{locale.noStylesInFolder}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
FolderItem.propTypes = {
  data: PropTypes.object.isRequired,
  depth: PropTypes.number.isRequired,
  stylesByFolder: PropTypes.object.isRequired,
};

const StyleItem = React.memo(function StyleItem(props) {
  const layerText = props.style.textProps?.layerText || {};
  const textStyle = layerText.textStyleRange?.[0]?.textStyle || {};
  const styleObject = getStyleObject(textStyle);
  const prefixes = props.style.prefixes || [];
  const context = useContext();

  const [quickSizeOverride, setQuickSizeOverride] = React.useState(null);
  const displaySize = quickSizeOverride !== null ? quickSizeOverride : (textStyle.size || "");

  const [quickOpen, setQuickOpen] = React.useState(false);
  const quickCloseTimeout = React.useRef(null);
  const quickWrapRef = React.useRef(null);
  const quickInputRef = React.useRef(null);
  const sizeValue = textStyle.size || "";
  const unit = props.style.textProps?.typeUnit ? props.style.textProps.typeUnit.substr(0, 3) : "px";
  const showQuickStyleSize = context.state.showQuickStyleSize !== false;
  const sizeStep = Number(context.state.styleSizeStep) > 0 ? Number(context.state.styleSizeStep) : 1;
  const sizeStepDecimals = (sizeStep.toString().split(".")[1] || "").length;
  const normalizeSizeStep = (value) => {
    const rounded = Math.round(value / sizeStep) * sizeStep;
    return parseFloat(rounded.toFixed(sizeStepDecimals));
  };

  React.useEffect(() => {
    return () => {
      if (quickCloseTimeout.current) clearTimeout(quickCloseTimeout.current);
    };
  }, []);

  // StyleItem now handles its own select/open dispatch instead of receiving closures as props
  const selectStyle = React.useCallback(() => {
    context.dispatch({ type: "setCurrentStyleId", id: props.style.id });
  }, [context.dispatch, props.style.id]);

  const openStyle = React.useCallback((e) => {
    e.stopPropagation();
    context.dispatch({ type: "setModal", modal: "editStyle", data: props.style });
  }, [context.dispatch, props.style]);

  const insertStyle = React.useCallback((e) => {
    e.stopPropagation();
    const direction = context.state.direction;
    if (e.ctrlKey) {
      getActiveLayerText((data) => {
        const activeTextStyle = data?.textProps?.layerText?.textStyleRange?.[0]?.textStyle;
        if (!activeTextStyle?.size) return;
        const styleWithActiveSize = deepClone(props.style);
        const nextTextStyle = styleWithActiveSize.textProps?.layerText?.textStyleRange?.[0]?.textStyle;
        if (!nextTextStyle) return;
        nextTextStyle.size = activeTextStyle.size;
        setActiveLayerText("", styleWithActiveSize, direction);
      });
    } else {
      setActiveLayerText("", props.style, direction);
    }
  }, [context.state.direction, props.style]);

  const duplicateStyle = React.useCallback((e) => {
    e.stopPropagation();
    context.dispatch({ type: "duplicateStyle", data: props.style });
  }, [context.dispatch, props.style]);

  const togglePrefixes = React.useCallback((e) => {
    e.stopPropagation();
    context.dispatch({ type: "toggleStylePrefixes", id: props.style.id });
  }, [context.dispatch, props.style.id]);

  const openQuickSize = () => {
    if (quickCloseTimeout.current) clearTimeout(quickCloseTimeout.current);
    setQuickOpen(true);
  };
  const scheduleCloseQuickSize = () => {
    if (quickCloseTimeout.current) clearTimeout(quickCloseTimeout.current);
    quickCloseTimeout.current = setTimeout(() => setQuickOpen(false), 150);
    if (quickWrapRef.current && quickWrapRef.current.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  };
  const applyQuickSize = React.useCallback(
    (nextSize) => {
      if (!props.style.textProps?.layerText?.textStyleRange?.length) return;
      const parsed = parseFloat(nextSize);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      const newTextProps = deepClone(props.style.textProps);
      const newStyle = newTextProps.layerText.textStyleRange[0].textStyle;
      newStyle.size = parsed;
      if (newStyle.impliedFontSize != null) newStyle.impliedFontSize = parsed;
      context.dispatch({
        type: "saveStyle",
        data: { ...props.style, textProps: newTextProps, edited: Date.now() },
      });
    },
    [context.dispatch, props.style]
  );
  const stopQuickEvent = (e) => {
    e.stopPropagation();
  };
  const changeQuickSize = (e) => {
    stopQuickEvent(e);
    const value = e.target.value;
    setQuickSizeOverride(value);
    if (value === "") return;
    applyQuickSize(value);
  };
  const nudgeQuickSize = (delta) => (e) => {
    stopQuickEvent(e);
    const baseValue = parseFloat(quickSizeOverride ?? textStyle.size ?? 1);
    const nextValue = Math.max(1, normalizeSizeStep(baseValue + delta * sizeStep));
    setQuickSizeOverride(nextValue);
    applyQuickSize(nextValue);
  };
  const resetQuickSize = () => {
    setQuickSizeOverride(null);
  };
  const startDrag = React.useCallback((e) => {
    currentDraggingStyleId = props.style.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(styleDragMime, props.style.id);
    e.dataTransfer.setData("text/plain", props.style.id);
    const preview = document.createElement("div");
    preview.className = "style-drag-preview";
    const color = document.createElement("span");
    color.className = "style-drag-preview-color";
    color.style.background = rgbToHex(textStyle.color);
    const name = document.createElement("span");
    name.textContent = props.style.name;
    preview.appendChild(color);
    preview.appendChild(name);
    document.body.appendChild(preview);
    e.dataTransfer.setDragImage(preview, 12, 14);
    window.setTimeout(() => {
      if (preview.parentNode) preview.parentNode.removeChild(preview);
    }, 0);
  }, [props.style.id, props.style.name, textStyle.color]);

  const endDrag = React.useCallback(() => {
    currentDraggingStyleId = null;
  }, []);

  const dragOverStyle = React.useCallback(
    (e) => {
      props.onDragOverStyle(e, props.style.id);
    },
    [props.onDragOverStyle, props.style.id]
  );

  const dropStyle = React.useCallback(
    (e) => {
      props.onDropStyle(e, props.style.id);
    },
    [props.onDropStyle, props.style.id]
  );

  return (
    <div
      id={props.style.id}
      className={
        "style-item hostBgdLight" +
        (props.active ? " m-current" : "") +
        (props.style.prefixesDisabled ? " m-disabled" : "") +
        (props.dropPosition ? " m-drop-" + props.dropPosition : "")
      }
      draggable
      onDragStart={startDrag}
      onDragEnd={endDrag}
      onDragOver={dragOverStyle}
      onDragLeave={props.onDragLeaveStyle}
      onDrop={dropStyle}
      onClick={selectStyle}
    >
      <div className="style-marker">
        <div className="style-color" style={{ background: rgbToHex(textStyle.color) }} title={locale.styleTextColor + ": " + rgbToHex(textStyle.color)}></div>
        {!!prefixes.length && (
          <div className="style-prefix-color" title={locale.stylePrefixColor + ": " + (props.style.prefixColor || config.defaultPrefixColor)}>
            <div style={{ background: props.style.prefixColor || config.defaultPrefixColor }}></div>
          </div>
        )}
        {!!prefixes.length && (
          <div className="style-prefix-toggle" onClick={togglePrefixes} title={props.style.prefixesDisabled ? locale.enableStylePrefixes : locale.disableStylePrefixes}>
            {props.style.prefixesDisabled ? <FiEyeOff size={10} /> : <FiEye size={10} />}
          </div>
        )}
      </div>
      <div className="style-name" style={styleObject}>
        <span style={{ fontFamily: styleObject.fontFamily || "Tahoma" }}>{props.style.name}</span>
      </div>
      <div className="style-actions">
        {showQuickStyleSize ? (
          <div
            className={"style-quick-size-wrap" + (quickOpen ? " m-open" : "")}
            ref={quickWrapRef}
            onMouseEnter={openQuickSize}
            onMouseLeave={scheduleCloseQuickSize}
            onFocus={openQuickSize}
            onBlur={scheduleCloseQuickSize}
            onMouseDown={stopQuickEvent}
            onClick={stopQuickEvent}
          >
            <button className={"topcoat-icon-button--large--quiet" + (props.active ? " m-cta" : "")} title={locale.editStyle} onClick={openStyle}>
              <MdEdit size={16} />
            </button>
            {sizeValue !== "" && (
              <span className="style-quick-size-badge" title={locale.editStyleFontSize || "Font size"}>
                {sizeValue}{unit}
              </span>
            )}
            <div className="style-quick-size hostBrdContrast" title={locale.editStyleFontSize || "Font size"} onMouseDown={stopQuickEvent} onClick={stopQuickEvent}>
              <button className="style-quick-size-btn" title={locale.shortcut_decrease || "Decrease text size"} onClick={nudgeQuickSize(-1)}>
                <FiMinus size={12} />
              </button>
              <input
                ref={quickInputRef}
                type="number"
                min={1}
                step={sizeStep}
                value={displaySize}
                onChange={changeQuickSize}
                onBlur={resetQuickSize}
                className="style-quick-size-input"
              />
              <button className="style-quick-size-btn" title={locale.shortcut_increase || "Increase text size"} onClick={nudgeQuickSize(1)}>
                <FiPlus size={12} />
              </button>
            </div>
          </div>
        ) : (
          <button className={"topcoat-icon-button--large--quiet" + (props.active ? " m-cta" : "")} title={locale.editStyle} onClick={openStyle}>
            <MdEdit size={16} />
          </button>
        )}
        <button className={"topcoat-icon-button--large--quiet" + (props.active ? " m-cta" : "")} title={locale.duplicateStyle} onClick={duplicateStyle}>
          <FiCopy size={16} />
        </button>
        <button className={"topcoat-icon-button--large--quiet" + (props.active ? " m-cta" : "")} title={locale.insertStyle} onClick={insertStyle}>
          <FiArrowRightCircle size={16} />
        </button>
      </div>
    </div>
  );
});
StyleItem.propTypes = {
  style: PropTypes.object.isRequired,
  active: PropTypes.bool,
  dropPosition: PropTypes.oneOf(["before", "after"]),
  onDragOverStyle: PropTypes.func.isRequired,
  onDropStyle: PropTypes.func.isRequired,
  onDragLeaveStyle: PropTypes.func.isRequired,
};

export default StylesBlock;
