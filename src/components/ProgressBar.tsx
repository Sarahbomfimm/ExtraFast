import { CheckCircle, AlertCircle, Loader } from 'lucide-react';
import '../styles/ProgressBar.css';

interface ProgressBarProps {
  percent: number;
  message: string;
  status: 'running' | 'done' | 'error';
  errorMessage?: string | null;
}

export function ProgressBar({ percent, message, status, errorMessage }: ProgressBarProps) {
  return (
    <div className={`progress-wrapper status-${status}`}>
      <div className="progress-top">
        <div className="progress-icon-msg">
          {status === 'running' && <Loader size={20} className="progress-spinner" />}
          {status === 'done' && <CheckCircle size={20} className="progress-icon-done" />}
          {status === 'error' && <AlertCircle size={20} className="progress-icon-error" />}
          <span className="progress-message">{status === 'error' ? 'Falha na geração do relatório' : message}</span>
        </div>
        {status !== 'error' && (
          <span className="progress-percent">{percent}%</span>
        )}
      </div>

      {status !== 'error' && (
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {status === 'error' && errorMessage && (
        <div className="progress-error-detail">
          <p>{errorMessage}</p>
        </div>
      )}

      {status === 'running' && (
        <div className="progress-steps">
          <span className="progress-steps-text">O robô está trabalhando no sistema HITS PMS...</span>
        </div>
      )}
    </div>
  );
}
