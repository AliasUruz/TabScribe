/**
 * Configuration for supported search engines.
 * 
 * Defines how to build search URLs, which domains to exclude from results,
 * and specific delays to avoid rate limiting.
 */
export const ENGINES = {
    google: {
        name: "Google",
        /**
         * Builds the Google Search URL.
         * @param {string} query - The search query.
         * @param {number} num - Number of results (default 10 to ensure we get enough).
         * @returns {string} The complete URL.
         */
        buildUrl: (query, num = 10) => `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.max(num, 10)}`,
        /**
         * Builds the Google AI Mode URL (udm=50 triggers AI Overview).
         */
        buildAiUrl: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}&udm=50`,
        excludeDomains: [
            "google.com",
            "google.com.br",
            "gstatic.com",
            "googleapis.com",
            "w3.org" // Often appears in technical searches
        ],
        // Delays in milliseconds
        delay: { min: 3000, max: 5000 }
    },

    scholar: {
        name: "Google Scholar",
        buildUrl: (query) => `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`,
        excludeDomains: [
            "google.com",
            "google.com.br",
            "gstatic.com",
            "googleapis.com"
        ],
        delay: { min: 3000, max: 5000 }
    },

    brave: {
        name: "Brave Search",
        buildUrl: (query) => `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
        /**
         * Builds the Brave AI Mode URL (/ask path).
         */
        buildAiUrl: (query) => `https://search.brave.com/ask?q=${encodeURIComponent(query)}&source=web`,
        excludeDomains: [
            "brave.com",
            "search.brave.com"
        ],
        delay: { min: 1500, max: 3000 }
    },

    youtube: {
        name: "YouTube",
        buildUrl: (query) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
        // YouTube doesn't have an AI overview mode, fallback to regular search
        buildAiUrl: (query) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
        excludeDomains: [], // No domain exclusion necessary for native YT search
        // Higher delay to avoid 429 errors from bot behavior
        delay: { min: 3000, max: 5000 }
    }
};

/**
 * Helper to add random jitter to delays.
 * @param {number} baseDelay - The base delay in ms.
 * @param {number} maxJitter - Maximum random addition in ms.
 * @returns {Promise<void>}
 */
export function delayWithJitter(baseDelay, maxJitter = 2000) {
    const jitter = Math.random() * maxJitter;
    return new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
}
