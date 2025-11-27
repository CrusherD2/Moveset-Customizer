import React, { useState, useEffect } from 'react';
import { MovesetCustomizer } from './utils/movesetCustomizer';
import { scanDirectory, applySlotChanges, restoreDisabledSlots } from './utils/fileUtils';
import Header from './components/Header';
import SlotGrid from './components/SlotGrid';
import StatusBar from './components/StatusBar';
import ImportModal from './components/ImportModal';
import ConfirmModal from './components/ConfirmModal';
import './App.css';

const { ipcRenderer } = window.require('electron');
const fs = window.require('fs');

// Add debug message listener
ipcRenderer.on('debug-message', (event, message) => {
  console.log(`[DEBUG] Main process message: ${message}`);
});

function App() {
  const [modDirectory, setModDirectory] = useState('');
  const [customizer, setCustomizer] = useState(null);
  const [modFiles, setModFiles] = useState([]);
  const [analysisResults, setAnalysisResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [slots, setSlots] = useState([]);
  const [enabledSlots, setEnabledSlots] = useState([]);
  const [disabledSlots, setDisabledSlots] = useState([]);
  const [altPreviews, setAltPreviews] = useState({});
  const [slotMapping, setSlotMapping] = useState({}); // Track slot reordering
  const [imageCacheKey, setImageCacheKey] = useState(Date.now());
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importData, setImportData] = useState(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [progress, setProgress] = useState(null); // { current, total, message }
  
  // Listen for progress updates from backend
  useEffect(() => {
    const handleProgress = (event, progressData) => {
      setProgress(progressData);
      if (progressData.message) {
        setStatus(progressData.message);
      }
      // Clear progress when complete
      if (progressData.current >= progressData.total) {
        setTimeout(() => setProgress(null), 1500);
      }
    };
    
    ipcRenderer.on('operation-progress', handleProgress);
    
    return () => {
      ipcRenderer.removeListener('operation-progress', handleProgress);
    };
  }, []);
  
  // Track if there are unapplied changes (disables, enables, reordering)
  const hasUnappliedChanges = React.useMemo(() => {
    // Check if slotMapping has entries (reordering)
    if (Object.keys(slotMapping).length > 0) return true;
    
    // Check if any enabled slot is a disabled_* ID (re-enabled but not applied)
    if (enabledSlots.some(slot => slot.id && slot.id.startsWith('disabled_'))) return true;
    
    // Check if any slot without disabled_ prefix is in disabled list
    // (this means it was disabled but not applied)
    if (disabledSlots.some(slot => slot.id && !slot.id.startsWith('disabled_'))) return true;
    
    return false;
  }, [slotMapping, enabledSlots, disabledSlots]);

  useEffect(() => {
    // Initialize the customizer
    const newCustomizer = new MovesetCustomizer();
    setCustomizer(newCustomizer);
  }, []);

  const selectModDirectory = async () => {
    try {
      setLoading(true);
      setStatus('Selecting mod directory...');
      
      const selectedPath = await ipcRenderer.invoke('select-directory');
      if (!selectedPath) {
        setStatus('No directory selected');
        setLoading(false);
        return;
      }

      setModDirectory(selectedPath);
      setStatus(`Loading mod from: ${selectedPath}`);
      
      // Set the directory in the customizer
      const success = await customizer.setMovesetDirectory(selectedPath);
      if (!success) {
        setStatus('Failed to set mod directory');
        setLoading(false);
        return;
      }

      // Scan the directory for files
      const files = await scanDirectory(selectedPath);
      setModFiles(files);
      setStatus(`Found ${files.length} files`);

      // Analyze the mod
      setStatus('Analyzing mod...');
      const results = await customizer.analyze(files);
      setAnalysisResults(results);
      
      // Load slots
      await loadSlots();
      
      // Load alt previews
          const altPreviews = await customizer.loadAltPreviews();
    console.log('Loaded alt previews:', altPreviews);
    console.log('Alt previews keys:', Object.keys(altPreviews));
    setAltPreviews(altPreviews);
    setImageCacheKey(Date.now()); // Force image cache refresh
      
      setStatus(`Loaded '${customizer.displayFighterName || 'Unknown'}' (codename: ${customizer.fighterCodename}, base: ${customizer.baseSlotNum !== null ? `c${customizer.baseSlotNum}` : 'unknown'}) from ${selectedPath.split(/[\\/]/).pop() || selectedPath.split(/[\\/]/).pop()}`);
    } catch (error) {
      console.error('Error loading mod:', error);
      setStatus(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadSlots = async () => {
    if (!customizer || !customizer.fighterSlots) {
      return;
    }

    // Use the found slots from UI detection
    const foundSlots = customizer.foundSlots;
    const allSlots = [];

    // Load enabled slots
    for (const [slotId, uiFile] of Object.entries(foundSlots)) {
      const altNumber = parseInt(slotId.substring(1)) - parseInt(customizer.baseSlotNum || '0');
      
      allSlots.push({
        id: slotId,
        name: slotId,
        enabled: true,
        altNumber: altNumber,
        baseSlot: slotId,
        uiFile: uiFile,
        isPlaceholder: uiFile.startsWith('PLACEHOLDER_')
      });
    }

    // Load disabled slots from customizer
    if (customizer.disabledSlots && customizer.disabledSlots.length > 0) {
      for (const disabledSlotInfo of customizer.disabledSlots) {
        const altNumber = parseInt(disabledSlotInfo.originalSlot.substring(1)) - parseInt(customizer.baseSlotNum || '0');
        
        const disabledSlot = {
          id: disabledSlotInfo.disabledSlotId,
          name: disabledSlotInfo.originalSlot,
          enabled: false,
          altNumber: altNumber,
          baseSlot: disabledSlotInfo.originalSlot,
          uiFile: `DISABLED_${disabledSlotInfo.originalSlot}`, // Placeholder for disabled slots
          isPlaceholder: false, // Changed to false so it can use altPreview
          folder: disabledSlotInfo.folder,
          timestamp: disabledSlotInfo.timestamp
        };
        
        console.log('Created disabled slot:', disabledSlot);
        allSlots.push(disabledSlot);
      }
    }

    // Sort slots by their numeric order
    allSlots.sort((a, b) => {
      // Handle disabled slots differently (they have format "disabled_cXXX_timestamp")
      if (a.id.startsWith('disabled_') && b.id.startsWith('disabled_')) {
        // Extract slot number from disabled slot ID (e.g., "disabled_c118_123" -> 118)
        const aMatch = a.id.match(/disabled_c(\d+)_/);
        const bMatch = b.id.match(/disabled_c(\d+)_/);
        if (aMatch && bMatch) {
          return parseInt(aMatch[1]) - parseInt(bMatch[1]);
        }
        return 0;
      } else if (a.id.startsWith('disabled_')) {
        return 1; // Disabled slots go after enabled slots
      } else if (b.id.startsWith('disabled_')) {
        return -1; // Enabled slots go before disabled slots
      } else {
        // Regular slot sorting (e.g., "c104" -> 104)
        return parseInt(a.id.substring(1)) - parseInt(b.id.substring(1));
      }
    });

    setSlots(allSlots);
    setEnabledSlots(allSlots.filter(slot => slot.enabled));
    setDisabledSlots(allSlots.filter(slot => !slot.enabled));
    
    // Initialize slot mapping (no reordering initially)
    setSlotMapping({});
  };

  const toggleSlot = (slotId) => {
    setSlots(prevSlots => {
      const updatedSlots = prevSlots.map(slot => 
        slot.id === slotId ? { ...slot, enabled: !slot.enabled } : slot
      );
      
      setEnabledSlots(updatedSlots.filter(slot => slot.enabled));
      setDisabledSlots(updatedSlots.filter(slot => !slot.enabled));
      
      return updatedSlots;
    });
  };

  const reorderSlots = (sourceIndex, destinationIndex, sourceDroppableId, destinationDroppableId) => {
    const sourceList = sourceDroppableId === 'enabled' ? enabledSlots : disabledSlots;
    const destList = destinationDroppableId === 'enabled' ? enabledSlots : disabledSlots;
    
    const [removed] = sourceList.splice(sourceIndex, 1);
    destList.splice(destinationIndex, 0, removed);
    
    if (sourceDroppableId === destinationDroppableId) {
      if (sourceDroppableId === 'enabled') {
        setEnabledSlots([...destList]);
        
        // Update slot mapping for reordering within enabled slots
        if (sourceDroppableId === 'enabled' && destinationDroppableId === 'enabled') {
          updateSlotMapping([...destList]);
        }
      } else {
        setDisabledSlots([...destList]);
      }
    } else {
      setEnabledSlots(destinationDroppableId === 'enabled' ? [...destList] : [...sourceList]);
      setDisabledSlots(destinationDroppableId === 'disabled' ? [...destList] : [...sourceList]);
      
      // Update slot mapping if moving to/from enabled slots
      if (destinationDroppableId === 'enabled') {
        updateSlotMapping([...destList]);
      }
    }
  };

  const updateSlotMapping = (newEnabledSlots) => {
    if (!customizer || !customizer.baseSlotNum) return;
    
    const baseSlotNum = customizer.baseSlotNum;
    const newMapping = {};
    
    // Create a mapping from visual position to actual slot
    const visualToActual = {};
    for (let i = 0; i < newEnabledSlots.length; i++) {
      const visualSlot = `c${baseSlotNum + i}`;
      const actualSlot = newEnabledSlots[i].id;
      visualToActual[visualSlot] = actualSlot;
    }
    
    // Create cascading shifts based on the visual order
    // This matches the Python implementation's logic
    for (let i = 0; i < newEnabledSlots.length; i++) {
      const expectedSlot = `c${baseSlotNum + i}`;
      const actualSlot = newEnabledSlots[i].id;
      
      // Only add to mapping if the slot is not in its expected position
      if (expectedSlot !== actualSlot) {
        newMapping[actualSlot] = expectedSlot;
      }
    }
    
    console.log(`[DEBUG] Updated slot mapping:`, newMapping);
    console.log(`[DEBUG] Visual to actual mapping:`, visualToActual);
    setSlotMapping(newMapping);
  };

  const reloadModFolder = async () => {
    try {
      setStatus('Reloading mod folder...');
      
      // Clear ALL state completely
      setEnabledSlots([]);
      setDisabledSlots([]);
      setSlotMapping({});
      setAltPreviews({});
      setAnalysisResults(null);
      setModFiles([]);
      
      // Create a completely fresh customizer instance
      const freshCustomizer = new MovesetCustomizer();
      setCustomizer(freshCustomizer);
      
      // Re-scan the directory for files
      const files = await scanDirectory(modDirectory);
      setModFiles(files);
      
      // Set the directory in the fresh customizer
      const success = await freshCustomizer.setMovesetDirectory(modDirectory);
      if (!success) {
        throw new Error('Failed to set mod directory during reload');
      }
      
      // Re-analyze the mod completely
      const results = await freshCustomizer.analyze(files);
      setAnalysisResults(results);
      
      // Re-detect fighter and slots to get updated foundSlots
      await freshCustomizer._detectFighterAndSlots();
      
      // Reload slots with fresh data (after re-detection)
      const foundSlots = freshCustomizer.foundSlots;
      const allSlots = [];

      // Load enabled slots
      for (const [slotId, uiFile] of Object.entries(foundSlots)) {
        const altNumber = parseInt(slotId.substring(1)) - parseInt(freshCustomizer.baseSlotNum || '0');
        
        allSlots.push({
          id: slotId,
          name: slotId,
          enabled: true,
          altNumber: altNumber,
          uiFile: uiFile
        });
      }

      // Load disabled slots from fresh customizer
      if (freshCustomizer.disabledSlots && freshCustomizer.disabledSlots.length > 0) {
        for (const disabledSlotInfo of freshCustomizer.disabledSlots) {
          const originalSlot = disabledSlotInfo.originalSlot;
          const altNumber = parseInt(originalSlot.substring(1)) - parseInt(freshCustomizer.baseSlotNum || '0');
          
          allSlots.push({
            id: disabledSlotInfo.disabledSlotId,
            name: originalSlot,
            enabled: false,
            altNumber: altNumber,
            uiFile: `DISABLED_${originalSlot}`, // Placeholder for disabled slots
            isPlaceholder: false, // Changed to false so it can use altPreview
            folder: disabledSlotInfo.folder,
            timestamp: disabledSlotInfo.timestamp
          });
        }
      }

      // Sort slots by their ID
      allSlots.sort((a, b) => {
        const aNum = parseInt(a.id.substring(1));
        const bNum = parseInt(b.id.substring(1));
        return aNum - bNum;
      });

      setEnabledSlots(allSlots.filter(slot => slot.enabled));
      setDisabledSlots(allSlots.filter(slot => !slot.enabled));
      
      // Clear any existing temp previews and reload alt previews
      try {
        const tempDir = process.cwd() + '/temp_previews';
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          console.log('[DEBUG] Cleared existing temp previews');
        }
      } catch (error) {
        console.log('[DEBUG] Error clearing temp previews:', error);
      }
      
      // Reload alt previews with updated foundSlots
      const altPreviews = await freshCustomizer.loadAltPreviews();
      console.log('Reloaded alt previews:', altPreviews);
      setAltPreviews(altPreviews);
      setImageCacheKey(Date.now()); // Force image cache refresh
      
      setStatus(`Reloaded '${freshCustomizer.displayFighterName || 'Unknown'}' (codename: ${freshCustomizer.fighterCodename}, base: ${freshCustomizer.baseSlotNum !== null ? `c${freshCustomizer.baseSlotNum}` : 'unknown'}) from ${modDirectory.split(/[\\/]/).pop() || modDirectory.split(/[\\/]/).pop()}`);
    } catch (error) {
      console.error('Error reloading mod:', error);
      setStatus(`Error reloading mod: ${error.message}`);
    }
  };

  // Fast reload - reuses existing customizer, just refreshes data (like import does)
  const fastReload = async () => {
    try {
      setStatus('Reloading...');
      setSlotMapping({}); // Clear mapping
      
      // Re-scan the directory for files
      const files = await scanDirectory(modDirectory);
      setModFiles(files);
      
      // Re-analyze with existing customizer
      await customizer.analyze(files);
      
      // Re-detect slots
      await customizer._detectFighterAndSlots();
      
      // Reload slots
      await loadSlots();
      
      // Reload alt previews
      const newAltPreviews = await customizer.loadAltPreviews();
      setAltPreviews(newAltPreviews);
      setImageCacheKey(Date.now());
      
      setStatus('Ready');
    } catch (error) {
      console.error('Error during fast reload:', error);
      setStatus(`Error: ${error.message}`);
    }
  };

  const applyChanges = async () => {
    try {
      setLoading(true);
      setStatus('Applying changes...');
      
      if (!customizer || !modDirectory) {
        throw new Error('No mod loaded');
      }

      // Prepare data for slot changes
      const enabledSlotIds = enabledSlots.map(slot => slot.id);
      const disabledSlotIds = disabledSlots.map(slot => slot.id);
      
      // Extract pending imports (slots with isPendingImport flag)
      const pendingImports = enabledSlots.filter(slot => slot.isPendingImport).map(slot => ({
        targetSlotId: slot.id,
        importData: slot.importData
      }));
      
      // Use the tracked slot mapping from drag-and-drop reordering
      const currentSlotMapping = { ...slotMapping };
      
      console.log(`[DEBUG] Applying changes:`);
      console.log(`[DEBUG] Enabled slots: ${enabledSlotIds}`);
      console.log(`[DEBUG] Disabled slots: ${disabledSlotIds}`);
      console.log(`[DEBUG] Slot mapping: ${JSON.stringify(currentSlotMapping)}`);
      console.log(`[DEBUG] Pending imports: ${pendingImports.length}`);
      
      // Call the backend to apply changes
      const results = await applySlotChanges({
        modRoot: modDirectory,
        enabledSlots: enabledSlotIds,
        disabledSlots: disabledSlotIds,
        slotMapping: currentSlotMapping,
        pendingImports: pendingImports,
        baseSlotNum: customizer.baseSlotNum,
        fighterCodename: customizer.fighterCodename
      });
      
      console.log(`[DEBUG] Apply changes results:`, results);
      
      if (results.errors && results.errors.length > 0) {
        const errorMessage = results.errors.join(', ');
        setStatus(`Applied with errors: ${errorMessage}`);
      } else {
        const changes = [];
        if (results.imported && results.imported.length > 0) {
          changes.push(`Imported ${results.imported.length} skins`);
        }
        if (results.disabled && results.disabled.length > 0) {
          changes.push(`Disabled ${results.disabled.length} slots`);
        }
        if (results.restored && results.restored.length > 0) {
          changes.push(`Restored ${results.restored.length} slots`);
        }
        if (results.reordered && results.reordered.length > 0) {
          changes.push(`Reordered ${results.reordered.length} slots`);
        }
        
        const statusMessage = changes.length > 0 
          ? `Successfully applied changes: ${changes.join(', ')}`
          : 'No changes to apply';
        setStatus(statusMessage);
        
        // Reload the mod folder after successful changes
        if (changes.length > 0) {
          // Clear loading state first, then fast reload
          setLoading(false);
          await fastReload();
        } else {
          setLoading(false);
        }
      }
    } catch (error) {
      console.error('Error applying changes:', error);
      setStatus(`Error applying changes: ${error.message}`);
      setLoading(false);
    }
  };

  const restoreDisabled = async () => {
    if (!customizer || !modDirectory) {
      setStatus('No mod loaded');
      return;
    }

    try {
      setLoading(true);
      setStatus('Restoring disabled slots...');

      const results = await restoreDisabledSlots({
        modRoot: modDirectory,
        baseSlotNum: customizer.baseSlotNum,
        fighterCodename: customizer.fighterCodename,
        enabledSlots: enabledSlots,
        disabledSlots: disabledSlots
      });

      if (results.errors && results.errors.length > 0) {
        setStatus(`Error restoring slots: ${results.errors.join(', ')}`);
      } else if (results.restored && results.restored.length > 0) {
        setStatus(`Successfully restored ${results.restored.length} disabled slots`);
        // Reload the mod folder after successful restore
        setLoading(false);
        await fastReload();
      } else {
        setStatus('No disabled slots found to restore');
        setLoading(false);
      }
    } catch (error) {
      console.error('Error restoring disabled slots:', error);
      setStatus(`Error restoring disabled slots: ${error.message}`);
      setLoading(false);
    }
  };

  const resetAll = () => {
    setSlots([]);
    setEnabledSlots([]);
    setDisabledSlots([]);
    setSlotMapping({});
    setAnalysisResults(null);
    setModDirectory('');
    setModFiles([]);
    setStatus('Ready');
  };

  const handleDeleteAllDisabledClick = () => {
    if (!modDirectory) {
      setStatus('No mod loaded');
      return;
    }
    // Show confirm modal instead of browser confirm
    setConfirmModalOpen(true);
  };

  const confirmDeleteAllDisabled = async () => {
    setConfirmModalOpen(false);
    
    try {
      setLoading(true);
      setStatus('Deleting all disabled slots...');

      const results = await ipcRenderer.invoke('delete-all-disabled', { 
        modRoot: modDirectory 
      });

      if (results.errors && results.errors.length > 0) {
        setStatus(`Error deleting slots: ${results.errors.join(', ')}`);
        setLoading(false);
      } else if (results.deleted > 0) {
        setStatus(`Successfully deleted ${results.deleted} disabled slots`);
        // Reload using the fast method
        setLoading(false);
        await fastReload();
      } else {
        setStatus('No disabled slots found to delete');
        setLoading(false);
      }
    } catch (error) {
      console.error('Error deleting disabled slots:', error);
      setStatus('Error deleting disabled slots');
      setLoading(false);
    }
  };

  const handleImportSkins = async () => {
    try {
      setLoading(true);
      setStatus('Selecting import folder...');
      
      const importFolder = await ipcRenderer.invoke('select-import-folder');
      if (!importFolder) {
        setStatus('No folder selected');
        setLoading(false);
        return;
      }

      setStatus('Scanning import folder...');
      
      // Scan the import folder for alts
      const scanResult = await ipcRenderer.invoke('scan-import-folder', importFolder);
      
      if (!scanResult || !scanResult.slots || scanResult.slots.length === 0) {
        setStatus('No valid alts found in import folder');
        setLoading(false);
        return;
      }

      // Store the import data and open the modal
      setImportData(scanResult);
      setImportModalOpen(true);
      setStatus(`Found ${scanResult.slots.length} alts in import folder`);
    } catch (error) {
      console.error('Error importing skins:', error);
      setStatus(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyImport = async (importConfig) => {
    try {
      setLoading(true);
      setImportModalOpen(false);
      setStatus('Importing skins...');
      
      if (importConfig.mode === 'add') {
        // Add skins mode - build slot mapping and pending imports
        console.log('Import config (add mode):', importConfig);
        console.log('Add mapping:', importConfig.addMapping);
        
        setStatus(`Adding ${importConfig.alts.length} skins...`);
        
        // Sort insertions from lowest position to highest (process top-down)
        // This matches the backend processing order
        const sortedAlts = [...importConfig.alts].sort((a, b) => 
          (importConfig.addMapping[a.altNumber] || 0) - (importConfig.addMapping[b.altNumber] || 0)
        );
        
        let currentEnabledSlots = enabledSlots.map(s => s.id);
        const allPendingImports = [];
        const allSlotMappings = {};
        
        // Process each insertion one at a time
        for (const alt of sortedAlts) {
          const insertPosition = importConfig.addMapping[alt.altNumber];
          const importAltNum = alt.altNumber;
          
          // Use actualSlotId if detected from the folder structure, otherwise calculate
          // This handles skins with vanilla slot numbers (c00-c07) vs moveset slots (c120+)
          const importSlotId = alt.actualSlotId || `c${importConfig.importData.baseSlotNum + importAltNum}`;
          console.log(`[DEBUG] Alt ${importAltNum}: actualSlotId=${alt.actualSlotId}, calculated=c${importConfig.importData.baseSlotNum + importAltNum}, using=${importSlotId}`);
          
          // Skip if no mapping for this alt
          if (insertPosition === undefined || insertPosition === null) {
            console.log(`Skipping alt ${importAltNum} - no mapping defined`);
            continue;
          }
          
          // Determine target slot number based on insertion position
          // If inserting at the end (position >= length), create new slot after last one
          let targetSlotNum;
          if (insertPosition >= currentEnabledSlots.length) {
            // Appending at the end - get last slot and add 1
            const lastSlot = currentEnabledSlots[currentEnabledSlots.length - 1];
            targetSlotNum = parseInt(lastSlot.substring(1)) + 1;
          } else {
            targetSlotNum = parseInt(currentEnabledSlots[insertPosition].substring(1));
          }
          const targetSlotId = `c${targetSlotNum}`;
          
          // Build slot mapping for shifting (everything from target position onwards shifts up by 1)
          const slotsToShift = currentEnabledSlots.slice(insertPosition);
          for (const slotId of slotsToShift) {
            const currentNum = parseInt(slotId.substring(1));
            const newSlotId = `c${currentNum + 1}`;
            allSlotMappings[slotId] = newSlotId;
          }
          
          // Add pending import
          allPendingImports.push({
            targetSlotId: targetSlotId,
            importData: {
              folder: importConfig.importData.folder,
              configPath: importConfig.importData.configPath,
              baseSlotNum: importConfig.importData.baseSlotNum,
              fighterCodename: importConfig.importData.fighterCodename,
              displayFighterName: importConfig.importData.displayName,
              originalSlotId: importSlotId,
              actualSlotId: alt.actualSlotId, // Actual folder name from skin (may differ from calculated)
              altNumber: importAltNum
            }
        });
        
          // Update enabled slots list for next iteration
          const newEnabledSlots = [...currentEnabledSlots];
          newEnabledSlots.splice(insertPosition, 0, targetSlotId);
        
          // Apply the slot mapping to shift existing slots
          for (let i = insertPosition; i < currentEnabledSlots.length; i++) {
            const oldSlot = currentEnabledSlots[i];
            const newSlot = allSlotMappings[oldSlot];
            newEnabledSlots[i + 1] = newSlot; // +1 because we inserted one
          }
          
          currentEnabledSlots = newEnabledSlots;
        }
        
        console.log('Final enabled slots:', currentEnabledSlots);
        console.log('All slot mappings:', allSlotMappings);
        console.log('All pending imports:', allPendingImports);
        
        // Now call the backend with everything prepared
        const result = await ipcRenderer.invoke('apply-slot-changes', {
          modRoot: modDirectory,
          enabledSlots: currentEnabledSlots,
          disabledSlots: [],
          slotMapping: allSlotMappings,
          pendingImports: allPendingImports,
          baseSlotNum: customizer.baseSlotNum,
          fighterCodename: customizer.fighterCodename
        });
        
        if (result.errors && result.errors.length > 0) {
          setStatus(`Add failed: ${result.errors.join(', ')}`);
        } else {
          setStatus(`Successfully added ${importConfig.alts.length} skins! Reloading mod...`);
          
          // Clear import data
          setImportData(null);
          
          // Reload the mod
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const files = await scanDirectory(modDirectory);
          setModFiles(files);
          await customizer.analyze(files);
          await loadSlots();
          
          const altPreviews = await customizer.loadAltPreviews();
          setAltPreviews(altPreviews);
        setImageCacheKey(Date.now());
        
          setStatus(`Add complete! Added ${importConfig.alts.length} alts`);
        }
      } else if (importConfig.mode === 'replace') {
        // Replace mode - simple two-step process:
        // 1. Disable the target slot
        // 2. Import the new skin at that position (like adding between previous and next slot)
        console.log('Replace config:', importConfig);
        
        // Build list of replacements sorted by position (highest index first to avoid shifting issues)
        const replacements = [];
        for (const alt of importConfig.alts) {
          const targetSlotId = importConfig.replaceMapping[alt.altNumber];
          if (targetSlotId) {
            const targetIndex = enabledSlots.findIndex(s => s.id === targetSlotId);
            if (targetIndex !== -1) {
              replacements.push({
                importAlt: alt,
                targetSlot: targetSlotId,
                targetIndex: targetIndex
              });
            }
          }
        }
        
        // Sort by target index descending (process from bottom to top to avoid position issues)
        replacements.sort((a, b) => b.targetIndex - a.targetIndex);
        
        setStatus(`Replacing ${replacements.length} skins...`);
        console.log('Sorted replacements (bottom to top):', replacements);
        
        for (let i = 0; i < replacements.length; i++) {
          const replacement = replacements[i];
          const { importAlt, targetSlot, targetIndex } = replacement;
          
          setStatus(`Replacing ${targetSlot} (${i + 1}/${replacements.length})...`);
          console.log(`[Replace] Processing ${targetSlot} at index ${targetIndex}`);
          
          // ====== STEP 1: DISABLE THE TARGET SLOT ======
          console.log(`[Replace] Step 1: Disabling ${targetSlot}...`);
          
          // Get fresh slot data by rescanning
          const currentEnabledIds = [];
          const modelBodyPath = `${modDirectory}/fighter/${customizer.fighterCodename}/model/body`;
          if (fs.existsSync(modelBodyPath)) {
            const items = fs.readdirSync(modelBodyPath);
            for (const item of items) {
              if (/^c\d+$/.test(item)) {
                currentEnabledIds.push(item);
              }
            }
            currentEnabledIds.sort((a, b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));
          }
          
          // Find current position of target
          const currentTargetIndex = currentEnabledIds.indexOf(targetSlot);
          if (currentTargetIndex === -1) {
            console.error(`Target slot ${targetSlot} not found in current slots: ${currentEnabledIds.join(', ')}`);
            continue;
          }
          
          // Build disabled slots list
          const currentDisabledIds = [];
          const disabledDir = `${modDirectory}/.disabled`;
          if (fs.existsSync(disabledDir)) {
            const disabledFolders = fs.readdirSync(disabledDir);
            for (const folder of disabledFolders) {
              if (folder.startsWith('disabled_c')) {
                currentDisabledIds.push(folder);
              }
            }
          }
          
          // Disable: remove target from enabled, add to disabled with timestamp
          const disabledId = `disabled_${targetSlot}_${Date.now()}`;
          const newEnabledAfterDisable = currentEnabledIds.filter(id => id !== targetSlot);
          const newDisabledAfterDisable = [...currentDisabledIds, disabledId];
          
          // Slots after the target need to shift down by 1
          const disableSlotMapping = {};
          for (let j = currentTargetIndex + 1; j < currentEnabledIds.length; j++) {
            const slotId = currentEnabledIds[j];
            const slotNum = parseInt(slotId.substring(1));
            disableSlotMapping[slotId] = `c${slotNum - 1}`;
          }
          
          console.log(`[Replace] Disable mapping: ${JSON.stringify(disableSlotMapping)}`);
          
          // Apply disable operation
          const disableResult = await ipcRenderer.invoke('apply-slot-changes', {
            modRoot: modDirectory,
            enabledSlots: newEnabledAfterDisable,
            disabledSlots: newDisabledAfterDisable,
            slotMapping: disableSlotMapping,
            pendingImports: [],
            baseSlotNum: customizer.baseSlotNum,
            fighterCodename: customizer.fighterCodename
          });
          
          if (disableResult.errors && disableResult.errors.length > 0) {
            console.error(`[Replace] Error disabling ${targetSlot}:`, disableResult.errors);
            setStatus(`Error disabling ${targetSlot}: ${disableResult.errors.join(', ')}`);
            continue;
          }
          
          console.log(`[Replace] Step 1 complete: ${targetSlot} disabled`);
          
          // ====== STEP 2: IMPORT THE NEW SKIN AT THE SAME POSITION ======
          console.log(`[Replace] Step 2: Importing new skin at position ${currentTargetIndex}...`);
          
          // Re-scan to get current state after disable
          const slotsAfterDisable = [];
          if (fs.existsSync(modelBodyPath)) {
            const items = fs.readdirSync(modelBodyPath);
            for (const item of items) {
              if (/^c\d+$/.test(item)) {
                slotsAfterDisable.push(item);
              }
            }
            slotsAfterDisable.sort((a, b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));
          }
          
          console.log(`[Replace] Current slots after disable: ${slotsAfterDisable.join(', ')}`);
          
          // The target slot number is what we want the new skin to become
          // After disabling c125, if c126 shifted to c125, we want to insert BEFORE c125
          // So the new skin becomes c125 and the old c125 (was c126) becomes c126 again
          const targetSlotNum = parseInt(targetSlot.substring(1));
          
          // Slots at or after targetSlotNum need to shift up
          const addSlotMapping = {};
          const slotsToShift = slotsAfterDisable.filter(s => parseInt(s.substring(1)) >= targetSlotNum);
          for (const slotId of slotsToShift) {
            const slotNum = parseInt(slotId.substring(1));
            addSlotMapping[slotId] = `c${slotNum + 1}`;
          }
          
          console.log(`[Replace] Add mapping: ${JSON.stringify(addSlotMapping)}`);
          
          // Build new enabled slots list with the import inserted
          const newEnabledAfterAdd = [];
          let inserted = false;
          for (const slotId of slotsAfterDisable) {
            const slotNum = parseInt(slotId.substring(1));
            if (!inserted && slotNum >= targetSlotNum) {
              newEnabledAfterAdd.push(targetSlot); // Insert the new slot
              inserted = true;
            }
            newEnabledAfterAdd.push(addSlotMapping[slotId] || slotId);
          }
          if (!inserted) {
            // Adding at the end
            newEnabledAfterAdd.push(targetSlot);
          }
          
          console.log(`[Replace] New enabled slots: ${newEnabledAfterAdd.join(', ')}`);
          
          // Use actualSlotId if detected from the folder structure
          const importSlotId = importAlt.actualSlotId || `c${importConfig.importData.baseSlotNum + importAlt.altNumber}`;
          
          const pendingImport = {
            targetSlotId: targetSlot, // The new skin takes the target slot ID
            importData: {
              folder: importConfig.importData.folder,
              configPath: importConfig.importData.configPath,
              baseSlotNum: importConfig.importData.baseSlotNum,
              fighterCodename: importConfig.importData.fighterCodename,
              displayFighterName: importConfig.importData.displayName,
              originalSlotId: importSlotId,
              actualSlotId: importAlt.actualSlotId,
              altNumber: importAlt.altNumber
            }
          };
          
          // Get current disabled list again
          const disabledAfterDisable = [];
          if (fs.existsSync(disabledDir)) {
            const disabledFolders = fs.readdirSync(disabledDir);
            for (const folder of disabledFolders) {
              if (folder.startsWith('disabled_c')) {
                disabledAfterDisable.push(folder);
              }
            }
          }
          
          // Apply add operation
          const addResult = await ipcRenderer.invoke('apply-slot-changes', {
            modRoot: modDirectory,
            enabledSlots: newEnabledAfterAdd,
            disabledSlots: disabledAfterDisable,
            slotMapping: addSlotMapping,
            pendingImports: [pendingImport],
            baseSlotNum: customizer.baseSlotNum,
            fighterCodename: customizer.fighterCodename
          });
          
          if (addResult.errors && addResult.errors.length > 0) {
            console.error(`[Replace] Error adding import:`, addResult.errors);
            setStatus(`Error adding import: ${addResult.errors.join(', ')}`);
            continue;
          }
          
          console.log(`[Replace] Step 2 complete: New skin imported as ${targetSlot}`);
        }
        
        setStatus(`Successfully replaced ${replacements.length} skins! Reloading...`);
        
        // Clear import data
        setImportData(null);
        
        // Reload using fastReload for speed
        await fastReload();
        
        setStatus(`Replace complete! Replaced ${replacements.length} alts`);
      }
      
    } catch (error) {
      console.error('Error applying import:', error);
      setStatus(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <Header 
        modDirectory={modDirectory}
        onSelectDirectory={selectModDirectory}
        loading={loading}
      />
      
      <div className="main-content">
        {!modDirectory ? (
          <div className="welcome-screen">
            <div className="welcome-card">
              <h1>Moveset Customizer</h1>
              <p>Select a Super Smash Bros Ultimate moveset mod folder to get started</p>
              <button 
                className="btn btn-primary"
                onClick={selectModDirectory}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <div className="spinner"></div>
                    Loading...
                  </>
                ) : (
                  'Select Mod Folder'
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="workspace">
            <SlotGrid
              enabledSlots={enabledSlots}
              disabledSlots={disabledSlots}
              altPreviews={altPreviews}
              onToggleSlot={toggleSlot}
              onReorderSlots={reorderSlots}
              loading={loading}
              cacheKey={imageCacheKey}
            />
          </div>
        )}
      </div>
      
      <StatusBar 
        status={status}
        onApplyChanges={applyChanges}
        onReset={resetAll}
        onDeleteAllDisabled={handleDeleteAllDisabledClick}
        onImportSkins={handleImportSkins}
        loading={loading}
        hasMod={!!modDirectory}
        hasUnappliedChanges={hasUnappliedChanges}
        hasDisabledSlots={disabledSlots.length > 0}
        progress={progress}
      />

      <ImportModal
        isOpen={importModalOpen}
        importData={importData}
        onClose={() => {
          setImportModalOpen(false);
          setImportData(null); // Clear import data to force full refresh next time
        }}
        onApply={handleApplyImport}
        mainModBaseSlot={customizer?.baseSlotNum}
        enabledSlots={enabledSlots}
        mainAltPreviews={altPreviews}
        mainCacheKey={imageCacheKey}
      />

      <ConfirmModal
        isOpen={confirmModalOpen}
        title="Delete All Disabled Skins"
        message="Are you sure you want to permanently delete ALL disabled skins? This action cannot be undone."
        onConfirm={confirmDeleteAllDisabled}
        onCancel={() => setConfirmModalOpen(false)}
        confirmText="Delete All"
        danger={true}
      />
    </div>
  );
}

export default App; 