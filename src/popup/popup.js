import { compileTabsXml } from '../shared/xml-export.mjs';
let extractedData = null;
let useIntelligentExtraction = true; // Default: smart extraction mode

// ─── @TABSCRIBE Protocol Parser (Blind Spot Detector) ───
function parseTabScribeInstructions(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (!lines[0] || !lines[0].trim().toUpperCase().startsWith('@TABSCRIBE')) return null;

  const header = lines[0];
  const engineMatch = header.match(/engine=(\w+)/i);
  const linksMatch = header.match(/links=(\d+)/i);

  return {
    engine: engineMatch ? engineMatch[1].toLowerCase() : null,
    links: linksMatch ? parseInt(linksMatch[1]) : null,
    queries: lines.slice(1).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'))
  };
}

// ─── Render tab list with checkboxes and thumbnails ───
function renderTabsList(tabs, activeTabId) {
  const tabsListDiv = document.getElementById("tabsList");
  tabsListDiv.innerHTML = "";
  if (!tabs || tabs.length === 0) {
    tabsListDiv.textContent = "No valid tabs found.";
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

      const thumbnail = document.createElement("img");
      thumbnail.className = "tab-thumbnail";

      const useDefaultIcon = () => {
        try {
          if (tab.favIconUrl &&
            (tab.favIconUrl.startsWith("http") ||
              tab.favIconUrl.startsWith("data:") ||
              tab.favIconUrl.startsWith("chrome:"))) {
            thumbnail.src = tab.favIconUrl;
          } else {
            thumbnail.src = chrome.runtime.getURL("assets/icons/icon48.png");
          }
        } catch (err) {
          thumbnail.src = chrome.runtime.getURL("assets/icons/icon48.png");
        }
      };

      useDefaultIcon();
      thumbnail.onerror = useDefaultIcon;

      const infoDiv = document.createElement("div");
      infoDiv.className = "tab-info";

      const titleSpan = document.createElement("span");
      titleSpan.className = "tab-title";
      titleSpan.textContent = tab.title || "Untitled";

      infoDiv.appendChild(titleSpan);
      div.appendChild(checkbox);
      div.appendChild(thumbnail);
      div.appendChild(infoDiv);
      tabsListDiv.appendChild(div);
    } catch (error) {
      console.error("Error rendering tab:", error);
    }
  });
}

// ─── Extract text from selected tabs ───
function extractSelectedTabs() {
  return new Promise((resolve, reject) => {
    const statusDiv = document.getElementById("status");
    try {
      const selectedCheckboxes = document.querySelectorAll("#tabsList input[type='checkbox']:checked");
      const tabIds = Array.from(selectedCheckboxes).map(cb => parseInt(cb.value));

      if (tabIds.length === 0) {
        statusDiv.textContent = "No tabs selected.";
        reject("No tabs selected.");
        return;
      }

      const extractionMode = useIntelligentExtraction ? "smart" : "full";
      statusDiv.textContent = `Extracting text (${extractionMode} mode)...`;

      chrome.runtime.sendMessage({
        action: "extractSelectedTabs",
        tabIds,
        useIntelligentExtraction
      }, (response) => {
        if (response && response.success) {
          statusDiv.textContent = `Extraction complete (${extractionMode} mode).`;
          resolve(response.data);
        } else {
          statusDiv.textContent = response ? response.message : "Error during extraction.";
          reject(response ? response.message : "Error during extraction.");
        }
      });
    } catch (error) {
      statusDiv.textContent = "Error processing tabs.";
      console.error("Error processing tabs:", error);
      reject(error);
    }
  });
}

// ─── Extraction mode UI ───
function updateExtractionModeUI(showNotification = false) {
  const modeToggle = document.getElementById("extractionModeToggle");
  modeToggle.checked = useIntelligentExtraction;

  if (showNotification) {
    const statusDiv = document.getElementById("status");
    const modeName = useIntelligentExtraction ? "Smart" : "Full";
    const modeDesc = useIntelligentExtraction
      ? "Extracts main content only"
      : "Extracts all page text";

    statusDiv.textContent = `${modeName} mode: ${modeDesc}`;

    setTimeout(() => {
      if (statusDiv.textContent.includes(`${modeName} mode`)) {
        statusDiv.textContent = "";
      }
    }, 3000);
  }
}

function toggleExtractionMode(event) {
  useIntelligentExtraction = event.target.checked;
  updateExtractionModeUI(true);
  chrome.storage.local.set({ useIntelligentExtraction });
}

// ─── Date formatting ───
function formatDateLong(date) {
  if (!date) return "Publication date unavailable";
  try {
    return date.toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (error) {
    return "Unknown date format";
  }
}

// ─── Content formatter ───
function formatContent(data) {
  return compileTabsXml(data);
}

// ─── Search state persistence ───
const SEARCH_STATE_KEY = 'tabscribe_search_state';

function saveSearchState() {
  const state = {
    // Basic settings
    engine: document.getElementById('searchEngine')?.value || 'google',
    queries: document.getElementById('searchQueries')?.value || '',
    maxLinks: document.getElementById('searchLimit')?.value || '5',
    format: 'xml',
    aiConcurrency: Number(document.getElementById('aiConcurrency')?.value || 3),

    // Advanced settings (Date & AI)
    enableDateFilter: document.getElementById('enableDateFilter')?.checked ?? false,
    dateFrom: document.getElementById('dateFrom')?.value || '',
    dateTo: document.getElementById('dateTo')?.value || '',
    dateFormat: document.getElementById('dateFormat')?.value || 'YYYY-MM-DD',
    generatePrompt: document.getElementById('generatePromptToggle')?.checked ?? false,
    enableAiMode: document.getElementById('enableAiMode')?.checked ?? true,
    aiOverviewOnly: document.getElementById('aiOverviewOnly')?.checked ?? false,

    // UI State
    activeView: document.querySelector('.nav-tab.active')?.dataset.target || 'view-tabs'
  };
  chrome.storage.local.set({ [SEARCH_STATE_KEY]: state });
}

function restoreSearchState() {
  return new Promise(resolve => {
    chrome.storage.local.get(SEARCH_STATE_KEY, (data) => {
      const state = data[SEARCH_STATE_KEY];
      if (!state) { resolve(null); return; }

      // Restore inputs
      const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };

      setVal('searchEngine', state.engine);
      setVal('searchQueries', state.queries);
      setVal('searchLimit', state.maxLinks);
      if (document.getElementById('searchLimitValue')) document.getElementById('searchLimitValue').textContent = state.maxLinks;

      setVal('aiConcurrency', state.aiConcurrency || 3);

      // Restore Date Filters
      setCheck('enableDateFilter', state.enableDateFilter);
      setVal('dateFrom', state.dateFrom || new Date().toISOString().split('T')[0]);
      setVal('dateTo', state.dateTo || new Date().toISOString().split('T')[0]);
      setVal('dateFormat', state.dateFormat);

      // Update Date Options UI visibility
      const dateOptions = document.getElementById('dateFilterOptions');
      if (dateOptions) dateOptions.classList.toggle('hidden', !state.enableDateFilter);

      // Restore AI Prompt Toggle
      setCheck('generatePromptToggle', state.generatePrompt);

      // Restore AI Mode Toggle
      setCheck('enableAiMode', state.enableAiMode !== undefined ? state.enableAiMode : true);

      // Restore AI Overview Only Toggle
      setCheck('aiOverviewOnly', state.aiOverviewOnly || false);

      // Restore active view
      if (state.activeView) {
        const tabs = document.querySelectorAll('.nav-tab');
        const views = document.querySelectorAll('.view');
        tabs.forEach(t => t.classList.remove('active'));
        views.forEach(v => v.classList.remove('active'));

        const targetTab = document.querySelector(`.nav-tab[data-target="${state.activeView}"]`);
        const targetView = document.getElementById(state.activeView);
        if (targetTab) targetTab.classList.add('active');
        if (targetView) targetView.classList.add('active');
      }

      resolve(state);
    });
  });
}

// ─── Copy Button ───
document.getElementById("copyButton").addEventListener("click", async () => {
  try {
    const data = await extractSelectedTabs();
    const asMarkdown = false;
    extractedData = data;

    const combinedText = formatContent(data);

    if (!combinedText) {
      document.getElementById("status").textContent = "No text content to copy.";
      return;
    }

    await navigator.clipboard.writeText(combinedText);
    document.getElementById("status").textContent = "Text copied successfully!";
  } catch (error) {
    document.getElementById("status").textContent = "Error copying text.";
    console.error("Error copying:", error);
  }
});

// ─── Download Button ───
document.getElementById("downloadButton").addEventListener("click", async () => {
  try {
    const data = await extractSelectedTabs();
    const asMarkdown = false;
    extractedData = data;

    const fileContent = formatContent(data);

    if (!fileContent) {
      document.getElementById("status").textContent = "No text content to download.";
      return;
    }

    const blob = new Blob([fileContent], { type: "text/plain;charset=utf-8" });
    const urlBlob = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = urlBlob;
    a.download = "tabs_content.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(urlBlob);

    document.getElementById("status").textContent = 'Arquivo .txt com XML baixado.';
  } catch (error) {
    document.getElementById("status").textContent = "Error downloading file.";
    console.error("Error downloading:", error);
  }
});

// ─── Select All ───
function toggleSelectAllTabs(event) {
  try {
    const isChecked = event.target.checked;
    document.querySelectorAll("#tabsList input[type='checkbox']").forEach(cb => {
      cb.checked = isChecked;
    });
    document.getElementById("status").textContent = isChecked
      ? "All tabs selected."
      : "All tabs deselected.";
  } catch (error) {
    console.error("Error selecting tabs:", error);
  }
}

// ─── Filter Tabs ───
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

// ─── Log Viewer ───
function showLogViewer() {
  // Request the rich, AI-optimized diagnostic report from the Service Worker.
  // This uses formatLogsForExport() which includes extension config, timing
  // deltas, stack traces, diagnostic hints, and error index.
  chrome.runtime.sendMessage({ action: "getFormattedLogs" }, (logText) => {
    if (chrome.runtime.lastError) {
      alert("Failed to retrieve logs.");
      return;
    }

    if (!logText || logText.includes('No log entries recorded')) {
      alert("No logs available.");
      return;
    }

    // Download as .log file
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tabscribe_${new Date().toISOString().slice(0, 10)}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    document.getElementById("status").textContent = "Diagnostic log downloaded.";
  });
}

// ═══════════════════════════════════════════
// DOM Ready
// ═══════════════════════════════════════════
async function initializeMCPSetting() {
  const checkbox = document.getElementById('mcpBridgeEnabled');
  const port = document.getElementById('mcpBridgePort');
  const save = document.getElementById('saveMCPPort');
  const status = document.getElementById('mcpSettingsStatus');
  const labels = { disabled: 'Desativado', connecting: 'Conectando', connected: 'Conectado ao servidor local', reconnecting: 'Servidor indisponível. Reconectando' };
  let revision = 0;
  const render = value => { status.textContent = value ? `${labels[value.state] || value.state} (${value.url})` : 'Aguardando status do service worker.'; };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.mcpBridgeStatus) { revision++; render(changes.mcpBridgeStatus.newValue); }
  });
  try {
    const data = await chrome.storage.local.get({ mcpBridgeEnabled: false, mcpBridgePort: 3031, mcpBridgeStatus: null });
    checkbox.checked = data.mcpBridgeEnabled === true;
    port.value = data.mcpBridgePort;
    checkbox.disabled = port.disabled = save.disabled = false;
    if (revision === 0) render(data.mcpBridgeStatus);
  } catch {
    status.textContent = 'Não foi possível ler a configuração MCP. Reabra o popup.';
    return;
  }
  checkbox.addEventListener('change', async () => {
    checkbox.disabled = true;
    try {
      await chrome.storage.local.set({ mcpBridgeEnabled: checkbox.checked });
    } catch {
      checkbox.checked = !checkbox.checked;
      status.textContent = 'Não foi possível salvar a configuração MCP.';
    } finally { checkbox.disabled = false; }
  });
  save.addEventListener('click', async () => {
    if (!port.reportValidity()) return;
    save.disabled = true;
    try {
      await chrome.storage.local.set({ mcpBridgePort: Number(port.value) });
    } catch { status.textContent = 'Não foi possível salvar a porta MCP.'; }
    finally { save.disabled = false; }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initializeMCPSetting();
  const statusDiv = document.getElementById("status");
  statusDiv.textContent = "Loading tabs...";

  const selectAllCheckbox = document.getElementById("selectAllCheckbox");
  selectAllCheckbox.addEventListener("change", toggleSelectAllTabs);

  const extractionModeToggle = document.getElementById("extractionModeToggle");
  extractionModeToggle.addEventListener("change", toggleExtractionMode);

  document.getElementById('searchTabsInput').addEventListener('input', filterTabs);

  // Log button
  const logBtn = document.getElementById('viewLogsBtn');
  if (logBtn) logBtn.addEventListener('click', showLogViewer);

  // ─── Tab Navigation ───
  const navTabs = document.querySelectorAll('.nav-tab');
  const views = document.querySelectorAll('.view');

  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      navTabs.forEach(t => t.classList.remove('active'));
      views.forEach(v => v.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.dataset.target;
      document.getElementById(targetId).classList.add('active');

      // Persist active view
      saveSearchState();
    });
  });

  // ─── Search controls ───
  const limitSlider = document.getElementById('searchLimit');
  const limitValue = document.getElementById('searchLimitValue');

  if (limitSlider && limitValue) {
    limitSlider.addEventListener('input', (e) => {
      limitValue.textContent = e.target.value;
      saveSearchState();
    });
  }

  // Persist form changes on input
  const engineSelect = document.getElementById('searchEngine');
  const queriesInput = document.getElementById('searchQueries');
  const aiConcurrencyInput = document.getElementById('aiConcurrency');

  // New fields listeners
  const promptToggle = document.getElementById('generatePromptToggle');
  const dateFromIn = document.getElementById('dateFrom');
  const dateToIn = document.getElementById('dateTo');
  const dateFormatSel = document.getElementById('dateFormat');

  const saveHandler = () => saveSearchState();

  if (engineSelect) engineSelect.addEventListener('change', saveHandler);
  if (queriesInput) queriesInput.addEventListener('input', saveHandler);
  if (aiConcurrencyInput) aiConcurrencyInput.addEventListener('change', saveHandler);

  if (promptToggle) promptToggle.addEventListener('change', saveHandler);
  const aiModeToggle = document.getElementById('enableAiMode');
  if (aiModeToggle) aiModeToggle.addEventListener('change', saveHandler);
  const aiOverviewOnlyToggle = document.getElementById('aiOverviewOnly');
  if (aiOverviewOnlyToggle) aiOverviewOnlyToggle.addEventListener('change', saveHandler);
  if (dateFromIn) dateFromIn.addEventListener('change', saveHandler);
  if (dateToIn) dateToIn.addEventListener('change', saveHandler);
  if (dateFormatSel) dateFormatSel.addEventListener('change', saveHandler);

  // ─── Date Filter Toggle ───
  const dateCheckbox = document.getElementById('enableDateFilter');
  const dateOptions = document.getElementById('dateFilterOptions');
  const dateFrom = document.getElementById('dateFrom');
  const dateTo = document.getElementById('dateTo');
  const dateFormatSelect = document.getElementById('dateFormat');

  if (dateCheckbox) {
    // Default to today's date
    const today = new Date().toISOString().split('T')[0];
    if (dateFrom && !dateFrom.value) dateFrom.value = today;
    if (dateTo && !dateTo.value) dateTo.value = today;

    dateCheckbox.addEventListener('change', () => {
      if (dateOptions) dateOptions.classList.toggle('hidden', !dateCheckbox.checked);
    });
  }

  /** Format a YYYY-MM-DD string according to selected format */
  function formatDateStr(isoDate, format) {
    const [y, m, d] = isoDate.split('-');
    switch (format) {
      case 'DD/MM/YYYY': return `${d}/${m}/${y}`;
      case 'MM/DD/YYYY': return `${m}/${d}/${y}`;
      default: return isoDate; // YYYY-MM-DD
    }
  }

  // ─── Search Button ───
  const searchBtn = document.getElementById('startAutoSearch');
  const progressDiv = document.getElementById('searchProgress');
  const progressBar = document.getElementById('progressBar');
  const statusText = document.getElementById('searchStatusText');
  const cancelBtn = document.getElementById('cancelSearchBtn');
  const generatePromptToggle = document.getElementById('generatePromptToggle');
  const aiBanner = document.getElementById('aiInstructionsBanner');
  const aiBannerDetails = document.getElementById('aiBannerDetails');

  // ─── @TABSCRIBE Auto-Detection on textarea input ───
  if (queriesInput && aiBanner) {
    queriesInput.addEventListener('input', () => {
      const parsed = parseTabScribeInstructions(queriesInput.value);
      if (parsed && parsed.queries.length > 0) {
        const details = [];
        if (parsed.engine) details.push(`engine=${parsed.engine}`);
        if (parsed.links) details.push(`links=${parsed.links}`);
        details.push(`${parsed.queries.length} queries`);
        aiBannerDetails.textContent = `AI instructions detected: ${details.join(', ')}`;
        aiBanner.classList.remove('hidden');
      } else {
        aiBanner.classList.add('hidden');
      }
    });
  }

  // ─── Cancel Handler ───
  function handleCancel() {
    // 1. Tell the SW to set the in-memory flag (if process is alive)
    chrome.runtime.sendMessage({ action: 'cancelAutoSearch' }, () => {
      if (chrome.runtime.lastError) { /* SW might be dead, that's fine */ }
    });

    // 2. DIRECTLY reset storage — works even if SW is dead/suspended
    chrome.storage.local.set({ autoSearch: { status: 'cancelled' } });

    // 3. Immediately reset the popup UI
    statusText.textContent = 'Cancelled.';
    if (cancelBtn) cancelBtn.disabled = true;
    progressBar.style.width = '0%';
    setTimeout(() => {
      progressDiv.classList.add('hidden');
      resetSearchUI();
    }, 800);

    // Also hide captcha warning if visible
    const captchaWarning = document.getElementById('captchaWarning');
    if (captchaWarning) captchaWarning.classList.add('hidden');
  }

  // ─── Cancel Button ───
  if (cancelBtn) {
    cancelBtn.addEventListener('click', handleCancel);
  }
  const copyInitialPromptBtn = document.getElementById('copyInitialPromptBtn');
  if (copyInitialPromptBtn) {
    copyInitialPromptBtn.addEventListener('click', async () => {
      const isAiActive = document.getElementById('enableAiMode')?.checked || document.getElementById('aiOverviewOnly')?.checked;
      
      let p = `🎯 TABSCRIBE QUERY GENERATOR\n`;
      p += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      p += `Research Context:\n`;
      p += `> [DESCRIBE YOUR RESEARCH TOPIC OR OBJECTIVE HERE]\n\n`;
      p += `AI Instructions:\n`;
      
      if (isAiActive) {
        p += `Act as a Senior Research Analyst and Prompt Engineer. Your task is to break down the research context into a sequence of deep, complex, and highly intelligent prompts designed specifically for Google AI Overview (Search AI Mode).\n\n`;
        p += `Since TabScribe will execute these prompts IN SEQUENCE within the SAME CHAT, they should be designed as a conversational thread where subsequent prompts build on the preceding context.\n\n`;
        p += `📝 TASK:\n`;
        p += `1. Analyze the context and identify the main dimensions, hidden assumptions, and potential blind spots.\n`;
        p += `2. Generate a series of 3 to 7 detailed, rich prompts (not simple keywords). The prompts can vary in length (some short, some detailed), depending on the need. They must instruct the search AI on the exact depth, perspectives, or formatting required.\n`;
        p += `3. Design the sequence dynamically: the first prompt should establish a broad but deep foundation, the second should dive into critical analysis/comparison, and subsequent prompts should ask for details, contradictions, or synthesis based on what the AI would have answered.\n`;
      } else {
        p += `Act as a Precision SEO Specialist. Your task is to distill the context above into highly targeted, exact keywords.\n\n`;
        p += `📝 TASK:\n`;
        p += `1. Analyze the context and extract the core entities and concepts.\n`;
        p += `2. Generate short, exact, and simplified keyword combinations (boolean style preferred) for traditional search engines.\n`;
      }

      p += `3. CRITICAL FORMATTING RULES:\n`;
      p += `   Do NOT use brackets [].\n`;
      p += `   Do NOT use numbering (1., 2.).\n`;
      p += `   Do NOT use bullet points or markdown.\n`;
      p += `   Do NOT add the @TABSCRIBE tag.\n`;
      p += `   Return ONLY THE RAW PROMPTS/QUERIES (one per line) ready to copy and paste into TabScribe.\n`;

      try {
        await navigator.clipboard.writeText(p);
        const originalText = copyInitialPromptBtn.innerHTML;
        copyInitialPromptBtn.innerHTML = '✅ Copied!';
        setTimeout(() => {
          copyInitialPromptBtn.innerHTML = originalText;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy initial prompt: ', err);
        const originalText = copyInitialPromptBtn.innerHTML;
        copyInitialPromptBtn.innerHTML = '❌ Copy failed';
        setTimeout(() => {
          copyInitialPromptBtn.innerHTML = originalText;
        }, 2000);
      }
    });
  }

  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const rawQueries = queriesInput.value;

      // ── @TABSCRIBE Protocol: check for AI instructions ──
      const aiInstructions = parseTabScribeInstructions(rawQueries);
      let queries;
      let engine;
      let maxLinks;

      if (aiInstructions && aiInstructions.queries.length > 0) {
        // AI instructions detected — use queries from @TABSCRIBE, but engine always from UI dropdown
        queries = aiInstructions.queries;
        engine = engineSelect.value;
        maxLinks = aiInstructions.links || parseInt(limitSlider.value);
      } else {
        // Normal mode — use UI values
        queries = rawQueries.split('\n').map(q => q.trim()).filter(q => q.length > 0);
        engine = engineSelect.value;
        maxLinks = parseInt(limitSlider.value);
      }

      // Append date filter to each query if enabled
      if (dateCheckbox && dateCheckbox.checked && dateFrom?.value) {
        const fmt = dateFormatSelect?.value || 'YYYY-MM-DD';
        const from = formatDateStr(dateFrom.value, fmt);
        const to = dateTo?.value ? formatDateStr(dateTo.value, fmt) : from;
        const dateSuffix = from === to ? from : `${from} ${to}`;
        queries = queries.map(q => `${q} ${dateSuffix}`);
      }

      if (queries.length === 0) {
        statusText.textContent = "Please enter at least one query.";
        progressDiv.classList.remove('hidden');
        return;
      }

        const aiConcurrency = Math.max(1, Math.min(6, Number(aiConcurrencyInput?.value || 3)));
      const generatePrompt = generatePromptToggle ? generatePromptToggle.checked : false;
      const enableAiMode = document.getElementById('enableAiMode')?.checked ?? true;
      const aiOverviewOnly = document.getElementById('aiOverviewOnly')?.checked ?? false;

      // AI Overview Only requires AI Mode — force it on
      if (aiOverviewOnly && !enableAiMode) {
        const aiModeEl = document.getElementById('enableAiMode');
        if (aiModeEl) aiModeEl.checked = true;
      }
      const finalEnableAiMode = aiOverviewOnly ? true : enableAiMode;

      // UI init
      searchBtn.disabled = true;
      statusText.textContent = aiOverviewOnly ? "Starting quick search (AI Overview Only)..." : "Starting search...";
      progressDiv.classList.remove('hidden');
      progressBar.style.width = '5%';

      // Show cancel button
      if (cancelBtn) {
        cancelBtn.classList.remove('hidden');
        cancelBtn.disabled = false;
      }

      // Hide AI banner during search
      if (aiBanner) aiBanner.classList.add('hidden');

      // Send command to background
      chrome.runtime.sendMessage({
        action: "autoSearch",
        queries: queries,
        config: { engine, maxLinks, aiConcurrency, format: 'xml', generatePrompt, enableAiMode: finalEnableAiMode, aiOverviewOnly }
      }, (response) => {
        if (chrome.runtime.lastError) {
          statusText.textContent = "Error: " + chrome.runtime.lastError.message;
          searchBtn.disabled = false;
          if (cancelBtn) cancelBtn.classList.add('hidden');
        } else {
          pollStatus();
        }
      });
    });
  }

  // ─── Status Polling ───
  function pollStatus() {
    const interval = setInterval(() => {
      chrome.runtime.sendMessage({ action: "getAutoSearchStatus" }, (status) => {
        if (chrome.runtime.lastError) {
          clearInterval(interval);
          resetSearchUI();
          return;
        }

        if (!status) return;

        if (status.status === 'running') {
          progressDiv.classList.remove('hidden');
          searchBtn.disabled = true;
          if (cancelBtn) { cancelBtn.classList.remove('hidden'); cancelBtn.disabled = false; }

          const queryProgress = (status.currentQuery / status.totalQueries) * 100;
          const linkProgress = (status.currentLink / status.totalLinks) * (100 / status.totalQueries);
          const totalPerc = Math.min(Math.round(queryProgress + linkProgress), 95);

          progressBar.style.width = `${totalPerc}%`;
          statusText.textContent = `Processing Query ${status.currentQuery}/${status.totalQueries} — Link ${status.currentLink}/${status.totalLinks}`;
        } else if (status.status === 'captcha_required') {
          searchOverlay.classList.remove('hidden');
          searchProgress.classList.remove('hidden');
          const captchaWarning = document.getElementById('captchaWarning');
          if (captchaWarning) captchaWarning.classList.remove('hidden');

          statusText.innerHTML = `<strong>⚠️ Verificação Necessária!</strong><br>Resolva o CAPTCHA e clique em Continuar`;
          progressBar.style.backgroundColor = '#f97316'; // orange

        } else if (status.status === 'completed') {
          statusText.textContent = "Done! File saved.";

          // ⚠️ Login Gap Warning
          if (status.loginGapCount > 0) {
            statusText.innerHTML += `<br><span class="text-orange-500 font-bold text-sm block mt-1">⚠️ ${status.loginGapCount} links ignorados (Login Necessário)</span>`;
          }

          progressBar.style.width = '100%';
          clearInterval(interval);
          resetSearchUI();
          // Show copy prompt button if analysis prompt was generated
          showCopyPromptIfAvailable();
        } else if (status.status === 'cancelled') {
          statusText.textContent = "Cancelled by user.";
          progressBar.style.width = '0%';
          clearInterval(interval);
          resetSearchUI();
        } else if (status.status === 'error') {
          statusText.textContent = "Error: " + (status.errors ? status.errors.join(', ') : 'Unknown');
          statusText.classList.add('status-error');
          clearInterval(interval);
          resetSearchUI();
        }
      });
    }, 1000);
  }

  function resetSearchUI() {
    if (searchBtn) searchBtn.disabled = false;
    if (cancelBtn) { cancelBtn.classList.add('hidden'); cancelBtn.disabled = false; }
  }

  // ─── Copy Prompt to Clipboard ───
  function showCopyPromptIfAvailable() {
    chrome.storage.local.get('lastAnalysisPrompt', (data) => {
      const section = document.getElementById('copyPromptSection');
      if (data.lastAnalysisPrompt && section) {
        section.classList.remove('hidden');
      }
    });
  }

  const copyPromptSection = document.getElementById('copyPromptSection');
  const captchaWarning = document.getElementById('captchaWarning');
  const resumeSearchBtn = document.getElementById('resumeSearchBtn');
  const cancelCaptchaBtn = document.getElementById('cancelCaptchaBtn');

  // Resume Button Handler
  if (resumeSearchBtn) {
    resumeSearchBtn.addEventListener('click', () => {
      // Optimistically hide warning
      if (captchaWarning) captchaWarning.classList.add('hidden');
      statusText.textContent = "Retomando pesquisa...";

      // Signal background to resume
      chrome.storage.local.get('autoSearch', (data) => {
        if (data.autoSearch) {
          chrome.storage.local.set({
            autoSearch: { ...data.autoSearch, status: 'running' }
          });
        }
      });
    });
  }

  // Cancel Captcha Button Handler (same as main cancel)
  if (cancelCaptchaBtn) {
    cancelCaptchaBtn.addEventListener('click', handleCancel);
  }

  const copyPromptBtn = document.getElementById('copyPromptBtn');
  const copyPromptStatus = document.getElementById('copyPromptStatus');

  if (copyPromptBtn) {
    copyPromptBtn.addEventListener('click', () => {
      chrome.storage.local.get('lastAnalysisPrompt', async (data) => {
        if (!data.lastAnalysisPrompt) {
          if (copyPromptStatus) copyPromptStatus.textContent = '⚠ No prompt found. Run a search first.';
          return;
        }
        try {
          await navigator.clipboard.writeText(data.lastAnalysisPrompt);
          copyPromptBtn.textContent = '✅ Copied!';
          if (copyPromptStatus) copyPromptStatus.textContent = 'Paste into Gemini, ChatGPT, or Claude.';
          setTimeout(() => {
            copyPromptBtn.textContent = '📋 Copy Prompt to Clipboard';
          }, 3000);
        } catch (err) {
          if (copyPromptStatus) copyPromptStatus.textContent = '❌ Copy failed: ' + err.message;
        }
      });
    });
  }

  // ─── Restore state on popup open ───
  restoreSearchState();

  // Check if search is running (when popup is re-opened)
  // Read DIRECTLY from storage — don't rely on the SW being alive
  chrome.storage.local.get('autoSearch', (data) => {
    const status = data.autoSearch;
    if (!status) return;

    if (status.status === 'running') {
      // Check if this is a zombie status (started > 5 min ago with no SW alive)
      const age = Date.now() - (status.startTime || 0);
      if (age > 5 * 60 * 1000) {
        // Stale — force cancel
        chrome.storage.local.set({ autoSearch: { status: 'cancelled' } });
        return;
      }

      // Legitimately running — show progress + cancel
      if (progressDiv) progressDiv.classList.remove('hidden');
      if (searchBtn) searchBtn.disabled = true;
      if (cancelBtn) { cancelBtn.classList.remove('hidden'); cancelBtn.disabled = false; }
      pollStatus();
    }
  });

  // ─── Load tabs ───
  // ─── Load tabs with Timeout & Retry ───
  function loadTabs() {
    statusDiv.textContent = "Loading tabs...";

    const timeoutId = setTimeout(() => {
      statusDiv.innerHTML = `
            Error loading tabs (Timeout).<br>
            <button id="retryBtn" style="margin-top:5px;padding:4px 8px;cursor:pointer;">Retry</button>
          `;
      document.getElementById('retryBtn')?.addEventListener('click', loadTabs);
    }, 5000); // 5s timeout

    chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
      const activeTabId = activeTabs.length > 0 ? activeTabs[0].id : null;

      chrome.storage.local.get(['useIntelligentExtraction'], (result) => {
        if (result.useIntelligentExtraction !== undefined) {
          useIntelligentExtraction = result.useIntelligentExtraction;
        }
        updateExtractionModeUI(false);

        try {
          chrome.runtime.sendMessage({ action: "getTabs" }, (response) => {
            clearTimeout(timeoutId);

            if (chrome.runtime.lastError) {
              console.error("SW Error:", chrome.runtime.lastError);
              statusDiv.innerHTML = `Service Worker sleeping. <button id="retryBtn">Wake Up & Retry</button>`;
              document.getElementById('retryBtn')?.addEventListener('click', loadTabs);
              return;
            }

            if (response && response.success) {
              renderTabsList(response.data, activeTabId);
              statusDiv.textContent = "";
            } else {
              statusDiv.textContent = response ? response.message : "Error loading tabs.";
            }
          });
        } catch (e) {
          clearTimeout(timeoutId);
          statusDiv.textContent = "Extension error: " + e.message;
        }
      });
    });
  }

  // Initial load
  loadTabs();
});
