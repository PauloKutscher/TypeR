const buildFolderTree = (folders) => {
  const map = new Map();
  (folders || []).forEach((folder) => {
    map.set(folder.id, { ...folder, children: [] });
  });
  const roots = [];
  map.forEach((folder) => {
    if (folder.parentId && map.has(folder.parentId)) {
      map.get(folder.parentId).children.push(folder);
    } else {
      roots.push(folder);
    }
  });
  const sortRecursive = (nodes) => {
    nodes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    nodes.forEach((node) => sortRecursive(node.children));
  };
  sortRecursive(roots);
  return roots;
};

const flattenFolderTree = (nodes, parents = [], depth = 0) => {
  const list = [];
  nodes.forEach((node) => {
    const breadcrumb = parents.concat(node.name);
    list.push({
      id: node.id,
      name: node.name,
      parentId: node.parentId || null,
      depth,
      label: breadcrumb.join(" / "),
      children: node.children || [],
    });
    list.push(...flattenFolderTree(node.children || [], breadcrumb, depth + 1));
  });
  return list;
};

const collectDescendantIds = (folders, folderId) => {
  const ids = [];
  if (!folderId) return ids;
  const queue = [folderId];
  while (queue.length) {
    const current = queue.shift();
    const children = (folders || []).filter((folder) => (folder.parentId || null) === current);
    children.forEach((child) => {
      ids.push(child.id);
      queue.push(child.id);
    });
  }
  return ids;
};

export { buildFolderTree, flattenFolderTree, collectDescendantIds };
