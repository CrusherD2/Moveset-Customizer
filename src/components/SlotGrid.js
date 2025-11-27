import React from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import SlotCard from './SlotCard';
import './SlotGrid.css';

const SlotGrid = ({ enabledSlots, disabledSlots, altPreviews, onToggleSlot, onReorderSlots, loading, cacheKey }) => {
  const handleDragEnd = (result) => {
    if (!result.destination) {
      return;
    }

    const { source, destination } = result;

    // Prevent moving the base alt (first enabled visual slot)
    if (source.droppableId === 'enabled' && destination.droppableId === 'enabled') {
      if (source.index === 0 || destination.index === 0) {
        return; // Disallow any drag involving index 0
      }
    }
    
    // Prevent moving disabled slots to position 0 (base alt position)
    if (source.droppableId === 'disabled' && destination.droppableId === 'enabled') {
      if (destination.index === 0) {
        return; // Disallow moving disabled slots before the base alt
      }
    }
    
    onReorderSlots(
      source.index,
      destination.index,
      source.droppableId,
      destination.droppableId
    );
  };

  return (
    <div className="slot-grid">
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="slot-sections">
          {/* Enabled Slots Section */}
          <div className="slot-section">
            <div className="section-header">
              <h2>Enabled Slots</h2>
              <span className="slot-count">{enabledSlots.length}</span>
            </div>
            
            <Droppable droppableId="enabled" direction="horizontal">
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`slot-container ${snapshot.isDraggingOver ? 'drag-over' : ''}`}
                >
                  {enabledSlots.map((slot, index) => (
                    <Draggable key={slot.id} draggableId={slot.id} index={index} isDragDisabled={index === 0}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...(index === 0 ? {} : provided.dragHandleProps)}
                          className={`slot-wrapper ${snapshot.isDragging ? 'dragging' : ''}`}
                        >
                          <SlotCard
                            slot={slot}
                            altPreview={altPreviews[slot.id]}
                            onToggle={onToggleSlot}
                            disabled={loading || index === 0}
                            isBase={index === 0}
                            cacheKey={cacheKey}
                          />
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                  
                  {enabledSlots.length === 0 && (
                    <div className="empty-state">
                      <p>No enabled slots</p>
                    </div>
                  )}
                </div>
              )}
            </Droppable>
          </div>

          {/* Disabled Slots Section */}
          <div className="slot-section">
            <div className="section-header">
              <h2>Disabled Slots</h2>
              <span className="slot-count">{disabledSlots.length}</span>
            </div>
            
            <Droppable droppableId="disabled" direction="horizontal">
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`slot-container ${snapshot.isDraggingOver ? 'drag-over' : ''}`}
                >
                  {disabledSlots.map((slot, index) => {
                    console.log(`[DEBUG] Rendering disabled slot: ${slot.id}, altPreview: ${altPreviews[slot.id]}`);
                    return (
                      <Draggable key={slot.id} draggableId={slot.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`slot-wrapper ${snapshot.isDragging ? 'dragging' : ''}`}
                          >
                            <SlotCard
                              slot={slot}
                              altPreview={altPreviews[slot.id]}
                              onToggle={onToggleSlot}
                              disabled={loading}
                              cacheKey={cacheKey}
                            />
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                  
                  {disabledSlots.length === 0 && (
                    <div className="empty-state">
                      <p>No disabled slots</p>
                    </div>
                  )}
                </div>
              )}
            </Droppable>
          </div>
        </div>
      </DragDropContext>
    </div>
  );
};

export default SlotGrid; 