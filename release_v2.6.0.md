# 🌟 TypeR v2.6.0 - The Ultimate Selection Update

Welcome to **TypeR v2.6.0**, the definitive update that completely overhauls how Photoshop selects translation bubbles, fixes critical engine crashes, and officially adds Arabic support to the UI!

## 🧑‍💻 Lead Contributors

* Swirt, SeanR, Sakushi, **Grave**

---

## 🚀 Features & Improvements

* **Multi-Bubble Selection Support:** You can now use the `Shift` key to select multiple isolated bubbles at once using the Magic Wand or Marquee tool. TypeR will automatically identify them as separate entities, extract their individual bounds, and instantly register all of them sequentially in the UI!
* **True Arabic UI Localization:** The Arabic language is now fully selectable from the Translation Settings dropdown menu.
* **Smart Selection Engine:** The old geometric expansion logic `_checkSelection()` that caused severe lag and inaccurate bubble sizes for single bubbles has been bypassed. Every selection (single or plural) is now optimally processed through lightning-fast array clustering.
* **Contiguous Magic Wand:** Magic wand auto-selection now enforces `contiguous: true`. Clicking a bubble will no longer accidentally select matching colors across the entire comic page!

## 🐛 Bug Fixes

* **Fix "EvalScript Error" on Insert:** Retrieved and restored the missing `createTextLayersInStoredSelections` function. Attempting to insert text into multiple stored bubbles simultaneously will no longer crash Photoshop with an unhandled exception.
* **Fix Extension Unsigned Conflict:** Older versions of TypeR operated under `com.swirt.tools`, conflicting with other plugins. It has been isolated inside its own bundle ID `com.scanr.typer`, and the name explicitly set to "TypeR".
* **Fix Extension Panel Missing in Photoshop 2022+:** Modified the `install.ps1` and `install_mac.sh` installation scripts to force `PlayerDebugMode` across CSXS versions `13` through `18`, ensuring modern Photoshop displays the panel without unsigned signature blocks.
* **Cleaned GitHub Release:** Removed all debugging `.js`/`.jsx` scripts leaving a pristine production master branch.

---

## 💬 Need Help or Have Questions?

Join the original creators' community to discuss TyperTools or SwirtTools:
👉 **[Original Discord Server](https://discord.gg/dsHn3xQQTC)**

To contact Grave, provide feedback, or discuss this fork update:
👉 **[Grave's Discord Server](https://discord.gg/kk6weaMDFa)**
