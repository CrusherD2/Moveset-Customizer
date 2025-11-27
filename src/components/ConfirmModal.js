import React from 'react';
import './ConfirmModal.css';

const ConfirmModal = ({ isOpen, title, message, onConfirm, onCancel, confirmText = 'Delete', cancelText = 'Cancel', danger = true }) => {
  if (!isOpen) return null;

  return (
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="confirm-modal-header">
          <h3>{title}</h3>
        </div>
        <div className="confirm-modal-body">
          <div className={`confirm-icon ${danger ? 'danger' : 'warning'}`}>
            {danger ? (
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
              </svg>
            )}
          </div>
          <p>{message}</p>
        </div>
        <div className="confirm-modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>
            {cancelText}
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;

