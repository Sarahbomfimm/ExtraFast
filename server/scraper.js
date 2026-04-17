'use strict';

const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const LOGIN_URL =
  'https://susceptor.apphotel.one/account/login?returnUrl=%2Fconnect%2Fauthorize%2Flogin%3Fresponse_type%3Did_token%2520token%26client_id%3DB37748FC-ED13-4858-AE26-28AB3512A171%26redirect_uri%3Dhttps%253A%252F%252Fpajucarahoteis.hitspms.net%252FCallback%26scope%3Dopenid%2520profile%2520webapi%26nonce%3DN0.93084799808499021767024314808%26state%3D17670243148080.45920599247494753';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DEBUG_DIR = path.join(__dirname, 'debug');
const HITS_HOSTNAME = 'pajucarahoteis.hitspms.net';

function isVisibleInPage(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function formatDateDDMMYY(isoString) {
  const d = new Date(isoString);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

function formatDateYYYYMMDD(isoString) {
  const d = new Date(isoString);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${year}-${month}-${day}`;
}

function toCSV(headers, rows) {
  const escape = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(row.map(escape).join(','));
  }
  return lines.join('\r\n');
}

// Sets an input value in a way that works for both React and AngularJS
async function setInputValue(page, selector, value) {
  await page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return;
      // React
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      // AngularJS
      try {
        const scope = angular.element(el).scope(); // eslint-disable-line no-undef
        if (scope) scope.$apply();
      } catch (_) {}
    },
    selector,
    value
  );
}

async function clickVisible(page, selectors, errorMessage) {
  const selectorList = Array.isArray(selectors) ? selectors : [selectors];

  try {
    await page.waitForFunction(
      (sels) => sels.some((sel) => Array.from(document.querySelectorAll(sel)).some((el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })),
      { timeout: 20000 },
      selectorList
    );
  } catch (_) {
    throw new Error(`SCRAPE_ERROR: ${errorMessage}`);
  }

  const clicked = await page.evaluate((sels) => {
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };

    for (const sel of sels) {
      const elements = Array.from(document.querySelectorAll(sel));
      for (const el of elements) {
        if (!isVisible(el)) continue;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.click();
        return true;
      }
    }

    return false;
  }, selectorList);

  if (!clicked) {
    throw new Error(`SCRAPE_ERROR: ${errorMessage}`);
  }

  await sleep(800);
}

async function clickVisibleByText(page, selectors, texts, errorMessage) {
  const selectorList = Array.isArray(selectors) ? selectors : [selectors];
  const textList = texts.map((text) => text.toLowerCase());

  const clicked = await page.evaluate((sels, expectedTexts) => {
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };

    for (const sel of sels) {
      const elements = Array.from(document.querySelectorAll(sel));
      for (const el of elements) {
        const text = (el.textContent || '').toLowerCase();
        if (!isVisible(el)) continue;
        if (!expectedTexts.some((expected) => text.includes(expected))) continue;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.click();
        return true;
      }
    }

    return false;
  }, selectorList, textList);

  if (!clicked) {
    throw new Error(`SCRAPE_ERROR: ${errorMessage}`);
  }

  await sleep(800);
}

async function hasVisibleSelector(page, selectors) {
  const selectorList = Array.isArray(selectors) ? selectors : [selectors];
  return page.evaluate((sels) => {
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };

    return sels.some((sel) => Array.from(document.querySelectorAll(sel)).some(isVisible));
  }, selectorList);
}

async function captureDebugSnapshot(page, prefix) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `${prefix}-${stamp}`;
  const screenshotPath = path.join(DEBUG_DIR, `${baseName}.png`);
  const htmlPath = path.join(DEBUG_DIR, `${baseName}.html`);

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => '');
  if (html) {
    fs.writeFileSync(htmlPath, html, 'utf8');
  }

  const details = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    text: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600),
  })).catch(() => ({ url: '', title: '', text: '' }));

  return {
    screenshotPath,
    htmlPath,
    ...details,
  };
}

async function resolveHostForChrome(hostname) {
  try {
    const result = await dns.lookup(hostname, { family: 4 });
    return result.address;
  } catch (_) {
    return null;
  }
}

async function detectLoginState(page) {
  const loginState = await page
    .waitForFunction(
      () => {
        const isVisible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };

        const hasVisible = (selectors) => selectors.some((sel) => Array.from(document.querySelectorAll(sel)).some(isVisible));
        const pageText = (document.body?.innerText || '').toLowerCase();
        const href = window.location.href.toLowerCase();
        const title = document.title.toLowerCase();

        if (
          hasVisible(['.card-property', '.card-image-box', 'a[href="#navOptions"]', '#menustock', '#menuinternalRequisition']) ||
          pageText.includes('pajuçara praia hotel') ||
          href.includes('pajucarahoteis.hitspms.net') ||
          title.includes('apphotel')
        ) {
          return 'success';
        }

        if (
          pageText.includes('invalid login') ||
          pageText.includes('login inválido') ||
          pageText.includes('usuário ou senha inválidos') ||
          pageText.includes('incorrect username') ||
          pageText.includes('incorrect password')
        ) {
          return 'invalid';
        }

        if (hasVisible(['#Username', 'input[name="Username"]', '#Password', 'input[name="Password"]'])) {
          return 'login-form';
        }

        return 'pending';
      },
      { timeout: 30000 }
    )
    .then((handle) => handle.jsonValue())
    .catch(() => 'timeout');

  return loginState;
}

async function scrapeReport({ username, password, startDate, endDate, departments }, onProgress) {
  const resolvedHitsIp = await resolveHostForChrome(HITS_HOSTNAME);
  const browserArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];

  if (resolvedHitsIp) {
    browserArgs.push(`--host-resolver-rules=MAP ${HITS_HOSTNAME} ${resolvedHitsIp}`);
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: browserArgs,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    // ── PASSO 1: Acessar página de login ──────────────────────────────────────
    onProgress(5, 'Acessando sistema HITS PMS...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // ── PASSO 2: Preencher credenciais ────────────────────────────────────────
    onProgress(12, 'Preenchendo credenciais...');

    const usernameSelectors = [
      '#Username',
      'input[name="Username"]',
      'input[type="email"]',
      'input[name="Email"]',
    ];
    let userFilled = false;
    for (const sel of usernameSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click({ clickCount: 3 });
        await el.type(username, { delay: 30 });
        userFilled = true;
        break;
      }
    }
    if (!userFilled) throw new Error('SCRAPE_ERROR: Campo de usuário não encontrado na página de login.');

    const passSelectors = ['#Password', 'input[name="Password"]', 'input[type="password"]'];
    let passFilled = false;
    for (const sel of passSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click({ clickCount: 3 });
        await el.type(password, { delay: 30 });
        passFilled = true;
        break;
      }
    }
    if (!passFilled) throw new Error('SCRAPE_ERROR: Campo de senha não encontrado na página de login.');

    // ── PASSO 3: Clicar em Login ──────────────────────────────────────────────
    onProgress(20, 'Efetuando login no HITS PMS...');
    await clickVisible(page, ['button.button-navbar.hover-tag', 'button[type="submit"]'], 'Botão de login não estava clicável.');

    await page.waitForNavigation({ timeout: 15000, waitUntil: 'networkidle2' }).catch(() => {});
    await sleep(2500);

    const loginState = await detectLoginState(page);
    if (loginState === 'invalid') {
      throw new Error('LOGIN_FAILED');
    }
    if (loginState !== 'success') {
      const debug = await captureDebugSnapshot(page, 'login-state');
      if ((debug.url || '').startsWith('chrome-error://') || (debug.text || '').includes('ERR_NAME_NOT_RESOLVED')) {
        throw new Error(
          `NETWORK_ERROR: O navegador automatizado não conseguiu acessar ${HITS_HOSTNAME}. URL atual: ${debug.url || 'indisponível'}. Screenshot: ${debug.screenshotPath}. HTML: ${debug.htmlPath}.`
        );
      }
      throw new Error(
        `SCRAPE_ERROR: Não foi possível confirmar o login no HITS PMS após o envio das credenciais. URL atual: ${debug.url || 'indisponível'}. Título: ${debug.title || 'indisponível'}. Screenshot: ${debug.screenshotPath}. HTML: ${debug.htmlPath}. Texto capturado: ${debug.text || 'vazio'}`
      );
    }

    // ── PASSO 4: Selecionar hotel ─────────────────────────────────────────────
    onProgress(30, 'Selecionando hotel Pajuçara Praia...');
    await page.waitForSelector('.card-property', { timeout: 20000 });

    const hotelClicked = await page.evaluate(() => {
      // Tenta pelo ID primeiro
      const byId = document.getElementById('PAJUÇARA PRAIA HOTEL');
      if (byId) { byId.click(); return true; }
      // Fallback: busca por texto dentro dos cards
      const cards = document.querySelectorAll('.card-property, .card-image-box');
      for (const card of cards) {
        if (card.textContent.toUpperCase().includes('PAJUÇARA PRAIA')) {
          card.click();
          return true;
        }
      }
      return false;
    });

    if (!hotelClicked) throw new Error('SCRAPE_ERROR: Hotel Pajuçara Praia não encontrado na lista.');

    await page.waitForNavigation({ timeout: 20000, waitUntil: 'networkidle2' }).catch(() => {});
    await sleep(2000);

    // ── PASSO 5: Clicar no menu Operações ────────────────────────────────────
    onProgress(40, 'Acessando menu Operações...');
    await clickVisible(page, ['a[href="#navOptions"].nav-link.main-menu', 'a[href="#navOptions"]'], 'Menu Operações não estava disponível.');
    await sleep(1200);

    // ── PASSO 6: Expandir Estoque ─────────────────────────────────────────────
    onProgress(50, 'Abrindo submenu Estoque...');
    await clickVisible(
      page,
      ['#menustock', 'a[href="#stock"][data-toggle="collapse"]'],
      'Submenu Estoque não estava clicável.'
    );

    // ── PASSO 7: Clicar em Requisição Interna ─────────────────────────────────
    onProgress(58, 'Abrindo Requisição Interna...');
    await clickVisible(page, '#menuinternalRequisition', 'Menu Requisição Interna não estava clicável.');
    await sleep(2500);

    // ── PASSO 8: Clicar no botão de relatório de impressão ───────────────────
    onProgress(65, 'Abrindo painel de relatório...');
    // O botão tem class btn-cancel-icon e ícone "print"
    await clickVisible(
      page,
      ['button[ng-click="openInternalRequisitionReport()"]', '.btn-cancel-icon'],
      'Botão de relatório não estava clicável.'
    );
    await sleep(2000);

    // ── PASSO 9: Configurar filtro de período ─────────────────────────────────
    onProgress(72, 'Configurando período do relatório...');
    await clickVisibleByText(
      page,
      ['.button-filter', 'button'],
      ['período', 'periodo'],
      'Filtro de período não estava disponível.'
    );
    await sleep(1000);

    const startISO = formatDateYYYYMMDD(startDate);
    const endISO = formatDateYYYYMMDD(endDate);
    const startDDMMYY = formatDateDDMMYY(startDate);
    const endDDMMYY = formatDateDDMMYY(endDate);

    // Tenta preencher inputs de data no modal (tipo date ou texto mascarado)
    await page.evaluate(
      (startYMD, endYMD, startDMY, endDMY) => {
        const inputs = Array.from(document.querySelectorAll('input[type="date"], input[type="text"]')).filter(
          (el) => {
            const ph = (el.placeholder || '').toLowerCase();
            const cls = (el.className || '').toLowerCase();
            return (
              ph.includes('/') || ph.includes('data') || ph.includes('date') ||
              cls.includes('date') || cls.includes('data') || el.type === 'date'
            );
          }
        );

        const setVal = (el, val) => {
          try {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, val);
          } catch (_) { el.value = val; }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          try { angular.element(el).triggerHandler('change'); } catch (_) {} // eslint-disable-line no-undef
        };

        if (inputs.length >= 2) {
          const val0 = inputs[0].type === 'date' ? startYMD : startDMY;
          const val1 = inputs[1].type === 'date' ? endYMD : endDMY;
          setVal(inputs[0], val0);
          setVal(inputs[1], val1);
        }
      },
      startISO,
      endISO,
      startDDMMYY,
      endDDMMYY
    );

    await sleep(500);

    // Confirmar seleção de período
    const periodConfirmSelectors = [
      'button[ng-click*="confirm"]',
      'button[ng-click*="apply"]',
      'button[ng-click*="ok"]',
      '.btn-primary',
      '.btn-apply',
      '.btn-ok',
    ];
    const hasPeriodConfirm = await hasVisibleSelector(page, periodConfirmSelectors);
    if (hasPeriodConfirm) {
      await clickVisible(page, periodConfirmSelectors, 'Botão de confirmação do período não estava clicável.');
      await sleep(1000);
    } else {
      // Tenta pressionar Enter para confirmar
      await page.keyboard.press('Enter');
      await sleep(1000);
    }

    // ── PASSO 10: Configurar filtro de departamento ───────────────────────────
    onProgress(80, `Selecionando ${departments.length} departamento(s)...`);

    // Encontra e clica no botão/label "Departamento"
    const deptBtnClicked = await page.evaluate(() => {
      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };

      const ot = document.querySelector('one-translate[resource="lblDepartment"]');
      if (ot) {
        const btn = ot.closest('button') || ot.parentElement;
        if (btn && isVisible(btn)) { btn.click(); return true; }
        if (isVisible(ot)) {
          ot.click();
          return true;
        }
      }

      const allBtns = document.querySelectorAll('button, .button-filter');
      for (const btn of allBtns) {
        if (!isVisible(btn)) continue;
        if (btn.textContent.trim().toLowerCase().includes('departamento')) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (deptBtnClicked) {
      await sleep(1000);

      // Seleciona cada departamento pelo texto nos checkboxes/opções
      await page.evaluate((deptList) => {
        const normalize = (s) => s.trim().toUpperCase();

        // Tenta checkboxes com labels
        const labels = document.querySelectorAll('label');
        for (const label of labels) {
          const text = normalize(label.textContent);
          if (deptList.some((d) => normalize(d) === text || text.includes(normalize(d)))) {
            const cb = label.querySelector('input[type="checkbox"]');
            if (cb && !cb.checked) cb.click();
            else if (!cb) label.click();
          }
        }

        // Tenta opções em lista (li, div com texto de departamento)
        const items = document.querySelectorAll('li, .list-item, .option-item, [ng-repeat*="dept"], [ng-repeat*="department"]');
        for (const item of items) {
          const text = normalize(item.textContent);
          if (deptList.some((d) => normalize(d) === text || text.includes(normalize(d)))) {
            const cb = item.querySelector('input[type="checkbox"]');
            if (cb && !cb.checked) cb.click();
            else if (!cb) item.click();
          }
        }
      }, departments);

      await sleep(500);

      // Confirma seleção de departamentos
      const deptConfirmSelectors = [
        'button[ng-click*="confirm"]',
        'button[ng-click*="apply"]',
        '.btn-primary',
        '.btn-ok',
        '.btn-apply',
      ];
      const hasDeptConfirm = await hasVisibleSelector(page, deptConfirmSelectors);
      if (hasDeptConfirm) {
        try {
          await clickVisible(page, deptConfirmSelectors, 'Botão de confirmação do departamento não estava clicável.');
        } catch (_) {
          await page.keyboard.press('Enter');
        }
        await sleep(1500);
      } else {
        await page.keyboard.press('Enter');
        await sleep(1500);
      }
    }

    // ── PASSO 11: Aguardar e extrair tabela ───────────────────────────────────
    onProgress(88, 'Aguardando geração dos dados...');
    await page.waitForSelector('table', { timeout: 20000 });
    await sleep(1500);

    onProgress(93, 'Extraindo dados da tabela...');

    const tableData = await page.evaluate(() => {
      const rows = [];
      const tableRows = document.querySelectorAll('table tbody tr');
      tableRows.forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll('td'));
        const rowData = cells.map((td) => td.textContent.trim());
        if (rowData.some((c) => c !== '')) rows.push(rowData);
      });
      return rows;
    });

    if (tableData.length === 0) {
      throw new Error('EMPTY_REPORT: Nenhum dado encontrado para os filtros selecionados.');
    }

    // ── PASSO 12: Gerar CSV ───────────────────────────────────────────────────
    onProgress(97, 'Gerando arquivo CSV...');
    const headers = ['Produto', 'Solicitado', 'Atendido', 'Pendente (Qtd)', 'Pendente (Valor)'];
    const csv = toCSV(headers, tableData);

    onProgress(100, 'Relatório gerado com sucesso!');
    return csv;
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeReport };
