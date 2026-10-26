import { runAutoSearch, getStoredStatus, requestCancel, isSearchActive } from './auto-search.js';
import { getLogs, formatLogsForExport, initGlobalErrorHandlers } from '../shared/logger.js';
import { isYouTubeWatch, extractYouTubeContent } from '../extractors/yt-extractor.js';
import { createMCPBridge, observeMCPPreference } from './mcp-bridge.mjs';

import { createMCPCommands } from './mcp-commands.mjs';

const processMCPCommand = createMCPCommands({
  browser: chrome,
  search: { run: runAutoSearch, status: getStoredStatus, cancel: requestCancel, isActive: isSearchActive },
  extractTabs: processTabsConcurrently,
  extractYouTube: extractYouTubeContent
});
const mcpBridge = createMCPBridge({
  onCommand: processMCPCommand,
  onStatus: status => chrome.storage.local.set({ mcpBridgeStatus: status }).catch(() => {})
});
observeMCPPreference(chrome.storage, mcpBridge);

// Install global error interceptors to catch unhandled promise rejections
// and uncaught exceptions across the entire Service Worker scope.
initGlobalErrorHandlers();

const CONCURRENCY_LIMIT = 5;
const MAX_RETRIES = 3;

// ─── Guard: reset stale 'running' state on browser/extension restart ───
function resetStaleSearchStatus() {
  chrome.storage.local.get('autoSearch', (data) => {
    if (data.autoSearch && data.autoSearch.status === 'running') {
      chrome.storage.local.set({ autoSearch: { status: 'cancelled' } });
      console.log('[TabScribe] Reset stale running status on startup.');
    }
  });
}
chrome.runtime.onStartup.addListener(() => {
  resetStaleSearchStatus();
  setupYoutubeDNRRules();
});
chrome.runtime.onInstalled.addListener(() => {
  resetStaleSearchStatus();
  setupYoutubeDNRRules();
});

/**
 * Configures dynamic rules for declarativeNetRequest to bypass YouTube CORS.
 * Uses a 'magic' query parameter xtabs=1 to target only extension requests.
 */
async function setupYoutubeDNRRules() {
  try {
    const rules = [
      {
        id: 1,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'origin', operation: 'remove' },
            { header: 'referer', operation: 'set', value: 'https://www.youtube.com/' }
          ]
        },
        condition: {
          urlFilter: '*xtabs=1*',
          resourceTypes: ['xmlhttprequest']
        }
      }
    ];

    // Clear existing dynamic rules and add the new one
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: rules
    });
    console.log('[TabScribe] YouTube DNR rules configured.');
  } catch (err) {
    console.error('[TabScribe] Failed to setup DNR rules:', err);
  }
}

/**
 * Função injetada na aba para extrair o texto inteiro da página.
 */
async function extractFullTextInPage() {
  const expandButtons = Array.from(document.querySelectorAll('button, a, span, div')).filter(el => {
    const text = el.innerText ? el.innerText.trim().toLowerCase() : '';
    return ['ler mais', 'leia mais', 'read more', 'ver mais', 'mostrar mais', 'continuar lendo', 'veja mais'].includes(text);
  });
  let clicked = false;
  for (const btn of expandButtons) {
    if (btn.offsetParent !== null) {
      try { btn.click(); clicked = true; } catch (e) { }
    }
  }
  if (clicked) await new Promise(r => setTimeout(r, 150));

  const text = document.body ? document.body.innerText.trim() : "";
  return text;
}

/**
 * Função injetada na aba para extrair o conteúdo principal usando o extrator inteligente.
 */
async function extractMainContentInPage() {
  const expandButtons = Array.from(document.querySelectorAll('button, a, span, div')).filter(el => {
    const text = el.innerText ? el.innerText.trim().toLowerCase() : '';
    return ['ler mais', 'leia mais', 'read more', 'ver mais', 'mostrar mais', 'continuar lendo', 'veja mais'].includes(text);
  });
  let clicked = false;
  for (const btn of expandButtons) {
    if (btn.offsetParent !== null) {
      try { btn.click(); clicked = true; } catch (e) { }
    }
  }
  if (clicked) await new Promise(r => setTimeout(r, 150));

  // O código do ContentExtractor será injetado automaticamente antes desta função
  try {
    const extractor = new ContentExtractor();
    const content = extractor.extract(document);
    return content;
  } catch (error) {
    console.error("Erro na extração inteligente:", error);
    // Fallback para texto completo
    return document.body ? document.body.innerText.trim() : "";
  }
}

/**
 * Tenta capturar uma miniatura da aba
 */
async function captureTabThumbnail(tabId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 30 });
    return dataUrl;
  } catch (error) {
    console.error(`Erro ao capturar miniatura da aba ${tabId}:`, error);
    return null;
  }
}

/**
 * Processa favicons e tenta garantir URLs válidas
 */
function processTabFavIcon(tab) {
  // Se não tiver favicon ou for inválido, tenta usar uma favicon alternativa
  if (!tab.favIconUrl || tab.favIconUrl === '' ||
    !(tab.favIconUrl.startsWith('http') ||
      tab.favIconUrl.startsWith('data:') ||
      tab.favIconUrl.startsWith('chrome:'))) {

    // Tenta usar a favicon do domínio
    if (tab.url) {
      try {
        const url = new URL(tab.url);
        return `${url.protocol}//${url.hostname}/favicon.ico`;
      } catch (e) {
        // URL inválida, usa o ícone padrão
        return '';
      }
    }
    return '';
  }

  return tab.favIconUrl;
}

/**
 * Aguarda o carregamento de conteúdo dinâmico em SPAs
 * @param {number} tabId - ID da aba
 * @returns {Promise<boolean>} True se o conteúdo está estável
 */
async function waitForDynamicContent(tabId) {
  const MAX_ATTEMPTS = 5;
  const DELAY = 1000; // 1 segundo entre tentativas

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      // Verifica se há mudanças no DOM
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Verifica se há elementos carregando
          const loadingElements = document.querySelectorAll('.loading, .spinner, [aria-busy="true"]');
          if (loadingElements.length > 0) return false;

          // Verifica se há requisições em andamento
          const performanceEntries = performance.getEntriesByType('resource');
          const activeRequests = performanceEntries.filter(entry =>
            entry.initiatorType === 'xmlhttprequest' ||
            entry.initiatorType === 'fetch'
          );

          return activeRequests.length === 0;
        }
      });

      if (result[0].result) {
        return true;
      }

      // Aguarda antes da próxima tentativa
      await new Promise(resolve => setTimeout(resolve, DELAY));
    } catch (error) {
      console.error(`Erro ao verificar conteúdo dinâmico (tentativa ${attempt + 1}):`, error);
    }
  }

  return false;
}

/**
 * Extrai texto de uma aba com suporte a SPAs e opções avançadas
 * @param {Object} tab - A aba a ser processada
 * @param {boolean} useIntelligentExtraction - Se deve usar extração inteligente
 * @param {Object} options - Opções adicionais de extração
 */
async function extractTextFromTab(tab, useIntelligentExtraction = false, options = {}) {

  // 🚀 INTERCEPTADOR YOUTUBE FAT V5
  if (isYouTubeWatch(tab.url)) {
    try {
      const separator = tab.url.includes('?') ? '&' : '?';
      const proxyUrl = tab.url + separator + 'xtabs=1';
      const ytContent = await extractYouTubeContent(proxyUrl);
      if (ytContent && typeof ytContent === 'string' && !ytContent.includes('[Audit: FAILED')) {
        return {
          id: tab.id,
          title: tab.title || "(Sem Título)",
          url: tab.url,
          content: ytContent,
          extractionMode: "youtube_v5"
        };
      } else {
        return {
          id: tab.id,
          title: tab.title || "(Sem Título)",
          url: tab.url,
          content: ytContent || "",
          extractionMode: "youtube_v5_fail"
        };
      }
    } catch (error) {
      console.error(`Erro ao extrair YouTube na aba ${tab.id}:`, error);
      return {
        id: tab.id,
        title: tab.title || "(Sem Título)",
        url: tab.url,
        content: "",
        extractionMode: "youtube_error"
      };
    }
  }

  let attempt = 0;

  // Primeiro precisamos injetar o ContentExtractor se for usar extração inteligente
  if (useIntelligentExtraction) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/content/content-extractor.js']
      });
    } catch (err) {
      console.error(`Erro ao injetar ContentExtractor na aba ${tab.id}:`, err);
      // Fallback para extração normal se falhar
      useIntelligentExtraction = false;
    }
  }

  // Aguarda conteúdo dinâmico se necessário
  if (options.waitForDynamicContent) {
    const isStable = await waitForDynamicContent(tab.id);
    if (!isStable) {
      console.warn(`Conteúdo dinâmico não estabilizou na aba ${tab.id}`);
    }
  }

  // Função a ser usada para extração
  const extractionFunction = useIntelligentExtraction
    ? extractMainContentInPage
    : extractFullTextInPage;

  while (attempt < MAX_RETRIES) {
    try {
      const responses = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractionFunction,
        args: [options]
      });

      if (Array.isArray(responses) && responses.length > 0) {
        const result = responses[0].result;

        // Verifica se o resultado é um objeto (extração inteligente) ou string (extração normal)
        if (typeof result === 'object') {
          return {
            id: tab.id,
            title: tab.title || "(Sem Título)",
            url: tab.url,
            ...result,
            extractionMode: "inteligente"
          };
        } else if (typeof result === "string") {
          return {
            id: tab.id,
            title: tab.title || "(Sem Título)",
            url: tab.url,
            content: result,
            extractionMode: "completo"
          };
        }
      }

      console.warn(`Resposta inesperada na aba ${tab.id}. Tentativa ${attempt + 1}.`);
    } catch (err) {
      console.error(`Erro ao injetar script na aba ${tab.id} (tentativa ${attempt + 1}):`, err);
    }
    attempt++;
  }

  // Se todas as tentativas falharem
  return {
    id: tab.id,
    title: tab.title || "(Sem Título)",
    url: tab.url,
    content: "",
    extractionMode: "falha"
  };
}

/**
 * Processa as abas selecionadas em lotes com opções avançadas
 * Exported for use by auto-search.js (same service worker context).
 */
export async function processTabsConcurrently(tabsArray, useIntelligentExtraction = false, options = {}) {
  const results = [];

  async function processTab(tab) {
    const extracted = await extractTextFromTab(tab, useIntelligentExtraction, options);
    results.push(extracted);
  }

  for (let i = 0; i < tabsArray.length; i += CONCURRENCY_LIMIT) {
    const batch = tabsArray.slice(i, i + CONCURRENCY_LIMIT).map(tab => processTab(tab));
    await Promise.all(batch);
  }

  return results;
}

/**
 * Listener para as requisições vindas do popup.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getTabs") {
    (async () => {
      try {
        // Pega a janela que estava focada antes do popup
        const currentWindow = await chrome.windows.getLastFocused({ populate: true });
        let tabs = currentWindow.tabs || [];
        // Filtra somente abas http/https e exclui páginas de extensão
        const validTabs = tabs.filter(tab => /^https?:\/\//.test(tab.url) && !/^chrome-extension:\/\//.test(tab.url));

        // Adiciona informações visuais às abas
        const enhancedTabs = validTabs.map(tab => {
          return {
            id: tab.id,
            title: tab.title,
            url: tab.url,
            favIconUrl: processTabFavIcon(tab)
          };
        });

        sendResponse({ success: true, data: enhancedTabs });
      } catch (error) {
        console.error("Erro ao obter abas:", error);
        sendResponse({ success: false, message: "Não foi possível obter as abas." });
      }
    })();
    return true;
  }

  if (message.action === "extractSelectedTabs") {
    (async () => {
      try {
        const selectedTabIds = message.tabIds;
        const useIntelligentExtraction = message.useIntelligentExtraction || false;
        const options = message.options || {};

        // Obtém as abas completas pelos IDs
        const tabs = await Promise.all(selectedTabIds.map(id => chrome.tabs.get(id)));

        // Processa as abas selecionadas com as opções
        const results = await processTabsConcurrently(tabs, useIntelligentExtraction, options);

        sendResponse({
          success: true,
          data: results,
          extractionMode: useIntelligentExtraction ? "inteligente" : "completo"
        });
      } catch (error) {
        console.error("Erro durante a extração:", error);
        sendResponse({ success: false, message: "Erro durante a extração das abas selecionadas." });
      }
    })();
    return true;
  }

  if (message.action === "autoSearch") {
    if (isSearchActive()) {
      sendResponse({ success: false, message: 'A search is already active.' });
      return false;
    }
    runAutoSearch(message.queries, message.config, processTabsConcurrently).catch(err => console.error("AutoSearch failed:", err));
    sendResponse({ success: true, message: "Search started." });
    return false;
  }

  if (message.action === "cancelAutoSearch") {
    requestCancel();
    // Also force-reset storage status (in case the loop is hung)
    chrome.storage.local.set({ autoSearch: { status: 'cancelled' } });
    sendResponse({ success: true, message: "Cancel requested." });
    return false;
  }

  if (message.action === "getAutoSearchStatus") {
    getStoredStatus().then(status => sendResponse(status));
    return true;
  }

  if (message.action === "getLogs") {
    getLogs().then(logs => sendResponse(logs));
    return true;
  }

  if (message.action === "getFormattedLogs") {
    formatLogsForExport().then(text => sendResponse(text));
    return true;
  }
});
