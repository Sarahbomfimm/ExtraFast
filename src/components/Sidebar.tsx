import { Zap, FileText, LogOut, Menu, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useState } from 'react';
import '../styles/Sidebar.css';

interface SidebarProps {
  activeMenu: string;
  onMenuChange: (menu: string) => void;
  isCollapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

export function Sidebar({ activeMenu, onMenuChange, isCollapsed, onCollapsedChange }: SidebarProps) {
  const { logout } = useAuth();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const handleMenuClick = (menu: string) => {
    onMenuChange(menu);
    setIsMobileOpen(false);
  };

  return (
    <>
      <button className="sidebar-toggle" onClick={() => setIsMobileOpen(!isMobileOpen)}>
        {isMobileOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      <aside className={`sidebar ${isMobileOpen ? 'open' : ''} ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <Zap size={32} />
            <span className="logo-text">ExtraFast</span>
          </div>
          <button
            className="collapse-button"
            onClick={() => onCollapsedChange(!isCollapsed)}
            title={isCollapsed ? 'Expandir' : 'Recolher'}
          >
            {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
          </button>
        </div>

        <nav className="sidebar-nav">
          <ul>
            <li>
              <button
                className={`nav-item ${activeMenu === 'home' ? 'active' : ''}`}
                onClick={() => handleMenuClick('home')}
                title="Dashboard"
              >
                <span className="nav-icon">📊</span>
                <span className="nav-text">Dashboard</span>
              </button>
            </li>
            <li>
              <button
                className={`nav-item ${activeMenu === 'requisicoes' ? 'active' : ''}`}
                onClick={() => handleMenuClick('requisicoes')}
                title="Requisições Internas"
              >
                <FileText size={20} />
                <span className="nav-text">Requisições Internas</span>
              </button>
            </li>
          </ul>
        </nav>

        <div className="sidebar-footer">
          <button className="logout-button" onClick={logout} title="Sair">
            <LogOut size={20} />
            <span className="logout-text">Sair</span>
          </button>
        </div>
      </aside>

      {isMobileOpen && <div className="sidebar-overlay" onClick={() => setIsMobileOpen(false)} />}
    </>
  );
}
