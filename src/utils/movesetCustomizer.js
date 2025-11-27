import { scanDirectory, listDirectory, readFile, fileExists, createDirectory, writeFile } from './fileUtils';

const { ipcRenderer } = window.require('electron');

export class MovesetCustomizer {
  constructor(modDirectory = null) {
    this.modDirectory = modDirectory;
    this.configData = null;
    this.modFiles = [];
    this.analysisResults = {
      errors: [],
      warnings: [],
      optimizations: []
    };
    this.fighterName = null;
    this.fighterSlots = [];
    this.mainSlot = null;
    
    // Additional properties for complete functionality
    this.displayFighterName = null; // Display name (e.g., 'sans')
    this.fighterCodename = null;     // Internal folder name (e.g., 'palutena')
    this.baseSlotNum = null;         // Base cXXX number (e.g., 120)
    this.modRoot = null;
    this.foundSlots = {}; // UI file detection results
  }

  async setMovesetDirectory(directoryPath) {
    console.log(`Setting moveset directory to: ${directoryPath}`);
    
    try {
      const exists = await fileExists(directoryPath);
      if (!exists) {
        console.error(`Error: Provided path is not a valid directory: ${directoryPath}`);
        this.modDirectory = null;
        this.configData = null;
        this.modFiles = [];
        this.fighterName = null;
        this.fighterSlots = [];
        this.mainSlot = null;
        this.modRoot = null;
        return false;
      }
      
      this.modDirectory = directoryPath;
      this.modRoot = directoryPath;
      this.configData = null;
      this.modFiles = [];
      this.fighterName = null;
      this.fighterSlots = [];
      this.mainSlot = null;
      this.displayFighterName = null;
      this.fighterCodename = null;
      this.baseSlotNum = null;
      this.foundSlots = {};
      
      // Create config_backup.json if it doesn't exist
      // This preserves the original, unmodified config for skins without their own config
      try {
        const configPath = `${directoryPath}/config.json`;
        const configBackupPath = `${directoryPath}/config_backup.json`;
        
        const configExists = await fileExists(configPath);
        const backupExists = await fileExists(configBackupPath);
        
        if (configExists && !backupExists) {
          console.log('Creating config_backup.json from original config.json');
          const configContent = await readFile(configPath);
          await writeFile(configBackupPath, configContent);
          console.log('Successfully created config_backup.json');
        } else if (backupExists) {
          console.log('config_backup.json already exists, using existing backup');
        } else if (!configExists) {
          console.log('No config.json found, skipping backup creation');
        }
      } catch (backupError) {
        console.error('Error creating config backup:', backupError);
        // Don't fail the directory loading if backup creation fails
      }
      
      return true;
    } catch (error) {
      console.error('Error setting moveset directory:', error);
      return false;
    }
  }

  async loadConfig() {
    if (!this.modDirectory) {
      console.error('Error: Mod directory not set. Cannot load config.');
      this.analysisResults.errors.push({
        type: 'config_load',
        message: 'Mod directory not set before attempting to load config.'
      });
      this.configData = null;
      return null;
    }

    const configPath = `${this.modDirectory}/config.json`;
    this.configData = {};
    
    // Clear previous load errors
    this.analysisResults.errors = this.analysisResults.errors.filter(
      e => !['json_decode', 'config_load'].includes(e.type)
    );

    try {
      const exists = await fileExists(configPath);
      if (exists) {
        const content = await readFile(configPath);
        if (content.trim()) {
          this.configData = JSON.parse(content);
          console.log(`Successfully loaded config from: ${configPath}`);
        } else {
          console.log('config.json is empty.');
          this.configData = {};
        }
      } else {
        console.log(`config.json not found in ${this.modDirectory}.`);
        this.configData = {};
      }
    } catch (error) {
      console.error(`Error loading config.json: ${error}`);
      this.analysisResults.errors.push({
        type: 'json_decode',
        message: `Invalid JSON in config.json: ${error}`
      });
      this.configData = null;
    }

    return this.configData;
  }

  async detectDisplayFighterName() {
    console.log('[DEBUG] --- Running detectDisplayFighterName ---');
    this.displayFighterName = null;

    if (!this.modRoot) {
      console.log('[DEBUG] Mod root not set. Cannot detect display name.');
      return;
    }

    const folderPath = this.modDirectory;
    const folderName = folderPath.split(/[\\/]/).pop();

    // Strategy 1: Infer from UI files
    const uiBaseDir = `${this.modRoot}/ui/replace/chara`;
    const uiExists = await fileExists(uiBaseDir);
    
    if (uiExists) {
      for (let charaNum = 0; charaNum < 20; charaNum++) {
        const charaFolderPath = `${uiBaseDir}/chara_${charaNum}`;
        const charaExists = await fileExists(charaFolderPath);
        
        if (charaExists) {
          try {
            const charaFiles = await scanDirectory(charaFolderPath);
            
            for (const filename of charaFiles) {
              // Regex to capture the name part between chara_X_ and _XX.(bntx|nutexb)
              const match = filename.match(/chara_\d+_([\w_-]+?)_\d{2}\.(bntx|nutexb)/i);
              if (match) {
                const detectedName = match[1].toLowerCase();
                if (detectedName !== 'chara') {
                  this.displayFighterName = detectedName;
                  console.log(`[DEBUG] Detected display name from UI file '${filename}': ${this.displayFighterName}`);
                  return;
                }
              }
            }
          } catch (error) {
            console.log(`Error reading chara folder ${charaFolderPath}: ${error}`);
          }
        }
      }
    }

    // Strategy 2: Extract from folder name format: (Moveset) FighterName
    if (!this.displayFighterName) {
      const match = folderName.match(/\((?:Moveset|Character)\)\s*([\w\s-]+)/i);
      if (match) {
        this.displayFighterName = match[1].trim().toLowerCase();
        console.log(`[DEBUG] Detected display name from folder format: '${this.displayFighterName}'`);
        return;
      }
    }

    // Strategy 3: Use the entire folder name as fallback
    if (!this.displayFighterName) {
      let cleanedFolderName = folderName.toLowerCase();
      cleanedFolderName = cleanedFolderName.replace(/^\(moveset\)\s*/, '').trim();
      this.displayFighterName = cleanedFolderName;
      console.log(`[DEBUG] Using cleaned folder name as display name: '${this.displayFighterName}'`);
    }

    // Final check
    if (!this.displayFighterName) {
      console.log('ERROR: Could not determine display fighter name. Check mod folder structure and UI file names.');
      this.displayFighterName = 'unknown_display';
    }

    console.log(`[DEBUG] Final displayFighterName set to: ${this.displayFighterName}`);
  }

  async detectFighterCodename() {
    console.log('[DEBUG] --- Running detectFighterCodename ---');
    this.fighterCodename = null;

    if (!this.modRoot) {
      console.log('[DEBUG] Mod root directory not set. Cannot detect codename.');
      return;
    }

    const fighterDirBase = `${this.modRoot}/fighter`;
    console.log(`[DEBUG] Checking base fighter directory: ${fighterDirBase}`);

    const fighterDirExists = await fileExists(fighterDirBase);
    if (!fighterDirExists) {
      console.log('[DEBUG] Base fighter directory not found.');
      this.fighterCodename = 'unknown_codename';
      return;
    }

    try {
      const fighterItems = await listDirectory(fighterDirBase);
      const possibleCodenames = [];

      for (const itemName of fighterItems) {
        // Skip common non-fighter directories
        if (itemName === 'common') {
          continue;
        }

        const itemPath = `${fighterDirBase}/${itemName}`;
        
        // Check if this directory contains model/body subdirectories
        // This helps identify actual fighter directories vs other folders
        const modelPath = `${itemPath}/model`;
        const modelExists = await fileExists(modelPath);
        
        if (modelExists) {
          possibleCodenames.push(itemName);
          console.log(`[DEBUG] Found potential fighter directory: ${itemName}`);
        } else {
          // Also check if this directory contains any cXXX subdirectories directly
          // Some mods might have a different structure
          try {
            const subItems = await listDirectory(itemPath);
            const hasSlotDirs = subItems.some(subItem => 
              subItem.startsWith('c') && subItem.length > 1 && /^\d+$/.test(subItem.substring(1))
            );
            
            if (hasSlotDirs) {
              possibleCodenames.push(itemName);
              console.log(`[DEBUG] Found potential fighter directory with slot dirs: ${itemName}`);
            }
          } catch (scanError) {
            console.log(`[DEBUG] Error scanning subdirectories of ${itemName}: ${scanError}`);
          }
        }
      }

      console.log(`[DEBUG] Found potential codename folders: ${possibleCodenames}`);

      if (possibleCodenames.length === 1) {
        this.fighterCodename = possibleCodenames[0];
        console.log(`[DEBUG] Detected single fighter codename: ${this.fighterCodename}`);
      } else if (possibleCodenames.length > 1) {
        console.log(`Warning: Found multiple potential fighter codenames: ${possibleCodenames}`);
        
        // Try to match with display name
        const displayNameLower = this.displayFighterName ? this.displayFighterName.toLowerCase() : '';
        console.log(`[DEBUG] Trying to match with display name: '${displayNameLower}'`);
        
        let matchedCodename = null;
        for (const codename of possibleCodenames) {
          if (codename.toLowerCase() === displayNameLower) {
            matchedCodename = codename;
            console.log(`[DEBUG] Found match: ${matchedCodename}`);
            break;
          }
        }

        if (matchedCodename) {
          this.fighterCodename = matchedCodename;
          console.log(`[DEBUG] Using display name match '${this.fighterCodename}' as codename.`);
        } else {
          this.fighterCodename = possibleCodenames[0];
          console.log(`[DEBUG] Multiple codenames found, no display name match. Defaulting to first detected: ${this.fighterCodename}`);
        }
      } else {
        console.log(`Warning: No fighter subdirectory found in '${fighterDirBase}'. Cannot detect codename.`);
        this.fighterCodename = 'unknown_codename';
      }
    } catch (error) {
      console.log(`Error during codename detection: ${error}`);
      this.fighterCodename = 'unknown_codename';
    }

    if (!this.fighterCodename) {
      console.log('ERROR: Fighter codename detection failed unexpectedly.');
      this.fighterCodename = 'unknown_codename';
    }

    console.log(`[DEBUG] Final fighterCodename set to: ${this.fighterCodename}`);
  }

  async detectBaseSlotNumber() {
    console.log('[DEBUG] --- Running detectBaseSlotNumber ---');
    let baseSlotNum = null;
    let lowestSlotNum = null;

    if (!this.modRoot || !this.fighterCodename) {
      console.log('[DEBUG] Cannot detect base slot: modRoot or fighterCodename not set.');
      this.baseSlotNum = null;
      return null;
    }

    // Define potential paths for slot directories
    const potentialBodyPaths = [
      `${this.modRoot}/fighter/${this.fighterCodename}/model/body`,
      `${this.modRoot}/fighter/${this.fighterCodename}/body`,
      `${this.modRoot}/fighter/${this.fighterCodename}`
    ];

    let fighterSlotDir = null;
    for (const pathToCheck of potentialBodyPaths) {
      console.log(`[DEBUG] Checking for slot folders in: ${pathToCheck}`);
      const pathExists = await fileExists(pathToCheck);
      if (pathExists) {
        fighterSlotDir = pathToCheck;
        console.log(`[DEBUG] Found potential slot directory: ${fighterSlotDir}`);
        break;
      }
    }

    if (fighterSlotDir) {
      try {
        // Use listDirectory to get only directory names, not file paths
        const slotItems = await listDirectory(fighterSlotDir);
        console.log(`[DEBUG] Found items in ${fighterSlotDir}: ${slotItems}`);
        
        for (const dirName of slotItems) {
          // Check if it's a directory and matches the cXXX pattern
          if (dirName.startsWith('c') && dirName.length > 1 && /^\d+$/.test(dirName.substring(1))) {
            const slotNum = parseInt(dirName.substring(1));
            console.log(`[DEBUG] Found slot directory: ${dirName} (slot number: ${slotNum})`);
            if (lowestSlotNum === null || slotNum < lowestSlotNum) {
              lowestSlotNum = slotNum;
            }
          }
        }

        if (lowestSlotNum !== null) {
          baseSlotNum = lowestSlotNum;
          console.log(`[DEBUG] Detected base slot number from ${fighterSlotDir}: c${baseSlotNum}`);
        } else {
          console.log(`[DEBUG] No cXXX slot directories found in ${fighterSlotDir}. Base slot detection failed.`);
        }
      } catch (error) {
        console.log(`[DEBUG] Error reading slot directory ${fighterSlotDir}: ${error}`);
      }
    } else {
      console.log(`[DEBUG] No valid fighter slot directory found in potential paths. Base slot detection failed.`);
    }

    console.log(`[DEBUG] Setting this.baseSlotNum to: ${baseSlotNum}`);
    this.baseSlotNum = baseSlotNum;
    return baseSlotNum;
  }

  async findUIFiles(baseDir, charaPriority = 0) {
    console.log(`[DEBUG] Finding UI files in ${baseDir} for display name: ${this.displayFighterName}`);
    console.log(`[DEBUG] Base slot number: ${this.baseSlotNum}`);
    console.log(`[DEBUG] Fighter codename: ${this.fighterCodename}`);
    
    const foundSlots = {};

    // Prerequisites check
    if (!this.modRoot) {
      console.log('[DEBUG] findUIFiles: Mod root not set.');
      return foundSlots;
    }
    if (!this.displayFighterName) {
      console.log('[DEBUG] findUIFiles: Display fighter name not set.');
      return foundSlots;
    }
    if (this.baseSlotNum === null) {
      console.log('[DEBUG] findUIFiles: Base slot number not set.');
      return foundSlots;
    }

    const baseSlotNum = this.baseSlotNum;
    console.log(`[DEBUG] Using base slot number: c${baseSlotNum}`);

    // First, find which chara folder has the MOST files to use consistently
    let bestCharaFolder = null;
    let bestCharaPath = null;
    let maxFiles = 0;
    
    for (let charaNum = 0; charaNum <= 7; charaNum++) {
      const testPath = `${baseDir}/chara_${charaNum}`;
      const testExists = await fileExists(testPath);
      if (testExists) {
              try {
          const files = await scanDirectory(testPath);
          const matchingFiles = files.filter(f => {
            const fileName = f.split('/').pop().toLowerCase();
            return (fileName.endsWith('.bntx') || fileName.endsWith('.nutexb')) && 
                   fileName.includes(`_${this.displayFighterName}_`);
          });
          if (matchingFiles.length > maxFiles) {
            maxFiles = matchingFiles.length;
            bestCharaFolder = `chara_${charaNum}`;
            bestCharaPath = testPath;
                }
        } catch (e) {
          // Ignore scan errors
            }
          }
        }

    if (!bestCharaPath) {
      console.log('[DEBUG] No chara folder found with UI files');
      return foundSlots;
    }
    
    console.log(`[DEBUG] Using ${bestCharaFolder} as primary UI source (has ${maxFiles} matching files)`);

    // Now scan ONLY the best chara folder for consistency
            try {
      const uiFiles = await scanDirectory(bestCharaPath);
      console.log(`[DEBUG] All files in ${bestCharaPath}:`, uiFiles);
              
      for (const file of uiFiles) {
                const fileName = file.split('/').pop();
                const fileLower = fileName.toLowerCase();
                if (fileLower.endsWith('.bntx') || fileLower.endsWith('.nutexb')) {
                  const match = fileLower.match(/_(\d{2})\.(bntx|nutexb)$/);
                  if (match) {
                    const altNum = parseInt(match[1]);
                    const slot = `c${baseSlotNum + altNum}`;

            // Only accept files matching the display name
            const expectedPatternBase = `_${this.displayFighterName}_${altNum.toString().padStart(2, '0')}.`;
            
                      if (fileLower.includes(expectedPatternBase)) {
              foundSlots[slot] = `${bestCharaPath}/${fileName}`;
              console.log(`[DEBUG] Found UI file: ${fileName} -> slot ${slot}`);
                    }
                  }
                }
              }
            } catch (error) {
      console.error(`[DEBUG] Error scanning UI path: ${error}`);
    }

    // For slots without UI files in the best folder, create placeholders
    // Don't mix from other chara folders - use placeholders instead
    const physicalSlots = await this.getPhysicalSlots();
    for (const slot of physicalSlots) {
      if (!foundSlots[slot]) {
        foundSlots[slot] = `PLACEHOLDER_${slot}`;
        console.log(`[DEBUG] No UI file found for ${slot}, using placeholder`);
                }
    }

    console.log(`[DEBUG] Total slots found: ${Object.keys(foundSlots).length}`);
    this.foundSlots = foundSlots;
    return foundSlots;
  }
  
  async getPhysicalSlots() {
    const slots = [];
    if (!this.fighterCodename || !this.modRoot) return slots;
    
    const bodyPath = `${this.modRoot}/fighter/${this.fighterCodename}/model/body`;
    const bodyExists = await fileExists(bodyPath);
    if (bodyExists) {
      try {
        const dirs = await listDirectory(bodyPath);
        for (const dir of dirs) {
          if (/^c\d+$/.test(dir)) {
            slots.push(dir);
          }
        }
      } catch (e) {
        // Ignore errors
        }
      }
    return slots.sort((a, b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));
  }


  async _detectFighterAndSlots() {
    if (!this.modDirectory || !this.modFiles.length) {
      console.log('Cannot detect fighter/slots: Mod directory or mod file list not available.');
      this.fighterName = null;
      this.fighterSlots = [];
      return false;
    }

    // First, detect the display fighter name and codename
    await this.detectDisplayFighterName();
    await this.detectFighterCodename();
    await this.detectBaseSlotNumber();

    // Now find UI files to determine slots
    const uiBaseDir = `${this.modRoot}/ui/replace/chara`;
    const uiExists = await fileExists(uiBaseDir);
    
    if (uiExists) {
      await this.findUIFiles(uiBaseDir, 0);
      
      // Convert found slots to fighter slots
      this.fighterSlots = Object.keys(this.foundSlots).sort((a, b) => 
        parseInt(a.substring(1)) - parseInt(b.substring(1))
      );
      
      // Also scan .disabled folder for disabled alts
      await this.findDisabledSlots();
      
      this.fighterName = this.displayFighterName;
      console.log(`Detected fighter: ${this.fighterName}, Slots: ${this.fighterSlots}, Disabled slots: ${this.disabledSlots || []}`);
      return true;
    } else {
      console.log('Could not detect fighter/slots.');
      this.fighterName = null;
      this.fighterSlots = [];
      return false;
    }
  }

  _determineMainSlot() {
    if (!this.fighterSlots.length) {
      return null;
    }
    if (this.fighterSlots.includes('c00')) {
      return 'c00';
    }
    if (this.fighterSlots.includes('c01')) {
      return 'c01';
    }
    // Fallback to lowest numbered slot found
    return this.fighterSlots.reduce((a, b) => 
      parseInt(a.substring(1)) < parseInt(b.substring(1)) ? a : b
    );
  }

  _getFilesForSlot(slot) {
    if (!this.fighterName) {
      console.warn('Warning: Fighter name not detected, cannot accurately get files for slot.');
      return [];
    }

    const slotFiles = [];
    const slotPatternDir = `/${slot}/`;

    for (const filePath of this.modFiles) {
      const filePathNorm = filePath.replace(/\\/g, '/');

      // Standard path check (e.g., fighter/fighterName/motion/c00/)
      if (filePathNorm.includes(slotPatternDir)) {
        slotFiles.push(filePath);
        continue;
      }

      // Sound file check
      const baseName = filePathNorm.split('/').pop();
      if (filePathNorm.startsWith('sound/') && baseName.includes(`_${this.fighterName}_${slot}.`)) {
        slotFiles.push(filePath);
        continue;
      }

      // Camera check
      if (filePathNorm.startsWith(`camera/fighter/${this.fighterName}/${slot}/`)) {
        slotFiles.push(filePath);
        continue;
      }

      // UI Check
      if (filePathNorm.startsWith('ui/replace/chara/')) {
        try {
          if (!this.baseSlotNum) {
            console.log(`[DEBUG] Warning: baseSlotNum not set for slot ${slot}, skipping UI file check`);
            continue;
          }
          const altNum = parseInt(slot.substring(1)) - this.baseSlotNum;
          if (altNum >= 0) {
            const uiPattern = `_${this.fighterName}_${altNum.toString().padStart(2, '0')}.`;
            if (baseName.includes(uiPattern)) {
              slotFiles.push(filePath);
              continue;
            }
          }
        } catch (error) {
          // Slot format invalid
        }
      }

      // Effect checks
      if (filePathNorm.startsWith(`effect/fighter/${this.fighterName}/model/${slot}/`) ||
          filePathNorm.startsWith(`effect/fighter/${this.fighterName}/effect/${slot}/`)) {
        slotFiles.push(filePath);
        continue;
      }
    }

    return slotFiles;
  }

  _isPathSpecificallyInConfig(filePath) {
    if (!this.configData) {
      return false;
    }
    const checkPath = filePath.replace(/\\/g, '/');

    // Check new-dir-files lists
    for (const files of Object.values(this.configData['new-dir-files'] || {})) {
      if (Array.isArray(files) && files.includes(checkPath)) {
        return true;
      }
    }

    // Check share-to-added targets
    for (const targets of Object.values(this.configData['share-to-added'] || {})) {
      if (Array.isArray(targets) && targets.includes(checkPath)) {
        return true;
      }
    }

    // Check share-to-vanilla targets
    for (const targets of Object.values(this.configData['share-to-vanilla'] || {})) {
      if (Array.isArray(targets) && targets.includes(checkPath)) {
        return true;
      }
    }

    return false;
  }

  isPathInConfig(filePath, configData = null) {
    const config = configData || this.configData;
    
    if (!config) {
      return false;
    }
    
    const checkPath = filePath.replace(/\\/g, '/');
    
    // 1. Check exact path first (most precise)
    if (this._isPathSpecificallyInConfig(checkPath)) {
      return true;
    }
    
    // 2. Check if a parent directory is listed in new-dir-files
    for (const dirPath of Object.keys(config['new-dir-files'] || {})) {
      const dirPrefix = dirPath.endsWith('/') ? dirPath : dirPath + '/';
      if (checkPath.startsWith(dirPrefix)) {
        return true;
      }
    }
    
    return false;
  }

  async analyze(modFiles) {
    if (!this.modDirectory) {
      console.error('Error: Mod directory not set. Cannot analyze.');
      this.analysisResults = {
        errors: [{ type: 'analysis_error', message: 'Mod directory not set.' }],
        warnings: [],
        optimizations: []
      };
      return this.analysisResults;
    }

    this.modFiles = modFiles;
    console.log(`Fast analyzing ${this.modFiles.length} mod files in ${this.modDirectory}...`);
    
    // Reset results, keeping load errors
    const loadErrors = this.analysisResults.errors.filter(
      e => ['json_decode', 'config_load'].includes(e.type)
    );
    this.analysisResults = {
      errors: loadErrors,
      warnings: [],
      optimizations: []
    };

    const configExists = await fileExists(`${this.modDirectory}/config.json`);
    
    // Ensure config is loaded if it exists
    if (this.configData === null && configExists) {
      console.log('Config exists but not loaded, attempting to load now...');
      await this.loadConfig();
    }

    // Basic Config Status
    if (this.configData === null && configExists) {
      console.log('Config file exists but failed to load or parse.');
    } else if (!configExists) {
      this.analysisResults.warnings.push({
        type: 'config_missing',
        message: 'config.json not found. Analysis limited.'
      });
    } else if (Object.keys(this.configData).length === 0) {
      this.analysisResults.warnings.push({
        type: 'config_empty',
        message: 'config.json is empty or missing. Analysis may be inaccurate.'
      });
    }

    // Fighter/Slot Detection (fast - just reads UI files and folders)
    // NOTE: Duplicate analysis is skipped for performance - it was never displayed in the UI
    // and added significant load time with binary file comparisons
    if (await this._detectFighterAndSlots() && this.fighterSlots.length) {
      this.mainSlot = this._determineMainSlot();
      console.log(`Detected fighter: ${this.fighterName}, main slot: ${this.mainSlot}`);
    }

    // NOTE: All config integrity checks have been removed for performance
    // The analysis panel was never displayed in the UI, so these checks were wasted cycles
    // If you need to re-enable analysis, uncomment the code below or implement a separate "Deep Analysis" button

    /*
    // CONFIG INTEGRITY CHECKS - DISABLED FOR PERFORMANCE
    // Original checks included:
    // 1. Files explicitly listed in new-dir-files must exist
    // 2. Source files listed in share-to-added must exist  
    // 3. Files in mod folder but not covered by config
    // 4. Animation files that should be shared to other slots
    //
    // These all required file existence checks and config iteration
    // which significantly slowed down initial load for no visible benefit
    */

    console.log(`Fast analysis complete for ${this.fighterName || 'unknown fighter'}`);
    return this.analysisResults;
  }

  async loadAltPreviews() {
    console.log('[DEBUG] Starting loadAltPreviews');
    
    if (!this.modRoot || !this.foundSlots) {
      console.log('[DEBUG] Cannot load alt previews: modRoot or foundSlots not set.');
      return {};
    }

    const pngPaths = {};
    
    // Get absolute path for the temp directory
    // In production, use the exe directory; in dev, use project root
    let absoluteTempDir;
    try {
      const remote = window.require('@electron/remote') || window.require('electron').remote;
      const appPath = remote.app.getPath('exe');
      const path = window.require('path');
      const isDev = !appPath.includes('win-unpacked') && !appPath.includes('.exe');
      
      if (isDev || appPath.includes('electron.exe')) {
        absoluteTempDir = process.cwd() + '/temp_previews';
      } else {
        absoluteTempDir = path.join(path.dirname(appPath), 'temp_previews');
      }
    } catch (e) {
      // Fallback to process.cwd() if remote is not available
      absoluteTempDir = process.cwd() + '/temp_previews';
    }
    
    console.log(`[DEBUG] Using temp directory: ${absoluteTempDir}`);
    
    // Ensure temp directory exists
    try {
      await createDirectory(absoluteTempDir);
    } catch (error) {
      console.log(`[DEBUG] Error creating temp directory: ${error}`);
    }

    // Convert each UI file to PNG
    for (const [slotId, uiFile] of Object.entries(this.foundSlots)) {
      console.log(`[DEBUG] Processing texture for slot ${slotId}: ${uiFile}`);
      
      // Skip placeholder files for now (we'll handle them differently)
      if (uiFile.startsWith('PLACEHOLDER_')) {
        console.log(`[DEBUG] Skipping placeholder file: ${uiFile}`);
        continue;
      }

      // Extract the original alt number from the filename instead of calculating from slot ID
      // This ensures we get the correct alt number even after file reordering
      const filename = uiFile.split(/[\\/]/).pop(); // Get just the filename
      const altMatch = filename.match(/_(\d{2})\.(bntx|nutexb)$/);
      
      let altNum;
      if (altMatch) {
        // Extract alt number from filename (e.g., "brolyz_11.bntx" -> 11)
        altNum = parseInt(altMatch[1]);
        console.log(`[DEBUG] Extracted alt number ${altNum} from filename: ${filename}`);
      } else {
        // Fallback to slot-based calculation if filename doesn't match pattern
        altNum = parseInt(slotId.substring(1)) - this.baseSlotNum;
        console.log(`[DEBUG] Fallback: calculated alt number ${altNum} from slot ${slotId}`);
      }
      
      const pngFilename = `alt_${altNum}.png`;
      const pngPath = `${absoluteTempDir}/${pngFilename}`;

      console.log(`[DEBUG] Converting to PNG: ${uiFile} -> ${pngPath} (alt ${altNum})`);

      try {
        // Convert BNTX to PNG
        const convertedPath = await this.convertBntxToPng(uiFile, pngPath);
        
        if (convertedPath) {
          pngPaths[slotId] = convertedPath;
          console.log(`[DEBUG] Conversion successful: ${pngPath}`);
        } else {
          console.log(`[DEBUG] Warning: Failed to convert ${pngFilename} for ${slotId}`);
        }
      } catch (error) {
        console.log(`[DEBUG] Error converting ${uiFile}: ${error}`);
      }
    }

    // Load disabled slot UI images
    await this.loadDisabledSlotPreviews(pngPaths, absoluteTempDir);

    console.log(`[DEBUG] Loaded ${Object.keys(pngPaths).length} alt previews`);
    return pngPaths;
  }

  async loadDisabledSlotPreviews(pngPaths, tempDir) {
    console.log('[DEBUG] Loading disabled slot previews');
    
    if (!this.modRoot || !this.disabledSlots) {
      console.log('[DEBUG] Cannot load disabled slot previews: modRoot or disabledSlots not set.');
      return;
    }

    const disabledDir = `${this.modRoot}/.disabled`;
    const disabledExists = await fileExists(disabledDir);
    
    if (!disabledExists) {
      console.log('[DEBUG] No disabled directory found');
      return;
    }

    // Process each disabled slot
    for (const disabledSlotInfo of this.disabledSlots) {
      const originalSlot = disabledSlotInfo.originalSlot;
      const folder = disabledSlotInfo.folder;
      const disabledFolderPath = `${disabledDir}/${folder}`;
      
      console.log(`[DEBUG] Processing disabled slot: ${originalSlot} in ${folder}`);
      
              // Look for UI files in the disabled folder first
        const disabledUIPath = `${disabledFolderPath}/ui/replace/chara`;
        console.log(`[DEBUG] Checking UI path: ${disabledUIPath}`);
        console.log(`[DEBUG] Disabled folder path: ${disabledFolderPath}`);
        const uiExists = await fileExists(disabledUIPath);
      
      if (!uiExists) {
        console.log(`[DEBUG] No UI directory found for disabled slot ${originalSlot} at path: ${disabledUIPath}`);
        
        // Let's check what's actually in the disabled folder
        try {
          const disabledFolderContents = await listDirectory(disabledFolderPath);
          console.log(`[DEBUG] Disabled folder contents: ${disabledFolderContents}`);
          
          // Check if there's a ui folder
          if (disabledFolderContents.includes('ui')) {
            const uiFolderPath = `${disabledFolderPath}/ui`;
            const uiFolderContents = await listDirectory(uiFolderPath);
            console.log(`[DEBUG] UI folder contents: ${uiFolderContents}`);
            
            if (uiFolderContents.includes('replace')) {
              const replaceFolderPath = `${uiFolderPath}/replace`;
              const replaceFolderContents = await listDirectory(replaceFolderPath);
              console.log(`[DEBUG] Replace folder contents: ${replaceFolderContents}`);
              
              if (replaceFolderContents.includes('chara')) {
                const charaFolderPath = `${replaceFolderPath}/chara`;
                const charaFolderContents = await listDirectory(charaFolderPath);
                console.log(`[DEBUG] Chara folder contents: ${charaFolderContents}`);
              }
            }
          }
        } catch (error) {
          console.log(`[DEBUG] Error checking disabled folder structure: ${error}`);
        }
        
        // If no UI files in disabled folder, try to find them in the main mod folder
        console.log(`[DEBUG] Trying to find UI files in main mod folder for disabled slot ${originalSlot}`);
        const mainUIPath = `${this.modRoot}/ui/replace/chara`;
        const mainUIExists = await fileExists(mainUIPath);
        
        if (mainUIExists) {
          console.log(`[DEBUG] Found main UI path: ${mainUIPath}`);
          // Use the same logic as the main UI loading to find the correct file
          const slotNum = parseInt(originalSlot.substring(1));
          const altNum = slotNum - this.baseSlotNum;
          console.log(`[DEBUG] Looking for alt number ${altNum} for disabled slot ${originalSlot}`);
          
          try {
            const uiFiles = await listDirectory(mainUIPath);
            console.log(`[DEBUG] Main UI subdirectories: ${uiFiles}`);
            
            for (const uiFile of uiFiles) {
              if (uiFile.match(/^chara_\d+$/)) {
                const charaPath = `${mainUIPath}/${uiFile}`;
                const charaFiles = await listDirectory(charaPath);
                console.log(`[DEBUG] Main chara files in ${uiFile}: ${charaFiles}`);
                
                for (const charaFile of charaFiles) {
                  if (charaFile.match(/\.(bntx|nutexb)$/)) {
                    // Extract alt number from filename
                    const match = charaFile.toLowerCase().match(/(?:[a-z]+_)?(\d{2})\.(bntx|nutexb)$/);
                    if (match) {
                      const fileAltNum = parseInt(match[1]);
                      console.log(`[DEBUG] File ${charaFile} has alt number ${fileAltNum}`);
                      if (fileAltNum === altNum) {
                        const uiFilePath = `${charaPath}/${charaFile}`;
                        console.log(`[DEBUG] Found UI file for disabled slot ${originalSlot}: ${uiFilePath}`);
                        
                        // Convert to PNG
                        const pngPath = `${tempDir}/disabled_alt_${altNum}.png`;
                        try {
                          await this.convertBntxToPng(uiFilePath, pngPath);
                          // Add to pngPaths using the disabled slot ID
                          pngPaths[disabledSlotInfo.disabledSlotId] = pngPath;
                          console.log(`[DEBUG] Successfully loaded disabled slot UI: ${originalSlot} (${disabledSlotInfo.disabledSlotId}) -> ${pngPath}`);
                          break;
                        } catch (error) {
                          console.log(`[DEBUG] Error converting disabled slot UI: ${error}`);
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch (error) {
            console.log(`[DEBUG] Error scanning main UI directory: ${error}`);
          }
        }
        
        // Also try to find UI files in the disabled folder using the same method as main folder
        console.log(`[DEBUG] Trying to find UI files in disabled folder using main folder method`);
        // disabledUIPath already declared above, reuse it
        const disabledUIExists = await fileExists(disabledUIPath);
        
        if (disabledUIExists) {
          console.log(`[DEBUG] Found disabled UI path: ${disabledUIPath}`);
          const slotNum = parseInt(originalSlot.substring(1));
          const altNum = slotNum - this.baseSlotNum;
          console.log(`[DEBUG] Looking for alt number ${altNum} for disabled slot ${originalSlot} in disabled folder`);
          
          try {
            const uiFiles = await listDirectory(disabledUIPath);
            console.log(`[DEBUG] Disabled UI subdirectories: ${uiFiles}`);
            
            for (const uiFile of uiFiles) {
              if (uiFile.match(/^chara_\d+$/)) {
                const charaPath = `${disabledUIPath}/${uiFile}`;
                const charaFiles = await listDirectory(charaPath);
                console.log(`[DEBUG] Disabled chara files in ${uiFile}: ${charaFiles}`);
                
                for (const charaFile of charaFiles) {
                  if (charaFile.match(/\.(bntx|nutexb)$/)) {
                    // Extract alt number from filename
                    const match = charaFile.toLowerCase().match(/(?:[a-z]+_)?(\d{2})\.(bntx|nutexb)$/);
                    if (match) {
                      const fileAltNum = parseInt(match[1]);
                      console.log(`[DEBUG] Disabled file ${charaFile} has alt number ${fileAltNum}`);
                      if (fileAltNum === altNum) {
                        const uiFilePath = `${charaPath}/${charaFile}`;
                        console.log(`[DEBUG] Found UI file for disabled slot ${originalSlot} in disabled folder: ${uiFilePath}`);
                        
                        // Convert to PNG
                        const pngPath = `${tempDir}/disabled_alt_${altNum}.png`;
                        try {
                          await this.convertBntxToPng(uiFilePath, pngPath);
                          // Add to pngPaths using the disabled slot ID
                          pngPaths[disabledSlotInfo.disabledSlotId] = pngPath;
                          console.log(`[DEBUG] Successfully loaded disabled slot UI from disabled folder: ${originalSlot} (${disabledSlotInfo.disabledSlotId}) -> ${pngPath}`);
                          break;
                        } catch (error) {
                          console.log(`[DEBUG] Error converting disabled slot UI: ${error}`);
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch (error) {
            console.log(`[DEBUG] Error scanning disabled UI directory: ${error}`);
          }
        }
        
        continue;
      }

      // Find UI files for this disabled slot
      try {
        const uiFiles = await listDirectory(disabledUIPath);
        console.log(`[DEBUG] Found UI subdirectories/files: ${uiFiles}`);
        let bestUIFile = null;
        
        // Look for UI files in chara_0, chara_1, etc. subdirectories
        for (const uiFile of uiFiles) {
          console.log(`[DEBUG] Checking UI item: ${uiFile}`);
          if (uiFile.match(/^chara_\d+$/)) {
            // This is a chara subdirectory, look inside it
            const charaPath = `${disabledUIPath}/${uiFile}`;
            console.log(`[DEBUG] Checking chara subdirectory: ${charaPath}`);
            const charaFiles = await listDirectory(charaPath);
            console.log(`[DEBUG] Found chara files: ${charaFiles}`);
            
            // If charaFiles is empty, let's check if the directory actually exists and has files
            if (charaFiles.length === 0) {
              console.log(`[DEBUG] No files found in ${charaPath}, checking if directory exists`);
              const dirExists = await fileExists(charaPath);
              console.log(`[DEBUG] Directory exists: ${dirExists}`);
              
              if (dirExists) {
                // Try to list files again, maybe there was an issue
                try {
                  const retryFiles = await listDirectory(charaPath);
                  console.log(`[DEBUG] Retry listing files: ${retryFiles}`);
                  
                  // Try using IPC to list files directly
                  try {
                    const ipcFiles = await window.electronAPI.listDirectory(charaPath);
                    console.log(`[DEBUG] IPC listDirectory result: ${ipcFiles}`);
                  } catch (error) {
                    console.log(`[DEBUG] Error with IPC listDirectory: ${error}`);
                  }
                } catch (error) {
                  console.log(`[DEBUG] Error listing files in ${charaPath}: ${error}`);
                }
              }
            }
            
            for (const charaFile of charaFiles) {
              if (charaFile.match(/\.(bntx|nutexb)$/)) {
                bestUIFile = `${charaPath}/${charaFile}`;
                console.log(`[DEBUG] Found UI file in ${uiFile}: ${charaFile}`);
                break;
              }
            }
            if (bestUIFile) break;
          } else if (uiFile.match(/\.(bntx|nutexb)$/)) {
            // Direct UI file
            bestUIFile = `${disabledUIPath}/${uiFile}`;
            console.log(`[DEBUG] Found direct UI file: ${uiFile}`);
            break;
          }
        }
        
        if (bestUIFile) {
          // Extract alt number from filename
          const filename = bestUIFile.split(/[\\/]/).pop();
          const altMatch = filename.match(/_(\d{2})\.(bntx|nutexb)$/);
          
          let altNum;
          if (altMatch) {
            altNum = parseInt(altMatch[1]);
          } else {
            altNum = parseInt(originalSlot.substring(1)) - this.baseSlotNum;
          }
          
          const pngFilename = `disabled_alt_${altNum}.png`;
          const pngPath = `${tempDir}/${pngFilename}`;
          
          console.log(`[DEBUG] Converting disabled slot UI: ${bestUIFile} -> ${pngPath} (alt ${altNum})`);
          
          try {
            const convertedPath = await this.convertBntxToPng(bestUIFile, pngPath);
            if (convertedPath) {
              // Use the disabledSlotId which always has the "disabled_" prefix
              pngPaths[disabledSlotInfo.disabledSlotId] = convertedPath;
              console.log(`[DEBUG] Disabled slot conversion successful: ${pngPath} for ${disabledSlotInfo.disabledSlotId}`);
              console.log(`[DEBUG] Added to pngPaths with key: ${disabledSlotInfo.disabledSlotId}`);
            }
          } catch (error) {
            console.log(`[DEBUG] Error converting disabled slot UI: ${error}`);
          }
        } else {
          console.log(`[DEBUG] No UI files found for disabled slot ${originalSlot}`);
        }
      } catch (error) {
        console.log(`[DEBUG] Error scanning disabled UI directory: ${error}`);
      }
    }
  }

  async convertBntxToPng(bntxFile, outputPngPath) {
    console.log(`[DEBUG] Converting BNTX to PNG: ${bntxFile} -> ${outputPngPath}`);
    
    // Early escape for placeholder files
    if (bntxFile.startsWith('PLACEHOLDER_')) {
      console.log(`[DEBUG] Skipping conversion for placeholder file: ${bntxFile}`);
      return null;
    }

    // Check if source file exists
    const sourceExists = await fileExists(bntxFile);
    if (!sourceExists) {
      console.log(`[DEBUG] Error loading image ${bntxFile}: File not found`);
      return null;
    }

    try {
      // Try to find ultimate_tex_cli.exe in common locations
      // Include production paths for packaged app
      let productionPath = './ultimate_tex_cli.exe';
      try {
        const remote = window.require('@electron/remote') || window.require('electron').remote;
        const appPath = remote.app.getPath('exe');
        const pathModule = window.require('path');
        productionPath = pathModule.join(pathModule.dirname(appPath), 'ultimate_tex_cli.exe');
      } catch (e) {
        // Ignore if remote is not available
      }
      
      const possiblePaths = [
        productionPath,
        './ultimate_tex_cli.exe',
        '../ultimate_tex_cli.exe',
        '../../ultimate_tex_cli.exe',
        './tools/ultimate_tex_cli.exe',
        '../tools/ultimate_tex_cli.exe'
      ];

      let ultimateTexPath = null;
      for (const checkPath of possiblePaths) {
        const exists = await fileExists(checkPath);
        if (exists) {
          ultimateTexPath = checkPath;
          console.log(`[DEBUG] Found ultimate_tex_cli.exe at: ${checkPath}`);
          break;
        }
      }

      if (!ultimateTexPath) {
        console.log(`[DEBUG] ultimate_tex_cli.exe not found, creating placeholder image`);
        return await this.createPlaceholderImage(bntxFile, outputPngPath);
      }

      // Use ultimate_tex_cli.exe to convert BNTX to PNG
      console.log(`[DEBUG] Using ultimate_tex_cli.exe to convert: ${bntxFile}`);
      
      // Call the conversion tool via IPC
      const result = await ipcRenderer.invoke('convert-bntx-to-png', {
        inputFile: bntxFile,
        outputFile: outputPngPath,
        toolPath: ultimateTexPath
      });

      if (result.success) {
        console.log(`[DEBUG] Conversion successful: ${outputPngPath}`);
        return outputPngPath;
      } else {
        console.log(`[DEBUG] Conversion failed: ${result.error}`);
        // Fallback to placeholder
        return await this.createPlaceholderImage(bntxFile, outputPngPath);
      }
    } catch (error) {
      console.log(`[DEBUG] Error during conversion for ${bntxFile}: ${error}`);
      // Fallback to placeholder
      return await this.createPlaceholderImage(bntxFile, outputPngPath);
    }
  }

  async createPlaceholderImage(bntxFile, outputPngPath) {
    console.log(`[DEBUG] Creating placeholder image for ${bntxFile}`);
    
    // Create a simple 128x128 placeholder image
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    
    // Fill with dark gray background
    ctx.fillStyle = '#3e3e3e';
    ctx.fillRect(0, 0, 128, 128);
    
    // Add text
    ctx.fillStyle = '#cccccc';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Extract alt number from filename
    const filename = bntxFile.split('/').pop();
    const match = filename.match(/_(\d{2})\./);
    const altNum = match ? match[1] : '??';
    
    ctx.fillText(`Alt ${altNum}`, 64, 64);
    ctx.font = '10px Arial';
    ctx.fillStyle = '#999999';
    ctx.fillText('Preview', 64, 80);
    
    // Convert canvas to blob and save
    return new Promise((resolve) => {
      canvas.toBlob(async (blob) => {
        try {
          const arrayBuffer = await blob.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          await writeFile(outputPngPath, uint8Array);
                console.log(`[DEBUG] Created placeholder image: ${outputPngPath}`);
      resolve(outputPngPath);
    } catch (error) {
      console.log(`[DEBUG] Error saving placeholder image: ${error}`);
      resolve(null);
    }
  }, 'image/png');
});
  }

  async findDisabledSlots() {
    try {
      const disabledDir = `${this.modRoot}/.disabled`;
      const disabledExists = await fileExists(disabledDir);
      
      if (!disabledExists) {
        this.disabledSlots = [];
        return;
      }
      
      // Get all disabled folders (only top-level directories)
      const disabledFolders = await listDirectory(disabledDir);
      const disabledSlotsInfo = [];
      
      for (const folder of disabledFolders) {
        // Extract slot name from folder name
        // Handles both:
        // - "c105_1234567890" -> "c105" (from disable operation)
        // - "disabled_c109_1234567890" -> "c109" (from import operation)
        let slot, timestamp, disabledSlotId;
        
        // Try pattern 1: disabled_cXXX_timestamp (imported alts)
        const importedMatch = folder.match(/^disabled_(c\d+)_(\d+)$/);
        if (importedMatch) {
          slot = importedMatch[1];
          timestamp = importedMatch[2];
          disabledSlotId = folder; // Already has correct format
        } else {
          // Try pattern 2: cXXX_timestamp (disabled enabled alts)
          const disabledMatch = folder.match(/^(c\d+)_(\d+)$/);
          if (disabledMatch) {
            slot = disabledMatch[1];
            timestamp = disabledMatch[2];
            disabledSlotId = `disabled_${slot}_${timestamp}`;
          }
        }
        
        if (slot) {
          disabledSlotsInfo.push({
            originalSlot: slot,
            folder: folder,
            disabledSlotId: disabledSlotId,
            timestamp: timestamp
          });
          
          console.log(`[DEBUG] Found disabled slot: ${slot} in folder: ${folder}, disabledSlotId: ${disabledSlotId}`);
        }
      }
      
      // Sort by original slot number
      disabledSlotsInfo.sort((a, b) => 
        parseInt(a.originalSlot.substring(1)) - parseInt(b.originalSlot.substring(1))
      );
      
      this.disabledSlots = disabledSlotsInfo;
      
      console.log(`[DEBUG] Found ${this.disabledSlots.length} disabled slots: ${this.disabledSlots.map(s => s.originalSlot)}`);
    } catch (error) {
      console.log(`[DEBUG] Error finding disabled slots: ${error.message}`);
      this.disabledSlots = [];
    }
  }
} 