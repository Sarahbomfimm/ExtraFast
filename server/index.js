'use strict';

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { scrapeReport } = require('./scraper');

const app = express();

app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json());

// ── Job store em memória ──────────────────────────────────────────────────────
// jobId -> { status, percent, message, csvData, error, createdAt }
const jobs = new Map();

// Limpa jobs com mais de 1 hora para não vazar memória
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < oneHourAgo) jobs.delete(id);
  }
}, 15 * 60 * 1000);

// ── POST /api/generate-report ─────────────────────────────────────────────────
app.post('/api/generate-report', (req, res) => {
  const { username, password, startDate, endDate, departments } = req.body;

  if (!username || !password || !startDate || !endDate || !Array.isArray(departments) || departments.length === 0) {
    return res.status(400).json({ error: 'Parâmetros inválidos. Verifique período e departamentos.' });
  }

  const jobId = uuidv4();
  jobs.set(jobId, {
    status: 'running',
    percent: 0,
    message: 'Iniciando automação...',
    csvData: null,
    error: null,
    createdAt: Date.now(),
  });

  // Executa o scraper em background (sem await para retornar o jobId imediatamente)
  scrapeReport(
    { username, password, startDate, endDate, departments },
    (percent, message) => {
      const job = jobs.get(jobId);
      if (job) { job.percent = percent; job.message = message; }
    }
  )
    .then((csvData) => {
      const job = jobs.get(jobId);
      if (job) {
        job.status = 'done';
        job.percent = 100;
        job.message = 'Relatório pronto para download!';
        job.csvData = csvData;
      }
    })
    .catch((err) => {
      const job = jobs.get(jobId);
      if (!job) return;
      job.status = 'error';

      if (err.message === 'LOGIN_FAILED') {
        job.error =
          'Credenciais do HITS PMS inválidas. Verifique o e-mail e a senha utilizados no login do sistema.';
      } else if (err.message.startsWith('NETWORK_ERROR:')) {
        job.error =
          'O navegador do robô não conseguiu acessar o ambiente do HITS PMS por falha de rede ou DNS neste computador. Verifique VPN, proxy, firewall e acesso ao domínio pajucarahoteis.hitspms.net.';
      } else if (err.message.startsWith('EMPTY_REPORT:')) {
        job.error = 'Nenhum dado encontrado para o período e departamentos selecionados. Tente ajustar os filtros.';
      } else if (err.message.startsWith('SCRAPE_ERROR:')) {
        job.error = err.message.replace('SCRAPE_ERROR:', '').trim();
      } else {
        job.error = `Erro inesperado na automação: ${err.message}`;
        console.error('[Scraper]', err);
      }
    });

  res.json({ jobId });
});

// ── GET /api/progress/:jobId  (Server-Sent Events) ───────────────────────────
app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
  };

  const interval = setInterval(() => {
    const job = jobs.get(jobId);

    if (!job) {
      send({ status: 'error', error: 'Job não encontrado.' });
      clearInterval(interval);
      res.end();
      return;
    }

    send({ status: job.status, percent: job.percent, message: job.message, error: job.error });

    if (job.status === 'done' || job.status === 'error') {
      clearInterval(interval);
      res.end();
    }
  }, 400);

  req.on('close', () => clearInterval(interval));
});

// ── GET /api/download/:jobId ──────────────────────────────────────────────────
app.get('/api/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job || job.status !== 'done' || !job.csvData) {
    return res.status(404).json({ error: 'Relatório não encontrado ou ainda em processamento.' });
  }

  const filename = `requisicoes-internas-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // BOM UTF-8 para compatibilidade com Excel
  res.send('\uFEFF' + job.csvData);

  // Remove o job da memória após o download
  setTimeout(() => jobs.delete(req.params.jobId), 5000);
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true }));

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`\n✅ ExtraFast backend rodando em http://localhost:${PORT}\n`);
});
