import React from "react";
import PropTypes from "prop-types";
import { locale, readStorage, writeToStorage, scrollToLine, scrollToStyle, checkUpdate } from "./utils";
import config from "./config";
import { getNextLineNumberState } from "./lineNumbering";
import { setDehyphenationEnabled } from "./textShapeR";
import { normalizeEditorTheme } from "./themePresets";
import { applyEditorTheme } from "./lib/themeManager";

const storage = readStorage();
const storeFields = [
  "notFirstTime",
  "text",
  "styles",
  "folders",
  "textScale",
  "textSizeIncrement",
  "currentLineIndex",
  "currentStyleId",
  "usedLineStyles",
  "pastePointText",
  "ignoreLinePrefixes",
  "ignoreTags",
  "defaultStyleId",
  "autoClosePSD",
  "checkUpdates",
  "autoScrollStyle",
  "currentFolderTagPriority",
  "resizeTextBoxOnCenter",
  "images",
  "shortcut",
  "language",
  "direction",
  "middleEast",
  "lastOpenedImagePath",
  "storedSelections",
  "multiBubbleMode",
  "showTips",
  "exportFolderFontTipDismissed",
  "showQuickStyleSize",
  "inlineTextShapeR",
  "textShapeRBubbleAware",
  "dehyphenateTextShapeR",
  "internalPadding",
  "interpretMarkdown",
  "styleSizeStep",
  "resetLineCounterOnPage",
  "tabs",
  "currentTabId",
  "multiTabEnabled",
  "uiLayout",
  "editorTheme",
];

// Fields that belong to each tab (text script + PSD sync)
const tabFields = ["text", "images", "currentLineIndex", "lastOpenedImagePath", "usedLineStyles"];

const createTab = (name, data = {}) => ({
  id: Math.random().toString(36).substr(2, 8),
  name,
  text: data.text || "",
  images: data.images || [],
  currentLineIndex: data.currentLineIndex || 0,
  lastOpenedImagePath: data.lastOpenedImagePath || null,
  usedLineStyles: data.usedLineStyles || {},
});

const loadTabIntoState = (state, tab) => {
  state.currentTabId = tab.id;
  state.text = tab.text || "";
  state.images = tab.images || [];
  state.currentLineIndex = tab.currentLineIndex || 0;
  state.lastOpenedImagePath = tab.lastOpenedImagePath || null;
  state.usedLineStyles = tab.usedLineStyles || {};
  // Stored selections are bound to the previously opened PSD
  state.storedSelections = [];
};

const defaultUiLayout = {
  order: ["preview", "text", "styles"],
  visible: {
    preview: true,
    text: true,
    styles: true,
    tabBar: true,
    previewCreateButton: true,
    previewAlignButton: true,
    previewSizeControls: true,
    previewNav: true,
    previewWidget: true,
    footerHelp: true,
    footerRepo: true,
    footerModeToggles: true,
  },
  sizes: {
    previewHeight: 130,
    uiScale: 100,
  },
};

const clampNumber = (value, min, max, fallback) => {
  const num = parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

// Merge a stored/partial layout with the defaults so missing or invalid
// fields (older storage versions, bad imports) never break the UI
const normalizeUiLayout = (raw) => {
  const layout = raw && typeof raw === "object" ? raw : {};
  const visible = { ...defaultUiLayout.visible };
  if (layout.visible && typeof layout.visible === "object") {
    for (const key in visible) {
      if (typeof layout.visible[key] === "boolean") visible[key] = layout.visible[key];
    }
  }
  let order = Array.isArray(layout.order)
    ? layout.order.filter((id) => defaultUiLayout.order.includes(id))
    : [];
  order = order.concat(defaultUiLayout.order.filter((id) => !order.includes(id)));
  // The panel must never end up fully empty
  if (!visible.preview && !visible.text && !visible.styles) visible.text = true;
  const sizes = {
    previewHeight: clampNumber(layout.sizes?.previewHeight, 80, 300, defaultUiLayout.sizes.previewHeight),
    uiScale: clampNumber(layout.sizes?.uiScale, 70, 150, defaultUiLayout.sizes.uiScale),
  };
  return { order, visible, sizes };
};

const defaultShortcut = {
  add: ["WIN", "CTRL"],
  center: ["WIN", "ALT"],
  apply: ["WIN", "SHIFT"],
  next: ["CTRL", "ENTER"],
  previous: ["CTRL", "TAB"],
  increase: ["CTRL", "SHIFT", "PLUS"],
  decrease: ["CTRL", "SHIFT", "MINUS"],
  insertText: ["WIN", "V"],
  nextPage: ["SHIFT", "X"],
  toggleMultiBubble: ["CTRL", "ALT", "M"],
};

const normalizeFolders = (folders) => {
  const normalized = (folders || []).map((folder) => {
    const parentId = folder?.parentId === undefined || folder?.parentId === null || folder?.parentId === "" ? null : folder.parentId;
    return {
      ...folder,
      parentId,
      order: typeof folder?.order === "number" ? folder.order : 0,
    };
  });
  const ids = new Set(normalized.map((folder) => folder.id));
  normalized.forEach((folder) => {
    if (folder.parentId === folder.id || (folder.parentId && !ids.has(folder.parentId))) {
      folder.parentId = null;
    }
  });
  const siblingsMap = new Map();
  normalized.forEach((folder) => {
    const key = folder.parentId || "__root__";
    if (!siblingsMap.has(key)) siblingsMap.set(key, []);
    siblingsMap.get(key).push(folder);
  });
  siblingsMap.forEach((siblings) => {
    siblings
      .sort((a, b) => {
        const orderA = typeof a.order === "number" ? a.order : 0;
        const orderB = typeof b.order === "number" ? b.order : 0;
        return orderA - orderB;
      })
      .forEach((folder, index) => {
        folder.order = index;
      });
  });
  return normalized;
};

const collectDescendantFolderIds = (folders, folderId) => {
  const ids = [];
  if (!folderId) return ids;
  const queue = [folderId];
  while (queue.length) {
    const current = queue.shift();
    const children = (folders || []).filter((folder) => (folder.parentId || null) === current);
    for (const child of children) {
      ids.push(child.id);
      queue.push(child.id);
    }
  }
  return ids;
};

const buildPrefixIndex = (prefixes) => {
  const index = new Map();
  (prefixes || []).forEach((data) => {
    if (!data?.prefix) return;
    const key = data.prefix[0];
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(data);
  });
  return index;
};

const findPrefixMatch = (index, text) => {
  if (!text) return null;
  const prefixes = index.get(text[0]);
  if (!prefixes) return null;
  return prefixes.find((data) => text.startsWith(data.prefix)) || null;
};

const initialState = {
  notFirstTime: false,
  initiated: false,
  text: "",
  lines: [],
  styles: [],
  folders: [],
  openFolders: [],
  textScale: null,
  textSizeIncrement: 1,
  currentLine: null,
  currentLineIndex: 0,
  currentStyle: null,
  currentStyleId: null,
  usedLineStyles: {},
  pastePointText: false,
  ignoreLinePrefixes: ["##"],
  ignoreTags: [],
  defaultStyleId: null,
  autoClosePSD: false,
  checkUpdates: config.checkUpdates,
  autoScrollStyle: storage.data?.autoScrollStyle !== false,
  currentFolderTagPriority: storage.data?.currentFolderTagPriority !== false,
  resizeTextBoxOnCenter: false,
  showTips: storage.data?.showTips !== false,
  exportFolderFontTipDismissed: storage.data?.exportFolderFontTipDismissed === true,
  exportFolderFontTipVisible: false,
  showQuickStyleSize: storage.data?.showQuickStyleSize !== false,
  inlineTextShapeR: storage.data?.inlineTextShapeR !== false,
  textShapeRBubbleAware: storage.data?.textShapeRBubbleAware !== false,
  dehyphenateTextShapeR: storage.data?.dehyphenateTextShapeR === true,
  modalType: null,
  modalData: {},
  images: [],
  language: "auto",
  direction: "ltr",
  middleEast: false,
  lastOpenedImagePath: null,
  storedSelections: [],
  multiBubbleMode: false,
  internalPadding: 10,
  interpretMarkdown: storage.data?.interpretMarkdown === true,
  styleSizeStep: 1,
  resetLineCounterOnPage: storage.data?.resetLineCounterOnPage !== false,
  multiTabEnabled: storage.data?.multiTabEnabled !== false,
  ...storage.data,
  shortcut: { ...defaultShortcut, ...(storage.data?.shortcut || {}) },
  uiLayout: normalizeUiLayout(storage.data?.uiLayout),
  editorTheme: normalizeEditorTheme(storage.data?.editorTheme),
};

// Multi-tab migration: wrap pre-tab data into a single tab, or restore the
// active tab's fields from the stored tabs list
if (!Array.isArray(initialState.tabs) || !initialState.tabs.length) {
  const firstTab = createTab((locale.tabDefaultName || "Tab") + " 1", initialState);
  initialState.tabs = [firstTab];
  initialState.currentTabId = firstTab.id;
} else {
  const activeTab = initialState.tabs.find((tab) => tab.id === initialState.currentTabId) || initialState.tabs[0];
  loadTabIntoState(initialState, activeTab);
  // Keep stored selections across restarts (loadTabIntoState clears them)
  initialState.storedSelections = storage.data?.storedSelections || [];
}

const reducer = (state, action) => {
  let thenScroll = false;
  let thenSelectStyle = false;
  const newState = Object.assign({}, state);
  switch (action.type) {
    case "removeFirstTime": {
      newState.notFirstTime = true;
      newState.modalType = "help";
      break;
    }

    case "showFirstRunWalkthrough": {
      newState.notFirstTime = true;
      if (!state.modalType) {
        newState.modalType = "walkthrough";
        newState.modalData = {};
      }
      break;
    }

    case "completeWalkthrough": {
      newState.notFirstTime = true;
      newState.modalType = null;
      newState.modalData = {};
      break;
    }

    case "import": {
      for (const field in action.data) {
        if (!action.data.hasOwnProperty(field)) continue;
        if (!initialState.hasOwnProperty(field)) continue;
        if (field === "styles" && state.styles) {
          const styles = [];
          let asked = false;
          let keep = false;
          for (const style of state.styles) {
            const inImport = action.data.styles.find((s) => s.id === style.id);
            if (!inImport || (style.edited && !inImport.edited) || (style.edited && inImport.edited && style.edited > inImport.edited)) {
              if (!asked) {
                keep = confirm(locale.settingsImportReplace);
                asked = true;
              }
              if (keep) styles.push(style);
            }
          }
          for (const style of action.data.styles) {
            if (!keep) {
              styles.push(style);
            } else {
              const oldStyle = state.styles.find((s) => s.id === style.id);
              if (!oldStyle?.edited || (style.edited && style.edited >= oldStyle.edited)) {
                styles.push(style);
              }
            }
          }
          newState[field] = styles;
        } else {
          newState[field] = action.data[field];
        }
      }
      if (action.data.uiLayout) {
        newState.uiLayout = normalizeUiLayout(action.data.uiLayout);
      }
      break;
    }

    case "setText": {
      newState.text = action.text;
      break;
    }

    case "setCurrentLineIndex": {
      newState.currentLineIndex = action.index;
      thenSelectStyle = true;
      break;
    }

    case "prevLine": {
      if (!state.text) break;
      let newIndex = state.currentLineIndex;
      for (let i = newIndex - 1; i >= 0; i--) {
        if (!state.lines[i].ignore) {
          newState.currentLineIndex = state.lines[i].rawIndex;
          break;
        }
      }
      thenScroll = true;
      thenSelectStyle = true;
      break;
    }

    case "nextLine": {
      if (!state.text) break;
      if (action.add && typeof state.currentLineIndex === "number" && state.currentStyleId) {
        const currentLine = state.lines[state.currentLineIndex];
        if (currentLine && !currentLine.ignore) {
          newState.usedLineStyles = {
            ...(state.usedLineStyles || {}),
            [state.currentLineIndex]: {
              rawText: currentLine.rawText,
              styleId: state.currentStyleId,
            },
          };
        }
      }
      if (action.add && newState.currentLine.last) break;
      let newIndex = state.currentLineIndex;
      for (let i = newIndex + 1; i < state.lines.length; i++) {
        if (!state.lines[i].ignore) {
          newState.currentLineIndex = state.lines[i].rawIndex;
          break;
        }
      }
      thenScroll = true;
      thenSelectStyle = true;
      break;
    }

    case "nextPage": {
      if (!state.text) break;
      // Find the next "Page X" marker.
      let foundNextPage = false;
      for (let i = state.currentLineIndex + 1; i < state.lines.length; i++) {
        const line = state.lines[i];
        if (line.rawText.match(/Page [0-9]+/i)) {
          // Select the first usable line after that page marker.
          for (let j = i + 1; j < state.lines.length; j++) {
            if (!state.lines[j].ignore) {
              newState.currentLineIndex = state.lines[j].rawIndex;
              foundNextPage = true;
              break;
            }
          }
          break;
        }
      }
      if (foundNextPage) {
        thenScroll = true;
        thenSelectStyle = true;
      }
      break;
    }

    case "setCurrentStyleId": {
      newState.currentStyleId = action.id;
      break;
    }

    case "setTextScale": {
      let scale = parseInt(action.scale) || null;
      if (scale) {
        if (scale < 1) scale = 1;
        if (scale > 999) scale = 999;
      }
      newState.textScale = scale;
      break;
    }

    case "setTextSizeIncrement": {
      let increment = action.increment;
      if (increment === "" || increment === null || increment === undefined) {
        newState.textSizeIncrement = "";
      } else {
        increment = parseInt(increment) || 1;
        if (increment < 1) increment = 1;
        if (increment > 99) increment = 99;
        newState.textSizeIncrement = increment;
      }
      break;
    }

    case "saveFolder": {
      const editId = action.id || action.data.id;
      const { styleIds, ...folderPayload } = action.data;
      if (styleIds) {
        const styleIdSet = new Set(styleIds);
        const styles = state.styles.map((style) => {
          if (style.folder === editId && !styleIdSet.has(style.id)) {
            return { ...style, folder: null };
          }
          if (styleIdSet.has(style.id) && style.folder !== editId) {
            return { ...style, folder: editId };
          }
          return style;
        });
        newState.styles = styles;
      }
      let folders = state.folders.map((folder) => ({ ...folder }));
      const data = { ...folderPayload, id: editId };
      const parentId = data.parentId === undefined || data.parentId === null || data.parentId === "" ? null : data.parentId;
      data.parentId = parentId;
      if (data.parentId && !folders.find((folder) => folder.id === data.parentId)) {
        data.parentId = null;
      }
      let folder = folders.find((f) => f.id === editId);
      const siblings = folders.filter((f) => (f.parentId || null) === (data.parentId || null) && f.id !== editId);
      if (folder) {
        Object.assign(folder, data);
        folder.order = typeof data.order === "number" ? data.order : siblings.length;
      } else {
        folder = {
          ...data,
          order: typeof data.order === "number" ? data.order : siblings.length,
        };
        folders.push(folder);
      }
      folders = normalizeFolders(folders);
      newState.folders = folders;
      if (!state.folders.find((f) => f.id === editId)) {
        const toOpen = data.parentId ? [data.parentId, editId] : [editId];
        newState.openFolders = Array.from(new Set(state.openFolders.concat(toOpen)));
      } else if (state.folders.find((f) => f.id === editId)?.parentId !== data.parentId && data.parentId) {
        newState.openFolders = Array.from(new Set(state.openFolders.concat([data.parentId])));
      }
      break;
    }

    case "importStyleFolder": {
      const folderData = action.folder || {};
      const folderId = folderData.id || Math.random().toString(36).substring(2, 8);
      const siblingCount = state.folders.filter((folder) => !(folder.parentId || null)).length;
      const folder = {
        ...folderData,
        id: folderId,
        parentId: null,
        order: typeof folderData.order === "number" ? folderData.order : siblingCount,
      };
      const importedStyles = (action.styles || []).map((style) => ({
        ...style,
        id: style.id || Math.random().toString(36).substring(2, 8),
        folder: folderId,
        prefixes: style.prefixes || [],
        edited: style.edited || Date.now(),
      }));
      newState.folders = normalizeFolders(state.folders.concat(folder));
      newState.styles = state.styles.concat(importedStyles);
      newState.openFolders = Array.from(new Set(state.openFolders.concat(folderId)));
      break;
    }

    case "importStyleLibrary": {
      const importedFolders = action.folders || [];
      const importedStyles = action.styles || [];
      const folderIds = new Set(importedFolders.map((folder) => folder.id));
      newState.folders = normalizeFolders(state.folders.concat(importedFolders));
      newState.styles = state.styles.concat(
        importedStyles.map((style) => ({
          ...style,
          folder: folderIds.has(style.folder) ? style.folder : null,
          prefixes: style.prefixes || [],
          edited: style.edited || Date.now(),
        }))
      );
      newState.openFolders = Array.from(new Set(state.openFolders.concat(importedFolders.map((folder) => folder.id))));
      break;
    }

    case "deleteFolder": {
      if (!action.id) break;
      const idsToRemove = [action.id].concat(collectDescendantFolderIds(state.folders, action.id));
      const folders = state.folders.filter((folder) => !idsToRemove.includes(folder.id)).map((folder) => ({ ...folder }));
      let styles = state.styles.concat([]);
      if (action.permanent) {
        styles = styles.filter((style) => !idsToRemove.includes(style.folder));
      } else {
        styles = styles.map((style) => {
          if (idsToRemove.includes(style.folder)) {
            return { ...style, folder: null };
          }
          return style;
        });
      }
      newState.styles = styles;
      newState.folders = normalizeFolders(folders);
      newState.openFolders = state.openFolders.filter((id) => id === "unsorted" || !idsToRemove.includes(id));
      break;
    }
    case "duplicateFolder": {
      const sourceId = action.id || action.data?.id;
      if (!sourceId) break;
      const originalFolder = state.folders.find((folder) => folder.id === sourceId);
      if (!originalFolder) break;
      const folders = state.folders.map((folder) => ({ ...folder }));
      const styles = state.styles.map((style) => ({ ...style }));
      const openFolders = state.openFolders.concat([]);
      const createdFolderIds = [];
      const duplicateStylesForFolder = (sourceFolderId, targetFolderId) => {
        const stylesToClone = state.styles.filter((style) => style.folder === sourceFolderId);
        stylesToClone.forEach((style) => {
          const newStyleId = Math.random().toString(36).substr(2, 8);
          styles.push({ ...style, id: newStyleId, name: style.name + " copy", folder: targetFolderId });
        });
      };
      const duplicateFolderRecursive = (folder, parentId) => {
        const siblingCount = folders.filter((f) => (f.parentId || null) === (parentId || null)).length;
        const newFolderId = Math.random().toString(36).substr(2, 8);
        const newFolder = {
          ...folder,
          id: newFolderId,
          name: folder.name + " copy",
          parentId: parentId || null,
          order: siblingCount,
        };
        delete newFolder.children;
        folders.push(newFolder);
        createdFolderIds.push(newFolderId);
        duplicateStylesForFolder(folder.id, newFolderId);
        const children = state.folders.filter((child) => (child.parentId || null) === folder.id);
        children.forEach((child) => duplicateFolderRecursive(child, newFolderId));
      };
      duplicateFolderRecursive(originalFolder, originalFolder.parentId);
      newState.folders = normalizeFolders(folders);
      newState.styles = styles;
      newState.openFolders = Array.from(new Set(openFolders.concat(createdFolderIds)));
      break;
    }

    case "toggleFolder": {
      let open = state.openFolders.concat([]);
      const id = action.id || "unsorted";
      if (open.includes(id)) open = open.filter((f) => f !== id);
      else open.push(id);
      newState.openFolders = open;
      break;
    }

    case "setFolders": {
      newState.folders = normalizeFolders(action.data || []);
      newState.openFolders = state.openFolders.filter((id) => id === "unsorted" || newState.folders.find((folder) => folder.id === id));
      break;
    }

    case "reorderFolders": {
      const parentId = action.parentId === undefined || action.parentId === null || action.parentId === "" ? null : action.parentId;
      const orderIds = action.order || [];
      const orderMap = new Map(orderIds.map((id, index) => [id, index]));
      const folders = state.folders.map((folder) => {
        if ((folder.parentId || null) !== parentId) return { ...folder };
        if (!orderMap.has(folder.id)) return { ...folder };
        return { ...folder, order: orderMap.get(folder.id) };
      });
      newState.folders = normalizeFolders(folders);
      break;
    }

    case "moveStyleToFolder": {
      const styleId = action.id;
      if (!styleId) break;
      const folderId = action.folderId === undefined || action.folderId === "" || action.folderId === "__unsorted__" ? null : action.folderId;
      if (folderId && !state.folders.find((folder) => folder.id === folderId)) break;
      const movedStyle = state.styles.find((style) => style.id === styleId);
      if (!movedStyle) break;

      const styles = state.styles
        .filter((style) => style.id !== styleId)
        .map((style) => ({ ...style }))
        .concat({ ...movedStyle, folder: folderId });
      const orderIds = action.order || [];
      if (!orderIds.length) {
        newState.styles = styles;
        break;
      }
      const orderMap = new Map(orderIds.map((id, index) => [id, index]));
      const targetStyles = styles
        .filter((style) => (style.folder || null) === folderId)
        .sort((a, b) => {
          const aOrder = orderMap.has(a.id) ? orderMap.get(a.id) : Number.MAX_SAFE_INTEGER;
          const bOrder = orderMap.has(b.id) ? orderMap.get(b.id) : Number.MAX_SAFE_INTEGER;
          return aOrder - bOrder;
        });

      newState.styles = styles.filter((style) => (style.folder || null) !== folderId).concat(targetStyles);
      break;
    }

    case "saveStyle": {
      const stylePayload = { ...action.data };
      if (typeof stylePayload.prefixes === "string") {
        const arr = stylePayload.prefixes.split(/(?:\r?\n|;)/);
        stylePayload.prefixes = arr.map((p) => p.trim()).filter(Boolean);
      } else if (!Array.isArray(stylePayload.prefixes)) {
        stylePayload.prefixes = [];
      }
      const editId = action.id || stylePayload.id;
      const styleExists = state.styles.some((s) => s.id === editId);
      newState.styles = styleExists
        ? state.styles.map((style) => (style.id === editId ? { ...style, ...stylePayload } : style))
        : state.styles.concat(stylePayload);
      break;
    }

    case "toggleStylePrefixes": {
      newState.styles = state.styles.map((style) => {
        if (style.id !== action.id) return style;
        return { ...style, prefixesDisabled: !style.prefixesDisabled };
      });
      break;
    }

    case "deleteStyle": {
      newState.styles = state.styles.filter((s) => s.id !== action.id);
      break;
    }

    case "duplicateStyle": {
      const styleToDup = action.data || state.styles.find((s) => s.id === state.currentStyleId);
      if (styleToDup) {
        const newStyleId = Math.random().toString(36).substr(2, 8);
        const newStyle = { ...styleToDup, id: newStyleId, name: styleToDup.name + " copy" };
        newState.styles = state.styles.concat(newStyle);
        newState.currentStyleId = newStyleId;
      }
      break;
    }

    case "setStyles": {
      newState.styles = action.data || [];
      break;
    }

    case "setIgnoreLinePrefixes": {
      if (!action.data) {
        newState.ignoreLinePrefixes = [];
      } else if (Array.isArray(action.data)) {
        newState.ignoreLinePrefixes = action.data;
      } else if (typeof action.data === "string") {
        const arr = action.data.split(/(?:\r?\n|;)/);
        newState.ignoreLinePrefixes = arr.map((p) => p.trim()).filter(Boolean);
      }
      break;
    }

    case "setIgnoreTags": {
      if (!action.data) {
        newState.ignoreTags = [];
      } else if (Array.isArray(action.data)) {
        newState.ignoreTags = action.data;
      } else if (typeof action.data === "string") {
        const arr = action.data.split(/(?:\r?\n|;)/);
        newState.ignoreTags = arr.map((p) => p.trim()).filter(Boolean);
      }
      break;
    }

    case "setDefaultStyleId": {
      newState.defaultStyleId = action.id || null;
      break;
    }

  case "setPastePointText": {
    newState.pastePointText = !!action.isPoint;
    break;
  }

  case "setAutoClosePSD": {
    newState.autoClosePSD = !!action.value;
    break;
  }

  case "setCheckUpdates": {
    newState.checkUpdates = !!action.value;
    break;
  }

  case "setAutoScrollStyle": {
    newState.autoScrollStyle = !!action.value;
    break;
  }

  case "setCurrentFolderTagPriority": {
    newState.currentFolderTagPriority = !!action.value;
    break;
  }

  case "setResizeTextBoxOnCenter": {
    newState.resizeTextBoxOnCenter = !!action.value;
    break;
  }

  case "setLanguage": {
    newState.language = action.lang || "auto";
    break;
  }

  case "setDirection": {
    newState.direction = action.direction || "ltr";
    break;
  }

    case "setMiddleEast": {
      newState.middleEast = !!action.value;
      break;
    }

    case "setMultiBubbleMode": {
      newState.multiBubbleMode = !!action.value;
      if (!action.value) {
        newState.storedSelections = [];
      }
      break;
    }

    case "setStyleSizeStep": {
      let step = parseFloat(action.step);
      if (!Number.isFinite(step) || step <= 0) step = 1;
      newState.styleSizeStep = step;
      break;
    }

    case "setShowTips": {
      newState.showTips = !!action.value;
      break;
    }

    case "showExportFolderFontTip": {
      newState.exportFolderFontTipVisible = true;
      break;
    }

    case "hideExportFolderFontTip": {
      newState.exportFolderFontTipVisible = false;
      if (action.dismiss) newState.exportFolderFontTipDismissed = true;
      break;
    }

    case "setShowQuickStyleSize": {
      newState.showQuickStyleSize = !!action.value;
      break;
    }

    case "setInlineTextShapeR": {
      newState.inlineTextShapeR = !!action.value;
      if (newState.inlineTextShapeR) {
        newState.textShapeRBubbleAware = true;
      }
      break;
    }

    case "setTextShapeRBubbleAware": {
      newState.textShapeRBubbleAware = !!action.value;
      break;
    }

    case "setDehyphenateTextShapeR": {
      newState.dehyphenateTextShapeR = action.value === true;
      break;
    }

    case "setLastOpenedImagePath": {
      newState.lastOpenedImagePath = action.path || null;
      break;
    }

    case "setModal": {
      newState.modalType = action.modal || null;
      newState.modalData = action.data || {};
      break;
    }

    case "setImages": {
      newState.images = action.images;
      break;
    }

    case "updateShortcut": {
      newState.shortcut = { ...defaultShortcut, ...state.shortcut, ...action.shortcut };
      break;
    }

    case "resetShortcut": {
      newState.shortcut = { ...defaultShortcut };
      break;
    }

    case "addSelection": {
      if (action.selection) {
        const selectionWithStyle = {
          ...action.selection,
          styleId: state.currentStyleId,
          capturedAt: Date.now(),
        };
        if (typeof action.lineIndex === "number") {
          selectionWithStyle.lineIndex = action.lineIndex;
          const line = state.lines[action.lineIndex];
          if (line && !line.ignore && state.currentStyleId) {
            newState.usedLineStyles = {
              ...(newState.usedLineStyles || state.usedLineStyles || {}),
              [action.lineIndex]: {
                rawText: line.rawText,
                styleId: state.currentStyleId,
              },
            };
          }
        }
        newState.storedSelections = [...state.storedSelections, selectionWithStyle];
      }
      break;
    }

    case "clearSelections": {
      newState.storedSelections = [];
      break;
    }

    case "removeSelection": {
      if (action.index >= 0 && action.index < state.storedSelections.length) {
        newState.storedSelections = state.storedSelections.filter((_, i) => i !== action.index);
      }
      break;
    }

    case "setInternalPadding": {
      let padding = action.value === "" || action.value === null || action.value === undefined ? 0 : parseInt(action.value);
      if (isNaN(padding)) padding = 0;
      if (padding < 0) padding = 0;
      if (padding > 100) padding = 100;
      newState.internalPadding = padding;
      break;
    }

    case "setInterpretMarkdown": {
      newState.interpretMarkdown = action.value !== false;
      break;
    }

    case "setResetLineCounterOnPage": {
      newState.resetLineCounterOnPage = action.value !== false;
      break;
    }

    case "addTab": {
      const name = action.name || (locale.tabDefaultName || "Tab") + " " + (state.tabs.length + 1);
      const tab = createTab(name, action.data);
      newState.tabs = state.tabs.concat(tab);
      newState.multiTabEnabled = true;
      loadTabIntoState(newState, tab);
      break;
    }

    case "switchTab": {
      if (action.id === state.currentTabId) break;
      const tab = state.tabs.find((t) => t.id === action.id);
      if (!tab) break;
      loadTabIntoState(newState, tab);
      break;
    }

    case "renameTab": {
      const name = (action.name || "").trim();
      if (!name) break;
      newState.tabs = state.tabs.map((tab) => (tab.id === action.id ? { ...tab, name } : tab));
      break;
    }

    case "setMultiTabEnabled": {
      const enabled = action.value !== false;
      newState.multiTabEnabled = enabled;
      if (!enabled && state.tabs.length > 1) {
        // Disabling multi-tab keeps only the first tab; the rest is discarded
        const firstTab = state.tabs[0];
        newState.tabs = [firstTab];
        loadTabIntoState(newState, firstTab);
      }
      break;
    }

    case "setUiLayout": {
      newState.uiLayout = normalizeUiLayout(action.layout);
      break;
    }

    case "setEditorTheme": {
      newState.editorTheme = normalizeEditorTheme(action.theme);
      break;
    }

    case "resetUiLayout": {
      newState.uiLayout = normalizeUiLayout(null);
      break;
    }

    case "deleteTab": {
      if (state.tabs.length <= 1) break;
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index < 0) break;
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      newState.tabs = tabs;
      if (state.currentTabId === action.id) {
        loadTabIntoState(newState, tabs[Math.min(index, tabs.length - 1)]);
      }
      break;
    }
  }

  // Detect which fields changed to skip unnecessary recomputation
  const stylesChanged = newState.styles !== state.styles;
  const foldersChanged = newState.folders !== state.folders;
  const textChanged = newState.text !== state.text;
  const ignoreLinePrefixesChanged = newState.ignoreLinePrefixes !== state.ignoreLinePrefixes;
  const ignoreTagsChanged = newState.ignoreTags !== state.ignoreTags;
  const currentFolderTagPriorityChanged = newState.currentFolderTagPriority !== state.currentFolderTagPriority;
  const imagesChanged = newState.images !== state.images;
  const lineIndexChanged = newState.currentLineIndex !== state.currentLineIndex;
  const styleIdChanged = newState.currentStyleId !== state.currentStyleId;
  const usedLineStylesChanged = newState.usedLineStyles !== state.usedLineStyles;
  const resetLineCounterOnPageChanged = newState.resetLineCounterOnPage !== state.resetLineCounterOnPage;

  const needsStyleProcessing = !state.initiated || stylesChanged || foldersChanged;
  const needsLineProcessing = needsStyleProcessing || textChanged ||
    ignoreLinePrefixesChanged || ignoreTagsChanged || currentFolderTagPriorityChanged ||
    imagesChanged || styleIdChanged || usedLineStylesChanged || resetLineCounterOnPageChanged;

  // Phase 1: Style/folder validation and sorting (only when styles or folders changed)
  if (needsStyleProcessing) {
    newState.styles = (newState.styles || []).map((style) => ({ ...style }));
    if (foldersChanged || !state.initiated) {
      newState.folders = normalizeFolders(newState.folders);
    }

    const validFolderIds = new Set(newState.folders.map((folder) => folder.id));
    for (const style of newState.styles) {
      const folderId = style.folder || null;
      if (!validFolderIds.has(folderId)) style.folder = null;
    }

    if (newState.openFolders) {
      if (newState.openFolders.some((id) => id !== "unsorted" && !validFolderIds.has(id))) {
        newState.openFolders = newState.openFolders.filter((id) => id === "unsorted" || validFolderIds.has(id));
      }
    }

    if (newState.defaultStyleId) {
      const hasDefault = newState.styles.find((s) => s.id === newState.defaultStyleId);
      if (!hasDefault) newState.defaultStyleId = null;
    }

    const stylesByFolder = new Map();
    for (const style of newState.styles) {
      const key = style.folder || "__unsorted__";
      if (!stylesByFolder.has(key)) stylesByFolder.set(key, []);
      stylesByFolder.get(key).push(style);
    }
    const foldersByParent = new Map();
    for (const folder of newState.folders) {
      const key = folder.parentId || "__root__";
      if (!foldersByParent.has(key)) foldersByParent.set(key, []);
      foldersByParent.get(key).push(folder);
    }
    foldersByParent.forEach((folders) => {
      folders.sort((a, b) => {
        const orderA = typeof a.order === "number" ? a.order : 0;
        const orderB = typeof b.order === "number" ? b.order : 0;
        return orderA - orderB;
      });
    });
    let sortedStyles = (stylesByFolder.get("__unsorted__") || []).concat([]);
    const appendFolderStyles = (parentId = null) => {
      const children = foldersByParent.get(parentId || "__root__") || [];
      for (const folder of children) {
        const folderStyles = stylesByFolder.get(folder.id) || [];
        sortedStyles = sortedStyles.concat(folderStyles);
        appendFolderStyles(folder.id);
      }
    };
    appendFolderStyles(null);
    newState.styles = sortedStyles;
  }

  // Phase 2: Prefix building + line parsing (only when relevant fields changed)
  if (needsLineProcessing) {
    const stylePrefixes = [];
    const folderPrefixes = [];
    const folderOnlyPrefixes = [];
    const unsortedPrefixes = [];
    const activeStyleForPrefixes =
      newState.styles.find((style) => style.id === newState.currentStyleId) ||
      state.currentStyle ||
      null;
    const currentFolder = activeStyleForPrefixes ? activeStyleForPrefixes.folder || null : null;
    for (const style of newState.styles) {
      if (style.prefixesDisabled) continue;
      const folder = style.folder || null;
      for (const prefix of style.prefixes || []) {
        if (!prefix) continue;
        const data = { prefix, style, folder };
        stylePrefixes.push(data);
        if (folder) folderOnlyPrefixes.push(data);
        else unsortedPrefixes.push(data);
        if (folder === currentFolder) folderPrefixes.push(data);
      }
    }
    const stylePrefixIndex = buildPrefixIndex(stylePrefixes);
    const folderPrefixIndex = buildPrefixIndex(folderPrefixes);
    const folderOnlyPrefixIndex = buildPrefixIndex(folderOnlyPrefixes);
    const unsortedPrefixIndex = buildPrefixIndex(unsortedPrefixes);

    // Pre-compile a single regex for all ignoreTags instead of split/join per tag per line
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ignoreTags = (newState.ignoreTags || []).filter(Boolean);
    const ignoreTagsRegex = ignoreTags.length
      ? new RegExp(ignoreTags.map(escapeRe).join("|"), "g")
      : null;

    let linesCounter = 0;
    const rawLines = newState.text ? newState.text.split("\n") : [];
    let lastTextLine = null;
    let previousStyle = null;
    const usedLineStyles = newState.usedLineStyles || {};
    const getUsedStyle = (rawIndex, rawText) => {
      const usedLineStyle = usedLineStyles[rawIndex];
      if (!usedLineStyle || usedLineStyle.rawText !== rawText) return null;
      return newState.styles.find((style) => style.id === usedLineStyle.styleId) || null;
    };
    const nextLines = rawLines.map((rawText, rawIndex) => {
      const ignorePrefix = newState.ignoreLinePrefixes.find((pr) => rawText.startsWith(pr)) || "";
      const hasStylePrefix = (
        newState.currentFolderTagPriority !== false
          ? findPrefixMatch(folderPrefixIndex, rawText)
          : (findPrefixMatch(unsortedPrefixIndex, rawText) ||
             findPrefixMatch(folderOnlyPrefixIndex, rawText))
      ) || findPrefixMatch(stylePrefixIndex, rawText);

      let stylePrefix = "";
      let style = null;

      if (rawText.startsWith("//")) {
        stylePrefix = rawText.startsWith("//:") ? "//:" : "//";
        style = previousStyle;
      } else if (hasStylePrefix) {
        stylePrefix = hasStylePrefix.prefix;
        style = hasStylePrefix.style;
      }
      const usedStyle = getUsedStyle(rawIndex, rawText);

      let text = rawText.replace(ignorePrefix, "").replace(stylePrefix, "");
      if (ignoreTagsRegex) {
        ignoreTagsRegex.lastIndex = 0;
        text = text.replace(ignoreTagsRegex, "");
      }
      text = text.trim();
      const isPage = rawText.match(/Page [0-9]+/i);
      const ignore = !!ignorePrefix || !text || isPage;
      if (isPage && newState.images.length && lastTextLine) lastTextLine.last = true;
      const lineNumberState = getNextLineNumberState({
        linesCounter,
        isPage,
        ignore,
        resetLineCounterOnPage: newState.resetLineCounterOnPage,
      });
      linesCounter = lineNumberState.linesCounter;
      const index = lineNumberState.index;
      const line = { rawText, rawIndex, ignorePrefix, stylePrefix, style, usedStyle, ignore, index, text };
      if (!line.ignore) lastTextLine = line;
      if (!line.ignore && (line.usedStyle || line.style)) {
        previousStyle = line.usedStyle || line.style;
      }
      return line;
    });
    // Reuse previous line objects when nothing changed so memoized line
    // components skip re-rendering (e.g. selecting a style rebuilds lines
    // but most of them are identical)
    const prevLines = state.lines || [];
    newState.lines = nextLines.map((line) => {
      const prev = prevLines[line.rawIndex];
      if (
        prev &&
        prev.rawIndex === line.rawIndex &&
        prev.rawText === line.rawText &&
        prev.ignorePrefix === line.ignorePrefix &&
        prev.stylePrefix === line.stylePrefix &&
        prev.style === line.style &&
        prev.usedStyle === line.usedStyle &&
        prev.ignore === line.ignore &&
        prev.index === line.index &&
        prev.text === line.text &&
        prev.last === line.last
      ) {
        return prev;
      }
      return line;
    });
  }

  // Phase 3: Update currentLine (when lines or line index changed)
  let needsStyleLookup = needsLineProcessing || lineIndexChanged || styleIdChanged;
  if (needsLineProcessing || lineIndexChanged) {
    newState.currentLine = newState.lines[newState.currentLineIndex] || null;
    if (!newState.currentLine || newState.currentLine.ignore) {
      let newIndex = 0;
      for (let line of newState.lines) {
        if (!line.ignore) {
          newIndex = line.rawIndex;
          break;
        }
      }
      newState.currentLine = newState.lines[newIndex] || null;
      newState.currentLineIndex = newIndex;
    }
    if (thenSelectStyle) {
      // Only explicit prefix styles (and // continuations) drive the style
      // picker on line change; recorded usedStyle must not override the
      // user's manual selection when advancing in multi-bubble mode (#205)
      if (newState.currentLine?.style) {
        newState.currentStyleId = newState.currentLine.style.id;
      } else if (newState.defaultStyleId) {
        newState.currentStyleId = newState.defaultStyleId;
      }
      needsStyleLookup = true;
    }
  }

  // Phase 4: Update currentStyle (when style ID or lines changed)
  if (needsStyleLookup) {
    newState.currentStyle = newState.styles.find((s) => s.id === newState.currentStyleId);
    if (!newState.currentStyle) {
      const newId = newState.styles.length ? newState.styles[0].id : null;
      newState.currentStyle = newId ? newState.styles[0] : null;
      newState.currentStyleId = newId;
    }
  }

  // Phase 5: Open folder management
  if (!newState.initiated) {
    if (newState.currentStyle?.folder) {
      newState.openFolders = [newState.currentStyle.folder];
    } else {
      newState.openFolders = ["unsorted"];
    }
  }
  if (newState.currentStyle && newState.currentStyleId !== state.currentStyleId) {
    const folder = newState.currentStyle.folder || "unsorted";
    if (!newState.openFolders.includes(folder)) newState.openFolders.push(folder);
    if (newState.autoScrollStyle) scrollToStyle(newState.currentStyleId);
  }
  if (thenScroll) {
    scrollToLine(newState.currentLineIndex);
  }

  // Phase 5.5: Mirror the per-tab fields into the active tab so tabs stay
  // consistent and persisted on every change
  if (newState.tabs && newState.tabs.length) {
    let tabIndex = newState.tabs.findIndex((tab) => tab.id === newState.currentTabId);
    if (tabIndex < 0) {
      // Recover from an invalid tab id (e.g. settings imported from an older version)
      tabIndex = 0;
      newState.currentTabId = newState.tabs[0].id;
    }
    if (tabIndex >= 0) {
      const activeTab = newState.tabs[tabIndex];
      if (tabFields.some((field) => activeTab[field] !== newState[field])) {
        const tabs = newState.tabs.concat([]);
        const updatedTab = { ...activeTab };
        tabFields.forEach((field) => {
          updatedTab[field] = newState[field];
        });
        tabs[tabIndex] = updatedTab;
        newState.tabs = tabs;
      }
    }
  }

  // Phase 6: Storage - only write if a stored field actually changed
  newState.initiated = true;
  let hasStorageChange = false;
  for (let i = 0; i < storeFields.length; i++) {
    if (newState[storeFields[i]] !== state[storeFields[i]]) {
      hasStorageChange = true;
      break;
    }
  }
  if (hasStorageChange) {
    const dataToStore = {};
    let shouldDebounceStorage = false;
    for (let i = 0; i < storeFields.length; i++) {
      const field = storeFields[i];
      if (newState.hasOwnProperty(field)) {
        dataToStore[field] = newState[field];
      }
      if (
        newState[field] !== state[field] &&
        (field === "text" || field === "currentLineIndex" || field === "currentStyleId" || field === "textScale" ||
          field === "styles" || field === "usedLineStyles" || field === "storedSelections" || field === "tabs")
      ) {
        shouldDebounceStorage = true;
      }
    }
    writeToStorage(dataToStore, false, { debounce: shouldDebounceStorage ? 300 : 0 });
  }

  return newState;
};

const Context = React.createContext();
const useContext = () => React.useContext(Context);
const ContextProvider = React.memo(function ContextProvider(props) {
  const [state, dispatch] = React.useReducer(reducer, initialState);
  React.useEffect(() => dispatch({}), []);
  React.useEffect(() => {
    setDehyphenationEnabled(state.dehyphenateTextShapeR === true);
  }, [state.dehyphenateTextShapeR]);
  React.useEffect(() => {
    const direction = state.direction === "rtl" ? "rtl" : "ltr";
    document.documentElement.setAttribute("dir", direction);
    if (document.body) {
      document.body.setAttribute("dir", direction);
    }
  }, [state.direction]);
  React.useEffect(() => {
    applyEditorTheme(state.editorTheme);
  }, [state.editorTheme]);
  React.useEffect(() => {
    if (state.checkUpdates) {
      checkUpdate(config.appVersion).then((data) => {
        if (data) {
          dispatch({ type: 'setModal', modal: 'update', data });
        }
      });
    }
  }, [state.checkUpdates]);
  const contextValue = React.useMemo(() => ({ state, dispatch }), [state, dispatch]);
  return <Context.Provider value={contextValue}>{props.children}</Context.Provider>;
});
ContextProvider.propTypes = {
  children: PropTypes.any.isRequired,
};

export { useContext, ContextProvider, defaultUiLayout, normalizeUiLayout };
