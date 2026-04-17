import { useState } from 'react';
import { ChevronDown, Building2, Check } from 'lucide-react';
import '../styles/DepartmentSelector.css';

const DEPARTMENTS = [
  'ESPAÇOS COMUNS',
  'RECEPÇÃO',
  'FRIGOBAR',
  'RESTAURANTE',
  'ROOM SERVICE',
  'BAR DA COBERTURA',
  'LAVANDERIA',
  'GOVERNANÇA',
  'COMERCIAL',
  'FINANCEIRO',
  'DIRETORIA',
  'CONTROLE',
  'RH',
  'MANUTENÇÃO',
  'ROUPARIA',
  'CAFÉ DA MANHÃ',
  'PAJUCARA EXPRESS',
  'ALMOXARIFADO DA MANUTENÇÃO',
  'COZINHA',
  'ADMINISTRATIVO',
  'OBRAS E REFORMAS',
  'REFEITÓRIO',
  'EVENTOS',
];

interface DepartmentSelectorProps {
  onDepartmentsChange: (departments: string[]) => void;
}

export function DepartmentSelector({ onDepartmentsChange }: DepartmentSelectorProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [tempSelected, setTempSelected] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const handleToggle = (department: string) => {
    let newSelected: string[];
    if (department === 'Todos') {
      newSelected = tempSelected.length === DEPARTMENTS.length ? [] : [...DEPARTMENTS];
    } else {
      newSelected = tempSelected.includes(department)
        ? tempSelected.filter(d => d !== department)
        : [...tempSelected, department];
    }
    setTempSelected(newSelected);
  };

  const handleSelectAll = () => {
    const newSelected = tempSelected.length === DEPARTMENTS.length ? [] : [...DEPARTMENTS];
    setTempSelected(newSelected);
  };

  const handleConfirm = () => {
    setSelected(tempSelected);
    onDepartmentsChange(tempSelected);
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleOpenDropdown = () => {
    setTempSelected(selected);
    setIsOpen(true);
  };

  const filteredDepartments = DEPARTMENTS.filter(dept =>
    dept.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="department-selector">
      <div className="department-header">
        <Building2 size={20} />
        <h3>Departamentos</h3>
      </div>

      <div className="department-dropdown">
        <button
          className="dropdown-trigger"
          onClick={handleOpenDropdown}
        >
          <span className="dropdown-text">
            {selected.length === 0
              ? 'Selecionar departamentos...'
              : selected.length === DEPARTMENTS.length
                ? 'Todos os departamentos'
                : `${selected.length} selecionado${selected.length > 1 ? 's' : ''}`}
          </span>
          <ChevronDown
            size={20}
            className={`dropdown-icon ${isOpen ? 'open' : ''}`}
          />
        </button>

        {isOpen && (
          <div className="dropdown-menu">
            <div className="search-box">
              <input
                type="text"
                placeholder="Buscar departamento..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
            </div>

            <div className="select-all-option">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={tempSelected.length === DEPARTMENTS.length}
                  onChange={handleSelectAll}
                  className="checkbox-input"
                />
                <span className="checkbox-text">Todos os departamentos</span>
              </label>
            </div>

            <div className="departments-list">
              {filteredDepartments.map((department) => (
                <label key={department} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={tempSelected.includes(department)}
                    onChange={() => handleToggle(department)}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">{department}</span>
                </label>
              ))}
            </div>

            <div className="dropdown-footer">
              <button
                className="btn-cancel"
                onClick={() => {
                  setIsOpen(false);
                  setSearchTerm('');
                }}
              >
                Cancelar
              </button>
              <button
                className="btn-confirm"
                onClick={handleConfirm}
              >
                <Check size={18} />
                Confirmar
              </button>
            </div>
          </div>
        )}

        {selected.length > 0 && (
          <div className="selected-tags">
            {selected.map((dept) => (
              <div key={dept} className="tag">
                <span>{dept}</span>
                <button
                  onClick={() => {
                    const newSelected = selected.filter(d => d !== dept);
                    setSelected(newSelected);
                    onDepartmentsChange(newSelected);
                  }}
                  className="tag-remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
