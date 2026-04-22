import asyncio
import argparse
import pandas as pd
from playwright.async_api import async_playwright
import os


def parse_args():
    parser = argparse.ArgumentParser(description="Gera relatórios de requisição interna por departamento.")
    parser.add_argument(
        "--date-range",
        default="01/01/26 - 31/03/26",
        help='Período no formato "DD/MM/AA - DD/MM/AA".',
    )
    parser.add_argument(
        "--start-from",
        default="TODOS",
        help="Departamento inicial para retomada da execução.",
    )
    parser.add_argument(
        "--only-department",
        default="",
        help="Gera somente o departamento informado.",
    )
    return parser.parse_args()


async def wait_for_page_settle(page, selector=None, timeout=30000, settle_ms=4000):
    try:
        await page.wait_for_load_state("networkidle", timeout=timeout)
    except Exception:
        pass

    try:
        await page.locator('.block-ui-overlay').last.wait_for(state="hidden", timeout=timeout)
    except Exception:
        pass

    if selector:
        await page.locator(selector).first.wait_for(state="visible", timeout=timeout)

    await page.wait_for_timeout(settle_ms)


async def select_hotel_with_retry(page, retries=3):
    hotel_locators = [
        '#PAJUÇARA\\ PRAIA\\ HOTEL',
        'button:has-text("PAJUÇARA PRAIA HOTEL")',
        'button:has-text("PAJUCARA PRAIA HOTEL")',
        '[title="PAJUÇARA PRAIA HOTEL"]',
        '[title="PAJUCARA PRAIA HOTEL"]',
        'text=PAJUÇARA PRAIA HOTEL',
        'text=PAJUCARA PRAIA HOTEL',
    ]

    for attempt in range(1, retries + 1):
        await wait_for_page_settle(page, timeout=60000, settle_ms=1500)

        for selector in hotel_locators:
            candidate = page.locator(selector).first
            try:
                await candidate.wait_for(state="visible", timeout=5000)
                await candidate.click()
                return
            except Exception:
                continue

        try:
            if await page.locator('input#Email').first.is_visible():
                print(f"Tela de login ainda visível após tentativa {attempt}. Reenviando login...")
                await page.click('button[type="submit"]')
                await page.wait_for_timeout(3000)
        except Exception:
            pass

    raise RuntimeError("Não foi possível localizar/selecionar o hotel após múltiplas tentativas.")

def classify_product(name):
    """Classifica o produto em categorias baseadas em palavras-chave no nome."""
    name_upper = name.upper()
    
    rules = {
        "Proteínas e Carnes": [
            "BACON", "BOLINHO", "CARNE", "CHARQUE", "COPA SADIA", "COXINHA", "FILÉ", "FILE", 
            "HAMBURGUER", "LINGUIÇA", "LINGUICA", "MORTADELA", "PRESUNTO", "SALAME", "ORELHA", "PÉ SUÍNO", "PE SUINO",
            "OVOS", "OVO", "PERNIL", "PERU", "SALSICHA", "SARDINHA", "TILÁPIA", "TILAPIA"
        ],
        "Laticínios": [
            "BEBIDA LÁCTEA", "BEBIDA LACTEA", "COALHADA", "CREME DE LEITE", "DOCE DE LEITE", 
            "LEITE CONDENSADO", "LEITE EM PÓ", "LEITE EM PO", "LEITE INTEGRAL", "MANTEIGA", 
            "MARGARINA", "QUEIJO"
        ],
        "Bebidas Alcoólicas": [
            "PITÚ", "PITU", "AMSTEL", "BRAHMA", "BUDWEISER", "DEVASSA", "HEINEKEN", "SKOL", 
            "CHAMPAGNE", "RIO SOL", "SALTON", "ESPUMANTE", "MONTILLA", "GIN SEAGERS", "SEAGERS", 
            "VINHO", "TARAPACÁ", "TARAPACA", "MIOLO", "TANTEHUE", "VODKA", "ABSOLUT", "ORLOFF"
        ],
        "Bebidas Não Alcoólicas": [
            "ACHOCOLATADO 200ML", "LEITE ACHOCOLATADO", "ÁGUA", "AGUA", "CAFÉ", "CAFE", "NESPRESSO", 
            "CHÁ", "CHA", "CHOCOLATE QUENTE", "REFRIGERANTE", "COCA-COLA", "COCA COLA", "FANTA", 
            "GUARANÁ", "GUARANA", "SPRITE", "ENERGÉTICO", "ENERGETICO", "DEL VALLE", "GROSELHA"
        ],
        "Grãos e Farinhas": [
            "ARROZ", "AVEIA", "CEREAL", "CORN FLAKES", "GRANOLA", "CUSCUZ", "FARINHA", "FEIJÃO", 
            "FEIJAO", "FLOCOS DE MILHO", "GOMA", "MASSA", "SPAGHETTI", "PENNE", "TALHARIM", 
            "PÃO DE QUEIJO", "PAO DE QUEIJO", "CHIA", "LINHAÇA", "LINHACA"
        ],
        "Hortifruti": [
            "AMEIXA SECA", "AMENDOIM", "BRÓCOLIS", "BROCOLIS", "ERVILHA", "MILHO VERDE", "POLPA", 
            "LEGUME", "TOMATE SECO", "UVA PASSA"
        ],
        "Paes e Padaria": [
            "PÃO DE FORMA", "PAO DE FORMA", "BISCOITO CHAMPANHE", "BARRA DE CEREAL"
        ],
        "Óleos e Temperos": [
            "AZEITE", "CALDO", "CATCHUP", "KETCHUP", "MOSTARDA", "MAIONESE", "EXTRATO DE TOMATE", 
            "GELEIA DE PIMENTA", "GOIABADA", "GORDURA VEGETAL", "ÓLEO", "OLEO", "MEL DE ENGENHO", 
            "MEL KARO", "MOLHO", "SAL", "VINAGRE"
        ],
        "Utensílios e Descartáveis": [
            "BOBINA PLÁSTICA", "BOBINA PLASTICA", "FILME PVC", "EMBALAGEM", "CANUDO", "MEXEDOR", 
            "COPO", "GUARDANAPO", "PALITO", "SACO DE PAPEL", "POTE DESCARTÁVEL", "POTE DESCARTAVEL", 
            "TALHER", "XÍCARA", "XICARA", "PIRES", "PRATO SOBREMESA"
        ],
        "Limpeza": [
            "ÁLCOOL", "ALCOOL", "AMACIANTE DE CARNE", "CLORO", "ALGICIDA", "SULFATO ALUMÍNIO", 
            "SULFATO ALUMINIO", "CLARIFICANTE", "DETERGENTE", "DESENGORDURANTE", "ESCOVA", 
            "ESPONJA", "FIBRA DE LIMPEZA", "FLANELA", "PANO", "INSETICIDA", "LIMPA VIDRO", 
            "LUSTRA MÓVEIS", "LUSTRA MOVEIS", "SABÃO", "SABAO", "SACO DE LIXO", "VASSOURA", "RODO"
        ],
        "Manutenção e Obras": [
            "ABRAÇADEIRA", "ABRACADEIRA", "COLA", "PVC", "BATERIA", "PILHA", "CABO FLEXÍVEL", 
            "CABO FLEXIVEL", "FITA ISOLANTE", "LÂMPADA LED", "LAMPADA LED", "DISJUNTORES", 
            "AR-CONDICIONADO", "FITA CREPE", "FITA TRANSPARENTE", "JOELHO", "TUBO", "CONEXÃO", 
            "CONEXAO", "LIXA", "TINTA", "PINCEL", "ROLO", "WHITE LUB", "VASELINA", "CAIXA ACOPLADA"
        ],
        "Escritório": [
            "ARQUIVO MORTO", "COMANDA", "BLOCOS DE NOTAS", "CANETA", "LÁPIS", "LAPIS", "CLIPS", 
            "GRAMPO", "CALCULADORA", "MOUSE USB", "PAPEL A4", "PAPEL VERGÊ", "PAPEL VERGE", 
            "ETIQUETA", "PRANCHETA"
        ],
        "Amenities": [
            "BOLA DE SOPRO", "SABONETE 20G", "SHAMPOO", "TOUCA", "VELA AROMATIZADA", "VELA DE ANIVERSÁRIO", 
            "VELA DE ANIVERSARIO"
        ],
        "Doces e Diversos": [
            "BOMBOM", "CHOCOLATE", "FINNI", "GELATINA", "GRANULADO", "CACAU", "FERMENTO"
        ]
    }
    
    # Ordem de prioridade para evitar conflitos (ex: Leite em Pó vs Leite Achocolatado)
    priority_order = [
        "Limpeza", "Óleos e Temperos", "Manutenção e Obras", "Bebidas Alcoólicas", 
        "Bebidas Não Alcoólicas", "Laticínios", "Proteínas e Carnes", "Grãos e Farinhas",
        "Hortifruti", "Paes e Padaria", "Utensílios e Descartáveis", "Escritório",
        "Amenities", "Doces e Diversos"
    ]
    
    for category in priority_order:
        keywords = rules[category]
        if any(kw in name_upper for kw in keywords):
            return category
            
    return "OUTROS"

async def main():
    args = parse_args()

    # Definir diretório de saída
    output_dir = r"C:\Users\PP-CONTROLE03\Downloads\ESTOQUE PRODUTOS HITS"
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"Diretório criado: {output_dir}")

    async with async_playwright() as p:
        # Lançar o navegador
        browser = await p.chromium.launch(headless=False)  # headless=False para você ver a execução
        context = await browser.new_context()
        page = await context.new_page()
        page.set_default_timeout(60000)
        page.set_default_navigation_timeout(120000)

        print("Acessando a página de login...")
        await page.goto("https://pajucarahoteis.hitspms.net/#/login", wait_until="domcontentloaded")

        # 1° Login
        print("Preenchendo credenciais...")
        # Usando os seletores específicos fornecidos
        await page.wait_for_selector('input#Email')
        await page.fill('input#Email', "custos@pajucarahotel.com.br")
        await page.wait_for_selector('input#Password')
        await page.fill('input#Password', "Kg632841@")

        # 2° Clicar no botão de login
        print("Clicando no botão de login...")
        await page.click('button[type="submit"]')

        # 3° Escolha do hotel
        print("Selecionando o hotel...")
        await select_hotel_with_retry(page)

        # Aguarda o dashboard ficar utilizável sem falhar se a página mantiver conexões abertas.
        await wait_for_page_settle(page, 'a.nav-link.main-menu[title="Operações"]:visible')

        # 4° Acessar a barra de navegação (Operações)
        # O seletor provido foi <a href="#navOptions" class="nav-link main-menu" ...>
        print("Abrindo menu de operações...")
        # O log mostrou que existem 3 elementos, vamos focar no que estiver visível
        menu_btn = page.locator('a.nav-link.main-menu[title="Operações"]:visible').first
        await menu_btn.wait_for(state="visible", timeout=15000)
        await menu_btn.click()

        # 5° Acessar o estoque
        print("Acessando Estoque...")
        await page.wait_for_selector('#menustock')
        await page.click('#menustock')

        # Acessar requisição interna
        print("Acessando Requisição Interna...")
        # Buscando pelo texto dentro do span
        await page.click('span:has-text("Requisição interna")')

        # Acessar as requisições (Ícone de impressão)
        print("Abrindo relatório de requisições...")
        await page.wait_for_selector('button[one-tltranslate="lblPurchaseRequisition"]')
        await page.click('button[one-tltranslate="lblPurchaseRequisition"]')

        # Selecionar o período
        print("Configurando período...")
        await page.wait_for_selector('button.button-filter:has-text("Período")', timeout=15000)
        await page.click('button.button-filter:has-text("Período")')

        # Preencher as datas
        await page.wait_for_selector('input.date-picker')
        
        print("Preenchendo datas...")
        # Limpar o campo de forma mais agressiva
        date_input = page.locator('input.date-picker')
        await date_input.click()
        await page.keyboard.press("Control+A")
        await page.keyboard.press("Backspace")
        
        date_to_fill = args.date_range
        print(f"Tentando preencher com: {date_to_fill}")
        
        await date_input.type(date_to_fill, delay=50)
        await page.keyboard.press("Enter")
        
        # Pequena espera para verificar se o campo aceitou
        await page.wait_for_timeout(1000)

        # Clicar em buscar/aplicar o período
        print("Aplicando filtro de data...")
        await page.click('button.btn-blue:has(em:has-text("check")):visible')
        
        # Espera o processamento dos dados filtrados
        await wait_for_page_settle(page)

        # 6° Loop por todos os departamentos solicitados
        departments = [
            "TODOS", "ESPAÇOS COMUNS", "RECEPÇÃO", "FRIGOBAR", "RESTAURANTE", "ROOM SERVICE",
            "BAR DA COBERTURA", "LAVANDERIA", "GOVERNANÇA", "COMERCIAL", "FINANCEIRO",
            "DIRETORIA", "CONTROLE", "RH", "MANUTENÇÃO", "ROUPARIA", "CAFÉ DA MANHÃ",
            "PAJUÇARA EXPRESS", "ALMOXARIFADO DA MANUTENÇÃO", "COZINHA", "ADMINISTRATIVO",
            "OBRAS E REFORMAS", "REFEITÓRIO", "EVENTOS"
        ]

        only_department_upper = args.only_department.upper().strip()
        if only_department_upper:
            exact_department = next(
                (name for name in departments if name.upper() == only_department_upper),
                None,
            )
            if exact_department is None:
                raise ValueError(f"Departamento '{args.only_department}' não encontrado.")
            departments = [exact_department]
            print(f"Executando somente o departamento: {exact_department}")
        else:
            start_from_upper = args.start_from.upper().strip()
            if start_from_upper != "TODOS":
                start_idx = next(
                    (idx for idx, name in enumerate(departments) if name.upper() == start_from_upper),
                    None,
                )
                if start_idx is None:
                    print(f"Departamento inicial '{args.start_from}' não encontrado. Iniciando por TODOS.")
                else:
                    departments = departments[start_idx:]
                    print(f"Retomando execução a partir de: {departments[0]}")

        for dept in departments:
            print(f"\n--- Processando Departamento: {dept} ---")
            await wait_for_page_settle(page, timeout=120000, settle_ms=1000)
            
            # Clicar no botão de Departamento para abrir a lista
            dept_btn = page.locator('one-translate[resource="lblDepartment"], button:has-text("Departamento")').first
            await dept_btn.wait_for(state="visible", timeout=20000)
            await dept_btn.click()
            
            # Desmarcar qualquer departamento que já esteja selecionado para garantir filtro único (se não for "TODOS")
            if dept != "TODOS":
                clear_attempts = 0
                while clear_attempts < 20:
                    active_depts = page.locator('button.active:has(one-translate[resource="lblAll"]), button.btn-check.active')
                    count = await active_depts.count()
                    if count == 0:
                        break
                    await active_depts.first.click()
                    await page.wait_for_timeout(250)
                    clear_attempts += 1

            # Selecionar o departamento da vez
            print(f"Selecionando {dept}...")
            if dept == "TODOS":
                # Seletor específico para o botão "Todos"
                target_option = page.locator('button:has(one-translate[resource="lblAll"])').first
            else:
                # Busca flexível por título ou texto para os outros departamentos
                target_option = page.locator(f'button.btn-check[title="{dept}"], button.btn-check:has-text("{dept}"), button.btn-check:has(one-translate:has-text("{dept}"))').first
            
            try:
                await target_option.wait_for(state="visible", timeout=10000)
                await target_option.click()
            except Exception:
                print(f"Aviso: Não foi possível encontrar a opção '{dept}'. Pulando...")
                await page.keyboard.press("Escape")
                continue
            
            # Aplicar o filtro (clicar no botão Check/Buscar)
            search_btn = page.locator('button.btn-blue:has(em:has-text("check")):visible').first
            await search_btn.click()

            # Esperar a tabela carregar dados
            print(f"Aguardando dados de {dept}...")
            await wait_for_page_settle(page)

            # Extração dos dados em lote para evitar milhares de round-trips do Playwright.
            data = await page.locator('tr').evaluate_all(
                """
                rows => rows.map(row => {
                    const productCell = row.querySelector('td[ng-bind-html*="ProductNameAndObservation"]');
                    if (!productCell) {
                        return null;
                    }

                    const productName = productCell.innerText.trim();
                    if (!productName || productName.toUpperCase().includes('TOTAL')) {
                        return null;
                    }

                    const costCell = row.querySelector('td[ng-bind*="CostTotal"]');
                    const costValue = costCell ? costCell.innerText.trim() : '0';
                    if (costValue === '0' || costValue === '$0,00') {
                        return null;
                    }

                    const departmentCell = row.querySelector('td[ng-bind="product.DestinationWarehouseName"]');
                    const departmentValue = departmentCell ? departmentCell.innerText.trim() : '';

                    let attendedValue = '0';
                    const texts = Array.from(row.querySelectorAll('td'), cell => cell.innerText.trim());
                    for (const text of texts) {
                        const normalized = text.replace(',', '.');
                        if (text && text !== costValue && !Number.isNaN(Number(normalized))) {
                            attendedValue = text;
                            break;
                        }
                    }

                    return {
                        Produto: productName,
                        Departamento: departmentValue,
                        Atendido: attendedValue,
                        'Custo Total': costValue.replace('$', '').trim()
                    };
                }).filter(Boolean)
                """
            )

            # Salvar CSV individual
            if data:
                df = pd.DataFrame(data)
                # Garantir ordem das colunas
                df = df[["Produto", "Departamento", "Atendido", "Custo Total"]]
                
                # Formata o nome do arquivo (remove espaços e acentos simples para o nome do arquivo)
                file_name = dept.lower().replace(" ", "_").replace("ç", "c").replace("ã", "a").replace("é", "e").replace("ó", "o").replace("í", "i")
                output_file = os.path.join(output_dir, f"relatorio_{file_name}.csv")
                df.to_csv(output_file, index=False, encoding='utf-8-sig', sep=';')
                print(f"Sucesso! {len(data)} produtos salvos em '{output_file}'.")
            else:
                print(f"Nenhum dado encontrado para {dept}.")

        # Fechar o navegador ao final de tudo
        print("\nProcessamento de todos os departamentos concluído!")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
