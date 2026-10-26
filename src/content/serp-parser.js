/**
 * SERP Parser - Content Script
 * 
 * Injected into search result pages to extract organic links.
 * Uses a Multi-Layer Strategy to ensure robustness against CSS changes.
 */

(function () {
    // Configuration passed from background or defaults
    const CONFIG = {
        // Engine can be 'google', 'scholar', or 'brave'. Defaults to auto-detect.
        engine: detectEngine(),
        maxLinks: 50  // Let the background script limit this, not the parser
    };

    /**
     * Detects the current search engine based on hostname.
     */
    function detectEngine() {
        const host = window.location.hostname;
        if (host.includes('youtube.com')) return 'youtube';
        if (host.includes('scholar.google')) return 'scholar';
        if (host.includes('google')) return 'google';
        if (host.includes('brave')) return 'brave';
        return 'unknown';
    }

    /**
     * Main execution function
     */
    function parse() {
        console.log(`[TabScribe Parser] Starting parse for engine: ${CONFIG.engine}`);

        let links = [];

        // LAYER 1: Known CSS Selectors (Fastest, most specific)
        links = tryLayer1();

        // LAYER 2: Semantic HTML (Heuristic)
        if (links.length === 0) {
            console.log("[TabScribe Parser] Layer 1 failed. Trying Layer 2 (Semantic)...");
            links = tryLayer2();
        }

        // LAYER 3: Generic Fallback (Broadest)
        if (links.length === 0) {
            console.log("[TabScribe Parser] Layer 2 failed. Trying Layer 3 (Generic)...");
            links = tryLayer3();
        }

        // Deduplicate and filter
        const uniqueLinks = deduplicateAndFilter(links);

        console.log(`[TabScribe Parser] Found ${uniqueLinks.length} unique links.`);
        return uniqueLinks;
    }

    // --- LAYERS ---

    /**
     * Layer 1: Specific, known CSS selectors for each engine.
     * Subject to breaking if classes change.
     */
    function tryLayer1() {
        const results = [];
        let elements = [];

        try {
            if (CONFIG.engine === 'google') {
                // Standard Google organic results often have an <h3> inside an <a>, or vice-versa inside a container
                // Selector 1: The standard "g" class container (very common, but changes)
                // Trying simpler structural selectors

                // Strategy: Link that contains an h3 with class LC20lb (very common titles)
                // or just link > h3
                const headings = document.querySelectorAll('#search h3');
                headings.forEach(h3 => {
                    const a = h3.closest('a');
                    if (a && a.href) results.push({ title: h3.innerText, url: a.href });
                });

            } else if (CONFIG.engine === 'scholar') {
                // Google Scholar usually uses .gs_r for results and .gs_rt for titles
                const titles = document.querySelectorAll('.gs_rt a');
                titles.forEach(a => results.push({ title: a.innerText, url: a.href }));

            } else if (CONFIG.engine === 'youtube') {
                // YouTube native search results (ytd-video-renderer)
                const titles = document.querySelectorAll('ytd-video-renderer a#video-title');
                titles.forEach(a => {
                    const titleStr = a.title || a.innerText;
                    if (titleStr && a.href) {
                        results.push({ title: titleStr.trim(), url: a.href });
                    }
                });

            } else if (CONFIG.engine === 'brave') {
                // Brave often uses .snippet-title or #results .result-header a
                // Try multiple Brave selectors
                const braveSelectors = [
                    '.snippet-title',          // Common class for titles
                    '#results .result-header a' // Structural fallback
                ];

                for (const sel of braveSelectors) {
                    const els = document.querySelectorAll(sel);
                    if (els.length > 0) {
                        els.forEach(el => {
                            // If element is 'a', take it. If it's a div/h, closest 'a'.
                            const a = el.tagName === 'A' ? el : el.closest('a');
                            if (a && a.href) results.push({ title: el.innerText, url: a.href });
                        });
                        if (results.length > 0) break;
                    }
                }
            }
        } catch (e) {
            console.warn("[TabScribe Parser] Layer 1 error:", e);
        }
        return results;
    }

    /**
     * Layer 2: Semantic/Heuristic Parsing.
     * Looks for <h3> tags (standard for result titles) and their associated links.
     * Independent of specific result container classes like "div.g".
     */
    function tryLayer2() {
        const results = [];
        try {
            // Find all H3s in the main content area
            // Try to constrain to main areas to avoid sidebar H3s
            const headings = document.querySelectorAll('h3');

            headings.forEach(h3 => {
                // 1. Check if H3 is inside an A
                let a = h3.closest('a');

                // 2. If not, check if H3 contains an A
                if (!a) {
                    a = h3.querySelector('a');
                }

                if (a && a.href) {
                    // Heuristic: Result titles are usually reasonable length
                    if (h3.innerText.length > 5) {
                        results.push({ title: h3.innerText.trim(), url: a.href });
                    }
                }
            });
        } catch (e) {
            console.warn("[TabScribe Parser] Layer 2 error:", e);
        }
        return results;
    }

    /**
     * Layer 3: Generic Fallback.
     * Collects all external HTTP/HTTPS links, filters out internal/ad domains.
     * Relies on the assumption that organic results appear earlier in the DOM.
     */
    function tryLayer3() {
        const results = [];
        try {
            const allLinks = document.querySelectorAll('a[href^="http"]');

            allLinks.forEach(a => {
                // Basic filter: must have some text
                if (a.innerText.trim().length > 5) {
                    results.push({ title: a.innerText.trim(), url: a.href });
                }
            });
        } catch (e) {
            console.warn("[TabScribe Parser] Layer 3 error:", e);
        }
        return results;
    }

    /**
     * Filters and deduplicates the raw list of links.
     */
    function deduplicateAndFilter(rawLinks) {
        const seenUrls = new Set();
        const cleanLinks = [];

        // Domains to exclude (Sync with search-engine.js logic, but locally for safety)
        // We will let the background script do the strict domain filtering from ENGINES config,
        // but here we do a basic pass to avoid returning garbage.
        const blockedTerms = [
            'google.com', 'google.co', 'gstatic.com', 'googleapis.com',
            'brave.com', 'search.brave.com',
            'bing.com', 'yahoo.com',
            'javascript:', 'void(0)', '#',
            '/search?', '/url?' // Google redirect/tracking parameters (sometimes extracted if parser fails)
        ];

        for (const link of rawLinks) {
            if (!link.url) continue;

            try {
                const urlObj = new URL(link.url);
                const hostname = urlObj.hostname;
                const href = link.url;

                // Basic blocklist check
                if (blockedTerms.some(term => hostname.includes(term) || href.includes(term))) {
                    continue;
                }

                // Deduplication
                if (seenUrls.has(href)) continue;

                seenUrls.add(href);
                cleanLinks.push(link);

            } catch (e) {
                // Invalid URL, skip
            }
        }

        return cleanLinks;
    }

    // --- ENTRY POINT ---
    // We can listen for a message or just run immediately. 
    // For 'scripting.executeScript', the return value of this function is sent back.

    return parse();

})();
