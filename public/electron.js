const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');

let mainWindow;

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, 'icon.png'),
    titleBarStyle: 'default',
    show: false
  });

  // Load the app - always use local files for desktop app
  if (isDev) {
    // In development, build the React app first
    const { execSync } = require('child_process');
    try {
      console.log('Building React app for desktop...');
      execSync('npm run build', { stdio: 'inherit' });
    } catch (error) {
      console.error('Failed to build React app:', error);
    }
  }
  
  // Always load from build directory for desktop experience
  mainWindow.loadFile(path.join(__dirname, '../build/index.html'));
  
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Create window when Electron is ready
app.whenReady().then(createWindow);

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers for file system operations
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Moveset Mod Folder'
  });
  
  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('show-message', async (event, options) => {
  const result = await dialog.showMessageBox(mainWindow, options);
  return result;
});

// Import skins IPC handlers
ipcMain.handle('select-import-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Folder with Skins to Import'
  });
  
  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('scan-import-folder', async (event, importFolder) => {
  try {
    // Scan the import folder for alts (similar to main mod detection)
    const result = {
      folder: importFolder,
      slots: [],
      configPath: null,
      fighterCodename: null,
      displayName: null,
      baseSlotNum: null
    };
    
    // Check if config.json exists in the import folder
    const configPath = path.join(importFolder, 'config.json');
    if (fs.existsSync(configPath)) {
      result.configPath = configPath;
      try {
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        // We'll use this later for merging
      } catch (e) {
        console.error('Error reading import config:', e);
      }
    }
    
    // Detect fighter codename from fighter directory
    const fighterDir = path.join(importFolder, 'fighter');
    if (fs.existsSync(fighterDir)) {
      const fighterEntries = fs.readdirSync(fighterDir, { withFileTypes: true });
      const fighterFolders = fighterEntries.filter(e => e.isDirectory()).map(e => e.name);
      if (fighterFolders.length > 0) {
        result.fighterCodename = fighterFolders[0]; // Take first fighter folder
      }
    }
    
    // Detect slots from UI files (similar to main detection logic)
    // Use a Map to track unique alts by alt number
    const uniqueAlts = new Map();
    const uiPath = path.join(importFolder, 'ui', 'replace', 'chara');
    if (fs.existsSync(uiPath)) {
      const uiDirs = fs.readdirSync(uiPath, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
      
      for (const dir of uiDirs) {
        const charaDirPath = path.join(uiPath, dir);
        const files = fs.readdirSync(charaDirPath);
        
        // Look for UI files with slot numbers
        for (const file of files) {
          if (file.endsWith('.bntx') || file.endsWith('.nutexb')) {
            // Extract slot number from filename patterns like chara_0_name_00.bntx
            const match = file.match(/_(\d{2})\.(bntx|nutexb)$/);
            if (match) {
              const altNum = parseInt(match[1]);
              const slotPath = path.join(charaDirPath, file);
              
              // Only add if we haven't seen this alt number yet (avoid counting duplicates from multiple chara folders)
              if (!uniqueAlts.has(altNum)) {
                uniqueAlts.set(altNum, {
                  altNumber: altNum,
                  uiFile: slotPath,
                  selected: false
                });
              }
            }
          }
        }
      }
    }
    
    // Convert Map to array
    result.slots = Array.from(uniqueAlts.values());
    
    // Detect actual slot folders from model/body directory
    // This is crucial: skins may use vanilla slot numbers (c00-c07) while moveset uses custom (c120+)
    if (result.fighterCodename) {
      const modelBodyPath = path.join(importFolder, 'fighter', result.fighterCodename, 'model', 'body');
      if (fs.existsSync(modelBodyPath)) {
        const bodyEntries = fs.readdirSync(modelBodyPath, { withFileTypes: true });
        const slotFolders = bodyEntries
          .filter(e => e.isDirectory() && /^c\d+$/.test(e.name))
          .map(e => e.name)
          .sort((a, b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));
        
        if (slotFolders.length > 0) {
          result.baseSlotNum = parseInt(slotFolders[0].substring(1));
          
          // Store the actual slot folder names for each alt
          // Map alt numbers to actual slot folder names
          result.actualSlotFolders = {};
          for (const slotFolder of slotFolders) {
            const slotNum = parseInt(slotFolder.substring(1));
            // Try to match slot folder to alt number
            // For vanilla-style skins: c06 has alt 6
            // For moveset-style: c126 with base 120 has alt 6
            result.actualSlotFolders[slotNum] = slotFolder;
          }
          
          // Update slots with actual slot IDs
          for (const slot of result.slots) {
            // PRIORITY 1: If there's only one slot folder, use it unconditionally
            // This handles most single-skin imports regardless of naming conventions
            if (slotFolders.length === 1) {
              slot.actualSlotId = slotFolders[0];
              console.log(`[scan-import] Alt ${slot.altNumber}: Only one folder exists, using ${slotFolders[0]}`);
              continue;
            }
            
            // PRIORITY 2: For multi-slot imports, try to match by various methods
            // First try: direct match (altNumber = slotNum for vanilla skins like c06 for alt 6)
            const directMatch = `c${slot.altNumber.toString().padStart(2, '0')}`;
            const slotNumMatch = `c${slot.altNumber}`;
            
            // Check if a slot folder matches the alt number directly (vanilla skin style)
            if (slotFolders.includes(directMatch)) {
              slot.actualSlotId = directMatch;
              console.log(`[scan-import] Alt ${slot.altNumber}: Direct match ${directMatch}`);
            } else if (slotFolders.includes(slotNumMatch)) {
              slot.actualSlotId = slotNumMatch;
              console.log(`[scan-import] Alt ${slot.altNumber}: Slot num match ${slotNumMatch}`);
            } else {
              // For moveset-style skins, calculate: slotId = baseSlotNum + altNumber
              const calculatedSlotId = `c${result.baseSlotNum + slot.altNumber}`;
              if (slotFolders.includes(calculatedSlotId)) {
                slot.actualSlotId = calculatedSlotId;
                console.log(`[scan-import] Alt ${slot.altNumber}: Calculated match ${calculatedSlotId}`);
              } else {
                // No match found - this shouldn't happen for well-formed skins
                console.log(`[scan-import] Alt ${slot.altNumber}: No matching folder found in ${slotFolders.join(', ')}`);
              }
            }
          }
        }
      }
    }
    
    // Detect display fighter name from UI files
    result.displayName = detectDisplayFighterName(importFolder);
    
    // Sort slots by alt number
    result.slots.sort((a, b) => a.altNumber - b.altNumber);
    
    return result;
  } catch (error) {
    console.error('Error scanning import folder:', error);
    throw error;
  }
});

ipcMain.handle('convert-ui-to-preview', async (event, uiFilePath, previewId) => {
  try {
    // Create preview in temp_previews folder
    // Use app's userData path for production, or project root for dev
    let tempPreviewsDir;
    if (isDev) {
      tempPreviewsDir = path.join(__dirname, '..', 'temp_previews');
    } else {
      // In production, use the app's directory
      tempPreviewsDir = path.join(path.dirname(app.getPath('exe')), 'temp_previews');
    }
    
    if (!fs.existsSync(tempPreviewsDir)) {
      fs.mkdirSync(tempPreviewsDir, { recursive: true });
    }
    
    const outputPath = path.join(tempPreviewsDir, `${previewId}.png`);
    
    // Find ultimate_tex_cli.exe - check multiple locations for dev and production
    const possiblePaths = [
      // Production: same directory as the exe
      path.join(path.dirname(app.getPath('exe')), 'ultimate_tex_cli.exe'),
      // Development paths
      path.join(__dirname, '..', 'ultimate_tex_cli.exe'),
      path.join(__dirname, '..', '..', 'ultimate_tex_cli.exe'),
      path.join(__dirname, 'ultimate_tex_cli.exe'),
      // Also check resources folder in production
      path.join(path.dirname(app.getPath('exe')), 'resources', 'ultimate_tex_cli.exe')
    ];
    
    let ultimateTexPath = null;
    for (const checkPath of possiblePaths) {
      event.sender.send('debug-message', `[DEBUG] Checking for ultimate_tex_cli at: ${checkPath}`);
      if (fs.existsSync(checkPath)) {
        ultimateTexPath = checkPath;
        break;
      }
    }
    
    if (!ultimateTexPath) {
      event.sender.send('debug-message', `[DEBUG] ultimate_tex_cli.exe not found! Checked paths: ${possiblePaths.join(', ')}`);
      console.log('[DEBUG] ultimate_tex_cli.exe not found for import preview');
      return null;
    }
    
    // Convert using ultimate_tex_cli
    const { spawn } = require('child_process');
    
    event.sender.send('debug-message', `[DEBUG] Converting import preview: ${uiFilePath} -> ${outputPath}`);
    event.sender.send('debug-message', `[DEBUG] Using ultimate_tex_cli: ${ultimateTexPath}`);
    
    return new Promise((resolve, reject) => {
      const process = spawn(ultimateTexPath, [uiFilePath, outputPath]);
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('close', (code) => {
        if (stdout) event.sender.send('debug-message', `[DEBUG] ultimate_tex_cli stdout: ${stdout}`);
        if (stderr) event.sender.send('debug-message', `[DEBUG] ultimate_tex_cli stderr: ${stderr}`);
        
        if (code === 0 && fs.existsSync(outputPath)) {
          event.sender.send('debug-message', `[DEBUG] Import preview conversion successful: ${outputPath}`);
          resolve(outputPath);
        } else {
          event.sender.send('debug-message', `[DEBUG] Import preview conversion failed: code=${code}, exists=${fs.existsSync(outputPath)}`);
          resolve(null);
        }
      });
      
      process.on('error', (err) => {
        event.sender.send('debug-message', `[DEBUG] Error spawning ultimate_tex_cli: ${err.message}`);
        resolve(null);
      });
    });
  } catch (error) {
    event.sender.send('debug-message', `[DEBUG] Exception in convert-ui-to-preview: ${error.message}`);
    console.error('Error in convert-ui-to-preview:', error);
    return null;
  }
});

// Import skins - add mode (adds to disabled area for manual organization)
ipcMain.handle('import-skins-add', async (event, { importData, selectedAlts, mainModPath, mainModBaseSlot, fighterCodename }) => {
  try {
    const results = {
      success: false,
      addedSlots: [],
      errors: []
    };
    
    const importBaseSlot = importData.baseSlotNum;
    const disabledDir = path.join(mainModPath, '.disabled');
    
    // Create .disabled directory if it doesn't exist
    if (!fs.existsSync(disabledDir)) {
      fs.mkdirSync(disabledDir, { recursive: true });
    }
    
    event.sender.send('debug-message', `[DEBUG] Import: Adding ${selectedAlts.length} skins to disabled area`);
    
    // Step 1: Compare base alts to determine if we need pre-processing
    const mainBaseSlotId = `c${mainModBaseSlot}`;
    const importBaseSlotId = `c${importBaseSlot}`;
    
    event.sender.send('debug-message', `[DEBUG] Comparing base alts: Main ${mainBaseSlotId} vs Import ${importBaseSlotId}`);
    const baseAltsMatch = await compareBaseAlts(mainModPath, importData.folder, mainBaseSlotId, importBaseSlotId, fighterCodename, event);
    
    if (baseAltsMatch) {
      event.sender.send('debug-message', `[DEBUG] Base alts are identical - standard import flow`);
    } else {
      event.sender.send('debug-message', `[DEBUG] Base alts are DIFFERENT - will pre-copy shared files for selected alts`);
      
      // Pre-copy shared files from import base to selected alts in the import folder
      if (importData.configPath && fs.existsSync(importData.configPath)) {
        const importConfig = JSON.parse(fs.readFileSync(importData.configPath, 'utf8'));
        
        for (const slot of selectedAlts) {
          const importAltNum = slot.altNumber;
          const importSlotNum = importBaseSlot + importAltNum;
          const importSlotId = `c${importSlotNum}`;
          
          event.sender.send('debug-message', `[DEBUG] Pre-copying shared files for ${importSlotId} from ${importBaseSlotId}`);
          await preCopySharedFilesForImport(importData.folder, importConfig, importBaseSlotId, importSlotId, event);
        }
      }
    }
    
    // For each selected alt
    for (const slot of selectedAlts) {
      try {
        const importAltNum = slot.altNumber;
        const importSlotNum = importBaseSlot + importAltNum;
        const importSlotId = `c${importSlotNum}`;
        
        // Create a unique disabled ID with timestamp
        const timestamp = Date.now();
        const disabledId = `${importSlotId}_${timestamp}`;
        const disabledSlotPath = path.join(disabledDir, disabledId);
        
        event.sender.send('debug-message', `[DEBUG] Importing ${importSlotId} (alt ${importAltNum}) -> ${disabledId}`);
        
        // Create disabled slot directory
        if (!fs.existsSync(disabledSlotPath)) {
          fs.mkdirSync(disabledSlotPath, { recursive: true });
        }
        
        // Copy all files for this slot from import folder to disabled folder
        await copySlotFilesToDisabled(importData.folder, disabledSlotPath, importSlotId, importData.fighterCodename, importBaseSlot, importData.displayFighterName, event);
        
        // Create backup config for this disabled slot
        if (importData.configPath && fs.existsSync(importData.configPath)) {
          await createDisabledImportConfig(disabledSlotPath, importData.configPath, importSlotId, importBaseSlot, event);
        }
        
        results.addedSlots.push({
          importSlot: importSlotId,
          disabledId: disabledId,
          altNumber: importAltNum
        });
      } catch (error) {
        event.sender.send('debug-message', `[DEBUG] Error importing alt ${slot.altNumber}: ${error.message}`);
        results.errors.push(`Alt ${slot.altNumber}: ${error.message}`);
      }
    }
    
    results.success = results.addedSlots.length > 0;
    return results;
  } catch (error) {
    console.error('Error in import-skins-add:', error);
    throw error;
  }
});

// Helper function to move all files for a slot to disabled folder
async function moveSlotFilesToDisabled(mainModPath, disabledSlotPath, slotId, fighterCodename, baseSlotNum, displayName, event, preserveMotion = false, preserveModelFolders = [], preserveEffect = false) {
  // Use comprehensive file finding to get ALL files for this slot
  const files = await findAllSlotFiles(mainModPath, slotId, baseSlotNum, fighterCodename, displayName);
  
  let filesToMove = [...files.fighter, ...files.ui, ...files.sound, ...files.effect, ...files.camera];
  
  // If preserveMotion is true, filter out motion files
  if (preserveMotion) {
    const motionPathPattern = path.join('fighter', fighterCodename, 'motion').replace(/\\/g, '/');
    const originalCount = filesToMove.length;
    filesToMove = filesToMove.filter(file => {
      const relativePath = path.relative(mainModPath, file).replace(/\\/g, '/');
      return !relativePath.includes(motionPathPattern);
    });
    const motionFilesKept = originalCount - filesToMove.length;
    event.sender.send('debug-message', `[DEBUG] 🎭 Preserving ${motionFilesKept} motion files for ${slotId} (not moving to disabled)`);
  }
  
  // If preserveModelFolders is provided, filter out those model subfolders
  if (preserveModelFolders.length > 0) {
    const originalCount = filesToMove.length;
    filesToMove = filesToMove.filter(file => {
      const relativePath = path.relative(mainModPath, file).replace(/\\/g, '/');
      
      // Check if this file is in any of the model subfolders to preserve
      for (const subfolder of preserveModelFolders) {
        const modelSubfolderPattern = `fighter/${fighterCodename}/model/${subfolder}/`;
        if (relativePath.includes(modelSubfolderPattern)) {
          return false; // Don't move this file
        }
      }
      return true; // Move this file
    });
    const modelFilesKept = originalCount - filesToMove.length;
    event.sender.send('debug-message', `[DEBUG] 📁 Preserving ${modelFilesKept} files from model subfolder(s): ${preserveModelFolders.join(', ')}`);
  }
  
  // If preserveEffect is true, filter out effect files
  if (preserveEffect) {
    const effectFilePattern = `effect/fighter/${fighterCodename}/ef_${fighterCodename}_${slotId}.eff`;
    const originalCount = filesToMove.length;
    filesToMove = filesToMove.filter(file => {
      const relativePath = path.relative(mainModPath, file).replace(/\\/g, '/');
      return !relativePath.includes(effectFilePattern);
    });
    const effectFilesKept = originalCount - filesToMove.length;
    if (effectFilesKept > 0) {
      event.sender.send('debug-message', `[DEBUG] 💥 Preserving ${effectFilesKept} effect file(s) for ${slotId} (not moving to disabled)`);
    }
  }
  
  // Handle case where this slot is a source in share-to-added
  // We need to copy files to targets before disabling
  const configPath = path.join(mainModPath, 'config.json');
  if (fs.existsSync(configPath)) {
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (configData['share-to-added']) {
      for (const [source, targets] of Object.entries(configData['share-to-added'])) {
        if (source.includes(`/${slotId}/`)) {
          const targetArray = Array.isArray(targets) ? targets : [targets];
          event.sender.send('debug-message', `[DEBUG] ${slotId} is a source, copying files to targets: ${targetArray.join(', ')}`);
          
          for (const target of targetArray) {
            if (target.includes('/')) {
              // Extract target slot from path like "fighter/wolf/motion/body/c122/file.nuanmb"
              const targetMatch = target.match(/\/c(\d+)\//);
              if (targetMatch) {
                const targetSlot = `c${targetMatch[1]}`;
                if (targetSlot !== slotId) {
                  // Copy the source file to the target location
                  const sourceFile = path.join(mainModPath, source);
                  const targetFile = path.join(mainModPath, target);
                  
                  if (fs.existsSync(sourceFile)) {
                    const targetDir = path.dirname(targetFile);
                    if (!fs.existsSync(targetDir)) {
                      fs.mkdirSync(targetDir, { recursive: true });
                    }
                    fs.copyFileSync(sourceFile, targetFile);
                    event.sender.send('debug-message', `[DEBUG] Copied ${source} to ${target}`);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  event.sender.send('debug-message', `[DEBUG] Moving ${filesToMove.length} files for ${slotId} to disabled: fighter=${files.fighter.length}, ui=${files.ui.length}, sound=${files.sound.length}, effect=${files.effect.length}, camera=${files.camera.length}`);
  
  // Debug: List all fighter files being moved to disabled
  if (files.fighter.length > 0 && !preserveMotion) {
    event.sender.send('debug-message', `[DEBUG] Fighter files being moved to disabled:`);
    for (const file of files.fighter) {
      const relativePath = path.relative(mainModPath, file);
      event.sender.send('debug-message', `[DEBUG]   ${relativePath}`);
    }
  }
  
  // Move files to disabled folder
  for (const filePath of filesToMove) {
    try {
      if (fs.existsSync(filePath)) {
        // Calculate relative path from mainModPath
        const relativePath = path.relative(mainModPath, filePath);
        const targetPath = path.join(disabledSlotPath, relativePath);
        
        // Ensure target directory exists
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        
        // Move file or directory
        if (fs.statSync(filePath).isDirectory()) {
          // Copy directory recursively and then remove original
          fs.cpSync(filePath, targetPath, { recursive: true });
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.renameSync(filePath, targetPath);
        }
      }
    } catch (error) {
      event.sender.send('debug-message', `[DEBUG] Error moving ${filePath}: ${error.message}`);
    }
  }
}

// Helper function to create a backup config for a disabled slot from main config
async function createDisabledConfigFromMain(disabledSlotPath, slotId, mainConfig, event) {
  const backupConfig = {
    'new-dir-infos': [],
    'new-dir-infos-base': {},
    'new-dir-files': {},
    'share-to-added': {},
    'share-to-vanilla': {}
  };
  
  // Helper to check if entry is relevant to this slot
  const isRelevantToSlot = (str) => {
    if (typeof str !== 'string') return false;
    // Check for path patterns like /c122/ or /c122, and filename patterns like _c122.
    return str.includes(`/${slotId}/`) || str.includes(`/${slotId}`) || str.includes(`_${slotId}.`);
  };
  
  // Helper to convert slot references to disabled format
  const convertToDisabledFormat = (str) => {
    if (typeof str !== 'string') return str;
    return str.replace(new RegExp(`/${slotId}/`, 'g'), `/disabled_${slotId}/`)
              .replace(new RegExp(`/${slotId}$`, 'g'), `/disabled_${slotId}`)
              .replace(new RegExp(`^${slotId}/`, 'g'), `disabled_${slotId}/`)
              .replace(new RegExp(`^${slotId}$`, 'g'), `disabled_${slotId}`)
              .replace(new RegExp(`_${slotId}\\.`, 'g'), `_disabled_${slotId}.`);  // Handle filenames like se_wolf_c122.nus3audio
  };
  
  // Extract new-dir-infos
  if (mainConfig['new-dir-infos'] && Array.isArray(mainConfig['new-dir-infos'])) {
    backupConfig['new-dir-infos'] = mainConfig['new-dir-infos']
      .filter(entry => isRelevantToSlot(entry))
      .map(entry => convertToDisabledFormat(entry));
  }
  
  // Extract new-dir-infos-base
  if (mainConfig['new-dir-infos-base'] && typeof mainConfig['new-dir-infos-base'] === 'object') {
    for (const [key, value] of Object.entries(mainConfig['new-dir-infos-base'])) {
      if (isRelevantToSlot(key)) {
        const disabledKey = convertToDisabledFormat(key);
        backupConfig['new-dir-infos-base'][disabledKey] = convertToDisabledFormat(value);
      }
    }
  }
  
  // Extract new-dir-files
  if (mainConfig['new-dir-files'] && typeof mainConfig['new-dir-files'] === 'object') {
    for (const [dirKey, files] of Object.entries(mainConfig['new-dir-files'])) {
      if (isRelevantToSlot(dirKey)) {
        const disabledDirKey = convertToDisabledFormat(dirKey);
        // Convert file paths in the array to disabled format
        const disabledFiles = Array.isArray(files) ? files.map(convertToDisabledFormat) : convertToDisabledFormat(files);
        backupConfig['new-dir-files'][disabledDirKey] = disabledFiles;
      }
    }
  }
  
  // Extract share-to-added (where slot is source OR target)
  if (mainConfig['share-to-added'] && typeof mainConfig['share-to-added'] === 'object') {
    for (const [source, targets] of Object.entries(mainConfig['share-to-added'])) {
      const targetArray = Array.isArray(targets) ? targets : [targets];
      
      // Case 1: This slot is the source - include only targets that are this slot
      if (isRelevantToSlot(source)) {
        const relevantTargets = targetArray.filter(t => isRelevantToSlot(t));
        if (relevantTargets.length > 0) {
          const disabledSource = convertToDisabledFormat(source);
          const disabledTargets = relevantTargets.map(t => convertToDisabledFormat(t));
          backupConfig['share-to-added'][disabledSource] = disabledTargets;
        }
      }
      // Case 2: This slot is a target - include the source and this slot as target
      else if (targetArray.some(t => isRelevantToSlot(t))) {
        const relevantTargets = targetArray.filter(t => isRelevantToSlot(t));
        if (relevantTargets.length > 0) {
          const disabledTargets = relevantTargets.map(t => convertToDisabledFormat(t));
          backupConfig['share-to-added'][source] = disabledTargets;
        }
      }
    }
  }
  
  // Extract share-to-vanilla
  if (mainConfig['share-to-vanilla'] && typeof mainConfig['share-to-vanilla'] === 'object') {
    for (const [source, targets] of Object.entries(mainConfig['share-to-vanilla'])) {
      if (isRelevantToSlot(source)) {
        const disabledSource = convertToDisabledFormat(source);
        backupConfig['share-to-vanilla'][disabledSource] = targets;
      }
    }
  }
  
  // Write backup config (preserve original formatting)
  const backupPath = path.join(disabledSlotPath, 'config_backup.json');
  writeJsonPreserve(backupPath, backupConfig);
  event.sender.send('debug-message', `[DEBUG] Created backup config for disabled slot at ${backupPath}`);
}

// Helper function to copy all files for a slot to disabled folder
async function copySlotFilesToDisabled(importFolder, disabledSlotPath, importSlotId, fighterCodename, importBaseSlot, displayName, event) {
  const filesToCopy = [];
  
  // 1. Fighter files (model, motion, etc.)
  if (fighterCodename) {
    const fighterPath = path.join(importFolder, 'fighter', fighterCodename);
    if (fs.existsSync(fighterPath)) {
      findSlotFilesRecursive(fighterPath, importSlotId, filesToCopy);
    }
  }
  
  // 2. UI files - special handling because they use alt numbers, not slot IDs
  // e.g., c110 (base 104) = alt 6, so files are named chara_X_brolyz_06.bntx
  const uiPath = path.join(importFolder, 'ui');
  if (fs.existsSync(uiPath)) {
    const slotNumber = parseInt(importSlotId.substring(1));
    const altNumber = slotNumber - importBaseSlot;
    const altString = altNumber.toString().padStart(2, '0');
    event.sender.send('debug-message', `[DEBUG] Looking for UI files with alt number ${altNumber} (${altString}) for slot ${importSlotId}`);
    
    // Find UI files recursively
    function findUIFiles(dir, results = []) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findUIFiles(fullPath, results);
        } else if (entry.isFile()) {
          // Match files like chara_0_brolyz_06.bntx or chara_1_brolyz_06.nutexb
          if (entry.name.match(new RegExp(`_${altString}\\.(bntx|nutexb|png)$`, 'i'))) {
            results.push(fullPath);
            event.sender.send('debug-message', `[DEBUG] Found UI file: ${entry.name}`);
          }
        }
      }
      return results;
    }
    
    const uiFiles = findUIFiles(uiPath);
    filesToCopy.push(...uiFiles);
  }
  
  // 3. Sound files
  const soundPath = path.join(importFolder, 'sound');
  if (fs.existsSync(soundPath)) {
    findSlotFilesRecursive(soundPath, importSlotId, filesToCopy);
  }
  
  // 4. Effect files
  const effectPath = path.join(importFolder, 'effect');
  if (fs.existsSync(effectPath)) {
    findSlotFilesRecursive(effectPath, importSlotId, filesToCopy);
  }
  
  // 5. Camera files
  const cameraPath = path.join(importFolder, 'camera');
  if (fs.existsSync(cameraPath)) {
    findSlotFilesRecursive(cameraPath, importSlotId, filesToCopy);
  }
  
  event.sender.send('debug-message', `[DEBUG] Found ${filesToCopy.length} files to copy to disabled for ${importSlotId}`);
  
  // Copy files to disabled folder
  for (const sourceFile of filesToCopy) {
    const relativePath = path.relative(importFolder, sourceFile);
    const targetPath = path.join(disabledSlotPath, relativePath);
    
    // Create target directory
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Copy file
    fs.copyFileSync(sourceFile, targetPath);
  }
  
  event.sender.send('debug-message', `[DEBUG] Copied ${filesToCopy.length} files to disabled folder`);
}

// Helper function to create backup config for disabled import slot
async function createDisabledImportConfig(disabledSlotPath, importConfigPath, importSlotId, importBaseSlot, event) {
  const importConfig = JSON.parse(fs.readFileSync(importConfigPath, 'utf8'));
  
  // Debug: Log full config sections
  event.sender.send('debug-message', `[DEBUG] Import config has: new-dir-infos=${importConfig['new-dir-infos']?.length || 0}, new-dir-files=${importConfig['new-dir-files']?.length || 0}, share-to-added=${Object.keys(importConfig['share-to-added'] || {}).length}, share-to-vanilla=${Object.keys(importConfig['share-to-vanilla'] || {}).length}`);
  
  const backupConfig = {
    'new-dir-infos': [],
    'new-dir-infos-base': {},
    'new-dir-files': {},
    'share-to-added': {},
    'share-to-vanilla': {}
  };
  
  // Helper to check if entry is relevant to this slot
  const isRelevantToSlot = (entry) => {
    if (typeof entry === 'string') {
      return entry.includes(importSlotId);
    }
    return false;
  };
  
  // Copy ALL config data for this slot from import config
  // new-dir-infos: copy all entries that mention this slot
  if (importConfig['new-dir-infos']) {
    if (Array.isArray(importConfig['new-dir-infos'])) {
      backupConfig['new-dir-infos'] = importConfig['new-dir-infos'].filter(isRelevantToSlot);
    }
  }
  
  // new-dir-infos-base: copy all entries where key mentions this slot
  if (importConfig['new-dir-infos-base'] && typeof importConfig['new-dir-infos-base'] === 'object') {
    for (const [key, value] of Object.entries(importConfig['new-dir-infos-base'])) {
      if (isRelevantToSlot(key)) {
        backupConfig['new-dir-infos-base'][key] = value;
      }
    }
  }
  
  // new-dir-files: copy all entries that mention this slot (object structure: directory keys with file arrays as values)
  if (importConfig['new-dir-files'] && typeof importConfig['new-dir-files'] === 'object') {
    for (const [dirKey, files] of Object.entries(importConfig['new-dir-files'])) {
      if (dirKey.includes(importSlotId)) {
        backupConfig['new-dir-files'][dirKey] = files;
      }
    }
  } else if (importConfig['new-dir-files'] && Array.isArray(importConfig['new-dir-files'])) {
    // Handle legacy array format - convert to object format
    for (const filePath of importConfig['new-dir-files']) {
      if (filePath.includes(importSlotId)) {
        // Extract directory from file path
        const dirPath = path.dirname(filePath).replace(/\\/g, '/');
        if (!backupConfig['new-dir-files'][dirPath]) {
          backupConfig['new-dir-files'][dirPath] = [];
        }
        backupConfig['new-dir-files'][dirPath].push(filePath);
      }
    }
  }
  
  // share-to-added: copy ONLY entries where this slot is the SOURCE
  // (Not where it's just mentioned as a target in someone else's sharing)
  if (importConfig['share-to-added'] && typeof importConfig['share-to-added'] === 'object') {
    for (const [source, targets] of Object.entries(importConfig['share-to-added'])) {
      // Only include if this slot is the SOURCE of the sharing
      if (isRelevantToSlot(source)) {
        backupConfig['share-to-added'][source] = targets;
      }
    }
  }
  
  // share-to-vanilla: copy ALL entries where source mentions this slot
  if (importConfig['share-to-vanilla'] && typeof importConfig['share-to-vanilla'] === 'object') {
    for (const [source, targets] of Object.entries(importConfig['share-to-vanilla'])) {
      if (isRelevantToSlot(source)) {
        backupConfig['share-to-vanilla'][source] = targets;
      }
    }
  }
  
  // ADDITIONALLY: Scan the actual copied files and add them to new-dir-files
  // This ensures we have complete file listings even if the import config is incomplete
  event.sender.send('debug-message', `[DEBUG] Scanning disabled folder for actual files: ${disabledSlotPath}`);
  
  function scanForFiles(dir, baseDir, fileList = []) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      
      // Skip config_backup.json
      if (entry.name === 'config_backup.json') continue;
      
      if (entry.isDirectory()) {
        // Add directory entries (but don't recurse into them for now)
        if (relativePath.includes(importSlotId)) {
          fileList.push(relativePath);
        }
        // Recurse into subdirectories
        scanForFiles(fullPath, baseDir, fileList);
      } else if (entry.isFile()) {
        // Add file entries
        if (relativePath.includes(importSlotId)) {
          fileList.push(relativePath);
        }
      }
    }
    return fileList;
  }
  
  const scannedFiles = scanForFiles(disabledSlotPath, disabledSlotPath);
  event.sender.send('debug-message', `[DEBUG] Found ${scannedFiles.length} files/dirs in disabled folder`);
  
  // Merge scanned files into new-dir-files (object structure: directory keys with file arrays as values)
  for (const filePath of scannedFiles) {
    const dirPath = path.dirname(filePath).replace(/\\/g, '/');
    if (!backupConfig['new-dir-files'][dirPath]) {
      backupConfig['new-dir-files'][dirPath] = [];
    }
    if (!backupConfig['new-dir-files'][dirPath].includes(filePath)) {
      backupConfig['new-dir-files'][dirPath].push(filePath);
    }
  }
  
  // Write backup config (preserve original formatting)
  const backupConfigPath = path.join(disabledSlotPath, 'config_backup.json');
  writeJsonPreserve(backupConfigPath, backupConfig);
  
  event.sender.send('debug-message', `[DEBUG] Created backup config with: new-dir-infos=${backupConfig['new-dir-infos'].length}, new-dir-files=${Object.keys(backupConfig['new-dir-files']).length} dirs, share-to-added=${Object.keys(backupConfig['share-to-added']).length}, share-to-vanilla=${Object.keys(backupConfig['share-to-vanilla']).length}`);
}

// Helper function to find all files for a slot (comprehensive version that handles UI alt numbers)
async function findAllSlotFiles(folder, slotId, baseSlotNum, fighterCodename, displayName) {
  const files = {
    fighter: [],
    ui: [],
    sound: [],
    effect: [],
    camera: []
  };
  
  // Calculate alt number from slot ID (e.g., c109 with base 104 = alt 5)
  const slotNum = parseInt(slotId.substring(1));
  const altNum = slotNum - baseSlotNum;
  const altStr = altNum.toString().padStart(2, '0');
  
  // 1. Fighter files - look for slot ID in path or filename
  if (fighterCodename) {
    const fighterPath = path.join(folder, 'fighter', fighterCodename);
    if (fs.existsSync(fighterPath)) {
      findSlotFilesRecursive(fighterPath, slotId, files.fighter);
    }
  }
  
  // 2. UI files - look for alt number pattern (e.g., _05.bntx, _05.nutexb)
  const uiPath = path.join(folder, 'ui');
  if (fs.existsSync(uiPath)) {
    findUIFilesForAlt(uiPath, altStr, displayName, files.ui);
  }
  
  // 3. Sound files - look for slot ID pattern
  const soundPath = path.join(folder, 'sound');
  if (fs.existsSync(soundPath)) {
    findSlotFilesRecursive(soundPath, slotId, files.sound);
  }
  
  // 4. Effect files - look for slot ID pattern
  const effectPath = path.join(folder, 'effect');
  if (fs.existsSync(effectPath)) {
    findSlotFilesRecursive(effectPath, slotId, files.effect);
  }
  
  // 5. Camera files - look for slot ID pattern
  const cameraPath = path.join(folder, 'camera');
  if (fs.existsSync(cameraPath)) {
    findSlotFilesRecursive(cameraPath, slotId, files.camera);
  }
  
  return files;
}

// Helper to find UI files by alt number
function findUIFilesForAlt(uiPath, altStr, displayName, results) {
  try {
    const searchDirs = [uiPath];
    const visited = new Set();
    
    while (searchDirs.length > 0) {
      const dir = searchDirs.pop();
      if (visited.has(dir)) continue;
      visited.add(dir);
      
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          searchDirs.push(fullPath);
        } else if (item.isFile()) {
          // Look for files with alt number pattern: _XX. where XX is the alt number
          const patterns = [
            `_${altStr}.`,           // e.g., _05.bntx
            `_${altStr}_`,           // e.g., _05_something
            `_${parseInt(altStr)}.`, // e.g., _5.bntx (without leading zero)
          ];
          
          if (patterns.some(pattern => item.name.includes(pattern))) {
            results.push(fullPath);
          }
        }
      }
    }
  } catch (error) {
    // Ignore errors
  }
}

// Helper function to detect display fighter name from UI files
function detectDisplayFighterName(modPath) {
  try {
    const uiPath = path.join(modPath, 'ui', 'replace', 'chara');
    if (!fs.existsSync(uiPath)) return null;
    
    // Look for any chara_X_DISPLAYNAME_XX.bntx file
    const searchDirs = [uiPath];
    while (searchDirs.length > 0) {
      const dir = searchDirs.shift();
      const items = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const item of items) {
        if (item.isDirectory()) {
          searchDirs.push(path.join(dir, item.name));
        } else if (item.isFile() && item.name.match(/chara_\d+_(.+?)_\d+\.(bntx|nutexb)/i)) {
          const match = item.name.match(/chara_\d+_(.+?)_\d+\.(bntx|nutexb)/i);
          if (match) {
            return match[1]; // Return the display name (e.g., "shadow", "wolf", etc.)
          }
        }
      }
    }
  } catch (error) {
    // Ignore errors
  }
  return null;
}

// Helper function to copy all files for a slot
async function copySlotFiles(importFolder, mainModPath, importSlotId, targetSlotId, fighterCodename, importBaseSlot, mainBaseSlot, importDisplayName, mainDisplayName, event) {
  // Find all files for this slot
  const importFiles = await findAllSlotFiles(importFolder, importSlotId, importBaseSlot, fighterCodename, importDisplayName);
  
  const totalFiles = importFiles.fighter.length + importFiles.ui.length + importFiles.sound.length + importFiles.effect.length + importFiles.camera.length;
  
  event.sender.send('debug-message', `[DEBUG] Found ${totalFiles} files for ${importSlotId}: fighter=${importFiles.fighter.length}, ui=${importFiles.ui.length}, sound=${importFiles.sound.length}, effect=${importFiles.effect.length}, camera=${importFiles.camera.length}`);
  
  // Debug: List all fighter files found
  if (importFiles.fighter.length > 0) {
    event.sender.send('debug-message', `[DEBUG] Fighter files found in import folder:`);
    for (const file of importFiles.fighter) {
      const relativePath = path.relative(importFolder, file);
      event.sender.send('debug-message', `[DEBUG]   ${relativePath}`);
    }
  }
  
  // Calculate alt numbers for UI file renaming
  const importSlotNum = parseInt(importSlotId.substring(1));
  const importAltNum = importSlotNum - importBaseSlot;
  const targetSlotNum = parseInt(targetSlotId.substring(1));
  const targetAltNum = targetSlotNum - mainBaseSlot;
  const importAltStr = importAltNum.toString().padStart(2, '0');
  const targetAltStr = targetAltNum.toString().padStart(2, '0');
  
  event.sender.send('debug-message', `[DEBUG] UI renaming: import display="${importDisplayName}" alt=${importAltStr} -> main display="${mainDisplayName}" alt=${targetAltStr}`);
  
  let copiedCount = 0;
  
  // Copy fighter, sound, effect, camera files
  for (const fileList of [importFiles.fighter, importFiles.sound, importFiles.effect, importFiles.camera]) {
    for (const sourceFile of fileList) {
      const relativePath = path.relative(importFolder, sourceFile);
      let targetPath = path.join(mainModPath, relativePath);
      
      // Replace slot ID in the path
      targetPath = targetPath.replace(new RegExp(importSlotId, 'g'), targetSlotId);
      
      // Create target directory
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      
      // Copy file
      fs.copyFileSync(sourceFile, targetPath);
      copiedCount++;
    }
  }
  
  // Copy UI files with alt number AND display name replacement
  for (const sourceFile of importFiles.ui) {
    const relativePath = path.relative(importFolder, sourceFile);
    let targetPath = path.join(mainModPath, relativePath);
    
    // Replace alt number and display name in filename
    const fileName = path.basename(targetPath);
    let newFileName = fileName;
    
    // Replace display name if different (e.g., wolf -> shadow)
    if (importDisplayName && mainDisplayName && importDisplayName !== mainDisplayName) {
      newFileName = newFileName.replace(importDisplayName, mainDisplayName);
    }
    
    // Replace _XX. pattern for alt numbers
    newFileName = newFileName.replace(`_${importAltStr}.`, `_${targetAltStr}.`);
    newFileName = newFileName.replace(`_${importAltStr}_`, `_${targetAltStr}_`);
    newFileName = newFileName.replace(`_${parseInt(importAltStr)}.`, `_${parseInt(targetAltStr)}.`);
    
    targetPath = path.join(path.dirname(targetPath), newFileName);
    
    // Create target directory
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Copy file
    fs.copyFileSync(sourceFile, targetPath);
    copiedCount++;
  }
  
  event.sender.send('debug-message', `[DEBUG] Copied ${copiedCount} files`);
  
  return {
    fighter: importFiles.fighter,
    ui: importFiles.ui,
    sound: importFiles.sound,
    effect: importFiles.effect,
    camera: importFiles.camera
  };
}

// Helper function to compare two files binarily
function filesAreIdentical(file1, file2) {
  try {
    if (!fs.existsSync(file1) || !fs.existsSync(file2)) {
      return false;
    }
    
    const stat1 = fs.statSync(file1);
    const stat2 = fs.statSync(file2);
    
    // Quick check: if sizes differ, files are different
    if (stat1.size !== stat2.size) {
      return false;
    }
    
    // Binary comparison
    const buf1 = fs.readFileSync(file1);
    const buf2 = fs.readFileSync(file2);
    
    return buf1.equals(buf2);
  } catch (error) {
    return false;
  }
}

/**
 * ============================================================================
 * ADD SKIN TO MOVESET - Clean Implementation
 * ============================================================================
 * 
 * This function handles adding a skin from an import folder to the main moveset.
 * 
 * WORKFLOW:
 * 1. PRE-SHIFT: Shift existing slots to make room for the new skin
 * 2. COPY FILES: Copy skin files from import folder to main moveset
 * 3. MATERIALIZE: Copy shared files (from skin's config) to the added skin physically
 * 4. MERGE CONFIG: Copy config entries (skip materialized shares, keep vanilla shares)
 * 5. DEDUPLICATE: Binary compare against main moveset, share identical files
 * 
 * @param {Object} params - Parameters object
 * @param {string} params.modRoot - Path to the main moveset folder
 * @param {string} params.importFolder - Path to the skin folder being imported
 * @param {string} params.importSlotId - Original slot ID in the import (e.g., "c123")
 * @param {string} params.targetSlotId - Target slot ID in main moveset (e.g., "c125")
 * @param {string} params.fighterCodename - Fighter codename (e.g., "wolf")
 * @param {number} params.baseSlotNum - Base slot number of the main moveset (e.g., 120)
 * @param {number} params.importBaseSlotNum - Base slot number of the import (e.g., 120)
 * @param {string} params.displayName - Display name for UI files (e.g., "shadow")
 * @param {Array} params.enabledSlots - Array of currently enabled slot IDs
 * @param {Object} params.configData - Main moveset config data (will be modified)
 * @param {Object} event - Electron event for sending debug messages
 * @returns {Object} Result object with success status and details
 */
async function addSkinToMoveset(params, event) {
  const {
    modRoot,
    importFolder,
    importSlotId,
    targetSlotId,
    fighterCodename,
    baseSlotNum,
    importBaseSlotNum,
    displayName,
    enabledSlots,
    configData
  } = params;
  
  const log = (msg) => {
    console.log(`[ADD-SKIN] ${msg}`);
    event.sender.send('debug-message', `[ADD-SKIN] ${msg}`);
  };
  
  log(`========== ADDING SKIN: ${importSlotId} -> ${targetSlotId} ==========`);
  
  const result = {
    success: false,
    filescopied: 0,
    filesMaterialized: 0,
    filesShared: 0,
    errors: []
  };
  
  try {
    // ========================================================================
    // STEP 1: PRE-SHIFT - Move existing slots up to make room
    // ========================================================================
    log(`STEP 1: Pre-shifting slots to make room at ${targetSlotId}`);
    
    const targetSlotNum = parseInt(targetSlotId.substring(1));
    
    // Find all slots that need to shift (from targetSlotNum onwards)
    const slotsToShift = [];
    for (let slotNum = targetSlotNum; slotNum < targetSlotNum + 100; slotNum++) {
      const slotId = `c${slotNum}`;
      const slotPath = path.join(modRoot, 'fighter', fighterCodename, 'model', 'body', slotId);
      if (fs.existsSync(slotPath)) {
        slotsToShift.push(slotId);
      } else {
        break; // Stop when we hit a non-existent slot
      }
    }
    
    if (slotsToShift.length > 0) {
      log(`Slots to shift: ${slotsToShift.join(', ')}`);
      
      // Build shift mapping (process in reverse order to avoid overwrites)
      const shiftMapping = {};
      for (const slotId of slotsToShift) {
        const slotNum = parseInt(slotId.substring(1));
        shiftMapping[slotId] = `c${slotNum + 1}`;
      }
      log(`Shift mapping: ${JSON.stringify(shiftMapping)}`);
      
      // Move physical files (in reverse order)
      const tempDir = path.join(modRoot, '_temp_shift');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      // First, move all to temp
      for (const slotId of slotsToShift.reverse()) {
        await shiftSlotPhysicalFiles(modRoot, slotId, shiftMapping[slotId], fighterCodename, baseSlotNum, displayName, tempDir, log);
      }
      
      // Clean up temp dir
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      
      // Update config entries for shifted slots
      applySlotReordering(configData, shiftMapping);
      log(`Config updated for slot shifts`);
    } else {
      log(`No existing slots need to shift`);
    }
    
    // ========================================================================
    // STEP 2: COPY SKIN FILES - Copy from import folder to main moveset
    // ========================================================================
    log(`STEP 2: Copying skin files from ${importFolder} to ${targetSlotId}`);
    
    // Helper to replace slot IDs in paths
    const replaceSlotInPath = (filePath) => {
      let result = filePath;
      // Replace import slot with target slot
      result = result.replace(new RegExp(`/${importSlotId}/`, 'g'), `/${targetSlotId}/`);
      result = result.replace(new RegExp(`/${importSlotId}$`), `/${targetSlotId}`);
      // Replace import base slot with main base slot if different
      if (importBaseSlotNum !== baseSlotNum) {
        const importBaseSlotId = `c${importBaseSlotNum}`;
        const mainBaseSlotId = `c${baseSlotNum}`;
        result = result.replace(new RegExp(`/${importBaseSlotId}/`, 'g'), `/${mainBaseSlotId}/`);
      }
      // Replace slot in filenames (e.g., se_wolf_c123.nus3bank -> se_wolf_c125.nus3bank)
      result = result.replace(new RegExp(`_${importSlotId}\\.`, 'g'), `_${targetSlotId}.`);
      return result;
    };
    
    // Copy all files from import folder
    const filesCopied = await copyAllSlotFiles(importFolder, modRoot, importSlotId, targetSlotId, fighterCodename, importBaseSlotNum, baseSlotNum, displayName, log);
    result.filescopied = filesCopied;
    log(`Copied ${filesCopied} files`);
    
    // ========================================================================
    // STEP 3: MATERIALIZE SHARED FILES - Copy source files for shares targeting this skin
    // ========================================================================
    log(`STEP 3: Materializing shared files for ${targetSlotId}`);
    
    // Load the skin's config (or use main moveset's config_backup.json as fallback)
    let skinConfig = null;
    const skinConfigPath = path.join(importFolder, 'config.json');
    const mainBackupConfigPath = path.join(modRoot, 'config_backup.json');
    
    if (fs.existsSync(skinConfigPath)) {
      skinConfig = JSON.parse(fs.readFileSync(skinConfigPath, 'utf8'));
      log(`Using skin's config.json`);
    } else if (fs.existsSync(mainBackupConfigPath)) {
      skinConfig = JSON.parse(fs.readFileSync(mainBackupConfigPath, 'utf8'));
      log(`Using main moveset's config_backup.json (skin has no config)`);
    }
    
    // Track which share entries were materialized (so we don't copy them to config)
    const materializedSources = new Set();
    // Track vanilla share entries to preserve (c00-c07)
    const vanillaShareEntries = {};
    
    if (skinConfig && skinConfig['share-to-added']) {
      for (const [source, targets] of Object.entries(skinConfig['share-to-added'])) {
        const targetArray = Array.isArray(targets) ? targets : [targets];
        
        // Check if any target references the import slot
        const relevantTargets = targetArray.filter(t => t.includes(`/${importSlotId}/`) || t.includes(`/${importSlotId}.`));
        
        if (relevantTargets.length === 0) continue;
        
        // Extract source slot number
        const sourceSlotMatch = source.match(/\/c(\d+)\//);
        if (!sourceSlotMatch) continue;
        const sourceSlotNum = parseInt(sourceSlotMatch[1]);
        const isVanillaSource = sourceSlotNum <= 7;
        
        if (isVanillaSource) {
          // Vanilla sources (c00-c07) - keep as config entries, don't materialize
          const adjustedSource = replaceSlotInPath(source);
          const adjustedTargets = relevantTargets.map(t => replaceSlotInPath(t));
          
          if (!vanillaShareEntries[adjustedSource]) {
            vanillaShareEntries[adjustedSource] = [];
          }
          vanillaShareEntries[adjustedSource].push(...adjustedTargets);
          log(`Preserving vanilla share: ${adjustedSource} -> ${adjustedTargets.join(', ')}`);
        } else {
          // Non-vanilla sources - materialize the files
          const sourcePath = path.join(importFolder, source);
          
          for (const target of relevantTargets) {
            const adjustedTarget = replaceSlotInPath(target);
            const targetPath = path.join(modRoot, adjustedTarget);
            
            // Check if source exists in import folder
            if (fs.existsSync(sourcePath)) {
              // Copy source file to target location
              const targetDir = path.dirname(targetPath);
              if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
              }
              
              // Only copy if target doesn't exist yet
              if (!fs.existsSync(targetPath)) {
                fs.copyFileSync(sourcePath, targetPath);
                result.filesMaterialized++;
                log(`Materialized: ${path.basename(source)} -> ${adjustedTarget}`);
              }
            } else {
              // Source might be in main moveset (e.g., base alt)
              const adjustedSource = replaceSlotInPath(source);
              const mainSourcePath = path.join(modRoot, adjustedSource);
              
              if (fs.existsSync(mainSourcePath) && !fs.existsSync(targetPath)) {
                const targetDir = path.dirname(targetPath);
                if (!fs.existsSync(targetDir)) {
                  fs.mkdirSync(targetDir, { recursive: true });
                }
                fs.copyFileSync(mainSourcePath, targetPath);
                result.filesMaterialized++;
                log(`Materialized from main: ${adjustedSource} -> ${adjustedTarget}`);
              }
            }
            
            materializedSources.add(source);
          }
        }
      }
    }
    
    log(`Materialized ${result.filesMaterialized} shared files`);
    
    // ========================================================================
    // STEP 4: MERGE CONFIG - Copy config entries (skip materialized shares)
    // ========================================================================
    log(`STEP 4: Merging config entries for ${targetSlotId}`);
    
    if (skinConfig) {
      // Merge new-dir-infos
      if (skinConfig['new-dir-infos']) {
        if (!configData['new-dir-infos']) configData['new-dir-infos'] = [];
        for (const entry of skinConfig['new-dir-infos']) {
          if (entry.includes(`/${importSlotId}`) || entry.includes(`/${importSlotId}/`)) {
            const adjustedEntry = replaceSlotInPath(entry);
            if (!configData['new-dir-infos'].includes(adjustedEntry)) {
              configData['new-dir-infos'].push(adjustedEntry);
            }
          }
        }
      }
      
      // Merge new-dir-infos-base
      if (skinConfig['new-dir-infos-base']) {
        if (!configData['new-dir-infos-base']) configData['new-dir-infos-base'] = {};
        for (const [key, value] of Object.entries(skinConfig['new-dir-infos-base'])) {
          if (key.includes(`/${importSlotId}/`) || key.includes(`/${importSlotId}`)) {
            const adjustedKey = replaceSlotInPath(key);
            configData['new-dir-infos-base'][adjustedKey] = value;
          }
        }
      }
      
      // Merge new-dir-files
      if (skinConfig['new-dir-files']) {
        if (!configData['new-dir-files']) configData['new-dir-files'] = {};
        for (const [key, files] of Object.entries(skinConfig['new-dir-files'])) {
          if (key.includes(`/${importSlotId}/`) || key.includes(`/${importSlotId}`)) {
            const adjustedKey = replaceSlotInPath(key);
            const adjustedFiles = (Array.isArray(files) ? files : [files]).map(f => replaceSlotInPath(f));
            configData['new-dir-files'][adjustedKey] = [...new Set(adjustedFiles)];
          }
        }
      }
      
      // Add vanilla share entries
      if (!configData['share-to-added']) configData['share-to-added'] = {};
      for (const [source, targets] of Object.entries(vanillaShareEntries)) {
        if (configData['share-to-added'][source]) {
          const existing = Array.isArray(configData['share-to-added'][source]) 
            ? configData['share-to-added'][source] 
            : [configData['share-to-added'][source]];
          configData['share-to-added'][source] = [...new Set([...existing, ...targets])];
        } else {
          configData['share-to-added'][source] = targets;
        }
      }
      
      // Merge share-to-vanilla (keep all entries, just adjust slot numbers)
      if (skinConfig['share-to-vanilla']) {
        if (!configData['share-to-vanilla']) configData['share-to-vanilla'] = {};
        for (const [key, value] of Object.entries(skinConfig['share-to-vanilla'])) {
          if (key.includes(`/${importSlotId}/`) || key.includes(`/${importSlotId}`)) {
            const adjustedKey = replaceSlotInPath(key);
            configData['share-to-vanilla'][adjustedKey] = value;
          }
        }
      }
    }
    
    log(`Config entries merged`);
    
    // ========================================================================
    // STEP 5: BINARY COMPARISON & DE-MATERIALIZATION
    // ========================================================================
    log(`STEP 5: Binary comparison for ${targetSlotId} against main moveset`);
    
    // Get all files in the added skin
    const skinFiles = [];
    const scanDirs = [
      path.join(modRoot, 'fighter', fighterCodename, 'model'),
      path.join(modRoot, 'fighter', fighterCodename, 'motion'),
      path.join(modRoot, 'camera', 'fighter', fighterCodename),
      path.join(modRoot, 'sound', 'bank')
    ];
    
    for (const baseDir of scanDirs) {
      if (!fs.existsSync(baseDir)) continue;
      collectFilesForSlot(baseDir, targetSlotId, skinFiles, modRoot);
    }
    
    log(`Found ${skinFiles.length} files in ${targetSlotId} to compare`);
    
    // Get list of slots to compare against (all enabled slots except the target)
    const slotsToCompare = enabledSlots
      .filter(s => s !== targetSlotId)
      .sort((a, b) => {
        // Sort so base slot comes first
        const aNum = parseInt(a.substring(1));
        const bNum = parseInt(b.substring(1));
        if (aNum === baseSlotNum) return -1;
        if (bNum === baseSlotNum) return 1;
        return aNum - bNum;
      });
    
    log(`Comparing against slots: ${slotsToCompare.join(', ')}`);
    
    // Compare each file
    const sharesDetected = {};
    const filesToDelete = [];
    
    for (const { fullPath, relativePath } of skinFiles) {
      // Skip .marker files
      if (fullPath.endsWith('.marker')) continue;
      
      // Check if this file extension should always be shared (.nuanmb = animations)
      const shouldAlwaysShare = fullPath.endsWith('.nuanmb');
      
      // Find a matching file in another slot
      for (const otherSlot of slotsToCompare) {
        const otherPath = fullPath.replace(`/${targetSlotId}/`, `/${otherSlot}/`).replace(`_${targetSlotId}.`, `_${otherSlot}.`);
        
        if (!fs.existsSync(otherPath)) continue;
        
        // Binary comparison
        if (filesAreIdentical(fullPath, otherPath)) {
          // Create share entry (other slot -> target slot)
          const sourceConfigPath = relativePath.replace(`/${targetSlotId}/`, `/${otherSlot}/`).replace(`_${targetSlotId}.`, `_${otherSlot}.`);
          const targetConfigPath = relativePath;
          
          if (!sharesDetected[sourceConfigPath]) {
            sharesDetected[sourceConfigPath] = [];
          }
          sharesDetected[sourceConfigPath].push(targetConfigPath);
          filesToDelete.push(fullPath);
          result.filesShared++;
          
          log(`Match: ${path.basename(fullPath)} shares from ${otherSlot}`);
          break; // Only need one match
        }
      }
    }
    
    // Add share entries to config
    if (!configData['share-to-added']) configData['share-to-added'] = {};
    for (const [source, targets] of Object.entries(sharesDetected)) {
      if (configData['share-to-added'][source]) {
        const existing = Array.isArray(configData['share-to-added'][source])
          ? configData['share-to-added'][source]
          : [configData['share-to-added'][source]];
        configData['share-to-added'][source] = [...new Set([...existing, ...targets])];
      } else {
        configData['share-to-added'][source] = targets;
      }
    }
    
    // De-materialize (delete) the duplicate files
    for (const filePath of filesToDelete) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        log(`Error deleting ${filePath}: ${error.message}`);
      }
    }
    
    log(`Created ${Object.keys(sharesDetected).length} share entries, deleted ${filesToDelete.length} files`);
    
    // Clean up empty directories
    const dirsToCheck = new Set(filesToDelete.map(f => path.dirname(f)));
    for (const dir of dirsToCheck) {
      cleanupEmptyDirs(dir, modRoot);
    }
    
    log(`========== SKIN ADDED SUCCESSFULLY ==========`);
    result.success = true;
    return result;
    
  } catch (error) {
    log(`ERROR: ${error.message}`);
    result.errors.push(error.message);
    return result;
  }
}

/**
 * Helper: Shift a slot's physical files to a new slot number
 */
async function shiftSlotPhysicalFiles(modRoot, fromSlot, toSlot, fighterCodename, baseSlotNum, displayName, tempDir, log) {
  log(`Shifting physical files: ${fromSlot} -> ${toSlot}`);
  
  // Directories to check for slot folders
  const slotDirs = [
    path.join(modRoot, 'fighter', fighterCodename, 'model', 'body'),
    path.join(modRoot, 'fighter', fighterCodename, 'model', 'blaster'),
    path.join(modRoot, 'fighter', fighterCodename, 'model', 'reticle'),
    path.join(modRoot, 'fighter', fighterCodename, 'model', 'wolfen'),
    path.join(modRoot, 'fighter', fighterCodename, 'motion', 'body'),
    path.join(modRoot, 'camera', 'fighter', fighterCodename)
  ];
  
  for (const dir of slotDirs) {
    const fromPath = path.join(dir, fromSlot);
    const toPath = path.join(dir, toSlot);
    
    if (fs.existsSync(fromPath)) {
      // Use temp dir to avoid conflicts
      const tempPath = path.join(tempDir, `${path.basename(dir)}_${fromSlot}`);
      fs.renameSync(fromPath, tempPath);
      
      // If destination exists, it will be shifted too (handled by caller's reverse order)
      fs.renameSync(tempPath, toPath);
      log(`Moved: ${fromPath} -> ${toPath}`);
    }
  }
  
  // Handle UI files (chara_X_displayName_NN.bntx)
  const fromSlotNum = parseInt(fromSlot.substring(1));
  const toSlotNum = parseInt(toSlot.substring(1));
  const fromAltNum = fromSlotNum - baseSlotNum;
  const toAltNum = toSlotNum - baseSlotNum;
  
  const uiBasePath = path.join(modRoot, 'ui', 'replace', 'chara');
  if (fs.existsSync(uiBasePath)) {
    for (let charaNum = 0; charaNum <= 7; charaNum++) {
      const charaDir = path.join(uiBasePath, `chara_${charaNum}`);
      if (!fs.existsSync(charaDir)) continue;
      
      const fromUIFile = path.join(charaDir, `chara_${charaNum}_${displayName}_${String(fromAltNum).padStart(2, '0')}.bntx`);
      const toUIFile = path.join(charaDir, `chara_${charaNum}_${displayName}_${String(toAltNum).padStart(2, '0')}.bntx`);
      
      if (fs.existsSync(fromUIFile)) {
        // Use temp to avoid conflicts
        const tempUI = path.join(tempDir, `ui_${charaNum}_${fromAltNum}.bntx`);
        fs.renameSync(fromUIFile, tempUI);
        fs.renameSync(tempUI, toUIFile);
        log(`Shifted UI: ${path.basename(fromUIFile)} -> ${path.basename(toUIFile)}`);
      }
    }
  }
  
  // Handle effect files
  const effectDir = path.join(modRoot, 'effect', 'fighter', fighterCodename);
  if (fs.existsSync(effectDir)) {
    const fromEffectFile = path.join(effectDir, `ef_${fighterCodename}_${fromSlot}.eff`);
    const toEffectFile = path.join(effectDir, `ef_${fighterCodename}_${toSlot}.eff`);
    
    if (fs.existsSync(fromEffectFile)) {
      const tempEffect = path.join(tempDir, `effect_${fromSlot}.eff`);
      fs.renameSync(fromEffectFile, tempEffect);
      fs.renameSync(tempEffect, toEffectFile);
      log(`Shifted effect: ${path.basename(fromEffectFile)} -> ${path.basename(toEffectFile)}`);
    }
  }
  
  // Handle sound files
  const soundTypes = [
    { prefix: 'vc', subdir: 'fighter_voice' },
    { prefix: 'se', subdir: 'fighter' }
  ];
  
  for (const soundType of soundTypes) {
    for (const ext of ['nus3bank', 'nus3audio']) {
      const soundDir = path.join(modRoot, 'sound', 'bank', soundType.subdir);
      if (!fs.existsSync(soundDir)) continue;
      
      const fromSoundFile = path.join(soundDir, `${soundType.prefix}_${fighterCodename}_${fromSlot}.${ext}`);
      const toSoundFile = path.join(soundDir, `${soundType.prefix}_${fighterCodename}_${toSlot}.${ext}`);
      
      if (fs.existsSync(fromSoundFile)) {
        const tempSound = path.join(tempDir, `sound_${soundType.prefix}_${fromSlot}.${ext}`);
        fs.renameSync(fromSoundFile, tempSound);
        fs.renameSync(tempSound, toSoundFile);
        log(`Shifted sound: ${path.basename(fromSoundFile)} -> ${path.basename(toSoundFile)}`);
      }
    }
  }
}

/**
 * Helper: Copy all files for a slot from import folder to main moveset
 */
async function copyAllSlotFiles(importFolder, modRoot, importSlotId, targetSlotId, fighterCodename, importBaseSlotNum, mainBaseSlotNum, displayName, log) {
  let filesCopied = 0;
  
  const importBaseSlotId = `c${importBaseSlotNum}`;
  const mainBaseSlotId = `c${mainBaseSlotNum}`;
  
  // Helper to adjust paths
  const adjustPath = (relativePath) => {
    let result = relativePath;
    result = result.replace(new RegExp(`\\\\${importSlotId}\\\\`, 'g'), `\\${targetSlotId}\\`);
    result = result.replace(new RegExp(`/${importSlotId}/`, 'g'), `/${targetSlotId}/`);
    result = result.replace(new RegExp(`_${importSlotId}\\.`, 'g'), `_${targetSlotId}.`);
    if (importBaseSlotNum !== mainBaseSlotNum) {
      result = result.replace(new RegExp(`\\\\${importBaseSlotId}\\\\`, 'g'), `\\${mainBaseSlotId}\\`);
      result = result.replace(new RegExp(`/${importBaseSlotId}/`, 'g'), `/${mainBaseSlotId}/`);
    }
    return result;
  };
  
  // Recursively copy files
  function copyRecursive(srcDir, destBaseDir, relativeBase = '') {
    if (!fs.existsSync(srcDir)) return;
    
    const items = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const item of items) {
      const srcPath = path.join(srcDir, item.name);
      const relativePath = path.join(relativeBase, item.name);
      
      if (item.isDirectory()) {
        // Check if directory name contains import slot ID
        if (item.name === importSlotId || item.name.includes(importSlotId)) {
          const adjustedName = item.name.replace(importSlotId, targetSlotId);
          copyRecursive(srcPath, destBaseDir, path.join(relativeBase, adjustedName));
        } else if (item.name === importBaseSlotId && importBaseSlotNum !== mainBaseSlotNum) {
          // Skip import's base slot - we're only importing the specific slot
          continue;
        } else {
          copyRecursive(srcPath, destBaseDir, relativePath);
        }
      } else if (item.isFile()) {
        // Only copy files that belong to the import slot
        const fileName = item.name;
        const isSlotFile = fileName.includes(`_${importSlotId}.`) || 
                          relativeBase.includes(importSlotId) ||
                          relativeBase.includes(`\\${importSlotId}\\`) ||
                          relativeBase.includes(`/${importSlotId}/`);
        
        if (isSlotFile) {
          const adjustedRelativePath = adjustPath(relativePath);
          const destPath = path.join(destBaseDir, adjustedRelativePath);
          const destDir = path.dirname(destPath);
          
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }
          
          fs.copyFileSync(srcPath, destPath);
          filesCopied++;
        }
      }
    }
  }
  
  copyRecursive(importFolder, modRoot);
  return filesCopied;
}

/**
 * Helper: Collect all files for a specific slot
 */
function collectFilesForSlot(baseDir, slotId, results, modRoot) {
  if (!fs.existsSync(baseDir)) return;
  
  const items = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(baseDir, item.name);
    
    if (item.isDirectory()) {
      if (item.name === slotId) {
        // This is the slot folder - collect all files inside
        collectAllFilesRecursive(fullPath, results, modRoot);
      } else {
        // Check subdirectories
        collectFilesForSlot(fullPath, slotId, results, modRoot);
      }
    } else if (item.isFile()) {
      // Check if filename contains the slot ID
      if (item.name.includes(`_${slotId}.`)) {
        results.push({
          fullPath,
          relativePath: path.relative(modRoot, fullPath).replace(/\\/g, '/')
        });
      }
    }
  }
}

function collectAllFilesRecursive(dir, results, modRoot) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      collectAllFilesRecursive(fullPath, results, modRoot);
    } else if (item.isFile()) {
      results.push({
        fullPath,
        relativePath: path.relative(modRoot, fullPath).replace(/\\/g, '/')
      });
    }
  }
}

/**
 * Helper: Clean up empty directories up to modRoot
 */
function cleanupEmptyDirs(dir, modRoot) {
  let currentDir = dir;
  while (currentDir && currentDir !== modRoot && currentDir.startsWith(modRoot)) {
    try {
      const items = fs.readdirSync(currentDir);
      if (items.length === 0) {
        fs.rmdirSync(currentDir);
        currentDir = path.dirname(currentDir);
      } else {
        break;
      }
    } catch (error) {
      break;
    }
  }
}

// Compare base alts from two mod folders to see if they're identical
async function compareBaseAlts(mainModPath, importModPath, mainBaseSlotId, importBaseSlotId, fighterCodename, event) {
  try {
    event.sender.send('debug-message', `[DEBUG] Binary comparing base alts: ${mainBaseSlotId} vs ${importBaseSlotId}`);
    
    // Get model files from both base alts
    const mainBaseModelPath = path.join(mainModPath, 'fighter', fighterCodename, 'model', 'body', mainBaseSlotId);
    const importBaseModelPath = path.join(importModPath, 'fighter', fighterCodename, 'model', 'body', importBaseSlotId);
    
    if (!fs.existsSync(mainBaseModelPath) || !fs.existsSync(importBaseModelPath)) {
      event.sender.send('debug-message', `[DEBUG] One or both base model paths don't exist`);
      return false;
    }
    
    // Get all files in both directories
    const mainFiles = getAllFilesInDirectory(mainBaseModelPath);
    const importFiles = getAllFilesInDirectory(importBaseModelPath);
    
    // Quick check: if file counts differ, they're different
    if (mainFiles.length !== importFiles.length) {
      event.sender.send('debug-message', `[DEBUG] File count mismatch: main=${mainFiles.length}, import=${importFiles.length}`);
      return false;
    }
    
    // Compare each file binarily
    let matchCount = 0;
    let mismatchCount = 0;
    
    for (const mainFile of mainFiles) {
      const relativePath = path.relative(mainBaseModelPath, mainFile);
      const importFile = path.join(importBaseModelPath, relativePath);
      
      if (filesAreIdentical(mainFile, importFile)) {
        matchCount++;
      } else {
        mismatchCount++;
      }
    }
    
    event.sender.send('debug-message', `[DEBUG] Base alt comparison: ${matchCount} matches, ${mismatchCount} mismatches`);
    
    // Consider base alts identical only if ALL files match
    return mismatchCount === 0;
  } catch (error) {
    event.sender.send('debug-message', `[DEBUG] Error comparing base alts: ${error.message}`);
    return false;
  }
}

// Pre-copy shared files from import base alt to target alt in the import folder
async function preCopySharedFilesForImport(importFolder, importConfig, importBaseSlotId, importTargetSlotId, event) {
  try {
    if (!importConfig['share-to-added']) {
      return;
    }
    
    let copiedCount = 0;
    
    // Check share-to-added for entries where importTargetSlotId is a TARGET
    for (const [source, targets] of Object.entries(importConfig['share-to-added'])) {
      const targetArray = Array.isArray(targets) ? targets : [targets];
      
      // If the source is from the base slot and the target includes our import slot
      if (source.includes(importBaseSlotId)) {
        for (const target of targetArray) {
          if (typeof target === 'string' && target.includes(importTargetSlotId)) {
            // Copy the source file to the target location in the import folder
            const sourceFile = path.join(importFolder, source);
            const targetFile = path.join(importFolder, target);
            
            if (fs.existsSync(sourceFile) && !fs.existsSync(targetFile)) {
              // Ensure target directory exists
              const targetDir = path.dirname(targetFile);
              if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
              }
              
              fs.copyFileSync(sourceFile, targetFile);
              copiedCount++;
              event.sender.send('debug-message', `[DEBUG] Pre-copied: ${path.basename(sourceFile)} -> ${path.basename(targetFile)}`);
            }
          }
        }
      }
    }
    
    event.sender.send('debug-message', `[DEBUG] Pre-copied ${copiedCount} shared files for ${importTargetSlotId}`);
  } catch (error) {
    event.sender.send('debug-message', `[DEBUG] Error pre-copying shared files: ${error.message}`);
  }
}

// Helper to get all files in a directory recursively
function getAllFilesInDirectory(dir) {
  const files = [];
  
  function traverse(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      if (entry.isDirectory()) {
        traverse(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  
  traverse(dir);
  return files;
}

// Helper function to detect and set up file sharing after import
async function detectAndSetupSharing(mainModPath, targetSlotId, baseSlotId, fighterCodename, event) {
  const sharesToAdd = {};
  const filesToDelete = [];
  
  event.sender.send('debug-message', `[DEBUG] Comparing ${targetSlotId} model files against base ${baseSlotId} for sharing`);
  
  // Only check model folder for sharing (motion files are always unique per user request)
  const targetModelPath = path.join(mainModPath, 'fighter', fighterCodename, 'model', 'body', targetSlotId);
  const baseModelPath = path.join(mainModPath, 'fighter', fighterCodename, 'model', 'body', baseSlotId);
  
  if (!fs.existsSync(targetModelPath) || !fs.existsSync(baseModelPath)) {
    event.sender.send('debug-message', `[DEBUG] Model paths not found, skipping sharing detection`);
    return { sharesToAdd, filesToDelete };
  }
  
  // Get all files in target model folder
  const targetFiles = [];
  function scanDir(dir, baseDir) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isFile()) {
        const relativePath = path.relative(baseDir, fullPath);
        targetFiles.push({ fullPath, relativePath });
      } else if (item.isDirectory()) {
        scanDir(fullPath, baseDir);
      }
    }
  }
  
  scanDir(targetModelPath, targetModelPath);
  
  event.sender.send('debug-message', `[DEBUG] Checking ${targetFiles.length} model files for binary matches`);
  
  let matchCount = 0;
  
  // Compare each file against base
  for (const { fullPath, relativePath } of targetFiles) {
    // NEVER delete or share .marker files - they are unique identifiers
    if (fullPath.endsWith('.marker')) {
      event.sender.send('debug-message', `[DEBUG] Skipping .marker file: ${relativePath}`);
      continue;
    }
    
    const baseFilePath = path.join(baseModelPath, relativePath);
    
    // Check if base file exists
    if (!fs.existsSync(baseFilePath)) {
      continue;
    }
    
    // Quick size check first (if sizes differ, files are definitely different)
    const targetStats = fs.statSync(fullPath);
    const baseStats = fs.statSync(baseFilePath);
    if (targetStats.size !== baseStats.size) {
      continue;
    }
    
    if (filesAreIdentical(fullPath, baseFilePath)) {
      // Files are identical! Set up sharing
      const sourceConfigPath = `fighter/${fighterCodename}/model/body/${baseSlotId}/${relativePath.replace(/\\/g, '/')}`;
      const targetConfigPath = `fighter/${fighterCodename}/model/body/${targetSlotId}/${relativePath.replace(/\\/g, '/')}`;
      
      if (!sharesToAdd[sourceConfigPath]) {
        sharesToAdd[sourceConfigPath] = [];
      }
      sharesToAdd[sourceConfigPath].push(targetConfigPath);
      
      // Mark file for deletion
      filesToDelete.push(fullPath);
      matchCount++;
      event.sender.send('debug-message', `[DEBUG] Model match: ${relativePath}`);
    }
  }
  
  // Also compare all sound files (voice, SE, and any other slot-specific sound files)
  const soundExtensions = ['nus3bank', 'nus3audio'];
  const soundTypes = [
    { prefix: 'vc', subdir: 'fighter_voice' },      // Voice files
    { prefix: 'se', subdir: 'fighter' },            // Sound effects
    { prefix: 'se', subdir: 'fighter_se' },         // Alternative SE location
    { prefix: 'bgm', subdir: 'fighter_bgm' },       // Background music
    { prefix: 'env', subdir: 'fighter_env' },       // Environment sounds
    { prefix: 'ui', subdir: 'fighter_ui' },         // UI sounds
    { prefix: 'ann', subdir: 'fighter_ann' },       // Announcer
    { prefix: 'crowd', subdir: 'fighter_crowd' },   // Crowd sounds
    { prefix: 'stage', subdir: 'fighter_stage' }    // Stage sounds
  ];
  
  for (const soundType of soundTypes) {
    const soundDir = path.join(mainModPath, 'sound', 'bank', soundType.subdir);
    if (fs.existsSync(soundDir)) {
      for (const ext of soundExtensions) {
        const soundFile = `${soundType.prefix}_${fighterCodename}_${targetSlotId}.${ext}`;
      const targetSoundPath = path.join(soundDir, soundFile);
      const baseSoundFile = soundFile.replace(targetSlotId, baseSlotId);
      const baseSoundPath = path.join(soundDir, baseSoundFile);
      
      if (fs.existsSync(targetSoundPath) && fs.existsSync(baseSoundPath)) {
        // Quick size check
        const targetStats = fs.statSync(targetSoundPath);
        const baseStats = fs.statSync(baseSoundPath);
        if (targetStats.size !== baseStats.size) {
          continue;
        }
        
        if (filesAreIdentical(targetSoundPath, baseSoundPath)) {
            const sourceConfigPath = `sound/bank/${soundType.subdir}/${baseSoundFile}`;
            const targetConfigPath = `sound/bank/${soundType.subdir}/${soundFile}`;
          
          if (!sharesToAdd[sourceConfigPath]) {
            sharesToAdd[sourceConfigPath] = [];
          }
          sharesToAdd[sourceConfigPath].push(targetConfigPath);
          
          filesToDelete.push(targetSoundPath);
          matchCount++;
            event.sender.send('debug-message', `[DEBUG] ${soundType.prefix} sound match: ${soundFile}`);
          }
        }
      }
    }
  }
  
  event.sender.send('debug-message', `[DEBUG] Found ${matchCount} identical files that can be shared`);
  
  // Delete redundant files
  for (const filePath of filesToDelete) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      event.sender.send('debug-message', `[DEBUG] Error deleting ${filePath}: ${error.message}`);
    }
  }
  
  return { sharesToAdd, filesToDelete };
}

// Helper function to detect cross-alt sharing opportunities
async function detectCrossAltSharing(mainModPath, targetSlotId, enabledSlots, fighterCodename, event) {
  const sharesToAdd = {};
  const filesToDelete = [];
  
  event.sender.send('debug-message', `[DEBUG] Cross-alt comparison: Comparing ${targetSlotId} against other alts`);
  
  // Get all enabled slots except the target slot
  const otherSlots = enabledSlots.filter(slot => slot !== targetSlotId);
  
  if (otherSlots.length === 0) {
    event.sender.send('debug-message', `[DEBUG] No other alts to compare against`);
    return { sharesToAdd, filesToDelete };
  }
  
  // Get target slot files from ALL model subfolders (body, blaster, reticle, wolfen, etc.)
  const modelBasePath = path.join(mainModPath, 'fighter', fighterCodename, 'model');
  if (!fs.existsSync(modelBasePath)) {
    event.sender.send('debug-message', `[DEBUG] Model base path not found: ${modelBasePath}`);
    return { sharesToAdd, filesToDelete };
  }
  
  const targetFiles = [];
  function scanTargetDir(dir, baseDir, subfolder) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isFile()) {
        const relativePath = path.relative(baseDir, fullPath);
        targetFiles.push({ fullPath, relativePath, subfolder });
      } else if (item.isDirectory()) {
        scanTargetDir(fullPath, baseDir, subfolder);
      }
    }
  }
  
  // Scan all model subfolders for this slot
  const modelSubfolders = fs.readdirSync(modelBasePath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  let totalSlotFiles = 0;
  for (const subfolder of modelSubfolders) {
    const targetModelPath = path.join(modelBasePath, subfolder, targetSlotId);
    if (fs.existsSync(targetModelPath)) {
      scanTargetDir(targetModelPath, targetModelPath, subfolder);
      totalSlotFiles += targetFiles.length;
    }
  }
  
  if (targetFiles.length === 0) {
    event.sender.send('debug-message', `[DEBUG] No files found for ${targetSlotId} in any model subfolder`);
    return { sharesToAdd, filesToDelete };
  }
  
  event.sender.send('debug-message', `[DEBUG] Checking ${targetFiles.length} files in ${targetSlotId} against ${otherSlots.length} other alts`);
  
  let matchCount = 0;
  
  // Compare each target file against all other slots
  for (const { fullPath, relativePath, subfolder } of targetFiles) {
    // Skip marker files
    if (fullPath.endsWith('.marker')) {
      continue;
    }
    
    // Find which other slots have the same file and if they're identical
    for (const otherSlotId of otherSlots) {
      const otherModelPath = path.join(modelBasePath, subfolder, otherSlotId);
      const otherFilePath = path.join(otherModelPath, relativePath);
      
      if (fs.existsSync(otherFilePath)) {
        // Quick size check first
        const targetStats = fs.statSync(fullPath);
        const otherStats = fs.statSync(otherFilePath);
        if (targetStats.size !== otherStats.size) {
          continue;
        }
        
        if (filesAreIdentical(fullPath, otherFilePath)) {
          // Files are identical! Set up sharing from the OTHER slot to the target
          const sourceConfigPath = `fighter/${fighterCodename}/model/${subfolder}/${otherSlotId}/${relativePath.replace(/\\/g, '/')}`;
          const targetConfigPath = `fighter/${fighterCodename}/model/${subfolder}/${targetSlotId}/${relativePath.replace(/\\/g, '/')}`;
          
          if (!sharesToAdd[sourceConfigPath]) {
            sharesToAdd[sourceConfigPath] = [];
          }
          sharesToAdd[sourceConfigPath].push(targetConfigPath);
          
          // Mark target file for deletion
          filesToDelete.push(fullPath);
          matchCount++;
          event.sender.send('debug-message', `[DEBUG] ${subfolder} match: ${path.basename(fullPath)}`);
          
          // Only need to find one match for this file
          break;
        }
      }
    }
  }
  
  // Also check sound files for cross-alt sharing
  const soundExtensions = ['nus3bank', 'nus3audio'];
  const soundTypes = [
    { prefix: 'vc', subdir: 'fighter_voice' },      // Voice files
    { prefix: 'se', subdir: 'fighter' },            // Sound effects
    { prefix: 'se', subdir: 'fighter_se' },         // Alternative SE location
    { prefix: 'bgm', subdir: 'fighter_bgm' },       // Background music
    { prefix: 'env', subdir: 'fighter_env' },       // Environment sounds
    { prefix: 'ui', subdir: 'fighter_ui' },         // UI sounds
    { prefix: 'ann', subdir: 'fighter_ann' },       // Announcer
    { prefix: 'crowd', subdir: 'fighter_crowd' },   // Crowd sounds
    { prefix: 'stage', subdir: 'fighter_stage' }    // Stage sounds
  ];
  
  for (const soundType of soundTypes) {
    const soundDir = path.join(mainModPath, 'sound', 'bank', soundType.subdir);
    if (fs.existsSync(soundDir)) {
      for (const ext of soundExtensions) {
        const targetSoundFile = `${soundType.prefix}_${fighterCodename}_${targetSlotId}.${ext}`;
        const targetSoundPath = path.join(soundDir, targetSoundFile);
        
        if (fs.existsSync(targetSoundPath)) {
          // Check against all other slots
          for (const otherSlotId of otherSlots) {
            const otherSoundFile = targetSoundFile.replace(targetSlotId, otherSlotId);
            const otherSoundPath = path.join(soundDir, otherSoundFile);
            
            if (fs.existsSync(otherSoundPath)) {
              // Quick size check
              const targetStats = fs.statSync(targetSoundPath);
              const otherStats = fs.statSync(otherSoundPath);
              if (targetStats.size !== otherStats.size) {
                continue;
              }
              
              if (filesAreIdentical(targetSoundPath, otherSoundPath)) {
                const sourceConfigPath = `sound/bank/${soundType.subdir}/${otherSoundFile}`;
                const targetConfigPath = `sound/bank/${soundType.subdir}/${targetSoundFile}`;
                
                if (!sharesToAdd[sourceConfigPath]) {
                  sharesToAdd[sourceConfigPath] = [];
                }
                sharesToAdd[sourceConfigPath].push(targetConfigPath);
                
                filesToDelete.push(targetSoundPath);
                matchCount++;
                event.sender.send('debug-message', `[DEBUG] Cross-alt sound match: ${otherSlotId} -> ${targetSlotId} (${targetSoundFile})`);
                
                // Only need to find one match for this sound file
                break;
              }
            }
          }
        }
      }
    }
  }
  
  // Also check camera files for cross-alt sharing
  const cameraBasePath = path.join(mainModPath, 'camera', 'fighter', fighterCodename);
  if (fs.existsSync(cameraBasePath)) {
    const targetCameraPath = path.join(cameraBasePath, targetSlotId);
    if (fs.existsSync(targetCameraPath)) {
      const cameraFiles = [];
      
      function scanCameraDir(dir, baseDir) {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(dir, item.name);
          if (item.isFile()) {
            const relativePath = path.relative(baseDir, fullPath);
            cameraFiles.push({ fullPath, relativePath });
          } else if (item.isDirectory()) {
            scanCameraDir(fullPath, baseDir);
          }
        }
      }
      
      scanCameraDir(targetCameraPath, targetCameraPath);
      
      // Compare each camera file against other slots
      for (const { fullPath, relativePath } of cameraFiles) {
        for (const otherSlotId of otherSlots) {
          const otherCameraPath = path.join(cameraBasePath, otherSlotId);
          const otherFilePath = path.join(otherCameraPath, relativePath);
          
          if (fs.existsSync(otherFilePath)) {
            // Quick size check
            const targetStats = fs.statSync(fullPath);
            const otherStats = fs.statSync(otherFilePath);
            if (targetStats.size !== otherStats.size) {
              continue;
            }
            
            if (filesAreIdentical(fullPath, otherFilePath)) {
              const sourceConfigPath = `camera/fighter/${fighterCodename}/${otherSlotId}/${relativePath.replace(/\\/g, '/')}`;
              const targetConfigPath = `camera/fighter/${fighterCodename}/${targetSlotId}/${relativePath.replace(/\\/g, '/')}`;
              
              if (!sharesToAdd[sourceConfigPath]) {
                sharesToAdd[sourceConfigPath] = [];
              }
              sharesToAdd[sourceConfigPath].push(targetConfigPath);
              
              filesToDelete.push(fullPath);
              matchCount++;
              event.sender.send('debug-message', `[DEBUG] Camera match: ${path.basename(fullPath)}`);
              
              // Only need one match per file
              break;
            }
          }
        }
      }
    }
  }
  
  // Also check motion files for cross-alt sharing
  const motionBasePath = path.join(mainModPath, 'fighter', fighterCodename, 'motion', 'body');
  if (fs.existsSync(motionBasePath)) {
    const targetMotionPath = path.join(motionBasePath, targetSlotId);
    if (fs.existsSync(targetMotionPath)) {
      const motionFiles = [];
      
      function scanMotionDir(dir, baseDir) {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(dir, item.name);
          if (item.isFile()) {
            const relativePath = path.relative(baseDir, fullPath);
            motionFiles.push({ fullPath, relativePath });
          } else if (item.isDirectory()) {
            scanMotionDir(fullPath, baseDir);
          }
        }
      }
      
      scanMotionDir(targetMotionPath, targetMotionPath);
      
      // Compare each motion file against other slots
      for (const { fullPath, relativePath } of motionFiles) {
        for (const otherSlotId of otherSlots) {
          const otherMotionPath = path.join(motionBasePath, otherSlotId);
          const otherFilePath = path.join(otherMotionPath, relativePath);
          
          if (fs.existsSync(otherFilePath)) {
            // Quick size check
            const targetStats = fs.statSync(fullPath);
            const otherStats = fs.statSync(otherFilePath);
            if (targetStats.size !== otherStats.size) {
              continue;
            }
            
            if (filesAreIdentical(fullPath, otherFilePath)) {
              const sourceConfigPath = `fighter/${fighterCodename}/motion/body/${otherSlotId}/${relativePath.replace(/\\/g, '/')}`;
              const targetConfigPath = `fighter/${fighterCodename}/motion/body/${targetSlotId}/${relativePath.replace(/\\/g, '/')}`;
              
              if (!sharesToAdd[sourceConfigPath]) {
                sharesToAdd[sourceConfigPath] = [];
              }
              sharesToAdd[sourceConfigPath].push(targetConfigPath);
              
              filesToDelete.push(fullPath);
              matchCount++;
              event.sender.send('debug-message', `[DEBUG] Motion match: ${path.basename(fullPath)}`);
              
              // Only need one match per file
              break;
            }
          }
        }
      }
    }
  }
  
  event.sender.send('debug-message', `[DEBUG] Cross-alt comparison found ${matchCount} identical files that can be shared`);
  
  // Delete redundant files
  for (const filePath of filesToDelete) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      event.sender.send('debug-message', `[DEBUG] Error deleting ${filePath}: ${error.message}`);
    }
  }
  
  return { sharesToAdd, filesToDelete };
}

// Helper to find all files for a slot recursively
function findSlotFilesRecursive(dir, slotId, results) {
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        // If directory name matches slot ID exactly, recurse inside it
        if (item.name === slotId) {
          // Recurse to find all files inside this directory
          findSlotFilesRecursive(fullPath, slotId, results);
        } else {
          // Otherwise continue searching in subdirectories
          findSlotFilesRecursive(fullPath, slotId, results);
        }
      } else if (item.isFile()) {
        // Check if file name or its path contains slot ID
        if (item.name.includes(slotId) || fullPath.includes(path.sep + slotId + path.sep)) {
          results.push(fullPath);
        }
      }
    }
  } catch (error) {
    // Ignore errors for missing directories
  }
}

// Helper to merge import config into main config
async function mergeImportConfig(mainModPath, importConfigPath, addedSlots, importBaseSlot, event) {
  const mainConfigPath = path.join(mainModPath, 'config.json');
  
  if (!fs.existsSync(mainConfigPath)) {
    event.sender.send('debug-message', `[DEBUG] Main config not found, skipping merge`);
    return;
  }
  
  const mainConfig = JSON.parse(fs.readFileSync(mainConfigPath, 'utf8'));
  const importConfig = JSON.parse(fs.readFileSync(importConfigPath, 'utf8'));
  
  event.sender.send('debug-message', `[DEBUG] Merging config entries for ${addedSlots.length} slots`);
  
  // For each added slot, copy relevant config entries
  for (const { importSlot, targetSlot } of addedSlots) {
    // Helper to replace slot IDs in strings
    const replaceSlotInString = (str) => {
      if (typeof str !== 'string') return str;
      return str.replace(new RegExp(importSlot, 'g'), targetSlot);
    };
    
    // Helper to process config values recursively
    const processConfigValue = (value) => {
      if (typeof value === 'string') {
        return replaceSlotInString(value);
      } else if (Array.isArray(value)) {
        return value.map(v => processConfigValue(v)).filter(v => v && (!Array.isArray(v) || v.length > 0));
      } else if (typeof value === 'object' && value !== null) {
        const result = {};
        for (const [k, v] of Object.entries(value)) {
          const newKey = replaceSlotInString(k);
          result[newKey] = processConfigValue(v);
        }
        return result;
      }
      return value;
    };
    
    // Merge new-dir-infos
    if (importConfig['new-dir-infos'] && Array.isArray(importConfig['new-dir-infos'])) {
      if (!mainConfig['new-dir-infos']) mainConfig['new-dir-infos'] = [];
      for (const entry of importConfig['new-dir-infos']) {
        if (entry.includes(importSlot)) {
          const newEntry = replaceSlotInString(entry);
          if (!mainConfig['new-dir-infos'].includes(newEntry)) {
            mainConfig['new-dir-infos'].push(newEntry);
          }
        }
      }
    }
    
    // Merge new-dir-infos-base
    if (importConfig['new-dir-infos-base']) {
      if (!mainConfig['new-dir-infos-base']) mainConfig['new-dir-infos-base'] = {};
      for (const [key, value] of Object.entries(importConfig['new-dir-infos-base'])) {
        if (key.includes(importSlot)) {
          const newKey = replaceSlotInString(key);
          mainConfig['new-dir-infos-base'][newKey] = value;
        }
      }
    }
    
    // Merge new-dir-files (object structure: directory keys with file arrays as values)
    if (importConfig['new-dir-files'] && typeof importConfig['new-dir-files'] === 'object') {
      if (!mainConfig['new-dir-files']) mainConfig['new-dir-files'] = {};
      for (const [dirKey, files] of Object.entries(importConfig['new-dir-files'])) {
        if (dirKey.includes(importSlot)) {
          const newDirKey = replaceSlotInString(dirKey);
          const newFiles = Array.isArray(files) 
            ? files.map(f => replaceSlotInString(f))
            : [replaceSlotInString(files)];
          mainConfig['new-dir-files'][newDirKey] = newFiles;
        }
      }
    }
    
    // Merge share-to-added
    if (importConfig['share-to-added']) {
      if (!mainConfig['share-to-added']) mainConfig['share-to-added'] = {};
      for (const [source, targets] of Object.entries(importConfig['share-to-added'])) {
        if (source.includes(importSlot)) {
          const newSource = replaceSlotInString(source);
          const newTargets = processConfigValue(targets);
          mainConfig['share-to-added'][newSource] = newTargets;
        } else if (source.match(/\/c00\//)) {
          // Handle fictional slots (like c00 for vanilla character) - copy as-is if target includes import slot
          const targetArray = Array.isArray(targets) ? targets : [targets];
          const hasImportTarget = targetArray.some(t => typeof t === 'string' && t.includes(importSlot));
          if (hasImportTarget) {
            const newTargets = targetArray.map(t => replaceSlotInString(t));
            mainConfig['share-to-added'][source] = newTargets;
            event.sender.send('debug-message', `[DEBUG] Added fictional slot sharing: ${source} -> ${newTargets.join(', ')}`);
          }
        }
      }
    }
    
    // Merge share-to-vanilla
    if (importConfig['share-to-vanilla']) {
      if (!mainConfig['share-to-vanilla']) mainConfig['share-to-vanilla'] = {};
      for (const [source, targets] of Object.entries(importConfig['share-to-vanilla'])) {
        if (source.includes(importSlot)) {
          const newSource = replaceSlotInString(source);
          const newTargets = processConfigValue(targets);
          mainConfig['share-to-vanilla'][newSource] = newTargets;
        }
      }
    }
  }
  
  // Write updated config (preserve original formatting)
  writeJsonPreserve(mainConfigPath, mainConfig);
  event.sender.send('debug-message', `[DEBUG] Config merged successfully`);
}

// Helper function to replace config entries for replaced slots
async function replaceImportConfig(mainModPath, importConfigPath, replacedSlots, importBaseSlot, event) {
  const mainConfigPath = path.join(mainModPath, 'config.json');
  
  if (!fs.existsSync(mainConfigPath)) {
    event.sender.send('debug-message', `[DEBUG] Main config not found, skipping config update`);
    return;
  }
  
  const mainConfig = JSON.parse(fs.readFileSync(mainConfigPath, 'utf8'));
  const importConfig = JSON.parse(fs.readFileSync(importConfigPath, 'utf8'));
  
  event.sender.send('debug-message', `[DEBUG] Config: Starting replacement for ${replacedSlots.length} slots`);
  
  let totalNewDirInfos = 0, totalNewDirInfosBase = 0, totalNewDirFiles = 0, totalShareToAdded = 0, totalShareToVanilla = 0;
  
  // For each replaced slot, remove old entries and add new ones
  for (const { importSlot, targetSlot } of replacedSlots) {
    // Helper to replace slot IDs in strings
    const replaceSlotInString = (str) => {
      if (typeof str !== 'string') return str;
      return str.replace(new RegExp(importSlot, 'g'), targetSlot);
    };
    
    // Helper to process config values recursively
    const processConfigValue = (value) => {
      if (typeof value === 'string') {
        return replaceSlotInString(value);
      } else if (Array.isArray(value)) {
        return value.map(v => processConfigValue(v)).filter(v => v && (!Array.isArray(v) || v.length > 0));
      } else if (typeof value === 'object' && value !== null) {
        const result = {};
        for (const [k, v] of Object.entries(value)) {
          const newKey = replaceSlotInString(k);
          result[newKey] = processConfigValue(v);
        }
        return result;
      }
      return value;
    };
    
    // Replace new-dir-infos entries
    if (mainConfig['new-dir-infos'] && Array.isArray(mainConfig['new-dir-infos'])) {
      const oldLength = mainConfig['new-dir-infos'].length;
      mainConfig['new-dir-infos'] = mainConfig['new-dir-infos'].filter(entry => !entry.includes(targetSlot));
      const removed = oldLength - mainConfig['new-dir-infos'].length;
      
      // Add new entries from import
      let added = 0;
      if (importConfig['new-dir-infos'] && Array.isArray(importConfig['new-dir-infos'])) {
        for (const entry of importConfig['new-dir-infos']) {
          if (entry.includes(importSlot)) {
            const newEntry = replaceSlotInString(entry);
            if (!mainConfig['new-dir-infos'].includes(newEntry)) {
              mainConfig['new-dir-infos'].push(newEntry);
              added++;
            }
          }
        }
      }
      totalNewDirInfos += added;
      event.sender.send('debug-message', `[DEBUG] Config: new-dir-infos: removed ${removed}, added ${added} for ${targetSlot}`);
    }
    
    // Replace new-dir-infos-base entries
    if (mainConfig['new-dir-infos-base']) {
      let removed = 0, added = 0;
      for (const key in mainConfig['new-dir-infos-base']) {
        if (key.includes(targetSlot)) {
          delete mainConfig['new-dir-infos-base'][key];
          removed++;
        }
      }
      
      if (importConfig['new-dir-infos-base']) {
        for (const [key, value] of Object.entries(importConfig['new-dir-infos-base'])) {
          if (key.includes(importSlot)) {
            const newKey = replaceSlotInString(key);
            mainConfig['new-dir-infos-base'][newKey] = value;
            added++;
          }
        }
      }
      totalNewDirInfosBase += added;
      event.sender.send('debug-message', `[DEBUG] Config: new-dir-infos-base: removed ${removed}, added ${added} for ${targetSlot}`);
    }
    
    // Replace new-dir-files entries (object structure: directory keys with file arrays as values)
    if (mainConfig['new-dir-files'] && typeof mainConfig['new-dir-files'] === 'object') {
      let removed = 0, added = 0;
      
      // Remove all entries from main config that contain the target slot
      const keysToRemove = [];
      for (const key of Object.keys(mainConfig['new-dir-files'])) {
        if (key.includes(targetSlot)) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        delete mainConfig['new-dir-files'][key];
        removed++;
      }
      
      // Add new entries from import config
      if (importConfig['new-dir-files'] && typeof importConfig['new-dir-files'] === 'object') {
        for (const [dirKey, files] of Object.entries(importConfig['new-dir-files'])) {
          if (dirKey.includes(importSlot)) {
            const newDirKey = replaceSlotInString(dirKey);
            const newFiles = Array.isArray(files) 
              ? files.map(f => replaceSlotInString(f))
              : [replaceSlotInString(files)];
            
            // Remove duplicates from the file array
            const deduplicatedFiles = [...new Set(newFiles)];
            if (deduplicatedFiles.length !== newFiles.length) {
              event.sender.send('debug-message', `[DEBUG] Removed ${newFiles.length - deduplicatedFiles.length} duplicate files from ${newDirKey}`);
            }
            
            mainConfig['new-dir-files'][newDirKey] = deduplicatedFiles;
            added++;
          }
        }
      }
      
      totalNewDirFiles += added;
      event.sender.send('debug-message', `[DEBUG] Config: new-dir-files: removed ${removed}, added ${added} for ${targetSlot}`);
    }
    
    // Replace share-to-added entries using SMART MERGE (like add skins)
    if (!mainConfig['share-to-added']) {
      mainConfig['share-to-added'] = {};
    }
    
    let removed = 0, added = 0, merged = 0, detectedAdded = 0;
    
    // Remove old entries for target slot (where target slot is the SOURCE or TARGET)
    for (const source in mainConfig['share-to-added']) {
      if (source.includes(targetSlot)) {
        delete mainConfig['share-to-added'][source];
        removed++;
      } else {
        let targets = mainConfig['share-to-added'][source];
        if (Array.isArray(targets)) {
          const filteredTargets = targets.filter(t => !t.includes(targetSlot));
          if (filteredTargets.length === 0) {
            delete mainConfig['share-to-added'][source];
          } else if (filteredTargets.length !== targets.length) {
            mainConfig['share-to-added'][source] = filteredTargets;
            removed++;
          }
        }
      }
    }
    
    // Smart merge share-to-added from import config
    if (importConfig['share-to-added']) {
      for (const [source, targets] of Object.entries(importConfig['share-to-added'])) {
        const sourceHasImportSlot = source.includes(importSlot);
        const targetArray = Array.isArray(targets) ? targets : [targets];
        const targetHasImportSlot = targetArray.some(t => typeof t === 'string' && t.includes(importSlot));
        
        if (targetHasImportSlot) {
          // Import slot is a TARGET (being shared TO)
          const mainSource = replaceSlotInString(source);
          const newTarget = replaceSlotInString(targetArray.find(t => t.includes(importSlot)));
          const sourceFilePath = path.join(mainModPath, mainSource);
          const targetFilePath = path.join(mainModPath, newTarget);
          
          // Check if this is a fictional slot (like c00 for vanilla character)
          const isFictionalSlot = mainSource.match(/\/c00\//);
          
          if (mainConfig['share-to-added'][mainSource]) {
            // SOURCE EXISTS in main config!
            if (isFictionalSlot) {
              // For fictional slots (like c00), just add the target to the existing list
              const existingTargets = Array.isArray(mainConfig['share-to-added'][mainSource])
                ? mainConfig['share-to-added'][mainSource]
                : [mainConfig['share-to-added'][mainSource]];
              
              if (!existingTargets.includes(newTarget)) {
                existingTargets.push(newTarget);
                mainConfig['share-to-added'][mainSource] = existingTargets;
                merged++;
                event.sender.send('debug-message', `[DEBUG] Added to fictional slot share-to-added: ${mainSource} -> ${newTarget}`);
              }
            } else {
              // For real slots, check if target file exists and compare if both exist
              if (fs.existsSync(sourceFilePath) && fs.existsSync(targetFilePath)) {
                // Both files exist - verify they are identical before sharing
                if (filesAreIdentical(sourceFilePath, targetFilePath)) {
              const existingTargets = Array.isArray(mainConfig['share-to-added'][mainSource])
                ? mainConfig['share-to-added'][mainSource]
                : [mainConfig['share-to-added'][mainSource]];
              
              if (!existingTargets.includes(newTarget)) {
                existingTargets.push(newTarget);
                mainConfig['share-to-added'][mainSource] = existingTargets;
                merged++;
                event.sender.send('debug-message', `[DEBUG] Smart merged to existing share-to-added: ${mainSource} -> ${newTarget}`);
                
                // Delete the physical file since it's now shared
                    fs.unlinkSync(targetFilePath);
                  event.sender.send('debug-message', `[DEBUG] Deleted shared file: ${newTarget}`);
                  }
                } else {
                  event.sender.send('debug-message', `[DEBUG] Files differ, NOT sharing: ${mainSource} -> ${newTarget}`);
                  // Keep the physical file, don't add to share-to-added
                }
              } else if (fs.existsSync(sourceFilePath) && !fs.existsSync(targetFilePath)) {
                // Source exists but target doesn't - add to sharing list
                // This handles cases where files should be shared but target doesn't exist yet
                const existingTargets = Array.isArray(mainConfig['share-to-added'][mainSource])
                  ? mainConfig['share-to-added'][mainSource]
                  : [mainConfig['share-to-added'][mainSource]];
                
                if (!existingTargets.includes(newTarget)) {
                  existingTargets.push(newTarget);
                  mainConfig['share-to-added'][mainSource] = existingTargets;
                  merged++;
                  event.sender.send('debug-message', `[DEBUG] Added to share-to-added (source exists, target missing): ${mainSource} -> ${newTarget}`);
                }
              } else if (!fs.existsSync(sourceFilePath) && fs.existsSync(targetFilePath)) {
                // Source doesn't exist but target does - target has its own unique file, DON'T share
                event.sender.send('debug-message', `[DEBUG] NOT sharing (target has unique file): ${mainSource} -> ${newTarget}`);
                // Don't add to share-to-added
              } else if (!fs.existsSync(sourceFilePath) && !fs.existsSync(targetFilePath)) {
                // Neither file exists physically - this is OK for files shared from vanilla or other sources
                // If the source already has sharing relationships in mainConfig, preserve them by adding this target
                const existingTargets = Array.isArray(mainConfig['share-to-added'][mainSource])
                  ? mainConfig['share-to-added'][mainSource]
                  : [mainConfig['share-to-added'][mainSource]];
                
                if (!existingTargets.includes(newTarget)) {
                  existingTargets.push(newTarget);
                  mainConfig['share-to-added'][mainSource] = existingTargets;
                  merged++;
                  event.sender.send('debug-message', `[DEBUG] Added to share-to-added (files don't exist physically, preserving config relationship): ${mainSource} -> ${newTarget}`);
                }
              }
            }
          } else {
            // SOURCE DOESN'T EXIST in main config
            if (isFictionalSlot) {
              // For fictional slots, copy the entire sharing relationship as-is
              const newTargets = targetArray.map(t => replaceSlotInString(t));
              mainConfig['share-to-added'][mainSource] = newTargets;
              added++;
              event.sender.send('debug-message', `[DEBUG] Added fictional slot sharing as-is: ${mainSource} -> ${newTargets.join(', ')}`);
            } else {
              // For real slots, keep file and add new entry
              const newTargets = targetArray.map(t => replaceSlotInString(t));
              mainConfig['share-to-added'][mainSource] = newTargets;
              added++;
            }
          }
        } else if (sourceHasImportSlot) {
          // Import slot is a SOURCE (sharing FROM it)
          const newSource = replaceSlotInString(source);
          const newTargets = targetArray.map(t => replaceSlotInString(t));
          mainConfig['share-to-added'][newSource] = newTargets;
          added++;
        }
      }
    }
    
    // Add detected shares from binary comparison (auto-detected model file sharing)
    const slotData = replacedSlots.find(s => s.targetSlot === targetSlot);
    if (slotData && slotData.detectedShares && Object.keys(slotData.detectedShares).length > 0) {
      event.sender.send('debug-message', `[DEBUG] Processing ${Object.keys(slotData.detectedShares).length} detected shares for ${targetSlot}`);
      for (const [source, targets] of Object.entries(slotData.detectedShares)) {
        if (!mainConfig['share-to-added'][source]) {
          mainConfig['share-to-added'][source] = [];
        }
        
        // Merge targets (avoid duplicates)
        const existingTargets = mainConfig['share-to-added'][source];
        const targetsArray = Array.isArray(targets) ? targets : [targets];
        for (const target of targetsArray) {
          if (!existingTargets.includes(target)) {
            existingTargets.push(target);
            detectedAdded++;
          }
        }
      }
    }
    
    // Add cross-alt shares from cross-alt comparison
    if (slotData && slotData.crossAltShares && Object.keys(slotData.crossAltShares).length > 0) {
      event.sender.send('debug-message', `[DEBUG] Processing ${Object.keys(slotData.crossAltShares).length} cross-alt shares for ${targetSlot}`);
      for (const [source, targets] of Object.entries(slotData.crossAltShares)) {
        if (!mainConfig['share-to-added'][source]) {
          mainConfig['share-to-added'][source] = [];
        }
        
        // Merge targets (avoid duplicates)
        const existingTargets = mainConfig['share-to-added'][source];
        const targetsArray = Array.isArray(targets) ? targets : [targets];
        for (const target of targetsArray) {
          if (!existingTargets.includes(target)) {
            existingTargets.push(target);
            detectedAdded++;
          }
        }
      }
    }
    
    totalShareToAdded += added + merged + detectedAdded;
    event.sender.send('debug-message', `[DEBUG] Config: share-to-added: removed ${removed}, added ${added}, merged ${merged}, detected ${detectedAdded} for ${targetSlot}`);
    
    // Replace share-to-vanilla entries
    if (mainConfig['share-to-vanilla']) {
      let removed = 0, added = 0;
      for (const source in mainConfig['share-to-vanilla']) {
        if (source.includes(targetSlot)) {
          delete mainConfig['share-to-vanilla'][source];
          removed++;
        }
      }
      
      if (importConfig['share-to-vanilla']) {
        for (const [source, targets] of Object.entries(importConfig['share-to-vanilla'])) {
          if (source.includes(importSlot)) {
            const newSource = replaceSlotInString(source);
            const newTargets = processConfigValue(targets);
            mainConfig['share-to-vanilla'][newSource] = newTargets;
            added++;
          }
        }
      }
      totalShareToVanilla += added;
      event.sender.send('debug-message', `[DEBUG] Config: share-to-vanilla: removed ${removed}, added ${added} for ${targetSlot}`);
    }
  }
  
  // Write updated config (preserve original formatting)
  writeJsonPreserve(mainConfigPath, mainConfig);
  event.sender.send('debug-message', `[DEBUG] Config replaced successfully: ${totalNewDirInfos} new-dir-infos, ${totalNewDirInfosBase} new-dir-infos-base, ${totalNewDirFiles} new-dir-files, ${totalShareToAdded} share-to-added, ${totalShareToVanilla} share-to-vanilla`);
}

ipcMain.handle('show-error', async (event, title, content) => {
  await dialog.showErrorBox(title, content);
});

// File system operations
const fs = require('fs');
const os = require('os');

// Helpers to preserve JSON formatting (indentation and EOL)
function detectIndentAndEol(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  // If file uses tabs anywhere at start-of-line, assume tabs
  for (const line of lines) {
    if (/^\t+\S/.test(line)) return { indent: '\t', eol };
  }
  // Otherwise detect smallest non-zero leading space count across lines
  let minSpaces = Infinity;
  for (const line of lines) {
    const m = line.match(/^( +)\S/);
    if (m) {
      const count = m[1].length;
      if (count > 0 && count < minSpaces) minSpaces = count;
    }
  }
  if (!Number.isFinite(minSpaces) || minSpaces <= 0) {
    // Default to 2 spaces
    return { indent: '  ', eol };
  }
  // Clamp to common sizes 2 or 4 if close
  if (minSpaces <= 2) return { indent: '  ', eol };
  if (minSpaces <= 4) return { indent: '    ', eol };
  // Fallback: use detected minimal spaces
  return { indent: ' '.repeat(minSpaces), eol };
}

// Extract slot number from a path or filename for sorting
function extractSlotNumber(str) {
  // Try folder pattern first: /c120/ or /c120
  let match = str.match(/\/c(\d+)(?:\/|$)/);
  if (match) return parseInt(match[1]);
  
  // Try filename pattern: _c120.
  match = str.match(/_c(\d+)\./);
  if (match) return parseInt(match[1]);
  
  // Try end of path: /c120
  match = str.match(/\/c(\d+)$/);
  if (match) return parseInt(match[1]);
  
  return 9999; // Put unmatched entries at the end
}

// Sort config entries numerically by slot number
function sortConfigBySlotNumber(data) {
  const sorted = {};
  
  // Sort new-dir-infos (array of paths)
  if (data['new-dir-infos'] && Array.isArray(data['new-dir-infos'])) {
    sorted['new-dir-infos'] = [...data['new-dir-infos']].sort((a, b) => {
      return extractSlotNumber(a) - extractSlotNumber(b);
    });
  }
  
  // Sort new-dir-infos-base (object with path keys)
  if (data['new-dir-infos-base'] && typeof data['new-dir-infos-base'] === 'object') {
    const entries = Object.entries(data['new-dir-infos-base']);
    entries.sort((a, b) => extractSlotNumber(a[0]) - extractSlotNumber(b[0]));
    sorted['new-dir-infos-base'] = Object.fromEntries(entries);
  }
  
  // Sort new-dir-files (object with path keys, values are arrays)
  if (data['new-dir-files'] && typeof data['new-dir-files'] === 'object') {
    const entries = Object.entries(data['new-dir-files']);
    entries.sort((a, b) => extractSlotNumber(a[0]) - extractSlotNumber(b[0]));
    // Also sort the file arrays within each entry
    sorted['new-dir-files'] = Object.fromEntries(
      entries.map(([key, files]) => [
        key, 
        Array.isArray(files) ? [...files].sort((a, b) => extractSlotNumber(a) - extractSlotNumber(b)) : files
      ])
    );
  }
  
  // Sort share-to-added (object with source paths as keys, target arrays as values)
  if (data['share-to-added'] && typeof data['share-to-added'] === 'object') {
    const entries = Object.entries(data['share-to-added']);
    entries.sort((a, b) => extractSlotNumber(a[0]) - extractSlotNumber(b[0]));
    // Also sort the target arrays
    sorted['share-to-added'] = Object.fromEntries(
      entries.map(([source, targets]) => [
        source,
        Array.isArray(targets) ? [...targets].sort((a, b) => extractSlotNumber(a) - extractSlotNumber(b)) : targets
      ])
    );
  }
  
  // Sort share-to-vanilla (object with source paths as keys)
  if (data['share-to-vanilla'] && typeof data['share-to-vanilla'] === 'object') {
    const entries = Object.entries(data['share-to-vanilla']);
    entries.sort((a, b) => extractSlotNumber(a[0]) - extractSlotNumber(b[0]));
    sorted['share-to-vanilla'] = Object.fromEntries(entries);
  }
  
  // Merge back with original data (preserving any other properties)
  return {
    ...data,
    ...sorted
  };
}

function writeJsonPreserve(filePath, data) {
  // Remove any accidentally added properties that shouldn't be in the config
  let cleanedData = { ...data };
  
  // Debug logging to see what properties are being removed
  if ('sharesToAdd' in data || 'filesToDelete' in data) {
    console.log(`[DEBUG] writeJsonPreserve: Removing contamination from ${filePath}`);
    if ('sharesToAdd' in data) {
      console.log(`[DEBUG] Removing sharesToAdd: ${JSON.stringify(data.sharesToAdd)}`);
    }
    if ('filesToDelete' in data) {
      console.log(`[DEBUG] Removing filesToDelete: ${JSON.stringify(data.filesToDelete)}`);
    }
  }
  
  delete cleanedData.sharesToAdd;
  delete cleanedData.filesToDelete;
  
  // Sort all entries by slot number for clean organization
  cleanedData = sortConfigBySlotNumber(cleanedData);
  
  let indent = '  ';
  let eol = os.EOL;
  try {
    if (fs.existsSync(filePath)) {
      const original = fs.readFileSync(filePath, 'utf8');
      const detected = detectIndentAndEol(original);
      indent = detected.indent || indent;
      eol = detected.eol || eol;
    }
  } catch (_) {}
  let json = JSON.stringify(cleanedData, null, indent);
  if (eol !== '\n') json = json.replace(/\n/g, eol);
  fs.writeFileSync(filePath, json);
}

ipcMain.handle('read-directory', async (event, dirPath) => {
  try {
    const files = [];
    const scanDirectory = (currentPath, relativePath = '') => {
      const items = fs.readdirSync(currentPath);
      
      for (const item of items) {
        const fullPath = path.join(currentPath, item);
        const relativeItemPath = path.join(relativePath, item).replace(/\\/g, '/');
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          // Skip common unnecessary folders
          if (['.git', '.vs', '__pycache__', 'junk', 'disabled'].includes(item.toLowerCase())) {
            continue;
          }
          scanDirectory(fullPath, relativeItemPath);
        } else {
          // Skip backup files
          if (!item.endsWith('.bak') && !item.endsWith('.tmp')) {
            files.push(relativeItemPath);
          }
        }
      }
    };
    
    scanDirectory(dirPath);
    return files;
  } catch (error) {
    throw new Error(`Failed to read directory: ${error.message}`);
  }
});

ipcMain.handle('list-directory', async (event, dirPath) => {
  try {
    const items = fs.readdirSync(dirPath);
    const result = [];
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        // Skip common unnecessary folders
        if (!['.git', '.vs', '__pycache__', 'junk', 'disabled'].includes(item.toLowerCase())) {
          result.push(item);
        }
      } else {
        // Include files too
        result.push(item);
      }
    }
    
    return result;
  } catch (error) {
    throw new Error(`Failed to list directory: ${error.message}`);
  }
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read file: ${error.message}`);
  }
});

ipcMain.handle('write-file', async (event, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (error) {
    throw new Error(`Failed to write file: ${error.message}`);
  }
});

ipcMain.handle('file-exists', async (event, filePath) => {
  try {
    return fs.existsSync(filePath);
  } catch (error) {
    return false;
  }
});

ipcMain.handle('get-file-size', async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch (error) {
    return -1;
  }
});

ipcMain.handle('compare-files', async (event, file1, file2) => {
  try {
    const stats1 = fs.statSync(file1);
    const stats2 = fs.statSync(file2);
    
    if (stats1.size !== stats2.size) {
      return false;
    }
    
    const buffer1 = fs.readFileSync(file1);
    const buffer2 = fs.readFileSync(file2);
    
    return buffer1.equals(buffer2);
  } catch (error) {
    return false;
  }
});

ipcMain.handle('create-directory', async (event, dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return true;
  } catch (error) {
    throw new Error(`Failed to create directory: ${error.message}`);
  }
});

ipcMain.handle('copy-file', async (event, source, destination) => {
  try {
    fs.copyFileSync(source, destination);
    return true;
  } catch (error) {
    throw new Error(`Failed to copy file: ${error.message}`);
  }
});

ipcMain.handle('move-file', async (event, source, destination) => {
  try {
    fs.renameSync(source, destination);
    return true;
  } catch (error) {
    throw new Error(`Failed to move file: ${error.message}`);
  }
});

ipcMain.handle('delete-file', async (event, filePath) => {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    throw new Error(`Failed to delete file: ${error.message}`);
  }
});

ipcMain.handle('delete-directory', async (event, dirPath) => {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    throw new Error(`Failed to delete directory: ${error.message}`);
  }
});

// Handle BNTX to PNG conversion using ultimate_tex_cli.exe
ipcMain.handle('convert-bntx-to-png', async (event, { inputFile, outputFile, toolPath }) => {
  try {
    console.log(`[DEBUG] Converting BNTX to PNG: ${inputFile} -> ${outputFile}`);
    console.log(`[DEBUG] Using tool: ${toolPath}`);

    // Ensure output directory exists
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Build command for ultimate_tex_cli.exe
    // Use proper Windows path format with quotes for paths with spaces
    const toolPathFixed = toolPath.replace(/^\.\//, ''); // Remove ./ prefix
    const command = `"${toolPathFixed}" "${inputFile}" "${outputFile}"`;
    console.log(`[DEBUG] Command: ${command}`);

    // Execute the conversion
    const { exec } = require('child_process');
    const result = await new Promise((resolve, reject) => {
      exec(command, { 
        cwd: process.cwd(),
        windowsHide: true,
        shell: true // Use shell for Windows compatibility
      }, (error, stdout, stderr) => {
        if (error) {
          console.log(`[DEBUG] Conversion error: ${error.message}`);
          console.log(`[DEBUG] stderr: ${stderr}`);
          reject(error);
        } else {
          console.log(`[DEBUG] Conversion stdout: ${stdout}`);
          resolve();
        }
      });
    });

    // Check if output file was created
    if (fs.existsSync(outputFile)) {
      console.log(`[DEBUG] Conversion successful: ${outputFile}`);
      return { success: true };
    } else {
      console.log(`[DEBUG] Output file not created: ${outputFile}`);
      return { success: false, error: 'Output file not created' };
    }
  } catch (error) {
    console.log(`[DEBUG] Conversion failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// Helper function to recursively remove empty directories
async function removeEmptyDirectories(rootDir, event) {
  let removedCount = 0;
  
  function isDirectoryEmpty(dirPath) {
    try {
      const items = fs.readdirSync(dirPath);
      return items.length === 0;
    } catch (error) {
      return false;
    }
  }
  
  function removeEmptyDirsRecursive(dirPath) {
    try {
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        return false;
      }
      
      // Get all items in directory
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      
      // Recursively process subdirectories
      for (const item of items) {
        if (item.isDirectory()) {
          const fullPath = path.join(dirPath, item.name);
          removeEmptyDirsRecursive(fullPath);
        }
      }
      
      // After processing subdirectories, check if this directory is now empty
      if (isDirectoryEmpty(dirPath)) {
        // Don't remove the root mod directory itself
        if (dirPath !== rootDir) {
          fs.rmdirSync(dirPath);
          removedCount++;
          if (event) {
            event.sender.send('debug-message', `[DEBUG] Removed empty directory: ${path.relative(rootDir, dirPath)}`);
          }
          return true;
        }
      }
      
      return false;
    } catch (error) {
      if (event) {
        event.sender.send('debug-message', `[DEBUG] Error checking directory ${dirPath}: ${error.message}`);
      }
      return false;
    }
  }
  
  // Start recursive cleanup
  removeEmptyDirsRecursive(rootDir);
  
  return removedCount;
}

// Helper to send progress updates to renderer
function sendProgress(event, current, total, message) {
  event.sender.send('operation-progress', { current, total, message });
}

// IPC handler for applying slot changes
ipcMain.handle('apply-slot-changes', async (event, { modRoot, enabledSlots, disabledSlots, slotMapping, pendingImports = [], baseSlotNum, fighterCodename }) => {
  try {
    console.log(`[DEBUG] ====== APPLY-SLOT-CHANGES IPC HANDLER CALLED ======`);
    console.log(`[DEBUG] Applying slot changes for mod: ${modRoot}`);
    console.log(`[DEBUG] Enabled slots: ${JSON.stringify(enabledSlots)}`);
    console.log(`[DEBUG] Disabled slots: ${JSON.stringify(disabledSlots)}`);
    console.log(`[DEBUG] Slot mapping: ${JSON.stringify(slotMapping)}`);
    console.log(`[DEBUG] Pending imports: ${JSON.stringify(pendingImports.length > 0 ? pendingImports.map(p => p.targetSlotId) : [])}`);
    
    // Calculate total steps for progress
    const totalSteps = (pendingImports?.length || 0) * 5 + // 5 steps per import (shift, copy, config, compare, cleanup)
                       (disabledSlots?.length || 0) + // disable operations
                       (Object.keys(slotMapping || {}).length > 0 ? 2 : 0) + // reordering
                       2; // config update + finalize
    let currentStep = 0;
    
    sendProgress(event, currentStep, totalSteps, 'Starting operations...');
    
    // Send a message to the renderer to confirm the handler was called
    event.sender.send('debug-message', 'apply-slot-changes handler called');
    
    // Send debug messages to renderer
    event.sender.send('debug-message', `[DEBUG] Applying slot changes for mod: ${modRoot}`);
    event.sender.send('debug-message', `[DEBUG] Enabled slots: ${JSON.stringify(enabledSlots)}`);
    event.sender.send('debug-message', `[DEBUG] Disabled slots: ${JSON.stringify(disabledSlots)}`);
    event.sender.send('debug-message', `[DEBUG] Slot mapping: ${JSON.stringify(slotMapping)}`);
    event.sender.send('debug-message', `[DEBUG] Pending imports: ${pendingImports.length}`);

    // Proactive cleanup of any leftover temp folders from prior failed runs
    try {
      const oldExplicit = path.join(modRoot, 'temp_reorder_explicit');
      if (fs.existsSync(oldExplicit)) {
        fs.rmSync(oldExplicit, { recursive: true, force: true });
        console.log(`[DEBUG] Cleaned lingering temp folder: ${oldExplicit}`);
      }
    } catch (e) {
      console.log(`[DEBUG] Warning cleaning lingering temp folder: ${e.message}`);
    }

    // Load config.json
    const configPath = path.join(modRoot, 'config.json');
    if (!fs.existsSync(configPath)) {
      throw new Error('Config file not found!');
    }

    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log(`[DEBUG] Loaded config.json`);

    // Create .disabled directory if it doesn't exist
    const disabledDir = path.join(modRoot, '.disabled');
    if (!fs.existsSync(disabledDir)) {
      fs.mkdirSync(disabledDir, { recursive: true });
      console.log(`[DEBUG] Created .disabled directory: ${disabledDir}`);
    }

    const results = {
      disabled: [],
      restored: [],
      reordered: [],
      imported: [],
      errors: []
    };
    
    // Track imported slot IDs (used later for filtering reordering)
    const importedSlotIds = new Set();
    
    // Process pending imports - each import handles its own shift
    if (pendingImports && pendingImports.length > 0) {
      event.sender.send('debug-message', `[DEBUG] Processing ${pendingImports.length} pending imports...`);
      
      // Use pending imports directly - the frontend already calculated correct target slots
      // The slotMapping is for existing slots being shifted, NOT for adjusting import targets
      let adjustedPendingImports = [...pendingImports];
      
      // Sort imports by target slot (LOWEST first) - this is crucial!
      // We process lowest target first, which shifts everything up, 
      // then the next import's target is adjusted accordingly
      adjustedPendingImports.sort((a, b) => {
        const aNum = parseInt(a.targetSlotId.substring(1));
        const bNum = parseInt(b.targetSlotId.substring(1));
        return aNum - bNum;
      });
      
      event.sender.send('debug-message', `[DEBUG] Imports will be processed in order: ${adjustedPendingImports.map(p => p.targetSlotId).join(', ')}`);
      
      // Get the display name for UI files
      let displayName = null;
      const uiBasePath = path.join(modRoot, 'ui', 'replace', 'chara');
      if (fs.existsSync(uiBasePath)) {
        const charaFolders = fs.readdirSync(uiBasePath).filter(f => 
          fs.statSync(path.join(uiBasePath, f)).isDirectory()
        );
        for (const charaFolder of charaFolders) {
          const charaPath = path.join(uiBasePath, charaFolder);
          const files = fs.readdirSync(charaPath);
          for (const file of files) {
            const match = file.match(/chara_\d+_(\w+)_\d+\.bntx/);
            if (match) {
              displayName = match[1];
              break;
            }
          }
          if (displayName) break;
        }
      }
      
      // Build list of currently enabled slots
      let currentEnabledSlots = [];
      const modelBodyPath = path.join(modRoot, 'fighter', fighterCodename, 'model', 'body');
      if (fs.existsSync(modelBodyPath)) {
        const items = fs.readdirSync(modelBodyPath, { withFileTypes: true });
        for (const item of items) {
          if (item.isDirectory() && /^c\d+$/.test(item.name)) {
            currentEnabledSlots.push(item.name);
          }
        }
        currentEnabledSlots.sort((a, b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));
      }
      
      event.sender.send('debug-message', `[DEBUG] Current slots before imports: ${currentEnabledSlots.join(', ')}`);
      
      // Process each import - EACH import does its own shift!
      for (let importIndex = 0; importIndex < adjustedPendingImports.length; importIndex++) {
        const pendingImport = adjustedPendingImports[importIndex];
        try {
          const { importData } = pendingImport;
          // Use the target slot as calculated by the frontend
          // The frontend already accounted for the shifts when calculating target slots
          const targetSlotId = pendingImport.targetSlotId;
          const targetSlotNum = parseInt(targetSlotId.substring(1));
          
          event.sender.send('debug-message', `[DEBUG] ===== IMPORTING: ${importData.originalSlotId} -> ${targetSlotId} =====`);
          currentStep++;
          sendProgress(event, currentStep, totalSteps, `Importing skin ${importIndex + 1}/${adjustedPendingImports.length}...`);
          importedSlotIds.add(targetSlotId);
          
          const importSlotId = importData.originalSlotId;
          const actualSlotId = importData.actualSlotId || importSlotId; // Use actual folder name if available
          const importFolder = importData.folder;
          const importBaseSlotNum = importData.baseSlotNum;
          
          event.sender.send('debug-message', `[DEBUG] Import slot: ${importSlotId}, Actual folder: ${actualSlotId}`);
          
          // ============================================================
          // STEP 0: SHIFT existing slots to make room for THIS import
          // ============================================================
          event.sender.send('debug-message', `[DEBUG] Step 0: Shifting slots to make room at ${targetSlotId}...`);
          
          // Find all physical slots >= targetSlotNum that need to shift up by 1
          const slotsToShift = currentEnabledSlots.filter(s => {
            const slotNum = parseInt(s.substring(1));
            return slotNum >= targetSlotNum;
          }).sort((a, b) => parseInt(b.substring(1)) - parseInt(a.substring(1))); // Sort descending (highest first)
          
          if (slotsToShift.length > 0) {
            event.sender.send('debug-message', `[DEBUG] Shifting slots UP by 1: ${slotsToShift.join(', ')}`);
            
            const shiftMapping = {};
            for (const slotId of slotsToShift) {
              const oldNum = parseInt(slotId.substring(1));
              const newNum = oldNum + 1;
              shiftMapping[slotId] = `c${newNum}`;
            }
            event.sender.send('debug-message', `[DEBUG] Shift mapping: ${JSON.stringify(shiftMapping)}`);
            
            // Shift fighter model/body directories
            for (const [oldSlot, newSlot] of Object.entries(shiftMapping)) {
              const oldPath = path.join(modelBodyPath, oldSlot);
              const newPath = path.join(modelBodyPath, newSlot);
              if (fs.existsSync(oldPath)) {
                fs.renameSync(oldPath, newPath);
                event.sender.send('debug-message', `[DEBUG] Moved model/body/${oldSlot} -> ${newSlot}`);
              }
            }
            
            // Shift other model subfolders (blaster, reticle, etc.)
            const modelPath = path.join(modRoot, 'fighter', fighterCodename, 'model');
            if (fs.existsSync(modelPath)) {
              const modelSubfolders = fs.readdirSync(modelPath, { withFileTypes: true })
                .filter(d => d.isDirectory() && d.name !== 'body').map(d => d.name);
              for (const subfolder of modelSubfolders) {
                for (const [oldSlot, newSlot] of Object.entries(shiftMapping)) {
                  const oldPath = path.join(modelPath, subfolder, oldSlot);
                  const newPath = path.join(modelPath, subfolder, newSlot);
                  if (fs.existsSync(oldPath)) {
                    fs.renameSync(oldPath, newPath);
                    event.sender.send('debug-message', `[DEBUG] Moved model/${subfolder}/${oldSlot} -> ${newSlot}`);
                  }
                }
              }
            }
            
            // Shift camera directories
            const cameraPath = path.join(modRoot, 'camera', 'fighter', fighterCodename);
            if (fs.existsSync(cameraPath)) {
              for (const [oldSlot, newSlot] of Object.entries(shiftMapping)) {
                const oldCameraPath = path.join(cameraPath, oldSlot);
                const newCameraPath = path.join(cameraPath, newSlot);
                if (fs.existsSync(oldCameraPath)) {
                  fs.renameSync(oldCameraPath, newCameraPath);
                  event.sender.send('debug-message', `[DEBUG] Moved camera/${oldSlot} -> ${newSlot}`);
                }
              }
            }
            
            // Shift motion directories
            const motionPath = path.join(modRoot, 'fighter', fighterCodename, 'motion');
            if (fs.existsSync(motionPath)) {
              for (const [oldSlot, newSlot] of Object.entries(shiftMapping)) {
                const oldMotionPath = path.join(motionPath, oldSlot);
                const newMotionPath = path.join(motionPath, newSlot);
                if (fs.existsSync(oldMotionPath)) {
                  fs.renameSync(oldMotionPath, newMotionPath);
                  event.sender.send('debug-message', `[DEBUG] Moved motion/${oldSlot} -> ${newSlot}`);
                }
              }
            }
            
            // Shift sound directories
            const soundPath = path.join(modRoot, 'sound', 'bank', 'fighter', fighterCodename);
            if (fs.existsSync(soundPath)) {
              for (const [oldSlot, newSlot] of Object.entries(shiftMapping)) {
                const oldSoundPath = path.join(soundPath, oldSlot);
                const newSoundPath = path.join(soundPath, newSlot);
                if (fs.existsSync(oldSoundPath)) {
                  fs.renameSync(oldSoundPath, newSoundPath);
                  event.sender.send('debug-message', `[DEBUG] Moved sound/${oldSlot} -> ${newSlot}`);
                }
              }
            }
            
            // Shift UI files
            if (displayName) {
              const charaFolders = fs.readdirSync(uiBasePath).filter(f => 
                fs.statSync(path.join(uiBasePath, f)).isDirectory()
              );
              for (const charaFolder of charaFolders) {
                const charaPath = path.join(uiBasePath, charaFolder);
                const charaNum = charaFolder.split('_')[1];
                for (const [oldSlot, newSlot] of Object.entries(shiftMapping)) {
                  const oldAlt = parseInt(oldSlot.substring(1)) - baseSlotNum;
                  const newAlt = parseInt(newSlot.substring(1)) - baseSlotNum;
                  const oldPadded = String(oldAlt).padStart(2, '0');
                  const newPadded = String(newAlt).padStart(2, '0');
                  const oldFile = `chara_${charaNum}_${displayName}_${oldPadded}.bntx`;
                  const newFile = `chara_${charaNum}_${displayName}_${newPadded}.bntx`;
                  const oldFilePath = path.join(charaPath, oldFile);
                  const newFilePath = path.join(charaPath, newFile);
                  if (fs.existsSync(oldFilePath)) {
                    fs.renameSync(oldFilePath, newFilePath);
                    event.sender.send('debug-message', `[DEBUG] Shifted UI: ${oldFile} -> ${newFile}`);
                  }
                }
              }
            }
            
            // Shift effect files
            const effectPath = path.join(modRoot, 'effect', 'fighter', fighterCodename);
            if (fs.existsSync(effectPath)) {
              for (const [oldSlot, newSlot] of Object.entries(shiftMapping)) {
                const oldFile = `ef_${fighterCodename}_${oldSlot}.eff`;
                const newFile = `ef_${fighterCodename}_${newSlot}.eff`;
                const oldEffectPath = path.join(effectPath, oldFile);
                const newEffectPath = path.join(effectPath, newFile);
                if (fs.existsSync(oldEffectPath)) {
                  fs.renameSync(oldEffectPath, newEffectPath);
                  event.sender.send('debug-message', `[DEBUG] Shifted effect: ${oldFile} -> ${newFile}`);
                }
              }
            }
            
            // Apply shift to config
            applySlotReordering(configData, shiftMapping);
            writeJsonPreserve(configPath, configData);
            event.sender.send('debug-message', `[DEBUG] Applied shift to config`);
            
            // Update currentEnabledSlots to reflect the shift
            currentEnabledSlots = currentEnabledSlots.map(s => {
              const slotNum = parseInt(s.substring(1));
              if (slotNum >= targetSlotNum) {
                return `c${slotNum + 1}`;
              }
              return s;
            }).sort((a, b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));
          }
          
          // Helper to replace slot IDs in paths
          const replaceSlotInPath = (filePath) => {
            let result = filePath;
            // Replace importSlotId with targetSlotId
            result = result.replace(new RegExp(`/${importSlotId}/`, 'g'), `/${targetSlotId}/`);
            result = result.replace(new RegExp(`/${importSlotId}$`), `/${targetSlotId}`);
            result = result.replace(new RegExp(`_${importSlotId}\\.`, 'g'), `_${targetSlotId}.`);
            // Also replace actualSlotId if it differs from importSlotId
            if (actualSlotId !== importSlotId) {
              result = result.replace(new RegExp(`/${actualSlotId}/`, 'g'), `/${targetSlotId}/`);
              result = result.replace(new RegExp(`/${actualSlotId}$`), `/${targetSlotId}`);
              result = result.replace(new RegExp(`_${actualSlotId}\\.`, 'g'), `_${targetSlotId}.`);
            }
            if (importBaseSlotNum !== baseSlotNum) {
              const importBaseSlotId = `c${importBaseSlotNum}`;
              const mainBaseSlotId = `c${baseSlotNum}`;
              result = result.replace(new RegExp(`/${importBaseSlotId}/`, 'g'), `/${mainBaseSlotId}/`);
            }
            return result;
          };
          
          // ============================================================
          // STEP A: COPY SKIN FILES from import folder to main moveset
          currentStep++;
          sendProgress(event, currentStep, totalSteps, `Copying files for skin ${importIndex + 1}...`);
          // ============================================================
          event.sender.send('debug-message', `[DEBUG] Step A: Copying skin files...`);
          let filesCopied = 0;
          
          // Calculate alt numbers for UI file naming
          // UI files use alt numbers from the original UI file naming (e.g., _06.bntx = alt 6)
          // Use the altNumber that was detected from the UI file during scanning, NOT calculated from slot folder
          const originalAltNumber = importData.altNumber !== undefined ? importData.altNumber : 0;
          const targetAltNum = targetSlotNum - baseSlotNum;
          const importAltStr = String(originalAltNumber).padStart(2, '0'); // Use original alt from UI file
          const targetAltStr = String(targetAltNum).padStart(2, '0');
          
          event.sender.send('debug-message', `[DEBUG] Alt numbers: import=${importAltStr} (from UI, altNumber=${importData.altNumber}), target=${targetAltStr} (${targetSlotId}), actualSlotId=${actualSlotId}`);
          
          // Recursively copy all files belonging to this slot
          // Check for BOTH importSlotId (calculated) and actualSlotId (detected from folder)
          const copySlotFilesRecursive = (srcDir, destBaseDir, relativePath = '') => {
            if (!fs.existsSync(srcDir)) return;
            
            const items = fs.readdirSync(srcDir, { withFileTypes: true });
            for (const item of items) {
              const srcPath = path.join(srcDir, item.name);
              const relPath = path.join(relativePath, item.name);
              
              if (item.isDirectory()) {
                // Check if this directory belongs to our import slot (check both calculated and actual)
                if (item.name === actualSlotId || item.name === importSlotId) {
                  // This IS our slot folder - copy its contents to target
                  event.sender.send('debug-message', `[DEBUG] Found slot folder: ${item.name} -> copying to ${targetSlotId}`);
                  copySlotFilesRecursive(srcPath, destBaseDir, path.join(relativePath, targetSlotId));
                } else if (item.name.startsWith('c') && /^c\d+$/.test(item.name)) {
                  // Skip other slot directories
                  continue;
                } else {
                  // Regular directory - recurse into it
                  copySlotFilesRecursive(srcPath, destBaseDir, relPath);
                }
              } else if (item.isFile()) {
                // Copy file if it belongs to our slot (check the relative path or filename)
                // Check for both actualSlotId and importSlotId patterns
                const isSlotFile = relPath.includes(`/${targetSlotId}/`) || 
                                   relPath.includes(`\\${targetSlotId}\\`) ||
                                   item.name.includes(`_${actualSlotId}.`) ||
                                   item.name.includes(`_${importSlotId}.`);
                
                if (isSlotFile || relativePath.includes(targetSlotId)) {
                  let destRelPath = relPath;
                  // Replace slot IDs in filename
                  if (item.name.includes(`_${actualSlotId}.`)) {
                    destRelPath = relPath.replace(`_${actualSlotId}.`, `_${targetSlotId}.`);
                  } else if (item.name.includes(`_${importSlotId}.`)) {
                    destRelPath = relPath.replace(`_${importSlotId}.`, `_${targetSlotId}.`);
                  }
                  
                  const destPath = path.join(destBaseDir, destRelPath);
                  const destDir = path.dirname(destPath);
                  
                  if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true });
                  }
                  
                  fs.copyFileSync(srcPath, destPath);
                  filesCopied++;
                }
              }
            }
          };
          
          copySlotFilesRecursive(importFolder, modRoot);
          event.sender.send('debug-message', `[DEBUG] Copied ${filesCopied} files`);
          
          // ============================================================
          // STEP A1.5: COPY SOUND FILES (special handling for slot-specific audio)
          // ============================================================
          // Sound files use filename patterns like: se_wolf_c126.nus3audio
          event.sender.send('debug-message', `[DEBUG] Step A1.5: Copying sound files...`);
          let soundFilesCopied = 0;
          
          const importSoundPath = path.join(importFolder, 'sound');
          if (fs.existsSync(importSoundPath)) {
            const copySoundFilesRecursive = (srcDir, destBaseDir, relativePath = '') => {
              const items = fs.readdirSync(srcDir, { withFileTypes: true });
              for (const item of items) {
                const srcPath = path.join(srcDir, item.name);
                const relPath = path.join(relativePath, item.name);
                
                if (item.isDirectory()) {
                  copySoundFilesRecursive(srcPath, destBaseDir, relPath);
                } else if (item.isFile()) {
                  // Check if this sound file belongs to our slot
                  const fileName = item.name.toLowerCase();
                  if ((fileName.endsWith('.nus3audio') || fileName.endsWith('.nus3bank')) &&
                      (item.name.includes(`_${actualSlotId}.`) || item.name.includes(`_${importSlotId}.`))) {
                    
                    // Replace slot ID in filename
                    let destFileName = item.name;
                    if (item.name.includes(`_${actualSlotId}.`)) {
                      destFileName = item.name.replace(`_${actualSlotId}.`, `_${targetSlotId}.`);
                    } else if (item.name.includes(`_${importSlotId}.`)) {
                      destFileName = item.name.replace(`_${importSlotId}.`, `_${targetSlotId}.`);
                    }
                    
                    const destRelPath = path.join(relativePath, destFileName);
                    const destPath = path.join(destBaseDir, 'sound', destRelPath);
                    const destDir = path.dirname(destPath);
                    
                    if (!fs.existsSync(destDir)) {
                      fs.mkdirSync(destDir, { recursive: true });
                    }
                    
                    fs.copyFileSync(srcPath, destPath);
                    soundFilesCopied++;
                    event.sender.send('debug-message', `[DEBUG] Copied sound: ${item.name} -> ${destFileName}`);
                  }
                }
              }
            };
            
            copySoundFilesRecursive(importSoundPath, modRoot);
          }
          event.sender.send('debug-message', `[DEBUG] Copied ${soundFilesCopied} sound files`);
          
          // ============================================================
          // STEP A1.6: COPY MARKER FILE (if skin doesn't have one)
          // Marker files can be named like: .marker, modname.marker, etc.
          // ============================================================
          event.sender.send('debug-message', `[DEBUG] Step A1.6: Checking for .marker file...`);
          
          // Helper to find marker files (any file ending with .marker)
          const findMarkerFile = (dirPath) => {
            if (!fs.existsSync(dirPath)) return null;
            const files = fs.readdirSync(dirPath);
            return files.find(f => f.toLowerCase().endsWith('.marker')) || null;
          };
          
          const targetModelBodyPath = path.join(modRoot, 'fighter', fighterCodename, 'model', 'body', targetSlotId);
          const targetMarkerFile = findMarkerFile(targetModelBodyPath);
          
          event.sender.send('debug-message', `[DEBUG] Target path: ${targetModelBodyPath}`);
          event.sender.send('debug-message', `[DEBUG] Target marker file: ${targetMarkerFile || 'none'}`);
          
          if (!targetMarkerFile) {
            let markerCopied = false;
            
            // Search for a .marker file in ANY existing slot of the main moveset
            const mainModelBodyPath = path.join(modRoot, 'fighter', fighterCodename, 'model', 'body');
            if (fs.existsSync(mainModelBodyPath)) {
              const existingSlots = fs.readdirSync(mainModelBodyPath, { withFileTypes: true })
                .filter(d => d.isDirectory() && /^c\d+$/.test(d.name))
                .map(d => d.name)
                .sort((a, b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));
              
              event.sender.send('debug-message', `[DEBUG] Searching for .marker in slots: ${existingSlots.join(', ')}`);
              
              for (const slotId of existingSlots) {
                if (slotId === targetSlotId) continue; // Skip target slot
                
                const slotPath = path.join(mainModelBodyPath, slotId);
                const sourceMarkerFile = findMarkerFile(slotPath);
                
                if (sourceMarkerFile) {
                  // Found a marker file - copy it to target
                  const sourceMarkerPath = path.join(slotPath, sourceMarkerFile);
                  
                  if (!fs.existsSync(targetModelBodyPath)) {
                    fs.mkdirSync(targetModelBodyPath, { recursive: true });
                  }
                  
                  const targetMarkerPath = path.join(targetModelBodyPath, sourceMarkerFile);
                  fs.copyFileSync(sourceMarkerPath, targetMarkerPath);
                  event.sender.send('debug-message', `[DEBUG] SUCCESS: Copied ${sourceMarkerFile} from ${slotId} to ${targetSlotId}`);
                  markerCopied = true;
                  break;
                }
              }
            }
            
            if (!markerCopied) {
              event.sender.send('debug-message', `[DEBUG] WARNING: No .marker file found in any existing slot`);
            }
          } else {
            event.sender.send('debug-message', `[DEBUG] Skin already has marker file: ${targetMarkerFile}`);
          }
          
          // ============================================================
          // STEP A2: COPY UI FILES (special handling for alt numbers)
          // ============================================================
          // UI files are named like: chara_#_displayname_XX.bntx
          // where XX is the alt number (00 for base slot, 01 for base+1, etc.)
          event.sender.send('debug-message', `[DEBUG] Step A2: Copying UI files...`);
          let uiFilesCopied = 0;
          
          // Get the display name from the import folder's UI files
          let importDisplayName = null;
          const importUIPath = path.join(importFolder, 'ui', 'replace', 'chara');
          if (fs.existsSync(importUIPath)) {
            const charaFolders = fs.readdirSync(importUIPath).filter(f => {
              const fullPath = path.join(importUIPath, f);
              return fs.statSync(fullPath).isDirectory();
            });
            
            // Find display name from any UI file
            for (const charaFolder of charaFolders) {
              const charaPath = path.join(importUIPath, charaFolder);
              const files = fs.readdirSync(charaPath);
              for (const file of files) {
                // Match pattern: chara_#_displayname_XX.bntx
                const match = file.match(/^chara_(\d+)_(\w+)_(\d{2})\.bntx$/);
                if (match) {
                  importDisplayName = match[2];
                  break;
                }
              }
              if (importDisplayName) break;
            }
          }
          
          if (importDisplayName) {
            event.sender.send('debug-message', `[DEBUG] Import display name: ${importDisplayName}`);
            
            // Copy UI files for this specific alt
            for (let charaNum = 0; charaNum <= 7; charaNum++) {
              const importCharaDir = path.join(importUIPath, `chara_${charaNum}`);
              const mainCharaDir = path.join(modRoot, 'ui', 'replace', 'chara', `chara_${charaNum}`);
              
              if (!fs.existsSync(importCharaDir)) continue;
              
              // Find UI file for this alt in import folder
              const importUIFile = `chara_${charaNum}_${importDisplayName}_${importAltStr}.bntx`;
              const importUIFilePath = path.join(importCharaDir, importUIFile);
              
              if (fs.existsSync(importUIFilePath)) {
                // Copy to main folder with target alt number
                // Use the MAIN moveset's display name (might be different from import)
                const targetUIFile = `chara_${charaNum}_${displayName || importDisplayName}_${targetAltStr}.bntx`;
                const targetUIFilePath = path.join(mainCharaDir, targetUIFile);
                
                if (!fs.existsSync(mainCharaDir)) {
                  fs.mkdirSync(mainCharaDir, { recursive: true });
                }
                
                fs.copyFileSync(importUIFilePath, targetUIFilePath);
                uiFilesCopied++;
                event.sender.send('debug-message', `[DEBUG] Copied UI: ${importUIFile} -> ${targetUIFile}`);
              }
            }
          } else {
            event.sender.send('debug-message', `[DEBUG] No UI files found in import folder`);
          }
          
          event.sender.send('debug-message', `[DEBUG] Copied ${uiFilesCopied} UI files`);
          
          // ============================================================
          // STEP B: MATERIALIZE shared files from skin's config
          currentStep++;
          sendProgress(event, currentStep, totalSteps, `Processing config for skin ${importIndex + 1}...`);
          // ============================================================
          event.sender.send('debug-message', `[DEBUG] Step B: Materializing shared files...`);
          let filesMaterialized = 0;
          
          // Check if skin folder has its own audio files (scan recursively)
          const skinSoundPath = path.join(importFolder, 'sound');
          let skinHasAudioFiles = false;
          let foundAudioFiles = [];
          
          const scanForAudioFiles = (dir) => {
            if (!fs.existsSync(dir)) return;
            const items = fs.readdirSync(dir, { withFileTypes: true });
            for (const item of items) {
              const fullPath = path.join(dir, item.name);
              if (item.isDirectory()) {
                scanForAudioFiles(fullPath);
              } else if (item.isFile()) {
                const nameLower = item.name.toLowerCase();
                if (nameLower.endsWith('.nus3audio') || nameLower.endsWith('.nus3bank')) {
                  foundAudioFiles.push(item.name);
                }
              }
            }
          };
          
          scanForAudioFiles(skinSoundPath);
          skinHasAudioFiles = foundAudioFiles.length > 0;
          event.sender.send('debug-message', `[DEBUG] Sound files in import: ${foundAudioFiles.join(', ') || 'none'}`);
          event.sender.send('debug-message', `[DEBUG] Skin has audio files: ${skinHasAudioFiles}`);
          
          // Load the skin's config
          let skinConfig = null;
          const skinConfigPath = path.join(importFolder, 'config.json');
          const mainBackupConfigPath = path.join(modRoot, 'config_backup.json');
          
          if (fs.existsSync(skinConfigPath)) {
            skinConfig = JSON.parse(fs.readFileSync(skinConfigPath, 'utf8'));
            event.sender.send('debug-message', `[DEBUG] Using skin's config.json`);
          } else if (fs.existsSync(mainBackupConfigPath)) {
            skinConfig = JSON.parse(fs.readFileSync(mainBackupConfigPath, 'utf8'));
            event.sender.send('debug-message', `[DEBUG] Using main moveset's config_backup.json`);
          }
          
          // Track share entries to preserve (vanilla + audio if skin has no audio)
          const vanillaShareEntries = {};
          
          if (skinConfig && skinConfig['share-to-added']) {
            for (const [source, targets] of Object.entries(skinConfig['share-to-added'])) {
              const targetArray = Array.isArray(targets) ? targets : [targets];
              
              // Check if any target references the import slot
              const relevantTargets = targetArray.filter(t => 
                t.includes(`/${importSlotId}/`) || t.includes(`_${importSlotId}.`) ||
                t.includes(`/${actualSlotId}/`) || t.includes(`_${actualSlotId}.`)
              );
              
              if (relevantTargets.length === 0) continue;
              
              // Check if this is an audio file share
              const isAudioShare = source.includes('sound/') && 
                (source.endsWith('.nus3audio') || source.endsWith('.nus3bank'));
              
              // Extract source slot number - folder pattern (/cXXX/) or filename pattern (_cXXX.)
              let sourceSlotMatch = source.match(/\/c(\d+)\//);
              if (!sourceSlotMatch && isAudioShare) {
                // Audio files use filename pattern like se_wolf_c120.nus3audio
                sourceSlotMatch = source.match(/_c(\d+)\./);
              }
              if (!sourceSlotMatch) continue;
              const sourceSlotNum = parseInt(sourceSlotMatch[1]);
              const isVanillaSource = sourceSlotNum <= 7;
              
              // Preserve share if:
              // 1. It's from vanilla (c00-c07), OR
              // 2. It's an audio share AND the skin doesn't have its own audio files
              const shouldPreserveShare = isVanillaSource || (isAudioShare && !skinHasAudioFiles);
              
              if (shouldPreserveShare) {
                // Keep as config entry, don't materialize
                const adjustedSource = replaceSlotInPath(source);
                const adjustedTargets = relevantTargets.map(t => replaceSlotInPath(t));
                
                if (!vanillaShareEntries[adjustedSource]) {
                  vanillaShareEntries[adjustedSource] = [];
                }
                vanillaShareEntries[adjustedSource].push(...adjustedTargets);
                
                if (isVanillaSource) {
                  event.sender.send('debug-message', `[DEBUG] Preserving vanilla share: ${source}`);
                } else {
                  event.sender.send('debug-message', `[DEBUG] Preserving audio share (skin has no audio): ${source}`);
                }
              } else {
                // Materialize the files physically
                for (const target of relevantTargets) {
                  const adjustedTarget = replaceSlotInPath(target);
                  const targetPath = path.join(modRoot, adjustedTarget);
                  
                  // Skip if target already exists
                  if (fs.existsSync(targetPath)) continue;
                  
                  // Try to find source in import folder first
                  const importSourcePath = path.join(importFolder, source);
                  // Also try with adjusted base slot
                  const adjustedSource = replaceSlotInPath(source);
                  const mainSourcePath = path.join(modRoot, adjustedSource);
                  
                  let sourcePath = null;
                  if (fs.existsSync(importSourcePath)) {
                    sourcePath = importSourcePath;
                  } else if (fs.existsSync(mainSourcePath)) {
                    sourcePath = mainSourcePath;
                  }
                  
                  if (sourcePath) {
                    const targetDir = path.dirname(targetPath);
                    if (!fs.existsSync(targetDir)) {
                      fs.mkdirSync(targetDir, { recursive: true });
                    }
                    fs.copyFileSync(sourcePath, targetPath);
                    filesMaterialized++;
                    event.sender.send('debug-message', `[DEBUG] Materialized: ${path.basename(source)} -> ${adjustedTarget}`);
                  }
                }
              }
            }
          }
          
          event.sender.send('debug-message', `[DEBUG] Materialized ${filesMaterialized} shared files`);
          
          // ============================================================
          // STEP C: MERGE CONFIG entries (skip materialized shares)
          // ============================================================
          event.sender.send('debug-message', `[DEBUG] Step C: Merging config entries...`);
          
          if (skinConfig) {
            // Merge new-dir-infos
            if (skinConfig['new-dir-infos']) {
              if (!configData['new-dir-infos']) configData['new-dir-infos'] = [];
              for (const entry of skinConfig['new-dir-infos']) {
                if (entry.includes(`/${importSlotId}`) || entry.includes(`/${importSlotId}/`)) {
                  const adjustedEntry = replaceSlotInPath(entry);
                  if (!configData['new-dir-infos'].includes(adjustedEntry)) {
                    configData['new-dir-infos'].push(adjustedEntry);
                  }
                }
              }
            }
            
            // Merge new-dir-infos-base
            if (skinConfig['new-dir-infos-base']) {
              if (!configData['new-dir-infos-base']) configData['new-dir-infos-base'] = {};
              for (const [key, value] of Object.entries(skinConfig['new-dir-infos-base'])) {
                if (key.includes(`/${importSlotId}/`) || key.includes(`/${importSlotId}`)) {
                  const adjustedKey = replaceSlotInPath(key);
                  configData['new-dir-infos-base'][adjustedKey] = value;
                }
              }
            }
            
            // Merge new-dir-files
            if (skinConfig['new-dir-files']) {
              if (!configData['new-dir-files']) configData['new-dir-files'] = {};
              for (const [key, files] of Object.entries(skinConfig['new-dir-files'])) {
                if (key.includes(`/${importSlotId}/`) || key.includes(`/${importSlotId}`)) {
                  const adjustedKey = replaceSlotInPath(key);
                  const adjustedFiles = (Array.isArray(files) ? files : [files]).map(f => replaceSlotInPath(f));
                  configData['new-dir-files'][adjustedKey] = [...new Set(adjustedFiles)];
                }
              }
            }
            
            // Add vanilla share entries to config
            if (!configData['share-to-added']) configData['share-to-added'] = {};
            for (const [source, targets] of Object.entries(vanillaShareEntries)) {
              if (configData['share-to-added'][source]) {
                const existing = Array.isArray(configData['share-to-added'][source]) 
                  ? configData['share-to-added'][source] 
                  : [configData['share-to-added'][source]];
                configData['share-to-added'][source] = [...new Set([...existing, ...targets])];
              } else {
                configData['share-to-added'][source] = targets;
              }
            }
            
            // Merge share-to-vanilla
            if (skinConfig['share-to-vanilla']) {
              if (!configData['share-to-vanilla']) configData['share-to-vanilla'] = {};
              for (const [key, value] of Object.entries(skinConfig['share-to-vanilla'])) {
                if (key.includes(`/${importSlotId}/`) || key.includes(`/${importSlotId}`)) {
                  const adjustedKey = replaceSlotInPath(key);
                  configData['share-to-vanilla'][adjustedKey] = value;
                }
              }
            }
          }
          
          event.sender.send('debug-message', `[DEBUG] Config entries merged`);
          
          // ============================================================
          // STEP D: BINARY COMPARISON & DE-MATERIALIZATION
          currentStep++;
          sendProgress(event, currentStep, totalSteps, `Optimizing files for skin ${importIndex + 1}...`);
          // ============================================================
          event.sender.send('debug-message', `[DEBUG] Step D: Binary comparison against main moveset...`);
          
          // Collect all files in the added skin
          // NOTE: Motion is NOT included - it's always shared from base alt and should not be de-materialized
          const skinFiles = [];
          const scanDirsForBinaryCompare = [
            path.join(modRoot, 'fighter', fighterCodename, 'model'),
            path.join(modRoot, 'camera', 'fighter', fighterCodename),
            path.join(modRoot, 'sound', 'bank')
          ];
          
          const collectFilesInSlot = (baseDir, slotId, results) => {
            if (!fs.existsSync(baseDir)) return;
            
            const scanRecursive = (dir) => {
              const items = fs.readdirSync(dir, { withFileTypes: true });
              for (const item of items) {
                const fullPath = path.join(dir, item.name);
                if (item.isDirectory()) {
                  if (item.name === slotId) {
                    // Found the slot folder - collect all files inside
                    const collectAll = (d) => {
                      const subitems = fs.readdirSync(d, { withFileTypes: true });
                      for (const subitem of subitems) {
                        const subPath = path.join(d, subitem.name);
                        if (subitem.isDirectory()) {
                          collectAll(subPath);
                        } else {
                          results.push({
                            fullPath: subPath,
                            relativePath: path.relative(modRoot, subPath).replace(/\\/g, '/')
                          });
                        }
                      }
                    };
                    collectAll(fullPath);
                  } else {
                    scanRecursive(fullPath);
                  }
                } else if (item.isFile() && item.name.includes(`_${slotId}.`)) {
                  results.push({
                    fullPath,
                    relativePath: path.relative(modRoot, fullPath).replace(/\\/g, '/')
                  });
                }
              }
            };
            
            scanRecursive(baseDir);
          };
          
          for (const dir of scanDirsForBinaryCompare) {
            collectFilesInSlot(dir, targetSlotId, skinFiles);
          }
          
          event.sender.send('debug-message', `[DEBUG] Found ${skinFiles.length} files in ${targetSlotId} to compare`);
          
          // Get list of slots to compare against
          const slotsToCompare = currentEnabledSlots
            .filter(s => s !== targetSlotId)
            .sort((a, b) => {
              const aNum = parseInt(a.substring(1));
              const bNum = parseInt(b.substring(1));
              if (aNum === baseSlotNum) return -1;
              if (bNum === baseSlotNum) return 1;
              return aNum - bNum;
            });
          
          // Compare each file
          const sharesDetected = {};
          const filesToDelete = [];
          
          for (const { fullPath, relativePath } of skinFiles) {
            if (fullPath.endsWith('.marker')) continue;
            
            // .nuanmb files (animations) should always be shared
            const isAnimationFile = fullPath.endsWith('.nuanmb');
            
            for (const otherSlot of slotsToCompare) {
              const otherRelPath = relativePath
                .replace(`/${targetSlotId}/`, `/${otherSlot}/`)
                .replace(`_${targetSlotId}.`, `_${otherSlot}.`);
              const otherPath = path.join(modRoot, otherRelPath);
              
              if (!fs.existsSync(otherPath)) continue;
              
              if (filesAreIdentical(fullPath, otherPath)) {
                // Create share entry
                if (!sharesDetected[otherRelPath]) {
                  sharesDetected[otherRelPath] = [];
                }
                sharesDetected[otherRelPath].push(relativePath);
                filesToDelete.push(fullPath);
                
                event.sender.send('debug-message', `[DEBUG] Match: ${path.basename(fullPath)} shares from ${otherSlot}`);
                break;
              }
            }
          }
          
          // Add share entries to config
          for (const [source, targets] of Object.entries(sharesDetected)) {
            if (configData['share-to-added'][source]) {
              const existing = Array.isArray(configData['share-to-added'][source])
                ? configData['share-to-added'][source]
                : [configData['share-to-added'][source]];
              configData['share-to-added'][source] = [...new Set([...existing, ...targets])];
            } else {
              configData['share-to-added'][source] = targets;
            }
          }
          
          // De-materialize (delete) the duplicate files
          let filesDeleted = 0;
          for (const filePath of filesToDelete) {
            try {
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                filesDeleted++;
              }
            } catch (err) {
              event.sender.send('debug-message', `[DEBUG] Error deleting ${filePath}: ${err.message}`);
            }
          }
          
          event.sender.send('debug-message', `[DEBUG] Created ${Object.keys(sharesDetected).length} share entries, deleted ${filesDeleted} files`);
          
          // Clean up empty directories
          const dirsToCheck = new Set(filesToDelete.map(f => path.dirname(f)));
          for (const dir of dirsToCheck) {
            let currentDir = dir;
            while (currentDir && currentDir !== modRoot && currentDir.startsWith(modRoot)) {
              try {
                const items = fs.readdirSync(currentDir);
                if (items.length === 0) {
                  fs.rmdirSync(currentDir);
                  event.sender.send('debug-message', `[DEBUG] Removed empty dir: ${path.relative(modRoot, currentDir)}`);
                  currentDir = path.dirname(currentDir);
                } else {
                  break;
                }
              } catch (err) {
                break;
              }
            }
          }
          
          event.sender.send('debug-message', `[DEBUG] ===== IMPORT COMPLETE: ${targetSlotId} =====`);
          
          // Add to currentEnabledSlots for next iteration
          if (!currentEnabledSlots.includes(targetSlotId)) {
            currentEnabledSlots.push(targetSlotId);
            currentEnabledSlots.sort((a, b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));
          }
          
          // PLACEHOLDER - old code removed
          if (false) { // Dead code block - kept temporarily to not break structure
            // Merge detected shares into config
            if (!configData['share-to-added']) configData['share-to-added'] = {};
            for (const [source, targets] of Object.entries(detectedShares)) {
              if (configData['share-to-added'][source]) {
                // Merge with existing targets
                const existingTargets = Array.isArray(configData['share-to-added'][source])
                  ? configData['share-to-added'][source]
                  : [configData['share-to-added'][source]];
                const newTargets = Array.isArray(targets) ? targets : [targets];
                configData['share-to-added'][source] = [...new Set([...existingTargets, ...newTargets])];
              } else {
                configData['share-to-added'][source] = Array.isArray(targets) ? targets : [targets];
              }
            }
            event.sender.send('debug-message', `[DEBUG] Added ${Object.keys(detectedShares).length} binary-compared sharing entries`);
            
            // Transitive sharing: If new slot matches base alt, and vanilla shares to base alt, add new slot to vanilla targets
            // This works at the slot/category level, not exact file matching
            // ONLY applies to vanilla (c00-c07) sources to avoid corrupting custom slot shares
            event.sender.send('debug-message', `[DEBUG] Checking for transitive sharing opportunities with existing shares (VANILLA ONLY)...`);
            let transitiveAdded = 0;
            
            // Build a map of which slots share to which other slots, by category
            const slotShareMap = {}; // { 'c120': Set(['c123', 'c124']), ... } per category
            
            for (const [newSource, newTargets] of Object.entries(detectedShares)) {
              const newSourceSlotMatch = newSource.match(/\/c(\d+)\//);
              if (!newSourceSlotMatch) continue;
              
              const newSourceSlot = `c${newSourceSlotMatch[1]}`;
              const newTargetArray = Array.isArray(newTargets) ? newTargets : [newTargets];
              
              // Extract the category (e.g., "camera", "model/blaster")
              const categoryMatch = newSource.match(/^([^\/]+\/[^\/]+\/[^\/]+)\//); // e.g., "camera/fighter/wolf"
              const category = categoryMatch ? categoryMatch[1] : '';
              
              const key = `${category}|${newSourceSlot}`;
              if (!slotShareMap[key]) slotShareMap[key] = new Set();
              
              for (const target of newTargetArray) {
                const targetSlotMatch = target.match(/\/c(\d+)\//);
                if (targetSlotMatch) {
                  slotShareMap[key].add(`c${targetSlotMatch[1]}`);
                }
              }
            }
            
            // Now check existing shares and add transitive targets
            // ONLY apply to vanilla slots (c00-c07) to avoid corrupting custom slot shares
            for (const [existingSource, existingTargets] of Object.entries(configData['share-to-added'])) {
              const existingSourceSlotMatch = existingSource.match(/\/c(\d+)\//);
              if (!existingSourceSlotMatch) continue;
              
              const existingSourceSlot = `c${existingSourceSlotMatch[1]}`;
              const existingSourceSlotNum = parseInt(existingSourceSlotMatch[1]);
              const isVanillaSlot = existingSourceSlotNum <= 7;
              
              // Skip non-vanilla slots - transitive sharing only for vanilla game files
              if (!isVanillaSlot) continue;
              
              const existingTargetArray = Array.isArray(existingTargets) ? existingTargets : [existingTargets];
              
              // Extract category from existing source
              const categoryMatch = existingSource.match(/^([^\/]+\/[^\/]+\/[^\/]+)\//);
              const category = categoryMatch ? categoryMatch[1] : '';
              
              // Extract the filename from existing source (after the slot directory)
              const filenameMatch = existingSource.match(/\/c\d+\/(.+)$/);
              const filename = filenameMatch ? filenameMatch[1] : '';
              
              const updatedTargets = [...existingTargetArray];
              let addedAny = false;
              
              // Check each existing target slot
              for (const existingTarget of existingTargetArray) {
                const existingTargetSlotMatch = existingTarget.match(/\/c(\d+)\//);
                if (!existingTargetSlotMatch) continue;
                
                const existingTargetSlot = `c${existingTargetSlotMatch[1]}`;
                const key = `${category}|${existingTargetSlot}`;
                
                // If this target slot shares to other slots (in slotShareMap), add those too
                if (slotShareMap[key]) {
                  for (const newSlot of slotShareMap[key]) {
                    // Build the new target path with the same filename but different slot
                    const newTargetPath = `${category}/${newSlot}/${filename}`;
                    
                    if (!updatedTargets.includes(newTargetPath)) {
                      updatedTargets.push(newTargetPath);
                      addedAny = true;
                      event.sender.send('debug-message', `[DEBUG] Transitive share: Added ${newSlot} to ${existingSourceSlot} targets for ${filename} (via ${existingTargetSlot})`);
                      transitiveAdded++;
                    }
                  }
                }
              }
              
              if (addedAny) {
                configData['share-to-added'][existingSource] = updatedTargets;
              }
            }
            
            if (transitiveAdded > 0) {
              event.sender.send('debug-message', `[DEBUG] Added ${transitiveAdded} transitive sharing relationships`);
            }
            
            // De-materialize: Delete physical files that are now shared
            event.sender.send('debug-message', `[DEBUG] Starting de-materialization of ${Object.keys(detectedShares).length} share entries...`);
            let dematerializedFiles = 0;
            const dirsToCheck = new Set();
            
            for (const [source, targets] of Object.entries(detectedShares)) {
              const targetArray = Array.isArray(targets) ? targets : [targets];
              event.sender.send('debug-message', `[DEBUG] Checking ${targetArray.length} targets for source: ${source}`);
              
              for (const target of targetArray) {
                const targetFilePath = path.join(modRoot, target);
                const fileExists = fs.existsSync(targetFilePath);
                event.sender.send('debug-message', `[DEBUG] Target: ${target}, exists: ${fileExists}`);
                
                if (fileExists) {
                  // Delete the physical file since it's now shared
                  fs.unlinkSync(targetFilePath);
                  dematerializedFiles++;
                  
                  // Mark directory for cleanup check
                  dirsToCheck.add(path.dirname(targetFilePath));
                  
                  event.sender.send('debug-message', `[DEBUG] De-materialized: ${target}`);
                }
              }
            }
            
            // Clean up empty directories
            for (const dir of dirsToCheck) {
              // Recursively check and remove empty directories
              let currentDir = dir;
              while (currentDir && currentDir !== modRoot) {
                try {
                  const items = fs.readdirSync(currentDir);
                  if (items.length === 0) {
                    fs.rmdirSync(currentDir);
                    event.sender.send('debug-message', `[DEBUG] Removed empty directory: ${path.relative(modRoot, currentDir)}`);
                    currentDir = path.dirname(currentDir);
                  } else {
                    break; // Directory not empty, stop climbing
                  }
                } catch (err) {
                  break; // Can't access or already removed
                }
              }
            }
            
            if (dematerializedFiles > 0) {
              event.sender.send('debug-message', `[DEBUG] De-materialized ${dematerializedFiles} files (now shared instead of physical)`);
            }
          }
          
          // Cross-alt comparison: Compare imported slot against all other existing alts
          event.sender.send('debug-message', `[DEBUG] Running cross-alt comparison for ${targetSlotId} against all existing alts`);
          const crossAltResult = await detectCrossAltSharing(
            modRoot,
            targetSlotId,
            enabledSlots,
            fighterCodename,
            event
          );
          
          // Only use sharesToAdd, not filesToDelete (which is internal)
          const crossAltShares = crossAltResult.sharesToAdd;
          
          if (crossAltShares && Object.keys(crossAltShares).length > 0) {
            // Merge cross-alt shares into config
            if (!configData['share-to-added']) configData['share-to-added'] = {};
            for (const [source, targets] of Object.entries(crossAltShares)) {
              if (configData['share-to-added'][source]) {
                // Merge with existing targets
                const existingTargets = Array.isArray(configData['share-to-added'][source])
                  ? configData['share-to-added'][source]
                  : [configData['share-to-added'][source]];
                const newTargets = Array.isArray(targets) ? targets : [targets];
                configData['share-to-added'][source] = [...new Set([...existingTargets, ...newTargets])];
              } else {
                configData['share-to-added'][source] = Array.isArray(targets) ? targets : [targets];
              }
            }
            event.sender.send('debug-message', `[DEBUG] Added ${Object.keys(crossAltShares).length} cross-alt sharing entries`);
            
            // Transitive sharing: If c123 matches c120, and c00 shares to c120, add c123 to c00's targets
            // This works at the slot/category level, not exact file matching
            // ONLY applies to vanilla (c00-c07) sources to avoid corrupting custom slot shares
            event.sender.send('debug-message', `[DEBUG] Checking for transitive sharing opportunities (VANILLA ONLY: c00 -> c120 + c120 -> c123 = c00 -> c123)...`);
            let transitiveAdded = 0;
            
            // Build a map of which slots share to which other slots, by category
            const slotShareMap = {}; // { 'c120': Set(['c123', 'c124']), ... } per category
            
            for (const [newSource, newTargets] of Object.entries(crossAltShares)) {
              const newSourceSlotMatch = newSource.match(/\/c(\d+)\//);
              if (!newSourceSlotMatch) continue;
              
              const newSourceSlot = `c${newSourceSlotMatch[1]}`;
              const newTargetArray = Array.isArray(newTargets) ? newTargets : [newTargets];
              
              // Extract the category (e.g., "camera", "model/blaster")
              const categoryMatch = newSource.match(/^([^\/]+\/[^\/]+\/[^\/]+)\//); // e.g., "camera/fighter/wolf"
              const category = categoryMatch ? categoryMatch[1] : '';
              
              const key = `${category}|${newSourceSlot}`;
              if (!slotShareMap[key]) slotShareMap[key] = new Set();
              
              for (const target of newTargetArray) {
                const targetSlotMatch = target.match(/\/c(\d+)\//);
                if (targetSlotMatch) {
                  slotShareMap[key].add(`c${targetSlotMatch[1]}`);
                }
              }
            }
            
            // Now check existing shares and add transitive targets
            // ONLY apply to vanilla slots (c00-c07) to avoid corrupting custom slot shares
            for (const [existingSource, existingTargets] of Object.entries(configData['share-to-added'])) {
              const existingSourceSlotMatch = existingSource.match(/\/c(\d+)\//);
              if (!existingSourceSlotMatch) continue;
              
              const existingSourceSlot = `c${existingSourceSlotMatch[1]}`;
              const existingSourceSlotNum = parseInt(existingSourceSlotMatch[1]);
              const isVanillaSlot = existingSourceSlotNum <= 7;
              
              // Skip non-vanilla slots - transitive sharing only for vanilla game files
              if (!isVanillaSlot) continue;
              
              const existingTargetArray = Array.isArray(existingTargets) ? existingTargets : [existingTargets];
              
              // Extract category from existing source
              const categoryMatch = existingSource.match(/^([^\/]+\/[^\/]+\/[^\/]+)\//);
              const category = categoryMatch ? categoryMatch[1] : '';
              
              // Extract the filename from existing source (after the slot directory)
              const filenameMatch = existingSource.match(/\/c\d+\/(.+)$/);
              const filename = filenameMatch ? filenameMatch[1] : '';
              
              const updatedTargets = [...existingTargetArray];
              let addedAny = false;
              
              // Check each existing target slot
              for (const existingTarget of existingTargetArray) {
                const existingTargetSlotMatch = existingTarget.match(/\/c(\d+)\//);
                if (!existingTargetSlotMatch) continue;
                
                const existingTargetSlot = `c${existingTargetSlotMatch[1]}`;
                const key = `${category}|${existingTargetSlot}`;
                
                // If this target slot shares to other slots (in slotShareMap), add those too
                if (slotShareMap[key]) {
                  for (const newSlot of slotShareMap[key]) {
                    // Build the new target path with the same filename but different slot
                    const newTargetPath = `${category}/${newSlot}/${filename}`;
                    
                    if (!updatedTargets.includes(newTargetPath)) {
                      updatedTargets.push(newTargetPath);
                      addedAny = true;
                      event.sender.send('debug-message', `[DEBUG] Transitive share: Added ${newSlot} to ${existingSourceSlot} targets for ${filename} (via ${existingTargetSlot})`);
                      transitiveAdded++;
                    }
                  }
                }
              }
              
              if (addedAny) {
                configData['share-to-added'][existingSource] = updatedTargets;
              }
            }
            
            if (transitiveAdded > 0) {
              event.sender.send('debug-message', `[DEBUG] Added ${transitiveAdded} transitive sharing relationships`);
            }
            
            // De-materialize: Delete physical files that are now shared
            event.sender.send('debug-message', `[DEBUG] Starting cross-alt de-materialization of ${Object.keys(crossAltShares).length} share entries...`);
            let dematerializedFiles = 0;
            const dirsToCheck = new Set();
            
            for (const [source, targets] of Object.entries(crossAltShares)) {
              const targetArray = Array.isArray(targets) ? targets : [targets];
              event.sender.send('debug-message', `[DEBUG] Cross-alt: Checking ${targetArray.length} targets for source: ${source}`);
              
              for (const target of targetArray) {
                const targetFilePath = path.join(modRoot, target);
                const fileExists = fs.existsSync(targetFilePath);
                event.sender.send('debug-message', `[DEBUG] Cross-alt target: ${target}, exists: ${fileExists}`);
                
                if (fileExists) {
                  // Delete the physical file since it's now shared
                  fs.unlinkSync(targetFilePath);
                  dematerializedFiles++;
                  
                  // Mark directory for cleanup check
                  dirsToCheck.add(path.dirname(targetFilePath));
                  
                  event.sender.send('debug-message', `[DEBUG] De-materialized: ${target}`);
                }
              }
            }
            
            // Clean up empty directories
            for (const dir of dirsToCheck) {
              // Recursively check and remove empty directories
              let currentDir = dir;
              while (currentDir && currentDir !== modRoot) {
                try {
                  const items = fs.readdirSync(currentDir);
                  if (items.length === 0) {
                    fs.rmdirSync(currentDir);
                    event.sender.send('debug-message', `[DEBUG] Removed empty directory: ${path.relative(modRoot, currentDir)}`);
                    currentDir = path.dirname(currentDir);
                  } else {
                    break; // Directory not empty, stop climbing
                  }
                } catch (err) {
                  break; // Can't access or already removed
                }
              }
            }
            
            if (dematerializedFiles > 0) {
              event.sender.send('debug-message', `[DEBUG] De-materialized ${dematerializedFiles} files (now shared instead of physical)`);
            }
          }
          
          // ============================================================
          // STEP E: Handle effect and motion files
          // ============================================================
          const baseSlotId = `c${baseSlotNum}`;
          
          // Check if imported slot has effect file - if not, copy from main's base alt
          // Effect files CAN'T be shared - they must be physical copies
          const targetEffectFile = path.join(modRoot, 'effect', 'fighter', fighterCodename, `ef_${fighterCodename}_${targetSlotId}.eff`);
          const baseEffectFile = path.join(modRoot, 'effect', 'fighter', fighterCodename, `ef_${fighterCodename}_${baseSlotId}.eff`);
          
          if (!fs.existsSync(targetEffectFile) && fs.existsSync(baseEffectFile)) {
            event.sender.send('debug-message', `[DEBUG] ${targetSlotId} has no effect file, copying from base ${baseSlotId}`);
            const effectDir = path.dirname(targetEffectFile);
            if (!fs.existsSync(effectDir)) {
              fs.mkdirSync(effectDir, { recursive: true });
            }
            fs.copyFileSync(baseEffectFile, targetEffectFile);
            event.sender.send('debug-message', `[DEBUG] Copied effect file: ${path.basename(baseEffectFile)} -> ${path.basename(targetEffectFile)}`);
          }
          
          // Check if imported slot has a motion folder - if not, share from base alt
          const targetMotionPath = path.join(modRoot, 'fighter', fighterCodename, 'motion', 'body', targetSlotId);
          const baseMotionPath = path.join(modRoot, 'fighter', fighterCodename, 'motion', 'body', baseSlotId);
          
          if (!fs.existsSync(targetMotionPath) && fs.existsSync(baseMotionPath)) {
            event.sender.send('debug-message', `[DEBUG] ${targetSlotId} has no motion folder, sharing from base ${baseSlotId}`);
            
            // Get all motion files from base
            const baseMotionFiles = [];
            function scanMotionDir(dir, baseDir) {
              const items = fs.readdirSync(dir, { withFileTypes: true });
              for (const item of items) {
                const fullPath = path.join(dir, item.name);
                if (item.isFile()) {
                  const relativePath = path.relative(baseDir, fullPath);
                  baseMotionFiles.push(relativePath);
                } else if (item.isDirectory()) {
                  scanMotionDir(fullPath, baseDir);
                }
              }
            }
            
            scanMotionDir(baseMotionPath, baseMotionPath);
            
            // Add share-to-added entries for all motion files
            if (!configData['share-to-added']) configData['share-to-added'] = {};
            let motionShareCount = 0;
            
            for (const motionFile of baseMotionFiles) {
              const sourceConfigPath = `fighter/${fighterCodename}/motion/body/${baseSlotId}/${motionFile.replace(/\\/g, '/')}`;
              const targetConfigPath = `fighter/${fighterCodename}/motion/body/${targetSlotId}/${motionFile.replace(/\\/g, '/')}`;
              
              if (!configData['share-to-added'][sourceConfigPath]) {
                configData['share-to-added'][sourceConfigPath] = [];
              }
              
              // Add target if not already present
              if (!configData['share-to-added'][sourceConfigPath].includes(targetConfigPath)) {
                configData['share-to-added'][sourceConfigPath].push(targetConfigPath);
                motionShareCount++;
              }
            }
            
            if (motionShareCount > 0) {
              event.sender.send('debug-message', `[DEBUG] Added ${motionShareCount} motion file shares from base alt`);
            }
          }
          
          results.imported.push(targetSlotId);
          currentStep++;
          sendProgress(event, currentStep, totalSteps, `Completed skin ${importIndex + 1}/${adjustedPendingImports.length}`);
        } catch (error) {
          event.sender.send('debug-message', `[DEBUG] Error importing ${pendingImport.targetSlotId}: ${error.message}`);
          results.errors.push(`Import ${pendingImport.targetSlotId}: ${error.message}`);
        }
      }
      
      // Write updated config with imported data (preserve original formatting)
      if (results.imported.length > 0) {
        // Debug: Check what slots are in config after import
        const slotsInConfigAfterImport = new Set();
        if (configData['new-dir-infos-base']) {
          for (const key of Object.keys(configData['new-dir-infos-base'])) {
            const slotMatch = key.match(/\/c(\d+)\//);
            if (slotMatch) slotsInConfigAfterImport.add(`c${slotMatch[1]}`);
          }
        }
        event.sender.send('debug-message', `[DEBUG] Slots in config after import: ${Array.from(slotsInConfigAfterImport).sort().join(', ')}`);
        event.sender.send('debug-message', `[DEBUG] new-dir-infos-base entries after import: ${Object.keys(configData['new-dir-infos-base'] || {}).length}`);
        
        writeJsonPreserve(configPath, configData);
        event.sender.send('debug-message', `[DEBUG] Wrote config after importing ${results.imported.length} slots`);
      }
    }

    // Phase A: Handle disabled slot restoration
    // CRITICAL: We must shift existing slots FIRST to make room, THEN restore disabled slots
    const disabledIdsToRestore = Array.isArray(enabledSlots)
      ? enabledSlots.filter(s => typeof s === 'string' && s.startsWith('disabled_'))
      : [];
    const preDisabledSlots = new Set(); // Track which slots were pre-disabled
    const restoredTargetSlots = new Set(); // Track which target slots were restored (to exclude from reordering)
    
    if (disabledIdsToRestore.length > 0 && typeof baseSlotNum === 'number') {
      try {
        event.sender.send('debug-message', `[DEBUG] ===== DISABLED SLOT RESTORATION PHASE =====`);
        event.sender.send('debug-message', `[DEBUG] Restoring ${disabledIdsToRestore.length} disabled slots`);
        
        // Step 1: Determine where each disabled slot needs to go based on enabledSlots order
        const restoreMapping = {}; // Maps disabled_c121_xxx -> c122 (target position)
        for (const disabledId of disabledIdsToRestore) {
          const idx = enabledSlots.indexOf(disabledId);
          if (idx >= 0) {
            const targetSlot = `c${baseSlotNum + idx}`;
            restoreMapping[disabledId] = targetSlot;
            event.sender.send('debug-message', `[DEBUG] ${disabledId} will be restored to position ${targetSlot}`);
          }
        }
        
        // Step 2: Sort disabled slots by target position (closest to base first)
        // This ensures we restore c121 before c124 before c126, etc.
        const sortedRestores = Object.entries(restoreMapping).sort(([, targetA], [, targetB]) => {
          return parseInt(targetA.substring(1)) - parseInt(targetB.substring(1));
        });
        
        event.sender.send('debug-message', `[DEBUG] Will restore in order: ${sortedRestores.map(([id, target]) => `${id} -> ${target}`).join(', ')}`);
        
        // Get currently enabled slots (excluding disabled ones being restored)
        let currentEnabledSlots = enabledSlots.filter(s => !s.startsWith('disabled_'));
        
        // Step 3: Process each restore ONE AT A TIME (starting from closest to base)
        for (const [disabledId, targetSlot] of sortedRestores) {
          const targetSlotNum = parseInt(targetSlot.substring(1));
          
          // Build shift mapping for THIS restore only
          const shiftMapping = {};
          for (const slot of currentEnabledSlots) {
            const slotNum = parseInt(slot.substring(1));
            if (slotNum >= targetSlotNum) {
              const newSlot = `c${slotNum + 1}`;  // Shift by 1 for this restore
              shiftMapping[slot] = newSlot;
            }
          }
          
          event.sender.send('debug-message', `[DEBUG] === Restoring ${disabledId} to ${targetSlot} ===`);
          event.sender.send('debug-message', `[DEBUG] Shift mapping for this restore: ${JSON.stringify(shiftMapping)}`);
          
          // Apply the shifts FIRST (if there are any slots to shift)
        if (Object.keys(shiftMapping).length > 0) {
          event.sender.send('debug-message', `[DEBUG] STEP 1: Shifting existing slots to make room...`);
          event.sender.send('debug-message', `[DEBUG] Shift mapping: ${JSON.stringify(shiftMapping)}`);
          
          // Apply the shift directly using our shiftMapping
          // We need to shift files on disk: c122->c123, c123->c124, etc.
          // Process in reverse order to avoid overwriting
          const slotsToShift = Object.keys(shiftMapping).sort((a, b) => {
            return parseInt(b.substring(1)) - parseInt(a.substring(1));
          });
          
          event.sender.send('debug-message', `[DEBUG] Processing shifts in order: ${JSON.stringify(slotsToShift)}`);
          
          // Create temp directory for atomic operations
          const tempDir = path.join(modRoot, 'temp_restore_shift');
          if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
          fs.mkdirSync(tempDir, { recursive: true });
          
          try {
            // Copy all slots to temp, then move them to their new positions
            for (const oldSlot of slotsToShift) {
              const newSlot = shiftMapping[oldSlot];
              event.sender.send('debug-message', `[DEBUG] Shifting ${oldSlot} -> ${newSlot}`);
              
              // Move fighter model/body files
              const oldFighterPath = path.join(modRoot, 'fighter', fighterCodename, 'model', 'body', oldSlot);
              if (fs.existsSync(oldFighterPath)) {
                const tempFighterPath = path.join(tempDir, 'fighter', 'model', 'body', oldSlot);
                fs.mkdirSync(path.dirname(tempFighterPath), { recursive: true });
                fs.cpSync(oldFighterPath, tempFighterPath, { recursive: true });
              }
              
              // Move other model subfolders (blaster, reticle, etc.)
              const modelPath = path.join(modRoot, 'fighter', fighterCodename, 'model');
              if (fs.existsSync(modelPath)) {
                const modelSubfolders = fs.readdirSync(modelPath, { withFileTypes: true })
                  .filter(d => d.isDirectory() && d.name !== 'body').map(d => d.name);
                for (const subfolder of modelSubfolders) {
                  const oldSubPath = path.join(modelPath, subfolder, oldSlot);
                  if (fs.existsSync(oldSubPath)) {
                    const tempSubPath = path.join(tempDir, 'fighter', 'model', subfolder, oldSlot);
                    fs.mkdirSync(path.dirname(tempSubPath), { recursive: true });
                    fs.cpSync(oldSubPath, tempSubPath, { recursive: true });
                  }
                }
              }
              
              // Move camera files
              const oldCameraPath = path.join(modRoot, 'camera', 'fighter', fighterCodename, oldSlot);
              if (fs.existsSync(oldCameraPath)) {
                const tempCameraPath = path.join(tempDir, 'camera', oldSlot);
                fs.mkdirSync(path.dirname(tempCameraPath), { recursive: true });
                fs.cpSync(oldCameraPath, tempCameraPath, { recursive: true });
              }
              
              // Move motion files
              const oldMotionPath = path.join(modRoot, 'fighter', fighterCodename, 'motion', oldSlot);
              if (fs.existsSync(oldMotionPath)) {
                const tempMotionPath = path.join(tempDir, 'motion', oldSlot);
                fs.mkdirSync(path.dirname(tempMotionPath), { recursive: true });
                fs.cpSync(oldMotionPath, tempMotionPath, { recursive: true });
              }
              
              // Move sound files
              const soundBankPath = path.join(modRoot, 'sound', 'bank', 'fighter', fighterCodename, oldSlot);
              if (fs.existsSync(soundBankPath)) {
                const tempSoundPath = path.join(tempDir, 'sound', oldSlot);
                fs.mkdirSync(path.dirname(tempSoundPath), { recursive: true });
                fs.cpSync(soundBankPath, tempSoundPath, { recursive: true });
              }
              
              // Move effect file
              const oldEffectPath = path.join(modRoot, 'effect', 'fighter', fighterCodename, `ef_${fighterCodename}_${oldSlot}.eff`);
              if (fs.existsSync(oldEffectPath)) {
                const tempEffectPath = path.join(tempDir, 'effect', `ef_${fighterCodename}_${oldSlot}.eff`);
                fs.mkdirSync(path.dirname(tempEffectPath), { recursive: true });
                fs.copyFileSync(oldEffectPath, tempEffectPath);
              }
              
              // Move UI files
              const oldAltNum = parseInt(oldSlot.substring(1)) - baseSlotNum;
              for (let charaNum = 0; charaNum < 20; charaNum++) {
                const charaFolder = `chara_${charaNum}`;
                const charaPath = path.join(modRoot, 'ui', 'replace', 'chara', charaFolder);
                if (fs.existsSync(charaPath)) {
                  const files = fs.readdirSync(charaPath);
                  for (const file of files) {
                    const altMatch = file.match(/_(\d{2})\.bntx$/);
                    if (altMatch && parseInt(altMatch[1]) === oldAltNum) {
                      const tempUIPath = path.join(tempDir, 'ui', charaFolder, file);
                      fs.mkdirSync(path.dirname(tempUIPath), { recursive: true });
                      fs.copyFileSync(path.join(charaPath, file), tempUIPath);
                    }
                  }
                }
              }
            }
            
            // Delete original files
            for (const oldSlot of slotsToShift) {
              // Fighter model/body
              const oldFighterPath = path.join(modRoot, 'fighter', fighterCodename, 'model', 'body', oldSlot);
              if (fs.existsSync(oldFighterPath)) {
                fs.rmSync(oldFighterPath, { recursive: true, force: true });
              }
              
              // Model subfolders
              const modelPath = path.join(modRoot, 'fighter', fighterCodename, 'model');
              if (fs.existsSync(modelPath)) {
                const modelSubfolders = fs.readdirSync(modelPath, { withFileTypes: true })
                  .filter(d => d.isDirectory() && d.name !== 'body').map(d => d.name);
                for (const subfolder of modelSubfolders) {
                  const oldSubPath = path.join(modelPath, subfolder, oldSlot);
                  if (fs.existsSync(oldSubPath)) {
                    fs.rmSync(oldSubPath, { recursive: true, force: true });
                  }
                }
              }
              
              // Camera
              const oldCameraPath = path.join(modRoot, 'camera', 'fighter', fighterCodename, oldSlot);
              if (fs.existsSync(oldCameraPath)) {
                fs.rmSync(oldCameraPath, { recursive: true, force: true });
              }
              
              // Motion
              const oldMotionPath = path.join(modRoot, 'fighter', fighterCodename, 'motion', oldSlot);
              if (fs.existsSync(oldMotionPath)) {
                fs.rmSync(oldMotionPath, { recursive: true, force: true });
              }
              
              // Sound
              const soundBankPath = path.join(modRoot, 'sound', 'bank', 'fighter', fighterCodename, oldSlot);
              if (fs.existsSync(soundBankPath)) {
                fs.rmSync(soundBankPath, { recursive: true, force: true });
              }
              
              // Effect
              const oldEffectPath = path.join(modRoot, 'effect', 'fighter', fighterCodename, `ef_${fighterCodename}_${oldSlot}.eff`);
              if (fs.existsSync(oldEffectPath)) {
                fs.unlinkSync(oldEffectPath);
              }
              
              // UI files
              const oldAltNum = parseInt(oldSlot.substring(1)) - baseSlotNum;
              for (let charaNum = 0; charaNum < 20; charaNum++) {
                const charaFolder = `chara_${charaNum}`;
                const charaPath = path.join(modRoot, 'ui', 'replace', 'chara', charaFolder);
                if (fs.existsSync(charaPath)) {
                  const files = fs.readdirSync(charaPath);
                  for (const file of files) {
                    const altMatch = file.match(/_(\d{2})\.bntx$/);
                    if (altMatch && parseInt(altMatch[1]) === oldAltNum) {
                      fs.unlinkSync(path.join(charaPath, file));
                    }
                  }
                }
              }
            }
            
            // Move files from temp to their new positions
            for (const oldSlot of slotsToShift) {
              const newSlot = shiftMapping[oldSlot];
              
              // Move fighter model/body files
              const tempFighterPath = path.join(tempDir, 'fighter', 'model', 'body', oldSlot);
              if (fs.existsSync(tempFighterPath)) {
                const newFighterPath = path.join(modRoot, 'fighter', fighterCodename, 'model', 'body', newSlot);
                fs.mkdirSync(path.dirname(newFighterPath), { recursive: true });
                fs.cpSync(tempFighterPath, newFighterPath, { recursive: true });
                event.sender.send('debug-message', `[DEBUG] Moved fighter/body: ${oldSlot} -> ${newSlot}`);
              }
              
              // Move model subfolders
              const modelPath = path.join(modRoot, 'fighter', fighterCodename, 'model');
              if (fs.existsSync(modelPath)) {
                const modelSubfolders = fs.readdirSync(modelPath, { withFileTypes: true })
                  .filter(d => d.isDirectory() && d.name !== 'body').map(d => d.name);
                for (const subfolder of modelSubfolders) {
                  const tempSubPath = path.join(tempDir, 'fighter', 'model', subfolder, oldSlot);
                  if (fs.existsSync(tempSubPath)) {
                    const newSubPath = path.join(modelPath, subfolder, newSlot);
                    fs.mkdirSync(path.dirname(newSubPath), { recursive: true });
                    fs.cpSync(tempSubPath, newSubPath, { recursive: true });
                    event.sender.send('debug-message', `[DEBUG] Moved model/${subfolder}: ${oldSlot} -> ${newSlot}`);
                  }
                }
              }
              
              // Move camera files
              const tempCameraPath = path.join(tempDir, 'camera', oldSlot);
              if (fs.existsSync(tempCameraPath)) {
                const newCameraPath = path.join(modRoot, 'camera', 'fighter', fighterCodename, newSlot);
                fs.mkdirSync(path.dirname(newCameraPath), { recursive: true });
                fs.cpSync(tempCameraPath, newCameraPath, { recursive: true });
                event.sender.send('debug-message', `[DEBUG] Moved camera: ${oldSlot} -> ${newSlot}`);
              }
              
              // Move motion files
              const tempMotionPath = path.join(tempDir, 'motion', oldSlot);
              if (fs.existsSync(tempMotionPath)) {
                const newMotionPath = path.join(modRoot, 'fighter', fighterCodename, 'motion', newSlot);
                fs.mkdirSync(path.dirname(newMotionPath), { recursive: true });
                fs.cpSync(tempMotionPath, newMotionPath, { recursive: true });
                event.sender.send('debug-message', `[DEBUG] Moved motion: ${oldSlot} -> ${newSlot}`);
              }
              
              // Move sound files
              const tempSoundPath = path.join(tempDir, 'sound', oldSlot);
              if (fs.existsSync(tempSoundPath)) {
                const newSoundPath = path.join(modRoot, 'sound', 'bank', 'fighter', fighterCodename, newSlot);
                fs.mkdirSync(path.dirname(newSoundPath), { recursive: true });
                fs.cpSync(tempSoundPath, newSoundPath, { recursive: true });
                event.sender.send('debug-message', `[DEBUG] Moved sound: ${oldSlot} -> ${newSlot}`);
              }
              
              // Move effect file
              const tempEffectPath = path.join(tempDir, 'effect', `ef_${fighterCodename}_${oldSlot}.eff`);
              if (fs.existsSync(tempEffectPath)) {
                const newEffectPath = path.join(modRoot, 'effect', 'fighter', fighterCodename, `ef_${fighterCodename}_${newSlot}.eff`);
                fs.mkdirSync(path.dirname(newEffectPath), { recursive: true });
                fs.copyFileSync(tempEffectPath, newEffectPath);
                event.sender.send('debug-message', `[DEBUG] Moved effect: ${oldSlot}.eff -> ${newSlot}.eff`);
              }
              
              // Move UI files
              const oldAltNum = parseInt(oldSlot.substring(1)) - baseSlotNum;
              const newAltNum = parseInt(newSlot.substring(1)) - baseSlotNum;
              for (let charaNum = 0; charaNum < 20; charaNum++) {
                const charaFolder = `chara_${charaNum}`;
                const tempUIPath = path.join(tempDir, 'ui', charaFolder);
                if (fs.existsSync(tempUIPath)) {
                  const files = fs.readdirSync(tempUIPath);
                  for (const file of files) {
                    const altMatch = file.match(/^(.+)_(\d{2})\.bntx$/);
                    if (altMatch && parseInt(altMatch[2]) === oldAltNum) {
                      const newFileName = `${altMatch[1]}_${newAltNum.toString().padStart(2, '0')}.bntx`;
                      const targetCharaPath = path.join(modRoot, 'ui', 'replace', 'chara', charaFolder);
                      fs.mkdirSync(targetCharaPath, { recursive: true });
                      fs.copyFileSync(path.join(tempUIPath, file), path.join(targetCharaPath, newFileName));
                      event.sender.send('debug-message', `[DEBUG] Moved UI: ${file} -> ${newFileName}`);
                    }
                  }
                }
              }
            }
            
          } finally {
            // Clean up temp directory
            if (fs.existsSync(tempDir)) {
              fs.rmSync(tempDir, { recursive: true, force: true });
            }
          }
          
          // Apply config shifts
          applySlotReordering(configData, shiftMapping, event);
          
          // Write config (save after each shift)
          writeJsonPreserve(configPath, configData);
          event.sender.send('debug-message', `[DEBUG] Completed shifting for this restore`);
        } else {
          event.sender.send('debug-message', `[DEBUG] No existing slots need to shift for this restore`);
        }
        
        // Step 4: NOW restore THIS disabled slot into the gap
        try {
          // Extract original slot and folder info
          const match = disabledId.match(/disabled_(c\d+)_(\d+)/);
          if (!match) {
            event.sender.send('debug-message', `[DEBUG] ERROR: Invalid disabled ID format: ${disabledId}`);
            continue;
          }
          
          const originalSlot = match[1];
          const timestamp = match[2];
          const folderName = `${originalSlot}_${timestamp}`;
          const disabledFolderPath = path.join(modRoot, '.disabled', folderName);
          
          event.sender.send('debug-message', `[DEBUG] Restoring ${originalSlot} from ${folderName} to ${targetSlot}`);
          
          // Restore files
          await restoreSlotFiles(modRoot, disabledFolderPath, originalSlot, targetSlot, fighterCodename, event, baseSlotNum);
          
          // Restore config
          await restoreSlotConfig(originalSlot, disabledFolderPath, targetSlot, configData, event);
          
          // Run binary comparison in BOTH directions
          const currentEnabledSlotsForComparison = currentEnabledSlots.filter(s => s !== targetSlot);
          if (currentEnabledSlotsForComparison.length > 0) {
            // 1. Compare restored slot against other slots (to share FROM restored slot)
            const { sharesToAdd, filesToDelete } = await detectCrossAltSharing(
            modRoot,
              targetSlot,
              currentEnabledSlotsForComparison,
            fighterCodename,
              event
            );
            
            if (Object.keys(sharesToAdd).length > 0) {
              if (!configData['share-to-added']) configData['share-to-added'] = {};
              for (const [source, targets] of Object.entries(sharesToAdd)) {
                if (!configData['share-to-added'][source]) configData['share-to-added'][source] = [];
                for (const target of targets) {
                  if (!configData['share-to-added'][source].includes(target)) {
                    configData['share-to-added'][source].push(target);
                  }
                }
              }
            }
            
            for (const filePath of filesToDelete) {
              try {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
              } catch (delError) {}
            }
            
            // 2. REVERSE: Compare other slots against restored slot (to share TO restored slot)
            // This is critical for sounds that are already shared from c120 to other slots
            for (const otherSlot of currentEnabledSlotsForComparison) {
              event.sender.send('debug-message', `[DEBUG] Reverse comparison: Checking if ${otherSlot} should share to ${targetSlot}`);
              const { sharesToAdd: reverseShares, filesToDelete: reverseDeletes } = await detectCrossAltSharing(
                modRoot,
                otherSlot,
                [targetSlot],  // Only compare against the restored slot
                fighterCodename,
                event
              );
              
              if (Object.keys(reverseShares).length > 0) {
                if (!configData['share-to-added']) configData['share-to-added'] = {};
                for (const [source, targets] of Object.entries(reverseShares)) {
                  if (!configData['share-to-added'][source]) configData['share-to-added'][source] = [];
                  const targetArray = Array.isArray(targets) ? targets : [targets];
                  for (const target of targetArray) {
                    if (!configData['share-to-added'][source].includes(target)) {
                      configData['share-to-added'][source].push(target);
                      event.sender.send('debug-message', `[DEBUG] Added reverse share: ${source} -> ${target}`);
                    }
                  }
                }
              }
              
              for (const filePath of reverseDeletes) {
                try {
                  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                } catch (delError) {}
              }
            }
          }
          
          // Clean up disabled folder
          fs.rmSync(disabledFolderPath, { recursive: true, force: true });
          
          results.restored.push({ originalSlot, targetSlot });
          restoredTargetSlots.add(targetSlot);
          event.sender.send('debug-message', `[DEBUG] Successfully restored ${originalSlot} to ${targetSlot}`);
          
          // Update currentEnabledSlots to include the newly restored slot
          // Map shifted slots to their new positions
          const updatedSlots = [];
          for (const slot of currentEnabledSlots) {
            updatedSlots.push(shiftMapping[slot] || slot);
          }
          // Add the restored slot at its target position
          updatedSlots.push(targetSlot);
          // Sort by slot number
          currentEnabledSlots = updatedSlots.sort((a, b) => {
            return parseInt(a.substring(1)) - parseInt(b.substring(1));
          });
          event.sender.send('debug-message', `[DEBUG] Updated enabled slots after restore: ${JSON.stringify(currentEnabledSlots)}`);
          
        } catch (restoreError) {
          event.sender.send('debug-message', `[DEBUG] Error restoring ${disabledId}: ${restoreError.message}`);
          results.errors.push(`Failed to restore ${disabledId}: ${restoreError.message}`);
        }
        
        // End of this restore iteration - move to next disabled slot
        }
        
        // Step 5: Write final config
        writeJsonPreserve(configPath, configData);
        event.sender.send('debug-message', `[DEBUG] ===== RESTORATION PHASE COMPLETE =====`);
        
      } catch (prePhaseErr) {
        event.sender.send('debug-message', `[DEBUG] Error in restoration phase: ${prePhaseErr.message}`);
        results.errors.push(`Restoration phase failed: ${prePhaseErr.message}`);
      }
    }

    // 1. Disable slots that are in disabledSlots but not already disabled
    const disabledBackupData = {}; // Store backup data for later processing
    const disabledFolderPaths = {}; // Store disabled folder paths for later config updates
    
    // Create a Set of slots to process (exclude pre-disabled ones and already-disabled IDs)
    // Filter out disabled IDs like 'disabled_c118_...' since they're already disabled
    const slotsToProcess = new Set(disabledSlots.filter(s => !s.startsWith('disabled_')));
    if (preDisabledSlots) {
      for (const preDisabledSlot of preDisabledSlots) {
        slotsToProcess.delete(preDisabledSlot);
      }
    }
    
    console.log(`[DEBUG] Original disabledSlots: ${JSON.stringify(disabledSlots)}`);
    console.log(`[DEBUG] Pre-disabled slots: ${JSON.stringify(Array.from(preDisabledSlots || []))}`);
    console.log(`[DEBUG] Slots to process: ${JSON.stringify(Array.from(slotsToProcess))}`);
    event.sender.send('debug-message', `[DEBUG] Original disabledSlots: ${JSON.stringify(disabledSlots)}`);
    event.sender.send('debug-message', `[DEBUG] Pre-disabled slots: ${JSON.stringify(Array.from(preDisabledSlots || []))}`);
    event.sender.send('debug-message', `[DEBUG] Slots to process: ${JSON.stringify(Array.from(slotsToProcess))}`);
    
    for (const slot of slotsToProcess) {
      console.log(`[DEBUG] Processing slot for disable: ${slot}`);
      event.sender.send('debug-message', `[DEBUG] Processing slot for disable: ${slot}`);
      
      try {
        console.log(`[DEBUG] Disabling slot: ${slot}`);
        
        // STEP 1: Materialize all shared files BEFORE anything else
        // This ensures the slot being disabled has all its files physically present
        // and targets that depended on this slot also get their files materialized
        materializeSharedFilesBeforeDisable(modRoot, slot, configData, event);
        
        // STEP 2: Create backup data for this slot (AFTER materialization so share entries are updated)
        const backupData = extractSlotConfig(slot, configData);
        disabledBackupData[slot] = backupData;
        
        // STEP 3: Remove slot entries from main config
        console.log(`[DEBUG] Removing config entries for slot: ${slot}`);
        event.sender.send('debug-message', `[DEBUG] Removing config entries for slot: ${slot}`);
        removeSlotFromConfig(slot, configData);
        
        // STEP 4: Move files to disabled folder with timestamp
        const timestamp = Date.now();
        const disabledFolder = path.join(disabledDir, `${slot}_${timestamp}`);
        fs.mkdirSync(disabledFolder, { recursive: true });
        disabledFolderPaths[slot] = disabledFolder;
        
        // Calculate remaining active slots (all enabled slots minus the ones being disabled)
        const currentRemainingSlots = enabledSlots.filter(s => !slotsToProcess.has(s));
        
        // Move ALL slot files to disabled folder (including UI files)
        moveSlotFiles(modRoot, slot, disabledFolder, baseSlotNum, fighterCodename, configData, currentRemainingSlots, event);
        
        // STEP 5: Save backup config to disabled folder
        const backupConfigPath = path.join(disabledFolder, `${slot}_config.json`);
        try {
          writeJsonPreserve(backupConfigPath, backupData);
          console.log(`[DEBUG] Saved backup config for ${slot} to ${backupConfigPath}`);
          event.sender.send('debug-message', `[DEBUG] Saved backup config for ${slot} to ${backupConfigPath}`);
        } catch (error) {
          console.log(`[DEBUG] Error saving backup config for ${slot}: ${error.message}`);
          event.sender.send('debug-message', `[DEBUG] Error saving backup config for ${slot}: ${error.message}`);
        }
        
        results.disabled.push(slot);
        console.log(`[DEBUG] Successfully disabled slot: ${slot}`);
      } catch (error) {
        console.log(`[DEBUG] Error disabling slot ${slot}: ${error.message}`);
        results.errors.push(`Failed to disable ${slot}: ${error.message}`);
      }
    }

    // 2. Apply cascading renumbering after disabling slots (skip if explicit reordering provided)
    const hasExplicitReorder = Object.keys(slotMapping || {}).length > 0;
    if (slotsToProcess.size > 0 && !hasExplicitReorder) {
      try {
        console.log(`[DEBUG] Applying cascading renumbering after disabling slots`);
        event.sender.send('debug-message', `[DEBUG] Applying cascading renumbering after disabling slots`);
        
        // Get all remaining enabled slots and sort them
        const remainingSlots = enabledSlots.filter(slot => !slotsToProcess.has(slot));
        remainingSlots.sort((a, b) => {
          const aNum = parseInt(a.substring(1));
          const bNum = parseInt(b.substring(1));
          return aNum - bNum;
        });
        
        // Create cascading shifts for renumbering
        const cascadingShifts = {};
        let currentSlotNum = parseInt(remainingSlots[0].substring(1)); // Start from the first remaining slot
        
        for (let i = 0; i < remainingSlots.length; i++) {
          const oldSlot = remainingSlots[i];
          const oldSlotNum = parseInt(oldSlot.substring(1));
          const newSlot = `c${currentSlotNum + i}`;
          
          if (oldSlot !== newSlot) {
            cascadingShifts[oldSlot] = newSlot;
            console.log(`[DEBUG] Cascading shift: ${oldSlot} -> ${newSlot}`);
            event.sender.send('debug-message', `[DEBUG] Cascading shift: ${oldSlot} -> ${newSlot}`);
          }
        }
        
        // Apply the cascading shifts to files and config
        if (Object.keys(cascadingShifts).length > 0) {
          // Apply file system changes using remainingSlots order to close gaps
          await reorderSlotFiles(modRoot, remainingSlots, event, baseSlotNum, fighterCodename);
          
          // Apply config changes
        console.log(`[DEBUG] Applying cascading shifts to config: ${JSON.stringify(cascadingShifts)}`);
        event.sender.send('debug-message', `[DEBUG] Applying cascading shifts to config: ${JSON.stringify(cascadingShifts)}`);
          applySlotReordering(configData, cascadingShifts, event);
          
          // Update disabled backup data to reflect the new slot numbers
          for (const [disabledSlot, backupData] of Object.entries(disabledBackupData)) {
            // Apply the same cascading shifts to the backup data
            applySlotReordering(backupData, cascadingShifts, event);
            
            // IMPORTANT: Update share-to-added TARGETS to track where slots moved to
            // Sources stay as-is (disabled_c118), but targets need to be updated (c119 -> c105)
            if (backupData['share-to-added']) {
              const updatedShareToAdded = {};
              for (const [source, targets] of Object.entries(backupData['share-to-added'])) {
                const targetList = Array.isArray(targets) ? targets : [targets];
                const updatedTargets = targetList.map(target => {
                  let updatedTarget = target;
                  
                  // Use temp placeholders to avoid cascading replacements
                  // Step 1: Replace all old slots with temp markers
                  for (const [oldSlot, newSlot] of Object.entries(cascadingShifts)) {
                    const slotPattern = new RegExp(`/${oldSlot}/`, 'g');
                    updatedTarget = updatedTarget.replace(slotPattern, `/__TEMP_${newSlot}_TEMP__/`);
                  }
                  
                  // Step 2: Replace temp markers with final values
                  for (const [oldSlot, newSlot] of Object.entries(cascadingShifts)) {
                    const tempPattern = new RegExp(`/__TEMP_${newSlot}_TEMP__/`, 'g');
                    updatedTarget = updatedTarget.replace(tempPattern, `/${newSlot}/`);
                  }
                  
                  return updatedTarget;
                });
                // Always keep as array, even for single targets
                updatedShareToAdded[source] = updatedTargets;
              }
              backupData['share-to-added'] = updatedShareToAdded;
            }
            
            // Update the existing backup config file (don't create a new one)
            const disabledFolder = disabledFolderPaths[disabledSlot];
            const backupConfigPath = path.join(disabledFolder, `${disabledSlot}_config.json`);
            writeJsonPreserve(backupConfigPath, backupData);
            console.log(`[DEBUG] Updated backup config for ${disabledSlot} with cascading shifts applied (share-to-added targets updated)`);
            event.sender.send('debug-message', `[DEBUG] Updated backup config for ${disabledSlot} with cascading shifts applied (share-to-added targets updated)`);
          }
          
          // Also update ALL existing disabled backup configs on disk with cascading shifts
          try {
            // The keys in disabledBackupData are already slot numbers like 'c118', not 'disabled_c118_...'
            const excludeSlotNumbers = Object.keys(disabledBackupData); // e.g., ['c118']
            event.sender.send('debug-message', `[DEBUG] Excluding slots from updateAllDisabledBackupConfigs (cascading): ${JSON.stringify(excludeSlotNumbers)}`);
            await updateAllDisabledBackupConfigs(modRoot, cascadingShifts, event, excludeSlotNumbers);
          } catch (e) {
            event.sender.send('debug-message', `[DEBUG] Error updating on-disk disabled configs after cascading shifts: ${e.message}`);
          }

          results.reordered = Object.keys(cascadingShifts);
          console.log(`[DEBUG] Successfully applied cascading renumbering`);
          event.sender.send('debug-message', `[DEBUG] Successfully applied cascading renumbering`);
        }
      } catch (error) {
        console.log(`[DEBUG] Error applying cascading renumbering: ${error.message}`);
        event.sender.send('debug-message', `[DEBUG] Error applying cascading renumbering: ${error.message}`);
        results.errors.push(`Failed to apply cascading renumbering: ${error.message}`);
      }
    }

    // 3. Disabled slot restoration is now handled in reorderSlotFiles function
    // (Removed old restoration logic that was deleting disabled folders prematurely)

    // 4. Apply slot reordering (disabled slots will be handled during reordering)
    // IMPORTANT: If we just completed the restoration phase, skip this entire section
    // because the restoration phase already handled ALL slot shifts AND restoration
    
    // Declare filteredSlotMapping before the if/else so it's accessible in section 5
    let filteredSlotMapping = {};
    
    if (disabledIdsToRestore.length > 0) {
      event.sender.send('debug-message', `[DEBUG] Skipping section 4 reordering - restoration phase already handled all shifts`);
      // Skip to the config restoration section
      } else {
      // Filter out slots that were CREATED during the shift AND would overwrite imports
      // But KEEP mappings that shift existing data around
      const shiftTargetSlots = new Set(Object.values(slotMapping));
      
      for (const [key, value] of Object.entries(slotMapping)) {
        // Skip if the VALUE (target) is an imported slot - don't overwrite the import
        if (importedSlotIds.has(value)) {
          event.sender.send('debug-message', `[DEBUG] Skipping mapping ${key} -> ${value} because ${value} is an import target`);
          continue;
        }
        
        // Skip if the VALUE (target) is a restored slot - it's already in its final position
        if (restoredTargetSlots.has(value)) {
          event.sender.send('debug-message', `[DEBUG] Skipping mapping ${key} -> ${value} because ${value} was restored and is in final position`);
          continue;
        }
        // Skip if the KEY is a restored slot trying to be moved again
        if (restoredTargetSlots.has(key)) {
          event.sender.send('debug-message', `[DEBUG] Skipping restored slot in reordering: ${key}`);
          continue;
        }
        
        // CRITICAL: Skip if this slot was CREATED during the shift for imports
        // Example: If c127->c128 during import pre-shift, then c128 is new and shouldn't appear as a source
        // Check: if we're doing imports AND this slot is a target AND it's moving to a lower slot number, skip it
        if (importedSlotIds.size > 0 && shiftTargetSlots.has(key)) {
          const keyNum = parseInt(key.substring(1));
          const valueNum = parseInt(value.substring(1));
          if (keyNum > valueNum) {
            event.sender.send('debug-message', `[DEBUG] Skipping shift-created slot: ${key}->${value} (created during import shift, would overwrite import)`);
            continue;
          }
        }
        
        filteredSlotMapping[key] = value;
    }
    
    // If we did imports, the pre-shift already handled all the slot movements
    // Only apply reordering if there were NO imports (just manual dragging)
    const shouldApplyReordering = importedSlotIds.size === 0 && Object.keys(filteredSlotMapping).length > 0;
    
    if (shouldApplyReordering) {
      try {
        event.sender.send('debug-message', `[DEBUG] Applying slot reordering: ${JSON.stringify(filteredSlotMapping)}`);
        event.sender.send('debug-message', `[DEBUG] Slot mapping length: ${Object.keys(filteredSlotMapping).length}`);
        
        // Apply file system reordering using the current enabledSlots order (safer staged process)
        try {
          await reorderSlotFiles(modRoot, enabledSlots, event, baseSlotNum, fighterCodename);
          event.sender.send('debug-message', `[DEBUG] reorderSlotFiles completed successfully`);
        } catch (reorderError) {
          event.sender.send('debug-message', `[DEBUG] Error in reorderSlotFiles: ${reorderError.message}`);
          throw reorderError;
        }
        
        // Also update disabled backup configs to reflect this explicit reordering mapping
        try {
          for (const [disabledSlot, backupData] of Object.entries(disabledBackupData)) {
            // IMPORTANT: Preserve share-to-added before applying slot reordering
            // so we don't apply the mapping twice (once in applySlotReordering, once manually)
            const originalShareToAdded = backupData['share-to-added'] ? JSON.parse(JSON.stringify(backupData['share-to-added'])) : null;
            
            applySlotReordering(backupData, filteredSlotMapping, event);
            
            // IMPORTANT: Update share-to-added TARGETS to track where slots moved to
            // Sources stay as-is (disabled_c118), but targets need to be updated (c119 -> c105)
            // Use the ORIGINAL share-to-added (before applySlotReordering modified it)
            if (originalShareToAdded) {
              const updatedShareToAdded = {};
              for (const [source, targets] of Object.entries(originalShareToAdded)) {
                const targetList = Array.isArray(targets) ? targets : [targets];
                const updatedTargets = targetList.map(target => {
                  let updatedTarget = target;
                  
                  // Use temp placeholders to avoid cascading replacements
                  // Step 1: Replace all old slots with temp markers
                  for (const [oldSlot, newSlot] of Object.entries(filteredSlotMapping)) {
                    const slotPattern = new RegExp(`/${oldSlot}/`, 'g');
                    updatedTarget = updatedTarget.replace(slotPattern, `/__TEMP_${newSlot}_TEMP__/`);
                  }
                  
                  // Step 2: Replace temp markers with final values
                  for (const [oldSlot, newSlot] of Object.entries(filteredSlotMapping)) {
                    const tempPattern = new RegExp(`/__TEMP_${newSlot}_TEMP__/`, 'g');
                    updatedTarget = updatedTarget.replace(tempPattern, `/${newSlot}/`);
                  }
                  
                  return updatedTarget;
                });
                // Always keep as array, even for single targets
                updatedShareToAdded[source] = updatedTargets;
              }
              backupData['share-to-added'] = updatedShareToAdded;
            }
            
            const disabledFolder = disabledFolderPaths[disabledSlot];
            const backupConfigPath = path.join(disabledFolder, `${disabledSlot}_config.json`);
            writeJsonPreserve(backupConfigPath, backupData);
            event.sender.send('debug-message', `[DEBUG] Updated backup config for ${disabledSlot} with explicit reordering mapping (share-to-added targets updated)`);
          }
          // And update ALL existing disabled backups on disk (skip pre-disabled slots to avoid conflicts)
          // The keys in disabledBackupData are already slot numbers like 'c118', not 'disabled_c118_...'
          const excludeSlotNumbers = Object.keys(disabledBackupData); // e.g., ['c118']
          const slotsToExclude = preDisabledSlots ? Array.from(preDisabledSlots).concat(excludeSlotNumbers) : excludeSlotNumbers;
          event.sender.send('debug-message', `[DEBUG] Excluding slots from updateAllDisabledBackupConfigs: ${JSON.stringify(slotsToExclude)}`);
          await updateAllDisabledBackupConfigs(modRoot, slotMapping, event, slotsToExclude);
        } catch (e) {
          event.sender.send('debug-message', `[DEBUG] Error updating disabled backup configs after reordering: ${e.message}`);
        }

        results.reordered = Object.keys(slotMapping);
        event.sender.send('debug-message', `[DEBUG] Reordering completed successfully`);
        
      } catch (error) {
        event.sender.send('debug-message', `[DEBUG] Error during reordering: ${error.message}`);
        results.errors.push(`Reordering failed: ${error.message}`);
      }
    } else {
      event.sender.send('debug-message', `[DEBUG] No slot mapping provided, skipping reordering`);
    }
    } // End of else block for "if (disabledIdsToRestore.length > 0)"

    // 5. Handle config restoration for disabled slots
    const disabledSlotsToRestore = enabledSlots.filter(slot => slot.startsWith('disabled_'));
    const hasSlotShifts = Object.keys(slotMapping).length > 0;
    const hasDisabledSlots = disabledSlotsToRestore.length > 0;
    
    event.sender.send('debug-message', `[DEBUG] Checking config restoration conditions:`);
    event.sender.send('debug-message', `[DEBUG] slotMapping keys: ${JSON.stringify(Object.keys(slotMapping))}`);
    event.sender.send('debug-message', `[DEBUG] hasSlotShifts: ${hasSlotShifts}`);
    event.sender.send('debug-message', `[DEBUG] disabledSlotsToRestore: ${JSON.stringify(disabledSlotsToRestore)}`);
    event.sender.send('debug-message', `[DEBUG] hasDisabledSlots: ${hasDisabledSlots}`);
    event.sender.send('debug-message', `[DEBUG] Will run config restoration: ${hasSlotShifts || hasDisabledSlots}`);
    
    if (hasSlotShifts || hasDisabledSlots) {
      try {
        event.sender.send('debug-message', `[DEBUG] Starting config restoration...`);
        event.sender.send('debug-message', `[DEBUG] Has slot shifts: ${hasSlotShifts}, Has disabled slots: ${hasDisabledSlots}`);
        
        // IMPORTANT: Apply config shifts FIRST, then restore disabled configs
        // This ensures the main config is shifted (c105->c106, etc.) before
        // we restore the disabled slot into the now-empty target slot
        
        // First, apply config shifts to main config if there are explicit slot mappings
        // IMPORTANT: Skip config shifts if imports happened, because the pre-shift phase
        // already applied config shifts before importing!
        if (hasSlotShifts && Object.keys(filteredSlotMapping).length > 0 && importedSlotIds.size === 0) {
          event.sender.send('debug-message', `[DEBUG] Applying config shifts to main config...`);
          await applyConfigShifts(configData, filteredSlotMapping, baseSlotNum, event);
        } else if (importedSlotIds.size > 0) {
          event.sender.send('debug-message', `[DEBUG] Skipping config shifts - already applied during import pre-shift phase`);
        }
        
        // Then, restore disabled slot configs (after shifts are applied)
        if (hasDisabledSlots) {
          event.sender.send('debug-message', `[DEBUG] Restoring disabled slot configs...`);
          // Use the new simplified restore approach
          const disabledDir = path.join(modRoot, '.disabled');
          for (const disabledSlotId of disabledSlotsToRestore) {
            const match = disabledSlotId.match(/disabled_(c\d+)_(\d+)/);
            if (!match) continue;
            
            const originalSlot = match[1];
            const timestamp = match[2];
            // Folder name is c121_timestamp (without "disabled_" prefix)
            const folderName = `${originalSlot}_${timestamp}`;
            const disabledFolderPath = path.join(disabledDir, folderName);
            
            // Find target slot from enabled slots
            const visualToActual = {};
            enabledSlots.forEach((actualSlot, index) => {
              const visualSlot = `c${baseSlotNum + index}`;
              visualToActual[visualSlot] = actualSlot;
            });
            
            let targetSlot = null;
            for (const [visual, actual] of Object.entries(visualToActual)) {
              if (actual === disabledSlotId) {
                targetSlot = visual;
                break;
              }
            }
            
            if (!targetSlot) continue;
            
            // Restore config from disabled folder
            await restoreSlotConfig(originalSlot, disabledFolderPath, targetSlot, configData, event);
          }
        }
        
        // Final cleanup: Remove sound files that are now targets of share-to-added entries
        // This must run AFTER file reordering creates the cascaded files
        if (configData['share-to-added']) {
          event.sender.send('debug-message', `[DEBUG] Cleaning up redundant sound files from share-to-added targets...`);
          const soundDir = path.join(modRoot, 'sound', 'bank', 'fighter_voice');
          if (fs.existsSync(soundDir)) {
            for (const [source, targets] of Object.entries(configData['share-to-added'])) {
              if (!source.includes('sound/bank/fighter_voice/')) continue; // Only handle sound files
              if (!Array.isArray(targets)) continue;
              
              for (const target of targets) {
                if (typeof target !== 'string' || !target.includes('sound/bank/fighter_voice/')) continue;
                const targetFile = path.join(modRoot, ...target.replace(/\\/g, '/').split('/'));
                
                if (fs.existsSync(targetFile)) {
                  try {
                    fs.unlinkSync(targetFile);
                    event.sender.send('debug-message', `[DEBUG] Removed redundant sound file (shared from ${source}): ${targetFile}`);
                  } catch (err) {
                    event.sender.send('debug-message', `[DEBUG] Failed to remove sound file ${targetFile}: ${err.message}`);
                  }
                }
              }
            }
          }
        }
        
        event.sender.send('debug-message', `[DEBUG] Config restoration completed successfully`);
      } catch (error) {
        event.sender.send('debug-message', `[DEBUG] Error during config restoration: ${error.message}`);
        results.errors.push(`Config restoration failed: ${error.message}`);
      }
    } else {
      event.sender.send('debug-message', `[DEBUG] No config restoration needed - no slot shifts or disabled slots`);
    }

    // 6. Clean up disabled files AFTER config restoration
    if (hasDisabledSlots) {
      try {
        event.sender.send('debug-message', `[DEBUG] Cleaning up disabled files after config restoration...`);
        
        // Only clean up disabled folders that were processed during this operation
        // Track which disabled slots were restored (and should be cleaned up)
        const disabledFoldersToCleanup = new Set();
        
        // Add disabled slots that were restored to the cleanup list
        for (const disabledSlot of disabledSlotsToRestore) {
          // Keep the full folder name (with 'disabled_' prefix)
          disabledFoldersToCleanup.add(disabledSlot);
        }
        
        event.sender.send('debug-message', `[DEBUG] Disabled folders to cleanup: ${JSON.stringify(Array.from(disabledFoldersToCleanup))}`);
        
        // Find and clean up only the processed disabled folders
        const disabledDir = path.join(modRoot, '.disabled');
        if (fs.existsSync(disabledDir)) {
          const allDisabledFolders = fs.readdirSync(disabledDir, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && entry.name.startsWith('disabled_'))
            .map(entry => entry.name);
          
          for (const folderName of allDisabledFolders) {
            if (disabledFoldersToCleanup.has(folderName)) {
              const disabledFolder = path.join(disabledDir, folderName);
              if (fs.existsSync(disabledFolder)) {
                fs.rmSync(disabledFolder, { recursive: true, force: true });
                event.sender.send('debug-message', `[DEBUG] Cleaned up disabled folder: ${disabledFolder}`);
              }
            } else {
              event.sender.send('debug-message', `[DEBUG] Preserving disabled folder: ${folderName} (not processed in this operation)`);
            }
          }
        }
        
        event.sender.send('debug-message', `[DEBUG] Disabled file cleanup completed`);
      } catch (error) {
        event.sender.send('debug-message', `[DEBUG] Error during disabled file cleanup: ${error.message}`);
        results.errors.push(`Disabled file cleanup failed: ${error.message}`);
      }
    }

    // 6. Remove share-to-added entries where disabled slots are sources
    if (slotsToProcess.size > 0 && configData['share-to-added']) {
      event.sender.send('debug-message', `[DEBUG] Cleaning up share-to-added entries for disabled slots...`);
      for (const disabledSlot of slotsToProcess) {
        const entriesToRemove = [];
        for (const [source, targets] of Object.entries(configData['share-to-added'])) {
          if (source.includes(`/${disabledSlot}/`)) {
            entriesToRemove.push(source);
            event.sender.send('debug-message', `[DEBUG] Removing share-to-added entry: ${source} -> ${Array.isArray(targets) ? targets.join(', ') : targets}`);
          }
        }
        for (const entry of entriesToRemove) {
          delete configData['share-to-added'][entry];
        }
      }
    }

    // 7. Verify and fix config against physical files
    try {
      event.sender.send('debug-message', `[DEBUG] Verifying config against physical files...`);
      await verifyAndFixConfig(modRoot, configData, baseSlotNum, event);
      event.sender.send('debug-message', `[DEBUG] Config verification completed`);
    } catch (verifyError) {
      event.sender.send('debug-message', `[DEBUG] Error during config verification: ${verifyError.message}`);
      results.errors.push(`Config verification failed: ${verifyError.message}`);
    }

    // 7. Save updated config.json
    writeJsonPreserve(configPath, configData);
    console.log(`[DEBUG] Saved updated config.json`);

    // 8. Clean up empty directories
    try {
      event.sender.send('debug-message', `[DEBUG] Cleaning up empty directories...`);
      const removedDirs = await removeEmptyDirectories(modRoot, event);
      if (removedDirs > 0) {
        event.sender.send('debug-message', `[DEBUG] Removed ${removedDirs} empty directories`);
      } else {
        event.sender.send('debug-message', `[DEBUG] No empty directories found`);
      }
    } catch (cleanupError) {
      event.sender.send('debug-message', `[DEBUG] Error during empty directory cleanup: ${cleanupError.message}`);
      // Don't fail the whole operation if cleanup fails
    }

    // Send final progress
    sendProgress(event, totalSteps, totalSteps, 'Operation complete!');

    return results;
  } catch (error) {
    console.log(`[DEBUG] Error applying slot changes: ${error.message}`);
    // Clear progress on error
    sendProgress(event, 0, 0, 'Operation failed');
    throw new Error(`Failed to apply slot changes: ${error.message}`);
  }
});

// Function to restore disabled slots
async function restoreDisabledSlots(modRoot, baseSlotNum, fighterCodename, enabledSlots, disabledSlots) {
  console.log(`[DEBUG] ====== RESTORE DISABLED SLOTS FUNCTION CALLED ======`);
  console.log(`[DEBUG] Restoring disabled slots`);
  console.log(`[DEBUG] Mod root: ${modRoot}`);
  console.log(`[DEBUG] Base slot num: ${baseSlotNum}`);
  console.log(`[DEBUG] Fighter codename: ${fighterCodename}`);
  console.log(`[DEBUG] Enabled slots: ${JSON.stringify(enabledSlots)}`);
  console.log(`[DEBUG] Disabled slots: ${JSON.stringify(disabledSlots)}`);
  
  // Send debug messages to renderer
  if (global.mainWindow && !global.mainWindow.isDestroyed()) {
    global.mainWindow.webContents.send('debug-message', `[DEBUG] ====== RESTORE DISABLED SLOTS FUNCTION CALLED ======`);
    global.mainWindow.webContents.send('debug-message', `[DEBUG] Restoring disabled slots`);
    global.mainWindow.webContents.send('debug-message', `[DEBUG] Mod root: ${modRoot}`);
    global.mainWindow.webContents.send('debug-message', `[DEBUG] Base slot num: ${baseSlotNum}`);
    global.mainWindow.webContents.send('debug-message', `[DEBUG] Fighter codename: ${fighterCodename}`);
    global.mainWindow.webContents.send('debug-message', `[DEBUG] Enabled slots: ${JSON.stringify(enabledSlots)}`);
    global.mainWindow.webContents.send('debug-message', `[DEBUG] Disabled slots: ${JSON.stringify(disabledSlots)}`);
  }
  
  const results = {
    restored: [],
    errors: []
  };
  
  try {
    // Check if disabled directory exists (use 'disabled' like Python)
    const disabledDir = path.join(modRoot, 'disabled');
    console.log(`[DEBUG] Checking for disabled directory: ${disabledDir}`);
    console.log(`[DEBUG] Disabled directory exists: ${fs.existsSync(disabledDir)}`);
    
    // Send debug messages to renderer
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      global.mainWindow.webContents.send('debug-message', `[DEBUG] Checking for disabled directory: ${disabledDir}`);
      global.mainWindow.webContents.send('debug-message', `[DEBUG] Disabled directory exists: ${fs.existsSync(disabledDir)}`);
    }
    
    if (!fs.existsSync(disabledDir)) {
      console.log(`[DEBUG] No disabled directory found`);
      if (global.mainWindow && !global.mainWindow.isDestroyed()) {
        global.mainWindow.webContents.send('debug-message', `[DEBUG] No disabled directory found`);
      }
      return results;
    }
    
    // Find all current slots to determine conflicts
    const allCurrentSlots = new Set();
    
    // Check fighter directory
    const fighterDir = path.join(modRoot, 'fighter', fighterCodename, 'model', 'body');
    if (fs.existsSync(fighterDir)) {
      const fighterSlots = fs.readdirSync(fighterDir)
        .filter(slot => slot.match(/^c\d+$/) && slot.length === 4);
      fighterSlots.forEach(slot => allCurrentSlots.add(slot));
    }
    
    // Check camera directory
    const cameraDir = path.join(modRoot, 'camera', 'fighter', fighterCodename);
    if (fs.existsSync(cameraDir)) {
      const cameraSlots = fs.readdirSync(cameraDir)
        .filter(slot => slot.match(/^c\d+$/) && slot.length === 4);
      cameraSlots.forEach(slot => allCurrentSlots.add(slot));
    }
    
    console.log(`[DEBUG] Current active slots: ${Array.from(allCurrentSlots)}`);
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      global.mainWindow.webContents.send('debug-message', `[DEBUG] Current active slots: ${Array.from(allCurrentSlots)}`);
    }

    // Find the next available slot number
    let nextAvailableSlotNumber = baseSlotNum;
    while (allCurrentSlots.has(`c${nextAvailableSlotNumber}`)) {
      nextAvailableSlotNumber++;
    }
    
    console.log(`[DEBUG] Next available slot number: ${nextAvailableSlotNumber}`);
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      global.mainWindow.webContents.send('debug-message', `[DEBUG] Next available slot number: ${nextAvailableSlotNumber}`);
    }

    // Find all disabled slots in the disabled directory
    const originalDisabledSlots = new Set();
    
    // Check fighter directory in disabled
    const disabledFighterDir = path.join(disabledDir, 'fighter', fighterCodename, 'model', 'body');
    if (fs.existsSync(disabledFighterDir)) {
      const disabledFighterSlots = fs.readdirSync(disabledFighterDir)
        .filter(slot => slot.match(/^c\d+$/) && slot.length === 4);
      disabledFighterSlots.forEach(slot => originalDisabledSlots.add(slot));
    }
    
    // Check camera directory in disabled
    const disabledCameraDir = path.join(disabledDir, 'camera', 'fighter', fighterCodename);
    if (fs.existsSync(disabledCameraDir)) {
      const disabledCameraSlots = fs.readdirSync(disabledCameraDir)
        .filter(slot => slot.match(/^c\d+$/) && slot.length === 4);
      disabledCameraSlots.forEach(slot => originalDisabledSlots.add(slot));
    }
    
    console.log(`[DEBUG] Found disabled slots: ${Array.from(originalDisabledSlots)}`);
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      global.mainWindow.webContents.send('debug-message', `[DEBUG] Found disabled slots: ${Array.from(originalDisabledSlots)}`);
    }

    // Now restore each slot with conflict resolution
    for (const originalSlot of originalDisabledSlots) {
      let targetSlot = originalSlot;
      
      // Check for conflicts and assign new slot if needed
      while (allCurrentSlots.has(targetSlot)) {
        targetSlot = `c${nextAvailableSlotNumber}`;
        nextAvailableSlotNumber++;
      }
      
      if (targetSlot !== originalSlot) {
        console.log(`[DEBUG] Slot conflict for ${originalSlot}. Assigning new target slot: ${targetSlot}`);
        if (global.mainWindow && !global.mainWindow.isDestroyed()) {
          global.mainWindow.webContents.send('debug-message', `[DEBUG] Slot conflict for ${originalSlot}. Assigning new target slot: ${targetSlot}`);
        }
      }
      
      console.log(`[DEBUG] Restoring slot ${originalSlot} to ${targetSlot}`);
      if (global.mainWindow && !global.mainWindow.isDestroyed()) {
        global.mainWindow.webContents.send('debug-message', `[DEBUG] Restoring slot ${originalSlot} to ${targetSlot}`);
      }
      
      // Restore fighter directory
      const disabledFighterSlot = path.join(disabledDir, 'fighter', fighterCodename, 'model', 'body', originalSlot);
      if (fs.existsSync(disabledFighterSlot)) {
        const destFighter = path.join(modRoot, 'fighter', fighterCodename, 'model', 'body', targetSlot);
        fs.mkdirSync(path.dirname(destFighter), { recursive: true });
        
        try {
          fs.cpSync(disabledFighterSlot, destFighter, { recursive: true });
          console.log(`[DEBUG] Restored fighter files from ${originalSlot} to ${targetSlot}`);
          if (global.mainWindow && !global.mainWindow.isDestroyed()) {
            global.mainWindow.webContents.send('debug-message', `[DEBUG] Restored fighter files from ${originalSlot} to ${targetSlot}`);
          }
          results.restored.push(originalSlot);
        } catch (error) {
          console.log(`[DEBUG] Error restoring fighter directory for ${originalSlot}: ${error.message}`);
          if (global.mainWindow && !global.mainWindow.isDestroyed()) {
            global.mainWindow.webContents.send('debug-message', `[DEBUG] Error restoring fighter directory for ${originalSlot}: ${error.message}`);
          }
          results.errors.push(`Failed to restore fighter files for ${originalSlot}: ${error.message}`);
        }
      }
      
      // Restore camera directory
      const disabledCameraSlot = path.join(disabledDir, 'camera', 'fighter', fighterCodename, originalSlot);
      if (fs.existsSync(disabledCameraSlot)) {
        const destCamera = path.join(modRoot, 'camera', 'fighter', fighterCodename, targetSlot);
        fs.mkdirSync(path.dirname(destCamera), { recursive: true });
        
        try {
          fs.cpSync(disabledCameraSlot, destCamera, { recursive: true });
          console.log(`[DEBUG] Restored camera files from ${originalSlot} to ${targetSlot}`);
          if (global.mainWindow && !global.mainWindow.isDestroyed()) {
            global.mainWindow.webContents.send('debug-message', `[DEBUG] Restored camera files from ${originalSlot} to ${targetSlot}`);
          }
          results.restored.push(originalSlot);
      } catch (error) {
          console.log(`[DEBUG] Error restoring camera directory for ${originalSlot}: ${error.message}`);
          if (global.mainWindow && !global.mainWindow.isDestroyed()) {
            global.mainWindow.webContents.send('debug-message', `[DEBUG] Error restoring camera directory for ${originalSlot}: ${error.message}`);
          }
          results.errors.push(`Failed to restore camera files for ${originalSlot}: ${error.message}`);
        }
      }
      
      // Mark the target slot as occupied for subsequent checks
      allCurrentSlots.add(targetSlot);
    }
    
    console.log(`[DEBUG] Restoration completed. Results: ${JSON.stringify(results)}`);
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      global.mainWindow.webContents.send('debug-message', `[DEBUG] Restoration completed. Results: ${JSON.stringify(results)}`);
    }
    
  } catch (error) {
    console.log(`[DEBUG] Error in restoreDisabledSlots: ${error.message}`);
    console.log(`[DEBUG] Stack trace: ${error.stack}`);
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      global.mainWindow.webContents.send('debug-message', `[DEBUG] Error in restoreDisabledSlots: ${error.message}`);
      global.mainWindow.webContents.send('debug-message', `[DEBUG] Stack trace: ${error.stack}`);
    }
    results.errors.push(`Function error: ${error.message}`);
  }
  
  return results;
}

// Copy files referenced by share-to-added where the source is the disabled slot, so targets retain the assets
function copySharedFilesFromDisabledSlot(backupData, disabledSlot, disabledFolder, modRoot, event) {
  if (!backupData || !backupData['share-to-added']) {
    return;
  }
  const mapping = backupData['share-to-added'];
  const disabledTag = `disabled_${disabledSlot}`;
  const normalize = p => p.replace(/\\/g, '/');

  for (const [sourceKey, targetList] of Object.entries(mapping)) {
    if (typeof sourceKey !== 'string') continue;
    if (!sourceKey.includes(disabledTag)) continue; // only handle entries where source is the disabled slot

    // Convert disabled path back to original relative path
    const sourceRel = normalize(sourceKey).replace(new RegExp(disabledTag, 'g'), disabledSlot);

    if (!Array.isArray(targetList)) continue;

    for (const targetRelRaw of targetList) {
      if (typeof targetRelRaw !== 'string') continue;
      // Important: targetRel may refer to a slot that was shifted after disabling.
      // The backup data is updated by applySlotReordering during cascading shifts and explicit reorders,
      // so targetRel should already be correct when we call this function.
      const targetRel = normalize(targetRelRaw);

      const srcPath = path.join(disabledFolder, ...sourceRel.split('/'));
      const dstPath = path.join(modRoot, ...targetRel.split('/'));

      try {
        if (!fs.existsSync(srcPath)) {
          if (event) event.sender.send('debug-message', `[DEBUG] Share copy skipped (source missing): ${srcPath}`);
          continue;
        }
        if (fs.existsSync(dstPath)) {
          if (event) event.sender.send('debug-message', `[DEBUG] Share copy skipped (target exists): ${dstPath}`);
          continue;
        }
        fs.mkdirSync(path.dirname(dstPath), { recursive: true });
        fs.copyFileSync(srcPath, dstPath);
        if (event) event.sender.send('debug-message', `[DEBUG] Share-to-added copy: ${sourceRel} -> ${targetRel}`);
      } catch (e) {
        if (event) event.sender.send('debug-message', `[DEBUG] Error copying share-to-added file ${sourceRel} -> ${targetRel}: ${e.message}`);
      }
    }
  }
}

// Function for restoring disabled slots (can be called directly or via IPC)
async function restoreDisabledSlotsHandler(event, { modRoot, baseSlotNum, fighterCodename, enabledSlots, disabledSlots }) {
  console.log(`[DEBUG] Restoring disabled slots - SIMPLIFIED FLOW`);
  event.sender.send('debug-message', `[DEBUG] Restoring disabled slots - move files back and integrate config`);
  
  const results = {
    restored: [],
    errors: []
  };
  
  // Declare config variables at function scope so they're available throughout
  const configPath = path.join(modRoot, 'config.json');
  let configData = {};
  
  try {
    // Check if disabled directory exists
    const disabledDir = path.join(modRoot, '.disabled');
    if (!fs.existsSync(disabledDir)) {
      console.log(`[DEBUG] No disabled directory found`);
      event.sender.send('debug-message', `[DEBUG] No disabled directory found`);
      return results;
    }
    
    // Find all disabled folders
    const disabledFolders = fs.readdirSync(disabledDir)
      .filter(folder => folder.match(/^c\d+_\d+$/))
      .sort((a, b) => {
        const timestampA = parseInt(a.split('_')[1]);
        const timestampB = parseInt(b.split('_')[1]);
        return timestampB - timestampA; // Most recent first
      });
    
    console.log(`[DEBUG] Found ${disabledFolders.length} disabled folders: ${disabledFolders}`);
    event.sender.send('debug-message', `[DEBUG] Found ${disabledFolders.length} disabled folders: ${disabledFolders}`);
    
    // Create slot mapping for restoration based on enabledSlots order
    const slotMapping = {};
    let nextSlotNum = baseSlotNum;
    
    for (const slotId of enabledSlots) {
      const targetSlot = `c${nextSlotNum}`;
      if (slotId.startsWith('disabled_')) {
        // Extract original slot from disabled slot ID
        const match = slotId.match(/disabled_(c\d+)_/);
        if (match) {
          const originalSlot = match[1];
          slotMapping[originalSlot] = targetSlot;
        }
      } else {
        if (slotId !== targetSlot) {
          slotMapping[slotId] = targetSlot;
        }
      }
      nextSlotNum++;
    }
    
    console.log(`[DEBUG] Slot mapping for restoration: ${JSON.stringify(slotMapping)}`);
    event.sender.send('debug-message', `[DEBUG] Slot mapping for restoration: ${JSON.stringify(slotMapping)}`);
    
    // Load main config
    if (fs.existsSync(configPath)) {
      configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    
    // Restore each disabled slot
    for (const disabledFolder of disabledFolders) {
      try {
        // Extract slot from "c121_123456" format
        const parts = disabledFolder.split('_');
        const originalSlot = parts[0];  // c121
        const disabledFolderPath = path.join(disabledDir, disabledFolder);
        
        console.log(`[DEBUG] Processing disabled folder: ${disabledFolder} (original slot: ${originalSlot})`);
        event.sender.send('debug-message', `[DEBUG] Processing disabled folder: ${disabledFolder} (original slot: ${originalSlot})`);
        
        // Check if this slot is being restored
        if (!slotMapping[originalSlot]) {
          console.log(`[DEBUG] Skipping ${originalSlot} - not in restore list`);
          event.sender.send('debug-message', `[DEBUG] Skipping ${originalSlot} - not in restore list`);
          continue;
        }
        
        const targetSlot = slotMapping[originalSlot];
        console.log(`[DEBUG] Restoring ${originalSlot} -> ${targetSlot}`);
        event.sender.send('debug-message', `[DEBUG] Restoring ${originalSlot} -> ${targetSlot}`);
        
        // 1. Move files back from disabled folder
        await restoreSlotFiles(modRoot, disabledFolderPath, originalSlot, targetSlot, fighterCodename, event, baseSlotNum);
        
        // 2. Integrate config from disabled folder backup
        await restoreSlotConfig(originalSlot, disabledFolderPath, targetSlot, configData, event);
        
        // 3. Run binary comparison with all other alts and set up file sharing
        console.log(`[DEBUG] Running binary comparison for restored slot ${targetSlot}`);
        event.sender.send('debug-message', `[DEBUG] Running binary comparison for restored slot ${targetSlot}`);
        
        // Get all currently enabled slots (those that have been processed)
        const currentEnabledSlots = enabledSlots
          .filter(s => !s.startsWith('disabled_'))
          .filter(s => s !== targetSlot); // Exclude the slot being restored
        
        if (currentEnabledSlots.length > 0) {
          const { sharesToAdd, filesToDelete } = await detectCrossAltSharing(
            modRoot,
            targetSlot,
            currentEnabledSlots,
            fighterCodename,
            event
          );
          
          // Apply sharing to config
          if (Object.keys(sharesToAdd).length > 0) {
            if (!configData['share-to-added']) {
              configData['share-to-added'] = {};
            }
            
            for (const [source, targets] of Object.entries(sharesToAdd)) {
              if (!configData['share-to-added'][source]) {
                configData['share-to-added'][source] = [];
              }
              // Add targets that aren't already in the list
              for (const target of targets) {
                if (!configData['share-to-added'][source].includes(target)) {
                  configData['share-to-added'][source].push(target);
                }
              }
            }
            
            console.log(`[DEBUG] Added ${Object.keys(sharesToAdd).length} file shares for ${targetSlot}`);
            event.sender.send('debug-message', `[DEBUG] Added ${Object.keys(sharesToAdd).length} file shares for ${targetSlot}`);
          }
          
          // Delete duplicate physical files
          for (const filePath of filesToDelete) {
            try {
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`[DEBUG] Deleted duplicate file: ${path.relative(modRoot, filePath)}`);
                event.sender.send('debug-message', `[DEBUG] Deleted duplicate file: ${path.relative(modRoot, filePath)}`);
              }
            } catch (delError) {
              console.log(`[DEBUG] Error deleting file ${filePath}: ${delError.message}`);
              event.sender.send('debug-message', `[DEBUG] Error deleting file ${filePath}: ${delError.message}`);
            }
          }
        } else {
          console.log(`[DEBUG] No other enabled slots to compare against`);
          event.sender.send('debug-message', `[DEBUG] No other enabled slots to compare against`);
        }
        
        // 4. Clean up disabled folder
        fs.rmSync(disabledFolderPath, { recursive: true, force: true });
        console.log(`[DEBUG] Cleaned up disabled folder: ${disabledFolderPath}`);
        event.sender.send('debug-message', `[DEBUG] Cleaned up disabled folder: ${disabledFolderPath}`);
        
        results.restored.push({ originalSlot, targetSlot });
        
      } catch (error) {
        console.log(`[DEBUG] Error restoring slot from ${disabledFolder}: ${error.message}`);
        event.sender.send('debug-message', `[DEBUG] Error restoring slot from ${disabledFolder}: ${error.message}`);
        results.errors.push(`Failed to restore ${disabledFolder}: ${error.message}`);
      }
    }
    
    // Save updated config
    if (Object.keys(configData).length > 0) {
      writeJsonPreserve(configPath, configData);
      console.log(`[DEBUG] Saved updated config.json`);
      event.sender.send('debug-message', `[DEBUG] Saved updated config.json`);
    }
    
    // Apply cascading shifts to all remaining enabled slots
    if (Object.keys(slotMapping).length > 0) {
      console.log(`[DEBUG] Applying cascading shifts for all slots`);
      event.sender.send('debug-message', `[DEBUG] Applying cascading shifts for all slots`);
      
      // Apply file system changes
      await reorderSlotFiles(modRoot, Object.keys(slotMapping), event, baseSlotNum, fighterCodename);
      
      // Apply config changes (reload config to get latest state)
      if (fs.existsSync(configPath)) {
        configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        applySlotReordering(configData, slotMapping, event);
        writeJsonPreserve(configPath, configData);
        console.log(`[DEBUG] Applied cascading shifts to config`);
        event.sender.send('debug-message', `[DEBUG] Applied cascading shifts to config`);
      }
    }
    
    console.log(`[DEBUG] Restore operation completed. Restored: ${results.restored.length}, Errors: ${results.errors.length}`);
    event.sender.send('debug-message', `[DEBUG] Restore operation completed. Restored: ${results.restored.length}, Errors: ${results.errors.length}`);
    
  } catch (error) {
    console.log(`[DEBUG] Error in restore operation: ${error.message}`);
    event.sender.send('debug-message', `[DEBUG] Error in restore operation: ${error.message}`);
    results.errors.push(`Restore operation failed: ${error.message}`);
  }
  
  // Final config write to ensure all changes are persisted
  try {
    writeJsonPreserve(configPath, configData);
    console.log(`[DEBUG] Final config write completed`);
    event.sender.send('debug-message', `[DEBUG] Final config write completed`);
  } catch (finalWriteError) {
    console.log(`[DEBUG] Error in final config write: ${finalWriteError.message}`);
    event.sender.send('debug-message', `[DEBUG] Error in final config write: ${finalWriteError.message}`);
    results.errors.push(`Final config write failed: ${finalWriteError.message}`);
  }
  
  // Add success flag
  results.success = results.errors.length === 0;
  
  return results;
}

// IPC handler for restoring disabled slots
ipcMain.handle('restore-disabled-slots', async (event, params) => {
  return await restoreDisabledSlotsHandler(event, params);
});

// Handler to delete all disabled skins
ipcMain.handle('delete-all-disabled', async (event, { modRoot }) => {
  console.log(`[DEBUG] Deleting all disabled slots`);
  event.sender.send('debug-message', `[DEBUG] Deleting all disabled slots`);
  
  const results = {
    deleted: 0,
    errors: []
  };
  
  try {
    // Check if disabled directory exists
    const disabledDir = path.join(modRoot, '.disabled');
    if (!fs.existsSync(disabledDir)) {
      console.log(`[DEBUG] No disabled directory found`);
      event.sender.send('debug-message', `[DEBUG] No disabled directory found`);
      return results;
    }
    
    // Find all disabled folders
    const disabledFolders = fs.readdirSync(disabledDir);
    
    console.log(`[DEBUG] Found ${disabledFolders.length} disabled folders to delete`);
    event.sender.send('debug-message', `[DEBUG] Found ${disabledFolders.length} disabled folders to delete`);
    
    // Delete each disabled folder
    for (const disabledFolder of disabledFolders) {
      try {
        const disabledFolderPath = path.join(disabledDir, disabledFolder);
        
        if (fs.statSync(disabledFolderPath).isDirectory()) {
          fs.rmSync(disabledFolderPath, { recursive: true, force: true });
          results.deleted++;
          console.log(`[DEBUG] Deleted disabled folder: ${disabledFolder}`);
          event.sender.send('debug-message', `[DEBUG] Deleted disabled folder: ${disabledFolder}`);
        }
      } catch (error) {
        console.log(`[DEBUG] Error deleting ${disabledFolder}: ${error.message}`);
        event.sender.send('debug-message', `[DEBUG] Error deleting ${disabledFolder}: ${error.message}`);
        results.errors.push(`Failed to delete ${disabledFolder}: ${error.message}`);
      }
    }
    
    // Remove the .disabled folder itself if it's now empty
    const remainingContents = fs.readdirSync(disabledDir);
    if (remainingContents.length === 0) {
      fs.rmdirSync(disabledDir);
      console.log(`[DEBUG] Removed empty .disabled folder`);
      event.sender.send('debug-message', `[DEBUG] Removed empty .disabled folder`);
    }
    
    console.log(`[DEBUG] Delete operation completed. Deleted: ${results.deleted}, Errors: ${results.errors.length}`);
    event.sender.send('debug-message', `[DEBUG] Delete operation completed. Deleted: ${results.deleted}, Errors: ${results.errors.length}`);
    
  } catch (error) {
    console.log(`[DEBUG] Error in delete operation: ${error.message}`);
    event.sender.send('debug-message', `[DEBUG] Error in delete operation: ${error.message}`);
    results.errors.push(`Delete operation failed: ${error.message}`);
  }
  
  return results;
});

// Helper functions for slot operations

// Function to apply config shifts for slot reordering
async function applyConfigShifts(configData, slotMapping, baseSlotNum, event) {
  if (event) {
    event.sender.send('debug-message', `[DEBUG] Applying config shifts with mapping: ${JSON.stringify(slotMapping)}`);
  }

  if (!slotMapping || Object.keys(slotMapping).length === 0) {
    return;
  }

  // Only operate on known sections to avoid touching unrelated metadata
  const sections = ['new-dir-infos', 'new-dir-infos-base', 'new-dir-files', 'share-to-vanilla', 'share-to-added'];

  // Create temp markers to handle swaps/cycles
  const slotsInvolved = new Set([...Object.keys(slotMapping), ...Object.values(slotMapping)]);
  const tempMarkers = {};
  for (const slot of slotsInvolved) tempMarkers[slot] = `TEMP_${slot}`;

  // Helper: safe replace for slot paths in strings
  function replaceSlotsInString(text, mapping) {
    if (typeof text !== 'string') return text;
    let out = text;
    const keys = Object.keys(mapping).sort((a, b) => b.length - a.length);
    for (const k of keys) {
      const v = mapping[k];
      const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // /cXXX/ -> /v/
      out = out.replace(new RegExp(`/${esc}/`, 'g'), `/${v}/`);
      // end /cXXX -> /v
      out = out.replace(new RegExp(`/${esc}$`), `/${v}`);
      // _cXXX. -> _v.
      out = out.replace(new RegExp(`_${esc}\\.`, 'g'), `_${v}.`);
    }
    return out;
  }

  function mapSection(sectionValue, mapping) {
    if (!sectionValue) return sectionValue;
    if (typeof sectionValue === 'string') return replaceSlotsInString(sectionValue, mapping);
    if (Array.isArray(sectionValue)) return sectionValue.map(v => mapSection(v, mapping));
    if (typeof sectionValue === 'object') {
      const result = {};
      for (const [k, v] of Object.entries(sectionValue)) {
        const newKey = replaceSlotsInString(k, mapping);
        const newVal = mapSection(v, mapping);
        // Merge arrays if keys collide after renaming instead of overwriting
        if (Array.isArray(newVal) && Array.isArray(result[newKey])) {
          const set = new Set([...result[newKey], ...newVal]);
          result[newKey] = Array.from(set);
        } else if (result[newKey] && typeof result[newKey] === 'object' && typeof newVal === 'object' && !Array.isArray(newVal)) {
          result[newKey] = { ...result[newKey], ...newVal };
        } else {
          result[newKey] = newVal;
        }
      }
      return result;
    }
    return sectionValue;
  }

  // Step 1: temp replace within known sections only
  if (event) event.sender.send('debug-message', `[DEBUG] Step 1: Replacing slots with temp markers (scoped)`);
  for (const section of sections) {
    if (section in configData) {
      configData[section] = mapSection(configData[section], tempMarkers);
    }
  }

  // Step 2: final replacements
  const finalMapping = {};
  for (const [oldSlot, newSlot] of Object.entries(slotMapping)) finalMapping[tempMarkers[oldSlot]] = newSlot;
  if (event) event.sender.send('debug-message', `[DEBUG] Step 2: Replacing temp markers with final targets (scoped)`);
  for (const section of sections) {
    if (section in configData) {
      configData[section] = mapSection(configData[section], finalMapping);
    }
  }

  // Final cleanup: strip any leftover TEMP_ markers inside the same sections
  function cleanupTemps(value) {
    if (typeof value === 'string') return value.replace(/TEMP_(c\d+)/g, '$1');
    if (Array.isArray(value)) return value.map(cleanupTemps);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        const cleanedKey = k.replace(/TEMP_(c\d+)/g, '$1');
        out[cleanedKey] = cleanupTemps(v);
      }
      return out;
    }
    return value;
  }
  for (const section of sections) {
    if (section in configData) {
      configData[section] = cleanupTemps(configData[section]);
    }
  }

  // Post-filter: remove any disabled_* targets from share sections and dedupe
  function filterDisabledInArrays(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) {
        const cleaned = Array.from(new Set(v.filter(s => typeof s === 'string' && !/disabled_c\d+/.test(s))));
        out[k] = cleaned;
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  if (configData['share-to-vanilla']) {
    configData['share-to-vanilla'] = filterDisabledInArrays(configData['share-to-vanilla']);
  }
  if (configData['share-to-added']) {
    configData['share-to-added'] = filterDisabledInArrays(configData['share-to-added']);
  }

  if (event) {
    event.sender.send('debug-message', `[DEBUG] Config shifts applied (scoped) with safe merging and no UI suffix rewrites`);
  }
}

// Normalize share-to-vanilla target lists to include all active slots and exclude disabled
function normalizeShareToVanilla(configData, activeSlots) {
  if (!configData || !configData['share-to-vanilla']) return;
  const slotsSorted = Array.from(new Set(activeSlots)).sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1)));
  const section = configData['share-to-vanilla'];
  const result = {};
  for (const [source, targets] of Object.entries(section)) {
    const arr = Array.isArray(targets) ? targets : [targets];
    // Pick a template from first non-disabled target
    const sample = arr.find(t => typeof t === 'string' && !/disabled_c\d+/.test(t));
    if (!sample) { result[source] = []; continue; }
    let template = null;
    if (sample.match(/_c\d+\b/)) {
      template = sample.replace(/_c\d+\b/, '_{slot}');
    } else if (sample.match(/\/c\d+\b/)) {
      template = sample.replace(/\/c\d+\b/, '/{slot}');
    }
    if (!template) { result[source] = arr.filter(s=>typeof s==='string'&&!/disabled_c\d+/.test(s)); continue; }
    const rebuilt = slotsSorted.map(s => template.replace('{slot}', s));
    result[source] = Array.from(new Set(rebuilt));
  }
  configData['share-to-vanilla'] = result;
}

// Optional: normalize share-to-added to remove disabled targets
// Note: share-to-added is an explicit mapping, NOT a pattern-based system
// We only remove disabled targets, we don't rebuild the entire list
function normalizeShareToAdded(configData, activeSlots) {
  if (!configData || !configData['share-to-added']) return;
  const activeSlotSet = new Set(activeSlots);
  const section = configData['share-to-added'];
  const result = {};
  
  let vanillaEntriesKept = 0;
  
  for (const [source, targets] of Object.entries(section)) {
    // Skip source entries if the source itself is disabled
    const sourceSlotMatch = source.match(/\/c(\d+)\//);
    const sourceSlot = sourceSlotMatch ? `c${sourceSlotMatch[1]}` : null;
    if (sourceSlot) {
      const sourceSlotNum = parseInt(sourceSlotMatch[1]);
      const isVanillaSourceSlot = sourceSlotNum <= 7; // c00-c07 are vanilla slots
      
      // Skip only if NOT vanilla AND NOT in active slots
      if (!isVanillaSourceSlot && !activeSlotSet.has(sourceSlot)) {
        continue; // Source is disabled and not vanilla, skip this entry
      }
      
      if (isVanillaSourceSlot) {
        vanillaEntriesKept++;
      }
    }
    
    // Filter out disabled targets only - preserve the explicit target list
    const cleaned = (Array.isArray(targets) ? targets : [targets])
      .filter(t => {
        if (typeof t !== 'string') return false;
        // Remove if contains "disabled_"
        if (/disabled_c\d+/.test(t)) return false;
        // Remove if the target slot is not in activeSlots (unless it's vanilla)
        const targetSlotMatch = t.match(/\/c(\d+)\//);
        if (targetSlotMatch) {
          const targetSlot = `c${targetSlotMatch[1]}`;
          const targetSlotNum = parseInt(targetSlotMatch[1]);
          const isVanillaTargetSlot = targetSlotNum <= 7;
          // Keep if vanilla OR in active slots
          return isVanillaTargetSlot || activeSlotSet.has(targetSlot);
        }
        return true;
      });
    
    // Only include this source if it has at least one valid target
    if (cleaned.length > 0) {
      result[source] = cleaned;
    }
  }
  
  configData['share-to-added'] = result;
  console.log(`[DEBUG] normalizeShareToAdded: Kept ${vanillaEntriesKept} vanilla slot entries (c00-c07)`);
}

// Function to verify and fix config against physical files
async function verifyAndFixConfig(modRoot, configData, baseSlotNum, event) {
  if (event) {
    event.sender.send('debug-message', `[DEBUG] Scanning physical file structure...`);
  }

  // Scan for actual slot directories
  const actualSlots = new Set();
  
  // Check fighter directories
  const fighterBodyPath = path.join(modRoot, 'fighter');
  let detectedFighterCodename = null;
  
  if (fs.existsSync(fighterBodyPath)) {
    const fighterDirs = fs.readdirSync(fighterBodyPath, { withFileTypes: true })
      .filter(entry => entry.isDirectory());
    
    for (const fighterDir of fighterDirs) {
      const fighterPath = path.join(fighterBodyPath, fighterDir.name);
      const modelBodyPath = path.join(fighterPath, 'model', 'body');
      
      if (fs.existsSync(modelBodyPath)) {
        const slotDirs = fs.readdirSync(modelBodyPath, { withFileTypes: true })
          .filter(entry => entry.isDirectory() && /^c\d+$/.test(entry.name))
          .map(entry => entry.name);
        
        if (slotDirs.length > 0 && !detectedFighterCodename) {
          detectedFighterCodename = fighterDir.name;
        }
        
        for (const slot of slotDirs) {
          actualSlots.add(slot);
        }
      }
    }
  }

  if (actualSlots.size === 0) {
    if (event) {
      event.sender.send('debug-message', `[DEBUG] No physical slot directories found, skipping verification`);
    }
    return;
  }

  const sortedSlots = Array.from(actualSlots).sort((a, b) => {
    const numA = parseInt(a.substring(1));
    const numB = parseInt(b.substring(1));
    return numA - numB;
  });

  if (event) {
    event.sender.send('debug-message', `[DEBUG] Found physical slots: ${sortedSlots.join(', ')}`);
  }

  // Rebuild new-dir-infos based on actual files
  if (configData['new-dir-infos'] && detectedFighterCodename) {
    const newDirInfos = [];
    const categories = ['', 'kirbycopy/', 'camera/', 'movie/', 'result/'];
    
    for (const slot of sortedSlots) {
      for (const category of categories) {
        const entry = `fighter/${detectedFighterCodename}/${category}${slot}`;
        newDirInfos.push(entry);
      }
    }
    
    configData['new-dir-infos'] = newDirInfos;
    
    if (event) {
      event.sender.send('debug-message', `[DEBUG] Rebuilt new-dir-infos with ${newDirInfos.length} entries`);
    }
  }

  // Filter new-dir-infos-base to only keep entries for active slots
  // Don't rebuild - preserve the original structure and subdirectories
  if (configData['new-dir-infos-base']) {
    const newDirInfosBase = {};
    const activeSlotSet = new Set(sortedSlots);
    
    for (const [key, value] of Object.entries(configData['new-dir-infos-base'])) {
      // Extract the slot number from the key (e.g., c104 from "fighter/wolf/c104/cmn")
      const slotMatch = key.match(/\/c(\d+)\//);
      if (slotMatch) {
        const slot = `c${slotMatch[1]}`;
        const slotNum = parseInt(slotMatch[1]);
        const isVanillaSlot = slotNum <= 7; // c00-c07 are vanilla slots
        
        // Keep entries for vanilla slots OR active slots
        if (isVanillaSlot || activeSlotSet.has(slot)) {
          newDirInfosBase[key] = value;
        }
      } else {
        // Keep entries without slot numbers (shouldn't happen, but be safe)
        newDirInfosBase[key] = value;
      }
    }
    
    configData['new-dir-infos-base'] = newDirInfosBase;
    
    if (event) {
      event.sender.send('debug-message', `[DEBUG] Filtered new-dir-infos-base to ${Object.keys(newDirInfosBase).length} entries`);
    }
  }

  // Fix new-dir-files - only filter invalid/non-existent entries; do NOT remap slot numbers here
  if (configData['new-dir-files']) {
    const cleanedNewDirFiles = {};
    const existingFiles = configData['new-dir-files'];

    for (const [keyPath, value] of Object.entries(existingFiles)) {
      const normalizedKey = keyPath.replace(/\\/g, '/');
      // Keep all keys (even if their slot isn't currently on disk) so we can close gaps by remapping,
      // e.g., map c123 -> c122 instead of dropping it.
      cleanedNewDirFiles[normalizedKey] = value;
    }

    // Gap-filling remap: align present slots to expected continuous slots (c104..)
    const presentSlots = Array.from(new Set(Object.keys(cleanedNewDirFiles)
      .map(k => (k.match(/\/(c\d+)\b/) || [])[1])
      .filter(Boolean)))
      .sort((a,b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));

    const expectedSlots = sortedSlots.slice(0, presentSlots.length);

    const slotReindexMap = {};
    for (let i = 0; i < presentSlots.length; i++) {
      const from = presentSlots[i];
      const to = expectedSlots[i];
      if (from && to && from !== to) slotReindexMap[from] = to;
    }

    function replaceSlotOnce(text, fromSlot, toSlot) {
      // Replace /fromSlot/ , /fromSlot (end), and _fromSlot.
      return text
        .replace(new RegExp(`/${fromSlot}/`, 'g'), `/${toSlot}/`)
        .replace(new RegExp(`/${fromSlot}$`), `/${toSlot}`)
        .replace(new RegExp(`_${fromSlot}\\.`, 'g'), `_${toSlot}.`);
    }

    let remappedNewDirFiles = {};
    if (Object.keys(slotReindexMap).length > 0) {
      for (const [key, val] of Object.entries(cleanedNewDirFiles)) {
        let newKey = key;
        for (const [fromSlot, toSlot] of Object.entries(slotReindexMap)) {
          newKey = replaceSlotOnce(newKey, fromSlot, toSlot);
        }
        let newVal = val;
        if (Array.isArray(val)) {
          newVal = val.map(item => {
            if (typeof item !== 'string') return item;
            let out = item;
            for (const [fromSlot, toSlot] of Object.entries(slotReindexMap)) {
              out = replaceSlotOnce(out, fromSlot, toSlot);
            }
            return out;
          });
        }
        remappedNewDirFiles[newKey] = newVal;
      }
    } else {
      remappedNewDirFiles = cleanedNewDirFiles;
    }

    configData['new-dir-files'] = remappedNewDirFiles;
    if (event) event.sender.send('debug-message', `[DEBUG] Cleaned new-dir-files: ${Object.keys(remappedNewDirFiles).length} entries`);
  }

  // Fix share-to-added - remove entries for non-existent slots
  if (configData['share-to-added']) {
    const shareToAdded = {};
    const existingShares = configData['share-to-added'];
    
    // Count c00-c07 entries before filtering
    const vanillaEntriesCount = Object.keys(existingShares).filter(k => /\/c0[0-7]\//.test(k)).length;
    if (event && vanillaEntriesCount > 0) {
      event.sender.send('debug-message', `[DEBUG] Found ${vanillaEntriesCount} vanilla slot (c00-c07) entries in share-to-added before filtering`);
    }
    
    for (const [sourcePath, targets] of Object.entries(existingShares)) {
      // Match slot in path (/c123/) or filename (_c123.)
      const sourceSlotMatch = sourcePath.match(/(?:\/|_)c(\d+)(?:\/|\.)/);
      if (sourceSlotMatch) {
        const sourceSlot = `c${sourceSlotMatch[1]}`;
        const sourceSlotNum = parseInt(sourceSlotMatch[1]);
        const isVanillaSourceSlot = sourceSlotNum <= 7; // c00-c07 are vanilla slots
        
        if (event && isVanillaSourceSlot) {
          event.sender.send('debug-message', `[DEBUG] Preserving vanilla slot entry: ${sourcePath.substring(0, 60)}...`);
        }
        
        // Keep if it's a vanilla slot OR if it exists in actualSlots
        if (isVanillaSourceSlot || actualSlots.has(sourceSlot)) {
          // Filter targets to only include existing slots (or vanilla slots)
          const validTargets = Array.isArray(targets) 
            ? targets.filter(target => {
                // Match slot in path (/c123/) or filename (_c123.)
                const targetSlotMatch = target.match(/(?:\/|_)c(\d+)(?:\/|\.)/);
                if (targetSlotMatch) {
                  const targetSlotNum = parseInt(targetSlotMatch[1]);
                  const isVanillaTargetSlot = targetSlotNum <= 7;
                  return isVanillaTargetSlot || actualSlots.has(`c${targetSlotMatch[1]}`);
                }
                return true;
              })
            : targets;
          
          if (Array.isArray(validTargets) && validTargets.length > 0) {
            shareToAdded[sourcePath] = validTargets;
          } else if (!Array.isArray(validTargets)) {
            shareToAdded[sourcePath] = validTargets;
          }
        }
      } else {
        // Keep non-slot-specific entries
        shareToAdded[sourcePath] = targets;
      }
    }
    
    configData['share-to-added'] = shareToAdded;
    
    if (event) {
      event.sender.send('debug-message', `[DEBUG] Cleaned share-to-added: ${Object.keys(shareToAdded).length} entries`);
    }
  }

  // Fix share-to-vanilla - remove entries for non-existent slots and disabled targets
  if (configData['share-to-vanilla']) {
    const shareToVanilla = {};
    const existingShares = configData['share-to-vanilla'];
    
    for (const [sourcePath, targets] of Object.entries(existingShares)) {
      const sourceSlotMatch = sourcePath.match(/\/c(\d+)\//);
      if (sourceSlotMatch) {
        const sourceSlot = `c${sourceSlotMatch[1]}`;
        const slotNum = parseInt(sourceSlotMatch[1]);
        const isVanillaSlot = slotNum <= 7; // c00-c07 are vanilla slots
        
        // Keep if it's a vanilla slot OR if it exists in actualSlots
        if (isVanillaSlot || actualSlots.has(sourceSlot)) {
          const arr = Array.isArray(targets) ? targets : [targets];
          const cleaned = arr.filter(t => typeof t === 'string' && !/disabled_c\d+/.test(t));
          shareToVanilla[sourcePath] = cleaned;
        }
      } else {
        // Keep non-slot-specific entries
        const arr = Array.isArray(targets) ? targets : [targets];
        const cleaned = arr.filter(t => typeof t === 'string' && !/disabled_c\d+/.test(t));
        shareToVanilla[sourcePath] = cleaned;
      }
    }
    
    configData['share-to-vanilla'] = shareToVanilla;
    
    if (event) {
      event.sender.send('debug-message', `[DEBUG] Cleaned share-to-vanilla: ${Object.keys(shareToVanilla).length} entries`);
    }
  }

  // Finally, normalize broad lists to include all active slots
  try {
    normalizeShareToVanilla(configData, sortedSlots);
  } catch (_) {}

  try {
    normalizeShareToAdded(configData, sortedSlots);
  } catch (_) {}
}

// OLD FUNCTION REMOVED - Now using restoreSlotConfig instead

// Function to process and merge backup config with special share-to-added handling
async function processAndMergeBackupConfig(modRoot, slotBackupData, baseSlot, targetSlot, configData, baseSlotNum, event) {
  if (event) {
    event.sender.send('debug-message', `[DEBUG] Processing backup data for ${baseSlot} -> ${targetSlot}`);
  }

  const renamedBackupData = {};
  // Local mapping for this restore operation
  const slotMapping = { [baseSlot]: targetSlot };

  // If any prior slot shifts occurred, ensure disabled_cXXX targets in backup are remapped accordingly
  // This function is called after applyConfigShifts/applySlotReordering during restore flow.

  // Helper function to rename disabled_c## to target slot
  function renameDisabledSlotInString(text, disabledSlot, newSlot) {
    if (typeof text !== 'string') return text;
    
    let result = text;
    
    // IMPORTANT: Replace ANY disabled_cXXX pattern with the target slot
    // This handles both the primary slot being restored (disabled_c118)
    // AND any related files that might have been created with disabled_ prefix (like disabled_c119 for effects)
    // All of these should point to the new active slot (newSlot)
    result = result.replace(/disabled_(c\d+)/g, newSlot);
    
    // Handle UI patterns for alt numbers
    if (baseSlotNum) {
      try {
        const oldAltNum = parseInt(disabledSlot.substring(1)) - baseSlotNum;
        const newAltNum = parseInt(newSlot.substring(1)) - baseSlotNum;
        
        if (oldAltNum >= 0 && newAltNum >= 0) {
          const oldAltStr = oldAltNum.toString().padStart(2, '0');
          const newAltStr = newAltNum.toString().padStart(2, '0');
          
          // Replace UI patterns like _01.bntx with _02.bntx
          result = result.replace(new RegExp(`_${oldAltStr}\\.(bntx|nutexb)`, 'g'), `_${newAltStr}.$1`);
        }
      } catch (e) {
        // Skip UI pattern replacement if parsing fails
      }
    }
    
    return result;
  }

  // Helper function to recursively rename disabled_c## to target slot
  function renamePathsRecursively(obj) {
    if (typeof obj === 'string') {
      return renameDisabledSlotInString(obj, baseSlot, targetSlot);
    } else if (Array.isArray(obj)) {
      return obj.map(item => renamePathsRecursively(item));
    } else if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        const newKey = renameDisabledSlotInString(key, baseSlot, targetSlot);
        result[newKey] = renamePathsRecursively(value);
      }
      return result;
    }
    return obj;
  }

  // Process sections other than share-to-added first
  const normalSections = ['new-dir-infos', 'new-dir-infos-base', 'share-to-vanilla', 'new-dir-files'];
  for (const section of normalSections) {
    if (section in slotBackupData) {
      renamedBackupData[section] = renamePathsRecursively(slotBackupData[section]);
    }
  }

  // Special handling for share-to-added
  if ('share-to-added' in slotBackupData) {
    if (event) {
      event.sender.send('debug-message', `[DEBUG] Applying special share-to-added logic for ${baseSlot} -> ${targetSlot}`);
    }
    
    const backupShareToAdded = slotBackupData['share-to-added'] || {};
    const processedShareToAdded = {};
    const disabledShareToAdded = {}; // New: entries that should go to disabled config

    for (const [sourceKey, targetList] of Object.entries(backupShareToAdded)) {
      // Check if source key involves the disabled slot
      const sourceInvolvesDisabled = typeof sourceKey === 'string' && sourceKey.includes(`disabled_${baseSlot}`);

      // Determine final source key
      // If source is disabled_cXXX, it becomes the re-enabled slot (targetSlot)
      // If source is a regular cXXX, keep it as is (e.g., c118 stays c118)
      const finalSourceKey = sourceInvolvesDisabled
        ? renameDisabledSlotInString(sourceKey, baseSlot, targetSlot)
        : sourceKey;

      // Process target list
      const finalTargetList = [];
      if (Array.isArray(targetList)) {
        for (const targetPath of targetList) {
          if (typeof targetPath === 'string') {
            // Check if target path involves the disabled slot
            const targetInvolvesDisabled = targetPath.includes(`disabled_${baseSlot}`);

            // Apply special logic based on source/target involvement
            // If target points to disabled slot, it should now point to the new slot (targetSlot)
            // Otherwise keep it untouched
            const renamedTarget = targetInvolvesDisabled
              ? renameDisabledSlotInString(targetPath, baseSlot, targetSlot)
              : targetPath;
            
            // Avoid self-references (source sharing to itself)
            if (renamedTarget !== finalSourceKey) {
              finalTargetList.push(renamedTarget);
            } else {
              if (event) {
                event.sender.send('debug-message', `[DEBUG] Skipping self-reference: ${finalSourceKey} -> ${renamedTarget}`);
              }
            }
          } else {
            finalTargetList.push(targetPath); // Keep non-strings
          }
        }
      } else {
        finalTargetList.push(targetList); // Keep non-arrays
      }

      // Only add if we have valid targets and no self-reference
      if (finalTargetList.length > 0) {
        // NEW LOGIC: Move ONLY entries that match BOTH:
        // - targets reference disabled_{baseSlot} (i.e., they pointed at the disabled slot we are restoring)
        // - source slot is exactly the slot that will become disabled (targetSlot)
        const targetRefsDisabled = finalTargetList.some(target => typeof target === 'string' && target.includes(`disabled_${baseSlot}`));
        const sourceSlotMatch = typeof finalSourceKey === 'string' ? finalSourceKey.match(/\/(c\d+)\//) : null;
        const sourceSlot = sourceSlotMatch ? sourceSlotMatch[1] : null;
        const shouldGoToDisabled = targetRefsDisabled && sourceSlot === targetSlot;
        
        if (shouldGoToDisabled) {
          // Create disabled version of the source key. Convert /cNNN/ that equals
          // the slot being disabled to /disabled_targetSlot/ and avoid double prefixes.
          let disabledSourceKey = finalSourceKey
            .replace(new RegExp(`/${targetSlot}/`, 'g'), `/disabled_${targetSlot}/`)
            .replace(/disabled_(c\d+)\/disabled_\1/g, 'disabled_$1');
          
          // Targets should point to the active target slot (e.g., c105), not disabled.
          const disabledTargets = finalTargetList.map(target => {
            if (typeof target !== 'string') return target;
            let out = target.replace(new RegExp(`disabled_${baseSlot}`, 'g'), targetSlot);
            out = out.replace(/disabled_(c\d+)\/disabled_\1/g, 'disabled_$1');
            return out;
          });
          
          disabledShareToAdded[disabledSourceKey] = disabledTargets;
          
          if (event) {
            event.sender.send('debug-message', `[DEBUG] Moving to disabled config: ${disabledSourceKey} -> ${JSON.stringify(disabledTargets)}`);
          }
        } else {
          // Handle collisions - merge lists, avoid duplicates
          if (finalSourceKey in processedShareToAdded) {
            if (!Array.isArray(processedShareToAdded[finalSourceKey])) {
              processedShareToAdded[finalSourceKey] = [processedShareToAdded[finalSourceKey]];
            }
            if (Array.isArray(finalTargetList)) {
              for (const item of finalTargetList) {
                if (!processedShareToAdded[finalSourceKey].includes(item)) {
                  processedShareToAdded[finalSourceKey].push(item);
                }
              }
            } else if (!processedShareToAdded[finalSourceKey].includes(finalTargetList)) {
              processedShareToAdded[finalSourceKey].push(finalTargetList);
            }
          } else {
            processedShareToAdded[finalSourceKey] = finalTargetList;
          }
        }
      } else {
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Skipping empty target list for source: ${finalSourceKey}`);
        }
      }
    }

    // Only merge the non-disabled entries into the main config
    renamedBackupData['share-to-added'] = processedShareToAdded;
    
    // Store disabled entries for later use
    renamedBackupData['_disabled_share_to_added'] = disabledShareToAdded;
    
    if (event) {
      event.sender.send('debug-message', `[DEBUG] Processed share-to-added entries: ${Object.keys(processedShareToAdded).length}`);
      event.sender.send('debug-message', `[DEBUG] Disabled share-to-added entries: ${Object.keys(disabledShareToAdded).length}`);
      for (const [source, targets] of Object.entries(processedShareToAdded)) {
        event.sender.send('debug-message', `[DEBUG] Share entry: ${source} -> ${JSON.stringify(targets)}`);
      }
      for (const [source, targets] of Object.entries(disabledShareToAdded)) {
        event.sender.send('debug-message', `[DEBUG] Disabled share entry: ${source} -> ${JSON.stringify(targets)}`);
      }
    }
  }

  // Merge renamed backup data into main config
  if (event) {
    event.sender.send('debug-message', `[DEBUG] Merging processed backup data into main config`);
  }

  // Merge lists (new-dir-infos)
  if ('new-dir-infos' in renamedBackupData) {
    if (event) {
      event.sender.send('debug-message', `[DEBUG] Found new-dir-infos in backup data`);
      event.sender.send('debug-message', `[DEBUG] new-dir-infos type: ${typeof renamedBackupData['new-dir-infos']}`);
      event.sender.send('debug-message', `[DEBUG] new-dir-infos value: ${JSON.stringify(renamedBackupData['new-dir-infos'])}`);
    }
    
    if (!('new-dir-infos' in configData)) configData['new-dir-infos'] = [];
    
    if (Array.isArray(renamedBackupData['new-dir-infos'])) {
      let itemsAdded = 0;
      for (const item of renamedBackupData['new-dir-infos']) {
        if (!configData['new-dir-infos'].includes(item)) {
          configData['new-dir-infos'].push(item);
          itemsAdded++;
        }
      }
      if (event && itemsAdded > 0) {
        event.sender.send('debug-message', `[DEBUG] Merged new-dir-infos (${itemsAdded} new items)`);
      }
    } else {
      if (event) {
        event.sender.send('debug-message', `[DEBUG] new-dir-infos is not an array, skipping merge`);
      }
    }
  }

  // Merge dictionaries (new-dir-infos-base)
  if ('new-dir-infos-base' in renamedBackupData) {
    if (!('new-dir-infos-base' in configData)) configData['new-dir-infos-base'] = {};
    const origLen = Object.keys(configData['new-dir-infos-base']).length;
    Object.assign(configData['new-dir-infos-base'], renamedBackupData['new-dir-infos-base']);
    const mergedCount = Object.keys(configData['new-dir-infos-base']).length - origLen;
    if (event && mergedCount > 0) {
      event.sender.send('debug-message', `[DEBUG] Merged new-dir-infos-base (${mergedCount} new/updated keys)`);
    }
  }

  // Helper to recursively apply slot mapping to both keys and values of a dict-of-lists section
  function remapDictOfListsKeysAndValues(dict, slotMapping) {
    if (!dict || typeof dict !== 'object') return dict;
    const remapped = {};
    for (const [key, values] of Object.entries(dict)) {
      // Remap the key
      let newKey = key;
      for (const [oldSlot, newSlot] of Object.entries(slotMapping)) {
        newKey = newKey.replace(new RegExp(`c${oldSlot.slice(1)}`, 'g'), newSlot); // e.g. c118 -> c113
      }
      // Remap all values in the array
      let newValues = values;
      if (Array.isArray(values)) {
        newValues = values.map(val => {
          let newVal = val;
          for (const [oldSlot, newSlot] of Object.entries(slotMapping)) {
            newVal = newVal.replace(new RegExp(`c${oldSlot.slice(1)}`, 'g'), newSlot);
          }
          return newVal;
        });
      }
      remapped[newKey] = newValues;
    }
    return remapped;
  }

  // Merge dicts of lists (share-to-vanilla, new-dir-files, share-to-added)
  const dictOfListsSections = ['share-to-vanilla', 'new-dir-files', 'share-to-added'];
  for (const section of dictOfListsSections) {
    if (section in renamedBackupData) {
      if (!(section in configData)) configData[section] = {};
        // --- For share-to-added we already performed precise renames; skip broad remap to avoid altering sources like c118 -> c105 ---
  let remappedSection;
  if (section === 'share-to-added') {
    // Validate share-to-added entries to prevent corruption
    const validatedShareToAdded = {};
    for (const [source, targets] of Object.entries(renamedBackupData[section])) {
      // Skip entries that would create self-references or invalid mappings
      if (Array.isArray(targets)) {
        const validTargets = targets.filter(target => {
          // Skip self-references
          if (target === source) {
            if (event) {
              event.sender.send('debug-message', `[DEBUG] Skipping self-reference in merge: ${source} -> ${target}`);
            }
            return false;
          }
          // Skip invalid paths
          if (typeof target !== 'string' || !target.includes('/')) {
            if (event) {
              event.sender.send('debug-message', `[DEBUG] Skipping invalid target in merge: ${source} -> ${target}`);
            }
            return false;
          }
          return true;
        });
        
        if (validTargets.length > 0) {
          validatedShareToAdded[source] = validTargets;
        }
      }
    }
    remappedSection = validatedShareToAdded;
  } else {
    remappedSection = remapDictOfListsKeysAndValues(renamedBackupData[section], slotMapping);
  }
      let itemsAddedTotal = 0;
      for (const [key, valuesToAdd] of Object.entries(remappedSection)) {
        if (!(key in configData[section])) configData[section][key] = [];
        if (!Array.isArray(configData[section][key])) {
          configData[section][key] = configData[section][key] ? [configData[section][key]] : [];
        }
        let itemsAddedThisKey = 0;
        if (Array.isArray(valuesToAdd)) {
          for (const item of valuesToAdd) {
            if (!configData[section][key].includes(item)) {
              configData[section][key].push(item);
              itemsAddedThisKey++;
            }
          }
        } else if (valuesToAdd && !configData[section][key].includes(valuesToAdd)) {
          configData[section][key].push(valuesToAdd);
          itemsAddedThisKey++;
        }
        itemsAddedTotal += itemsAddedThisKey;
      }
      if (event && itemsAddedTotal > 0) {
        event.sender.send('debug-message', `[DEBUG] Merged ${itemsAddedTotal} items into ${section}`);
      }
    }
  }

  if (event) {
    event.sender.send('debug-message', `[DEBUG] Finished merging config data for ${baseSlot} -> ${targetSlot}`);
  }

  // Note: Merging is already done above in the specific section handlers
  // No need for a final overwrite as it would destroy the merged data
  if (event) {
    event.sender.send('debug-message', `[DEBUG] Skipping final overwrite to preserve merged data`);
  }

  // --- FINAL FIX: Replace all TEMP_ markers with the final slot name ---
  function replaceTempMarkers(obj, tempSlot, finalSlot) {
    if (typeof obj === 'string') {
      return obj.replace(new RegExp(`TEMP_${tempSlot}`, 'g'), finalSlot);
    } else if (Array.isArray(obj)) {
      return obj.map(item => replaceTempMarkers(item, tempSlot, finalSlot));
    } else if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        const newKey = key.replace(new RegExp(`TEMP_${tempSlot}`, 'g'), finalSlot);
        result[newKey] = replaceTempMarkers(value, tempSlot, finalSlot);
      }
      return result;
    }
    return obj;
  }

  // Find all TEMP_ markers for this slot and replace with targetSlot
  // The temp markers are in format "TEMP_cXXX", so we need to replace "TEMP_cXXX" with targetSlot
  function replaceTempMarkersGlobal(obj, tempPattern, finalSlot) {
    if (typeof obj === 'string') {
      return obj.replace(new RegExp(tempPattern, 'g'), finalSlot);
    } else if (Array.isArray(obj)) {
      return obj.map(item => replaceTempMarkersGlobal(item, tempPattern, finalSlot));
    } else if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        const newKey = key.replace(new RegExp(tempPattern, 'g'), finalSlot);
        result[newKey] = replaceTempMarkersGlobal(value, tempPattern, finalSlot);
      }
      return result;
    }
    return obj;
  }

  // Replace TEMP_baseSlot with targetSlot throughout the entire config
  const tempPattern = `TEMP_${baseSlot}`;
  for (const section of Object.keys(configData)) {
    configData[section] = replaceTempMarkersGlobal(configData[section], tempPattern, targetSlot);
  }

  // After merging, remove any previously copied target files for share-to-added so sharing takes effect
  try {
    if (renamedBackupData['share-to-added']) {
      for (const [srcKey, targets] of Object.entries(renamedBackupData['share-to-added'])) {
        if (typeof srcKey !== 'string') continue;
        // Only consider entries whose source now belongs to the restored targetSlot
        if (!srcKey.includes(`/${targetSlot}/`) && !srcKey.endsWith(`/${targetSlot}`) && !srcKey.includes(`_${targetSlot}.`)) continue;
        if (!Array.isArray(targets)) continue;
        for (const t of targets) {
          if (typeof t !== 'string') continue;
          const absTarget = path.join(modRoot, ...t.replace(/\\/g, '/').split('/'));
          if (fs.existsSync(absTarget)) {
            try {
              fs.unlinkSync(absTarget);
              if (event) event.sender.send('debug-message', `[DEBUG] Removed copied share target so mapping applies: ${absTarget}`);
            } catch (delErr) {
              if (event) event.sender.send('debug-message', `[DEBUG] Failed to remove copied share target ${absTarget}: ${delErr.message}`);
            }
          }
        }
      }
    }
  } catch (cleanupErr) {
    if (event) event.sender.send('debug-message', `[DEBUG] Error cleaning copied share targets: ${cleanupErr.message}`);
  }

  // NEW: Move disabled share-to-added entries to the disabled config
  if (renamedBackupData['_disabled_share_to_added'] && Object.keys(renamedBackupData['_disabled_share_to_added']).length > 0) {
    try {
      // Find the disabled config file for the target slot
      const disabledDir = path.join(modRoot, '.disabled');
      if (fs.existsSync(disabledDir)) {
        const disabledFolders = fs.readdirSync(disabledDir, { withFileTypes: true })
          .filter(entry => entry.isDirectory() && entry.name.startsWith(`${targetSlot}_`))
          .map(entry => entry.name);
        
        if (disabledFolders.length > 0) {
          const disabledFolder = disabledFolders[0]; // Use the first matching folder
          const disabledConfigPath = path.join(disabledDir, disabledFolder, `${targetSlot}_config.json`);
          
          if (fs.existsSync(disabledConfigPath)) {
            const disabledConfig = JSON.parse(fs.readFileSync(disabledConfigPath, 'utf8'));
            
            // Initialize share-to-added section if it doesn't exist
            if (!disabledConfig['share-to-added']) {
              disabledConfig['share-to-added'] = {};
            }
            
            // Add the disabled share-to-added entries
            for (const [source, targets] of Object.entries(renamedBackupData['_disabled_share_to_added'])) {
              disabledConfig['share-to-added'][source] = targets;
            }
            
            // Write the updated disabled config
            writeJsonPreserve(disabledConfigPath, disabledConfig);

            // Physically copy shared sources from the disabled slot into active targets
            try {
              const disabledFolderPath = path.join(disabledDir, disabledFolder);
              for (const [source, targets] of Object.entries(renamedBackupData['_disabled_share_to_added'])) {
                if (typeof source !== 'string' || !Array.isArray(targets)) continue;
                // Source path lives under the disabled folder
                const srcRel = source.replace(/^fighter\//, '').replace(/\\/g, '/');
                const absSrc = path.join(disabledFolderPath, ...srcRel.split('/'));
                for (const target of targets) {
                  if (typeof target !== 'string') continue;
                  const tgtRel = target.replace(/^fighter\//, '').replace(/\\/g, '/');
                  const absTgt = path.join(modRoot, ...tgtRel.split('/'));
                  try {
                    fs.mkdirSync(path.dirname(absTgt), { recursive: true });
                    if (!fs.existsSync(absTgt) && fs.existsSync(absSrc)) {
                      fs.copyFileSync(absSrc, absTgt);
                      if (event) event.sender.send('debug-message', `[DEBUG] Copied disabled share source to active target: ${absSrc} -> ${absTgt}`);
                    }
                  } catch (copyErr) {
                    if (event) event.sender.send('debug-message', `[DEBUG] Failed to copy disabled share source: ${absSrc} -> ${absTgt}: ${copyErr.message}`);
                  }
                }
              }
            } catch (physErr) {
              if (event) event.sender.send('debug-message', `[DEBUG] Error during physical copy of disabled share sources: ${physErr.message}`);
            }
            
            if (event) {
              event.sender.send('debug-message', `[DEBUG] Added ${Object.keys(renamedBackupData['_disabled_share_to_added']).length} share-to-added entries to disabled config: ${disabledConfigPath}`);
            }
          } else {
            if (event) {
              event.sender.send('debug-message', `[DEBUG] Disabled config file not found: ${disabledConfigPath}`);
            }
          }
        } else {
          if (event) {
            event.sender.send('debug-message', `[DEBUG] No disabled folder found for ${targetSlot}`);
          }
        }
      }
    } catch (disabledConfigError) {
      if (event) {
        event.sender.send('debug-message', `[DEBUG] Error updating disabled config: ${disabledConfigError.message}`);
      }
    }
  }
}

function extractSlotConfig(slot, configData) {
  const backupData = {};
  // Helper to check slot matches with path-aware rules
  function pathMatchesSlot(text) {
    if (typeof text !== 'string') return false;
    const normalized = text.replace(/\\/g, '/');
    const esc = slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (
      new RegExp(`/` + esc + `/`).test(normalized) || // /cXXX/
      new RegExp(`/${esc}$`).test(normalized) ||      // end with /cXXX
      new RegExp(`_${esc}\\.`).test(normalized)     // _cXXX.
    );
  }
  
  // Extract relevant config sections for this slot
  const sections = ['new-dir-infos', 'new-dir-infos-base', 'new-dir-files', 'share-to-vanilla', 'share-to-added'];
  
  for (const section of sections) {
    if (configData[section]) {
      // Handle array sections differently from object sections
      if (Array.isArray(configData[section])) {
        // For array sections like new-dir-infos
        const slotSpecificEntries = configData[section].filter(item => pathMatchesSlot(item));
        
        if (slotSpecificEntries.length > 0) {
          // Replace slot references with disabled_c## format
          const disabledEntries = slotSpecificEntries.map(item => 
            item.replace(new RegExp(`${slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), `disabled_${slot}`)
          );
          backupData[section] = disabledEntries;
        }
      } else {
        // For object sections like new-dir-infos-base, share-to-vanilla, etc.
      backupData[section] = {};
      
      for (const [key, value] of Object.entries(configData[section])) {
        // Check if the key itself contains the slot
        if (pathMatchesSlot(key)) {
          // Replace slot references with disabled_c## format
          const disabledKey = key.replace(new RegExp(`${slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), `disabled_${slot}`);
          
          // If the value is an array, convert array entries to disabled_c## format
          if (Array.isArray(value)) {
            const disabledEntries = value.map(item => 
              item.replace(new RegExp(`${slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), `disabled_${slot}`)
            );
            backupData[section][disabledKey] = disabledEntries;
          } else {
            backupData[section][disabledKey] = value;
          }
          continue;
        }
        
        // For array values, only include entries that specifically match this slot
        if (Array.isArray(value)) {
          const slotSpecificEntries = value.filter(item => pathMatchesSlot(item));
          
          if (slotSpecificEntries.length > 0) {
            // Replace slot references in array entries with disabled_c## format
            const disabledEntries = slotSpecificEntries.map(item => 
              item.replace(new RegExp(`${slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), `disabled_${slot}`)
            );
            // Also convert the key to disabled_c## format
            const disabledKey = key.replace(new RegExp(`${slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), `disabled_${slot}`);
            backupData[section][disabledKey] = disabledEntries;
          }
          }
        }
      }
    }
  }
  
  return backupData;
}

function removeSlotFromConfig(slot, configData) {
  console.log(`[DEBUG] removeSlotFromConfig called for slot: ${slot}`);
  console.log(`[DEBUG] Config before removal: ${JSON.stringify(configData['new-dir-files'])}`);
  const sections = ['new-dir-infos', 'new-dir-infos-base', 'new-dir-files', 'share-to-vanilla', 'share-to-added'];
  // Path-aware matcher to avoid over-deleting
  function pathMatchesSlot(text) {
    if (typeof text !== 'string') return false;
    const normalized = text.replace(/\\/g, '/');
    const esc = slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (
      new RegExp(`/` + esc + `/`).test(normalized) ||
      new RegExp(`/${esc}$`).test(normalized) ||
      new RegExp(`_${esc}\\.`).test(normalized)
    );
  }
  
  for (const section of sections) {
    if (configData[section]) {
      console.log(`[DEBUG] Processing section: ${section}`);
      
      if (Array.isArray(configData[section])) {
         // Handle array sections like new-dir-infos
         console.log(`[DEBUG] Processing array section: ${section}`);
        const originalLength = configData[section].length;
        configData[section] = configData[section].filter(item => !pathMatchesSlot(item));
        const removedCount = originalLength - configData[section].length;
        console.log(`[DEBUG] Removed ${removedCount} entries from array section ${section}`);
      } else {
        // Handle object sections like new-dir-infos-base, share-to-vanilla
      const keysToRemove = [];
      
      for (const [key, value] of Object.entries(configData[section])) {
          console.log(`[DEBUG] Checking key: ${key} for slot: ${slot}`);
        // Check if the key itself contains the slot
        if (pathMatchesSlot(key)) {
            console.log(`[DEBUG] Found matching key: ${key}`);
          keysToRemove.push(key);
          continue;
        }
        
        // For array values, only remove entries that specifically match this slot
        if (Array.isArray(value)) {
           console.log(`[DEBUG] Checking array values for slot: ${slot}`);
           console.log(`[DEBUG] Array values: ${JSON.stringify(value)}`);
          const filteredValue = value.filter(item => !pathMatchesSlot(item));
          
          if (filteredValue.length !== value.length) {
              console.log(`[DEBUG] Found ${value.length - filteredValue.length} entries to remove from array`);
            // Some entries were removed, update the array
            if (filteredValue.length === 0) {
              // All entries for this slot were removed, remove the entire key
              keysToRemove.push(key);
            } else {
              // Update the array with remaining entries
              configData[section][key] = filteredValue;
            }
          }
        }
      }
      
      for (const key of keysToRemove) {
          console.log(`[DEBUG] Removing key from ${section}: ${key}`);
        delete configData[section][key];
        }
      }
    }
  }
}

async function restoreSlotConfig(baseSlot, disabledFolderPath, targetSlot, configData, event) {
  console.log(`[DEBUG] Restoring config for ${baseSlot} -> ${targetSlot}`);
  event.sender.send('debug-message', `[DEBUG] Restoring config for ${baseSlot} -> ${targetSlot}`);
  
  // Find backup config file - try both naming conventions
  let backupConfigPath = path.join(disabledFolderPath, 'config_backup.json');
  let backupData = null;
  
  if (!fs.existsSync(backupConfigPath)) {
    // Try alternate naming convention: c121_config.json
    backupConfigPath = path.join(disabledFolderPath, `${baseSlot}_config.json`);
    if (!fs.existsSync(backupConfigPath)) {
      console.log(`[DEBUG] No backup config found for ${baseSlot} at: ${disabledFolderPath}`);
      event.sender.send('debug-message', `[DEBUG] No backup config found for ${baseSlot} at: ${disabledFolderPath}`);
      console.log(`[DEBUG] WARNING: Restored slot ${targetSlot} has no config backup - slot may not function correctly`);
      event.sender.send('debug-message', `[DEBUG] WARNING: Restored slot ${targetSlot} has no config backup - slot may not function correctly`);
      // Don't return - we'll continue without config restoration, which will at least preserve the physical files
      // The user can run analysis to detect and add the files to config
    return;
  }
  }
  
  console.log(`[DEBUG] Loading backup config from: ${backupConfigPath}`);
  event.sender.send('debug-message', `[DEBUG] Loading backup config from: ${backupConfigPath}`);
  
  try {
    backupData = JSON.parse(fs.readFileSync(backupConfigPath, 'utf8'));
    
    // Helper to convert from disabled format to target format
    const convertFromDisabledFormat = (str) => {
      if (typeof str !== 'string') return str;
      return str.replace(new RegExp(`/disabled_${baseSlot}/`, 'g'), `/${targetSlot}/`)
                .replace(new RegExp(`/disabled_${baseSlot}$`, 'g'), `/${targetSlot}`)
                .replace(new RegExp(`^disabled_${baseSlot}/`, 'g'), `${targetSlot}/`)
                .replace(new RegExp(`^disabled_${baseSlot}$`, 'g'), `${targetSlot}`)
                .replace(new RegExp(`_disabled_${baseSlot}\\.`, 'g'), `_${targetSlot}.`)  // Handle effect filenames with disabled_ prefix
                .replace(new RegExp(`_${baseSlot}\\.`, 'g'), `_${targetSlot}.`);  // Handle effect filenames like ef_wolf_c122.eff -> ef_wolf_c123.eff
    };
    
    // Convert all paths from disabled format to target format
    if (backupData['new-dir-infos'] && Array.isArray(backupData['new-dir-infos'])) {
      backupData['new-dir-infos'] = backupData['new-dir-infos'].map(convertFromDisabledFormat);
    }
    
    if (backupData['new-dir-infos-base'] && typeof backupData['new-dir-infos-base'] === 'object') {
      const convertedBase = {};
      for (const [key, value] of Object.entries(backupData['new-dir-infos-base'])) {
        const convertedKey = convertFromDisabledFormat(key);
        convertedBase[convertedKey] = convertFromDisabledFormat(value);
      }
      backupData['new-dir-infos-base'] = convertedBase;
    }
    
    if (backupData['new-dir-files'] && typeof backupData['new-dir-files'] === 'object') {
      const convertedFiles = {};
      for (const [key, value] of Object.entries(backupData['new-dir-files'])) {
        const convertedKey = convertFromDisabledFormat(key);
        const convertedValue = Array.isArray(value) ? value.map(convertFromDisabledFormat) : convertFromDisabledFormat(value);
        convertedFiles[convertedKey] = convertedValue;
      }
      backupData['new-dir-files'] = convertedFiles;
    }
    
    if (backupData['share-to-added'] && typeof backupData['share-to-added'] === 'object') {
      const convertedShareToAdded = {};
      for (const [source, targets] of Object.entries(backupData['share-to-added'])) {
        const convertedSource = convertFromDisabledFormat(source);
        const targetArray = Array.isArray(targets) ? targets : [targets];
        const convertedTargets = targetArray.map(convertFromDisabledFormat);
        convertedShareToAdded[convertedSource] = convertedTargets;
      }
      backupData['share-to-added'] = convertedShareToAdded;
    }
    
    if (backupData['share-to-vanilla'] && typeof backupData['share-to-vanilla'] === 'object') {
      const convertedShareToVanilla = {};
      for (const [source, targets] of Object.entries(backupData['share-to-vanilla'])) {
        const convertedSource = convertFromDisabledFormat(source);
        convertedShareToVanilla[convertedSource] = targets;
      }
      backupData['share-to-vanilla'] = convertedShareToVanilla;
    }
    
    // Create complete slot mapping for cascading shifts
    // When restoring disabled_c121 to c124 (between c123 and c124), we need to shift c124->c125, c125->c126, etc.
    const slotMapping = {};
    const baseSlotNum = parseInt(baseSlot.substring(1));
    const targetSlotNum = parseInt(targetSlot.substring(1));
    
    // Find the highest existing slot number in the main config
    let maxSlotNum = targetSlotNum;
    if (configData['new-dir-infos'] && Array.isArray(configData['new-dir-infos'])) {
      for (const entry of configData['new-dir-infos']) {
        const match = entry.match(/\/c(\d+)(?:\/|$)/);
        if (match) {
          const slotNum = parseInt(match[1]);
          if (slotNum > maxSlotNum) {
            maxSlotNum = slotNum;
          }
        }
      }
    }
    
    // Map the restored slot
    slotMapping[baseSlot] = targetSlot;
    
    // Shift all existing slots that come AFTER the target position up by 1
    // Example: if disabled_c121 is placed at c124, then c124->c125, c125->c126, etc.
    for (let i = targetSlotNum; i <= maxSlotNum; i++) {
      const currentSlot = `c${i}`;
      const newSlot = `c${i + 1}`;
      slotMapping[currentSlot] = newSlot;
    }
    
    console.log(`[DEBUG] Slot mapping calculated for context: ${JSON.stringify(slotMapping)}`);
    event.sender.send('debug-message', `[DEBUG] Slot mapping calculated for context: ${JSON.stringify(slotMapping)}`);
    
    // NOTE: We do NOT apply slot reordering to backupData here!
    // The convertFromDisabledFormat already put entries in the correct target position (c122).
    // The slotMapping (c122->c123, etc.) will be applied to the MAIN config during the shift phase,
    // not to the restored backup data which is already at its final position.
    
    // Merge backup data into main config
    const sections = ['new-dir-infos', 'new-dir-infos-base', 'new-dir-files', 'share-to-vanilla', 'share-to-added'];
    
    for (const section of sections) {
      if (backupData[section]) {
        if (!configData[section]) {
          configData[section] = section === 'new-dir-infos' ? [] : {};
        }
        
        if (section === 'new-dir-infos' && Array.isArray(backupData[section])) {
          // Merge arrays
          for (const item of backupData[section]) {
            if (!configData[section].includes(item)) {
              configData[section].push(item);
            }
          }
        } else if (typeof backupData[section] === 'object') {
          // Merge objects
          for (const [key, value] of Object.entries(backupData[section])) {
            if (Array.isArray(value)) {
              if (!configData[section][key]) {
                configData[section][key] = [];
              }
              for (const item of value) {
                if (!configData[section][key].includes(item)) {
                  configData[section][key].push(item);
                }
              }
            } else {
              configData[section][key] = value;
            }
          }
        }
      }
    }
    
    console.log(`[DEBUG] Successfully restored and merged config for ${baseSlot} -> ${targetSlot}`);
    event.sender.send('debug-message', `[DEBUG] Successfully restored and merged config for ${baseSlot} -> ${targetSlot}`);
    
  } catch (error) {
    console.log(`[DEBUG] Error restoring config for ${baseSlot}: ${error.message}`);
    event.sender.send('debug-message', `[DEBUG] Error restoring config for ${baseSlot}: ${error.message}`);
  }
}

async function restoreSlotFiles(modRoot, disabledFolderPath, originalSlot, targetSlot, fighterCodename, event, baseSlotNum) {
  console.log(`[DEBUG] Restoring files for ${originalSlot} -> ${targetSlot}`);
  event.sender.send('debug-message', `[DEBUG] Restoring files for ${originalSlot} -> ${targetSlot}`);
  
  // Restore fighter files
  const disabledFighterPath = path.join(disabledFolderPath, 'fighter', fighterCodename, 'model', 'body', originalSlot);
  console.log(`[DEBUG] Checking disabled fighter path: ${disabledFighterPath}`);
  event.sender.send('debug-message', `[DEBUG] Checking disabled fighter path: ${disabledFighterPath}`);
  console.log(`[DEBUG] Disabled fighter path exists: ${fs.existsSync(disabledFighterPath)}`);
  event.sender.send('debug-message', `[DEBUG] Disabled fighter path exists: ${fs.existsSync(disabledFighterPath)}`);
  
  if (fs.existsSync(disabledFighterPath)) {
    const targetFighterPath = path.join(modRoot, 'fighter', fighterCodename, 'model', 'body', targetSlot);
    console.log(`[DEBUG] Target fighter path: ${targetFighterPath}`);
    event.sender.send('debug-message', `[DEBUG] Target fighter path: ${targetFighterPath}`);
    fs.mkdirSync(path.dirname(targetFighterPath), { recursive: true });
    
    // Copy files instead of rename to avoid EBUSY errors
    const copyDirectory = (src, dest) => {
      if (fs.existsSync(src)) {
        if (fs.statSync(src).isDirectory()) {
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
          }
          const files = fs.readdirSync(src);
          console.log(`[DEBUG] Copying ${files.length} files from ${src} to ${dest}`);
          event.sender.send('debug-message', `[DEBUG] Copying ${files.length} files from ${src} to ${dest}`);
          for (const file of files) {
            const srcPath = path.join(src, file);
            const destPath = path.join(dest, file);
            if (fs.statSync(srcPath).isDirectory()) {
              copyDirectory(srcPath, destPath);
            } else {
              fs.copyFileSync(srcPath, destPath);
              console.log(`[DEBUG] Copied file: ${file}`);
              event.sender.send('debug-message', `[DEBUG] Copied file: ${file}`);
            }
          }
        }
      }
    };
    
    copyDirectory(disabledFighterPath, targetFighterPath);
    console.log(`[DEBUG] Restored fighter files: ${originalSlot} -> ${targetSlot}`);
    event.sender.send('debug-message', `[DEBUG] Restored fighter files: ${originalSlot} -> ${targetSlot}`);
  } else {
    console.log(`[DEBUG] Disabled fighter path not found: ${disabledFighterPath}`);
    event.sender.send('debug-message', `[DEBUG] Disabled fighter path not found: ${disabledFighterPath}`);
  }
  
  // Restore model subfolders (blaster, reticle, etc.)
  const disabledModelPath = path.join(disabledFolderPath, 'fighter', fighterCodename, 'model');
  if (fs.existsSync(disabledModelPath)) {
    const modelSubfolders = fs.readdirSync(disabledModelPath, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== 'body').map(d => d.name);
    
    for (const subfolder of modelSubfolders) {
      const disabledSubPath = path.join(disabledModelPath, subfolder, originalSlot);
      if (fs.existsSync(disabledSubPath)) {
        const targetSubPath = path.join(modRoot, 'fighter', fighterCodename, 'model', subfolder, targetSlot);
        fs.mkdirSync(path.dirname(targetSubPath), { recursive: true });
        fs.cpSync(disabledSubPath, targetSubPath, { recursive: true });
        event.sender.send('debug-message', `[DEBUG] Restored model/${subfolder}: ${originalSlot} -> ${targetSlot}`);
      }
    }
  }
  
  // Restore motion files
  const disabledMotionPath = path.join(disabledFolderPath, 'fighter', fighterCodename, 'motion', originalSlot);
  if (fs.existsSync(disabledMotionPath)) {
    const targetMotionPath = path.join(modRoot, 'fighter', fighterCodename, 'motion', targetSlot);
    fs.mkdirSync(path.dirname(targetMotionPath), { recursive: true });
    fs.cpSync(disabledMotionPath, targetMotionPath, { recursive: true });
    event.sender.send('debug-message', `[DEBUG] Restored motion: ${originalSlot} -> ${targetSlot}`);
  }
  
  // Restore camera files
  const disabledCameraPath = path.join(disabledFolderPath, 'camera', 'fighter', fighterCodename, originalSlot);
  console.log(`[DEBUG] Checking disabled camera path: ${disabledCameraPath}`);
  event.sender.send('debug-message', `[DEBUG] Checking disabled camera path: ${disabledCameraPath}`);
  console.log(`[DEBUG] Disabled camera path exists: ${fs.existsSync(disabledCameraPath)}`);
  event.sender.send('debug-message', `[DEBUG] Disabled camera path exists: ${fs.existsSync(disabledCameraPath)}`);
  
  if (fs.existsSync(disabledCameraPath)) {
    const targetCameraPath = path.join(modRoot, 'camera', 'fighter', fighterCodename, targetSlot);
    console.log(`[DEBUG] Target camera path: ${targetCameraPath}`);
    event.sender.send('debug-message', `[DEBUG] Target camera path: ${targetCameraPath}`);
    fs.mkdirSync(path.dirname(targetCameraPath), { recursive: true });
    
    // Copy files instead of rename to avoid EBUSY errors
    const copyDirectory = (src, dest) => {
      if (fs.existsSync(src)) {
        if (fs.statSync(src).isDirectory()) {
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
          }
          const files = fs.readdirSync(src);
          console.log(`[DEBUG] Copying ${files.length} files from ${src} to ${dest}`);
          event.sender.send('debug-message', `[DEBUG] Copying ${files.length} files from ${src} to ${dest}`);
          for (const file of files) {
            const srcPath = path.join(src, file);
            const destPath = path.join(dest, file);
            if (fs.statSync(srcPath).isDirectory()) {
              copyDirectory(srcPath, destPath);
            } else {
              fs.copyFileSync(srcPath, destPath);
              console.log(`[DEBUG] Copied file: ${file}`);
              event.sender.send('debug-message', `[DEBUG] Copied file: ${file}`);
            }
          }
        }
      }
    };
    
    copyDirectory(disabledCameraPath, targetCameraPath);
    console.log(`[DEBUG] Restored camera files: ${originalSlot} -> ${targetSlot}`);
    event.sender.send('debug-message', `[DEBUG] Restored camera files: ${originalSlot} -> ${targetSlot}`);
  } else {
    console.log(`[DEBUG] Disabled camera path not found: ${disabledCameraPath}`);
    event.sender.send('debug-message', `[DEBUG] Disabled camera path not found: ${disabledCameraPath}`);
  }
  
  // Restore effect files
  const disabledEffectPath = path.join(disabledFolderPath, 'effect', 'fighter', fighterCodename);
  console.log(`[DEBUG] Checking disabled effect path: ${disabledEffectPath}`);
  event.sender.send('debug-message', `[DEBUG] Checking disabled effect path: ${disabledEffectPath}`);
  
  if (fs.existsSync(disabledEffectPath)) {
    const targetEffectPath = path.join(modRoot, 'effect', 'fighter', fighterCodename);
    fs.mkdirSync(targetEffectPath, { recursive: true });
    
    // Look for effect files with disabled_ prefix or original slot number
    const effectFiles = fs.readdirSync(disabledEffectPath);
    for (const file of effectFiles) {
      // Match patterns: ef_FIGHTER_disabled_cXXX.eff or ef_FIGHTER_cXXX.eff
      const disabledMatch = file.match(/^(ef_[^_]+)_disabled_c\d+\.eff$/);
      const regularMatch = file.match(/^(ef_[^_]+)_c\d+\.eff$/);
      
      if (disabledMatch || regularMatch) {
        const prefix = disabledMatch ? disabledMatch[1] : regularMatch[1];
        const newFileName = `${prefix}_${targetSlot}.eff`;
        const sourcePath = path.join(disabledEffectPath, file);
        const targetPath = path.join(targetEffectPath, newFileName);
        
        fs.copyFileSync(sourcePath, targetPath);
        console.log(`[DEBUG] Restored effect file: ${file} -> ${newFileName}`);
        event.sender.send('debug-message', `[DEBUG] Restored effect file: ${file} -> ${newFileName}`);
      }
    }
  } else {
    console.log(`[DEBUG] Disabled effect path not found: ${disabledEffectPath}`);
    event.sender.send('debug-message', `[DEBUG] Disabled effect path not found: ${disabledEffectPath}`);
  }
  
  // Restore UI files
  const disabledUIPath = path.join(disabledFolderPath, 'ui', 'replace', 'chara');
  if (fs.existsSync(disabledUIPath)) {
    const targetUIPath = path.join(modRoot, 'ui', 'replace', 'chara');
    fs.mkdirSync(targetUIPath, { recursive: true });
    
    // Calculate alt numbers
    const originalAltNum = parseInt(originalSlot.substring(1)) - baseSlotNum;
    const targetAltNum = parseInt(targetSlot.substring(1)) - baseSlotNum;
    
    // Find display fighter name by examining UI files in the disabled folder
    let displayFighterName = null;
    
    // Scan chara folders in disabled UI path to find the actual display name
    for (let charaNum = 0; charaNum < 20; charaNum++) {
      const charaFolder = `chara_${charaNum}`;
      const disabledCharaPath = path.join(disabledUIPath, charaFolder);
      
      if (fs.existsSync(disabledCharaPath)) {
        const files = fs.readdirSync(disabledCharaPath);
        for (const file of files) {
          // Match pattern: chara_X_DISPLAYNAME_YY.bntx
          const match = file.match(/chara_\d+_([^_]+)_\d{2}\.bntx$/);
          if (match) {
            displayFighterName = match[1];
            console.log(`[DEBUG] Detected display fighter name from UI file: ${displayFighterName}`);
            event.sender.send('debug-message', `[DEBUG] Detected display fighter name from UI file: ${displayFighterName}`);
            break;
          }
        }
        if (displayFighterName) break;
      }
    }
    
    // Fallback to config if not found in UI files
    if (!displayFighterName) {
    const configPath = path.join(modRoot, 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          // Try to extract display name from a UI path in config
        if (configData['new-dir-infos'] && configData['new-dir-infos'].length > 0) {
            for (const dirPath of configData['new-dir-infos']) {
              const uiMatch = dirPath.match(/ui\/replace\/chara\/chara_\d+\/chara_\d+_([^_]+)_\d{2}\.bntx$/);
              if (uiMatch) {
                displayFighterName = uiMatch[1];
                break;
              }
          }
        }
      } catch (error) {
        console.log(`[DEBUG] Error reading config for display name: ${error.message}`);
        }
      }
      
      // Final fallback
      if (!displayFighterName) {
        displayFighterName = fighterCodename; // Use codename as last resort
        console.log(`[DEBUG] Using fighter codename as display name fallback: ${displayFighterName}`);
        event.sender.send('debug-message', `[DEBUG] Using fighter codename as display name fallback: ${displayFighterName}`);
      }
    }
    
    const originalPrefix = `${displayFighterName}_${originalAltNum.toString().padStart(2, '0')}`;
    const targetPrefix = `${displayFighterName}_${targetAltNum.toString().padStart(2, '0')}`;
    
    console.log(`[DEBUG] UI prefix mapping: ${originalPrefix} -> ${targetPrefix}`);
    event.sender.send('debug-message', `[DEBUG] UI prefix mapping: ${originalPrefix} -> ${targetPrefix}`);
    
    // Copy UI files with renamed prefixes
    for (let charaNum = 0; charaNum < 20; charaNum++) {
      const charaFolder = `chara_${charaNum}`;
      const disabledCharaPath = path.join(disabledUIPath, charaFolder);
      
      if (fs.existsSync(disabledCharaPath)) {
        const targetCharaPath = path.join(targetUIPath, charaFolder);
        fs.mkdirSync(targetCharaPath, { recursive: true });
        
        const files = fs.readdirSync(disabledCharaPath);
        for (const file of files) {
          if (file.includes(originalPrefix)) {
            const newFileName = file.replace(originalPrefix, targetPrefix);
            const sourceFile = path.join(disabledCharaPath, file);
            const targetFile = path.join(targetCharaPath, newFileName);
            
            fs.copyFileSync(sourceFile, targetFile);
            console.log(`[DEBUG] Restored UI file: ${file} -> ${newFileName}`);
            event.sender.send('debug-message', `[DEBUG] Restored UI file: ${file} -> ${newFileName}`);
          }
        }
      }
    }
  }
  
  // Restore sound files
  const disabledSoundPath = path.join(disabledFolderPath, 'sound', 'bank', 'fighter_voice');
  if (fs.existsSync(disabledSoundPath)) {
    const targetSoundPath = path.join(modRoot, 'sound', 'bank', 'fighter_voice');
    fs.mkdirSync(targetSoundPath, { recursive: true });
    
    const files = fs.readdirSync(disabledSoundPath);
    for (const file of files) {
      // Check for disabled_cXXX pattern (e.g., vc_ganon_disabled_c118.nus3audio)
      if (file.includes(`_disabled_${originalSlot}.`)) {
        // Remove disabled_ prefix and replace with target slot (e.g., _disabled_c118. -> _c106.)
        const newFileName = file.replace(`_disabled_${originalSlot}.`, `_${targetSlot}.`);
        const sourceFile = path.join(disabledSoundPath, file);
        const targetFile = path.join(targetSoundPath, newFileName);
        
        fs.copyFileSync(sourceFile, targetFile);
        console.log(`[DEBUG] Restored sound file: ${file} -> ${newFileName}`);
        event.sender.send('debug-message', `[DEBUG] Restored sound file: ${file} -> ${newFileName}`);
      } else if (file.includes(`_${originalSlot}.`)) {
        // Fallback for old naming convention
        const newFileName = file.replace(`_${originalSlot}.`, `_${targetSlot}.`);
        const sourceFile = path.join(disabledSoundPath, file);
        const targetFile = path.join(targetSoundPath, newFileName);
        
        fs.copyFileSync(sourceFile, targetFile);
        console.log(`[DEBUG] Restored sound file: ${file} -> ${newFileName}`);
        event.sender.send('debug-message', `[DEBUG] Restored sound file: ${file} -> ${newFileName}`);
      }
    }
  }
}

function moveSlotFiles(modRoot, slot, disabledFolder, baseSlotNum, fighterCodename, configData, activeSlots, event) {
  if (event) {
    event.sender.send('debug-message', `[DEBUG] Moving ALL files for slot ${slot} to disabled folder: ${disabledFolder}`);
  }
  
  // Move fighter model/body files
  const fighterDir = path.join(modRoot, 'fighter');
  if (fs.existsSync(fighterDir) && fighterCodename) {
    // Use the correct nested path structure: fighter/ganon/model/body/c105
    const slotDir = path.join(fighterDir, fighterCodename, 'model', 'body', slot);
    if (fs.existsSync(slotDir)) {
      const disabledSlotDir = path.join(disabledFolder, 'fighter', fighterCodename, 'model', 'body', slot);
      fs.mkdirSync(path.dirname(disabledSlotDir), { recursive: true });
      fs.renameSync(slotDir, disabledSlotDir);
      if (event) {
        event.sender.send('debug-message', `[DEBUG] Moved fighter/model/body: ${slot} -> disabled`);
      }
    }
    
    // Move other model subfolders (blaster, reticle, etc.)
    const modelPath = path.join(fighterDir, fighterCodename, 'model');
    if (fs.existsSync(modelPath)) {
      const modelSubfolders = fs.readdirSync(modelPath, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name !== 'body').map(d => d.name);
      for (const subfolder of modelSubfolders) {
        const subSlotDir = path.join(modelPath, subfolder, slot);
        if (fs.existsSync(subSlotDir)) {
          const disabledSubDir = path.join(disabledFolder, 'fighter', fighterCodename, 'model', subfolder, slot);
          fs.mkdirSync(path.dirname(disabledSubDir), { recursive: true });
          fs.renameSync(subSlotDir, disabledSubDir);
          if (event) {
            event.sender.send('debug-message', `[DEBUG] Moved fighter/model/${subfolder}: ${slot} -> disabled`);
          }
        }
      }
    }
    
    // Move motion files
    const motionDir = path.join(fighterDir, fighterCodename, 'motion', slot);
    if (fs.existsSync(motionDir)) {
      const disabledMotionDir = path.join(disabledFolder, 'fighter', fighterCodename, 'motion', slot);
      fs.mkdirSync(path.dirname(disabledMotionDir), { recursive: true });
      fs.renameSync(motionDir, disabledMotionDir);
      if (event) {
        event.sender.send('debug-message', `[DEBUG] Moved fighter/motion: ${slot} -> disabled`);
      }
    }
  }
  
  // Move camera files
  const cameraDir = path.join(modRoot, 'camera');
  if (fs.existsSync(cameraDir) && fighterCodename) {
    // Use the correct nested path structure: camera/fighter/ganon/c105
    const slotDir = path.join(cameraDir, 'fighter', fighterCodename, slot);
    if (fs.existsSync(slotDir)) {
      const disabledSlotDir = path.join(disabledFolder, 'camera', 'fighter', fighterCodename, slot);
      fs.mkdirSync(path.dirname(disabledSlotDir), { recursive: true });
      fs.renameSync(slotDir, disabledSlotDir);
      if (event) {
        event.sender.send('debug-message', `[DEBUG] Moved camera directory: ${slotDir} -> ${disabledSlotDir}`);
      }
    } else {
      if (event) {
        event.sender.send('debug-message', `[DEBUG] Camera directory not found: ${slotDir}`);
      }
    }
  }
  
  // Move sound files - rename to disabled_cXXX format
  // NOTE: Share-to-added copying is now done BEFORE config removal in apply-slot-changes
  const soundDir = path.join(modRoot, 'sound');
  if (fs.existsSync(soundDir)) {
    const soundBankDir = path.join(soundDir, 'bank', 'fighter_voice');
    if (fs.existsSync(soundBankDir)) {
      for (const file of fs.readdirSync(soundBankDir)) {
        // Check if file matches the slot pattern (e.g., vc_ganon_c118.nus3audio)
        if (file.includes(`_${slot}.`)) {
          const sourceFile = path.join(soundBankDir, file);
          
          // Move the file to disabled folder with disabled_ prefix
          const newFileName = file.replace(`_${slot}.`, `_disabled_${slot}.`);
          const disabledFile = path.join(disabledFolder, 'sound', 'bank', 'fighter_voice', newFileName);
          
          fs.mkdirSync(path.dirname(disabledFile), { recursive: true });
          fs.renameSync(sourceFile, disabledFile);
          if (event) {
            event.sender.send('debug-message', `[DEBUG] Moved and renamed sound file: ${file} -> ${newFileName}`);
          }
        }
      }
    }
  }
  
  // Move effect files - rename to disabled_cXXX format
  const effectDir = path.join(modRoot, 'effect');
  if (fs.existsSync(effectDir) && fighterCodename) {
    const effectFighterDir = path.join(effectDir, 'fighter', fighterCodename);
    if (fs.existsSync(effectFighterDir)) {
      // Find and move effect files for this slot (direct files only, no recursion)
      const effectFiles = fs.readdirSync(effectFighterDir);
      for (const file of effectFiles) {
        const fullPath = path.join(effectFighterDir, file);
        
        // Only process files, not directories
        if (fs.statSync(fullPath).isFile() && file.endsWith('.eff') && file.includes(`_${slot}.`)) {
          // Move effect file with disabled_ prefix
          const newFileName = file.replace(`_${slot}.`, `_disabled_${slot}.`);
          const disabledFile = path.join(disabledFolder, 'effect', 'fighter', fighterCodename, newFileName);
          
          fs.mkdirSync(path.dirname(disabledFile), { recursive: true });
          fs.renameSync(fullPath, disabledFile);
          if (event) {
            event.sender.send('debug-message', `[DEBUG] Moved and renamed effect file: ${file} -> ${newFileName}`);
          }
        }
      }
    }
  }
  
  // Move UI files
  const uiDir = path.join(modRoot, 'ui');
  if (fs.existsSync(uiDir)) {
    // Find UI files for this slot using the same logic as detection
    const charaDir = path.join(uiDir, 'replace', 'chara');
    if (fs.existsSync(charaDir)) {
      // Get the alt number for this slot (e.g., c105 -> 1, c106 -> 2, etc.)
      const slotNum = parseInt(slot.substring(1));
      const altNum = slotNum - baseSlotNum;
      if (event) {
        event.sender.send('debug-message', `[DEBUG] Looking for UI files with alt number ${altNum} for slot ${slot}`);
      }
      
      for (const charaFolder of fs.readdirSync(charaDir)) {
        const charaPath = path.join(charaDir, charaFolder);
        if (fs.statSync(charaPath).isDirectory()) {
          if (event) {
            event.sender.send('debug-message', `[DEBUG] Checking chara folder: ${charaFolder}`);
          }
          for (const file of fs.readdirSync(charaPath)) {
            // Look for files with pattern ending in _XX.bntx or _XX.nutexb where XX is the alt number
            // Also check for patterns like brolyz_XX.bntx or other fighter names
            const match = file.toLowerCase().match(/(?:[a-z]+_)?(\d{2})\.(bntx|nutexb)$/);
            if (match) {
              const fileAltNum = parseInt(match[1]);
              if (fileAltNum === altNum) {
                const sourceFile = path.join(charaPath, file);
                const disabledFile = path.join(disabledFolder, 'ui', 'replace', 'chara', charaFolder, file);
                fs.mkdirSync(path.dirname(disabledFile), { recursive: true });
                fs.copyFileSync(sourceFile, disabledFile);
                fs.unlinkSync(sourceFile);
                if (event) {
                  event.sender.send('debug-message', `[DEBUG] Moved UI file: ${file} (alt ${altNum}) to disabled folder`);
                }
              }
            }
          }
        }
      }
    }
  }
  
  if (event) {
    event.sender.send('debug-message', `[DEBUG] Completed moving ALL files for slot ${slot} to disabled folder`);
  }
}

// Materialize shared files before disabling a slot
// This ensures the disabled slot has all its files and doesn't depend on sharing
function materializeSharedFilesBeforeDisable(modRoot, slot, configData, event) {
  event.sender.send('debug-message', `[DEBUG] ===== MATERIALIZING SHARED FILES BEFORE DISABLING ${slot} =====`);
  
  const shareToAdded = configData['share-to-added'] || {};
  const entriesToRemove = [];
  const targetsToRemove = {};
  
  // PART 1: Files shared TO this slot (this slot is a TARGET)
  // We need to copy the source files to this slot
  // NOTE: Skip motion files - they are always shared from base alt and should just be transferred as-is
  event.sender.send('debug-message', `[DEBUG] Part 1: Finding files shared TO ${slot}...`);
  
  for (const [sourcePath, targets] of Object.entries(shareToAdded)) {
    // Skip motion files - they should stay shared from base alt
    if (sourcePath.includes('/motion/')) {
      event.sender.send('debug-message', `[DEBUG] Skipping motion file (always shared from base): ${sourcePath}`);
      continue;
    }
    
    const targetArray = Array.isArray(targets) ? targets : [targets];
    const matchingTargets = targetArray.filter(t => t.includes(`/${slot}/`) || t.includes(`/${slot}`));
    
    if (matchingTargets.length > 0) {
      event.sender.send('debug-message', `[DEBUG] Source ${sourcePath} shares to ${slot}`);
      
      // Copy the source file to each matching target location
      for (const targetPath of matchingTargets) {
        const sourceAbsPath = path.join(modRoot, sourcePath);
        const targetAbsPath = path.join(modRoot, targetPath);
        
        // Check if source exists (could be vanilla c00-c07 which won't exist physically)
        const sourceSlotMatch = sourcePath.match(/\/c(\d+)\//);
        const isVanillaSource = sourceSlotMatch && parseInt(sourceSlotMatch[1]) <= 7;
        
        if (isVanillaSource) {
          // For vanilla sources, we can't materialize - just note it
          event.sender.send('debug-message', `[DEBUG] Skipping vanilla source: ${sourcePath}`);
          continue;
        }
        
        if (fs.existsSync(sourceAbsPath)) {
          // Create directory and copy file
          fs.mkdirSync(path.dirname(targetAbsPath), { recursive: true });
          fs.copyFileSync(sourceAbsPath, targetAbsPath);
          event.sender.send('debug-message', `[DEBUG] Materialized: ${sourcePath} -> ${targetPath}`);
        } else {
          event.sender.send('debug-message', `[DEBUG] Source file not found: ${sourceAbsPath}`);
        }
      }
      
      // Track targets to remove from this source
      if (!targetsToRemove[sourcePath]) targetsToRemove[sourcePath] = [];
      targetsToRemove[sourcePath].push(...matchingTargets);
    }
  }
  
  // PART 2: Files shared FROM this slot (this slot is a SOURCE)
  // We need to copy files to all targets, then remove the source entries
  // NOTE: Skip motion files - they are always shared from base alt and should just be transferred as-is
  event.sender.send('debug-message', `[DEBUG] Part 2: Finding files shared FROM ${slot}...`);
  
  for (const [sourcePath, targets] of Object.entries(shareToAdded)) {
    // Skip motion files - they should stay shared from base alt
    if (sourcePath.includes('/motion/')) {
      event.sender.send('debug-message', `[DEBUG] Skipping motion file (always shared from base): ${sourcePath}`);
      continue;
    }
    
    // Check if source is from this slot
    if (sourcePath.includes(`/${slot}/`) || sourcePath.includes(`/${slot}`)) {
      event.sender.send('debug-message', `[DEBUG] ${slot} is source for: ${sourcePath}`);
      
      const sourceAbsPath = path.join(modRoot, sourcePath);
      const targetArray = Array.isArray(targets) ? targets : [targets];
      
      if (fs.existsSync(sourceAbsPath)) {
        // Copy to all targets
        for (const targetPath of targetArray) {
          const targetAbsPath = path.join(modRoot, targetPath);
          
          if (!fs.existsSync(targetAbsPath)) {
            fs.mkdirSync(path.dirname(targetAbsPath), { recursive: true });
            fs.copyFileSync(sourceAbsPath, targetAbsPath);
            event.sender.send('debug-message', `[DEBUG] Materialized from source: ${sourcePath} -> ${targetPath}`);
          } else {
            event.sender.send('debug-message', `[DEBUG] Target already exists: ${targetPath}`);
          }
        }
      } else {
        event.sender.send('debug-message', `[DEBUG] Source file not found: ${sourceAbsPath}`);
      }
      
      // Mark entire entry for removal
      entriesToRemove.push(sourcePath);
    }
  }
  
  // PART 3: Update config - remove sharing entries
  event.sender.send('debug-message', `[DEBUG] Part 3: Updating config...`);
  
  // Remove entries where this slot was the source
  for (const sourcePath of entriesToRemove) {
    delete configData['share-to-added'][sourcePath];
    event.sender.send('debug-message', `[DEBUG] Removed source entry: ${sourcePath}`);
  }
  
  // Remove targets from entries where this slot was a target
  for (const [sourcePath, targets] of Object.entries(targetsToRemove)) {
    if (configData['share-to-added'][sourcePath]) {
      const currentTargets = Array.isArray(configData['share-to-added'][sourcePath])
        ? configData['share-to-added'][sourcePath]
        : [configData['share-to-added'][sourcePath]];
      
      const remainingTargets = currentTargets.filter(t => !targets.includes(t));
      
      if (remainingTargets.length === 0) {
        delete configData['share-to-added'][sourcePath];
        event.sender.send('debug-message', `[DEBUG] Removed entire entry (no targets left): ${sourcePath}`);
      } else {
        configData['share-to-added'][sourcePath] = remainingTargets;
        event.sender.send('debug-message', `[DEBUG] Updated entry, removed ${targets.length} targets: ${sourcePath}`);
      }
    }
  }
  
  event.sender.send('debug-message', `[DEBUG] ===== MATERIALIZATION COMPLETE FOR ${slot} =====`);
}

function moveFilesFromDisabled(modRoot, disabledFolder, baseSlotNum, fighterCodename) {
  console.log(`[DEBUG] Moving files back from disabled folder: ${disabledFolder}`);
  
  // Move fighter files back
  const disabledFighterDir = path.join(disabledFolder, 'fighter');
  if (fs.existsSync(disabledFighterDir) && fighterCodename) {
    // Check if the disabled folder has the nested structure
    const fighterCodenameDir = path.join(disabledFighterDir, fighterCodename);
    if (fs.existsSync(fighterCodenameDir)) {
      const modelBodyDir = path.join(fighterCodenameDir, 'model', 'body');
      if (fs.existsSync(modelBodyDir)) {
        for (const slotDir of fs.readdirSync(modelBodyDir)) {
          const sourceDir = path.join(modelBodyDir, slotDir);
          const targetDir = path.join(modRoot, 'fighter', fighterCodename, 'model', 'body', slotDir);
          fs.mkdirSync(path.dirname(targetDir), { recursive: true });
          fs.renameSync(sourceDir, targetDir);
          console.log(`[DEBUG] Moved fighter directory back: ${sourceDir} -> ${targetDir}`);
        }
      }
    }
  }
  
  // Move camera files back
  const disabledCameraDir = path.join(disabledFolder, 'camera');
  if (fs.existsSync(disabledCameraDir) && fighterCodename) {
    const disabledFighterDir = path.join(disabledCameraDir, 'fighter');
    if (fs.existsSync(disabledFighterDir)) {
      const fighterCodenameDir = path.join(disabledFighterDir, fighterCodename);
      if (fs.existsSync(fighterCodenameDir)) {
        for (const slotDir of fs.readdirSync(fighterCodenameDir)) {
          const sourceDir = path.join(fighterCodenameDir, slotDir);
          const targetDir = path.join(modRoot, 'camera', 'fighter', fighterCodename, slotDir);
          fs.mkdirSync(path.dirname(targetDir), { recursive: true });
          fs.renameSync(sourceDir, targetDir);
          console.log(`[DEBUG] Moved camera directory back: ${sourceDir} -> ${targetDir}`);
        }
      }
    }
  }
  
  // Move sound files back
  const disabledSoundDir = path.join(disabledFolder, 'sound');
  if (fs.existsSync(disabledSoundDir)) {
    const disabledBankDir = path.join(disabledSoundDir, 'bank', 'fighter_voice');
    if (fs.existsSync(disabledBankDir)) {
      for (const file of fs.readdirSync(disabledBankDir)) {
        const sourceFile = path.join(disabledBankDir, file);
        const targetFile = path.join(modRoot, 'sound', 'bank', 'fighter_voice', file);
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        fs.copyFileSync(sourceFile, targetFile);
        fs.unlinkSync(sourceFile);
        console.log(`[DEBUG] Moved sound file back: ${file}`);
      }
    }
  }
  
  // Move effect files back
  const disabledEffectDir = path.join(disabledFolder, 'effect');
  if (fs.existsSync(disabledEffectDir) && fighterCodename) {
    const effectFighterDir = path.join(disabledEffectDir, 'fighter', fighterCodename);
    if (fs.existsSync(effectFighterDir)) {
      // Restore effect files (direct files only, no recursion)
      const effectFiles = fs.readdirSync(effectFighterDir);
      for (const file of effectFiles) {
        const sourcePath = path.join(effectFighterDir, file);
        
        // Only process files, not directories
        if (fs.statSync(sourcePath).isFile() && file.endsWith('.eff')) {
          const targetPath = path.join(modRoot, 'effect', 'fighter', fighterCodename, file);
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.copyFileSync(sourcePath, targetPath);
          fs.unlinkSync(sourcePath);
          console.log(`[DEBUG] Moved effect file back: ${file}`);
        }
      }
    }
  }
  
  // Move UI files back
  const disabledUiDir = path.join(disabledFolder, 'ui');
  if (fs.existsSync(disabledUiDir)) {
    const charaDir = path.join(disabledUiDir, 'replace', 'chara');
    if (fs.existsSync(charaDir)) {
      for (const charaFolder of fs.readdirSync(charaDir)) {
        const charaPath = path.join(charaDir, charaFolder);
        if (fs.statSync(charaPath).isDirectory()) {
          for (const file of fs.readdirSync(charaPath)) {
            const sourceFile = path.join(charaPath, file);
            const targetFile = path.join(modRoot, 'ui', 'replace', 'chara', charaFolder, file);
            fs.mkdirSync(path.dirname(targetFile), { recursive: true });
            fs.copyFileSync(sourceFile, targetFile);
            fs.unlinkSync(sourceFile);
            console.log(`[DEBUG] Moved UI file back: ${file}`);
          }
        }
      }
    }
  }
  
  console.log(`[DEBUG] Completed moving files back from disabled folder`);
}

function applySlotReordering(configData, slotMapping) {
  console.log(`[DEBUG] Applying slot reordering with mapping: ${JSON.stringify(slotMapping)}`);
  console.log(`[DEBUG] Config before reordering: ${JSON.stringify(configData['new-dir-files'])}`);
  
  if (!slotMapping || Object.keys(slotMapping).length === 0) {
    return;
  }

  // Two-step renaming process to handle swaps/cycles
  const slotsInvolved = new Set([...Object.keys(slotMapping), ...Object.values(slotMapping)]);
  const tempMarkers = {};
  const reverseTempMarkers = {};
  
  // Create temporary markers for all involved slots
  for (const slot of slotsInvolved) {
    const tempMarker = `TEMP_${slot}`;
    tempMarkers[slot] = tempMarker;
    reverseTempMarkers[tempMarker] = slot;
  }

  // Helper function to replace slots in text
  function replaceSlots(text, mapping) {
    let processedText = text;
    
    // Replace longer keys first to avoid partial replacements
    const sortedKeys = Object.keys(mapping).sort((a, b) => b.length - a.length);
    
    for (const slotKey of sortedKeys) {
      const target = mapping[slotKey];
      
      // Determine base slot for UI patterns
      let baseSlotForUI = slotKey;
      if (slotKey.startsWith('TEMP_')) {
        const potentialBase = slotKey.split('TEMP_')[1];
        if (potentialBase.startsWith('c') && potentialBase.length > 1 && /^\d+$/.test(potentialBase.substring(1))) {
          baseSlotForUI = potentialBase;
        } else {
          baseSlotForUI = null;
        }
      } else if (!(slotKey.startsWith('c') && slotKey.length > 1 && /^\d+$/.test(slotKey.substring(1)))) {
        baseSlotForUI = null;
      }

      // Perform replacements (avoid touching disabled_ segments)
      const escKey = slotKey.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const escTarget = target.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      // 1. Directory separators: /cXXX/ -> /target/ but not /disabled_cXXX/
      processedText = processedText.replace(new RegExp(`/(?!disabled_)${escKey}/`, 'g'), `/${escTarget}/`);
      
      // 2. End of path: .../cXXX -> .../target (not .../disabled_cXXX)
      processedText = processedText.replace(new RegExp(`/(?!disabled_)${escKey}$`), `/${escTarget}`);
      
      // 3. Filename separators: _cXXX. -> _target. (for effect files like ef_wolf_c122.eff)
      // Use a callback to manually check the prefix
      processedText = processedText.replace(
        new RegExp(`([/_])([a-z0-9_]+_)?${escKey}\\.`, 'gi'),
        (match, separator, prefix) => {
          // Skip if prefix contains 'disabled' or 'TEMP'
          if (prefix && (prefix.includes('disabled_') || prefix.includes('TEMP_'))) {
            return match;
          }
          // Replace the slot number
          return separator + (prefix || '') + escTarget + '.';
        }
      );
      
      // 4. Handle UI patterns (we'll need to get fighter name and base slot from context)
      // This would need to be implemented with proper fighter detection
    }
    
    return processedText;
  }

  // Step 1: Rename all involved slots to temporary markers
  const step1Map = {};
  for (const slot of slotsInvolved) {
    step1Map[slot] = tempMarkers[slot];
  }

  // Apply step 1 to all config sections
  const sections = ['new-dir-infos', 'new-dir-infos-base', 'new-dir-files', 'share-to-vanilla', 'share-to-added'];
  
  for (const section of sections) {
    if (configData[section]) {
      if (Array.isArray(configData[section])) {
        configData[section] = configData[section].map(path => replaceSlots(path, step1Map));
      } else if (typeof configData[section] === 'object') {
        const tempSection = {};
        for (const [key, value] of Object.entries(configData[section])) {
          const newKey = replaceSlots(key, step1Map);
          if (Array.isArray(value)) {
            tempSection[newKey] = value.map(item => replaceSlots(item, step1Map));
          } else if (typeof value === 'string') {
            tempSection[newKey] = replaceSlots(value, step1Map);
          } else {
            tempSection[newKey] = value;
          }
        }
        configData[section] = tempSection;
      }
    }
  }

  // Step 2: Rename temporary markers to final slots
  const step2Map = {};
  for (const [oldSlot, newSlot] of Object.entries(slotMapping)) {
    step2Map[tempMarkers[oldSlot]] = newSlot;
  }
  // Also map slots that weren't changed to themselves
  for (const slot of slotsInvolved) {
    if (!slotMapping[slot]) {
      step2Map[tempMarkers[slot]] = slot;
    }
  }

  // Apply step 2 to all config sections
  for (const section of sections) {
    if (configData[section]) {
      if (Array.isArray(configData[section])) {
        configData[section] = configData[section].map(path => replaceSlots(path, step2Map));
      } else if (typeof configData[section] === 'object') {
        const tempSection = {};
        for (const [key, value] of Object.entries(configData[section])) {
          const newKey = replaceSlots(key, step2Map);
          if (Array.isArray(value)) {
            tempSection[newKey] = value.map(item => replaceSlots(item, step2Map));
          } else if (typeof value === 'string') {
            tempSection[newKey] = replaceSlots(value, step2Map);
          } else {
            tempSection[newKey] = value;
          }
        }
        configData[section] = tempSection;
      }
    }
  }

  console.log(`[DEBUG] Slot reordering applied successfully`);
  console.log(`[DEBUG] Config after reordering: ${JSON.stringify(configData['new-dir-files'])}`);
}

// Update all disabled backup configs on disk to reflect a slot mapping (cascading shifts or explicit reorders)
async function updateAllDisabledBackupConfigs(modRoot, slotMapping, event, excludeSlots = []) {
  const disabledDir = path.join(modRoot, '.disabled');
  if (!fs.existsSync(disabledDir)) return;
  
  if (event) event.sender.send('debug-message', `[DEBUG] updateAllDisabledBackupConfigs called with mapping: ${JSON.stringify(slotMapping)}, excludeSlots: ${JSON.stringify(excludeSlots)}`);
  
  const entries = fs.readdirSync(disabledDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirName = entry.name; // e.g., c118_1755144962978
    if (!/^c\d+_\d+$/.test(dirName)) continue;
    const slot = dirName.split('_')[0];
    
    if (excludeSlots.includes(slot)) {
      if (event) event.sender.send('debug-message', `[DEBUG] Skipping ${dirName} (slot ${slot} in excludeSlots)`);
      continue; // skip currently-disabled-in-this-run slots
    }
    
    const backupDir = path.join(disabledDir, dirName);
    const configPath = path.join(backupDir, `${slot}_config.json`);
    if (!fs.existsSync(configPath)) continue;
    
    if (event) event.sender.send('debug-message', `[DEBUG] Processing disabled config: ${configPath}`);
    
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      
      // IMPORTANT: Preserve share-to-added BEFORE applying slot reordering
      // so we don't apply the mapping twice (once in applySlotReordering, once manually)
      const originalShareToAdded = data['share-to-added'] ? JSON.parse(JSON.stringify(data['share-to-added'])) : null;
      
      applySlotReordering(data, slotMapping, event);
      
      // IMPORTANT: Update share-to-added TARGETS to track where slots moved to
      // Sources stay as-is (disabled_c118), but targets need to be updated (c105 -> c106)
      // Use the ORIGINAL share-to-added (before applySlotReordering modified it)
      if (originalShareToAdded && typeof originalShareToAdded === 'object') {
        const updatedShareToAdded = {};
        for (const [source, targets] of Object.entries(originalShareToAdded)) {
          const targetList = Array.isArray(targets) ? targets : [targets];
          const updatedTargets = targetList.map(target => {
            let updatedTarget = target;
            
            // Use temp placeholders to avoid cascading replacements
            // Step 1: Replace all old slots with temp markers
            for (const [oldSlot, newSlot] of Object.entries(slotMapping)) {
              const slotPattern = new RegExp(`/${oldSlot}/`, 'g');
              updatedTarget = updatedTarget.replace(slotPattern, `/__TEMP_${newSlot}_TEMP__/`);
            }
            
            // Step 2: Replace temp markers with final values
            for (const [oldSlot, newSlot] of Object.entries(slotMapping)) {
              const tempPattern = new RegExp(`/__TEMP_${newSlot}_TEMP__/`, 'g');
              updatedTarget = updatedTarget.replace(tempPattern, `/${newSlot}/`);
            }
            
            // Normalize accidental double prefixes like disabled_c105/disabled_c105
            updatedTarget = updatedTarget.replace(/disabled_(c\d+)\/disabled_\1/g, 'disabled_$1');
            return updatedTarget;
          });
          // Normalize source paths as well
          const normalizedSource = source.replace(/disabled_(c\d+)\/disabled_\1/g, 'disabled_$1');
          // Always keep as array, even for single targets
          updatedShareToAdded[normalizedSource] = updatedTargets;
        }
        data['share-to-added'] = updatedShareToAdded;
      }
      
      writeJsonPreserve(configPath, data);
      if (event) event.sender.send('debug-message', `[DEBUG] Updated on-disk disabled config ${configPath} with mapping ${JSON.stringify(slotMapping)} (share-to-added targets updated)`);
    } catch (e) {
      if (event) event.sender.send('debug-message', `[DEBUG] Failed updating ${configPath}: ${e.message}`);
    }
  }
}

async function reorderSlotFiles(modRoot, enabledSlots, event, baseSlotNum, fighterCodename) {
  console.log(`[DEBUG] ====== REORDER SLOT FILES CALLED ======`);
  console.log(`[DEBUG] Reordering slot files with enabled slots: ${JSON.stringify(enabledSlots)}`);
  console.log(`[DEBUG] Mod root: ${modRoot}`);
  
  if (!enabledSlots || enabledSlots.length === 0) {
    console.log(`[DEBUG] No enabled slots provided, skipping file reordering`);
    return;
  }

  // Test: throw an error to see if this function is actually being called
  // throw new Error('TEST: reorderSlotFiles function is being called!');
  
  // Send a test message to the renderer to confirm this function is being called
  if (event) {
    event.sender.send('debug-message', `[DEBUG] reorderSlotFiles function is actually being called!`);
  }

  // Create temporary directory for this operation
  const tempDir = path.join(modRoot, 'temp_reorder');
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Step 1: Generate cascading shifts based on the enabled slots array
    // This matches the Python implementation's logic
    const shifts = generateCascadingShifts(enabledSlots, event, baseSlotNum);
    if (event) {
      event.sender.send('debug-message', `[DEBUG] Generated cascading shifts: ${JSON.stringify(shifts)}`);
    }

    // Step 2: Catalog all files organized by slot
    const catalog = {};
    const slotsInvolved = new Set([...Object.keys(shifts), ...Object.values(shifts)]);
    
    // IMPORTANT: DO NOT include disabled slots in the file cataloging
    // Disabled slots are in .disabled folder and should be restored AFTER shifts complete
    // Only catalog slots that exist in the main folder structure
    const slotsToProcess = Array.from(slotsInvolved).filter(slot => !slot.startsWith('disabled_'));

    if (event) {
      event.sender.send('debug-message', `[DEBUG] Cataloging files for ${slotsToProcess.length} slots: ${slotsToProcess.join(', ')}`);
      const disabledSlotsSkipped = Array.from(slotsInvolved).filter(slot => slot.startsWith('disabled_'));
      if (disabledSlotsSkipped.length > 0) {
        event.sender.send('debug-message', `[DEBUG] Excluding disabled slots from shift cataloging (will restore separately): ${disabledSlotsSkipped.join(', ')}`);
      }
    }

    // Track original slots for disabled slots to use during file renaming
    const disabledSlotOriginals = {};
    
    for (const slot of slotsToProcess) {
      if (event) {
        event.sender.send('debug-message', `[DEBUG] Cataloging files for slot: ${slot}`);
      }
      catalog[slot] = { fighter: [], camera: [], ui: [], sound: [], effect: [] };

      // Check if this is a disabled slot (should not happen now, but keep the check)
      let isDisabledSlot = false;
      let originalSlot = slot;
      let disabledFolder = null;
      
      if (slot.startsWith('disabled_')) {
        isDisabledSlot = true;
        const match = slot.match(/disabled_(c\d+)_(\d+)/);
        if (match) {
          originalSlot = match[1];
          disabledFolder = `disabled_${originalSlot}_${match[2]}`;  // FIX: Added "disabled_" prefix
          disabledSlotOriginals[slot] = originalSlot; // Store for later use
          if (event) {
            event.sender.send('debug-message', `[DEBUG] Disabled slot detected: ${slot} -> ${originalSlot} in folder ${disabledFolder}`);
          }
        }
      }

      // Fighter directories
      let fighterPath;
      if (isDisabledSlot) {
        // Use dynamic discovery like Python - walk through the disabled folder and find ANY directory named with the original slot
        const disabledInstanceDir = path.join(modRoot, '.disabled', disabledFolder);
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Scanning disabled instance directory: ${disabledInstanceDir}`);
          event.sender.send('debug-message', `[DEBUG] Checking if disabled instance directory exists: ${disabledInstanceDir}`);
        }
        
        if (fs.existsSync(disabledInstanceDir)) {
          if (event) {
            event.sender.send('debug-message', `[DEBUG] Disabled instance directory EXISTS - starting fighter discovery`);
          }
          // Walk through the directory tree to find directories named with the original slot
          function walkDirectory(currentDir, relativePath = '') {
            try {
              if (event) {
                event.sender.send('debug-message', `[DEBUG] Walking directory: ${currentDir} (relativePath: "${relativePath}")`);
              }
              
              const items = fs.readdirSync(currentDir, { withFileTypes: true });
              
              for (const item of items) {
                if (event) {
                  event.sender.send('debug-message', `[DEBUG] Checking item: ${item.name} (isDirectory: ${item.isDirectory()})`);
                }
                
                if (item.isDirectory() && item.name === originalSlot) {
                  // Found a directory matching the original slot - this could be fighter, camera, or other
                  const foundPath = path.join(currentDir, item.name);
                  
                  if (event) {
                    event.sender.send('debug-message', `[DEBUG] Found ${originalSlot} directory at: ${foundPath}`);
                    event.sender.send('debug-message', `[DEBUG] currentDir.includes('camera'): ${currentDir.includes('camera')}`);
                    event.sender.send('debug-message', `[DEBUG] relativePath.includes('camera'): ${relativePath.includes('camera')}`);
                  }
                  
                  // Check if this is a fighter directory (not camera)
                  if (!currentDir.includes('camera') && !relativePath.includes('camera')) {
                    catalog[slot].fighter.push(foundPath);
                    if (event) {
                      event.sender.send('debug-message', `[DEBUG] Found disabled fighter directory via discovery: ${foundPath}`);
                    }
                  } else {
                    if (event) {
                      event.sender.send('debug-message', `[DEBUG] Skipping ${foundPath} - it's in a camera path`);
                    }
                  }
                } else if (item.isDirectory()) {
                  // Recurse into subdirectories
                  const newRelativePath = relativePath ? path.join(relativePath, item.name) : item.name;
                  walkDirectory(path.join(currentDir, item.name), newRelativePath);
                }
              }
            } catch (error) {
              if (event) {
                event.sender.send('debug-message', `[DEBUG] Error walking directory ${currentDir}: ${error.message}`);
              }
            }
          }
          
          walkDirectory(disabledInstanceDir);
        } else {
          if (event) {
            event.sender.send('debug-message', `[DEBUG] Disabled instance directory DOES NOT EXIST: ${disabledInstanceDir}`);
          }
        }
      } else {
        // Check main directory
        fighterPath = path.join(modRoot, 'fighter', fighterCodename, 'model', 'body', slot);
      if (event) {
        event.sender.send('debug-message', `[DEBUG] Checking fighter path: ${fighterPath}`);
      }
      if (fs.existsSync(fighterPath)) {
        catalog[slot].fighter.push(fighterPath);
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Found fighter directory: ${fighterPath}`);
        }
      } else {
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Fighter directory not found: ${fighterPath}`);
          }
        }
      }

      // Camera directories
      let cameraPath;
      if (isDisabledSlot) {
        // Use dynamic discovery for camera directories too
        const disabledInstanceDir = path.join(modRoot, '.disabled', disabledFolder);
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Scanning disabled instance directory for camera: ${disabledInstanceDir}`);
          event.sender.send('debug-message', `[DEBUG] Checking if camera disabled instance directory exists: ${disabledInstanceDir}`);
        }
        
        if (fs.existsSync(disabledInstanceDir)) {
          if (event) {
            event.sender.send('debug-message', `[DEBUG] Camera disabled instance directory EXISTS - starting camera discovery`);
          }
          // Walk through the directory tree to find camera directories
          function walkDirectoryForCamera(currentDir, relativePath = '') {
            try {
              if (event) {
                event.sender.send('debug-message', `[DEBUG] Walking camera directory: ${currentDir} (relativePath: "${relativePath}")`);
              }
              
              const items = fs.readdirSync(currentDir, { withFileTypes: true });
              
              for (const item of items) {
                if (event) {
                  event.sender.send('debug-message', `[DEBUG] Checking camera item: ${item.name} (isDirectory: ${item.isDirectory()})`);
                }
                
                if (item.isDirectory() && item.name === originalSlot) {
                  // Check if this is inside a camera path by checking the full path
                  const foundPath = path.join(currentDir, item.name);
                  
                  if (event) {
                    event.sender.send('debug-message', `[DEBUG] Found ${originalSlot} camera directory at: ${foundPath}`);
                    event.sender.send('debug-message', `[DEBUG] camera currentDir.includes('camera'): ${currentDir.includes('camera')}`);
                    event.sender.send('debug-message', `[DEBUG] camera relativePath.includes('camera'): ${relativePath.includes('camera')}`);
                  }
                  
                  if (currentDir.includes('camera') || relativePath.includes('camera')) {
                    catalog[slot].camera.push(foundPath);
                    if (event) {
                      event.sender.send('debug-message', `[DEBUG] Found disabled camera directory via discovery: ${foundPath}`);
                    }
                  } else {
                    if (event) {
                      event.sender.send('debug-message', `[DEBUG] Skipping camera ${foundPath} - not in camera path`);
                    }
                  }
                } else if (item.isDirectory()) {
                  // Recurse into subdirectories
                  const newRelativePath = relativePath ? path.join(relativePath, item.name) : item.name;
                  walkDirectoryForCamera(path.join(currentDir, item.name), newRelativePath);
                }
              }
            } catch (error) {
              if (event) {
                event.sender.send('debug-message', `[DEBUG] Error walking directory for camera ${currentDir}: ${error.message}`);
              }
            }
          }
          
          walkDirectoryForCamera(disabledInstanceDir);
        } else {
          if (event) {
            event.sender.send('debug-message', `[DEBUG] Camera disabled instance directory DOES NOT EXIST: ${disabledInstanceDir}`);
          }
        }
      } else {
        // Check main directory
        cameraPath = path.join(modRoot, 'camera', 'fighter', fighterCodename, slot);
      if (event) {
        event.sender.send('debug-message', `[DEBUG] Checking camera path: ${cameraPath}`);
      }
      if (fs.existsSync(cameraPath)) {
        catalog[slot].camera.push(cameraPath);
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Found camera directory: ${cameraPath}`);
        }
      } else {
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Camera directory not found: ${cameraPath}`);
          }
        }
      }

      // Sound files
      let soundPath;
      if (isDisabledSlot) {
        // Check disabled folder for sound files
        soundPath = path.join(modRoot, '.disabled', disabledFolder, 'sound', 'bank', 'fighter_voice');
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Checking disabled sound path: ${soundPath}`);
        }
      } else {
        // Check main directory
        soundPath = path.join(modRoot, 'sound', 'bank', 'fighter_voice');
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Checking sound path: ${soundPath}`);
        }
      }
      
      if (fs.existsSync(soundPath)) {
        const soundFiles = fs.readdirSync(soundPath)
          .filter(file => {
            // For disabled slots, look for files with disabled_cXXX pattern
            if (isDisabledSlot) {
              return file.includes(`_disabled_${originalSlot}.`);
            }
            // For active slots, look for regular cXXX pattern
            return file.includes(`_${originalSlot}.`);
          })
          .map(file => path.join(soundPath, file));
        catalog[slot].sound.push(...soundFiles);
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Found ${soundFiles.length} sound files for ${slot}: ${soundFiles.join(', ')}`);
        }
      } else {
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Sound directory not found: ${soundPath}`);
        }
      }

      // Effect files - find all effect files for this slot
      let effectPath;
      if (isDisabledSlot) {
        // For disabled slots, check the disabled folder first
        const disabledEffectPath = path.join(modRoot, '.disabled', disabledFolder, 'effect', 'fighter');
        effectPath = disabledEffectPath;
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Using disabled effect path: ${effectPath}`);
        }
      } else {
        effectPath = path.join(modRoot, 'effect', 'fighter');
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Checking effect path: ${effectPath}`);
        }
      }
      
      if (fs.existsSync(effectPath)) {
        // Walk through the effect directory recursively to find files with slot patterns
        function findEffectFiles(dir) {
          const results = [];
          try {
            const items = fs.readdirSync(dir, { withFileTypes: true });
            for (const item of items) {
              const fullPath = path.join(dir, item.name);
              if (item.isDirectory()) {
                results.push(...findEffectFiles(fullPath));
              } else if (item.isFile() && item.name.endsWith('.eff')) {
                // For disabled slots, look for files with disabled_cXXX pattern
                if (isDisabledSlot) {
                  if (item.name.includes(`_disabled_${originalSlot}.`) || item.name.includes(`_${originalSlot}.`)) {
                    results.push(fullPath);
                  }
                } else {
                  // For active slots, look for regular cXXX pattern
                  if (item.name.includes(`_${originalSlot}.`)) {
                    results.push(fullPath);
                  }
                }
              }
            }
          } catch (error) {
            if (event) {
              event.sender.send('debug-message', `[DEBUG] Error scanning effect directory ${dir}: ${error.message}`);
            }
          }
          return results;
        }
        
        const effectFiles = findEffectFiles(effectPath);
        catalog[slot].effect.push(...effectFiles);
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Found ${effectFiles.length} effect files for ${slot}: ${effectFiles.join(', ')}`);
        }
      } else {
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Effect directory not found: ${effectPath}`);
        }
      }

      // UI files - find all UI files for this slot
      let uiPath;
      if (isDisabledSlot) {
        // For disabled slots, check if UI files exist in the disabled folder
        const disabledUIPath = path.join(modRoot, '.disabled', disabledFolder, 'ui', 'replace', 'chara');
        if (fs.existsSync(disabledUIPath)) {
          uiPath = disabledUIPath;
          if (event) {
            event.sender.send('debug-message', `[DEBUG] Using disabled UI path: ${uiPath}`);
          }
        } else {
          // Fallback to main UI directory
          uiPath = path.join(modRoot, 'ui', 'replace', 'chara');
          if (event) {
            event.sender.send('debug-message', `[DEBUG] Disabled UI path not found, using main UI path: ${uiPath}`);
          }
        }
      } else {
        uiPath = path.join(modRoot, 'ui', 'replace', 'chara');
      }
      if (event) {
        event.sender.send('debug-message', `[DEBUG] Checking UI path: ${uiPath}`);
      }
      if (fs.existsSync(uiPath)) {
        // Get the alt number for this slot (e.g., c105 -> 1, c106 -> 2, etc.)
        // Handle disabled slot IDs (e.g., disabled_c118_1754337553884 -> extract c118)
        let slotNum;
        if (slot.startsWith('disabled_')) {
          // Extract the original slot from disabled slot ID
          const match = slot.match(/disabled_(c\d+)_/);
          if (match) {
            slotNum = parseInt(match[1].substring(1));
          } else {
            if (event) {
              event.sender.send('debug-message', `[DEBUG] Error: Could not parse disabled slot ID: ${slot}`);
            }
            continue;
          }
        } else {
          slotNum = parseInt(slot.substring(1));
        }
        
        // Use the passed baseSlotNum parameter
        if (!baseSlotNum) {
          if (event) {
            event.sender.send('debug-message', `[DEBUG] Error: baseSlotNum is not provided for slot ${slot}`);
          }
          continue; // Skip this slot if baseSlotNum is not available
        }
        const baseSlotNumToUse = baseSlotNum;
        const altNum = slotNum - baseSlotNumToUse;
        
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Slot ${slot} -> alt number ${altNum}`);
        }
        
        // We need to get the display fighter name from the initial detection
        // For now, let's look for any file with the pattern _XX.bntx or _XX.nutexb
        // and then check if it matches the expected alt number
        for (const charaFolder of fs.readdirSync(uiPath)) {
          const charaPath = path.join(uiPath, charaFolder);
          if (fs.statSync(charaPath).isDirectory()) {
            const allFiles = fs.readdirSync(charaPath);
            const uiFiles = allFiles
              .filter(file => {
                // Look for files with pattern ending in _XX.bntx or _XX.nutexb where XX is the alt number
                const match = file.toLowerCase().match(/_(\d{2})\.(bntx|nutexb)$/);
                if (match) {
                  const fileAltNum = parseInt(match[1]);
                  return fileAltNum === altNum;
                }
                return false;
              })
              .map(file => path.join(charaPath, file));
            if (event && uiFiles.length > 0) {
              event.sender.send('debug-message', `[DEBUG] Found ${uiFiles.length} UI files for ${slot} (alt ${altNum}) in ${charaFolder}`);
            }
            catalog[slot].ui.push(...uiFiles);
          }
        }
      } else {
        if (event) {
          event.sender.send('debug-message', `[DEBUG] UI directory not found: ${uiPath}`);
        }
      }
    }

    // Step 3: Create file mapping based on cascading shifts
    const fileMapping = {}; // old_path -> new_path
    if (event) {
      event.sender.send('debug-message', `[DEBUG] Creating file mappings from shifts: ${JSON.stringify(shifts)}`);
    }

    // Process regular slot shifts
    for (const [oldSlot, newSlot] of Object.entries(shifts)) {
      if (event) {
        event.sender.send('debug-message', `[DEBUG] Processing slot shift: ${oldSlot} -> ${newSlot}`);
      }
      
      if (!catalog[oldSlot]) {
        if (event) {
          event.sender.send('debug-message', `[DEBUG] No catalog entry for slot ${oldSlot}, skipping`);
        }
        continue;
      }

      if (event) {
        event.sender.send('debug-message', `[DEBUG] Catalog for ${oldSlot}: ${JSON.stringify(catalog[oldSlot])}`);
      }

      for (const [fileType, paths] of Object.entries(catalog[oldSlot])) {
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Processing ${fileType} files for ${oldSlot}: ${paths.length} files`);
        }
        
        for (const oldPath of paths) {
          let newPath;

          if (fileType === 'fighter' || fileType === 'camera') {
            // For directories, replace the slot in the path
            // Use path.sep to handle both Windows and Unix path separators
            // Escape the backslash for regex
            const escapedSep = path.sep.replace(/\\/g, '\\\\');
            const slotPattern = new RegExp(`[${escapedSep}]${oldSlot}([${escapedSep}]|$)`, 'g');
            newPath = oldPath.replace(slotPattern, `${path.sep}${newSlot}$1`);
            if (event) {
              event.sender.send('debug-message', `[DEBUG] Directory: ${oldPath} -> ${newPath}`);
            }
          } else if (fileType === 'sound') {
            // For sound files, replace the slot in the filename
            // Handle both regular pattern (_cXXX.) and disabled pattern (_disabled_cXXX.)
            const filename = path.basename(oldPath);
            let newFilename;
            
            // For disabled slots, we need to use the original slot number from the disabled ID
            const originalSlotNumber = disabledSlotOriginals[oldSlot] || oldSlot;
            
            if (filename.includes(`_disabled_${originalSlotNumber}.`)) {
              // Remove the disabled_ prefix when restoring (e.g., _disabled_c118. -> _c105.)
              newFilename = filename.replace(`_disabled_${originalSlotNumber}.`, `_${newSlot}.`);
            } else if (filename.includes(`_${originalSlotNumber}.`)) {
              // Regular renaming (e.g., _c118. -> _c105.)
              newFilename = filename.replace(new RegExp(`_${originalSlotNumber}\\.`, 'g'), `_${newSlot}.`);
            } else {
              // No match - skip
              newFilename = filename;
            }
            
            // IMPORTANT: When restoring from disabled folder, sound files should go to the MAIN sound directory
            // not back to the disabled folder
            let targetDir = path.dirname(oldPath);
            if (oldPath.includes(path.sep + '.disabled' + path.sep)) {
              // This is a disabled slot being restored - put sound files in main directory
              targetDir = path.join(modRoot, 'sound', 'bank', 'fighter_voice');
            }
            
            newPath = path.join(targetDir, newFilename);
            if (event) {
              event.sender.send('debug-message', `[DEBUG] Sound: ${oldPath} -> ${newPath}`);
            }
          } else if (fileType === 'effect') {
            // For effect files, replace the slot in the filename
            // Handle both regular pattern (_cXXX.) and disabled pattern (_disabled_cXXX.)
            const filename = path.basename(oldPath);
            let newFilename;
            
            // For disabled slots, we need to use the original slot number from the disabled ID
            const originalSlotNumber = disabledSlotOriginals[oldSlot] || oldSlot;
            
            if (filename.includes(`_disabled_${originalSlotNumber}.`)) {
              // Remove the disabled_ prefix when restoring (e.g., _disabled_c118. -> _c105.)
              newFilename = filename.replace(`_disabled_${originalSlotNumber}.`, `_${newSlot}.`);
            } else if (filename.includes(`_${originalSlotNumber}.`)) {
              // Regular renaming (e.g., _c118. -> _c105.)
              newFilename = filename.replace(new RegExp(`_${originalSlotNumber}\\.`, 'g'), `_${newSlot}.`);
            } else {
              // No match - skip
              newFilename = filename;
            }
            
            // IMPORTANT: When restoring from disabled folder, effect files should go to the MAIN effect directory
            // not back to the disabled folder
            let targetDir = path.dirname(oldPath);
            if (oldPath.includes(path.sep + '.disabled' + path.sep)) {
              // This is a disabled slot being restored - reconstruct the proper effect path
              // Use dirname to get directory path WITHOUT the filename
              const dirPath = path.dirname(oldPath);
              const relativePath = dirPath.substring(dirPath.indexOf('.disabled') + '.disabled'.length);
              const pathParts = relativePath.split(path.sep).filter(p => p && !p.match(/^c\d+_\d+$/));
              // Reconstruct from 'effect' onward
              const effectIndex = pathParts.indexOf('effect');
              if (effectIndex >= 0) {
                const subPath = pathParts.slice(effectIndex).join(path.sep);
                targetDir = path.join(modRoot, subPath);
              } else {
                targetDir = path.join(modRoot, 'effect', 'fighter');
              }
            }
            
            newPath = path.join(targetDir, newFilename);
            if (event) {
              event.sender.send('debug-message', `[DEBUG] Effect: ${oldPath} -> ${newPath}`);
            }
          } else if (fileType === 'ui') {
            // For UI files, we need to rename the alt number in the filename
            const filename = path.basename(oldPath);
            
            // Extract the alt number from the filename (e.g., "01" from "chara_0_brolyz_01.bntx")
            const altMatch = filename.match(/_(\d{2})\.(bntx|nutexb)$/);
            if (altMatch) {
              const oldAltNum = parseInt(altMatch[1]);
              
              // Calculate the new alt number based on slot shift
              const oldSlotNum = parseInt(oldSlot.substring(1));
              const newSlotNum = parseInt(newSlot.substring(1));
              // Use the passed baseSlotNum parameter
              if (!baseSlotNum) {
                if (event) {
                  event.sender.send('debug-message', `[DEBUG] Error: baseSlotNum is not provided for UI file renaming`);
                }
                continue; // Skip this file if baseSlotNum is not available
              }
              const baseSlotNumToUse = baseSlotNum;
              
              const oldAltIndex = oldSlotNum - baseSlotNumToUse;
              const newAltIndex = newSlotNum - baseSlotNumToUse;
              
              // Create new filename with updated alt number
              const newAltNum = newAltIndex.toString().padStart(2, '0');
              const newFilename = filename.replace(/_(\d{2})\.(bntx|nutexb)$/, `_${newAltNum}.$2`);
              newPath = path.join(path.dirname(oldPath), newFilename);
              
              if (event) {
                event.sender.send('debug-message', `[DEBUG] UI: ${oldPath} -> ${newPath} (alt ${oldAltNum} -> ${newAltNum})`);
              }
            } else {
              if (event) {
                event.sender.send('debug-message', `[DEBUG] Could not parse alt number from UI filename: ${filename}`);
              }
              continue; // Skip this file if we can't parse it
            }
          }

          if (newPath && newPath !== oldPath) {
            // Additional safety: normalize paths before comparing
            const normalizedOld = path.normalize(oldPath);
            const normalizedNew = path.normalize(newPath);
            
            if (normalizedOld !== normalizedNew) {
            fileMapping[oldPath] = newPath;
            if (event) {
              event.sender.send('debug-message', `[DEBUG] Added file mapping: ${oldPath} -> ${newPath}`);
            }
          } else {
            if (event) {
                event.sender.send('debug-message', `[DEBUG] Skipping identical mapping: ${oldPath}`);
              }
            }
          } else {
      if (event) {
              event.sender.send('debug-message', `[DEBUG] Skipped file mapping (no change or invalid): ${oldPath}`);
            }
          }
        }
      }
    }

    // Note: Disabled slot restoration is now handled separately in apply-slot-changes handler
    // after the shift operations complete. This function only handles shifts of existing slots.

    if (event) {
      event.sender.send('debug-message', `[DEBUG] Total file mappings created: ${Object.keys(fileMapping).length}`);
      event.sender.send('debug-message', `[DEBUG] File mappings: ${JSON.stringify(fileMapping)}`);
    }

    // Step 3: Move everything to temp directory first
    const tempCopies = {};
    if (event) {
      event.sender.send('debug-message', `[DEBUG] Moving files to temporary directory...`);
    }

    for (const [oldPath, newPath] of Object.entries(fileMapping)) {
      const oldPathNorm = path.normalize(oldPath);
      const modRootNorm = path.normalize(modRoot);
      
      let relPath;
      try {
        relPath = path.relative(modRootNorm, oldPathNorm);
      } catch (error) {
        // Fallback if relative path calculation fails
        relPath = path.basename(oldPath);
      }

      const tempPath = path.join(tempDir, relPath);
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });

      if (fs.existsSync(oldPath)) {
        const stats = fs.statSync(oldPath);
        
        // Safety check: skip if file is empty (0 bytes)
        if (stats.isFile() && stats.size === 0) {
          if (event) {
            event.sender.send('debug-message', `[DEBUG] WARNING: Skipping empty file: ${oldPath}`);
          }
          console.log(`[DEBUG] WARNING: Skipping empty file: ${oldPath}`);
          continue;
        }
        
        if (stats.isDirectory()) {
          if (fs.existsSync(tempPath)) {
            fs.rmSync(tempPath, { recursive: true, force: true });
          }
          fs.cpSync(oldPath, tempPath, { recursive: true });
        } else {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
          fs.copyFileSync(oldPath, tempPath);
          
          // Verify the copy was successful by checking size
          const copiedStats = fs.statSync(tempPath);
          if (copiedStats.size !== stats.size) {
            if (event) {
              event.sender.send('debug-message', `[DEBUG] ERROR: File size mismatch after copy: ${oldPath} (${stats.size} bytes) vs ${tempPath} (${copiedStats.size} bytes)`);
            }
            console.log(`[DEBUG] ERROR: File size mismatch after copy: ${oldPath}`);
          }
        }
        tempCopies[oldPath] = tempPath;
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Copied ${oldPath} to temp: ${tempPath}`);
        }
      }
    }

    // Step 4: Remove the original files (excluding disabled files - they'll be cleaned up at the end)
    if (event) {
      event.sender.send('debug-message', `[DEBUG] Removing original files...`);
    }
    const disabledFilesToCleanup = []; // Store disabled files for cleanup at the end
    for (const oldPath of Object.keys(fileMapping)) {
      // Skip disabled files - they will be cleaned up at the very end
      if (oldPath.includes('.disabled')) {
        disabledFilesToCleanup.push(oldPath);
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Skipping disabled file for now: ${oldPath}`);
        }
        continue;
      }
      
      if (fs.existsSync(oldPath)) {
        if (fs.statSync(oldPath).isDirectory()) {
          fs.rmSync(oldPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(oldPath);
        }
        if (event) {
          event.sender.send('debug-message', `[DEBUG] Removed ${oldPath}`);
        }
      }
    }

    // Step 5: Copy files back from temp to their new locations
    if (event) {
      event.sender.send('debug-message', `[DEBUG] Moving files to new locations...`);
    }
    for (const [oldPath, newPath] of Object.entries(fileMapping)) {
      if (!tempCopies[oldPath]) {
        console.log(`[DEBUG] Warning: No temp copy found for ${oldPath}`);
        continue;
      }

      const tempPath = tempCopies[oldPath];
      fs.mkdirSync(path.dirname(newPath), { recursive: true });

      if (fs.statSync(tempPath).isDirectory()) {
        if (fs.existsSync(newPath)) {
          fs.rmSync(newPath, { recursive: true, force: true });
        }
        fs.cpSync(tempPath, newPath, { recursive: true });
      } else {
        if (fs.existsSync(newPath)) {
          fs.unlinkSync(newPath);
        }
        fs.copyFileSync(tempPath, newPath);
      }

      if (event) {
        event.sender.send('debug-message', `[DEBUG] Copied ${tempPath} to ${newPath}`);
      }
    }

    // Step 6: Clean up disabled files (LAST - after everything else is complete)
    // Note: This cleanup is now handled by the main apply-slot-changes handler
    // to ensure config restoration happens before cleanup
    if (disabledFilesToCleanup.length > 0) {
      if (event) {
        event.sender.send('debug-message', `[DEBUG] Skipping disabled file cleanup in reorderSlotFiles - will be handled by main handler`);
      }
    }

    if (event) {
      event.sender.send('debug-message', `[DEBUG] Slot file reordering complete.`);
    }

  } catch (error) {
    console.log(`[DEBUG] Error during file reordering: ${error.message}`);
    throw error;
  } finally {
    // Clean up temporary directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log(`[DEBUG] Removed temporary directory ${tempDir}`);
      }
    } catch (error) {
      console.log(`[DEBUG] Error cleaning up temp directory: ${error.message}`);
    }
  }
}

// Reorder slot files using an explicit mapping { actualSlot: visualSlot }
async function reorderSlotFilesWithMapping(modRoot, slotMapping, event) {
  // Build a deterministic order of operations to avoid overlaps
  // Use a temp staging directory
  const tempDir = path.join(modRoot, 'temp_reorder_explicit');
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });

  function moveDirSafe(src, dst) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    // If destination exists, move it aside first
    const stash = dst + '.stash';
    if (fs.existsSync(dst)) {
      fs.rmSync(stash, { recursive: true, force: true });
      fs.renameSync(dst, stash);
    }
    fs.renameSync(src, dst);
    if (fs.existsSync(stash)) fs.rmSync(stash, { recursive: true, force: true });
  }

  // Fighter model body dirs
  for (const [from, to] of Object.entries(slotMapping)) {
    const src = path.join(modRoot, 'fighter', '**UNKNOWN**');
  }

  // We need fighter codename to move fighter dirs; reuse detection from earlier paths
  // Best-effort find: list directories under fighter and pick the one with cXXX entries
  const fighterRoot = path.join(modRoot, 'fighter');
  let codename = null;
  if (fs.existsSync(fighterRoot)) {
    for (const d of fs.readdirSync(fighterRoot)) {
      const bodyDir = path.join(fighterRoot, d, 'model', 'body');
      if (fs.existsSync(bodyDir)) {
        codename = d;
        break;
      }
    }
  }

  if (codename) {
    for (const [actualSlot, visualSlot] of Object.entries(slotMapping)) {
      const fromDir = path.join(modRoot, 'fighter', codename, 'model', 'body', actualSlot);
      const toDir = path.join(modRoot, 'fighter', codename, 'model', 'body', visualSlot);
      moveDirSafe(fromDir, toDir);
    }
    // Camera
    for (const [actualSlot, visualSlot] of Object.entries(slotMapping)) {
      const fromDir = path.join(modRoot, 'camera', 'fighter', codename, actualSlot);
      const toDir = path.join(modRoot, 'camera', 'fighter', codename, visualSlot);
      moveDirSafe(fromDir, toDir);
    }
  }

  // Sound: rename files containing _cXXX. to new slot
  const soundDir = path.join(modRoot, 'sound', 'bank', 'fighter_voice');
  if (fs.existsSync(soundDir)) {
    for (const file of fs.readdirSync(soundDir)) {
      let newName = file;
      for (const [actualSlot, visualSlot] of Object.entries(slotMapping)) {
        newName = newName.replace(new RegExp(`_${actualSlot}\.`, 'g'), `_${visualSlot}.`);
      }
      if (newName !== file) {
        fs.renameSync(path.join(soundDir, file), path.join(soundDir, newName));
      }
    }
  }

  // UI: rename target alt numbers in UI files would require context; skipping to avoid overreach
}

function generateCascadingShifts(enabledSlots, event, baseSlotNum) {
  if (event) {
    event.sender.send('debug-message', `[DEBUG] ====== GENERATE CASCADING SHIFTS CALLED ======`);
    event.sender.send('debug-message', `[DEBUG] Input enabledSlots: ${JSON.stringify(enabledSlots)}`);
  }
  
  if (!enabledSlots || enabledSlots.length === 0) {
    if (event) {
      event.sender.send('debug-message', `[DEBUG] No enabled slots provided, returning empty shifts`);
    }
    return {};
  }

  // The enabledSlots array represents the new visual order of actual slots
  // We need to convert this to the actual file system shifts
  const shifts = {};
  
  // Use the passed baseSlotNum parameter
  if (!baseSlotNum) {
    if (event) {
      event.sender.send('debug-message', `[DEBUG] Error: baseSlotNum is not provided for cascading shifts`);
    }
    return {}; // Return empty shifts if baseSlotNum is not available
  }
  const baseSlotNumToUse = baseSlotNum;
  
  if (event) {
    event.sender.send('debug-message', `[DEBUG] Base slot number: ${baseSlotNumToUse}`);
  }
  
  // Create a map from visual position to actual slot
  // This represents what the user sees in the UI
  const visualToActual = {};
  enabledSlots.forEach((actualSlot, index) => {
    const visualSlot = `c${baseSlotNumToUse + index}`;
    visualToActual[visualSlot] = actualSlot;
  });
  
  if (event) {
    event.sender.send('debug-message', `[DEBUG] enabledSlots array: ${JSON.stringify(enabledSlots)}`);
    event.sender.send('debug-message', `[DEBUG] baseSlotNumToUse: ${baseSlotNumToUse}`);
    event.sender.send('debug-message', `[DEBUG] First enabledSlot: ${enabledSlots[0]}`);
    event.sender.send('debug-message', `[DEBUG] First visualSlot: c${baseSlotNumToUse + 0}`);
  }
  
  if (event) {
    event.sender.send('debug-message', `[DEBUG] Visual to actual mapping: ${JSON.stringify(visualToActual)}`);
  }
  
  // Generate shifts: for each actual slot, if it's not in its natural position, create a shift
  // Include disabled slots in the shift calculation to ensure proper cascading
  for (const [visualSlot, actualSlot] of Object.entries(visualToActual)) {
    if (actualSlot !== visualSlot) {
      // This actual slot needs to be renamed to the visual slot
      // Include disabled slots to ensure proper cascading when slots are disabled
      shifts[actualSlot] = visualSlot;
      if (event) {
        event.sender.send('debug-message', `[DEBUG] Shift: ${actualSlot} -> ${visualSlot}`);
      }
    }
  }
  
  if (event) {
    event.sender.send('debug-message', `[DEBUG] Final generated shifts: ${JSON.stringify(shifts)}`);
  }
  
  return shifts;
}
 