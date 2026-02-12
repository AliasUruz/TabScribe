let extractedData = null;
let useIntelligentExtraction = true; // Iniciando com modo inteligente como padrão

// Renderiza a lista de abas com checkboxes e miniaturas
function renderTabsList(tabs, activeTabId) {
  const tabsListDiv = document.getElementById("tabsList");
  tabsListDiv.innerHTML = "";
  if (!tabs || tabs.length === 0) {
    tabsListDiv.textContent = "Nenhuma aba válida encontrada.";
    return;
  }

  tabs.forEach(tab => {
    try {
      const div = document.createElement("div");
      div.className = "tab-item";
      div.dataset.url = tab.url.toLowerCase();
      
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = tab.id;
      checkbox.id = `tab-${tab.id}`;

      if (tab.id === activeTabId) {
        checkbox.checked = true;
      }
      
      // Adiciona a miniatura da aba
      const thumbnail = document.createElement("img");
      thumbnail.className = "tab-thumbnail";
      
      // Função para usar imagem padrão em caso de erro
      const useDefaultIcon = () => {
        try {
          // Tenta usar favicon do site se disponível
          if (tab.favIconUrl && 
             (tab.favIconUrl.startsWith("http") || 
              tab.favIconUrl.startsWith("data:") || 
              tab.favIconUrl.startsWith("chrome:"))) {
            thumbnail.src = tab.favIconUrl;
          } else {
            // Usa o ícone da extensão se não houver favicon
            thumbnail.src = "icons/icon48.png";
          }
        } catch (err) {
          thumbnail.src = "icons/icon48.png";
          console.error("Erro ao definir ícone:", err);
        }
      };
      
      // Tenta usar a favicon caso exista
      useDefaultIcon();
      
      // Em caso de erro ao carregar a imagem, usar ícone padrão
      thumbnail.onerror = useDefaultIcon;
      
      // Container para as informações da aba
      const infoDiv = document.createElement("div");
      infoDiv.className = "tab-info";
      
      const titleSpan = document.createElement("span");
      titleSpan.className = "tab-title";
      titleSpan.textContent = tab.title || "Sem título";
      
      infoDiv.appendChild(titleSpan);
      
      div.appendChild(checkbox);
      div.appendChild(thumbnail);
      div.appendChild(infoDiv);
      tabsListDiv.appendChild(div);
    } catch (error) {
      console.error("Erro ao renderizar aba:", error);
    }
  });
}

/**
 * Extrai o texto das abas selecionadas e retorna uma Promise com os resultados.
 */
function extractSelectedTabs() {
  return new Promise((resolve, reject) => {
    const statusDiv = document.getElementById("status");
    
    try {
      // Identifica quais abas foram selecionadas
      const selectedCheckboxes = document.querySelectorAll("#tabsList input[type='checkbox']:checked");
      const tabIds = Array.from(selectedCheckboxes).map(cb => parseInt(cb.value));
      
      if (tabIds.length === 0) {
        statusDiv.textContent = "Nenhuma aba selecionada.";
        reject("Nenhuma aba selecionada.");
        return;
      }
      
      const extractionMode = useIntelligentExtraction ? "inteligente" : "completo";
      statusDiv.textContent = `Extraindo texto das abas selecionadas (modo ${extractionMode})...`;
      
      // Envia mensagem ao background para processar as abas
      chrome.runtime.sendMessage({ 
        action: "extractSelectedTabs", 
        tabIds,
        useIntelligentExtraction 
      }, (response) => {
        if (response && response.success) {
          statusDiv.textContent = `Extração concluída (modo ${extractionMode}).`;
          resolve(response.data);
        } else {
          statusDiv.textContent = response ? response.message : "Erro durante a extração.";
          reject(response ? response.message : "Erro durante a extração.");
        }
      });
    } catch (error) {
      statusDiv.textContent = "Erro ao processar abas.";
      console.error("Erro ao processar abas:", error);
      reject(error);
    }
  });
}

/**
 * Atualiza a UI baseada no modo de extração selecionado
 */
function updateExtractionModeUI(showNotification = false) {
  const modeToggle = document.getElementById("extractionModeToggle");
  
  modeToggle.checked = useIntelligentExtraction;
  
  // Mostra informação no status apenas se solicitado
  if (showNotification) {
    const statusDiv = document.getElementById("status");
    const modeName = useIntelligentExtraction ? "inteligente" : "completo";
    const modeDesc = useIntelligentExtraction 
      ? "Extrai apenas o conteúdo principal" 
      : "Extrai todo o texto da página";
    
    statusDiv.textContent = `Modo ${modeName}: ${modeDesc}`;
    
    // Remove a notificação após 3 segundos
    setTimeout(() => {
      if (statusDiv.textContent.includes(`Modo ${modeName}`)) {
        statusDiv.textContent = "";
      }
    }, 3000);
  }
}

/**
 * Alterna entre os modos de extração
 */
function toggleExtractionMode(event) {
  useIntelligentExtraction = event.target.checked;
  updateExtractionModeUI(true); // Mostra notificação ao mudar manualmente
  
  // Salva a preferência do usuário
  chrome.storage.local.set({ useIntelligentExtraction });
}

/**
 * Formata uma data no formato extenso
 * @param {Date} data - Objeto Date para formatação
 * @returns {string} Data formatada no padrão "Dia 25 de Julho de 2023 às 14:30"
 */
function formatarDataExtenso(data) {
  if (!data) return "Não foi possível extrair a data de publicação";
  
  try {
    const meses = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    
    const dia = data.getDate();
    const mes = meses[data.getMonth()];
    const ano = data.getFullYear();
    const horas = data.getHours().toString().padStart(2, '0');
    const minutos = data.getMinutes().toString().padStart(2, '0');
    
    return `Dia ${dia} de ${mes} de ${ano} às ${horas}:${minutos}`;
  } catch (error) {
    console.error("Erro ao formatar data:", error);
    return "Data em formato desconhecido";
  }
}

/**
 * Evento de clique em "Copiar Texto para a Área de Transferência"
 */
document.getElementById("copyButton").addEventListener("click", async () => {
  try {
    const data = await extractSelectedTabs();
    const asMarkdown = document.getElementById('markdownToggle').checked;
    extractedData = data;

    const combinedText = data
      .filter(item => item.content && item.content.trim().length > 0)
      .map(item => {
        if (asMarkdown) {
          let text = `# ${item.title}\n\n**URL:** [${item.url}](${item.url})`;
          if (item.language) text += `\n*Idioma: ${item.language}*`;
          if (item.contentType) text += `\n*Tipo: ${item.contentType}*`;
          if (item.publicationDate) {
            const dataPublicacao = new Date(item.publicationDate);
            text += `\n*Data de Publicação: ${formatarDataExtenso(dataPublicacao)}*`;
          }
          text += `\n\n---\n\n${item.content}`;
          return text;
        } else {
          let text = `TÍTULO: ${item.title}\nURL: ${item.url}`;
          if (item.language) text += `\nIDIOMA: ${item.language}`;
          if (item.contentType) text += `\nTIPO: ${item.contentType}`;
          if (item.publicationDate) {
            const dataPublicacao = new Date(item.publicationDate);
            text += `\nDATA DE PUBLICAÇÃO: ${formatarDataExtenso(dataPublicacao)}`;
          } else {
            text += `\nDATA DE PUBLICAÇÃO: Não foi possível extrair a data de publicação`;
          }
          text += `\n\n${item.content}`;
          return text;
        }
      })
      .join(asMarkdown ? "\n\n\n" : "\n\n==========\n\n");

    if (!combinedText) {
      document.getElementById("status").textContent = "Nenhum conteúdo textual para copiar.";
      return;
    }

    await navigator.clipboard.writeText(combinedText);
    document.getElementById("status").textContent = "Texto copiado com sucesso!";
  } catch (error) {
    document.getElementById("status").textContent = "Erro ao copiar texto.";
    console.error("Erro ao copiar texto:", error);
  }
});

/**
 * Evento de clique em "Baixar Arquivo .txt com os Textos"
 */
document.getElementById("downloadButton").addEventListener("click", async () => {
  try {
    const data = await extractSelectedTabs();
    const asMarkdown = document.getElementById('markdownToggle').checked;
    extractedData = data;

    const fileContent = data
      .filter(item => item.content && item.content.trim().length > 0)
      .map(item => {
        if (asMarkdown) {
          let text = `# ${item.title}\n\n**URL:** [${item.url}](${item.url})`;
          if (item.language) text += `\n*Idioma: ${item.language}*`;
          if (item.contentType) text += `\n*Tipo: ${item.contentType}*`;
          if (item.publicationDate) {
            const dataPublicacao = new Date(item.publicationDate);
            text += `\n*Data de Publicação: ${formatarDataExtenso(dataPublicacao)}*`;
          }
          text += `\n\n---\n\n${item.content}`;
          return text;
        } else {
          let text = `TÍTULO: ${item.title}\nURL: ${item.url}`;
          if (item.language) text += `\nIDIOMA: ${item.language}`;
          if (item.contentType) text += `\nTIPO: ${item.contentType}`;
          if (item.publicationDate) {
            const dataPublicacao = new Date(item.publicationDate);
            text += `\nDATA DE PUBLICAÇÃO: ${formatarDataExtenso(dataPublicacao)}`;
          } else {
            text += `\nDATA DE PUBLICAÇÃO: Não foi possível extrair a data de publicação`;
          }
          text += `\n\n${item.content}`;
          return text;
        }
      })
      .join(asMarkdown ? "\n\n\n" : "\n\n==========\n\n");

    if (!fileContent) {
      document.getElementById("status").textContent = "Nenhum conteúdo textual para baixar.";
      return;
    }

    const blob = new Blob([fileContent], { type: asMarkdown ? "text/markdown" : "text/plain" });
    const urlBlob = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = urlBlob;
    a.download = asMarkdown ? "tabs_content.md" : "tabs_content.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(urlBlob);

    document.getElementById("status").textContent = `Arquivo .${asMarkdown ? 'md' : 'txt'} baixado com sucesso!`;
  } catch (error) {
    document.getElementById("status").textContent = "Erro ao baixar arquivo.";
    console.error("Erro ao baixar arquivo:", error);
  }
});

/**
 * Função para alternar a seleção de todas as abas via checkbox
 */
function toggleSelectAllTabs(event) {
  try {
    const isChecked = event.target.checked;
    document.querySelectorAll("#tabsList input[type='checkbox']").forEach(cb => {
      cb.checked = isChecked;
    });
    document.getElementById("status").textContent = isChecked
      ? "Todas as abas foram selecionadas."
      : "Todas as abas foram desmarcadas.";
  } catch (error) {
    console.error("Erro ao selecionar abas:", error);
  }
}

/**
 * Inicialização após o carregamento do DOM
 */
/**
 * Filtra a lista de abas com base no termo de pesquisa.
 */
function filterTabs() {
  const searchTerm = document.getElementById('searchTabsInput').value.toLowerCase();
  const tabItems = document.querySelectorAll('#tabsList .tab-item');

  tabItems.forEach(item => {
    const title = item.querySelector('.tab-title').textContent.toLowerCase();
    const url = item.dataset.url;

    if (title.includes(searchTerm) || url.includes(searchTerm)) {
      item.style.display = '';
    } else {
      item.style.display = 'none';
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const statusDiv = document.getElementById("status");
  statusDiv.textContent = "Carregando abas...";

  const selectAllCheckbox = document.getElementById("selectAllCheckbox");
  selectAllCheckbox.addEventListener("change", toggleSelectAllTabs);

  const extractionModeToggle = document.getElementById("extractionModeToggle");
  extractionModeToggle.addEventListener("change", toggleExtractionMode);

  // Adiciona o listener para o campo de busca
  document.getElementById('searchTabsInput').addEventListener('input', filterTabs);

  // 1. Pega a aba ativa primeiro
  chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
    const activeTabId = activeTabs.length > 0 ? activeTabs[0].id : null;

    // 2. Carrega as configurações do usuário
    chrome.storage.local.get(['useIntelligentExtraction'], (result) => {
      if (result.useIntelligentExtraction !== undefined) {
        useIntelligentExtraction = result.useIntelligentExtraction;
      }
      updateExtractionModeUI(false);

      // 3. Pede todas as abas e renderiza a lista
      chrome.runtime.sendMessage({ action: "getTabs" }, (response) => {
        if (response && response.success) {
          renderTabsList(response.data, activeTabId);
          statusDiv.textContent = "";
        } else {
          statusDiv.textContent = response ? response.message : "Erro ao obter abas.";
        }
      });
    });
  });
});
