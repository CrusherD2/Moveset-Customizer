import React, { useState } from 'react';
import './SlotCard.css';

const SlotCard = ({ slot, altPreview, onToggle, disabled, isBase, cacheKey }) => {
  const [imageError, setImageError] = useState(false);

  const handleToggle = () => {
    // Prevent disabling the base alt (assumed index 0 is passed as disabled by parent)
    if (!disabled) {
      onToggle(slot.id);
    }
  };

  const handleImageError = () => {
    setImageError(true);
  };

  return (
    <div
      className={`slot-card ${slot.enabled ? 'enabled' : 'disabled'} ${isBase ? 'locked' : ''}`}
      title={isBase ? 'Base alt is locked: cannot move or disable' : undefined}
    >
      <div className="slot-preview">
        {slot.isPlaceholder ? (
          <div className="slot-placeholder">
            <span>Alt {slot.altNumber}</span>
            <small>No Image</small>
          </div>
        ) : altPreview ? (
          <img
            src={`file://${altPreview}?t=${cacheKey || Date.now()}`}
            alt={`Slot ${slot.altNumber}`}
            onError={handleImageError}
            className={`slot-image ${isBase ? 'no-pointer' : ''}`}
            key={`${slot.id}-${cacheKey || Date.now()}`}
          />
        ) : !imageError ? (
          <img
            src={`data:image/png;base64,${slot.previewImage || ''}`}
            alt={`Slot ${slot.altNumber}`}
            onError={handleImageError}
            className={`slot-image ${isBase ? 'no-pointer' : ''}`}
          />
        ) : (
          <div className="slot-placeholder">
            <span>Alt {slot.altNumber}</span>
          </div>
        )}
        {isBase && (
          <div className="lock-badge" title="Base alt is locked">
            <svg viewBox="0 0 24 24" className="lock-icon" aria-hidden="true">
              <path fill="currentColor" d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5Zm-3 8V6a3 3 0 1 1 6 0v3H9Zm3 4a2 2 0 0 1 1 3.732V18a1 1 0 1 1-2 0v-1.268A2 2 0 0 1 12 13Z"/>
            </svg>
          </div>
        )}
      </div>
      
      <div className="slot-info">
        <div className="slot-name">
          {slot.name}
        </div>
        <div className="slot-alt-number">
          Alt {slot.altNumber}
        </div>
      </div>
      
      <div className="slot-actions">
        <button
          className={`toggle-btn ${slot.enabled ? 'enabled' : 'disabled'}`}
          onClick={handleToggle}
          disabled={disabled}
          title={isBase ? 'Base alt is locked: cannot move or disable' : (slot.enabled ? 'Disable slot' : 'Enable slot')}
        >
        </button>
      </div>
      
      {!slot.enabled && (
        <div className="disabled-overlay">
        </div>
      )}
    </div>
  );
};

export default SlotCard; 