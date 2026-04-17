import { useState } from 'react';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { RequisicoesinternasPage } from './pages/RequisicoesinternasPage';
import { Sidebar } from './components/Sidebar';
import './App.css';
import './styles/globals.css';

function App() {
  const { isAuthenticated } = useAuth();
  const [activeMenu, setActiveMenu] = useState('home');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div className={`app-container ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar 
        activeMenu={activeMenu} 
        onMenuChange={setActiveMenu}
        isCollapsed={isSidebarCollapsed}
        onCollapsedChange={setIsSidebarCollapsed}
      />
      {activeMenu === 'home' && <HomePage />}
      {activeMenu === 'requisicoes' && <RequisicoesinternasPage />}
    </div>
  );
}

export default App;
