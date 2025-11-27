const { ipcRenderer } = window.require('electron');

export const scanDirectory = async (rootDir) => {
  try {
    return await ipcRenderer.invoke('read-directory', rootDir);
  } catch (error) {
    console.error('Error scanning directory:', error);
    throw error;
  }
};

export const listDirectory = async (dirPath) => {
  try {
    return await ipcRenderer.invoke('list-directory', dirPath);
  } catch (error) {
    console.error('Error listing directory:', error);
    throw error;
  }
};

export const areFilesIdentical = async (file1, file2) => {
  try {
    return await ipcRenderer.invoke('compare-files', file1, file2);
  } catch (error) {
    console.error('Error comparing files:', error);
    return false;
  }
};

export const fileExists = async (filePath) => {
  try {
    return await ipcRenderer.invoke('file-exists', filePath);
  } catch (error) {
    console.error('Error checking file existence:', error);
    return false;
  }
};

export const getFileSize = async (filePath) => {
  try {
    return await ipcRenderer.invoke('get-file-size', filePath);
  } catch (error) {
    console.error('Error getting file size:', error);
    return -1;
  }
};

export const readFile = async (filePath) => {
  try {
    return await ipcRenderer.invoke('read-file', filePath);
  } catch (error) {
    console.error('Error reading file:', error);
    throw error;
  }
};

export const writeFile = async (filePath, content) => {
  try {
    return await ipcRenderer.invoke('write-file', filePath, content);
  } catch (error) {
    console.error('Error writing file:', error);
    throw error;
  }
};

export const createDirectory = async (dirPath) => {
  try {
    return await ipcRenderer.invoke('create-directory', dirPath);
  } catch (error) {
    console.error('Error creating directory:', error);
    throw error;
  }
};

export const copyFile = async (source, destination) => {
  try {
    return await ipcRenderer.invoke('copy-file', source, destination);
  } catch (error) {
    console.error('Error copying file:', error);
    throw error;
  }
};

export const moveFile = async (source, destination) => {
  try {
    return await ipcRenderer.invoke('move-file', source, destination);
  } catch (error) {
    console.error('Error moving file:', error);
    throw error;
  }
};

export const deleteFile = async (filePath) => {
  try {
    return await ipcRenderer.invoke('delete-file', filePath);
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
};

export const deleteDirectory = async (dirPath) => {
  try {
    return await ipcRenderer.invoke('delete-directory', dirPath);
  } catch (error) {
    console.error('Error deleting directory:', error);
    throw error;
  }
};

export const getFileBasename = (filePath) => {
  const filename = filePath.split('/').pop();
  
  // Remove slot identifiers like _cXXX from filename before extension
  const baseNoSlot = filename.replace(/_c\d+(\.\w+)$/, '$1');
  
  // If it's not a valid filename with extension after removal, return original
  if (!baseNoSlot.includes('.')) {
    return filename;
  }
  
  return baseNoSlot;
};

export const isSharableFile = (filePath) => {
  const sharableExtensions = ['.nutexb', '.numatb', '.numdlb', '.numshb', '.nuhlpb', '.nus3audio', '.nuanmb'];
  
  const lowerPath = filePath.toLowerCase();
  return sharableExtensions.some(ext => lowerPath.endsWith(ext));
};

export const applySlotChanges = async ({ modRoot, enabledSlots, disabledSlots, slotMapping, pendingImports, baseSlotNum, fighterCodename }) => {
  try {
    return await ipcRenderer.invoke('apply-slot-changes', { modRoot, enabledSlots, disabledSlots, slotMapping, pendingImports, baseSlotNum, fighterCodename });
  } catch (error) {
    console.error('Error applying slot changes:', error);
    throw error;
  }
};

export const restoreDisabledSlots = async ({ modRoot, baseSlotNum, fighterCodename, enabledSlots, disabledSlots }) => {
  try {
    return await ipcRenderer.invoke('restore-disabled-slots', { modRoot, baseSlotNum, fighterCodename, enabledSlots, disabledSlots });
  } catch (error) {
    console.error('Error restoring disabled slots:', error);
    throw error;
  }
}; 