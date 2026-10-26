/**
 * AI Overview Extractor — Content Script
 * 
 * Injected into Google / Brave search result pages to extract
 * AI-generated overview / summary content.
 * 
 * Supports TWO page types:
 *   1. Normal SERP — tries to find embedded AI Overview
 *   2. AI Mode page — Google (udm=50) / Brave (/ask) dedicated AI pages
 * 
 * Uses a Multi-Layer Strategy with content quality validation
 * to avoid capturing UI chrome (buttons, menus, settings).
 * 
 * Returns: { hasAiOverview, content, engine, strategy }
 */

(function () {
    const host = window.location.hostname;
    const url = window.location.href;
    const isGoogle = host.includes('google');
    const isBrave = host.includes('brave') || host.includes('search.brave');

    const engine = isGoogle ? 'google' : (isBrave ? 'brave' : 'unknown');

    // Detect if this is a dedicated AI Mode page
    const isGoogleAiMode = isGoogle && (url.includes('udm=50') || url.includes('udm%3D50'));
    const isBraveAiMode = isBrave && (host.includes('search.brave') && url.includes('/ask'));

    /**
     * Main extraction function
     */
    function extract() {
        console.log(`[TabScribe AI] Starting extraction — engine: ${engine}, aiMode: ${isGoogleAiMode || isBraveAiMode}`);

        let result = null;

        // AI Mode pages have dedicated extraction strategies
        if (isGoogleAiMode) {
            result = extractGoogleAiMode();
        } else if (isBraveAiMode) {
            result = extractBraveAiMode();
        }

        // Normal SERP strategies (also used as fallback for AI Mode)
        if (!result && isGoogle) {
            result = extractGoogle();
        } else if (!result && isBrave) {
            result = extractBrave();
        }

        // Validate content quality before returning
        if (result && result.content) {
            const cleaned = cleanText(result.content);
            if (isQualityContent(cleaned)) {
                console.log(`[TabScribe AI] ✅ AI content found (${cleaned.length} chars, strategy: ${result.strategy})`);
                return {
                    hasAiOverview: true,
                    content: cleaned,
                    engine,
                    strategy: result.strategy
                };
            } else {
                console.log(`[TabScribe AI] ⚠️ Content found but failed quality check (${cleaned.length} chars, strategy: ${result.strategy})`);
            }
        }

        console.log(`[TabScribe AI] ❌ No AI content found for ${engine}`);
        return { hasAiOverview: false, content: '', engine, strategy: 'none' };
    }


    // ═══════════════════════════════════════════════
    // Content Quality Validation
    // ═══════════════════════════════════════════════

    /**
     * Validates that extracted text is actual AI-generated content,
     * not Google/Brave UI chrome (buttons, menus, settings).
     */
    function isQualityContent(text) {
        if (!text || text.length < 150) return false;

        // ── Reject if it looks like UI chrome ──
        const uiPatterns = [
            /excluir esta pesquisa/i,
            /cancelar.*histórico/i,
            /gerenciar links/i,
            /nenhum histórico/i,
            /iniciar uma nova conversa/i,
            /não será possível voltar/i,
            /excluir tudo/i,
            /meu histórico da pesquisa/i,
            /links de acessibilidade/i,
            /ir para o conteúdo principal/i,
            /feedback de acessibilidade/i,
            /filtros e temas/i,
            /modo ia.*tudo.*notícias/i,
            /sign in|fazer login|entrar/i,
            /delete this search/i,
            /manage your links/i,
            /search history/i,
        ];

        const uiMatchCount = uiPatterns.reduce((c, p) => c + (p.test(text) ? 1 : 0), 0);
        if (uiMatchCount >= 2) {
            console.log(`[TabScribe AI] Rejected: ${uiMatchCount} UI patterns matched`);
            return false;
        }

        // ── Check for content density: real AI text has long sentences ──
        const sentences = text.split(/[.!?।。]+/).filter(s => s.trim().length > 20);
        if (sentences.length < 2) {
            // Very few long sentences — likely concatenated button labels
            console.log(`[TabScribe AI] Rejected: only ${sentences.length} substantial sentences`);
            return false;
        }

        // ── Check average word count per "paragraph" ──
        const paragraphs = text.split('\n').filter(p => p.trim().length > 10);
        const avgWordsPerParagraph = paragraphs.reduce((sum, p) => sum + p.trim().split(/\s+/).length, 0) / Math.max(paragraphs.length, 1);

        if (avgWordsPerParagraph < 5) {
            console.log(`[TabScribe AI] Rejected: avg ${avgWordsPerParagraph.toFixed(1)} words/paragraph (too short)`);
            return false;
        }

        return true;
    }


    // ═══════════════════════════════════════════════
    // Google AI Mode (udm=50) — Dedicated Page
    // ═══════════════════════════════════════════════

    function extractGoogleAiMode() {
        console.log('[TabScribe AI] Extracting from Google AI Mode (udm=50)...');

        // Strategy A: AI Mode conversation container
        // Google AI Mode renders the response in specific containers
        const aiModeSelectors = [
            // Known AI Mode response containers (2025-2026)
            'div[jsname="N6jJud"]',
            'div[data-sgrd]',
            'div.wDYxhc[data-md]',
            'div.UDZeY',
            'div.LLtSOc',
            'div.XbIp4e',               // AI Mode response wrapper
            'div[data-async-type="editableDirectAnswer"]',
            'div[jscontroller] div[data-hveid] .wDYxhc',
        ];

        for (const sel of aiModeSelectors) {
            try {
                const el = document.querySelector(sel);
                if (el) {
                    const text = cleanText(el.innerText);
                    if (text.length > 150) {
                        return { content: text, strategy: `google_ai_mode_selector: ${sel}` };
                    }
                }
            } catch { /* continue */ }
        }

        // Strategy B: Find the main AI response by looking for the largest 
        // text block that is NOT navigation/search UI
        const mainContent = findLargestContentBlock({
            root: document.getElementById('rcnt') || document.getElementById('main') || document.body,
            minLength: 200,
            skipTags: ['nav', 'header', 'footer', 'aside', 'form', 'button', 'input', 'select'],
            skipPatterns: /appbar|sfooter|searchform|top_nav|logo|menu|sidebar|header|footer/i
        });

        if (mainContent) {
            return { content: mainContent, strategy: 'google_ai_mode_largest_block' };
        }

        return null;
    }


    // ═══════════════════════════════════════════════
    // Google Normal SERP — Embedded AI Overview  
    // ═══════════════════════════════════════════════

    function extractGoogle() {
        // Strategy 1: Direct AI Overview container selectors
        const s1 = googleDirectSelectors();
        if (s1) return s1;

        // Strategy 2: Heading detection ("AI Overview", "Visão geral da IA")
        const s2 = googleHeadingDetection();
        if (s2) return s2;

        // Strategy 3: Large pre-organic block
        const s3 = googlePreOrganicBlock();
        if (s3) return s3;

        // Strategy 4: data-attrid based  
        const s4 = googleDataAttrib();
        if (s4) return s4;

        return null;
    }

    function googleDirectSelectors() {
        const selectors = [
            'div[jsname="N6jJud"]',
            'div[data-sgrd]',
            'div.kp-blk.c2xzTb',
            'div.g-blk.mod',
            '#rso div[data-attrid="wa:/description"]',
            'div[data-async-type="editableDirectAnswer"]',
            'div.wDYxhc[data-md]',
            'div[jscontroller][data-hveid] div.wDYxhc',
            'div.UDZeY',
            'div.LLtSOc',
        ];

        for (const sel of selectors) {
            try {
                const el = document.querySelector(sel);
                if (el) {
                    const text = cleanText(el.innerText);
                    if (text.length > 80) {
                        return { content: text, strategy: `google_selector: ${sel}` };
                    }
                }
            } catch { /* continue */ }
        }
        return null;
    }

    function googleHeadingDetection() {
        const headingKeywords = [
            'ai overview', 'visão geral da ia', 'visão geral gerada por ia',
            'ai-generated overview', 'resumo da ia', 'resposta da ia',
        ];

        const candidates = document.querySelectorAll('h2, h3, span, div[role="heading"]');
        for (const el of candidates) {
            const text = (el.textContent || '').toLowerCase().trim();
            if (headingKeywords.some(kw => text.includes(kw))) {
                let container = el.parentElement;
                for (let i = 0; i < 5 && container; i++) {
                    const content = cleanText(container.innerText);
                    if (content.length > 150) {
                        return { content, strategy: 'google_heading_detection' };
                    }
                    container = container.parentElement;
                }
            }
        }
        return null;
    }

    function googlePreOrganicBlock() {
        const rso = document.getElementById('rso');
        if (!rso) return null;

        const children = rso.children;
        for (let i = 0; i < Math.min(3, children.length); i++) {
            const child = children[i];
            const hasCite = child.querySelector('cite');
            const hasH3Link = child.querySelector('h3 a[href]');
            if (hasCite && hasH3Link) continue;

            const text = cleanText(child.innerText);
            const linkCount = child.querySelectorAll('a[href]').length;
            if (text.length > 200 && linkCount < 15) {
                return { content: text, strategy: 'google_pre_organic_block' };
            }
        }
        return null;
    }

    function googleDataAttrib() {
        const attrSelectors = [
            '[data-attrid*="description"]',
            '[data-attrid*="answer"]',
            '[data-attrid*="overview"]',
        ];

        for (const sel of attrSelectors) {
            try {
                const els = document.querySelectorAll(sel);
                for (const el of els) {
                    const text = cleanText(el.innerText);
                    if (text.length > 100) {
                        return { content: text, strategy: `google_data_attrid: ${sel}` };
                    }
                }
            } catch { /* continue */ }
        }
        return null;
    }


    // ═══════════════════════════════════════════════
    // Brave AI Mode (/ask) — Dedicated Page
    // ═══════════════════════════════════════════════

    function extractBraveAiMode() {
        console.log('[TabScribe AI] Extracting from Brave AI Mode (/ask)...');

        // Brave /ask page has a conversation-style layout
        const conversationSelectors = [
            '.answer-text',
            '.response-text',
            '.chat-answer',
            '.conversation-response',
            '.llm-response',
            '.answer-content',
            '[data-type="answer"]',
            '[data-type="response"]',
            'article',
            'main .answer',
        ];

        for (const sel of conversationSelectors) {
            try {
                const el = document.querySelector(sel);
                if (el) {
                    const text = cleanText(el.innerText);
                    if (text.length > 150) {
                        return { content: text, strategy: `brave_ai_mode_selector: ${sel}` };
                    }
                }
            } catch { /* continue */ }
        }

        // Fallback: find the largest content block on the page
        const mainContent = findLargestContentBlock({
            root: document.querySelector('main') || document.body,
            minLength: 200,
            skipTags: ['nav', 'header', 'footer', 'aside', 'form', 'button'],
            skipPatterns: /nav|footer|header|sidebar|menu|toolbar/i
        });

        if (mainContent) {
            return { content: mainContent, strategy: 'brave_ai_mode_largest_block' };
        }

        return null;
    }


    // ═══════════════════════════════════════════════
    // Brave Normal SERP — Embedded AI Summary
    // ═══════════════════════════════════════════════

    function extractBrave() {
        // Strategy 1: Direct selectors
        const s1 = braveDirectSelectors();
        if (s1) return s1;

        // Strategy 2: Heading detection
        const s2 = braveHeadingDetection();
        if (s2) return s2;

        // Strategy 3: Pre-results block
        const s3 = bravePreResultsBlock();
        if (s3) return s3;

        return null;
    }

    function braveDirectSelectors() {
        const selectors = [
            '#ai-summary', '#ai-answer', '.ai-overview', '.ai-summary',
            '.answer-box', '.answer-module', '.llm-answer',
            '.summarizer', '.summarizer-answer',
            '[data-type="ai"]', '[data-type="summarizer"]',
        ];

        for (const sel of selectors) {
            try {
                const el = document.querySelector(sel);
                if (el) {
                    const text = cleanText(el.innerText);
                    if (text.length > 80) {
                        return { content: text, strategy: `brave_selector: ${sel}` };
                    }
                }
            } catch { /* continue */ }
        }
        return null;
    }

    function braveHeadingDetection() {
        const keywords = [
            'ai answer', 'summarizer', 'ai overview',
            'ai summary', 'resumo da ia', 'resposta da ia',
        ];

        const candidates = document.querySelectorAll('h2, h3, span, div[role="heading"], .heading');
        for (const el of candidates) {
            const text = (el.textContent || '').toLowerCase().trim();
            if (keywords.some(kw => text.includes(kw))) {
                let container = el.closest('section') || el.closest('div');
                if (!container) container = el.parentElement;
                for (let i = 0; i < 5 && container; i++) {
                    const content = cleanText(container.innerText);
                    if (content.length > 150) {
                        return { content, strategy: 'brave_heading_detection' };
                    }
                    container = container.parentElement;
                }
            }
        }
        return null;
    }

    function bravePreResultsBlock() {
        const resultsContainer = document.querySelector('#results, .results, main');
        if (!resultsContainer) return null;

        const children = resultsContainer.children;
        for (let i = 0; i < Math.min(3, children.length); i++) {
            const child = children[i];
            const text = cleanText(child.innerText);
            const linkCount = child.querySelectorAll('a[href]').length;
            if (text.length > 250 && linkCount < 10) {
                const hasOrganicMarkers = child.querySelector('.snippet, .result-url, cite');
                if (!hasOrganicMarkers) {
                    return { content: text, strategy: 'brave_pre_results_block' };
                }
            }
        }
        return null;
    }


    // ═══════════════════════════════════════════════
    // Shared Utilities
    // ═══════════════════════════════════════════════

    /**
     * Find the largest meaningful text block within a root element.
     * Skips navigation, UI chrome, and low-content elements.
     */
    function findLargestContentBlock({ root, minLength = 200, skipTags = [], skipPatterns = null }) {
        if (!root) return null;

        const skipTagsSet = new Set(skipTags.map(t => t.toUpperCase()));
        let bestText = '';
        let bestLength = 0;

        // Look at direct children and their children (2 levels deep)
        const candidates = root.querySelectorAll('div, section, article, main');

        for (const el of candidates) {
            // Skip unwanted tags
            if (skipTagsSet.has(el.tagName)) continue;

            // Skip elements matching negative patterns
            if (skipPatterns) {
                const idAndClass = (el.id || '') + ' ' + (el.className || '').toString();
                if (skipPatterns.test(idAndClass)) continue;
            }

            // Skip elements that are mostly buttons/inputs (UI chrome)
            const buttons = el.querySelectorAll('button, input, select, [role="button"]');
            if (buttons.length > 3) continue;

            const text = cleanText(el.innerText);
            if (text.length > minLength && text.length > bestLength) {
                // Verify content density
                const wordCount = text.split(/\s+/).length;
                const linkCount = el.querySelectorAll('a[href]').length;
                const linkRatio = linkCount / Math.max(wordCount / 10, 1);

                // It should be text-heavy, not link-heavy
                if (linkRatio < 3 && wordCount > 30) {
                    bestText = text;
                    bestLength = text.length;
                }
            }
        }

        return bestText || null;
    }

    /**
     * Clean text: collapse whitespace, remove excess newlines, trim
     */
    function cleanText(raw) {
        if (!raw) return '';
        return raw
            .replace(/\t/g, ' ')
            .replace(/[ ]{2,}/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }


    // ═══════════════════════════════════════════════
    // Execute and return result
    // ═══════════════════════════════════════════════

    return extract();
})();
