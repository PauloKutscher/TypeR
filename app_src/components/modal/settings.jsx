import React from "react";
import { FiX, FiSettings, FiEye, FiEyeOff, FiToggleLeft, FiDatabase, FiAlertTriangle, FiChevronUp, FiChevronDown, FiRotateCcw, FiCheck, FiPlayCircle } from "react-icons/fi";
import { MdSave } from "react-icons/md";
import { FaKeyboard, FaFileExport, FaFileImport } from "react-icons/fa";

import config from "../../config";
import { locale, nativeAlert, nativeConfirm, checkUpdate, readStorage, writeToStorage, deleteStorageFile, openFile } from "../../utils";
import { clearDebugLog, revealDebugLog } from "../../debugLogger";
import { useContext, defaultUiLayout, normalizeUiLayout } from "../../context";
import { EDITOR_THEME_PRESETS, getEditorThemePreviewColors } from "../../themePresets";
import Shortcut from "./shortCut";
import FontScanPromo from "./fontScanPromo";

const SettingsModal = React.memo(function SettingsModal() {
  const context = useContext();
  const [activeTab, setActiveTab] = React.useState("general");
  const [pastePointText, setPastePointText] = React.useState(context.state.pastePointText ? "1" : "");
  const [ignoreLinePrefixes, setIgnoreLinePrefixes] = React.useState(
    context.state.ignoreLinePrefixes.join("\n")
  );
  const [ignoreTags, setIgnoreTags] = React.useState(
    (context.state.ignoreTags || []).join("\n")
  );
  const [defaultStyleId, setDefaultStyleId] = React.useState(context.state.defaultStyleId || "");
  const [language, setLanguage] = React.useState(context.state.language || "auto");
  const [direction, setDirection] = React.useState(context.state.direction || "ltr");
  const [middleEast, setMiddleEast] = React.useState(!!context.state.middleEast);
  const [autoClosePSD, setAutoClosePSD] = React.useState(
    !!context.state.autoClosePSD
  );
  const [autoScrollStyle, setAutoScrollStyle] = React.useState(
    context.state.autoScrollStyle !== false
  );
  const [currentFolderTagPriority, setCurrentFolderTagPriority] = React.useState(
    context.state.currentFolderTagPriority !== false
  );
  const [resizeTextBoxOnCenter, setResizeTextBoxOnCenter] = React.useState(
    !!context.state.resizeTextBoxOnCenter
  );
  const [checkUpdates, setCheckUpdates] = React.useState(
    context.state.checkUpdates !== false
  );
  const [multiBubbleMode, setMultiBubbleMode] = React.useState(
    !!context.state.multiBubbleMode
  );
  const [showTips, setShowTips] = React.useState(
    context.state.showTips !== false
  );
  const [showQuickStyleSize, setShowQuickStyleSize] = React.useState(
    context.state.showQuickStyleSize !== false
  );
  const [inlineTextShapeR, setInlineTextShapeR] = React.useState(
    context.state.inlineTextShapeR === true
  );
  const [dehyphenateTextShapeR, setDehyphenateTextShapeR] = React.useState(
    context.state.dehyphenateTextShapeR === true
  );
  const [styleSizeStep, setStyleSizeStep] = React.useState(
    context.state.styleSizeStep !== undefined ? String(context.state.styleSizeStep) : "1"
  );
  const [internalPadding, setInternalPadding] = React.useState(
    context.state.internalPadding !== undefined ? context.state.internalPadding : 10
  );
  const [interpretMarkdown, setInterpretMarkdown] = React.useState(
    context.state.interpretMarkdown !== false
  );
  const [resetLineCounterOnPage, setResetLineCounterOnPage] = React.useState(
    context.state.resetLineCounterOnPage !== false
  );
  const [multiTabEnabled, setMultiTabEnabled] = React.useState(
    context.state.multiTabEnabled !== false
  );
  const [editorTheme, setEditorTheme] = React.useState(context.state.editorTheme || "system");
  const [debugLogger, setDebugLogger] = React.useState(context.state.debugLogger === true);
  const [multiTabConfirmOpen, setMultiTabConfirmOpen] = React.useState(false);
  const [edited, setEdited] = React.useState(false);

  // Interface layout editor (appearance tab)
  const [uiLayout, setUiLayoutLocal] = React.useState(() => normalizeUiLayout(context.state.uiLayout));
  const [previewHeight, setPreviewHeight] = React.useState(
    String(normalizeUiLayout(context.state.uiLayout).sizes.previewHeight)
  );
  const [uiScale, setUiScale] = React.useState(
    String(normalizeUiLayout(context.state.uiLayout).sizes.uiScale)
  );
  const [stylesHeight, setStylesHeight] = React.useState(
    String(readStorage("bottomHeight") || 70)
  );
  const initialStylesHeight = React.useRef(String(readStorage("bottomHeight") || 70));

  // States manager
  const [stateName, setStateName] = React.useState("");
  const [savedStates, setSavedStates] = React.useState(() => readStorage("states") || {});
  const [selectedState, setSelectedState] = React.useState("");
  const [showDeleteStates, setShowDeleteStates] = React.useState(false);
  const [statesToDelete, setStatesToDelete] = React.useState({});

  const close = () => {
    context.dispatch({ type: "setModal" });
  };

  const changePastePointText = (e) => {
    setPastePointText(e.target.value);
    setEdited(true);
  };

  const changeLinePrefixes = (e) => {
    setIgnoreLinePrefixes(e.target.value);
    setEdited(true);
  };

  const changeIgnoreTags = (e) => {
    setIgnoreTags(e.target.value);
    setEdited(true);
  };

  const changeDefaultStyle = (e) => {
    setDefaultStyleId(e.target.value);
    setEdited(true);
  };

  const changeLanguage = (e) => {
    setLanguage(e.target.value);
    setEdited(true);
  };

  const changeDirection = (e) => {
    setDirection(e.target.value);
    setEdited(true);
  };

  const changeMiddleEast = (e) => {
    const val = e.target.checked;
    setMiddleEast(val);
    context.dispatch({ type: "setMiddleEast", value: val });
    setEdited(true);
  };

  const changeAutoClosePSD = (e) => {
    setAutoClosePSD(e.target.checked);
    setEdited(true);
  };
  const changeAutoScrollStyle = (e) => {
    setAutoScrollStyle(e.target.checked);
    setEdited(true);
  };
  const changeCurrentFolderTagPriority = (e) => {
    setCurrentFolderTagPriority(e.target.checked);
    setEdited(true);
  };
  const changeShowQuickStyleSize = (e) => {
    setShowQuickStyleSize(e.target.checked);
    setEdited(true);
  };

  const changeInlineTextShapeR = (e) => {
    setInlineTextShapeR(e.target.checked);
    setEdited(true);
  };
  const changeStyleSizeStep = (e) => {
    const value = e.target.value;
    if (value === "") {
      setStyleSizeStep("");
      setEdited(true);
      return;
    }
    const normalized = value.replace(",", ".");
    if (!isNaN(normalized) && isFinite(parseFloat(normalized))) {
      setStyleSizeStep(normalized);
      setEdited(true);
    }
  };
  const resetStyleSizeStep = () => {
    if (styleSizeStep === "") {
      setStyleSizeStep(String(context.state.styleSizeStep ?? 1));
    }
  };

  const changeResizeTextBoxOnCenter = (e) => {
    setResizeTextBoxOnCenter(e.target.checked);
    setEdited(true);
  };

  const changeCheckUpdates = (e) => {
    setCheckUpdates(e.target.checked);
    setEdited(true);
  };

  const changeMultiBubbleMode = (e) => {
    setMultiBubbleMode(e.target.checked);
    setEdited(true);
  };

  const changeShowTips = (e) => {
    setShowTips(e.target.checked);
    setEdited(true);
  };

  const changeDehyphenateTextShapeR = (e) => {
    setDehyphenateTextShapeR(e.target.checked);
    setEdited(true);
  };

  const changeInternalPadding = (e) => {
    const value = e.target.value;
    // Allow empty string or valid numbers
    if (value === "" || (!isNaN(value) && !isNaN(parseFloat(value)))) {
      setInternalPadding(value);
      setEdited(true);
    }
  };

  const changeInterpretMarkdown = (e) => {
    setInterpretMarkdown(e.target.checked);
    setEdited(true);
  };

  const changeMultiTabEnabled = (e) => {
    setMultiTabEnabled(e.target.checked);
    setEdited(true);
  };

  const changeResetLineCounterOnPage = (e) => {
    setResetLineCounterOnPage(e.target.checked);
    setEdited(true);
  };

  const changeEditorTheme = (theme) => {
    setEditorTheme(theme);
    setEdited(true);
  };

  const changeDebugLogger = (e) => {
    setDebugLogger(e.target.checked);
    setEdited(true);
  };

  const clearDebugLogFile = () => {
    const success = clearDebugLog();
    nativeAlert(
      success
        ? locale.settingsDebugLogClearSuccess || "Debug log cleared."
        : locale.settingsDebugLogClearError || "Unable to clear the debug log.",
      success ? locale.successTitle : locale.errorTitle,
      !success
    );
  };

  const toggleUiElement = (key) => {
    setUiLayoutLocal((current) => normalizeUiLayout({
      ...current,
      visible: { ...current.visible, [key]: current.visible[key] === false },
    }));
    setEdited(true);
  };

  const moveUiBlock = (id, direction) => {
    setUiLayoutLocal((current) => {
      const index = current.order.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.order.length) return current;
      const order = current.order.concat([]);
      order[index] = order[target];
      order[target] = id;
      return { ...current, order };
    });
    setEdited(true);
  };

  const changeUiSize = (setter) => (e) => {
    const value = e.target.value;
    if (value === "" || /^[0-9]+$/.test(value)) {
      setter(value);
      setEdited(true);
    }
  };

  const resetUiLayout = () => {
    setUiLayoutLocal(normalizeUiLayout(null));
    setPreviewHeight(String(defaultUiLayout.sizes.previewHeight));
    setUiScale(String(defaultUiLayout.sizes.uiScale));
    setStylesHeight("70");
    setEdited(true);
  };

  const buildUiLayoutToSave = () => normalizeUiLayout({
    ...uiLayout,
    sizes: {
      previewHeight: previewHeight === "" ? defaultUiLayout.sizes.previewHeight : previewHeight,
      uiScale: uiScale === "" ? defaultUiLayout.sizes.uiScale : uiScale,
    },
  });

  const save = (e) => {
    e.preventDefault();
    // Disabling multi-tab with several open tabs needs an in-app confirmation
    if (
      !multiTabEnabled &&
      context.state.multiTabEnabled !== false &&
      (context.state.tabs || []).length > 1
    ) {
      setMultiTabConfirmOpen(true);
      return;
    }
    applySave();
  };

  const confirmDisableMultiTab = () => {
    setMultiTabConfirmOpen(false);
    applySave();
  };

  const cancelDisableMultiTab = () => {
    setMultiTabEnabled(true);
    setMultiTabConfirmOpen(false);
  };

  const applySave = () => {
    if (pastePointText !== context.state.pastePointText) {
      context.dispatch({
        type: "setPastePointText",
        isPoint: !!pastePointText,
      });
    }
    if (ignoreLinePrefixes !== context.state.ignoreLinePrefixes.join("\n")) {
      context.dispatch({
        type: "setIgnoreLinePrefixes",
        data: ignoreLinePrefixes,
      });
    }
    if (ignoreTags !== (context.state.ignoreTags || []).join("\n")) {
      context.dispatch({
        type: "setIgnoreTags",
        data: ignoreTags,
      });
    }
    if (defaultStyleId !== context.state.defaultStyleId) {
      context.dispatch({
        type: "setDefaultStyleId",
        id: defaultStyleId,
      });
    }
    if (language !== context.state.language) {
      context.dispatch({
        type: "setLanguage",
        lang: language,
      });
      setTimeout(() => window.location.reload(), 100);
    }
    if (direction !== context.state.direction) {
      context.dispatch({
        type: "setDirection",
        direction,
      });
    }
    if (middleEast !== context.state.middleEast) {
      context.dispatch({
        type: "setMiddleEast",
        value: middleEast,
      });
    }
    if (autoClosePSD !== context.state.autoClosePSD) {
      context.dispatch({
        type: "setAutoClosePSD",
        value: autoClosePSD,
      });
    }

    if (autoScrollStyle !== context.state.autoScrollStyle) {
      context.dispatch({
        type: "setAutoScrollStyle",
        value: autoScrollStyle,
      });
    }
    if (currentFolderTagPriority !== context.state.currentFolderTagPriority) {
      context.dispatch({
        type: "setCurrentFolderTagPriority",
        value: currentFolderTagPriority,
      });
    }
    if (resizeTextBoxOnCenter !== context.state.resizeTextBoxOnCenter) {
      context.dispatch({
        type: "setResizeTextBoxOnCenter",
        value: resizeTextBoxOnCenter,
      });
    }
    if (checkUpdates !== context.state.checkUpdates) {
      context.dispatch({
        type: "setCheckUpdates",
        value: checkUpdates,
      });
    }
    if (multiBubbleMode !== context.state.multiBubbleMode) {
      context.dispatch({
        type: "setMultiBubbleMode",
        value: multiBubbleMode,
      });
    }
    if (showTips !== context.state.showTips) {
      context.dispatch({
        type: "setShowTips",
        value: showTips,
      });
    }
    if (showQuickStyleSize !== context.state.showQuickStyleSize) {
      context.dispatch({
        type: "setShowQuickStyleSize",
        value: showQuickStyleSize,
      });
    }
    if (inlineTextShapeR !== context.state.inlineTextShapeR) {
      context.dispatch({
        type: "setInlineTextShapeR",
        value: inlineTextShapeR,
      });
    }
    if (dehyphenateTextShapeR !== context.state.dehyphenateTextShapeR) {
      context.dispatch({
        type: "setDehyphenateTextShapeR",
        value: dehyphenateTextShapeR,
      });
    }
    const parsedStyleSizeStep = parseFloat(String(styleSizeStep).replace(",", "."));
    if (
      Number.isFinite(parsedStyleSizeStep) &&
      parsedStyleSizeStep > 0 &&
      parsedStyleSizeStep !== context.state.styleSizeStep
    ) {
      context.dispatch({
        type: "setStyleSizeStep",
        step: parsedStyleSizeStep,
      });
    }
    if (internalPadding !== context.state.internalPadding) {
      context.dispatch({
        type: "setInternalPadding",
        value: internalPadding,
      });
    }
    if (interpretMarkdown !== context.state.interpretMarkdown) {
      context.dispatch({
        type: "setInterpretMarkdown",
        value: interpretMarkdown,
      });
    }
    if (resetLineCounterOnPage !== context.state.resetLineCounterOnPage) {
      context.dispatch({
        type: "setResetLineCounterOnPage",
        value: resetLineCounterOnPage,
      });
    }
    if (multiTabEnabled !== (context.state.multiTabEnabled !== false)) {
      context.dispatch({ type: "setMultiTabEnabled", value: multiTabEnabled });
    }
    if (editorTheme !== context.state.editorTheme) {
      context.dispatch({ type: "setEditorTheme", theme: editorTheme });
    }
    if (debugLogger !== (context.state.debugLogger === true)) {
      context.dispatch({ type: "setDebugLogger", value: debugLogger });
    }
    const layoutToSave = buildUiLayoutToSave();
    if (JSON.stringify(layoutToSave) !== JSON.stringify(normalizeUiLayout(context.state.uiLayout))) {
      context.dispatch({ type: "setUiLayout", layout: layoutToSave });
    }
    if (stylesHeight !== initialStylesHeight.current && stylesHeight !== "") {
      const parsedStylesHeight = Math.min(500, Math.max(70, parseInt(stylesHeight, 10) || 70));
      writeToStorage({ bottomHeight: parsedStylesHeight });
      // The styles block height is applied imperatively by the resize logic
      setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    }
    const shortcut = {};
    document.querySelectorAll("input[id^=shortcut_]").forEach((input) => {
      const typeShorcut = input.id.split("_").pop();
      const value = input.value.trim();
      if (value) {
        shortcut[typeShorcut] = value.split(" + ");
      } else {
        shortcut[typeShorcut] = [];
      }
    });
    context.dispatch({
      type: "updateShortcut",
      shortcut: shortcut,
    });

    context.dispatch({ type: "setModal" });
  };

  const importSettings = () => {
    const pathSelect = window.cep.fs.showOpenDialogEx(true, false, null, null, ["json"]);
    if (!pathSelect?.data?.length) return false;
    let foldersImported = 0;
    pathSelect.data.forEach((path) => {
      const result = window.cep.fs.readFile(path);
      if (result.err) {
        nativeAlert(locale.errorImportStyles, locale.errorTitle, true);
      } else {
        try {
          const data = JSON.parse(result.data);
          if (data.exportedStyles) {
            const folderId = Math.random().toString(36).substring(2, 8);
            const importedAt = Date.now();
            const dataFolder = { id: folderId, name: data.name };
            const styles = data.exportedStyles.map((style) => ({
                name: style.name,
                id: Math.random().toString(36).substring(2, 8),
                folder: folderId,
                textProps: style.textProps,
                prefixes: style.prefixes || [],
                prefixColor: style.prefixColor,
                stroke: style.stroke,
                edited: importedAt,
            }));
            context.dispatch({ type: "importStyleFolder", folder: dataFolder, styles });
            foldersImported++;
          } else if (
            data.folders &&
            data.styles &&
            !data.ignoreLinePrefixes &&
            !data.ignoreTags &&
            !data.defaultStyleId &&
            !data.language &&
            !data.autoClosePSD &&
            !data.autoScrollStyle &&
            !data.textItemKind
          ) {
            const idMap = {};
            const foldersWithNewIds = data.folders.map((folder) => {
              const newId = Math.random().toString(36).substring(2, 8);
              idMap[folder.id] = newId;
              return { folder, newId };
            });
            const folders = foldersWithNewIds.map(({ folder, newId }) => ({
              id: newId,
              name: folder.name,
              parentId: folder.parentId ? idMap[folder.parentId] || null : null,
              order: typeof folder.order === "number" ? folder.order : undefined,
            }));
            const importedAt = Date.now();
            const styles = data.styles.map((style) => ({
              id: Math.random().toString(36).substring(2, 8),
              name: style.name,
              folder: style.folder ? idMap[style.folder] : null,
              textProps: style.textProps,
              prefixes: style.prefixes || [],
              prefixColor: style.prefixColor,
              stroke: style.stroke,
              edited: importedAt,
            }));
            context.dispatch({ type: "importStyleLibrary", folders, styles });
            foldersImported += folders.length;
          } else {
            context.dispatch({ type: "import", data });
            setTimeout(() => window.location.reload(), 100);
            close();
          }
        } catch (error) {
          nativeAlert(locale.errorImportStyles, locale.errorTitle, true);
        }
      }
    });
    if (foldersImported > 0) {
      nativeAlert(
        foldersImported > 1
          ? locale.importFoldersSuccess
          : locale.importFolderSuccess,
        locale.successTitle,
        false
      );
    }
  };

  const exportSettings = () => {
    context.dispatch({ type: "setModal", modal: "export" });
  };

  const openWalkthrough = () => {
    context.dispatch({ type: "setModal", modal: "walkthrough", data: { source: "settings" } });
  };

  const checkUpdatesNow = () => {
    checkUpdate(config.appVersion).then((data) => {
      if (data) {
        context.dispatch({ type: "setModal", modal: "update", data });
      } else {
        nativeAlert(locale.updateNoUpdate, locale.successTitle, false);
      }
    });
  };

  const resetStorage = () => {
    nativeConfirm(
      locale.settingsResetStorageConfirm || "Delete the storage file and reset all settings?",
      locale.confirmTitle || "Confirmation",
      (confirmed) => {
        if (!confirmed) return;
        const success = deleteStorageFile();
        if (success) {
          nativeAlert(
            locale.settingsResetStorageSuccess || "Storage deleted. The panel will reload.",
            locale.successTitle,
            false
          );
          setTimeout(() => window.location.reload(), 300);
        } else {
          nativeAlert(
            locale.settingsResetStorageError || "Unable to delete the storage file.",
            locale.errorTitle,
            true
          );
        }
      }
    );
  };

  const resetShortcuts = () => {
    nativeConfirm(
      locale.settingsResetShortcutsConfirm || "Reset shortcuts to default?",
      locale.confirmTitle || "Confirmation",
      (confirmed) => {
        if (!confirmed) return;
        context.dispatch({ type: "resetShortcut" });
      }
    );
  };

  // Save current working snapshot as a named state
  const saveCurrentState = (e) => {
    e.preventDefault();
    const name = (stateName || "").trim();
    if (!name) {
      nativeAlert(locale.settingsStateNameRequired, locale.errorTitle, true);
      return;
    }
    // Build snapshot
    const snapshot = {
      text: context.state.text,
      images: context.state.images,
      currentLineIndex: context.state.currentLineIndex,
      currentStyleId: context.state.currentStyleId,
      lastOpenedImagePath: context.state.lastOpenedImagePath || null,
      // Include a timestamp for info
      savedAt: Date.now(),
      version: 1,
    };
    const storageStates = readStorage("states") || {};
    storageStates[name] = snapshot;
    writeToStorage({ states: storageStates });
    setSavedStates(storageStates);
    setSelectedState(name);
    setStateName("");
  };

  // Load selected state into the app
  const loadSelectedState = () => {
    const name = (selectedState || "").trim();
    const storageStates = readStorage("states") || {};
    if (!name || !storageStates[name]) {
      return;
    }
    const data = storageStates[name] || {};
    // Use reducer's import path to merge safely
    context.dispatch({ type: "import", data });
    if (data.lastOpenedImagePath) {
      openFile(data.lastOpenedImagePath, context.state.autoClosePSD);
    }
  };

  const toggleDeleteStates = () => {
    setShowDeleteStates(!showDeleteStates);
    setStatesToDelete({});
  };

  const toggleStateCheckbox = (name, checked) => {
    setStatesToDelete((prev) => ({ ...prev, [name]: !!checked }));
  };

  const deleteSelectedStates = () => {
    const storageStates = readStorage("states") || {};
    const toDelete = Object.keys(statesToDelete).filter((k) => statesToDelete[k]);
    if (!toDelete.length) return;
    toDelete.forEach((k) => delete storageStates[k]);
    writeToStorage({ states: storageStates });
    setSavedStates(storageStates);
    if (toDelete.includes(selectedState)) setSelectedState("");
    setStatesToDelete({});
    setShowDeleteStates(false);
  };

  const tabs = [
    { id: "general", label: locale.settingsTabGeneral || "General", icon: FiSettings },
    { id: "appearance", label: locale.settingsTabAppearance || "Appearance", icon: FiEye },
    { id: "behavior", label: locale.settingsTabBehavior || "Behavior", icon: FiToggleLeft },
    { id: "shortcuts", label: locale.settingsTabShortcuts || "Shortcuts", icon: FaKeyboard },
    { id: "data", label: locale.settingsTabData || "Data", icon: FiDatabase }
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case "general":
        return (
          <div className="fields">
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupOnboarding || "Getting started"}</div>
              <div className="field">
                <button type="button" className="topcoat-button--large" onClick={openWalkthrough}>
                  {locale.settingsOpenWalkthrough || "Open walkthrough"}
                </button>
              </div>
              <div className="field-descr">
                {locale.settingsOpenWalkthroughHint || "Replay the first-time guide for the complete TypeR workflow."}
              </div>
            </div>
            <div className="field">
              <div className="field-label">{locale.settingsLanguageLabel}</div>
              <div className="field-input">
                <select value={language} onChange={changeLanguage} className="topcoat-textarea">
                  {Object.entries(config.languages).map(([code, name]) => (
                    <option key={code} value={code}>
                      {code === "auto" ? locale.settingsLanguageAuto : name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <div className="field-label">{locale.settingsTextItemKindLabel}</div>
              <div className="field-input">
                <select value={pastePointText} onChange={changePastePointText} className="topcoat-textarea">
                  <option value="">{locale.settingsTextItemKindBox}</option>
                  <option value="1">{locale.settingsTextItemKindPoint}</option>
                </select>
              </div>
            </div>
            <div className="field">
              <div className="field-label">{locale.settingsLinePrefixesLabel}</div>
              <div className="field-input">
                <textarea rows={2} value={ignoreLinePrefixes} onChange={changeLinePrefixes} className="topcoat-textarea" />
              </div>
              <div className="field-descr">{locale.settingsLinePrefixesDescr}</div>
            </div>
            <div className="field">
              <div className="field-label">{locale.settingsIgnoreTagsLabel}</div>
              <div className="field-input">
                <textarea rows={2} value={ignoreTags} onChange={changeIgnoreTags} className="topcoat-textarea" />
              </div>
              <div className="field-descr">{locale.settingsIgnoreTagsDescr}</div>
            </div>
            <div className="field">
              <div className="field-label">{locale.settingsDefaultStyleLabel}</div>
              <div className="field-input">
                <select value={defaultStyleId} onChange={changeDefaultStyle} className="topcoat-textarea">
                  <option key="none" value="">
                    {locale.settingsDefaultStyleNone}
                  </option>
                  {context.state.styles.map((style) => (
                    <option key={style.id} value={style.id}>
                      {style.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-descr">{locale.settingsDefaultStyleDescr}</div>
            </div>
          </div>
        );

      case "appearance": {
        const vis = uiLayout.visible;
        const blockLabels = {
          preview: locale.settingsLayoutBlockPreview || "Preview & actions",
          text: locale.settingsLayoutBlockText || "Text",
          styles: locale.settingsLayoutBlockStyles || "Styles",
        };
        const layoutElements = [
          { key: "tabBar", label: locale.settingsLayoutElTabBar || "Tab bar" },
          { key: "previewCreateButton", label: locale.settingsLayoutElCreate || "Create layer button" },
          { key: "previewAlignButton", label: locale.settingsLayoutElAlign || "Align button" },
          { key: "previewSizeControls", label: locale.settingsLayoutElSize || "Text size controls" },
          { key: "previewNav", label: locale.settingsLayoutElNav || "Line navigation arrows" },
          { key: "previewWidget", label: locale.settingsLayoutElWidget || "Line preview / TextShapeR" },
          { key: "footerHelp", label: locale.settingsLayoutElFooterHelp || "Footer: Help link" },
          { key: "footerRepo", label: locale.settingsLayoutElFooterRepo || "Footer: Repository link" },
          { key: "footerModeToggles", label: locale.settingsLayoutElFooterModes || "Footer: mode toggles" },
        ];
        const miniScale = 170 / 700;
        const miniPreviewHeight = Math.max(14, Math.round((parseInt(previewHeight, 10) || 130) * miniScale));
        const miniStylesHeight = Math.max(10, Math.round((parseInt(stylesHeight, 10) || 70) * miniScale));
        const miniBlocks = {
          preview: vis.preview ? (
            <div key="preview" className="settings-layout-mini-block m-preview" style={{ height: miniPreviewHeight }}>
              <div className="settings-layout-mini-row">
                {vis.previewCreateButton && <span className="m-pill m-cta" />}
                {vis.previewAlignButton && <span className="m-pill" />}
                {vis.previewSizeControls && <span className="m-pill m-small" />}
              </div>
              {(vis.previewNav || vis.previewWidget) && (
                <div className="settings-layout-mini-row">
                  {vis.previewNav && <span className="m-nav" />}
                  {vis.previewWidget && <span className="m-widget" />}
                </div>
              )}
            </div>
          ) : null,
          text: vis.text ? (
            <div key="text" className="settings-layout-mini-block m-text">
              {vis.tabBar && <div className="settings-layout-mini-tabs"><span /><span /></div>}
              <span className="settings-layout-mini-label">{blockLabels.text}</span>
            </div>
          ) : null,
          styles: vis.styles ? (
            <div key="styles" className="settings-layout-mini-block m-styles" style={vis.text ? { height: miniStylesHeight } : { flex: "1 1 auto" }}>
              <span className="settings-layout-mini-label">{blockLabels.styles}</span>
            </div>
          ) : null,
        };
        return (
          <div className="fields">
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupTheme || "Theme"}</div>
              <div className="settings-theme-grid">
                {EDITOR_THEME_PRESETS.map((theme) => {
                  const preview = getEditorThemePreviewColors(theme);
                  const isActive = editorTheme === theme.id;
                  return (
                    <button
                      type="button"
                      key={theme.id}
                      className={"settings-theme-choice" + (isActive ? " m-active" : "")}
                      onClick={() => changeEditorTheme(theme.id)}
                      title={theme.label}
                      style={{ "--theme-card-accent": preview.accent }}
                    >
                      <span className="settings-theme-preview" style={{ backgroundColor: preview.surface }}>
                        <span className="settings-theme-preview-bar" style={{ backgroundColor: preview.panel }}>
                          <i style={{ backgroundColor: preview.accent }} />
                          <i style={{ backgroundColor: preview.muted }} />
                        </span>
                        <span className="settings-theme-preview-line m-long" style={{ backgroundColor: preview.text }} />
                        <span className="settings-theme-preview-line" style={{ backgroundColor: preview.muted }} />
                        <span className="settings-theme-preview-pill" style={{ backgroundColor: preview.accent }} />
                        {isActive && (
                          <span
                            className="settings-theme-check"
                            style={{ backgroundColor: preview.accent, color: preview.accentText || preview.surface }}
                          >
                            <FiCheck size={10} />
                          </span>
                        )}
                      </span>
                      <span className="settings-theme-name">{theme.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="field-descr">{locale.settingsThemeHint || "Choose a TypeR theme. Photoshop follows the host appearance."}</div>
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupInterface || "Interface layout"}</div>
              <div className="settings-layout">
                <div className="settings-layout-mini-wrap">
                  <div className="settings-layout-mini">
                    {uiLayout.order.map((id) => miniBlocks[id])}
                    <div className="settings-layout-mini-footer">
                      {vis.footerHelp && <span />}
                      <span className="m-on" />
                      {vis.footerRepo && <span />}
                      {vis.footerModeToggles && (
                        <React.Fragment>
                          <span className="m-dot" />
                          <span className="m-dot" />
                        </React.Fragment>
                      )}
                    </div>
                  </div>
                  <div className="settings-layout-mini-caption">
                    {(locale.settingsLayoutScaleCaption || "Scale: {scale}%").replace("{scale}", uiScale || "100")}
                  </div>
                </div>
                <div className="settings-layout-blocks">
                  {uiLayout.order.map((id, index) => (
                    <div key={id} className={"settings-layout-block-row" + (vis[id] ? "" : " m-hidden")}>
                      <button
                        type="button"
                        className="settings-layout-icon-btn"
                        title={vis[id] ? (locale.settingsLayoutHide || "Hide") : (locale.settingsLayoutShow || "Show")}
                        onClick={() => toggleUiElement(id)}
                      >
                        {vis[id] ? <FiEye size={13} /> : <FiEyeOff size={13} />}
                      </button>
                      <span className="settings-layout-block-name">{blockLabels[id]}</span>
                      <button
                        type="button"
                        className="settings-layout-icon-btn"
                        disabled={index === 0}
                        title={locale.settingsLayoutMoveUp || "Move up"}
                        onClick={() => moveUiBlock(id, -1)}
                      >
                        <FiChevronUp size={13} />
                      </button>
                      <button
                        type="button"
                        className="settings-layout-icon-btn"
                        disabled={index === uiLayout.order.length - 1}
                        title={locale.settingsLayoutMoveDown || "Move down"}
                        onClick={() => moveUiBlock(id, 1)}
                      >
                        <FiChevronDown size={13} />
                      </button>
                    </div>
                  ))}
                  <div className="field-descr">
                    {locale.settingsLayoutBlocksHint || "Show, hide, and reorder the main panels. The settings stay reachable from the footer."}
                  </div>
                </div>
              </div>
              <div className="settings-layout-elements">
                {layoutElements.map((element) => (
                  <label key={element.key} className="settings-layout-element">
                    <input
                      type="checkbox"
                      checked={vis[element.key] !== false}
                      onChange={() => toggleUiElement(element.key)}
                    />
                    <div className="settings-checkbox-custom"></div>
                    <span>{element.label}</span>
                  </label>
                ))}
              </div>
              <div className="settings-layout-sizes">
                <div className="settings-layout-size-field">
                  <div className="field-label">{locale.settingsLayoutPreviewHeight || "Preview height (px)"}</div>
                  <input type="number" min="80" max="300" value={previewHeight} onChange={changeUiSize(setPreviewHeight)} className="topcoat-text-input--large" />
                </div>
                <div className="settings-layout-size-field">
                  <div className="field-label">{locale.settingsLayoutStylesHeight || "Styles height (px)"}</div>
                  <input type="number" min="70" max="500" value={stylesHeight} onChange={changeUiSize(setStylesHeight)} className="topcoat-text-input--large" />
                </div>
                <div className="settings-layout-size-field">
                  <div className="field-label">{locale.settingsLayoutUiScale || "Interface scale (%)"}</div>
                  <input type="number" min="70" max="150" value={uiScale} onChange={changeUiSize(setUiScale)} className="topcoat-text-input--large" />
                </div>
              </div>
              <div className="field">
                <button type="button" className="topcoat-button--large" onClick={resetUiLayout}>
                  <FiRotateCcw size={14} /> {locale.settingsLayoutReset || "Reset layout"}
                </button>
              </div>
            </div>
            <div className="field">
              <div className="field-label">{locale.settingsDirectionLabel}</div>
              <div className="field-input">
                <select value={direction} onChange={changeDirection} className="topcoat-textarea">
                  <option value="ltr">{locale.settingsDirectionLtr}</option>
                  <option value="rtl">{locale.settingsDirectionRtl}</option>
                </select>
              </div>
            </div>
            <div className="field">
              <div className="field-label">{locale.settingsMiddleEastLabel}</div>
              <div className="field-input">
                <label className="topcoat-checkbox">
                  <input type="checkbox" checked={middleEast} onChange={changeMiddleEast} />
                  <div className="topcoat-checkbox__checkmark"></div>
                </label>
              </div>
            </div>
          </div>
        );
      }

      case "behavior":
        return (
          <div className="fields">
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupExperimental || "Experimental"}</div>
              <div className="settings-checkbox-grid">
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={inlineTextShapeR} onChange={changeInlineTextShapeR} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>
                        {locale.settingsInlineTextShapeRLabel || "TextShapeR"}
                        <b className="settings-new-badge">{locale.settingsNewBadge || "New"}</b>
                      </span>
                      <div className="settings-checkbox-hint">
                        {locale.settingsInlineTextShapeRHint || "Shows text shape suggestions directly in the main panel. This may impact performance."}
                      </div>
                    </div>
                  </label>
                </div>
                {inlineTextShapeR && (
                  <div className="settings-checkbox-item">
                    <label className="settings-checkbox-label">
                      <input type="checkbox" checked={dehyphenateTextShapeR} onChange={changeDehyphenateTextShapeR} />
                      <div className="settings-checkbox-custom"></div>
                      <div className="settings-checkbox-content">
                        <span>{locale.settingsDehyphenateLabel || "TextShapeR: join words split by hyphenation"}</span>
                        <div className="settings-checkbox-hint">
                          {locale.settingsDehyphenateHint || "When shaping text, joins words split across line breaks. Turn off if real compound words should stay separated."}
                        </div>
                      </div>
                    </label>
                  </div>
                )}
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={multiTabEnabled} onChange={changeMultiTabEnabled} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>
                        {locale.settingsMultiTabLabel || "Multi-tab"}
                        <b className="settings-new-badge">{locale.settingsNewBadge || "New"}</b>
                      </span>
                      <div className="settings-checkbox-hint">
                        {locale.settingsMultiTabHint || "Manage several series at once with tabs above the text block, each with its own text and PSD sync."}
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupAutomations || "Automations"}</div>
              <div className="settings-checkbox-grid">
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={autoClosePSD} onChange={changeAutoClosePSD} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.settingsAutoClosePsdLabel}</span>
                      <div className="settings-checkbox-hint">{locale.settingsAutoClosePsdHint || "Automatically closes PSD files after processing"}</div>
                    </div>
                  </label>
                </div>
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={autoScrollStyle} onChange={changeAutoScrollStyle} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.settingsAutoScrollStyleLabel}</span>
                      <div className="settings-checkbox-hint">{locale.settingsAutoScrollStyleHint || "Automatically scrolls to selected style"}</div>
                    </div>
                  </label>
                </div>
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={resizeTextBoxOnCenter} onChange={changeResizeTextBoxOnCenter} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.settingsResizeTextBoxOnCenterLabel}</span>
                      <div className="settings-checkbox-hint">{locale.settingsResizeTextBoxOnCenterHint || "Resizes text box during automatic centering"}</div>
                    </div>
                  </label>
                </div>
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={multiBubbleMode} onChange={changeMultiBubbleMode} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.multiBubbleModeToggle || "Multi-Bubble Mode"}</span>
                      <div className="settings-checkbox-hint">
                        {locale.multiBubbleModeHint || "Allows capturing multiple selections to insert multiple texts at once"}
                        <button
                          type="button"
                          className="settings-help-badge"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            window.cep && window.cep.util && window.cep.util.openURLInDefaultBrowser('https://youtu.be/gmIh-eEj2HY');
                          }}
                          title={locale.multiBubbleModeHowToUse || "How to use"}
                        >
                          <FiPlayCircle size={12} />
                          {locale.multiBubbleModeHowToUse || "How to use"}
                        </button>
                      </div>
                    </div>
                  </label>
                </div>
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={showTips} onChange={changeShowTips} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.settingsShowTipsLabel || "Show tips"}</span>
                      <div className="settings-checkbox-hint">
                        {locale.settingsShowTipsHint || "Display tips in the interface (multi-bubble hints, etc.)"}
                      </div>
                    </div>
                  </label>
                </div>
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={showQuickStyleSize} onChange={changeShowQuickStyleSize} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.settingsQuickStyleSizeLabel || "Quick style size editor"}</span>
                      <div className="settings-checkbox-hint">
                        {locale.settingsQuickStyleSizeHint || "Show the mini size editor when hovering the style edit button."}
                      </div>
                    </div>
                  </label>
                </div>
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={interpretMarkdown} onChange={changeInterpretMarkdown} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.settingsMarkdownLabel || "Interpret markdown (bold/italic)"}</span>
                      <div className="settings-checkbox-hint">
                        {locale.settingsMarkdownHint || "Convert markdown and rich text on paste and apply bold/italic in the text block."}
                      </div>
                    </div>
                  </label>
                </div>
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={resetLineCounterOnPage} onChange={changeResetLineCounterOnPage} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.settingsResetLineCounterOnPageLabel || "Reset line counter on page markers"}</span>
                      <div className="settings-checkbox-hint">
                        {locale.settingsResetLineCounterOnPageHint || "Restarts text line numbering at 1 after each Page N marker."}
                      </div>
                    </div>
                  </label>
                </div>
              </div>
              <div className="field">
                <div className="field-label">{locale.settingsQuickStyleSizeStepLabel || "Quick size step"}</div>
                <div className="field-input">
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    value={styleSizeStep}
                    onChange={changeStyleSizeStep}
                    onBlur={resetStyleSizeStep}
                    className="topcoat-text-input--large"
                  />
                </div>
                <div className="field-descr">
                  {locale.settingsQuickStyleSizeStepHint || "Choose how much the quick size buttons increment the font size."}
                </div>
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupTextPositioning || "Text positioning"}</div>
              <div className="field">
                <div className="field-label">{locale.settingsInternalPaddingLabel || "Internal padding (px)"}</div>
                <div className="field-input">
                  <input 
                    type="number" 
                    min="0" 
                    max="100" 
                    value={internalPadding} 
                    onChange={changeInternalPadding} 
                    className="topcoat-text-input--large" 
                  />
                </div>
                <div className="field-descr">{locale.settingsInternalPaddingHint || "Internal space to prevent text from touching bubble edges (0-100 pixels)"}</div>
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupUpdates || "Priorities and Updates"}</div>
              <div className="settings-checkbox-grid">
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={currentFolderTagPriority} onChange={changeCurrentFolderTagPriority} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.settingsCurrentFolderTagPriorityLabel}</span>
                      <div className="settings-checkbox-hint">{locale.settingsCurrentFolderTagPriorityHint || "Gives priority to styles from current folder"}</div>
                    </div>
                  </label>
                </div>
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={checkUpdates} onChange={changeCheckUpdates} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.settingsCheckUpdatesLabel}</span>
                      <div className="settings-checkbox-hint">{locale.settingsCheckUpdatesHint || "Automatically checks for available updates"}</div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </div>
        );

      case "shortcuts":
        return (
          <div className="fields">
            <div className="field">
              <div className="field-label">{locale.shortcut}</div>
              {Object.entries(context.state.shortcut).map(([index, value]) => (
                <Shortcut key={index} value={value} index={index}></Shortcut>
              ))}
            </div>
            <div className="field">
              <button type="button" className="topcoat-button--large" onClick={resetShortcuts}>
                {locale.settingsResetShortcuts || "Reset shortcuts"}
              </button>
            </div>
            <div className="field">
              <div className="field-descr">
                {locale.settingsShortcutsTip || "If shortcuts feel buggy or stop working, resetting them often fixes it."}
              </div>
            </div>
          </div>
        );

      case "data":
        return (
          <div className="fields">
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsStatesTitle}</div>
              <div className="field">
                <div className="field-input">
                  <input
                    type="text"
                    className="topcoat-text-input--large"
                    placeholder={locale.settingsStateNamePlaceholder}
                    value={stateName}
                    onChange={(e) => setStateName(e.target.value)}
                  />
                </div>
                <div className="field-descr">{locale.settingsStatesDescr}</div>
              </div>
              <div className="field">
                <button className="topcoat-button--large" onClick={saveCurrentState}>
                  {locale.settingsSaveCurrentState}
                </button>
              </div>
              <div className="field">
                <div className="field-label">{locale.settingsStatesListLabel}</div>
                <div className="field-input">
                  {Object.keys(savedStates).length ? (
                    <select
                      className="topcoat-textarea"
                      value={selectedState}
                      onChange={(e) => setSelectedState(e.target.value)}
                    >
                      <option value="">{locale.settingsSelectState}</option>
                      {Object.keys(savedStates).map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="field-descr">{locale.settingsNoStates}</div>
                  )}
                </div>
              </div>
              <div className="field">
                <button className="topcoat-button--large" onClick={loadSelectedState}>
                  {locale.settingsLoadSelectedState}
                </button>
              </div>
              <div className="field">
                <button className="topcoat-button--large" onClick={toggleDeleteStates}>
                  {locale.settingsDeleteStates}
                </button>
              </div>
              {showDeleteStates && (
                <div className="field">
                  <div className="field-label">{locale.settingsDeleteStatesTitle}</div>
                  <div className="field-input">
                    {Object.keys(savedStates).length ? (
                      <div className="hostBrdContrast" style={{ maxHeight: 180, overflowY: "auto", padding: 6 }}>
                        {Object.keys(savedStates).map((name) => (
                          <label key={name} className="topcoat-checkbox" style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                            <input
                              type="checkbox"
                              checked={!!statesToDelete[name]}
                              onChange={(e) => toggleStateCheckbox(name, e.target.checked)}
                            />
                            <div className="topcoat-checkbox__checkmark" style={{ marginRight: 8 }}></div>
                            <span>{name}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="field-descr">{locale.settingsNoStates}</div>
                    )}
                  </div>
                  <div className="field-input" style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    <button className="topcoat-button--large--cta" onClick={deleteSelectedStates}>
                      {locale.settingsDeleteSelected}
                    </button>
                    <button className="topcoat-button--large" onClick={toggleDeleteStates}>
                      {locale.cancel}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupDebug || "Debugging"}</div>
              <div className="settings-checkbox-grid">
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={debugLogger} onChange={changeDebugLogger} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.settingsDebugLoggerLabel || "Debug logging"}</span>
                      <div className="settings-checkbox-hint">
                        {locale.settingsDebugLoggerHint || "Writes a detailed log of every Photoshop action TypeR performs (calls, payloads, results, timings, events) to typer_debug.log in the extension folder."}
                      </div>
                    </div>
                  </label>
                </div>
              </div>
              <div className="field">
                <button type="button" className="topcoat-button--large" onClick={revealDebugLog}>
                  {locale.settingsDebugLogReveal || "Open log folder"}
                </button>
              </div>
              <div className="field">
                <button type="button" className="topcoat-button--large" onClick={clearDebugLogFile}>
                  {locale.settingsDebugLogClear || "Clear log file"}
                </button>
              </div>
            </div>
            <div className="settings-group">
              <FontScanPromo />
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupImportExport || "Import/Export"}</div>
              <div className="field">
                <button className="topcoat-button--large" onClick={importSettings}>
                  <FaFileImport size={18} /> {locale.settingsImport}
                </button>
              </div>
              <div className="field">
                <button className="topcoat-button--large" onClick={exportSettings}>
                  <FaFileExport size={18} /> {locale.settingsExport}
                </button>
              </div>
              <div className="field">
                <button className="topcoat-button--large" onClick={checkUpdatesNow}>
                  {locale.settingsCheckUpdatesButton}
                </button>
              </div>
              <div className="field">
                <button className="topcoat-button--large--cta" onClick={resetStorage}>
                  {locale.settingsResetStorage || "Reset settings"}
                </button>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <React.Fragment>
      <div className="app-modal-header hostBrdBotContrast">
        <div className="app-modal-title">{locale.settingsTitle}</div>
        <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={close}>
          <FiX size={18} />
        </button>
      </div>
      <div className="app-modal-body">
        <div className="app-modal-body-inner">
          <div className="settings-tabs">
            {tabs.map((tab) => {
              const IconComponent = tab.icon;
              return (
                <button
                  key={tab.id}
                  className={`settings-tab ${activeTab === tab.id ? 'settings-tab--active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <IconComponent size={16} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
          <form className="settings-content" onSubmit={save}>
            {renderTabContent()}
            <div className="settings-actions">
              <button type="submit" className={edited ? "topcoat-button--large--cta" : "topcoat-button--large"}>
                <MdSave size={18} /> {locale.save}
              </button>
            </div>
          </form>
        </div>
        {multiTabConfirmOpen && (
          <div className="settings-confirm-overlay" onClick={cancelDisableMultiTab}>
            <div className="settings-confirm-dialog hostBgdLight" onClick={(e) => e.stopPropagation()}>
              <div className="settings-confirm-icon">
                <FiAlertTriangle size={26} />
              </div>
              <div className="settings-confirm-title">
                {locale.settingsMultiTabDisableTitle || "Disable multi-tab?"}
              </div>
              <div className="settings-confirm-text">
                {(locale.settingsMultiTabDisableConfirm || 'All tabs other than "{name}" will be lost.')
                  .replace("{name}", (context.state.tabs || [])[0]?.name || "")}
              </div>
              <div className="settings-confirm-actions">
                <button type="button" className="topcoat-button--large" onClick={cancelDisableMultiTab}>
                  {locale.cancel || "Cancel"}
                </button>
                <button type="button" className="topcoat-button--large--cta settings-confirm-danger" onClick={confirmDisableMultiTab}>
                  {locale.settingsMultiTabDisableAction || "Disable"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </React.Fragment>
  );
});

export default SettingsModal;
