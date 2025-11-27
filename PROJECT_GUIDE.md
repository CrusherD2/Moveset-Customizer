# Moveset Customizer - Project Guide

## Overview
A desktop application (Electron + React) for managing Super Smash Bros Ultimate moveset mods. It allows users to organize, reorder, import, disable, and share skin/alt slots for custom movesets.

---

## 🏗️ Project Structure

```
├── public/
│   └── electron.js          # Main Electron process (backend logic)
├── src/
│   ├── App.js               # Main React component
│   ├── App.css              # Global styles (dark theme)
│   ├── components/
│   │   ├── Header.js/.css   # Top navigation bar
│   │   ├── SlotGrid.js/.css # Alt slot grid with drag-drop
│   │   ├── SlotCard.js/.css # Individual slot card
│   │   ├── ImportModal.js/.css # Import skins modal
│   │   ├── StatusBar.js/.css # Bottom action bar
│   │   └── AnalysisPanel.js/.css # Config analysis results
│   └── utils/
│       ├── movesetCustomizer.js # Frontend mod logic/state
│       └── fileUtils.js     # File operation utilities
├── build/                   # Built React app (loaded by Electron)
├── dist/                    # Packaged application
├── temp_previews/           # Converted PNG previews (runtime)
└── ultimate_tex_cli.exe     # BNTX to PNG converter tool
```

---

## 🎮 Slot & Alt Naming Conventions

### Slot IDs (cXXX Format)
- **Vanilla Slots**: `c00` - `c07` (original game characters, 8 slots)
- **Custom Slots**: `c08`+ (mod-added slots)
- **Moveset Base Slot**: Typically starts at `c120` for custom movesets
- Format: `c` + zero-padded 2-3 digit number (e.g., `c00`, `c120`, `c127`)

### Alt Numbers (00-Based)
- UI files use alt numbers: `charactername_00.bntx`, `charactername_01.bntx`
- Alt 0 = Base slot (e.g., if baseSlot is `c120`, alt 0 → `c120`, alt 1 → `c121`)
- Conversion: `slotId = c${baseSlotNum + altNumber}`

### Disabled Slot Format
- Folder: `.disabled/cXXX_timestamp` or `.disabled/disabled_cXXX_timestamp`
- ID: `disabled_cXXX_timestamp` (e.g., `disabled_c118_1703555123`)

---

## 📁 Mod Folder Structure

```
(Moveset) CharacterName/
├── config.json              # Main configuration file
├── config_backup.json       # Original config backup (created on first load)
├── fighter/
│   └── {codename}/          # e.g., wolf, palutena
│       ├── model/
│       │   ├── body/c120/   # Body model files
│       │   ├── blaster/c120/ # Weapon models (optional)
│       │   └── reticle/c120/ # Reticle models (optional)
│       └── motion/
│           └── body/c120/   # Animation files (.nuanmb)
├── camera/
│   └── fighter/{codename}/c120/  # Camera data
├── sound/
│   └── bank/fighter/       # Sound files
├── effect/
│   └── fighter/{codename}/ # Effect files
├── ui/
│   └── replace/chara/
│       └── chara_X/        # UI textures (.bntx, .nutexb)
└── .disabled/              # Disabled slots storage
```

---

## ⚙️ Config.json Structure

```json
{
  "new-dir-infos-base": {
    "fighter/wolf/model/body/c120": {}
  },
  "new-dir-files": {
    "fighter/wolf/model/body/c120": [
      "fighter/wolf/model/body/c120/model.numdlb",
      "fighter/wolf/model/body/c120/texture.nutexb"
    ]
  },
  "share-to-added": {
    "fighter/wolf/model/body/c120/texture.nutexb": [
      "fighter/wolf/model/body/c121/texture.nutexb",
      "fighter/wolf/model/body/c122/texture.nutexb"
    ]
  },
  "share-to-vanilla": {
    "fighter/wolf/model/body/c120/file.ext": [
      "fighter/wolf/model/body/c00/file.ext"
    ]
  }
}
```

### Config Sections
| Section | Purpose |
|---------|---------|
| `new-dir-infos-base` | Directory metadata declarations |
| `new-dir-files` | Files that physically exist in the mod |
| `share-to-added` | File sharing between custom slots (source → targets) |
| `share-to-vanilla` | File sharing to vanilla slots |

---

## 🔄 Key Operations

### File Sharing (Deduplication)
- **Materialization**: Copying shared files physically to a slot directory
- **De-materialization**: Deleting physical files that are now shared via config
- Files are only shared if they are **binary identical** (byte-for-byte comparison)

### Transitive Sharing
- Only applies to vanilla sources (`c00`-`c07`)
- If `c00 → c120` and `c120 == c123` (binary match), then `c00 → [c120, c123]`
- Does NOT apply to custom slot sources

### Slot Operations
1. **Import**: Add new skins from another mod folder
2. **Disable**: Move slot files to `.disabled/` folder
3. **Restore**: Move files back from `.disabled/` to active
4. **Reorder**: Shift slot numbers with cascading renumbering
5. **Delete**: Permanently remove disabled slots

---

## 🎨 UI/Styling Conventions

### Color Palette (Dark Theme)
```css
--bg-primary: #1e1e1e;      /* Main background */
--bg-secondary: #2e2e2e;    /* Cards, modals */
--bg-tertiary: #3e3e3e;     /* Hover states */
--border: #404040;          /* Borders */
--text-primary: #ffffff;    /* Main text */
--text-secondary: #cccccc;  /* Secondary text */
--text-muted: #999999;      /* Muted text */
--accent-blue: #4a90d9;     /* Primary actions */
--accent-green: #4caf50;    /* Success states */
--accent-red: #f44336;      /* Danger/locked states */
--accent-orange: #ff9800;   /* Warnings */
```

### Component Patterns
- Cards: `background: #2e2e2e; border-radius: 12px; border: 1px solid #404040;`
- Buttons: Use `.btn`, `.btn-primary`, `.btn-danger` classes
- Disabled user selection: `user-select: none;` on `.app`

---

## 📡 IPC Communication

### Main Process → Renderer
- `debug-message`: Debug logging to console
- `replace-progress`: Import progress updates

### Renderer → Main Process (Handlers)
| Handler | Purpose |
|---------|---------|
| `select-directory` | Open folder dialog |
| `scan-import-folder` | Analyze import folder |
| `apply-slot-changes` | Apply all pending changes |
| `import-skins-replace` | Replace mode import |
| `delete-all-disabled` | Delete all disabled slots |
| `convert-bntx-to-png` | Convert UI texture to preview |

---

## 🔧 Development Commands

```bash
npm start          # Start React dev server
npm run build      # Build React app
npm run electron   # Run Electron
npm run desktop    # Build + Run Electron
npm run desktop-dev # Run Electron (dev mode)
npm run electron-pack # Package for distribution
```

---

## ⚠️ Critical Rules

### Vanilla Slot Preservation
- `c00`-`c07` entries in `share-to-added` MUST be preserved
- These represent vanilla game files, not physical mod files
- Check `isVanillaSlot = slotNum <= 7` before filtering

### Import Config Handling
- **DO NOT** blindly copy `share-to-added` entries where import is the SOURCE
- Import's internal sharing relationships are irrelevant to main mod
- Only copy entries where import files share FROM existing main mod sources

### Binary Comparison
- Always compare files byte-for-byte before creating share entries
- Use `Buffer.compare()` for efficiency
- Only de-materialize files that are truly identical

### Empty Directory Cleanup
- Remove empty directories after de-materialization
- Traverse bottom-up to avoid deleting non-empty parents
- Never delete the mod root directory

---

## 🐛 Common Issues & Fixes

| Issue | Cause | Solution |
|-------|-------|----------|
| Vanilla entries removed | Verification filtering all non-existent slots | Add `isVanillaSlot` exception |
| Files shared but exist | Transitive sharing applied incorrectly | Restrict to vanilla sources only |
| Import overwrites base | Materialization before import copy | Check `!fs.existsSync(importFilePath)` |
| Config corruption | String replacement collisions | Use TEMP_ markers for atomic swaps |

---

## 📝 Code Style

- **Debugging**: Use `event.sender.send('debug-message', ...)` for backend logging
- **Error Handling**: Always wrap async operations in try-catch
- **Path Normalization**: Use `.replace(/\\/g, '/')` for cross-platform paths
- **Config Writes**: Use `writeJsonPreserve()` to maintain formatting
- **State Management**: React hooks for frontend, direct mutation for backend

---

## 🔗 External Dependencies

- **React Beautiful DnD**: Drag-and-drop functionality
- **React Dropzone**: File drop zones
- **Electron**: Desktop app framework
- **ultimate_tex_cli.exe**: BNTX texture converter (external tool)

---

*Last updated: November 2025*

