import * as pdfjsLib from '../../vendor/pdfjs/pdf.min.mjs';

// Set worker source
// IMPORTANT: In a Chrome Extension content script/background, usage differs.
// We are setting the Worker SRC to the local file we downloaded.
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs');

/**
 * Extracts text from a PDF URL.
 * @param {string} url 
 * @returns {Promise<string>}
 */
export async function extractPdfContent(url) {
    try {
        const loadingTask = pdfjsLib.getDocument(url);
        const pdf = await loadingTask.promise;

        let fullText = `PDF DOCUMENT: ${url}\n`;
        fullText += `PAGES: ${pdf.numPages}\n`;
        fullText += `${'='.repeat(40)}\n\n`;

        // Limit pages to avoid memory explosion (first 10 pages)
        const maxPages = Math.min(pdf.numPages, 10);

        for (let i = 1; i <= maxPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();

            const strings = textContent.items.map(item => item.str);
            fullText += `[PAGE ${i}]\n${strings.join(' ')}\n\n`;
        }

        if (pdf.numPages > 10) {
            fullText += `\n...(Truncated after 10 pages)....\n`;
        }

        return fullText;
    } catch (error) {
        console.error('PDF Extraction Error:', error);
        return null; // Signals failure/fallback
    }
}
