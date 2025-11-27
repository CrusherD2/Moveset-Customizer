import React from 'react';
import './UpdateNotification.css';

const { ipcRenderer } = window.require('electron');

const UpdateNotification = ({ updateInfo, onDismiss }) => {
  if (!updateInfo || !updateInfo.hasUpdate) return null;
  
  const handleDownload = () => {
    ipcRenderer.invoke('open-external-url', updateInfo.downloadUrl || updateInfo.releaseUrl);
  };
  
  const handleViewRelease = () => {
    ipcRenderer.invoke('open-external-url', updateInfo.releaseUrl);
  };
  
  return (
    <div className="update-notification">
      <div className="update-content">
        <div className="update-icon">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
        </div>
        <div className="update-text">
          <span className="update-title">Update Available!</span>
          <span className="update-version">
            v{updateInfo.currentVersion} → v{updateInfo.latestVersion}
          </span>
        </div>
        <div className="update-actions">
          <button className="btn-update" onClick={handleDownload}>
            Download
          </button>
          <button className="btn-view" onClick={handleViewRelease}>
            View
          </button>
          <button className="btn-dismiss" onClick={onDismiss}>
            ✕
          </button>
        </div>
      </div>
    </div>
  );
};

export default UpdateNotification;

