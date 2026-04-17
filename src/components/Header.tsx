import { useAuth } from '../context/AuthContext';
import { User } from 'lucide-react';
import '../styles/Header.css';

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  const { user } = useAuth();

  return (
    <header className="header">
      <h1 className="header-title">{title}</h1>
      <div className="header-user">
        <div className="user-avatar">
          <User size={20} />
        </div>
        <span className="user-name">{user?.email}</span>
      </div>
    </header>
  );
}
