import { useState } from 'react';
import { format } from 'date-fns';
import { Calendar } from 'lucide-react';
import '../styles/PeriodSelector.css';

interface PeriodSelectorProps {
  onPeriodChange: (startDate: Date, endDate: Date) => void;
}

export function PeriodSelector({ onPeriodChange }: PeriodSelectorProps) {
  const today = new Date();
  const [startDate, setStartDate] = useState<string>(format(today, 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState<string>(format(today, 'yyyy-MM-dd'));

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newStart = e.target.value;
    setStartDate(newStart);
    if (new Date(newStart) <= new Date(endDate)) {
      onPeriodChange(new Date(newStart), new Date(endDate));
    }
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEnd = e.target.value;
    setEndDate(newEnd);
    if (new Date(startDate) <= new Date(newEnd)) {
      onPeriodChange(new Date(startDate), new Date(newEnd));
    }
  };

  return (
    <div className="period-selector">
      <div className="period-header">
        <Calendar size={20} />
        <h3>Período</h3>
      </div>

      <div className="period-content">
        <div className="date-inputs">
          <div className="date-input-group">
            <label htmlFor="start-date">De</label>
            <input
              id="start-date"
              type="date"
              value={startDate}
              onChange={handleStartDateChange}
              className="date-input"
            />
          </div>

          <div className="date-separator">→</div>

          <div className="date-input-group">
            <label htmlFor="end-date">Até</label>
            <input
              id="end-date"
              type="date"
              value={endDate}
              onChange={handleEndDateChange}
              className="date-input"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
