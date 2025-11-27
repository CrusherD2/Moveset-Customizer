import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import './ImportModal.css';

const { ipcRenderer } = window.require('electron');

const ImportModal = ({ isOpen, importData, onClose, onApply, mainModBaseSlot, enabledSlots, mainAltPreviews, mainCacheKey }) => {
  const [mode, setMode] = useState('add'); // 'add' or 'replace'
  const [selectedAlts, setSelectedAlts] = useState(new Set());
  const [altPreviews, setAltPreviews] = useState({});
  const [replaceMapping, setReplaceMapping] = useState({}); // { importAltNum: targetSlotId }
  const [addMapping, setAddMapping] = useState({}); // { importAltNum: insertPosition } for add mode
  const [previewSlots, setPreviewSlots] = useState([]); // Visual preview of enabled slots + imports for add mode
  const [loading, setLoading] = useState(false);
  const [imageCacheKey, setImageCacheKey] = useState(Date.now());
  const [dragOverSlot, setDragOverSlot] = useState(null);
  const [draggingAltNum, setDraggingAltNum] = useState(null);

  useEffect(() => {
    if (isOpen && importData) {
      // Reset all modal state for fresh operation
      setMode('add');
      setSelectedAlts(new Set());
      setAltPreviews({}); // Clear old previews before loading new ones
      setReplaceMapping({});
      setAddMapping({});
      setPreviewSlots(enabledSlots ? [...enabledSlots] : []); // Initialize with current enabled slots
      setDragOverSlot(null);
      setDraggingAltNum(null);
      setImageCacheKey(Date.now()); // Force refresh
      loadImportPreviews();
    } else if (!isOpen) {
      // Clear state when modal closes
      setAltPreviews({});
      setSelectedAlts(new Set());
      setReplaceMapping({});
      setAddMapping({});
      setPreviewSlots([]);
    }
  }, [isOpen, importData, enabledSlots]);

  const loadImportPreviews = async () => {
    if (!importData || !importData.slots) return;
    
    console.log('[ImportModal] Loading previews for', importData.slots.length, 'alts');
    setLoading(true);
    const previews = {};
    
    try {
      for (const slot of importData.slots) {
        if (slot.uiFile) {
          console.log('[ImportModal] Converting preview for alt', slot.altNumber, 'from', slot.uiFile);
          // Convert UI file to preview
          const previewPath = await ipcRenderer.invoke('convert-ui-to-preview', slot.uiFile, `import_${slot.altNumber}`);
          if (previewPath) {
            console.log('[ImportModal] Got preview path:', previewPath);
            previews[slot.altNumber] = previewPath;
          } else {
            console.log('[ImportModal] No preview path returned for alt', slot.altNumber);
          }
        }
      }
      console.log('[ImportModal] Loaded', Object.keys(previews).length, 'previews:', previews);
      setAltPreviews(previews);
    } catch (error) {
      console.error('Error loading import previews:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleAltSelection = (altNum) => {
    const newSelected = new Set(selectedAlts);
    if (newSelected.has(altNum)) {
      newSelected.delete(altNum);
    } else {
      newSelected.add(altNum);
    }
    setSelectedAlts(newSelected);
  };

  const selectAll = () => {
    if (importData && importData.slots) {
      setSelectedAlts(new Set(importData.slots.map(s => s.altNumber)));
    }
  };

  const deselectAll = () => {
    setSelectedAlts(new Set());
  };

  // Handler for drag-and-drop in add mode
  const handleAddModeDragEnd = (result) => {
    if (!result.destination) {
      setDraggingAltNum(null); // Clear dragging state
      return;
    }

    const { source, destination } = result;

    // Dragging from import list to preview list
    if (source.droppableId === 'import-alts' && destination.droppableId === 'preview-alts') {
      // Prevent dropping at or before base alt (index 0)
      if (destination.index === 0) {
        setDraggingAltNum(null); // Clear dragging state
        return;
      }

      // Get the import alt that was dragged
      const draggedAlt = importData.slots[source.index];
      
      // Create a visual preview slot for this import
      const previewSlot = {
        id: `import-preview-${draggedAlt.altNumber}`,
        name: `Import Alt ${draggedAlt.altNumber}`,
        altNumber: draggedAlt.altNumber,
        isImportPreview: true,
        importAltNumber: draggedAlt.altNumber
      };

      // Insert into preview list at destination
      const newPreviewSlots = [...previewSlots];
      newPreviewSlots.splice(destination.index, 0, previewSlot);
      setPreviewSlots(newPreviewSlots);

      // Track the mapping: import alt -> position
      setAddMapping(prev => ({
        ...prev,
        [draggedAlt.altNumber]: destination.index
      }));
      
      setDraggingAltNum(null); // Clear dragging state
    }
    // Reordering within preview list
    else if (source.droppableId === 'preview-alts' && destination.droppableId === 'preview-alts') {
      // Prevent moving to index 0 (before or at base alt)
      if (source.index === 0 || destination.index === 0) {
        setDraggingAltNum(null); // Clear dragging state
        return;
      }

      // Reorder preview slots
      const newPreviewSlots = [...previewSlots];
      const [removed] = newPreviewSlots.splice(source.index, 1);
      newPreviewSlots.splice(destination.index, 0, removed);
      setPreviewSlots(newPreviewSlots);

      // Update all import mappings based on new positions
      const newMapping = {};
      newPreviewSlots.forEach((slot, index) => {
        if (slot.isImportPreview) {
          newMapping[slot.importAltNumber] = index;
        }
      });
      setAddMapping(newMapping);
      
      setDraggingAltNum(null); // Clear dragging state
    }
  };

  const removeImportFromPreview = (importAltNum) => {
    // Remove from preview list
    setPreviewSlots(prev => prev.filter(slot => !(slot.isImportPreview && slot.importAltNumber === importAltNum)));
    
    // Remove from mapping
    setAddMapping(prev => {
      const newMapping = { ...prev };
      delete newMapping[importAltNum];
      return newMapping;
    });
  };

  const handleApply = () => {
    if (mode === 'replace') {
      // In replace mode, get all alts that have a mapping (regardless of selection)
      const mappedAlts = importData.slots.filter(slot => replaceMapping[slot.altNumber]);
      if (mappedAlts.length === 0) {
        alert('Please drag at least one alt to replace');
        return;
      }
      
      // Set loading state to disable buttons and show we're processing
      setLoading(true);
      
      onApply({
        mode,
        alts: mappedAlts,
        replaceMapping,
        importData: {
          ...importData,
          altPreviews // Include the preview paths
        }
      });
      
      // Don't close modal yet - wait for progress to complete
      // Modal will auto-close when progress reaches 100%
    } else {
      // In add mode, get alts that have a mapping (insert position)
      const mappedAlts = importData.slots.filter(slot => addMapping[slot.altNumber] !== undefined);
      if (mappedAlts.length === 0) {
        alert('Please drag at least one alt to a drop zone between existing alts');
        return;
      }
      
      // Sort by insertion position (ascending) to process from bottom to top
      // This prevents position shifts from affecting earlier insertions
      mappedAlts.sort((a, b) => (addMapping[b.altNumber] || 0) - (addMapping[a.altNumber] || 0));
      
      // Set loading state
      setLoading(true);
      
      onApply({
        mode,
        alts: mappedAlts,
        addMapping, // Pass the position mapping
        replaceMapping: {},
        importData: {
          ...importData,
          altPreviews // Include the preview paths
        }
      });
    }
  };

  const handleDragStart = (e, importAltNum) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('importAltNum', importAltNum.toString());
    setDraggingAltNum(importAltNum);
  };

  const handleDragOver = (e, targetSlotId) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent event bubbling
    e.dataTransfer.dropEffect = 'move';
    setDragOverSlot(targetSlotId);
  };

  const handleDragLeave = (e) => {
    setDragOverSlot(null);
  };

  const handleDragEnd = (e) => {
    setDraggingAltNum(null);
    setDragOverSlot(null);
  };

  const handleDrop = (e, targetSlotId) => {
    e.preventDefault();
    e.stopPropagation();
    const importAltNum = parseInt(e.dataTransfer.getData('importAltNum'));
    
    console.log(`[ImportModal] Drop event triggered on ${targetSlotId}, importAltNum: ${importAltNum}`);
    
    // Check if importAltNum is valid (including 0!) and targetSlotId exists
    if (!isNaN(importAltNum) && targetSlotId) {
      // Block dropping on base alt - it cannot be replaced
      const targetSlotNum = parseInt(targetSlotId.substring(1));
      if (targetSlotNum === mainModBaseSlot) {
        console.log(`[ImportModal] Cannot replace base alt ${targetSlotId}, ignoring drop`);
        setDragOverSlot(null);
        setDraggingAltNum(null);
        return;
      }
      
      // Check if this target slot is already mapped to another import alt
      const existingMapping = Object.entries(replaceMapping).find(
        ([altNum, target]) => target === targetSlotId && parseInt(altNum) !== importAltNum
      );
      
      if (existingMapping) {
        // Slot is taken - just ignore the drop (UX: skin returns to source)
        console.log(`[ImportModal] Slot ${targetSlotId} is already taken by Alt ${existingMapping[0]}, ignoring drop`);
        setDragOverSlot(null);
        setDraggingAltNum(null);
        return;
      }
      
      // Update the replace mapping
      setReplaceMapping(prev => ({
        ...prev,
        [importAltNum]: targetSlotId
      }));
      console.log(`[ImportModal] Mapped import alt ${importAltNum} to replace ${targetSlotId}`);
    }
    
    setDragOverSlot(null);
    setDraggingAltNum(null);
  };

  const clearMapping = (importAltNum) => {
    setReplaceMapping(prev => {
      const newMapping = { ...prev };
      delete newMapping[importAltNum];
      return newMapping;
    });
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Import Skins</h2>
          <button className="close-button" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          {/* Mode selector */}
          <div className="mode-selector">
            <button
              className={`mode-btn ${mode === 'add' ? 'active' : ''}`}
              onClick={() => setMode('add')}
            >
              Add Skins
            </button>
            <button
              className={`mode-btn ${mode === 'replace' ? 'active' : ''}`}
              onClick={() => setMode('replace')}
            >
              Replace Skins
            </button>
          </div>

          {/* Info bar */}
          <div className="import-info">
            <span>Found {importData?.slots?.length || 0} alts in: {importData?.folder?.split(/[\\/]/).pop()}</span>
            {mode === 'add' && <span>Mapped: {Object.keys(addMapping).length}</span>}
            {mode === 'replace' && <span>Mapped: {Object.keys(replaceMapping).length}</span>}
          </div>

          {mode === 'add' && (
            <div className="add-mode-content">
              <p className="mode-description">
                Drag alts from "To Add" on the left and drop them on the right to insert them at any position. Drag to reorder after adding.
              </p>
              <DragDropContext onDragEnd={handleAddModeDragEnd}>
                <div className="replace-columns">
                  {/* Left column: Import alts */}
                  <div className="column to-add-column">
                    <h3>To Add ({importData?.slots?.filter(slot => addMapping[slot.altNumber] === undefined).length || 0})</h3>
                    <Droppable droppableId="import-alts" isDropDisabled={true}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className="alts-list"
                        >
                          {importData?.slots
                            ?.filter((slot) => addMapping[slot.altNumber] === undefined) // Hide mapped alts
                            ?.map((slot, index) => {
                              return (
                                <Draggable
                                  key={`import-${slot.altNumber}`}
                                  draggableId={`import-${slot.altNumber}`}
                                  index={index}
                                >
                                  {(provided, snapshot) => (
                                    <div
                                      ref={provided.innerRef}
                                      {...provided.draggableProps}
                                      {...provided.dragHandleProps}
                                      className={`alt-card-small ${snapshot.isDragging ? 'dragging' : ''}`}
                                      onDragStart={() => setDraggingAltNum(slot.altNumber)}
                                    >
                                      <div className="alt-preview-small">
                                        {altPreviews[slot.altNumber] ? (
                                          <img
                                            key={`import-alt-small-${slot.altNumber}-${imageCacheKey}`}
                                            src={`file://${altPreviews[slot.altNumber]}?t=${imageCacheKey}`}
                                            alt={`Alt ${slot.altNumber}`}
                                          />
                                        ) : (
                                          <div className="preview-placeholder-small">{loading ? '...' : `Alt ${slot.altNumber}`}</div>
                                        )}
                                      </div>
                                      <div className="alt-info-small">
                                        <span>Alt {slot.altNumber}</span>
                                      </div>
                                    </div>
                                  )}
                                </Draggable>
                              );
                            })}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>

                  {/* Right column: Preview with existing alts + import placeholders */}
                  <div className="column your-alts-column">
                    <h3>Your Alts - Drop Here to Insert ({previewSlots.length})</h3>
                    <Droppable droppableId="preview-alts">
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`alts-list ${snapshot.isDraggingOver ? 'drag-over' : ''}`}
                        >
                          {previewSlots.map((slot, index) => {
                            const slotNum = slot.id ? parseInt(slot.id.substring(1)) : null;
                            const isBaseAlt = slotNum === mainModBaseSlot;
                            const isImport = slot.isImportPreview;
                            
                            return (
                              <Draggable
                                key={slot.id}
                                draggableId={slot.id}
                                index={index}
                                isDragDisabled={index === 0}
                              >
                                {(provided, snapshot) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                    className={`alt-card-small ${isBaseAlt ? 'base-alt' : ''} ${isImport ? 'import-preview' : ''} ${snapshot.isDragging ? 'dragging' : ''} ${isBaseAlt && draggingAltNum !== null ? 'base-alt-locked-highlight' : ''}`}
                                  >
                                    <div className="alt-preview-small">
                                      {isImport ? (
                                        // Show import preview
                                        altPreviews[slot.importAltNumber] ? (
                                          <img
                                            key={`preview-${slot.importAltNumber}-${imageCacheKey}`}
                                            src={`file://${altPreviews[slot.importAltNumber]}?t=${imageCacheKey}`}
                                            alt={slot.name}
                                          />
                                        ) : (
                                          <div className="preview-placeholder-small">{slot.name}</div>
                                        )
                                      ) : (
                                        // Show existing alt preview
                                        mainAltPreviews && mainAltPreviews[slot.id] ? (
                                          <img
                                            key={`main-alt-small-${slot.id}-${mainCacheKey}`}
                                            src={`file://${mainAltPreviews[slot.id]}?t=${mainCacheKey}`}
                                            alt={slot.name}
                                          />
                                        ) : (
                                          <div className="preview-placeholder-small">{slot.name}</div>
                                        )
                                      )}
                                      {isBaseAlt && (
                                        <div className="base-alt-badge" title="Base Alt">
                                          <svg viewBox="0 0 24 24" className="base-icon" aria-hidden="true">
                                            <path fill="currentColor" d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
                                          </svg>
                                        </div>
                                      )}
                                    </div>
                                    <div className="alt-info-small">
                                      <span>{isImport ? `Import Alt ${slot.importAltNumber}` : slot.name}</span>
                                      {!isImport && <span className="alt-number-small">Alt {slot.altNumber}</span>}
                                      {isImport && (
                                        <button
                                          className="remove-import-btn"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            removeImportFromPreview(slot.importAltNumber);
                                          }}
                                          title="Remove"
                                        >
                                          ✕
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </Draggable>
                            );
                          })}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                </div>
              </DragDropContext>
            </div>
          )}

          {mode === 'replace' && (
            <div className="replace-mode-content">
              <p className="mode-description">
                Drag alts from "To Add" on the left to "Your Alts" on the right to replace them. All import alts are available for replacement.
              </p>
              <div className="replace-columns">
                <div className="column to-add-column">
                  <h3>To Add ({importData?.slots?.length || 0})</h3>
                  <div className="alts-list">
                    {importData?.slots?.map((slot) => {
                      const isMapped = !!replaceMapping[slot.altNumber];
                      return (
                      <div
                        key={slot.altNumber}
                        className={`alt-card-small draggable ${isMapped ? 'mapped' : ''}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, slot.altNumber)}
                        onDragEnd={handleDragEnd}
                      >
                          <div className="alt-preview-small">
                            {altPreviews[slot.altNumber] ? (
                              <img
                                key={`import-alt-small-${slot.altNumber}-${imageCacheKey}`}
                                src={`file://${altPreviews[slot.altNumber]}?t=${imageCacheKey}`}
                                alt={`Alt ${slot.altNumber}`}
                              />
                            ) : (
                              <div className="preview-placeholder-small">Alt {slot.altNumber}</div>
                            )}
                          </div>
                          <div className="alt-info-small">
                            <span>Alt {slot.altNumber}</span>
                            {isMapped && (
                              <div className="mapping-info">
                                <span className="arrow">→</span>
                                <span className="target">{replaceMapping[slot.altNumber]}</span>
                                <button
                                  className="clear-mapping"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    clearMapping(slot.altNumber);
                                  }}
                                  title="Clear mapping"
                                >
                                  ✕
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="column your-alts-column">
                  <h3>Your Alts - Drop Here to Replace ({enabledSlots?.length || 0})</h3>
                  <div className="alts-list">
                    {enabledSlots && enabledSlots.length > 0 ? (
                      enabledSlots.map((slot, index) => {
                        const isTarget = Object.values(replaceMapping).includes(slot.id);
                        const isDragOver = dragOverSlot === slot.id;
                        // Base alt is detected by comparing slot number to mainModBaseSlot
                        const slotNum = parseInt(slot.id.substring(1));
                        const isBaseAlt = slotNum === mainModBaseSlot;
                        
                        // Check if this slot is already taken by a DIFFERENT import alt (when dragging)
                        const isTakenByOther = draggingAltNum !== null && Object.entries(replaceMapping).some(
                          ([altNum, target]) => target === slot.id && parseInt(altNum) !== draggingAltNum
                        );
                        
                        return (
                          <div
                            key={slot.id}
                            className={`alt-card-small drop-target ${isTarget ? 'is-target' : ''} ${isDragOver && !isBaseAlt ? 'drag-over' : ''} ${isBaseAlt ? 'base-alt-blocked' : ''} ${isTakenByOther ? 'slot-taken' : ''}`}
                            onDragOver={(e) => !isBaseAlt && handleDragOver(e, slot.id)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, slot.id)}
                            title={isBaseAlt ? 'Base Alt - Cannot be replaced' : (isTakenByOther ? 'Slot already taken by another skin' : undefined)}
                          >
                            <div className="alt-preview-small">
                              {mainAltPreviews && mainAltPreviews[slot.id] ? (
                                <img
                                  key={`main-alt-small-${slot.id}-${mainCacheKey}`}
                                  src={`file://${mainAltPreviews[slot.id]}?t=${mainCacheKey}`}
                                  alt={slot.name}
                                />
                              ) : (
                                <div className="preview-placeholder-small">{slot.name}</div>
                              )}
                              {isBaseAlt && !isTarget && (
                                <div className="base-alt-badge" title="Base Alt">
                                  <svg viewBox="0 0 24 24" className="base-icon" aria-hidden="true">
                                    <path fill="currentColor" d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
                                  </svg>
                                </div>
                              )}
                            </div>
                            <div className="alt-info-small">
                              <span>{slot.name}</span>
                              <span className="alt-number-small">Alt {slot.altNumber}</span>
                            </div>
                            {isTarget && (
                              <div className="target-badge">Will be replaced</div>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <p className="placeholder-text">No enabled alts available</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <div className="footer-left">
            {/* No buttons needed for add mode with drag-and-drop */}
          </div>
          <div className="footer-right">
            <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleApply}
              disabled={mode === 'add' ? (Object.keys(addMapping).length === 0 || loading) : (Object.keys(replaceMapping).length === 0 || loading)}
            >
              {loading ? `${mode === 'add' ? 'Adding' : 'Replacing'}...` : (mode === 'add' ? 'Add Skins' : 'Replace Skins')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImportModal;

