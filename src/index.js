import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router, Link, useLocation } from 'react-router-dom';
import './index.css';
import ViewerApp from './ViewerApp';

/**
 * ナビゲーションメニューコンポーネント
 */
function Navigation() {
  const location = useLocation();
  
  return (
    <nav className="navigation-menu">
      <div className="nav-container">
        <div className="nav-brand">
          管路ビューア
        </div>
        <div className="nav-links">
          <Link 
            to="/" 
            className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}
          >
            <span className="nav-icon">🗺️</span>
            <span className="nav-text">3Dシーン</span>
          </Link>
          <Link 
            to="/cross-section" 
            className={`nav-link ${location.pathname === '/cross-section' ? 'active' : ''}`}
          >
            <span className="nav-icon">📐</span>
            <span className="nav-text">断面図生成</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <Router>
      <Navigation />
      <ViewerApp />
    </Router>
  </React.StrictMode>
);

