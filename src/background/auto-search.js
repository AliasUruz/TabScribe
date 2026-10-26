import { createQueryPool, buildResearchPrompt } from './ai-query-pool.mjs';
import { compileSearchXml } from '../shared/xml-export.mjs';
import { ENGINES } from './search-engine.js';
import { log, clearLogs } from '../shared/logger.js';
import { isYouTubeWatch, extractYouTubeContent } from '../extractors/yt-extractor.js';

// ═══════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════
const TAB_LOAD_TIMEOUT = 15000;   // max global wait per query batch (15s)
const PER_TAB_TIMEOUT = 6000;    // max wait for a single tab (6s) — extract partial & skip
const EARLY_HARVEST_DELAY = 2000; // try early extraction after 2s of loading
const MIN_CONTENT_LENGTH = 200;   // minimum chars to consider an early harvest successful
const POLL_INTERVAL = 400;        // poll every 400ms (smooth, reliable check)
const MAX_LINKS_PER_QUERY_DEFAULT = 10;

// Domains known to block/stall extraction (auto-skipped)
const SLOW_DOMAINS = [
    'instagram.com',
    'facebook.com',
    'linkedin.com',
    'tiktok.com',
    'x.com',
    'twitter.com',
    'threads.net',
    'digital.estadao.com.br',  // Digital flipbook reader — no extractable text
    'acervo.estadao.com.br',   // Same — digital archive viewer
];

/**
 * Universal post-extraction quality filter.
 * Detects and cleans garbage patterns from extracted content:
 * - Repeated text lines (e.g. "EnglishРусский" 100x)
 * - Excessive short navigation lines (menus with 20+ items)
 * - Common Brazilian news site chrome (comentaristas, programas, etc.)
 */
function cleanExtractedContent(text) {
    if (!text || text.length < 50) return text;

    const lines = text.split('\n');

    // ── 1. Remove repeated lines (same text appearing 3+ times) ──
    const lineCounts = new Map();
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 2) {
            lineCounts.set(trimmed, (lineCounts.get(trimmed) || 0) + 1);
        }
    }
    const repeatedLines = new Set();
    for (const [line, count] of lineCounts) {
        if (count >= 3) repeatedLines.add(line);
    }

    let cleaned = lines
        .filter(line => !repeatedLines.has(line.trim()))
        .join('\n');

    // ── 2. Remove navigation menu blocks ──
    // Pattern: 10+ consecutive short lines (< 35 chars each) = likely a menu
    const cleanedLines = cleaned.split('\n');
    const result = [];
    let shortStreak = [];

    for (const line of cleanedLines) {
        const trimmed = line.trim();
        if (trimmed.length > 0 && trimmed.length < 35 && !/[.!?:;]$/.test(trimmed)) {
            shortStreak.push(line);
        } else {
            if (shortStreak.length >= 10) {
                // This was a menu block — discard it
            } else {
                result.push(...shortStreak);
            }
            shortStreak = [];
            result.push(line);
        }
    }
    // Handle trailing streak
    if (shortStreak.length < 10) {
        result.push(...shortStreak);
    }

    cleaned = result.join('\n');

    // ── 3. Remove common news site chrome patterns ──
    const chromePatterns = [
        /^voltar\s*$/gim,
        /^Página Principal\s*$/gm,
        /^Ver Todos?\s*$/gm,
        /^Ver todos os episódios\s*$/gm,
        /^Grade de Programação\s*$/gm,
        /^Mais recente\s*$/gm,
        /^Próxima\s*$/gm,
        /^Mais lidas\s*$/gm,
        /^Mais da \w+\s*$/gm,
        /^SIGA\s*$/gm,
        /^ESCUTE AO VIVO\s*$/gm,
        /^Acesse sua conta\s*$/gm,
        /^ou cadastre-se grátis\s*$/gm,
        /^Entrar\s*$/gm,
        /^Menu\s*$/gm,
        /^Fale Conosco\s*$/gm,
        /^Termos e Condições\s*$/gm,
        /^princípios editoriais\s*$/gm,
        /^termos de uso\s*$/gm,
        /^política de privacidade\s*$/gm,
        /^fale conosco\s*$/gm,
        /^Jump to content\s*$/gm,
        /^Main menu\s*$/gm,
        /^Create account\s*$/gm,
        /^Log in\s*$/gm,
        /^Donate\s*$/gm,
        /^Add languages\s*$/gm,
        /^Read\s*$/gm,
        /^Edit\s*$/gm,
        /^View history\s*$/gm,
        /^Tools\s*$/gm,
        /^Search\s*$/gm,
        /^From Wikipedia.*$/gm,
        /^This page was last edited.*$/gm,
        /^Text is available under.*$/gm,
        /^Privacy policy\s*$/gm,
        /^About Wikipedia\s*$/gm,
        /^Disclaimers\s*$/gm,
        /^Contact Wikipedia\s*$/gm,
        /^Cookie statement\s*$/gm,
        /^Mobile view\s*$/gm,
        /^Facebook\s*$/gm,
        /^Twitter\s*$/gm,
        /^Whatsapp\s*$/gm,
        /^Linkedin\s*$/gm,
        /^\d+ seconds of \d+ minutes.*$/gm,
        /Volume \d+%/gm,

        // ── Medium boilerplate ──
        /^Write\s*$/gm,
        /^Sign up\s*$/gm,
        /^Sign in\s*$/gm,
        /^Follow\s*$/gm,
        /^\d+\.?\d*K? followers?\s*$/gm,
        /^\d+\.?\d*K? following\s*$/gm,
        /^Subscribe\s*$/gm,
        /^Get .*(?:'s|'s) stories in your inbox.*$/gm,
        /^Join Medium for free.*$/gm,
        /^Responses?\s*\(?\d*\)?\s*$/gm,
        /^Write a response\s*$/gm,
        /^What are your thoughts\??\s*$/gm,
        /^Cancel\s*$/gm,
        /^Respond\s*$/gm,
        /^More from .*$/gm,
        /^Recommended from Medium\s*$/gm,
        /^See more recommendations\s*$/gm,
        /^See all from .*$/gm,
        /^Written by .*$/gm,
        /^Text to speech\s*$/gm,
        /^No responses yet\s*$/gm,

        // ── StackOverflow boilerplate ──
        /^Communities for your favorite technologies.*$/gm,
        /^STACK INTERNAL\s*$/gm,
        /^Stack Overflow for Teams.*$/gm,
        /^Try for free Learn more\s*$/gm,
        /^Ask Question\s*$/gm,
        /^Asked \d+ .* ago\s*$/gm,
        /^Modified \d+ .* ago\s*$/gm,
        /^Viewed \d+k? times?\s*$/gm,
        /^Sign up using Google\s*$/gm,
        /^Sign up using Email and Password\s*$/gm,
        /^Post as a guest\s*$/gm,
        /^Post Your Answer\s*$/gm,
        /^By clicking[\s\S]*?terms of service.*$/gm,
        /^Start asking to get answers\s*$/gm,
        /^Find the answer.*by asking.*$/gm,
        /^Explore related questions\s*$/gm,
        /^The Overflow Blog\s*$/gm,
        /^Featured on Meta\s*$/gm,
        /^Hot Network Questions\s*$/gm,
        /^Site design \/ logo.*Stack Exchange.*$/gm,
        /^Know someone who can answer\?.*$/gm,
        /^Your Answer\s*$/gm,
        /^Required, but never shown\s*$/gm,
        /^Community activity\s*$/gm,
        /^Last 1 hr\s*$/gm,
        /^Loading…\s*$/gm,

        // ── GitHub boilerplate ──
        /^New issue\s*$/gm,
        /^Open\s*$/gm,
        /^Closed\s*$/gm,
    ];

    for (const pattern of chromePatterns) {
        cleaned = cleaned.replace(pattern, '');
    }

    // ── Final cleanup ──
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    return cleaned;
}

// Cancellation flag
let cancelRequested = false;
let cancelActiveSearch = () => {};

/**
 * Request cancellation. Called by background.js.
 * Also directly sets storage status (belt + suspenders).
 */
export function requestCancel() {
    cancelRequested = true;
    cancelActiveSearch();
}

/**
 * Multi-Tab Auto-Search Orchestrator.
 *
 * For each query:
 *   1. Open a search tab → wait for load → parse SERP
 *   2. Open ALL result links as separate tabs (batch)
 *   3. Poll all tabs until loaded
 *   4. Extract content from each tab
 *   5. Close result tabs
 *
 * @param {string[]} queries
 * @param {object} config - { engine, maxLinks, asMarkdown }
 * @param {function} extractorFn - processTabsConcurrently from background.js
 */
let searchActive = false;
export function isSearchActive() { return searchActive; }

export async function runAutoSearch(queries, config = {}, extractorFn) {
    if (searchActive) throw new Error('A search is already active.');
    config = config && typeof config === 'object' ? config : {};
    const jobId = config.jobId || crypto.randomUUID();
    searchActive = true;
    cancelRequested = false;
    try {
        await chrome.storage.local.set({ autoSearch: { status: 'starting', jobId } });
        return await performAutoSearch(queries, { ...config, jobId }, extractorFn);
    } catch (error) {
        await updateProgress({ status: 'error', errors: [error.message] });
        throw error;
    } finally {
        searchActive = false;
        cancelActiveSearch = () => {};
    }
}

async function performAutoSearch(queries, config, extractorFn) {
    await clearLogs();

    const {
        engine = 'google',
        maxLinks = config.maxLinksPerQuery || MAX_LINKS_PER_QUERY_DEFAULT,
        aiConcurrency = 3,
        generatePrompt = false,
        enableAiMode = true,
        aiOverviewOnly = config.aiOverviewOnly || config.useAiOverviewOnly || false
    } = config;
    const engineConfig = ENGINES[engine];
    const results = [];
    const aiOverviews = [];  // Collect AI Overview summaries per query
    let aiPool = null;
    const aiSessions = new Set();
    const globalSeenUrls = new Set(); // Cross-query URL deduplication
    const totalQueries = queries.length;
    let loginGapCount = 0; // Track accumulation of login-locked links

    await log('info', 'AutoSearch', `═══ SESSION START ═══ ${totalQueries} queries, engine=${engine}, maxLinks=${maxLinks}, format=xml.txt, generatePrompt=${generatePrompt}`);

    await updateProgress({
        status: 'running',
        currentQuery: 0, totalQueries,
        currentLink: 0, totalLinks: maxLinks,
        engine, errors: [],
        loginGapCount: 0,
        startTime: Date.now()
    });

    // ── Create a background window (non-intrusive) ──
    let windowId = null;
    let windowClosed = false;
    let hasFatalError = false;

    try {
        const win = await chrome.windows.create({
            type: 'normal',
            focused: false,  // Opens behind the user's current window
            width: 1200, height: 900,
            url: 'about:blank'
        });
        windowId = win.id;
        await log('info', 'AutoSearch', `Window ${windowId} created`);
        // NOTE: Keep the about:blank tab — Chrome closes the window when last tab is removed!
    } catch (err) {
        await log('error', 'AutoSearch', `FATAL: Cannot create window: ${err.message}`, { stack: err.stack });
        await updateProgress({ status: 'error', errors: ['Failed to create search window'] });
        return;
    }

    // ── Detect manual window close ──
    const onWindowRemoved = (removedId) => {
        if (removedId === windowId) {
            windowClosed = true;
            requestCancel();
            chrome.storage.local.set({ autoSearch: { status: 'cancelled' } });
            log('warn', 'AutoSearch', 'Window closed by user — cancelling');
        }
    };
    chrome.windows.onRemoved.addListener(onWindowRemoved);

    if (enableAiMode && engineConfig?.buildAiUrl) {
        aiPool = createQueryPool(queries, async (query, queryIndex) => {
            try { if (/^https?:/.test(query)) return null; } catch {}
            const session = new IndependentAiQuery(windowId, engine);
            aiSessions.add(session);
            try {
                const result = await session.processQuery(buildResearchPrompt(query));
                if (result) {
                    aiOverviews.push({ ...result, query, queryIndex, engine });
                    await updateProgress({ aiCompleted: aiOverviews.length, aiTotal: totalQueries });
                }
                return result;
            } finally {
                await session.close();
                aiSessions.delete(session);
            }
        }, { concurrency: aiConcurrency, shouldStop: () => cancelRequested || windowClosed });
        cancelActiveSearch = () => {
            aiPool.stop();
            for (const session of aiSessions) session.close().catch(() => {});
        };
    }

    try {
        for (let i = 0; i < queries.length; i++) {
            if (cancelRequested) {
                await log('info', 'AutoSearch', `Cancelled before query ${i + 1}`);
                break;
            }

            const query = queries[i];
            await log('info', 'AutoSearch', `── Query ${i + 1}/${totalQueries}: "${query}" ──`);
            await updateProgress({ currentQuery: i + 1, currentLink: 0 });
            await updateBadge(`${i + 1}/${totalQueries}`);

            // ── Step 1: Check if query is a direct URL (skip search) ──
            let links = [];
            let searchTabId = null;
            const isDirectUrl = (() => {
                try {
                    const u = new URL(query);
                    return u.protocol === 'http:' || u.protocol === 'https:';
                } catch { return false; }
            })();

            if (isDirectUrl) {
                // User pasted a URL — use it directly, no search needed
                await log('info', 'AutoSearch', `Direct URL detected — skipping search: ${query}`);
                links = [{ title: query, url: query }];
                // Jump straight to Step 3 (filtering)
            } else if (aiOverviewOnly) {
                // ── AI Overview Only: skip normal search page creation & parsing entirely ──
                await log('info', 'AutoSearch', `⚡ AI Overview Only: skipping link extraction for "${query}"`);
                if (aiPool) await aiPool.get(i);
                results.push({ query, links: [] });
                continue;
            } else {
                // ── Step 1b: Open search page (normal search query) ──
                const searchUrl = engineConfig.buildUrl(query, maxLinks + 5);
                await log('debug', 'AutoSearch', `Search URL: ${searchUrl}`);

                try {
                    const searchTab = await safeTabCreate({
                        windowId,
                        url: searchUrl,
                        active: false  // Background tab — never steal focus
                    });
                    searchTabId = searchTab.id;
                    await log('debug', 'AutoSearch', `Search tab ${searchTabId} created`);
                    await waitForTab(searchTabId);
                    await log('info', 'AutoSearch', `Search page loaded (tab ${searchTabId})`);
                } catch (err) {
                    await log('error', 'AutoSearch', `Search page failed: ${err.message}`, { stack: err.stack, url: searchUrl });
                    results.push({ query, links: [], error: `Search page failed: ${err.message}` });
                    continue;
                }

                // Minimal tick for SERP JS to initialize
                await delay(50);
                if (cancelRequested) break;

                // ── Step 2: Parse SERP results ──
                links = [];
                try {
                    const tabState = await safeGetTab(searchTabId);
                    await log('debug', 'SERPParser', `Tab state: status=${tabState?.status}, url=${tabState?.url}`);

                    // ── CAPTCHA Check ──
                    const captchaCheck = await detectCaptcha(searchTabId);
                    if (captchaCheck.isCaptcha) {
                        await log('warn', 'AutoSearch', `⚠️ CAPTCHA detected (${captchaCheck.type})! Pausing for user input...`);

                        // Set status to 'captcha_required' to notify popup
                        await chrome.storage.local.set({
                            autoSearch: {
                                status: 'captcha_required',
                                captchaType: captchaCheck.type,
                                currentQuery: i + 1,
                                totalQueries: totalQueries,
                                queryText: query
                            }
                        });

                        // Wait for user to solve and resume
                        await waitForCaptchaResolution(searchTabId);

                        if (cancelRequested) {
                            await log('info', 'AutoSearch', 'User cancelled during CAPTCHA.');
                            break;
                        }

                        // Resume: Update status back to running and retry this query iteration
                        await chrome.storage.local.set({
                            autoSearch: {
                                status: 'running',
                                currentQuery: i + 1,
                                totalQueries: totalQueries
                            }
                        });

                        await log('info', 'AutoSearch', 'CAPTCHA resolved. Resuming...');

                        // Re-parse the page now that it's (hopefully) the results
                        await delay(1000); // give it a sec
                    }

                    links = await parseSerpResults(searchTabId, engine, maxLinks + 10);
                    await log('info', 'SERPParser', `Raw links found: ${links.length}`, {
                        sample: links.slice(0, 3).map(l => l.url)
                    });
                } catch (parseErr) {
                    await log('error', 'SERPParser', `Parse failed for "${query}": ${parseErr.message}`, { stack: parseErr.stack });
                    results.push({ query, links: [], error: `SERP parse failed: ${parseErr.message}` });
                    try { await chrome.tabs.remove(searchTabId); } catch { }
                    continue;
                }
            } // end else (search flow)

            // ── Step 3: Filter & Routes ──
            let validLinks = [], gapLinks = [], redditLinks = [];
            try {
                await log('debug', 'AutoSearch', 'Step 3: Filtering links...');

                if (!engineConfig) throw new Error('engineConfig is undefined');

                // Filter excluded domains + slow domains
                const excluded = [...(engineConfig.excludeDomains || [])];
                await log('debug', 'AutoSearch', `Step 3: exclusion list: ${excluded.length} items`);

                // Mark slow/login domains as GAPS + Detect Reddit
                links = links.map(link => {
                    try {
                        if (!link.url) return link;
                        const url = new URL(link.url);

                        // Check synchronous slow domains
                        const isSlow = SLOW_DOMAINS.some(d => url.hostname.includes(d));

                        if (url.hostname.includes('reddit.com') && url.pathname.includes('/comments/')) {
                            return { ...link, extractionMode: 'reddit_api' };
                        }

                        // YouTube watch/shorts → route to specialized YT extractor
                        if (isYouTubeWatch(link.url)) {
                            return { ...link, extractionMode: 'youtube' };
                        } else if (url.hostname.includes('youtube.com') || url.hostname === 'youtu.be') {
                            // Skip playlists, channels, etc. — generic extraction produces massive noise
                            return { ...link, extractionMode: 'login_required', content: null };
                        }

                        if (url.pathname.endsWith('.pdf')) {
                            return { ...link, extractionMode: 'pdf_extract' };
                        }

                        if (isSlow) {
                            return { ...link, extractionMode: 'login_required', content: null };
                        }
                        return link;
                    } catch (e) {
                        return link;
                    }
                });

                await log('debug', 'AutoSearch', 'Step 3: Map completed.');

                // Filter strict exclusions
                links = links.filter(link => {
                    try {
                        if (!link.url) return false;
                        const url = new URL(link.url);
                        const dominated = excluded.some(d => url.hostname.includes(d));
                        return !dominated;
                    } catch { return false; }
                });

                await log('debug', 'AutoSearch', `Step 3: Filter completed. Remaining: ${links.length}`);

                // Separate actionable links
                validLinks = links.filter(l => l.extractionMode !== 'login_required' && l.extractionMode !== 'reddit_api' && l.extractionMode !== 'youtube').slice(0, maxLinks);
                gapLinks = links.filter(l => l.extractionMode === 'login_required').slice(0, 5);
                redditLinks = links.filter(l => l.extractionMode === 'reddit_api');
                const youtubeLinks = links.filter(l => l.extractionMode === 'youtube').slice(0, maxLinks);

                // Re-combine for processing
                links = [...validLinks, ...gapLinks, ...redditLinks, ...youtubeLinks];

                await log('debug', 'AutoSearch', `Step 3: Re-combined links: ${links.length}`);

                if (links.length === 0) {
                    await log('warn', 'AutoSearch', `No results for: "${query}"`);
                    results.push({ query, links: [], error: 'No results found' });
                    try { await chrome.tabs.remove(searchTabId); } catch { }
                    continue;
                }
            } catch (step3Err) {
                await log('error', 'AutoSearch', `Step 3 Failed: ${step3Err.message}`, { stack: step3Err.stack });
                results.push({ query, links: [], error: `Filtering failed: ${step3Err.message}` });
                try { await chrome.tabs.remove(searchTabId); } catch { }
                continue;
            }

            // Update links intended for tab opening (filter out successes)
            // We want to open tabs for:
            // 1. Normal links
            // 2. Failed Reddit calls (tab_fallback)
            // 3. Failed PDF calls (tab_fallback)

            const linksToOpen = links.filter(l =>
                l.extractionMode !== 'login_required' &&
                l.extractionMode !== 'reddit_api_success' &&
                l.extractionMode !== 'pdf_success'
            );

            // Re-assign filtered lists for logging (reusing var names)
            redditLinks = links.filter(l => l.extractionMode === 'reddit_api_success');
            // pdfLinks is already defined in scope? No, need to check scope.
            // Actually, waiting... I see they were declared with const above in my previous edit?
            // Let's check the scope.
            // Ah, I see `gapLinks` and `redditLinks` were declared at lines 230/231.
            // And now I am redeclaring them at 255+.

            // Let's just assign them to new variables or reuse them if they are let (they are const).
            // I will rename the new ones to `finalRedditLinks`, `finalPdfLinks`, `finalGapLinks`.

            const finalRedditLinks = links.filter(l => l.extractionMode === 'reddit_api_success');
            const finalPdfLinks = links.filter(l => l.extractionMode === 'pdf_success');
            const finalGapLinks = links.filter(l => l.extractionMode === 'login_required');

            // Track accumulated gaps for UI warning
            if (finalGapLinks.length > 0) {
                loginGapCount += finalGapLinks.length;
                await updateProgress({ loginGapCount });
            }

            await log('info', 'AutoSearch', `Processing ${validLinks.length} total valid links`, {
                tabsToOpen: linksToOpen.length,
                reddit: finalRedditLinks.length,
                pdf: finalPdfLinks.length,
                gaps: finalGapLinks.length
            });

            // ── SERP overview extraction DISABLED ──
            // ContentExtractor was designed for articles, not SERPs.
            // It captures the entire Google page including nav chrome (garbage).
            // AI Mode + individual link extraction provide full coverage.

            // Close SERP tab — we have the links and SERP content now
            try { await chrome.tabs.remove(searchTabId); } catch { }

            // ── Launch AI Mode tab sequentially (starts/sends query in background) ──
            const aiPromise = aiPool ? aiPool.get(i) : null;

            // ── Cross-query URL deduplication ──
            const beforeDedup = links.length;
            links = links.filter(l => {
                if (!l.url) return false;
                if (globalSeenUrls.has(l.url)) return false;
                globalSeenUrls.add(l.url);
                return true;
            });
            if (beforeDedup !== links.length) {
                await log('info', 'AutoSearch', `Filtered ${beforeDedup - links.length} duplicate URLs (cross-query dedup)`);
            }

            // ── Step 3: Open ALL result tabs at once (truly concurrent batch) ──
            if (cancelRequested) break;

            const actionableLinks = links.filter(l =>
                l.extractionMode !== 'login_required' &&
                l.extractionMode !== 'reddit_api' &&
                l.extractionMode !== 'youtube'
            );

            const tabCreatePromises = actionableLinks.map(async (link) => {
                try {
                    const tab = await safeTabCreate({
                        windowId,
                        url: link.url,
                        active: false  // All background — never steal focus
                    });
                    await log('debug', 'AutoSearch', `Tab ${tab.id} opened: ${link.url}`);
                    return { tabId: tab.id, link };
                } catch (err) {
                    await log('error', 'AutoSearch', `Failed to create tab for ${link.url}: ${err.message}`, err);
                    return null;
                }
            });

            const openedTabResults = await Promise.all(tabCreatePromises);
            const openedTabs = openedTabResults.filter(Boolean);

            await log('info', 'AutoSearch', `Opened ${openedTabs.length} tabs concurrently — extracting as each loads...`);

            // ── Step 4+5: Poll & extract as ready (no blocking wait) ──
            const queryResults = { query, links: [] };

            // ── YouTube batch extraction: V5 FAT (Fully Automated Transcript) ──
            // Runs purely in Service Worker context, no tabs created.
            const ytLinks = links.filter(l => l.extractionMode === 'youtube');
            if (ytLinks.length > 0) {
                await log('info', 'YTExtractor', `🎬 Processing ${ytLinks.length} YouTube video(s) via SW FAT (V5)...`);

                const ytPromises = ytLinks.map(async (ytLink) => {
                    if (cancelRequested) return;
                    try {
                        let extractionUrl = ytLink.url;
                        // Add xtabs=1 to activate DNR CORS bypass in Service Worker
                        const separator = extractionUrl.includes('?') ? '&' : '?';
                        const proxyUrl = extractionUrl + separator + 'xtabs=1';

                        const ytContent = await extractYouTubeContent(proxyUrl);

                        if (ytContent && typeof ytContent === 'string' && !ytContent.includes('[Audit: FAILED')) {
                            await log('info', 'YTExtractor', `🎥 Extracted: "${ytLink.title}"`);
                            queryResults.links.push({
                                ...ytLink,
                                title: ytLink.title || 'YouTube Video',
                                content: ytContent,
                                extractionMode: 'youtube_v5'
                            });
                        } else if (ytContent && ytContent.includes('[Audit: FAILED')) {
                            // If Layer A/B failed, maybe capture metadata at least
                            await log('warn', 'YTExtractor', `⚠ No transcript for: ${ytLink.url}`);
                            queryResults.links.push({ ...ytLink, content: ytContent, extractionMode: 'youtube_v5_fail' });
                        } else {
                            await log('error', 'YTExtractor', `✗ Empty result for: ${ytLink.url}`);
                        }
                    } catch (ytErr) {
                        await log('error', 'YTExtractor', `✗ FAT Execution Failed: ${ytLink.url}: ${ytErr.message}`, ytErr);
                    }
                });

                // Wait for all YouTube extractions for this query to finish
                await Promise.allSettled(ytPromises);
            }

            // (SERP overview disabled — see above)
            const pending = new Set(openedTabs.map((_, idx) => idx));
            const tabCreatedAt = new Map(openedTabs.map((_, idx) => [idx, Date.now()]));
            const probeAttempts = new Map(); // track empty early harvest probes per tab
            const DEAD_TAB_PROBES = 2;      // skip tab after this many empty probes
            const DEAD_CONTENT_THRESHOLD = 50; // chars below this = "empty" probe
            const start = Date.now();
            let pollCount = 0;

            while (pending.size > 0 && Date.now() - start < TAB_LOAD_TIMEOUT) {
                if (cancelRequested) break;
                await delay(POLL_INTERVAL);
                pollCount++;

                for (const idx of [...pending]) {
                    const { tabId, link } = openedTabs[idx];
                    const tabAge = Date.now() - tabCreatedAt.get(idx);
                    try {
                        const tab = await chrome.tabs.get(tabId);
                        const isComplete = tab.status === 'complete';
                        const isTimedOut = tabAge > PER_TAB_TIMEOUT;
                        const canEarlyHarvest = !isComplete && tabAge > EARLY_HARVEST_DELAY;

                        // Skip if: not complete, not timed out, and not ready for early harvest
                        if (!isComplete && !isTimedOut && !canEarlyHarvest) continue;

                        // ── Early Harvest: try to extract from still-loading tab ──
                        // Skip early harvest for YouTube — must wait for full load + use YT extractor
                        if (canEarlyHarvest && !isTimedOut && !isYouTubeWatch(tab.url || link.url)) {
                            const probeTab = { id: tabId, title: tab.title || link.title || '', url: tab.url || link.url };
                            let probeContent = '';
                            try {
                                const probeResult = await extractorFn([probeTab], true, { waitForDynamicContent: false });
                                probeContent = probeResult?.[0]?.content || '';
                            } catch {
                                // Probe failed — treat as empty
                            }

                            if (probeContent.length >= MIN_CONTENT_LENGTH) {
                                // Early harvest success!
                                pending.delete(idx);
                                await updateProgress({ currentLink: openedTabs.length - pending.size });
                                await log('info', 'Extractor', `🌾 Early harvest: ${probeContent.length} chars from still-loading tab: ${link.url}`);
                                queryResults.links.push({
                                    ...link,
                                    title: probeTab.title || 'Untitled',
                                    content: probeContent,
                                    extractionMode: 'early_harvest'
                                });
                                try { await chrome.tabs.remove(tabId); } catch { }
                                continue;
                            }

                            // Track empty probes — detect dead tabs
                            if (probeContent.length < DEAD_CONTENT_THRESHOLD) {
                                const attempts = (probeAttempts.get(idx) || 0) + 1;
                                probeAttempts.set(idx, attempts);
                                if (attempts >= DEAD_TAB_PROBES) {
                                    // Dead tab — page has nothing after multiple probes
                                    pending.delete(idx);
                                    await updateProgress({ currentLink: openedTabs.length - pending.size });
                                    await log('warn', 'Extractor', `💀 Dead tab: ${link.url} — ${attempts} probes returned <${DEAD_CONTENT_THRESHOLD} chars, skipping`);
                                    queryResults.links.push({
                                        ...link,
                                        content: '',
                                        extractionMode: 'dead_tab'
                                    });
                                    try { await chrome.tabs.remove(tabId); } catch { }
                                    continue;
                                }
                            } else {
                                // Has some content but not enough — reset dead counter
                                probeAttempts.set(idx, 0);
                            }

                            continue; // don't proceed to final extraction yet
                        }

                        if (isTimedOut && !isComplete) {
                            await log('warn', 'Extractor', `⏱ Tab ${tabId} timed out after ${(tabAge / 1000).toFixed(1)}s — extracting what's available: ${link.url}`);
                        }

                        // Tab is ready (or timed out) — extract
                        pending.delete(idx);
                        await updateProgress({ currentLink: openedTabs.length - pending.size });

                        const tabObj = {
                            id: tabId,
                            title: tab.title || link.title || 'Untitled',
                            url: tab.url || link.url
                        };

                        await log('debug', 'Extractor', `[${openedTabs.length - pending.size}/${openedTabs.length}] Extracting: "${tabObj.title}"`);

                        // ── YouTube Special Extraction ──
                        if (isYouTubeWatch(tabObj.url)) {
                            try {
                                const separator = tabObj.url.includes('?') ? '&' : '?';
                                const proxyUrl = tabObj.url + separator + 'xtabs=1';
                                const ytResult = await extractYouTubeContent(proxyUrl);
                                if (ytResult && typeof ytResult === 'string') {
                                    await log('info', 'YTExtractor', `🎥 ${ytResult.length} chars from YouTube: "${tabObj.title}"`);
                                    queryResults.links.push({
                                        ...link,
                                        title: tabObj.title,
                                        content: ytResult,
                                        extractionMode: 'youtube'
                                    });
                                } else if (ytResult?.skipped) {
                                    await log('info', 'YTExtractor', `⏳ Skipped (${ytResult.reason}): "${ytResult.title}"`);
                                    queryResults.links.push({ ...link, content: '', extractionMode: 'youtube_skipped' });
                                } else {
                                    await log('warn', 'YTExtractor', `⚠ Empty result for YouTube: ${link.url}`);
                                    queryResults.links.push({ ...link, content: '', extractionMode: 'youtube_empty' });
                                }
                            } catch (ytErr) {
                                await log('error', 'YTExtractor', `✗ YouTube extraction failed: ${ytErr.message}`, ytErr);
                                queryResults.links.push({ ...link, content: '', extractionMode: 'youtube_error', error: ytErr.message });
                            }
                            // Close tab right after YouTube extraction
                            try { await chrome.tabs.remove(tabId); } catch { }
                            continue; // Skip normal extraction path
                        }

                        // ── Normal Extraction ──
                        const extracted = await extractorFn([tabObj], true, { waitForDynamicContent: false });

                        if (extracted?.length > 0 && extracted[0].content) {
                            const len = extracted[0].content.length;
                            const preview = extracted[0].content.substring(0, 120).replace(/\n/g, ' ');
                            await log('info', 'Extractor', `✓ ${len} chars from ${link.url}`, { preview });
                            queryResults.links.push({
                                ...link,
                                title: tabObj.title,
                                content: extracted[0].content,
                                extractionMode: isTimedOut ? 'timeout_harvest' : (extracted[0].extractionMode || 'intelligent')
                            });
                        } else {
                            await log('warn', 'Extractor', `⚠ Empty result for ${link.url}`);
                            queryResults.links.push({ ...link, content: '', extractionMode: 'empty' });
                        }

                        // Close tab right after extraction
                        try { await chrome.tabs.remove(tabId); } catch { }

                    } catch (err) {
                        // Tab gone or extraction failed
                        pending.delete(idx);
                        await log('error', 'Extractor', `✗ Failed: ${link.url}: ${err.message}`, err);
                        queryResults.links.push({ ...link, content: '', extractionMode: 'error', error: err.message });
                    }
                }

                if (pollCount % 6 === 0 && pending.size > 0) {
                    await log('debug', 'TabHelper', `${pending.size}/${openedTabs.length} tabs still loading...`);
                }
            }

            // Handle timed-out tabs
            if (pending.size > 0) {
                await log('warn', 'TabHelper', `${pending.size} tabs timed out — extracting what's available...`);
                for (const idx of [...pending]) {
                    const { tabId, link } = openedTabs[idx];
                    try {
                        const tabInfo = await safeGetTab(tabId);
                        if (tabInfo) {
                            const tabObj = { id: tabId, title: tabInfo.title || link.title, url: tabInfo.url || link.url };
                            const extracted = await extractorFn([tabObj], true, { waitForDynamicContent: false });
                            if (extracted?.length > 0 && extracted[0].content) {
                                queryResults.links.push({ ...link, title: tabObj.title, content: extracted[0].content, extractionMode: 'timeout_partial' });
                            } else {
                                queryResults.links.push({ ...link, content: '', extractionMode: 'timeout_empty' });
                            }
                        } else {
                            queryResults.links.push({ ...link, content: '', extractionMode: 'tab_gone' });
                        }
                    } catch (err) {
                        queryResults.links.push({ ...link, content: '', extractionMode: 'timeout_error', error: err.message });
                    }
                    try { await chrome.tabs.remove(tabId); } catch { }
                }
            }

            if (aiPromise) await aiPromise;

            results.push(queryResults);
            const withContent = queryResults.links.filter(l => l.content).length;
            await log('info', 'AutoSearch', `Query "${query}" done: ${withContent}/${queryResults.links.length} with content`);
        }

        // ── Step 7: Compile & Download ──
        if (aiPool) {
            await aiPool.done;
            for (let index = 0; index < queries.length; index++) {
                const response = await aiPool.get(index);
                if (response?.error && !aiOverviews.some(item => item.queryIndex === index)) {
                    aiOverviews.push({ ...response, query: queries[index], queryIndex: index, engine });
                }
            }
        }

        if (cancelRequested) {
            await log('info', 'AutoSearch', 'Search was cancelled by user.');
            await updateProgress({ status: 'cancelled' });
        }

        const totalLinks = results.reduce((a, r) => a + (r.links?.length || 0), 0);
        if (!cancelRequested && (totalLinks > 0 || aiOverviews.length > 0)) {
            const content = compileSearchXml(results.map(result => ({
                ...result, links: (result.links || []).map(link => ({
                    ...link, content: link.content ? cleanExtractedContent(link.content) : ''
                }))
            })), aiOverviews, {
                jobId: config.jobId,
                instructions: generatePrompt ? generateAnalysisPrompt(results) : ''
            });

            // Store full content for popup copy button
            if (generatePrompt) {
                await chrome.storage.local.set({ lastAnalysisPrompt: content });
            }

            // MCP storage failure must not prevent the existing download flow.
            try {
                await chrome.storage.local.set({ lastSearchResult: {
                    content, jobId: config.jobId, capturedAt: new Date().toISOString(),
                    format: 'xml'
                } });
            } catch (storageError) {
                await chrome.storage.local.remove('lastSearchResult');
                await log('warn', 'MCP', `Result could not be kept for MCP: ${storageError.message}`);
            }

            const ext = 'txt';
            const filename = `AutoSearch_${new Date().toISOString().slice(0, 10)}_${Date.now()}.${ext}`;

            // Use data URL for download (works in MV3 service workers)
            const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);

            await log('info', 'AutoSearch', `Saving: ${filename} (${content.length} chars, ${totalLinks} links)`);

            try {
                await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
                await log('info', 'AutoSearch', 'Download triggered successfully.');
            } catch (dlErr) {
                await log('error', 'AutoSearch', `Download failed: ${dlErr.message}`, { stack: dlErr.stack });
            }
        } else {
            await log('warn', 'AutoSearch', 'No content extracted — nothing to save.');
        }

        // ... (rest of function body) ...

    } catch (fatalErr) {
        hasFatalError = true;
        await log('error', 'AutoSearch', `FATAL: ${fatalErr.message}`, { stack: fatalErr.stack });
        await updateProgress({ status: 'error', errors: [fatalErr.message] });
        await updateBadge('!');
    } finally {
        chrome.windows.onRemoved.removeListener(onWindowRemoved);

        if (aiPool) aiPool.stop();
        await Promise.allSettled([...aiSessions].map(session => session.close()));
        if (aiPool) await aiPool.done;

        // Close window if still open
        if (!windowClosed && windowId) {
            try { await chrome.windows.remove(windowId); } catch { }
        }

        let finalStatus = 'completed';
        if (cancelRequested) finalStatus = 'cancelled';
        if (hasFatalError) finalStatus = 'error';

        // Only update if not already set to error by catch block (to preserve error details)
        // But we need to ensure "completed" creates the end log.

        if (finalStatus !== 'error') {
            await updateProgress({ status: finalStatus });
        }

        const badgeText = hasFatalError ? '!' : (cancelRequested ? '✕' : '✓');
        await updateBadge(badgeText);

        delay(5000).then(() => updateBadge('')).catch(() => { });
        await log('info', 'AutoSearch', `══ SESSION END (${finalStatus}) ══`);
    }
}


// ═══════════════════════════════════════════════
// Tab Helpers
// ═══════════════════════════════════════════════

/**
 * Poll a single tab until it reaches 'complete' status.
 * Active chrome.tabs.get() calls keep the MV3 service worker alive.
 */
async function waitForTab(tabId) {
    const start = Date.now();
    let pollCount = 0;

    while (Date.now() - start < TAB_LOAD_TIMEOUT) {
        if (cancelRequested) return;
        await delay(POLL_INTERVAL);
        pollCount++;

        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab.status === 'complete') {
                await log('debug', 'TabHelper', `Tab ${tabId} loaded in ${Date.now() - start}ms (${pollCount} polls)`);
                return;
            }
            if (pollCount % 6 === 0) {
                await log('debug', 'TabHelper', `Tab ${tabId} still loading... poll #${pollCount}, status=${tab.status}`);
            }
        } catch (err) {
            throw new Error(`Tab ${tabId} disappeared: ${err.message}`);
        }
    }

    await log('warn', 'TabHelper', `Tab ${tabId} timed out after ${TAB_LOAD_TIMEOUT}ms`);
}

/**
 * Wait for multiple tabs to all reach 'complete' (polls in parallel).
 */
async function waitForMultipleTabs(tabIds) {
    const pending = new Set(tabIds);
    const start = Date.now();
    let pollCount = 0;

    while (pending.size > 0 && Date.now() - start < TAB_LOAD_TIMEOUT) {
        if (cancelRequested) return;
        await delay(POLL_INTERVAL);
        pollCount++;

        for (const tabId of [...pending]) {
            try {
                const tab = await chrome.tabs.get(tabId);
                if (tab.status === 'complete') {
                    pending.delete(tabId);
                }
            } catch {
                pending.delete(tabId); // tab gone — skip it
            }
        }

        if (pollCount % 6 === 0 && pending.size > 0) {
            await log('debug', 'TabHelper', `${pending.size}/${tabIds.length} tabs still loading (poll #${pollCount})`);
        }
    }

    if (pending.size > 0) {
        await log('warn', 'TabHelper', `${pending.size} tabs timed out after ${TAB_LOAD_TIMEOUT}ms`, {
            timedOutIds: [...pending]
        });
    } else {
        await log('info', 'TabHelper', `All ${tabIds.length} tabs loaded in ${Date.now() - start}ms`);
    }
}

/** Simple delay */
function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/** Safely get tab info — returns null if tab no longer exists. */
async function safeGetTab(tabId) {
    try { return await chrome.tabs.get(tabId); }
    catch { return null; }
}

/**
 * Creates a tab with automatic retry for transient "Tabs cannot be edited" errors.
 * Chrome throws this when the user is dragging tabs or the browser is busy.
 * @param {object} createProps - Properties for chrome.tabs.create()
 * @param {number} maxRetries  - Maximum retry attempts (default: 3)
 * @returns {Promise<chrome.tabs.Tab>}
 */
async function safeTabCreate(createProps, maxRetries = 3) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await chrome.tabs.create(createProps);
        } catch (err) {
            const isTransient = err.message && err.message.includes('Tabs cannot be edited');
            if (isTransient && attempt < maxRetries) {
                await delay(300 * (attempt + 1)); // 300ms, 600ms, 900ms backoff
                continue;
            }
            throw err; // Re-throw if not transient or out of retries
        }
    }
}

// ═══════════════════════════════════════════════
// AI Mode — Parallel Extraction
// ═══════════════════════════════════════════════

/**
 * Runs one independent AI query in its own tab.
 * Closes only its owned tab after output extraction.
 */
class IndependentAiQuery {
    constructor(windowId, engine) {
        this.windowId = windowId;
        this.engine = engine;
        this.tabId = null;
        this.closed = false;
    }

    async processQuery(query) {
        if (cancelRequested || this.closed) return null;
        const engineConfig = ENGINES[this.engine];
        if (!engineConfig?.buildAiUrl) return null;
        const tab = await safeTabCreate({ windowId: this.windowId, url: engineConfig.buildAiUrl(query), active: false });
        this.tabId = tab.id;
        if (cancelRequested || this.closed) { await this.close(); return null; }
        await waitForTab(this.tabId);
        if (cancelRequested || this.closed) return null;
        const response = await chrome.scripting.executeScript({
            target: { tabId: this.tabId },
            func: waitForAiCompletionInjected,
            args: [60000, '', true, 150]
        });
        const extracted = response?.[0]?.result;
        if (cancelRequested || !extracted?.content) return null;
        return {
            hasAiOverview: true, content: extracted.content,
            citations: extracted.citations || [], isTimeout: extracted.isTimeout,
            strategy: 'independent_ai_tab'
        };
    }

    async close() {
        this.closed = true;
        if (this.tabId !== null) {
            const id = this.tabId;
            this.tabId = null;
            try { await chrome.tabs.remove(id); } catch {}
        }
    }
}

/** Wait for a single independent AI response; timed-out content remains explicitly partial. */
async function waitForAiCompletionInjected(timeoutMs, previousContent, isNewTab, minContentLen) {
    return new Promise((resolve) => {
        let timeoutId;

        // --- Include extract logic inline for the isolated world ---
        function doExtract() {
            try {
                function querySelectorAllShadows(selector, rootNode = document) {
                    let results = Array.from(rootNode.querySelectorAll(selector));
                    const all = rootNode.querySelectorAll('*');
                    for (const item of all) {
                        if (item.shadowRoot) {
                            results = results.concat(querySelectorAllShadows(selector, item.shadowRoot));
                        }
                    }
                    return results;
                }

                function extractCitations() {
                    const aiSelectors = [
                        'div[jsname="N6jJud"]', 'div[data-sgrd]', 'div.kp-blk.c2xzTb', 'div.g-blk.mod',
                        'div[data-async-type="editableDirectAnswer"]', 'div.wDYxhc[data-md]', 'div.UDZeY',
                        'div.LLtSOc', 'div.XbIp4e', '.answer-text', '.response-text', '.chat-answer',
                        '.conversation-response', '.llm-response', '.answer-content', '[data-type="answer"]',
                        '[data-type="response"]', 'article', 'main .answer'
                    ];
                    const socialDomains = ['facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com', 'youtube.com', 'youtu.be', 'tiktok.com'];
                    const citations = [];
                    const seen = new Set();
                    for (const sel of aiSelectors) {
                        const containers = querySelectorAllShadows(sel, document);
                        for (const container of containers) {
                            const anchors = querySelectorAllShadows('a', container);
                            for (const a of anchors) {
                                try {
                                    const href = a.href;
                                    if (!href) continue;
                                    const url = new URL(href);
                                    if (!url.protocol.startsWith('http')) continue;
                                    if (url.hostname.includes('google.com') || url.hostname.includes('gstatic.com') || url.hostname.includes('googleapis.com')) continue;
                                    if (socialDomains.some(d => url.hostname.includes(d))) continue;
                                    const label = (a.innerText || a.textContent || '').trim().replace(/\s+/g, ' ');
                                    if (!seen.has(href)) { seen.add(href); citations.push({ label: label || url.hostname, url: href }); }
                                } catch (e) {}
                            }
                        }
                    }
                    return citations;
                }

                const answerSelectors = ['div[jsname="N6jJud"]', 'div[data-sgrd]', '.answer-text', '.response-text', '.chat-answer', '.conversation-response', '.llm-response', '.answer-content', '[data-type="answer"]', '[data-type="response"]'];
                const answers = answerSelectors.flatMap(selector => querySelectorAllShadows(selector))
                    .map(node => node.innerText || '').filter(Boolean);
                let text = answers.sort((left, right) => right.length - left.length)[0] || '';
                if (!text || text.length < 50) return null;
                text = text.replace(/\t/g, ' ').replace(/[ ]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

                const uiPatterns = [
                    /^Links de acessibilidade.*$/gm, /^Ir para o conteúdo principal.*$/gm, /^Ajuda sobre acessibilidade.*$/gm,
                    /^Feedback de acessibilidade.*$/gm, /^Filtros e temas.*$/gm, /^Navegação nas páginas.*$/gm, /^Links do rodapé.*$/gm,
                    /^Os resultados são personalizados.*$/gm, /^Modo IA\s*$/gm, /^Tudo\s*$/gm, /^Notícias\s*$/gm, /^Vídeos\s*$/gm,
                    /^Imagens\s*$/gm, /^Shopping\s*$/gm, /^Mais\s*$/gm, /^Ferramentas\s*$/gm, /^Vídeos curtos\s*$/gm,
                    /^Resultados da pesquisa\s*$/gm, /^Pesquisa Google.*$/gm, /^Pergunte o que quiser.*$/gm, /^Pergunte sobre.*$/gm,
                    /^Accessibility links.*$/gm, /^Skip to main content.*$/gm,
                    /Excluir esta pesquisa.*?Cancelar/gs, /Não será possível voltar.*?Excluir tudo/gs, /Gerenciar links públicos/g,
                    /Nenhum histórico do Modo IA/g, /Meu histórico da Pesquisa Google/g, /Histórico do Modo IA/g, /Iniciar uma nova conversa/g,
                    /^Brasil\s*$/gm, /^São Fidélis.*Atualizar local\s*$/gm, /^AjudaEnviar feedback.*$/gm, /^PrivacidadeTermos\s*$/gm,
                    /^Concluído\s*$/gm, /^Respondendo\s*$/gm, /^Parar\s*$/gm, /^Copiar\s*$/gm, /^Tentar novamente\s*$/gm,
                    /^Resposta correta\s*$/gm, /^Resposta errada\s*$/gm, /^Boa resposta\s*$/gm, /^Resposta ruim\s*$/gm, /^Mostrar tudo\s*$/gm,
                    /^\d+\s+sites?\s*$/gm
                ];
                for (const pattern of uiPatterns) {
                    text = text.replace(pattern, '');
                }

                const activeDomSelectors = [
                    'button[aria-label*="Parar"]', 'button[aria-label*="Stop"]', 'button[aria-label*="Cancelar"]',
                    '[aria-busy="true"]', '.streaming', '[data-streaming="true"]', '.loading-spinner', '.typing-indicator'
                ];
                let hasActiveDomIndicator = false;
                for (const sel of activeDomSelectors) {
                    const els = querySelectorAllShadows(sel, document);
                    if (els.some(el => { try { return el.offsetParent !== null || el.clientHeight > 0; } catch { return false; } })) {
                        hasActiveDomIndicator = true;
                        break;
                    }
                }

                const isGeneratingText = /(respondendo\.\.\.|gerando\.\.\.|generating\.\.\.|creating\.\.\.|pensando\.\.\.|thinking\.\.\.)/i.test(text);
                const isGenerating = hasActiveDomIndicator || isGeneratingText;

                text = text.replace(/\n{3,}/g, '\n\n').trim();
                if (text.length < 100) return null;

                return { content: text, citations: extractCitations(), isGenerating: isGenerating };
            } catch (err) { return null; }
        }
        // --- End inline extract logic ---

        let isDone = false;
        let lastExtractedContent = '';
        let stableSince = 0;
        let quietTimer = null;
        let debounceTimer = null;
        
        function finalize(reason, extracted) {
            if (isDone) return;
            isDone = true;
            if (timeoutId) clearTimeout(timeoutId);
            if (quietTimer) clearTimeout(quietTimer);
            if (debounceTimer) clearTimeout(debounceTimer);
            if (window._aiMutationObserver) {
                window._aiMutationObserver.disconnect();
                window._aiMutationObserver = null;
            }
            resolve({
                content: extracted?.content || lastExtractedContent || '',
                citations: extracted?.citations || [],
                isTimeout: reason === 'timeout'
            });
        }

        function checkState() {
            if (isDone) return;
            const extracted = doExtract();
            if (!extracted) return;
            
            if (lastExtractedContent !== extracted.content || extracted.isGenerating) stableSince = Date.now();
            lastExtractedContent = extracted.content;

            // Must have minimum content
            if (extracted.content.length < minContentLen) return;

            // For follow-ups, ensure we have new content before we declare it done
            if (!isNewTab) {
                const prevLen = previousContent ? previousContent.length : 0;
                if (extracted.content.length <= prevLen + 30) {
                    return; // AI hasn't meaningfully appended the new answer yet
                }
            }

            // Require generation to stop and text to remain stable before accepting it
            if (!extracted.isGenerating) {
                if (Date.now() - stableSince >= 1500) {
                    finalize('complete', extracted);
                } else {
                    if (quietTimer) clearTimeout(quietTimer);
                    quietTimer = setTimeout(checkState, 1500);
                }
            }
        }

        // 1. Initial check (in case it finished instantly)
        checkState();
        if (isDone) return;

        // 2. Setup MutationObserver for exact zero-delay updates
        // To avoid freezing the tab, we debounce DOM checks slightly.
        let lastCheck = 0;
        let pendingCheck = false;
        
        window._aiMutationObserver = new MutationObserver(() => {
            if (isDone) return;
            
            const now = Date.now();
            if (now - lastCheck > 250) {
                lastCheck = now;
                checkState();
            } else if (!pendingCheck) {
                pendingCheck = true;
                // Fallback to queue a check. In a background tab, setTimeout might take 1000ms. 
                // That's fine as a fallback to catch the final state.
                debounceTimer = setTimeout(() => {
                    pendingCheck = false;
                    lastCheck = Date.now();
                    checkState();
                }, 250);
            }
        });

        window._aiMutationObserver.observe(document.body, { 
            childList: true, 
            subtree: true, 
            characterData: true, 
            attributes: true 
        });

        // 3. Timeout fallback
        timeoutId = setTimeout(() => {
            finalize('timeout', doExtract());
        }, timeoutMs);
    });
}

/** Inject SERP parser and return parsed links. */
async function parseSerpResults(tabId, engine, maxLinks) {
    try {
        // ── YouTube: Use MAIN world to read ytInitialData (DOM doesn't render in background tabs) ──
        if (engine === 'youtube') {
            return await parseYouTubeSerp(tabId, maxLinks);
        }

        // ── Other engines: Use ISOLATED world file injection ──
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            files: ['src/content/serp-parser.js']
        });

        if (results?.[0]?.result) {
            const links = results[0].result;
            await log('debug', 'SERPParser', `Parser returned ${links.length} links from tab ${tabId}`);
            return links.slice(0, maxLinks);
        }

        await log('warn', 'SERPParser', `Parser returned no results for tab ${tabId}`, {
            raw: JSON.stringify(results).substring(0, 300)
        });
        return [];
    } catch (e) {
        await log('error', 'SERPParser', `Injection failed on tab ${tabId}: ${e.message}`, { stack: e.stack });
        return [];
    }
}

/**
 * YouTube-specific SERP parser.
 * Runs in MAIN world to access window.ytInitialData, which contains
 * search results even in background tabs where custom elements don't render.
 */
async function parseYouTubeSerp(tabId, maxLinks) {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
                const links = [];
                try {
                    let yt = window.ytInitialData;

                    // Fallback: parse from page HTML if window object is unavailable
                    if (!yt) {
                        const scripts = document.querySelectorAll('script');
                        for (const script of scripts) {
                            const txt = script.textContent || '';
                            const m = txt.match(/var\s+ytInitialData\s*=\s*({[\s\S]*?})\s*;/);
                            if (m) {
                                try { yt = JSON.parse(m[1]); } catch { }
                                if (yt) break;
                            }
                        }
                    }

                    if (!yt) return { links: [], debug: 'ytInitialData not found' };

                    // Navigate the search results structure
                    const sections = yt?.contents?.twoColumnSearchResultsRenderer
                        ?.primaryContents?.sectionListRenderer?.contents || [];

                    for (const section of sections) {
                        const items = section?.itemSectionRenderer?.contents || [];
                        for (const item of items) {
                            // Standard video results
                            const vr = item.videoRenderer;
                            if (vr && vr.videoId) {
                                const title = vr.title?.runs?.map(r => r.text).join('') || vr.title?.simpleText || '';
                                if (title) {
                                    links.push({
                                        title: title.trim(),
                                        url: `https://www.youtube.com/watch?v=${vr.videoId}`
                                    });
                                }
                                continue;
                            }

                            // Shorts shelf (reel items)
                            const shelf = item.reelShelfRenderer;
                            if (shelf?.items) {
                                for (const reel of shelf.items) {
                                    const ri = reel.reelItemRenderer;
                                    if (ri?.videoId) {
                                        const title = ri.headline?.simpleText || '';
                                        links.push({
                                            title: title.trim() || 'Short',
                                            url: `https://www.youtube.com/shorts/${ri.videoId}`
                                        });
                                    }
                                }
                            }
                        }
                    }

                    return {
                        links,
                        debug: `ytInitialData parsed: ${links.length} results from ${sections.length} sections`
                    };
                } catch (e) {
                    return { links: [], debug: `Exception: ${e.message}` };
                }
            }
        });

        const data = results?.[0]?.result;
        if (data) {
            await log('debug', 'SERPParser', `YouTube MAIN world: ${data.debug}`);
            if (data.links && data.links.length > 0) {
                await log('debug', 'SERPParser', `YouTube parser returned ${data.links.length} links from tab ${tabId}`);
                return data.links.slice(0, maxLinks);
            }
        }

        // Fallback: try the standard file-based parser (might work if tab was somehow rendered)
        await log('warn', 'SERPParser', `YouTube MAIN world returned 0 links, trying DOM fallback...`);
        const fallback = await chrome.scripting.executeScript({
            target: { tabId },
            files: ['src/content/serp-parser.js']
        });
        if (fallback?.[0]?.result) {
            const links = fallback[0].result;
            await log('debug', 'SERPParser', `YouTube DOM fallback: ${links.length} links`);
            return links.slice(0, maxLinks);
        }

        await log('warn', 'SERPParser', `YouTube parser returned no results for tab ${tabId}`);
        return [];
    } catch (e) {
        await log('error', 'SERPParser', `YouTube parse failed on tab ${tabId}: ${e.message}`, { stack: e.stack });
        return [];
    }
}


// ═══════════════════════════════════════════════
// Content Compilers
// ═══════════════════════════════════════════════

async function extractRedditContent(url) {
    try {
        // Append .json to get data
        const jsonUrl = url.split('?')[0] + '.json';
        const response = await fetch(jsonUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (!Array.isArray(data) || data.length < 2) return null;

        const originalPost = data[0]?.data?.children?.[0]?.data;
        const comments = data[1]?.data?.children;

        let text = `TITLE: ${originalPost.title}\n`;
        text += `SUBREDDIT: r/${originalPost.subreddit}\n`;
        text += `AUTHOR: u/${originalPost.author}\n`;
        text += `DATE: ${new Date(originalPost.created_utc * 1000).toISOString()}\n`;
        text += `${'-'.repeat(40)}\n`;
        text += `${originalPost.selftext || '(Link Post)'}\n`;
        text += `${'='.repeat(40)}\n\nCOMMENTS:\n`;

        text += flattenComments(comments);
        return text;
    } catch (e) {
        log('warn', 'RedditExtractor', `Failed to fetch JSON for ${url}: ${e.message}`);
        return null;
    }
}

function flattenComments(children, depth = 0) {
    let text = '';
    if (!children) return text;

    children.forEach(child => {
        const c = child.data;
        if (!c.body) return;

        const indent = '  '.repeat(depth);
        text += `${indent}u/${c.author} (${c.score} pts): ${c.body}\n`;

        if (c.replies && c.replies.data && c.replies.data.children) {
            text += flattenComments(c.replies.data.children, depth + 1);
        }
    });
    return text;
}

// ═══════════════════════════════════════════════
// CAPTCHA Detection
// ═══════════════════════════════════════════════

/**
 * Detects if the tab is showing a CAPTCHA/human verification page.
 * Inject script to analyze title and content.
 */
async function detectCaptcha(tabId) {
    try {
        const result = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                const title = document.title.toLowerCase();
                const text = document.body.innerText.trim();
                const hasLittleText = text.length < 200;

                const isBraveCaptcha = title.includes('brave') && (title.includes('verify') || title.includes('human'));
                const isGoogleCaptcha = title.includes('google') && (title.includes('recaptcha') || title.includes('unusual traffic'));
                const isGenericCaptcha =
                    title.includes('verify you are human') ||
                    title.includes('security check') ||
                    title.includes('just a moment');

                const hasCaptchaFrames = document.querySelectorAll('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"]').length > 0;

                return {
                    isCaptcha: isBraveCaptcha || isGoogleCaptcha || (isGenericCaptcha && hasLittleText) || (hasLittleText && hasCaptchaFrames),
                    type: isBraveCaptcha ? 'Brave' : (isGoogleCaptcha ? 'Google' : 'Unknown')
                };
            }
        });
        return result[0]?.result || { isCaptcha: false };
    } catch (e) {
        return { isCaptcha: false };
    }
}

/**
 * Pauses execution until user resolves CAPTCHA or cancels.
 */
async function waitForCaptchaResolution(tabId) {
    let resolved = false;

    // Poll for resolution
    while (!resolved && !cancelRequested) {
        // Check if cancelled via manual action / storage
        const stored = await getStoredStatus();
        if (!stored || stored.status === 'cancelled') {
            cancelRequested = true;
            return;
        }

        // Check if user clicked "Resume" in popup (status changed back to running)
        if (stored.status === 'running') {
            resolved = true;
            return;
        }

        // Also check if page is no longer a captcha (user solved it)
        const check = await detectCaptcha(tabId);
        if (!check.isCaptcha) {
            // Auto-resume if CAPTCHA is gone
            resolved = true;
            return;
        }

        await delay(2000);
    }
}


// ═══════════════════════════════════════════════
// Blind Spot Detector — Analysis Prompt Generator
// ═══════════════════════════════════════════════

/**
 * Generate a structured analysis prompt for Gemini/ChatGPT.
 * Written in ENGLISH for maximum AI performance.
 * Instructs AI to respond in the user's language (detected from queries).
 * Explicitly tells AI to use Google Search to verify and fill gaps.
 */
function generateAnalysisPrompt(results) {
    const totalSources = results.reduce((a, r) => a + r.links.length, 0);
    const withContent = results.reduce((a, r) => a + r.links.filter(l => l.content).length, 0);
    const queries = results.map(r => r.query);

    const queryText = queries.join(' ').toLowerCase();
    const ptWords = ['como', 'sobre', 'dados', 'impacto', 'análise', 'setor', 'mercado', 'reforma', 'brasileiro', 'brasil'];
    const isPtBr = ptWords.some(w => queryText.includes(w));
    const userLang = isPtBr ? 'pt-BR' : 'the language of the queries';

    let p = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    p += `🎯 TABSCRIBE BLIND SPOT DETECTOR\n`;
    p += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    p += `📊 Data: ${withContent}/${totalSources} sources extracted from: ${queries.join(', ')}\n\n`;

    const gaps = [];
    results.forEach(res => {
        res.links.forEach(l => {
            if (l.extractionMode === 'login_required') gaps.push(`- 🔒 Login Required: ${l.url}`);
            if (l.extractionMode === 'paywall_partial') gaps.push(`- 💰 Paywall (Partial): ${l.url}`);
        });
    });

    if (gaps.length > 0) {
        p += `⚠️ INACCESSIBLE SOURCES (Search the web for these manually!):\n${gaps.join('\n')}\n\n`;
    }

    p += `USER CONTEXT:\n`;
    p += `> [WRITE YOUR OBJECTIVE HERE: What are you trying to analyze? What is your angle?]\n\n`;

    p += `🤖 AI INSTRUCTIONS:\n`;
    p += `Act as a Senior Information Analyst. You MUST use WEB SEARCH (Grounding) to VERIFY facts and FILL GAPS in the texts below. RESPOND IN: ${userLang}.\n\n`;

    p += `📝 TASK (Respond in 4 concise sections):\n\n`;

    p += `1️⃣ 🔴 BLIND SPOTS\n`;
    p += `- What would the general public, experts, or skeptics ask that is missing here?\n`;
    p += `- ACTION: List missing info and TRY TO ANSWER IT actively using web search.\n\n`;

    p += `2️⃣ 🟡 CONTRADICTIONS\n`;
    p += `- Do sources disagree on numbers, facts, or conclusions?\n`;
    p += `- ACTION: Point out the divergence and state which side is more reliable (search to verify).\n\n`;

    p += `3️⃣ 🟠 CONFIDENCE INDEX\n`;
    p += `- Create a Markdown table: | Main Claim | Sources Cited | Confidence (⭐ to ⭐⭐⭐⭐⭐) | Verified via Web? |\n\n`;

    p += `4️⃣ 🟢 PROMPTS FOR TABSCRIBE (AI OVERVIEW)\n`;
    p += `- Generate the EXACT number of new prompts (one per line) needed to investigate the blind spots.\n`;
    p += `- These must be complex, complete, and intelligent prompts (not simple keywords) designed for Google AI Overview.\n`;
    p += `- Since they will be executed IN SEQUENCE in the SAME CHAT, write them as a conversational thread where subsequent prompts build on the preceding context.\n`;
    p += `- Prompts can be long or short depending on the depth required.\n`;
    p += `- CRITICAL FORMATTING RULES:\n`;
    p += `  1. Do NOT use brackets [].\n`;
    p += `  2. Do NOT use numbering (1., 2.).\n`;
    p += `  3. Do NOT use bullet points or markdown (- , *, \`\`\`).\n`;
    p += `  4. Do NOT add the @TABSCRIBE tag.\n`;
    p += `  5. Return ONLY THE RAW PROMPTS ready to copy and paste.\n\n`;

    p += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    return p;
}


// ═══════════════════════════════════════════════
// State Helpers
// ═══════════════════════════════════════════════

let progressQueue = Promise.resolve();
function updateProgress(stateUpdate) {
    const update = progressQueue.then(async () => {
        const current = await getStoredStatus();
        await chrome.storage.local.set({ autoSearch: { ...current, ...stateUpdate } });
    });
    progressQueue = update.catch(() => {});
    return update;
}

async function getStoredStatus() {
    const data = await chrome.storage.local.get('autoSearch');
    return data.autoSearch || {};
}

function updateBadge(text) {
    return chrome.action.setBadgeText({ text });
}

export { updateProgress, getStoredStatus };
