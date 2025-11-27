import React from 'react';
import './Header.css';

const Header = ({ modDirectory, onSelectDirectory, loading }) => {
  const getDirectoryName = (path) => {
    if (!path) return '';
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || path;
  };

  return (
    <header className="header">
      <div className="header-content">
        <div className="header-left">
          <h1 className="app-title">Moveset Customizer</h1>
          {modDirectory && (
            <div className="mod-info">
              <span className="mod-label">Mod:</span>
              <span className="mod-path">{getDirectoryName(modDirectory)}</span>
              <button 
                className="btn btn-secondary btn-sm"
                onClick={onSelectDirectory}
                disabled={loading}
              >
                Change
              </button>
            </div>
          )}
        </div>
        
        <div className="header-right">
          {loading && (
            <div className="loading-indicator">
              <div className="spinner"></div>
              <span>Loading...</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header; 