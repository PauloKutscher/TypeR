# Help illustrations

Drop animated GIFs here to illustrate the Help window sections. Each section
looks for one file; if the file is missing, the section simply renders without
an illustration (no broken image, no error).

| File | Section |
| --- | --- |
| `styles.gif` | Styles and folders |
| `script.gif` | Script and lines |
| `preview.gif` | Preview and size |
| `paste.gif` | Paste and align |
| `multibubble.gif` | Multi-bubble |

Guidelines:

- The panel is often used at ~350-500px wide, so keep the GIF around
  **600px wide max** and reasonably short (3-8s loop) to keep the file small.
- Images are displayed full width of the section, height is automatic.
- Captions come from the locale files (`helpSection*Media` keys), not from the
  file name.

To add a new illustrated section, set `media: '<name>'` on the section in
`app_src/components/modal/help.jsx` and drop `<name>.gif` in this folder.
This folder is copied as-is by every install/packaging script, so no build step
is needed after adding a file — but the extension must be reinstalled.
