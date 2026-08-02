const TAB_FIELDS = ["text", "images", "currentLineIndex", "lastOpenedImagePath", "usedLineStyles"];

const hasOwn = (object, field) => Object.prototype.hasOwnProperty.call(object, field);

const createTab = (name, data = {}, createId = () => Math.random().toString(36).substr(2, 8)) => ({
  id: createId(),
  name,
  text: typeof data.text === "string" ? data.text : "",
  images: Array.isArray(data.images) ? data.images : [],
  currentLineIndex: typeof data.currentLineIndex === "number" ? data.currentLineIndex : 0,
  lastOpenedImagePath: data.lastOpenedImagePath || null,
  usedLineStyles: data.usedLineStyles && typeof data.usedLineStyles === "object" ? data.usedLineStyles : {},
});

// Old TypeR versions keep unknown storage keys when they save. After a
// downgrade, a storage file can therefore contain a freshly written legacy
// `text` next to stale tabs. Explicit legacy fields must win during the next
// upgrade, otherwise the stale active tab hides the user's latest script.
const migrateTabStorage = (storedData, defaultName, createId) => {
  const data = storedData && typeof storedData === "object" ? storedData : {};
  let tabs = Array.isArray(data.tabs) ? data.tabs : [];
  let currentTabId = data.currentTabId;
  let migrated = false;

  if (!tabs.length) {
    const firstTab = createTab(defaultName, data, createId);
    return {
      tabs: [firstTab],
      currentTabId: firstTab.id,
      migrated: true,
    };
  }

  let activeIndex = tabs.findIndex((tab) => tab && tab.id === currentTabId);
  if (activeIndex < 0) {
    activeIndex = 0;
    currentTabId = tabs[0].id;
    migrated = true;
  }

  const activeTab = tabs[activeIndex];
  if (activeTab && TAB_FIELDS.some((field) => hasOwn(data, field) && data[field] !== activeTab[field])) {
    const migratedTab = { ...activeTab };
    TAB_FIELDS.forEach((field) => {
      if (hasOwn(data, field)) migratedTab[field] = data[field];
    });
    tabs = tabs.concat([]);
    tabs[activeIndex] = migratedTab;
    migrated = true;
  }

  return { tabs, currentTabId, migrated };
};

export { TAB_FIELDS, createTab, migrateTabStorage };
