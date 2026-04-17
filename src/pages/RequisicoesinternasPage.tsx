import { useState, useRef } from 'react';
import { Header } from '../components/Header';
import { PeriodSelector } from '../components/PeriodSelector';
import { DepartmentSelector } from '../components/DepartmentSelector';
import { ProgressBar } from '../components/ProgressBar';
import { useAuth } from '../context/AuthContext';
import { Download, Filter, FileDown } from 'lucide-react';
import '../styles/RequisicoesinternasPage.css';

type ReportStatus = 'idle' | 'running' | 'done' | 'error';

export function RequisicoesinternasPage() {
  const { credentials } = useAuth();

  const [selectedPeriod, setSelectedPeriod] = useState<{
    startDate: Date;
    endDate: Date;
  } | null>(null);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);

  const [reportStatus, setReportStatus] = useState<ReportStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  const handlePeriodChange = (startDate: Date, endDate: Date) => {
    setSelectedPeriod({ startDate, endDate });
  };

  const handleDepartmentsChange = (departments: string[]) => {
    setSelectedDepartments(departments);
  };

  const handleGenerateReport = async () => {
    if (!selectedPeriod || selectedDepartments.length === 0) {
      alert('Por favor, selecione um período e pelo menos um departamento.');
      return;
    }
    if (!credentials) return;

    // Fecha SSE anterior se existir
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setReportStatus('running');
    setProgress(0);
    setProgressMessage('Iniciando automação...');
    setErrorMessage(null);
    setJobId(null);

    try {
      let response: Response;
      try {
        response = await fetch('/api/generate-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: credentials.username,
            password: credentials.password,
            startDate: selectedPeriod.startDate.toISOString(),
            endDate: selectedPeriod.endDate.toISOString(),
            departments: selectedDepartments,
          }),
        });
      } catch (_) {
        throw new Error(
          'Não foi possível conectar ao servidor de automação. Certifique-se de que o backend está rodando:\n\ncd server\nnode index.js'
        );
      }

      if (!response.ok) {
        let errorMsg = 'Erro ao iniciar geração do relatório.';
        try {
          const data = await response.json();
          errorMsg = data.error || errorMsg;
        } catch (_) {
          // corpo vazio ou não-JSON (ex: 503 do proxy quando backend está offline)
          if (response.status === 503 || response.status === 502) {
            errorMsg =
              'Servidor de automação indisponível. Inicie o backend antes de gerar relatórios:\n\ncd server  →  node index.js';
          }
        }
        throw new Error(errorMsg);
      }

      const { jobId: newJobId } = await response.json();
      setJobId(newJobId);

      // Conecta ao SSE para acompanhar o progresso
      const es = new EventSource(`/api/progress/${newJobId}`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.status === 'running') {
          setProgress(data.percent ?? 0);
          setProgressMessage(data.message ?? '');
        } else if (data.status === 'done') {
          setProgress(100);
          setProgressMessage('Relatório pronto para download!');
          setReportStatus('done');
          es.close();
        } else if (data.status === 'error') {
          setReportStatus('error');
          setErrorMessage(data.error ?? 'Erro desconhecido.');
          es.close();
        }
      };

      es.onerror = () => {
        setReportStatus('error');
        setErrorMessage('Conexão com o servidor perdida. Tente novamente.');
        es.close();
      };
    } catch (err) {
      setReportStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Erro inesperado.');
    }
  };

  const handleDownload = () => {
    if (!jobId) return;
    const link = document.createElement('a');
    link.href = `/api/download/${jobId}`;
    link.click();
  };

  const handleReset = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setReportStatus('idle');
    setProgress(0);
    setProgressMessage('');
    setErrorMessage(null);
    setJobId(null);
  };

  const canGenerate = !!selectedPeriod && selectedDepartments.length > 0 && reportStatus !== 'running';

  return (
    <div className="requisicoes-page">
      <Header title="Requisições Internas" />

      <main className="requisicoes-content">
        <div className="filters-section">
          <div className="filter-header">
            <Filter size={24} />
            <h2>Filtros de Relatório</h2>
          </div>

          <div className="filters-grid">
            <div className="filter-card">
              <PeriodSelector onPeriodChange={handlePeriodChange} />
            </div>

            <div className="filter-card">
              <DepartmentSelector onDepartmentsChange={handleDepartmentsChange} />
            </div>
          </div>
        </div>

        {/* Barra de progresso / status */}
        {reportStatus !== 'idle' && (
          <ProgressBar
            percent={progress}
            message={progressMessage}
            status={reportStatus}
            errorMessage={errorMessage}
          />
        )}

        {/* Botão de download — aparece quando o relatório fica pronto */}
        {reportStatus === 'done' && jobId && (
          <div className="download-section">
            <button className="btn-download" onClick={handleDownload}>
              <FileDown size={20} />
              <span>Baixar Relatório CSV</span>
            </button>
            <button className="btn-new-report" onClick={handleReset}>
              Gerar novo relatório
            </button>
          </div>
        )}

        {/* Botão de tentar novamente após erro */}
        {reportStatus === 'error' && (
          <div className="filters-actions retry-actions">
            <button className="btn-generate btn-retry" onClick={handleReset}>
              Tentar novamente
            </button>
          </div>
        )}

        <div className="filters-actions">
          <button
            className="btn-generate"
            onClick={handleGenerateReport}
            disabled={!canGenerate}
          >
            <Download size={20} />
            <span>{reportStatus === 'running' ? 'Gerando...' : 'Gerar Relatório'}</span>
          </button>
        </div>
      </main>
    </div>
  );
}

