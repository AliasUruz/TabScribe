/**
 * TabScribe Logger v2.0 — Exceptional Diagnostic Logging
 *
 * Centralized logging system with:
 *   - In-memory write-behind buffer for maximum I/O efficiency.
 *   - Automatic Error object serialization (name, message, full stack trace).
 *   - Extension context capture on errors (manifest, browser, platform).
 *   - Global unhandled rejection / error interceptors.
 *   - Rich, AI-parseable export format with config dump and session summary.
 *
 * Public API (unchanged for backward compatibility):
 *   import { log, getLogs, clearLogs, formatLogsForExport } from './logger.js';
 *   log('error', 'ModuleName', 'Something went wrong', new Error('detail'));
 *
 * New API:
 *   import { initGlobalErrorHandlers } from './logger.js';
 *   initGlobalErrorHandlers();  // Call once in background.js
 */

// ═══════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════
const MAX_LOG_ENTRIES = 2000;
const STORAGE_KEY = 'tabscribe_logs';
const FLUSH_INTERVAL_MS = 2000;   // Max time logs stay in memory
const FLUSH_THRESHOLD = 50;     // Auto-flush after this many buffered entries
const MAX_EXTRA_CHARS = 1000;   // Max chars for serialized extra data
const MAX_STACK_LINES = 25;     // Keep full stack but cap at reasonable depth

// ═══════════════════════════════════════════════════════════
// Internal State
// ═══════════════════════════════════════════════════════════
let _buffer = [];
let _flushTimer = null;
let _flushing = false;
let _extCtxCache = null;

// ═══════════════════════════════════════════════════════════
// Extension Context Capture
// ═══════════════════════════════════════════════════════════

/**
 * Captures a snapshot of the extension's configuration and environment.
 * Cached after first call for performance.
 * @returns {object} Extension context object.
 */
function getExtensionContext() {
    if (_extCtxCache) return _extCtxCache;
    try {
        const manifest = chrome.runtime.getManifest();
        _extCtxCache = {
            name: manifest.name || 'Unknown',
            version: manifest.version || '?',
            manifestVersion: manifest.manifest_version || '?',
            permissions: (manifest.permissions || []).join(', '),
            userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || 'N/A',
        };
    } catch (_e) {
        _extCtxCache = {
            name: 'TabScribe',
            version: '?',
            manifestVersion: '?',
            permissions: 'N/A',
            userAgent: 'N/A',
        };
    }
    return _extCtxCache;
}

// ═══════════════════════════════════════════════════════════
// Error Serialization
// ═══════════════════════════════════════════════════════════

/**
 * Extracts structured error information from an Error object or error-like
 * payload.  Returns null if the input is not error-related.
 *
 * Supports:
 *   - Native Error instances.
 *   - Objects with a `stack` string property (legacy call-site pattern).
 *
 * @param {*} input  The value passed as `extra` to log().
 * @returns {{ name: string, msg: string, stack: string } | null}
 */
function extractErrorInfo(input) {
    if (!input) return null;

    // Native Error instance
    if (input instanceof Error) {
        return {
            name: input.name || 'Error',
            msg: input.message || '',
            stack: cleanStack(input.stack),
        };
    }

    // Legacy pattern: { stack: '...' } passed explicitly
    if (typeof input === 'object' && typeof input.stack === 'string') {
        return {
            name: input.name || 'Error',
            msg: input.message || input.msg || '',
            stack: cleanStack(input.stack),
        };
    }

    return null;
}

/**
 * Cleans a raw stack trace string:
 *   - Limits to MAX_STACK_LINES.
 *   - Trims each line.
 * @param {string} raw  Raw stack string.
 * @returns {string}    Cleaned stack string.
 */
function cleanStack(raw) {
    if (!raw) return '';
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > MAX_STACK_LINES) {
        return lines.slice(0, MAX_STACK_LINES).join('\n') + `\n  ... (${lines.length - MAX_STACK_LINES} more frames)`;
    }
    return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════
// Safe JSON Serialization
// ═══════════════════════════════════════════════════════════

/**
 * Safely stringifies any value, handling circular references and DOM nodes.
 * Truncates output to `maxLen` characters.
 *
 * @param {*}      obj     Value to serialize.
 * @param {number} maxLen  Maximum character length (default: MAX_EXTRA_CHARS).
 * @returns {string}       JSON string or '[Unserializable]'.
 */
function safeStringify(obj, maxLen = MAX_EXTRA_CHARS) {
    if (obj === undefined || obj === null) return '';
    try {
        const seen = new WeakSet();
        const json = JSON.stringify(obj, (_key, value) => {
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) return '[Circular]';
                seen.add(value);
                // Guard against DOM nodes or other host objects
                if (typeof HTMLElement !== 'undefined' && value instanceof HTMLElement) {
                    return `[HTMLElement: ${value.tagName}]`;
                }
            }
            if (typeof value === 'function') return '[Function]';
            if (typeof value === 'bigint') return value.toString();
            return value;
        });
        if (json.length > maxLen) {
            return json.substring(0, maxLen) + '...[truncated]';
        }
        return json;
    } catch (_e) {
        return '[Unserializable]';
    }
}

// ═══════════════════════════════════════════════════════════
// Buffer & Flush Mechanism
// ═══════════════════════════════════════════════════════════

/**
 * Schedules a debounced flush of the in-memory buffer to chrome.storage.
 * If a flush is already scheduled, this is a no-op.
 */
function scheduleFlush() {
    if (_flushTimer) return;
    _flushTimer = setTimeout(() => {
        _flushTimer = null;
        flushBuffer();
    }, FLUSH_INTERVAL_MS);
}

/**
 * Immediately writes all buffered log entries to chrome.storage.local.
 * Uses a flushing guard to prevent concurrent writes.
 */
async function flushBuffer() {
    if (_flushing || _buffer.length === 0) return;
    _flushing = true;

    // Swap buffer to avoid losing entries during async write
    const batch = _buffer;
    _buffer = [];

    try {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        const logs = data[STORAGE_KEY] || [];
        logs.push(...batch);

        // Evict oldest entries to stay within limits
        if (logs.length > MAX_LOG_ENTRIES) {
            logs.splice(0, logs.length - MAX_LOG_ENTRIES);
        }

        await chrome.storage.local.set({ [STORAGE_KEY]: logs });
    } catch (e) {
        // Last resort: push batch back so we don't lose them silently
        _buffer.unshift(...batch);
        console.error('[Logger] Failed to persist log buffer:', e);
    } finally {
        _flushing = false;
    }
}

// ═══════════════════════════════════════════════════════════
// Core Public API
// ═══════════════════════════════════════════════════════════

/**
 * Adds a log entry to the in-memory buffer.
 *
 * For ERROR level:
 *   - Triggers an immediate flush (no waiting for debounce timer).
 *   - Captures extension context automatically.
 *   - If `extra` is an Error object, serializes name/message/stack.
 *
 * @param {'info'|'warn'|'error'|'debug'} level   Log severity.
 * @param {string}                        source  Module name (e.g. 'AutoSearch').
 * @param {string}                        message Human-readable description.
 * @param {Error|object|null}             extra   Error object or extra metadata.
 */
export async function log(level, source, message, extra = null) {
    // ── Console mirror (real-time debugging) ──
    const tag = `[${source}]`;
    const consoleArgs = extra ? [tag, message, extra] : [tag, message];
    if (level === 'error') console.error(...consoleArgs);
    else if (level === 'warn') console.warn(...consoleArgs);
    else if (level === 'debug') console.debug(...consoleArgs);
    else console.log(...consoleArgs);

    // ── Build structured entry ──
    const entry = {
        t: new Date().toISOString(),
        l: level,
        s: source,
        m: message,
    };

    // ── Error enrichment ──
    const errInfo = extractErrorInfo(extra);
    if (errInfo) {
        entry.err = errInfo;
        // Remove stack from the generic `d` field to avoid duplication
        if (typeof extra === 'object' && !(extra instanceof Error)) {
            const { stack, name, message: _m, msg: _m2, ...rest } = extra;
            const leftover = safeStringify(rest);
            if (leftover && leftover !== '{}') entry.d = leftover;
        }
    } else if (extra !== null && extra !== undefined) {
        entry.d = safeStringify(extra);
    }

    // ── Attach extension context on errors ──
    if (level === 'error') {
        entry.ctx = getExtensionContext();
    }

    // ── Push to buffer ──
    _buffer.push(entry);

    // ── Flush strategy ──
    if (level === 'error' || _buffer.length >= FLUSH_THRESHOLD) {
        // Critical: flush immediately
        if (_flushTimer) {
            clearTimeout(_flushTimer);
            _flushTimer = null;
        }
        await flushBuffer();
    } else {
        scheduleFlush();
    }
}

/**
 * Retrieves all stored logs.  Flushes the in-memory buffer first to ensure
 * completeness.
 * @returns {Promise<Array>}
 */
export async function getLogs() {
    await flushBuffer();
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return data[STORAGE_KEY] || [];
}

/**
 * Clears all stored logs and the in-memory buffer.
 */
export async function clearLogs() {
    _buffer = [];
    if (_flushTimer) {
        clearTimeout(_flushTimer);
        _flushTimer = null;
    }
    await chrome.storage.local.remove(STORAGE_KEY);
}

// ═══════════════════════════════════════════════════════════
// Global Error Handlers
// ═══════════════════════════════════════════════════════════

/**
 * Installs global error interceptors on the Service Worker scope.
 * Call this ONCE from background.js at module top-level.
 *
 * Captures:
 *   - Unhandled promise rejections.
 *   - Uncaught exceptions (if supported by the SW environment).
 */
export function initGlobalErrorHandlers() {
    self.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        const err = reason instanceof Error
            ? reason
            : new Error(typeof reason === 'string' ? reason : safeStringify(reason, 500));
        log('error', 'GlobalHandler', `[UNHANDLED_REJECTION] ${err.message}`, err);
    });

    self.addEventListener('error', (event) => {
        const err = event.error || new Error(event.message || 'Unknown global error');
        log('error', 'GlobalHandler', `[UNCAUGHT_ERROR] ${err.message}`, err);
    });
}

// ═══════════════════════════════════════════════════════════
// Rich Export Formatter
// ═══════════════════════════════════════════════════════════

/**
 * Known error patterns mapped to actionable diagnostic hints.
 * Each hint tells an AI or human what the root cause is and how to fix it.
 */
const DIAGNOSTIC_PATTERNS = [
    {
        pattern: /HTTP 403/i,
        hint: 'Server returned 403 Forbidden. The YouTube InnerTube/timedtext API is blocking the request. This often happens with auto-generated captions (asr). Consider adding a cookie/session header or switching to an alternative caption source.',
    },
    {
        pattern: /Tabs cannot be edited/i,
        hint: 'Transient Chrome API error — occurs when the user is dragging tabs or browser is busy. safeTabCreate() retries automatically. If persistent, increase retry count or backoff delay in auto-search.js.',
    },
    {
        pattern: /No captionTracks found/i,
        hint: 'YouTube video has no caption tracks available (neither manual nor auto-generated). Expected for some videos. Verify captions exist on youtube.com.',
    },
    {
        pattern: /content-length: 0|Response body 0 chars|Empty body/i,
        hint: 'Timedtext API returned empty response (HTTP 200 but 0 bytes). YouTube may be rate-limiting or caption track URL is stale. Try fetching a fresh player response.',
    },
    {
        pattern: /Tab \d+ disappeared/i,
        hint: 'Tab was closed externally while auto-search was using it. Add tab existence checks before each operation.',
    },
    {
        pattern: /Cannot create window/i,
        hint: 'Chrome refused to create a window. Too many windows open or system low on resources.',
    },
    {
        pattern: /QUOTA_BYTES_PER_ITEM/i,
        hint: 'chrome.storage.local item size limit exceeded (8MB per key). Reduce log entry size or increase pruning.',
    },
    {
        pattern: /CAPTCHA/i,
        hint: 'Search engine returned CAPTCHA. Extension is being rate-limited. Increase delay between searches or switch engine.',
    },
    {
        pattern: /net::ERR_|Failed to fetch|NetworkError/i,
        hint: 'Network connectivity error. Check internet, firewall, or if target server is down.',
    },
    {
        pattern: /UNHANDLED_REJECTION|UNCAUGHT_ERROR/i,
        hint: 'Unhandled promise rejection or uncaught exception caught by global handler. Missing try/catch in the code path shown in stack trace.',
    },
];

/**
 * Formats all logs into a richly-structured, human-readable AND AI-parseable
 * diagnostic report optimized for automated debugging.
 *
 * Includes:
 *   - Extension configuration header with browser/OS info.
 *   - Session summary with duration and severity counts.
 *   - Per-module entry breakdown.
 *   - Timing deltas between entries (detects slow operations).
 *   - Full stack traces with auto-detected diagnostic hints.
 *   - Error index at the end for quick navigation.
 *
 * @returns {Promise<string>}  The formatted diagnostic log string.
 */
export async function formatLogsForExport() {
    const logs = await getLogs();
    const ctx = getExtensionContext();
    const now = new Date().toISOString();

    if (logs.length === 0) {
        return `== TabScribe Diagnostic Log ==\nExported: ${now}\n\n-- No log entries recorded --`;
    }

    // ── Counters ──
    const counts = { error: 0, warn: 0, info: 0, debug: 0 };
    const moduleCounts = {};
    const errorEntries = [];

    for (let i = 0; i < logs.length; i++) {
        const e = logs[i];
        counts[e.l] = (counts[e.l] || 0) + 1;
        moduleCounts[e.s] = (moduleCounts[e.s] || 0) + 1;
        if (e.l === 'error') {
            errorEntries.push({ index: i + 1, entry: e });
        }
    }

    // ── Session timing ──
    const firstTs = new Date(logs[0].t).getTime();
    const lastTs = new Date(logs[logs.length - 1].t).getTime();
    const durationSec = ((lastTs - firstTs) / 1000).toFixed(1);

    // ── Header ──
    const header = [
        '╔══════════════════════════════════════════════════════════════════════════════╗',
        '║                       TabScribe Diagnostic Log                              ║',
        '║                   AI-Optimized Error Report v2.0                            ║',
        '╚══════════════════════════════════════════════════════════════════════════════╝',
        '',
        '── Extension Config ──────────────────────────────────────────────────────────',
        `  Name:           ${ctx.name}`,
        `  Version:        ${ctx.version}`,
        `  Manifest:       v${ctx.manifestVersion}`,
        `  Permissions:    ${ctx.permissions}`,
        `  User Agent:     ${ctx.userAgent}`,
        `  Browser:        ${_extractBrowserName(ctx.userAgent)}`,
        `  Export Time:    ${now}`,
        '',
        '── Session Summary ───────────────────────────────────────────────────────────',
        `  Total Entries:  ${logs.length}`,
        `  Duration:       ${durationSec}s (${logs[0].t} → ${logs[logs.length - 1].t})`,
        `  Errors:         ${counts.error}${counts.error > 0 ? '  ◄ ATTENTION REQUIRED' : ''}`,
        `  Warnings:       ${counts.warn}`,
        `  Info:           ${counts.info}`,
        `  Debug:          ${counts.debug}`,
        '',
        '── Module Breakdown ──────────────────────────────────────────────────────────',
    ];

    const sortedModules = Object.entries(moduleCounts).sort((a, b) => b[1] - a[1]);
    for (const [mod, count] of sortedModules) {
        header.push(`  ${mod.padEnd(16)} ${String(count).padStart(4)} entries`);
    }
    header.push('');
    header.push('══════════════════════════════════════════════════════════════════════════════');
    header.push('');

    // ── Body ──
    const body = [];
    let prevTs = firstTs;

    for (let i = 0; i < logs.length; i++) {
        const e = logs[i];
        const curTs = new Date(e.t).getTime();
        const delta = curTs - prevTs;
        prevTs = curTs;

        const lvl = (e.l || 'info').toUpperCase().padEnd(5);
        const src = (e.s || '?').padEnd(14);
        const extra = e.d ? ` | ${e.d}` : '';

        // Timing delta (skip first entry; only show ≥100ms gaps)
        if (i > 0 && delta >= 100) {
            const deltaLabel = delta >= 1000
                ? `+${(delta / 1000).toFixed(1)}s`
                : `+${delta}ms`;
            body.push(`                                          ${deltaLabel}`);
        }

        body.push(`[${e.t}] ${lvl} [${src}] ${e.m}${extra}`);

        // ── Render error block with diagnostics ──
        if (e.err) {
            body.push(`  ├─ Type:    ${e.err.name}`);
            if (e.err.msg) {
                body.push(`  ├─ Message: ${e.err.msg}`);
            }
            if (e.err.stack) {
                body.push('  ├─ Stack Trace:');
                const stackLines = e.err.stack.split('\n');
                for (const sl of stackLines) {
                    body.push(`  │     ${sl}`);
                }
            }
            if (e.ctx) {
                body.push(`  ├─ Context: Extension v${e.ctx.version} | ${_extractBrowserName(e.ctx.userAgent)}`);
            }

            // Auto-diagnose from all available text
            const fullText = `${e.m} ${e.err.msg || ''} ${e.err.stack || ''} ${e.d || ''}`;
            const hints = DIAGNOSTIC_PATTERNS.filter(p => p.pattern.test(fullText));
            if (hints.length > 0) {
                body.push('  ├─ 🔍 Diagnostic Hints:');
                for (const h of hints) {
                    body.push(`  │     → ${h.hint}`);
                }
            }
            body.push('  └─────────────────────────────────────────────');
        }

        // ── Warn-level hint detection ──
        if (e.l === 'warn' && !e.err) {
            const warnText = `${e.m} ${e.d || ''}`;
            const hints = DIAGNOSTIC_PATTERNS.filter(p => p.pattern.test(warnText));
            if (hints.length > 0) {
                for (const h of hints) {
                    body.push(`  ⚠ Hint: ${h.hint}`);
                }
            }
        }
    }

    // ── Error Index (quick reference at the end) ──
    if (errorEntries.length > 0) {
        body.push('');
        body.push('══════════════════════════════════════════════════════════════════════════════');
        body.push('  ERROR INDEX — Quick Reference');
        body.push('══════════════════════════════════════════════════════════════════════════════');
        for (const { index, entry } of errorEntries) {
            const errLabel = entry.err ? `${entry.err.name}: ${entry.err.msg}` : entry.m;
            body.push(`  [#${String(index).padStart(3, '0')}] [${entry.s}] ${errLabel}`);
        }
        body.push('');
        body.push('──────────────────────────────────────────────────────────────────────────────');
        body.push('  To fix these errors, provide this entire log file to your AI assistant.');
        body.push('  The diagnostic hints above contain actionable remediation steps.');
        body.push('══════════════════════════════════════════════════════════════════════════════');
    }

    return header.join('\n') + body.join('\n') + '\n';
}

/**
 * Extracts a short browser identifier from a User-Agent string.
 * @param {string} ua  Full User-Agent string.
 * @returns {string}   Short identifier like "Chrome 130.0 / Windows".
 */
function _extractBrowserName(ua) {
    if (!ua || ua === 'N/A') return 'Unknown Browser';
    try {
        const chromeMatch = ua.match(/Chrome\/([\d.]+)/);
        const browser = chromeMatch ? `Chrome ${chromeMatch[1]}` : 'Unknown Browser';
        let os = 'Unknown OS';
        if (ua.includes('Windows')) os = 'Windows';
        else if (ua.includes('Mac OS')) os = 'macOS';
        else if (ua.includes('Linux')) os = 'Linux';
        else if (ua.includes('CrOS')) os = 'ChromeOS';
        return `${browser} / ${os}`;
    } catch (_e) {
        return 'Unknown';
    }
}

