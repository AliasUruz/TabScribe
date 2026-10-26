// ═══════════════════════════════════════════════
// YouTube Metadata & Transcript Extractor
// ═══════════════════════════════════════════════
//
// Architecture (v5 — FAT: Fully Automated Transcript):
//   1. 100% Service Worker based. No background tabs required.
//   2. Uses InnerTube Android API (impersonation) via POST.
//   3. Fallback: Pure HTML Fetch + Regex extraction.
//   4. CORS Bypass: Uses declarativeNetRequest rules for URLs with &xtabs=1.
//
// Integration: called from auto-search.js directly.

/**
 * Check if a URL is a YouTube watch page.
 */
function isYouTubeWatch(url) {
    if (!url) return false;
    try {
        const u = new URL(url);
        const host = u.hostname.replace('www.', '');
        if (host === 'youtube.com') {
            return u.pathname.startsWith('/watch') || u.pathname.startsWith('/shorts/');
        }
        if (host === 'youtu.be') return true;
        return false;
    } catch {
        return false;
    }
}

/**
 * Extract YouTube metadata and transcript via Background Fetch (No Tabs).
 * @param {string} videoUrl 
 * @returns {Promise<string|null>} Formatted text content
 */
async function extractYouTubeContent(videoUrl) {
    const videoId = _extractVideoId(videoUrl);
    if (!videoId) return null;

    const out = {
        debug: [],
        metadata: { videoId, title: 'YouTube Video' },
        transcript: null
    };

    try {
        // --- LAYER A: InnerTube API (Android Client) ---
        // This is the fastest method and often bypasses the "WEB" PoW/Bot checks.
        out.debug.push("Layer A: InnerTube Android API");
        const playerUrl = `https://www.youtube.com/youtubei/v1/player?xtabs=1`; // xtabs=1 triggers DNR bypass
        
        try {
            const resp = await fetch(playerUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)'
                },
                body: JSON.stringify({
                    context: {
                        client: {
                            clientName: 'ANDROID',
                            clientVersion: '20.10.38', // Modern Android version
                            hl: 'pt-BR',
                            gl: 'BR'
                        }
                    },
                    videoId: videoId
                })
            });

            if (resp.ok) {
                const playerResponse = await resp.json();
                _populateMetadataFromPlayerResponse(out.metadata, playerResponse);
                
                const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                if (tracks && tracks.length > 0) {
                    const baseUrl = tracks[0].baseUrl + (tracks[0].baseUrl.includes('?') ? '&' : '?') + 'xtabs=1';
                    out.debug.push(`Layer A: Fetching ${tracks[0].languageCode} (${tracks[0].kind || 'man'})`);
                    
                    const xmlResp = await fetch(baseUrl);
                    const xmlText = await xmlResp.text();
                    out.transcript = _parseTranscriptXml(xmlText);
                    
                    
                    if (out.transcript) {
                        out.debug.push(`Layer A Success (${out.transcript.length} chars)`);
                    } else {
                        out.debug.push(`Layer A XML Parsed but empty (Len: ${xmlText.length})`);
                    }
                } else {
                    out.debug.push(`Layer A API Warning: No CaptionTracks provided by YT.`);
                }
            } else {
                out.debug.push(`Layer A HTTP ${resp.status}`);
            }
        } catch (e) {
            out.debug.push(`Layer A Error: ${e.message}`);
        }

        // --- LAYER B: HTML Scraping (Fallback) ---
        if (!out.transcript) {
            out.debug.push("Layer B: HTML Scrape Fallback");
            const watchUrl = `https://www.youtube.com/watch?v=${videoId}&xtabs=1`;
            
            try {
                const resp = await fetch(watchUrl);
                const html = await resp.text();
                
                // Extract ytInitialPlayerResponse
                const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
                if (playerMatch) {
                    const playerResponse = JSON.parse(playerMatch[1]);
                    _populateMetadataFromPlayerResponse(out.metadata, playerResponse);
                    
                    const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                    if (tracks && tracks.length > 0) {
                        const baseUrl = tracks[0].baseUrl + (tracks[0].baseUrl.includes('?') ? '&' : '?') + 'xtabs=1';
                        const xmlResp = await fetch(baseUrl);
                        const xmlText = await xmlResp.text();
                        out.transcript = _parseTranscriptXml(xmlText);
                        if (out.transcript) {
                            out.debug.push(`Layer B Success (${out.transcript.length} chars)`);
                        } else {
                            out.debug.push(`Layer B XML Parsed but empty (Len: ${xmlText.length})`);
                        }
                    } else {
                        out.debug.push("Layer B HTML Parsed: No CaptionTracks block found");
                    }
                } else {
                    out.debug.push("Layer B: ytInitialPlayerResponse not found in HTML");
                }
            } catch (e) {
                out.debug.push(`Layer B Error: ${e.message}`);
            }
        }

        // --- FINAL ASSEMBLY ---
        return _formatOutput(out);

    } catch (err) {
        console.error("[FAT Extractor] Fatal Error:", err);
        return `[Error] Failed to extract YouTube content: ${err.message}`;
    }
}

/**
 * Extract YouTube video ID from various URL formats.
 */
function _extractVideoId(url) {
    if (!url) return null;
    try {
        const u = new URL(url);
        if (u.hostname.includes('youtube.com')) {
            if (u.pathname.includes('/watch')) return u.searchParams.get('v');
            if (u.pathname.includes('/shorts/')) return u.pathname.split('/').pop();
        }
        if (u.hostname === 'youtu.be') return u.pathname.substring(1);
    } catch (e) {}
    return null;
}

/**
 * Map playerResponse JSON fields to internal metadata object.
 */
function _populateMetadataFromPlayerResponse(meta, player) {
    if (!player) return;
    const details = player.videoDetails;
    if (details) {
        meta.title = details.title || meta.title;
        meta.channel = details.author || '';
        meta.duration = details.lengthSeconds || '';
        meta.shortDescription = details.shortDescription || '';
        meta.views = details.viewCount || '';
    }
    // Try to get upload date if available in microformat
    const micro = player.microformat?.playerMicroformatRenderer;
    if (micro) {
        meta.uploadDate = micro.uploadDate || null;
    }
}

/**
 * Fast Regex-based XML Transcript Parser (No DOM dependency).
 */
function _parseTranscriptXml(xml) {
    if (!xml || xml.length < 50) return null;
    
    // Helper to decode HTML entities in XML
    const decode = (str) => {
        return str
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
            .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
    };

    let segments = [];
    
    // Format 1: <text> tag (Legacy XML format)
    // Example: <text start="1.23" dur="0.5">Hello</text>
    const textRegex = /<text[^>]*start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
    let match;
    while ((match = textRegex.exec(xml)) !== null) {
        const content = decode(match[2].replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim());
        if (content) {
            segments.push({
                start: parseFloat(match[1]),
                text: content
            });
        }
    }
    
    // Format 2: <p> tag (Newer RV3 XML format)
    // Example: <p t="1230" d="500">Hello</p>
    if (segments.length === 0) {
        const pRegex = /<p[^>]*t="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
        while ((match = pRegex.exec(xml)) !== null) {
            let content = match[2];
            // Remove optional inner <s> tags used for styling
            content = content.replace(/<s[^>]*>/g, '').replace(/<\/s>/g, '');
            content = decode(content.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim());
            
            if (content) {
                segments.push({
                    start: parseInt(match[1], 10) / 1000,
                    text: content
                });
            }
        }
    }

    if (segments.length === 0) return null;

    // Smart Grouping: Group segments every ~15 seconds for readability
    let lines = [];
    let currentLine = "";
    let lastMarkTime = -999;
    const TIME_INTERVAL = 15; // seconds

    for (const seg of segments) {
        if (seg.start - lastMarkTime >= TIME_INTERVAL) {
            if (currentLine) lines.push(currentLine.trim());
            const timeStr = _formatTimestamp(seg.start);
            currentLine = `[${timeStr}] ${seg.text}`;
            lastMarkTime = seg.start;
        } else {
            currentLine += " " + seg.text;
        }
    }
    if (currentLine) lines.push(currentLine.trim());
    
    return lines.join('\n');
}

/**
 * Format seconds to [MM:SS] or [H:MM:SS]
 */
function _formatTimestamp(seconds) {
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const min = m % 60;
    const sec = s % 60;
    
    if (h > 0) {
        return `${h}:${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    }
    return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Format result data into a standard TabScribe text block.
 */
function _formatOutput(data) {
    const meta = data.metadata;
    const debugPath = data.debug.join(' ➔ ');

    let text = `🎥 VIDEO: ${meta.title || 'YouTube Video'}\n`;
    text += `📊 Views: ${meta.views || 'N/A'} | Duration: ${_formatFullDuration(meta.duration)}`;
    if (meta.channel) text += ` | Channel: ${meta.channel}`;
    text += `\n`;
    if (meta.uploadDate) text += `📅 Uploaded: ${meta.uploadDate}\n`;
    text += `${'─'.repeat(60)}\n`;

    if (meta.shortDescription) {
        const desc = meta.shortDescription.length > 400 
            ? meta.shortDescription.substring(0, 400) + '...' 
            : meta.shortDescription;
        text += `\n📄 DESCRIPTION:\n${desc}\n`;
    }

    if (data.transcript) {
        text += `\n📝 TRANSCRIPT:\n${data.transcript}\n`;
        text += `\n[Audit: SUCCESS via ${debugPath}]\n`;
    } else {
        text += `\n📝 TRANSCRIPT: Not available (Video may be too new or protected)\n`;
        text += `[Audit: FAILED via ${debugPath}]\n`;
    }

    return text;
}

/**
 * Helper to format seconds safely.
 */
function _formatFullDuration(seconds) {
    if (!seconds) return 'N/A';
    const s = parseInt(seconds, 10);
    if (isNaN(s)) return 'N/A';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h${m.toString().padStart(2, '0')}m`;
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

export { isYouTubeWatch, extractYouTubeContent };
