# Moveset Customizer

<p align="center">
  <img src="icon.png" alt="Moveset Customizer" width="128" height="128">
</p>

A modern desktop application for managing Super Smash Bros Ultimate moveset mods. Built with Electron and React, featuring an intuitive dark-themed UI for customizing character slots.

## Features

- 🎨 **Modern Dark UI** - Beautiful dark theme interface with smooth animations
- 🖱️ **Drag & Drop** - Intuitive interface for reordering slots
- 📦 **Import Skins** - Import skins from other mod folders with automatic file deduplication
- 🔄 **Replace Skins** - Replace existing skins while preserving slot order
- ✨ **Smart File Sharing** - Binary comparison automatically shares identical files
- 🗑️ **Disable/Enable Slots** - Temporarily disable slots without deleting them
- 📊 **Progress Tracking** - Visual progress bar for all operations
- 🖼️ **Alt Previews** - Automatic preview generation from UI files

## Screenshots

The application features a clean, dark-themed interface:
- Main view with draggable slot cards showing character previews
- Import modal for adding skins from other mods
- Progress bar for tracking operations

## Installation

### Download Release

Download the latest `Moveset-Customizer-Portable.exe` from the [Releases](../../releases) page.

### Build from Source

#### Prerequisites
- Node.js (v16 or higher)
- npm

#### Setup

1. Clone this repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/moveset-customizer.git
   cd moveset-customizer
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run in development mode:
   ```bash
   npm run desktop-dev
   ```

4. Build for distribution:
   ```bash
   npm run dist:portable
   ```

## Usage

### Loading a Mod

1. Launch the application
2. Click "Select Mod Folder" 
3. Navigate to your SSBU moveset mod folder (must contain a `config.json`)
4. The app will load all slots with their preview images

### Managing Slots

| Action | How to |
|--------|--------|
| **Reorder** | Drag and drop slots to change their order |
| **Disable** | Drag a slot to the "Disabled Slots" section |
| **Enable** | Drag a disabled slot back to the enabled section |
| **Import** | Click "Import Skins" and select another mod folder |
| **Replace** | In Import mode, use "Replace Mode" to swap existing skins |
| **Apply** | Click "Apply Changes" to save all modifications |

### Import Skins

1. Click "Import Skins" button
2. Select a mod folder containing skins to import
3. Drag skins from the import panel to your desired position
4. Click "Apply Import" to complete

The import system automatically:
- Detects and preserves file sharing from the source mod
- Compares files to avoid duplicates
- Updates config.json with correct paths

## Technical Details

### Slot Naming Convention

- Vanilla slots: `c00` - `c07`
- Custom slots: `c08`+ (typically `c120`+ for movesets)
- Disabled format: `disabled_cXXX_timestamp`

### File Structure

```
mod-folder/
├── config.json          # Mod configuration
├── fighter/
│   └── [character]/
│       ├── model/body/  # Character models by slot
│       └── motion/      # Animation files
├── ui/replace/chara/    # UI preview images (.bntx)
├── effect/              # Effect files
└── sound/               # Audio files
```

### Key Files

| File | Purpose |
|------|---------|
| `public/electron.js` | Backend IPC handlers and file operations |
| `src/App.js` | Main React application |
| `src/utils/movesetCustomizer.js` | Mod analysis and preview loading |
| `src/components/ImportModal.js` | Import UI and logic |

## Building

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run desktop-dev` | Run in development mode |
| `npm run dist` | Build installer (.exe) |
| `npm run dist:portable` | Build portable executable |
| `npm run dist:dir` | Build unpacked directory |

### Requirements for Building

- Windows: No additional requirements
- The `ultimate_tex_cli.exe` tool is required for preview generation
  - Download from: https://github.com/ultimate-research/ultimate_tex
  - Place in the project root directory before building

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is provided as-is for the SSBU modding community.

## Acknowledgments

- Built with [Electron](https://www.electronjs.org/) and [React](https://reactjs.org/)
- Uses [react-beautiful-dnd](https://github.com/atlassian/react-beautiful-dnd) for drag and drop
- Preview conversion powered by `ultimate_tex_cli`
