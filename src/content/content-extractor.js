/**
 * ContentExtractor — Lightweight Readability-Inspired Article Extractor
 *
 * Extracts the main article content from a page, stripping away navigation,
 * ads, sidebars, footers, and other boilerplate. Works well with news sites
 * like CNN, G1, BBC, NYT, Medium, etc.
 *
 * Algorithm:
 *   1. Find candidate containers using semantic tags (article, main, etc.)
 *   2. Score candidates by text density, paragraph count, link ratio
 *   3. Choose the highest-scoring candidate
 *   4. Clean the content (remove scripts, styles, nav, ads)
 *   5. Return structured { content, title, byline, date }
 */
class ContentExtractor {

    constructor() {
        // Tags that are NEVER part of the main content
        this.REMOVE_TAGS = new Set([
            'script', 'style', 'noscript', 'iframe', 'svg', 'canvas',
            'nav', 'header', 'footer', 'aside', 'form', 'button',
            'input', 'select', 'textarea', 'label', 'dialog',
            'figure', // often just images with captions
        ]);

        // ── Configuration ──
        this.POSITIVE_PATTERNS = /article|body|content|entry|hentry|main|page|pagination|post|text|blog|story|readme|markdown-body|wiki-content|documentation/i;
        this.NEGATIVE_PATTERNS = /combx|comment|com-|contact|foot|footer|footnote|masthead|media|meta|outbrain|promo|related|scroll|shoutbox|sidebar|sponsor|shopping|tags|tool|widget|menu|nav|banner|cookie|popup|modal|overlay|share|social|advert/i;
    }

    /**
     * Detects soft paywalls based on common overlay text/elements.
     */
    detectPaywall() {
        const paywallKeywords = /subscribe to read|subscribe now|subscription|paywall|read the full story|register to continue|limit reached|you have reached your limit|sign in to read/i;
        const bodyText = document.body.innerText.substring(0, 3000).toLowerCase(); // Check start of doc

        // 1. Keyword Check in body (loose)
        if (paywallKeywords.test(bodyText) && bodyText.length < 1500) {
            return true;
        }

        // 2. Overlay Element Check
        const overlays = document.querySelectorAll('[class*="paywall"], [id*="paywall"], [class*="subscription"], [id*="subscription"], .overlay, .modal');
        for (const el of overlays) {
            if (el.innerText && paywallKeywords.test(el.innerText)) {
                return true;
            }
        }

        return false;
    }

    _nodeToText(node) {
        if (!node) return '';

        // Handle specific tags
        if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toLowerCase();

            // Preserve code blocks with formatting
            if (tag === 'pre') {
                return `\n\`\`\`\n${node.innerText}\n\`\`\`\n`;
            }
            if (tag === 'code' && node.parentElement.tagName.toLowerCase() !== 'pre') {
                // Inline code
                return `\`${node.innerText}\``;
            }

            if (['script', 'style', 'noscript', 'iframe', 'svg', 'nav', 'footer'].includes(tag)) {
                return '';
            }
            if (tag === 'br') return '\n';
            if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'].includes(tag)) {
                return `\n${this._cleanText(node.innerText)}\n`;
            }
        }

        if (node.nodeType === Node.TEXT_NODE) {
            return this._cleanText(node.textContent);
        }

        // Recurse
        let text = '';
        node.childNodes.forEach(child => {
            text += this._nodeToText(child);
        });
        return text;
    }

    /**
     * Main extraction method.
     * @param {Document} doc - The document to extract from
     * @returns {object} { content, title, byline, date, wordCount }
     */
    extract(doc) {
        // 1. Clone the document to avoid modifying the original DOM
        const clone = doc.cloneNode(true);

        // 2. Main Content Extraction
        const { content, mode } = this._extractMainContent(clone);

        // 3. Post-Extraction Paywall Check
        const isPaywalled = this.detectPaywall();
        const finalMode = isPaywalled ? 'paywall_partial' : mode;

        return {
            title: this._extractTitle(doc),
            content: content,
            textContent: this._cleanText(content), // distinct from HTML content if needed
            length: content.length,
            excerpt: this._createExcerpt(content),
            siteName: this._extractSiteName(doc),
            byline: this._extractByline(doc),
            publishedTime: this._extractDate(doc),
            mode: finalMode,
            debug: {
                strategy: mode,
                paywallDetected: isPaywalled
            }
        };
    }

    _extractMainContent(doc) {
        let content = null;
        let mode = 'none';

        // Strategy 1: Look for <article> tag (most reliable for news sites)
        content = this._tryArticleTag(doc);
        if (content && content.length > 200) {
            mode = 'article_tag';
        }

        // Strategy 2: Look for common content containers
        if (!content || content.length < 200) {
            content = this._tryScoredCandidates(doc);
            if (content && content.length > 200) {
                mode = 'scored_candidates';
            }
        }

        // Strategy 3: Look for the densest text block
        if (!content || content.length < 200) {
            content = this._tryDensestBlock(doc);
        }

        // Strategy 4: Fallback to body text (filtered)
        if (!content || content.length < 100) {
            content = this._fallbackCleanBody(doc);
        }

        // Final cleanup
        content = this._cleanText(content);

        return {
            content,
            mode
        };
    }

    // ═══════════════════════════════════════════
    // Strategy 1: <article> tag
    // ═══════════════════════════════════════════
    _tryArticleTag(doc) {
        const articles = doc.querySelectorAll('article');
        if (articles.length === 0) return null;

        // If multiple articles, pick the longest one
        let best = null;
        let bestLen = 0;

        articles.forEach(article => {
            const text = this._getCleanText(article);
            if (text.length > bestLen) {
                bestLen = text.length;
                best = text;
            }
        });

        return best;
    }

    // ═══════════════════════════════════════════
    // Strategy 2: Scored candidates
    // ═══════════════════════════════════════════
    _tryScoredCandidates(doc) {
        const candidates = [];

        // Collect potential content containers
        const containers = doc.querySelectorAll('div, section, main, [role="main"], [role="article"]');

        containers.forEach(el => {
            // Skip tiny elements
            if (el.textContent.trim().length < 200) return;

            // Skip elements matching negative patterns
            const id = (el.id || '').toLowerCase();
            const cls = (el.className || '').toString().toLowerCase();
            if (this.NEGATIVE_PATTERNS.test(id) || this.NEGATIVE_PATTERNS.test(cls)) return;

            const score = this._scoreElement(el, id, cls);
            candidates.push({ el, score });
        });

        // Sort by score descending
        candidates.sort((a, b) => b.score - a.score);

        if (candidates.length === 0) return null;

        // Take the best candidate
        return this._getCleanText(candidates[0].el);
    }

    /**
     * Score an element based on how likely it is to be the main content.
     */
    _scoreElement(el, id, cls) {
        let score = 0;

        // Positive signals from class/id
        if (this.POSITIVE_PATTERNS.test(id)) score += 25;
        if (this.POSITIVE_PATTERNS.test(cls)) score += 25;

        // Paragraph density — main content has many <p> tags
        const paragraphs = el.querySelectorAll('p');
        score += paragraphs.length * 3;

        // Long paragraphs are a strong signal
        paragraphs.forEach(p => {
            const len = p.textContent.trim().length;
            if (len > 100) score += 5;
            if (len > 300) score += 5;
        });

        // Heading presence (H1, H2) suggests article structure
        const headings = el.querySelectorAll('h1, h2');
        score += headings.length * 3;

        // Link density penalty — sidebars and navs have lots of links
        const links = el.querySelectorAll('a');
        const textLen = el.textContent.trim().length;
        const linkTextLen = Array.from(links).reduce((sum, a) => sum + (a.textContent || '').length, 0);
        const linkDensity = textLen > 0 ? linkTextLen / textLen : 1;

        if (linkDensity > 0.5) score -= 50;  // Too many links = not content
        if (linkDensity > 0.3) score -= 20;
        if (linkDensity < 0.1) score += 10;  // Very few links = likely content

        // Text length bonus
        if (textLen > 1000) score += 10;
        if (textLen > 3000) score += 10;

        // Nesting penalty — deeply nested elements are less likely to be the main container
        let depth = 0;
        let parent = el.parentElement;
        while (parent && depth < 10) {
            depth++;
            parent = parent.parentElement;
        }
        if (depth > 8) score -= 5;

        return score;
    }

    // ═══════════════════════════════════════════
    // Strategy 3: Densest text block
    // ═══════════════════════════════════════════
    _tryDensestBlock(doc) {
        const blocks = doc.querySelectorAll('div, section');
        let best = null;
        let bestDensity = 0;

        blocks.forEach(el => {
            const text = el.textContent.trim();
            if (text.length < 300) return;

            const paragraphs = el.querySelectorAll('p');
            const density = paragraphs.length * 100 + text.length;

            // Penalize if too many links
            const links = el.querySelectorAll('a');
            const linkText = Array.from(links).reduce((s, a) => s + (a.textContent || '').length, 0);
            const ratio = text.length > 0 ? linkText / text.length : 1;
            if (ratio > 0.4) return;

            if (density > bestDensity) {
                bestDensity = density;
                best = this._getCleanText(el);
            }
        });

        return best;
    }

    // ═══════════════════════════════════════════
    // Strategy 4: Fallback — clean body
    // ═══════════════════════════════════════════
    _fallbackCleanBody(doc) {
        return this._getCleanText(doc.body);
    }

    // ═══════════════════════════════════════════
    // Text Cleaning
    // ═══════════════════════════════════════════

    /**
     * Get clean text from an element, removing unwanted child elements.
     */
    _getCleanText(el) {
        if (!el) return '';

        // Clone to avoid mutating the page
        const clone = el.cloneNode(true);

        // Remove all unwanted tags
        this.REMOVE_TAGS.forEach(tag => {
            clone.querySelectorAll(tag).forEach(child => child.remove());
        });

        // Remove elements by ARIA roles (aggressively target navigation, alerts, and banners)
        clone.querySelectorAll('[role="navigation"], [role="banner"], [role="contentinfo"], [role="dialog"], [role="search"], [role="alert"]').forEach(child => child.remove());

        // Remove elements matching negative patterns
        clone.querySelectorAll('*').forEach(child => {
            const id = (child.id || '').toLowerCase();
            const cls = (child.className || '').toString().toLowerCase();
            if (this.NEGATIVE_PATTERNS.test(id) || this.NEGATIVE_PATTERNS.test(cls)) {
                child.remove();
            }
        });

        // Remove hidden elements
        clone.querySelectorAll('[style*="display:none"], [style*="display: none"], [hidden], .hidden, .visually-hidden').forEach(child => {
            child.remove();
        });

        // NEW: Deep Pruning Strategy (Link Density & Structural NLP)
        this._pruneGarbageNodes(clone);

        // Get text preserving basic structure
        return this._nodeToText(clone);
    }

    /**
     * Deep Pruning (Intelligent Extraction Phase 2).
     * Recursively removes elements that have high link density
     * or are recognized as boilerplate structural blocks.
     */
    _pruneGarbageNodes(node) {
        // We evaluate blocks: div, ul, section, p, aside, figure, li
        const blocks = Array.from(node.querySelectorAll('div, ul, section, p, aside, figure, li'));

        // Reverse order so we process nested children before their parents
        blocks.reverse().forEach(el => {
            if (!el.parentElement) return; // Already removed by a child/parent operation

            const text = el.textContent.trim();
            const textLength = text.length;

            if (textLength === 0) return;

            // Calculate Link Density
            const links = el.querySelectorAll('a');
            let linkTextLength = 0;
            links.forEach(a => {
                linkTextLength += (a.textContent || '').trim().length;
            });

            // Avoid division by zero, though textLength > 0 check protects us
            const linkDensity = textLength > 0 ? (linkTextLength / textLength) : 0;

            // --- Rule 1: High Link Density ---
            // Blocks that are mostly links are usually menus, related tags, or share groups.
            if (linkDensity > 0.35 && textLength > 20) {
                // If it's a structural container (UL, DIV, ASIDE) mostly made of links, destroy it.
                if (['UL', 'DIV', 'ASIDE', 'SECTION'].includes(el.tagName)) {
                    el.remove();
                    return;
                }
                // Paragraphs should have sentences. If a P has > 60% links, it's not a real content paragraph.
                if (el.tagName === 'P' && linkDensity > 0.6) {
                    el.remove();
                    return;
                }
            }

            // --- Rule 2: Short UI Elements containing links ---
            // Blocks like "Share this article", "Skip to content", "Log in to comment"
            if (textLength < 60 && links.length > 0) {
                if (['DIV', 'LI', 'ASIDE'].includes(el.tagName)) {
                    el.remove();
                    return;
                }
            }
        });
    }

    _nodeToText(node) {
        const lines = [];
        const blocks = new Set(['p', 'div', 'section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'br', 'tr', 'article', 'main', 'aside', 'nav', 'header', 'footer']);

        let currentLine = '';

        const flushLine = () => {
            const trimmed = currentLine.trim();
            if (trimmed) lines.push(trimmed);
            currentLine = '';
        };

        const walk = (el) => {
            if (el.nodeType === Node.TEXT_NODE) {
                currentLine += el.textContent;
                return;
            }

            if (el.nodeType !== Node.ELEMENT_NODE) return;

            const tag = el.tagName.toLowerCase();

            // Add line break before block elements
            if (blocks.has(tag)) {
                flushLine();
                if (lines.length > 0 && lines[lines.length - 1] !== '') {
                    lines.push('');
                }
            }

            // Headings get emphasis
            if (/^h[1-6]$/.test(tag)) {
                flushLine();
                const text = el.textContent.trim();
                if (text) {
                    lines.push('');
                    lines.push(text.toUpperCase());
                    lines.push('');
                }
                return; // don't recurse into children for headings as we already have textContent
            }

            // List items
            if (tag === 'li') {
                flushLine();
                const text = el.textContent.trim();
                // Since we don't recurse here, we just take textContent
                if (text) lines.push(`• ${text}`);
                return;
            }

            // Blockquotes
            if (tag === 'blockquote') {
                flushLine();
                const text = el.textContent.trim();
                if (text) {
                    lines.push('');
                    lines.push(`> ${text}`);
                    lines.push('');
                }
                return;
            }

            // Recurse into children
            for (const child of el.childNodes) {
                walk(child);
            }

            // Add line break after block elements
            if (blocks.has(tag)) {
                flushLine();
                if (lines.length > 0 && lines[lines.length - 1] !== '') {
                    lines.push('');
                }
            }
        };

        walk(node);
        flushLine();

        return lines.join('\n');
    }

    /**
     * Final text cleanup — remove excessive whitespace and empty lines.
     */
    _cleanText(text) {
        if (!text) return '';

        // --- NEW LINE FILTERING ---
        const garbagePhrases = [
            'siga o canal', 'receba as principais notícias', 'leia também:',
            'veja também:', 'saiba mais', 'fique por dentro', 'assine o',
            'todos os direitos reservados', 'copyright', '©',
            'utilizamos cookies', 'política de privacidade', 'termos de uso',
            'concordo com os termos', 'inscreva-se', 'newsletter',
            'compartilhar:', 'ouça este conteúdo', 'dê sua opinião',
            'encontrou algo errado na matéria', 'comunique erros',
            'receba nossas notícias no celular', 'acompanhe a gazeta',
            'fique por dentro das notícias que importam para você',
            'baixe nosso app', 'seja um dos brasileiros que',
            'mais lidas em', 'ver todas', 'principais do dia',
            'sem tempo? ferramenta de ia resume para você', 'clique e leia aqui o resumo',
            // --- Novas Inclusões ---
            'acesse seus artigos salvos', 'acesse os artigos do assunto', 'abrir sidebar menu', 'ir para o conteúdo',
            'ir para o menu', 'ir para o rodapé', 'oferta especial:', 'apenas r$', 'conecte-se ao jornal',
            '+6 meses de r$', 'a newsletter sobre o mundo jurídico', 'sua assinatura pode valer',
            'você já conhece as vantagens de ser assinante', 'mais de 180 reportagens e análises',
            'assine por r$', 'os comentários não representam a opinião do jornal',
            'comentar é exclusividade para assinantes', 'as principais notícias da semana sobre o cenário',
            'de olho no pleito', 'estúdio folha', 'conteúdo patrocinado', 'é publicado pela empresa',
            'o jornal folha de', 'receba nosso informativo', 'veja mais no portal', 'notícias mais lidas',
            'artigos mais lidos', 'últimas notícias', 'baixe o app',
            // --- PT-BR NYT Cookies ---
            'nós e nossos 340 fornecedores usamos cookies', 'gerenciar preferências de privacidade',
            'controle de privacidade global',
            // --- English Boilerplate ---
            'skip to content', 'skip to site index', 'section navigation', 'share full article',
            'what we’re covering today', 'site index', 'site information navigation',
            'privacy policy', 'cookie policy', 'terms of service', 'terms of sale', 'site map',
            'manage privacy preferences', 'the latest on', 'all rights reserved',
            'got a confidential news tip', 'we want to hear from you', 'get in touch',
            'sign up for free newsletters', 'delivered to your inbox', 'advertise with us',
            'please contact us', 'ad choices', 'your privacy choices', 'ca notice',
            'exclusive news, data and analytics', 'purchase licensing rights', 'read next',
            'follow us', 'access unmatched financial data', 'browse an unrivalled portfolio',
            'screen for heightened risk', 'all quotes delayed a minimum of', 'skip to main content',
            'skip to navigation', 'support the guardian', 'fund independent journalism',
            'prefer the guardian on google', 'here are today’s main stories', 'what else happened today',
            'original reporting and incisive analysis', 'our standards: the thomson reuters trust principles',
            'suggested topics:', 'an official website of the united states government',
            'due to aggressive automated scraping', 'your request has been flagged as potentially automated',
            'if you experiencing issues with the captcha', 'subscribe to the times to read as many articles as you like.',
            'enjoy unlimited access to all of the times.', 'see subscription options'
        ];

        const exactGarbageMatches = new Set([
            'início', 'seções', 'compartilhe essa notícia', 'tags', 'tópicos',
            'relacionadas', 'mais notícias', 'ver mais', 'entrar', 'explore',
            'notificar', 'copiar link', 'whatsapp', 'telegram', 'facebook', 'twitter',
            "ingresso.com", "uol host", "pagbank", "cursos", "uol play", "uol ads", "bate-papo", "email",
            "baixar", "assine", "parar", "anterior", "próximo", "erramos?", "ombudsman",
            "envie sua notícia", "comentários", "comente", "leia mais", "leia tudo sobre o tema e siga:",
            "sua assinatura vale muito", "endereço da página", "blogs", "brasil", "mundo", "política", "economia",
            // --- English Exacts ---
            "log in", "sign in", "subscribe", "markets", "sustainability", "more", "my news",
            "summary", "workspace", "data catalogue", "world-check", "share", "back to top",
            "request access", "toggle the table of contents", "wikipedia", "article", "talk",
            "this article is part of", "a series about", "vte", "timeline[edit]", "categories:",
            "hide", "read", "edit", "view history", "from wikipedia, the free encyclopedia",
            "main articles:", "further information:", "see also:", "external links",
            "aplicado", "listen to this article", "see more on:", "related content"
        ]);

        let filteredText = text.split('\n').filter(line => {
            const trimmed = line.trim().toLowerCase();
            if (!trimmed) return true; // Keep empty lines for structural spacing (will be compressed later)
            if (trimmed.length < 3) return false; // single chars like "x", "a -", "A +"

            if (exactGarbageMatches.has(trimmed)) return false;

            for (const phrase of garbagePhrases) {
                if (trimmed.startsWith(phrase) || trimmed.includes(phrase)) {
                    return false;
                }
            }

            // Remove simple standalone commentary hints
            if (/^\d+\s+comentários?$/.test(trimmed)) return false;
            if (/^read \d+ comments?$/i.test(trimmed)) return false;

            // NEW: Phase 3 - NLP Punctuation / Length Filter (Intelligent Extraction)
            // Boilerplate often consists of short phrases without punctuation.
            const wordCount = trimmed.split(/\s+/).length;
            const startsWithBullet = trimmed.startsWith('•');
            const isHeading = line.trim() === line.trim().toUpperCase() && /[A-Z]/.test(line.trim());

            // If it's a short line (<= 6 words), not a bullet point, and not a heading
            if (!startsWithBullet && !isHeading && wordCount > 0 && wordCount <= 6) {
                // Does it end with punctuation indicating a full sentence or thought?
                const endsWithPunctuation = /[.!?:"']$/.test(line.trim());
                // Does it have a number/date? (e.g. "Feb 23, 2026")
                const hasDigit = /\d/.test(trimmed);

                if (!endsWithPunctuation && !hasDigit) {
                    // It's a short, unpunctuated, non-numeric line. 
                    // Highly likely to be generic UI/navigation text like "Skip to content", "Home", "World News".
                    return false;
                }
            }

            return true;
        }).join('\n');
        // --- END LINE FILTERING ---

        return filteredText
            .replace(/\n{3,}/g, '\n\n')       // Max 2 consecutive newlines
            .replace(/[ \t]+/g, ' ')            // Collapse spaces
            .replace(/\n /g, '\n')              // Remove leading spaces after newlines
            .replace(/ \n/g, '\n')              // Remove trailing spaces before newlines
            .trim();
    }

    // ═══════════════════════════════════════════
    // Metadata Extraction
    // ═══════════════════════════════════════════

    _extractTitle(doc) {
        // 1. Try og:title
        const ogTitle = doc.querySelector('meta[property="og:title"]');
        if (ogTitle?.content) return ogTitle.content;

        // 2. Try <h1>
        const h1 = doc.querySelector('article h1, main h1, h1');
        if (h1?.textContent?.trim()) return h1.textContent.trim();

        // 3. Try <title>
        return doc.title || '';
    }

    _extractByline(doc) {
        // Common meta tags for author
        const authorMeta = doc.querySelector('meta[name="author"], meta[property="article:author"]');
        if (authorMeta?.content) return authorMeta.content;

        // Common class patterns
        const bylineEl = doc.querySelector('.byline, .author, [rel="author"], .article-author, .post-author');
        if (bylineEl?.textContent?.trim()) return bylineEl.textContent.trim();

        return '';
    }

    _extractDate(doc) {
        // Common meta tags for date
        const dateMeta = doc.querySelector(
            'meta[property="article:published_time"], meta[name="date"], meta[name="publish-date"], time[datetime]'
        );

        if (dateMeta) {
            return dateMeta.getAttribute('content') || dateMeta.getAttribute('datetime') || '';
        }

        return '';
    }
}
