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
const ALL_DEPARTMENTS = [
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

function isVisibleInPage(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function parseDateParts(value) {
  const raw = String(value || '').trim();

  // Fix: Pega apenas os primeiros 10 caracteres (YYYY-MM-DD) para evitar fuso horário de strings ISO completas
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    return { year: Number(ymd[1]), month: Number(ymd[2]), day: Number(ymd[3]) };
  }

  const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) {
    return { year: Number(dmy[3]), month: Number(dmy[2]), day: Number(dmy[1]) };
  }

  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
    };
  }

  throw new Error(`Invalid date value: ${value}`);
}

function formatDateDDMMYY(input) {
  const { year, month, day } = parseDateParts(input);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${String(year).slice(-2)}`;
}

function formatDateYYYYMMDD(input) {
  const { year, month, day } = parseDateParts(input);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeText(value) {
  return (value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function toCSV(headers, rows) {
  const escape = (v) => {
    const s = String(v == null ? '' : v);
    return (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r'))
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
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
          const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 1, height: 1 };
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
    protocolTimeout: 600000,
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
    await sleep(2000);

    // Aguarda a aba de requisição ficar visível antes de continuar
    await page.waitForFunction(
      () => {
        const el = document.getElementById('internalRequisition');
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      },
      { timeout: 20000 }
    ).catch((err) => {
      throw new Error(`SCRAPE_ERROR: Aba de requisição interna não apareceu. ${err.message}`);
    });
    await sleep(1500);

    // ── PASSO 8: Clicar no botão de relatório de compra ───────────────────────
    onProgress(65, 'Abrindo relatório de requisições...');
    // Baseado no automation.py: button[one-tltranslate="lblPurchaseRequisition"]
    const purchaseReqBtnSelectors = [
      'button[one-tltranslate="lblPurchaseRequisition"]',
      'button:has(one-translate[resource="lblPurchaseRequisition"])',
    ];
    
    const btnFound = await page.evaluate((sels) => {
      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };

      for (const sel of sels) {
        const btn = document.querySelector(sel);
        if (btn && isVisible(btn)) {
          btn.click();
          return true;
        }
      }
      return false;
    }, purchaseReqBtnSelectors);

    if (!btnFound) {
      throw new Error('SCRAPE_ERROR: Botão de relatório de requisições não encontrado.');
    }
    await sleep(3000);

    // ── PASSO 9: Configurar filtro de período ─────────────────────────────────
    onProgress(72, 'Configurando período do relatório...');

    await clickVisibleByText(
      page,
      ['button.button-filter', 'button', '.button-filter'],
      ['período', 'periodo'],
      'Botão de filtro de período não foi encontrado.'
    );
    await sleep(1500);

    const startDDMMYY = formatDateDDMMYY(startDate);
    const endDDMMYY = formatDateDDMMYY(endDate);
    const periodRange = `${startDDMMYY} - ${endDDMMYY}`;

    console.log(`[PASSO 9] Preenchendo período: ${periodRange}`);

    // HITS usa campo mascarado: limita a busca aos campos de data para evitar concatenacoes em inputs incorretos
    await page.waitForSelector('input.date-picker, input[placeholder*="/"]', { timeout: 12000 }).catch(() => {});

    const candidateInputs = await page.$$('input.date-picker, input[placeholder*="/"]');
    let finalValue = '';
    let datesFilled = false;

    const isDateLikeInput = async (inputHandle) => page.evaluate((el) => {
      if (!el) return false;
      const cls = (el.className || '').toLowerCase();
      const id = (el.id || '').toLowerCase();
      const name = (el.name || '').toLowerCase();
      const ph = (el.placeholder || '').toLowerCase();
      return (
        cls.includes('date-picker') ||
        cls.includes('date') ||
        id.includes('date') ||
        name.includes('date') ||
        ph.includes('/')
      );
    }, inputHandle).catch(() => false);

    const normalizePeriod = (s) => (s || '').replace(/\s+/g, ' ').trim();

    for (const input of candidateInputs) {
      const isDateLike = await isDateLikeInput(input);
      if (!isDateLike) continue;

      // Primeiro: seta valor de forma direta para evitar append indevido de mascaras antigas
      await page.evaluate((el, value) => {
        if (!el) return;
        el.focus();
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }, input, periodRange).catch(() => {});

      await sleep(350);
      finalValue = await page.evaluate((el) => (el.value || '').trim(), input).catch(() => '');

      // Fallback com teclado caso a tela exija digitacao para confirmar mascara
      if (!finalValue || !normalizePeriod(finalValue).includes(startDDMMYY) || !normalizePeriod(finalValue).includes(endDDMMYY)) {
        try {
          await input.click({ clickCount: 3 });
          await page.keyboard.press('Control+A').catch(() => {});
          await page.keyboard.press('Backspace').catch(() => {});
          await input.type(periodRange, { delay: 45 });
          await page.keyboard.press('Enter').catch(() => {});
          await sleep(450);
        } catch (_) {}

        finalValue = await page.evaluate((el) => (el.value || '').trim(), input).catch(() => '');
      }

      const normFinal = normalizePeriod(finalValue);
      if (normFinal.includes(startDDMMYY) && normFinal.includes(endDDMMYY)) {
        datesFilled = true;
        break;
      }
    }

    console.log(`[DEBUG] Campo de periodo preenchido: ${finalValue}`);

    if (!datesFilled) {
      throw new Error(`SCRAPE_ERROR: Não foi possível preencher o campo de período no formato esperado (${periodRange}).`);
    }

    await sleep(1000);

    // Confirma a seleção de período
    const confirmClicked = await page.evaluate(() => {
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 1, height: 1 };
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };

      // Prioriza o padrão usado no fluxo manual/Playwright
      const blueButtons = Array.from(document.querySelectorAll('button.btn-blue'));
      for (const btn of blueButtons) {
        if (!isVisible(btn)) continue;
        const icon = btn.querySelector('em.material-icons');
        const iconText = ((icon && icon.textContent) || '').trim().toLowerCase();
        if (iconText === 'check' || iconText === 'done') {
          btn.click();
          return true;
        }
      }

      // Procura por botão com ícone "check" (material-icons)
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        if (!isVisible(btn)) continue;
        const hasCheck = btn.querySelector('em.material-icons');
        if (hasCheck && (hasCheck.textContent === 'check' || hasCheck.textContent === 'done')) {
          btn.click();
          return true;
        }
      }

      // Fallback: tenta qualquer botão azul/primário
      const primaryBtns = document.querySelectorAll('.btn-blue, .btn-primary, button[ng-click*="confirm"], button[ng-click*="apply"]');
      for (const btn of primaryBtns) {
        if (isVisible(btn)) {
          btn.click();
          return true;
        }
      }

      return false;
    });

    if (!confirmClicked) {
      // Tenta Enter como última opção
      await page.keyboard.press('Enter');
    }
    await sleep(1500);

    // ── PASSO 10: Configurar filtro de departamento ───────────────────────────
    onProgress(80, `Selecionando ${departments.length} departamento(s)...`);
    const normalizedDepartments = departments.map(normalizeText);
    const allDepartmentsNormalized = ALL_DEPARTMENTS.map(normalizeText);
    const requestAllDepartments =
      normalizedDepartments.length >= allDepartmentsNormalized.length - 1 ||
      (
        normalizedDepartments.length === allDepartmentsNormalized.length &&
        allDepartmentsNormalized.every((dept) => normalizedDepartments.includes(dept))
      );

    console.log(
      `[PASSO 10] requestAllDepartments=${requestAllDepartments} selected=${normalizedDepartments.length} totalKnown=${allDepartmentsNormalized.length}`
    );

    // Clica no botão de departamento para abrir o modal
    const deptOpened = await page.evaluate(() => {
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };

      const findClickableAncestor = (el) => {
        if (!el) return null;
        return (
          el.closest('button, [role="button"], [ng-click], .btn, .btn-filter, .button-filter, [class*="filter"], [class*="dropdown"], [class*="select"]') ||
          el.parentElement
        );
      };

      // Tenta primeiro com one-translate
      const ot = document.querySelector('one-translate[resource="lblDepartment"]');
      if (ot) {
        const target = findClickableAncestor(ot);
        if (target && isVisible(target)) {
          target.click();
          return true;
        }

        // Fallback: tenta clicar no próprio label traduzido
        if (isVisible(ot)) {
          ot.click();
          return true;
        }
      }

      // Procura por botão/filtro com texto "Departamento"
      const buttons = Array.from(
        document.querySelectorAll(
          'button, .button-filter, .options-filter, [ng-click*="openChangeFilter"], [class*="filter"]'
        )
      );
      for (const btn of buttons) {
        const text = (btn.textContent || '').toLowerCase();
        if (isVisible(btn) && text.includes('departamento')) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (!deptOpened) {
      // Se não conseguir abrir, apenas loga o aviso mas continua
      console.log('[PASSO 10] Botão de departamento não encontrado, continuando...');
    } else {
      await sleep(1500);

      // Captura screenshot do modal para diagnóstico
      await captureDebugSnapshot(page, 'dept-filter-modal');
      console.log('[PASSO 10] Screenshot do modal de departamentos capturado (dept-filter-modal)');

      // Captura também HTML bruto do modal para análise
      const modalHTML = await page.evaluate(() => {
        const modal = document.querySelector('[class*="modal"], [role="dialog"], .modal-body, .modal-content');
        return modal ? modal.outerHTML.slice(0, 5000) : 'Modal não encontrado';
      });
      console.log(`[DEBUG PASSO 10] Modal HTML (primeiros 5000 chars):\n${modalHTML}`);

      // Verifica se o modal realmente abriu
      const modalOpen = await page.evaluate(() => {
        const modals = Array.from(document.querySelectorAll('[class*="modal"], [class*="dialog"], [role="dialog"], .modal-body, .modal-content'));
        return modals.some((el) => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        });
      });
      console.log(`[PASSO 10] Modal visível: ${modalOpen}`);

      await page
        .waitForFunction(() => {
          const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 1, height: 1 };
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          };

          const hasVisibleFilterPanel = Array.from(
            document.querySelectorAll('#one-search-modal-content, .one-search-modal-content, [id*="one-search-modal-content"]')
          ).some(isVisible);

          // Verifica se existem opções carregadas
          const options = document.querySelectorAll('.btn-check, .btn-check-card, [ng-repeat*="selection"]');
          
          // CRUCIAL: Verifica se o HITS não está com um bloqueio de interface (Loading)
          const isBlocked = !!document.querySelector('.block-ui-visible, .block-ui-active, [aria-busy="true"]');
          const isLoading = !!document.querySelector('.loading-bar, .spinner, [class*="loading"]');
          
          // Só prossegue se o painel existir, houver opções e o bloqueio de UI sumiu
          return hasVisibleFilterPanel && options.length > 0 && !isBlocked && !isLoading;
        }, { timeout: 12000 })
        .catch(() => {});
      await sleep(1000); // Pausa extra para segurança pós-carregamento

      // Fase 1: Encontra os botões e retorna seus seletores/títulos
      const buttonInfo = await page.evaluate(() => {
        const normalize = (s) =>
          (s || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        const isVisible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };

        const root = document.querySelector('#one-search-modal-content') ||
                     document.querySelector('.one-search-modal-content') ||
                     document.querySelector('[id*="one-search-modal-content"]') ||
                     document;

        // Encontra todos os botões visíveis
        const allButtons = Array.from(root.querySelectorAll('.btn-check, [ng-repeat*="selection"]')).filter(isVisible);
        console.log(`[DEBUG PASSO 10] Total de botões encontrados: ${allButtons.length}`);

        // Extrai informações dos botões (title, texto, se está ativo)
        const buttons = allButtons.map((btn) => ({
          title: (btn.getAttribute('title') || '').trim(),
          text: (btn.textContent || '').trim(),
          isActive: btn.classList.contains('active'),
          isAllBtn: normalize(btn.textContent || '').includes('TODOS'),
        })).filter((info) => info.title || info.text); // Remove botões sem identificação

        console.log(`[DEBUG PASSO 10] Botões extraídos: ${buttons.length}`);
        return { totalCount: allButtons.length, buttons };
      });

      console.log(`[DEBUG PASSO 10] Fase 1 completa: encontrados ${buttonInfo.totalCount} botões, ${buttonInfo.buttons.length} com info válida`);

      // Fase 2: Clica em cada botão usando page.click() (eventos reais do browser)
      let deptCount = 0;
      
      for (const btnInfo of buttonInfo.buttons) {
        // Pula se já está ativo
        if (btnInfo.isActive && !requestAllDepartments) continue;

        try {
          // Cria um seletor único pelo título
          let selector = `.btn-check[title="${btnInfo.title.replace(/"/g, '\\"')}"]`;
          
          // Fallback: se o título for vazio, procura pelo texto
          if (!btnInfo.title && btnInfo.text) {
            // Escapa caracteres especiais no seletor
            const escapedText = btnInfo.text.replace(/"/g, '\\"').replace(/\n/g, ' ').slice(0, 50);
            selector = `.btn-check:contains('${escapedText}')`;
          }

          // Tenta encontrar e clicar o elemento
          try {
            await page.waitForSelector(selector, { visible: true, timeout: 1500 });
          } catch (timeoutErr) {
            // Se waitForSelector falhar, tenta com a forma alternativa
            selector = `.btn-check[title="${btnInfo.title.replace(/"/g, '\\"')}"]`;
            if (!btnInfo.title) {
              // Se não tem title, procura qualquer .btn-check visível
              const allBtns = await page.$$('.btn-check');
              console.log(`[DEBUG PASSO 10] Usando fallback: ${allBtns.length} botões disponíveis`);
              continue;
            }
          }

          // Executa o clique usando page.click() - dispara evento real
          await page.click(selector);
          console.log(`[DEBUG PASSO 10] ✓ Clicado via page.click(): ${btnInfo.title || btnInfo.text.slice(0, 30)}`);
          deptCount++;

          // Pequena pausa entre cliques para o Angular processar
          await sleep(250);
        } catch (err) {
          console.log(`[DEBUG PASSO 10] ✗ Erro ao clicar ${btnInfo.title || btnInfo.text.slice(0, 30)}: ${err.message}`);
        }
      }

      console.log(`[DEBUG PASSO 10] Fase 2 completa: clicou em ${deptCount} botões via page.click()`);

      // Pausa para o Angular processar os cliques
      await sleep(1000);

      // Log de diagnóstico ANTES de testar deptCount
      console.log(`[DEBUG PASSO 10] deptCount=${deptCount}, requestAllDepartments=${requestAllDepartments}`);

      if (requestAllDepartments && deptCount === 0) {
        // Captura estrutura do DOM para diagnóstico
        const domDiagnostic = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const buttonsSnapshot = buttons.map((btn) => ({
            class: btn.className,
            id: btn.id,
            title: btn.getAttribute('title'),
            textContent: (btn.textContent || '').slice(0, 50),
            visible: window.getComputedStyle(btn).display !== 'none',
            dataAttrs: Array.from(btn.attributes)
              .filter((attr) => attr.name.startsWith('data-') || attr.name.startsWith('ng-'))
              .map((attr) => `${attr.name}=${attr.value}`)
              .join('|'),
          }));

          const allElements = Array.from(document.querySelectorAll('[ng-repeat*="selection"], [class*="check"], [class*="filter"]'));
          console.log(`[DIAGNOSTIC] Total buttons on page: ${buttons.length}`);
          console.log(`[DIAGNOSTIC] Relevant elements (ng-repeat/check/filter): ${allElements.length}`);
          console.log(`[DIAGNOSTIC] First 10 buttons: ${JSON.stringify(buttonsSnapshot.slice(0, 10))}`);

          return { totalButtons: buttons.length, buttonsSnapshot, allElementsCount: allElements.length };
        });

        console.log(`[DIAGNOSTIC] DOM Info:`, domDiagnostic);

        // NÃO lance erro ainda - deixa continuar para capturar mais info
        console.log(`[PASSO 10] ⚠️ Aviso: 0 departamentos foram clicados. Modal pode não ter estrutura esperada.`);
      }

      const activeDeptInfo = await page.evaluate(() => {
        const normalize = (s) =>
          (s || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        const activeButtons = Array.from(
          document.querySelectorAll('.btn-check.active, .btn-check-radio.active, .btn-check-card.active, .btn-check-card-radio.active')
        );
        const activeTitles = activeButtons
          .map((btn) => (btn.getAttribute('title') || btn.textContent || '').trim())
          .filter(Boolean);

        const allActive = activeButtons.some((btn) => {
          const text = normalize((btn.getAttribute('title') || '') + ' ' + (btn.textContent || ''));
          return text.includes('TODOS') || text.includes('ALL') || !!btn.querySelector('one-translate[resource="lblAll"]');
        });

        return {
          activeCount: activeTitles.length,
          allActive,
          sample: activeTitles.slice(0, 5),
        };
      });

      console.log(
        `[PASSO 10] Ativos no modal: ${activeDeptInfo.activeCount}; todosAtivo=${activeDeptInfo.allActive}; amostra=${activeDeptInfo.sample.join(' | ')}`
      );

      // Se o modal mudou e não conseguimos clicar, segue em modo best-effort
      // para não bloquear toda a geração do relatório.
      if (requestAllDepartments && deptCount === 0) {
        console.log('[PASSO 10] ⚠️ Nenhum departamento clicado. Continuando em modo best-effort para não interromper o relatório.');
      }

      await sleep(1000);

      // Confirma seleção de departamentos
      const deptConfirmed = await page.evaluate(() => {
        const isVisible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };

        const filterRoot = Array.from(
          document.querySelectorAll('#one-search-modal-content, .one-search-modal-content, [id*="one-search-modal-content"], [class*="modal"], [role="dialog"]')
        ).find(isVisible);

        if (filterRoot) {
          const applyButtons = Array.from(
            filterRoot.querySelectorAll('button[ng-click*="applyFilters"], .btn-blue, .btn-primary, button[ng-click*="confirm"], button[ng-click*="apply"]')
          ).filter(isVisible);

          const preferred = applyButtons.find((btn) => {
            const txt = (btn.textContent || '').toLowerCase();
            return txt.includes('aplicar') || txt.includes('confirm') || txt.includes('ok');
          }) || applyButtons[0];

          if (preferred) {
            preferred.click();
            return true;
          }
        }

        // Procura por botão com ícone "check"
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const btn of buttons) {
          if (!isVisible(btn)) continue;
          const hasCheck = btn.querySelector('em.material-icons');
          if (hasCheck && (hasCheck.textContent === 'check' || hasCheck.textContent === 'done')) {
            btn.click();
            return true;
          }
        }

        // Fallback: botão azul/primário
        const primaryBtns = document.querySelectorAll('.btn-blue, .btn-primary, button[ng-click*="confirm"], button[ng-click*="apply"]');
        for (const btn of primaryBtns) {
          if (isVisible(btn)) {
            btn.click();
            return true;
          }
        }

        return false;
      });

      if (!deptConfirmed) {
        // Tenta Enter como última opção
        await page.keyboard.press('Enter');
      }
      await sleep(1500);
    }

    // ── PASSO 11: Aguardar e extrair requisições ─────────────────────────────
    onProgress(88, 'Aguardando geração dos dados...');
    
    // No HITS, após fechar o modal, aparece um overlay de "block-ui". 
    // Precisamos esperar ele sumir antes de ler a tabela.
    try {
      await page.waitForFunction(() => 
        !document.querySelector('.block-ui-visible, .block-ui-active, [aria-busy="true"]'),
        { timeout: 15000 }
      );
    } catch (e) {
      console.log('[PASSO 11] Timeout esperando overlay sumir, continuando...');
    }

    await page.waitForSelector('table', { timeout: 10000 }).catch(() => {});
    await sleep(3000); // Tempo para o Angular renderizar as linhas

    // Scroll to force all lazy-rendered requisition blocks to load
    onProgress(90, 'Carregando todas as requisições...');
    let prevScrollHeight = -1;
    let prevProductRowCount = -1;
    let stablePasses = 0;
    for (let pass = 0; pass < 60; pass++) {
      const metrics = await page.evaluate(() => {
        const scrollContainers = Array.from(document.querySelectorAll('div, section, main, article')).filter((el) => {
          if (!(el instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(el);
          const hasScrollableY = ['auto', 'scroll', 'overlay'].includes(style.overflowY);
          return (hasScrollableY || el.classList.contains('listBody') || el.classList.contains('report-table')) && el.querySelector('table');
        });

        const h = Math.max(
          document.documentElement ? document.documentElement.scrollHeight : 0,
          document.body ? document.body.scrollHeight : 0
        );

        window.scrollTo(0, h);
        scrollContainers.forEach((el) => {
          el.scrollTop = el.scrollHeight;
        });

        const productRows = document.querySelectorAll('tbody[ng-repeat="product in item.Items"] tr, tbody[ng-repeat="product in item.Items"] td[ng-bind-html="product.ProductNameAndObservation"]').length;

        return { h, productRows };
      });
      await sleep(500);

      if (metrics.h === prevScrollHeight && metrics.productRows === prevProductRowCount) {
        stablePasses += 1;
      } else {
        stablePasses = 0;
      }

      if (stablePasses >= 3 && pass >= 5) break;

      prevScrollHeight = metrics.h;
      prevProductRowCount = metrics.productRows;
    }
    await sleep(1000);

    onProgress(93, 'Extraindo dados das requisições...');

    // Save debug snapshot of report page for diagnostics
    await captureDebugSnapshot(page, 'report-page');

    const tableData = await page.evaluate(() => {
      const norm = (s) =>
        (s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      const clean = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+\n/g, '\n').trim();

      const readCell = (cell) => {
        if (!cell) return '';
        return clean(cell.innerText || cell.textContent || '');
      };

      const rows = [];
      const trList = Array.from(document.querySelectorAll('table.flat-table tbody[ng-repeat="product in item.Items"] tr'));

      for (const row of trList) {
        const productCell = row.querySelector('td[ng-bind-html*="ProductNameAndObservation"]');
        if (!productCell) continue;

        const productName = readCell(productCell);
        if (!productName) continue;

        const productNorm = norm(productName);
        if (
          productNorm === 'total' ||
          productNorm === 'subtotal' ||
          productNorm.startsWith('total ') ||
          productNorm.startsWith('subtotal ')
        ) {
          continue;
        }

        const solicitado = readCell(row.querySelector('td[ng-bind="product.Quantity"]'));
        const atendido = readCell(row.querySelector('td[ng-bind="product.Attended"]'));
        const pendente = readCell(row.querySelector('td[ng-bind="product.Pending"]'));
        const custoTotal = readCell(row.querySelector('td[ng-bind*="product.CostTotal"]'));

        if (!solicitado && !atendido && !pendente && !custoTotal) continue;

        rows.push([productName, solicitado, atendido, pendente, custoTotal]);
      }

      return rows;
    });

    if (tableData.length === 0) {
      throw new Error('EMPTY_REPORT: Nenhum dado encontrado para os filtros selecionados.');
    }

    // ── PASSO 12: Gerar CSV ───────────────────────────────────────────────────
    onProgress(97, 'Gerando arquivo CSV...');
    const headers = ['Produto', 'Solicitado', 'Atendido', 'Pendente', 'Custo Total'];
    const csv = toCSV(headers, tableData);

    onProgress(100, 'Relatório gerado com sucesso!');
    return csv;
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeReport };
