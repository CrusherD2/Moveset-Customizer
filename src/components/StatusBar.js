import React from 'react';
import './StatusBar.css';

const StatusBar = ({ status, onApplyChanges, onReset, onImportSkins, onDeleteAllDisabled, loading, hasMod, hasUnappliedChanges, hasDisabledSlots, progress }) => {
  const progressPercent = progress ? Math.round((progress.current / progress.total) * 100) : 0;
  
  return (
    <div className="status-bar">
      {/* Progress bar overlay */}
      {progress && (
        <div className="progress-overlay">
          <div className="progress-bar-container">
            <div 
              className="progress-bar-fill" 
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="progress-info">
            <span className="progress-message">{progress.message || 'Processing...'}</span>
            <span className="progress-percent">{progressPercent}%</span>
          </div>
        </div>
      )}
      
      <div className="status-content">
        <div className="status-left">
          <div className="status-text">
            {loading && !progress ? (
              <div className="status-loading">
                <div className="spinner"></div>
                <span>{status}</span>
              </div>
            ) : (
              <span>{status}</span>
            )}
          </div>
        </div>
        
        <div className="status-right">
          {hasMod && (
            <>
              {hasDisabledSlots && (
              <button
                className="btn btn-danger"
                onClick={onDeleteAllDisabled}
                disabled={loading}
                title="Permanently delete all disabled skins"
              >
                Delete All Disabled
              </button>
              )}
              <button
                className={`btn btn-primary btn-import ${hasUnappliedChanges ? 'btn-import-blocked' : ''}`}
                onClick={hasUnappliedChanges ? undefined : onImportSkins}
                disabled={loading}
                title={hasUnappliedChanges ? "Apply current changes before importing skins" : "Import skins from another mod folder"}
              >
                Import Skins
              </button>
              <button
                className="btn btn-secondary"
                onClick={onReset}
                disabled={loading}
              >
                Reset
              </button>
              <button
                className="btn btn-primary"
                onClick={onApplyChanges}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <div className="spinner"></div>
                    Applying...
                  </>
                ) : (
                  'Apply Changes'
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default StatusBar; 