    function getActiveCommentaryTab() {
        if (activeTabIndex === -1) return null;
        const tab = tabs[activeTabIndex];
        if (!tab || tab.isNewBookTab) return null;
        return tab;
    }

    // שמירה/טעינה של בחירת המפרשים האחרונה לכל ספר (ראו תיקון #11) - מפתח נפרד לכל ספר (לפי
    // tab.id), כדי שבפתיחה הבאה של אותו ספר לא יהיה צורך לבחור מחדש. אותו דפוס אחסון כפול כמו
    // saveSettings/mirrorToOtzariaStorage: localStorage כמקור עיקרי ומהיר, ומראה best-effort
    // ל-storage.* של אוצריא (אחסון SQLite אמיתי ששורד גם סגירת התוכנה) כרשת ביטחון.
    function commentarySelectionStorageKey(bookId) {
        return 'advanced_print_commentary_selection_' + bookId;
    }

    function saveActiveCommentatorsForBook(tab) {
        if (!tab || !tab.id) return;
        const key = commentarySelectionStorageKey(tab.id);
        const value = tab.activeCommentators || [];
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) { /* לא קריטי - הכתיבה ל-storage.* של אוצריא למטה היא רשת הביטחון */ }
        mirrorToOtzariaStorage(key, value);
    }

    // טוענת בחירה שמורה לספר נתון, אם קיימת - localStorage קודם, ואם ריק נופלים לאחסון הרשמי
    // של אוצריא (כמו loadFromOtzariaStorageFallback). מחזירה null אם אין שום בחירה שמורה,
    // כדי לאפשר נפילה חזרה לברירת המחדל הישנה (מה שפעיל כרגע בטאב הקריאה של אוצריא).
    async function loadActiveCommentatorsForBook(bookId) {
        const key = commentarySelectionStorageKey(bookId);
        try {
            const raw = localStorage.getItem(key);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) { /* נופל להמשך */ }
        try {
            const data = await loadFromOtzariaStorageFallback(key);
            if (Array.isArray(data)) return data;
        } catch (e) { /* אין בחירה שמורה - ימשיך לברירת המחדל הרגילה */ }
        return null;
    }

    // טוען את רשימת המפרשים המלאה של הספר (פעם אחת לכל טאב, בפתיחה ראשונה של החלונית עבורו)
    // וקובע ברירת מחדל לבחירת המפרשים הפעילים מתוך מה שפעיל כרגע בטאב הקריאה של אוצריא.
    async function initCommentaryDataForTab(tab) {
        tab.commentaryLoading = true;
        renderCommentaryBody(tab);
        try {
            const [groupedResponse, detailedResponse] = await Promise.all([
                Otzaria.call('library.getCommentators', {
                    bookId: tab.id,
                    grouped: true
                }),
                // grouped=true אינו מחזיר isRare; הקריאה השנייה מספקת את סימון הנדירות.
                Otzaria.call('library.getCommentators', { bookId: tab.id }).catch(() => null)
            ]);
            tab.commentaryGroups = (groupedResponse.data && groupedResponse.data.groups) || [];
            const flat = [];
            tab.commentaryGroups.forEach(g => (g.commentators || []).forEach(name => {
                if (!flat.includes(name)) flat.push(name);
            }));
            tab.commentaryAvailable = flat;
            tab.commentaryRare = new Set(
                (((detailedResponse && detailedResponse.data && detailedResponse.data.commentators) || []))
                    .filter(item => item && item.isRare)
                    .map(item => item.title)
            );
            tab.commentaryLoadError = false;
        } catch (e) {
            tab.commentaryGroups = [];
            tab.commentaryAvailable = [];
            tab.commentaryRare = new Set();
            tab.commentaryLoadError = true;
            tab.commentaryLoading = false;
            return; // נשאר "לא נטען" - הפתיחה הבאה של החלונית תנסה שוב, והבחירה השמורה לא נדרסת
        }

        // ברירת מחדל לבחירת המפרשים הפעילים: קודם כל בודקים אם יש בחירה שמורה מפעם קודמת
        // לספר הזה בדיוק. אם אין, נופלים לבחירה הפעילה כרגע בטאב הקריאה, תוך סינון למפרשי הספר.
        if (!Array.isArray(tab.activeCommentators)) {
            let defaults = null;
            try {
                const saved = await loadActiveCommentatorsForBook(tab.id);
                if (Array.isArray(saved)) {
                    defaults = saved.filter(name => tab.commentaryAvailable.includes(name));
                }
            } catch (e) { /* נופל לברירת המחדל הרגילה */ }
            if (defaults === null) {
                defaults = [];
                try {
                    const { data } = await Otzaria.call('reader.getActiveCommentators');
                    if (data && Array.isArray(data.active)) {
                        defaults = data.active.filter(name => tab.commentaryAvailable.includes(name));
                    }
                } catch (e) { /* אין ברירת מחדל זמינה - נשאר ריק */ }
            }
            tab.activeCommentators = defaults;
        }

        if (!Array.isArray(tab.commentaryPickerSelectedGroups)) tab.commentaryPickerSelectedGroups = [];
        if (!Array.isArray(tab.commentaryPickerSelectedTypes)) tab.commentaryPickerSelectedTypes = [];
        tab.commentaryLoading = false;
        tab.commentaryDataLoaded = true;
    }

    // מחזירה את אלמנטי ה-.print-page שמוצגים יחד "כרגע" כיחידה אחת: עלה שלם (2 עמודים) בתצוגת
    // ספר, שורת רשת שלמה (2 עמודים) בתצוגת "שני עמודים בשורה", או עמוד בודד בכל תצוגה אחרת.
    function getCurrentVisiblePrintPages() {
        const previewArea = document.getElementById('preview-area');
        const pages = Array.from(previewArea.querySelectorAll('.print-page'));
        if (pages.length === 0) return [];

        if (currentSettings.isBookView) {
            const a = currentLeaf * 2, b = currentLeaf * 2 + 1;
            return [pages[a], pages[b]].filter(Boolean);
        }

        const idx = getScrollCurrentPage();
        if (currentSettings.twoColumnScroll) {
            const pairStart = idx - (idx % 2);
            return [pages[pairStart], pages[pairStart + 1]].filter(Boolean);
        }
        return [pages[idx]].filter(Boolean);
    }

    // טווח שורות הטקסט הגולמי (data-line-idx, 0-based - אותה מערכת מספור בדיוק כמו ב-SDK) שמכוסה
    // על ידי העמוד/העמודים המוצגים כרגע יחד - null אם אין שום שורה מסומנת מוצגת בפועל.
    // טווח השורות של הטקסט המסומן כרגע בעמודים (אם יש סימון) - null כשאין סימון בתוך אזור התצוגה.
    // כשיש סימון, חלונית המפרשים/הקישורים/ההערות מציגה רק את מה שקשור לשורות המסומנות (ברמת שורה -
    // כך המפרשים והקישורים מקושרים בספרייה), ולא לכל העמוד/העמודים המוצגים.
    function getSelectedLineRange() {
        const sel = window.getSelection ? window.getSelection() : null;
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
        const previewArea = document.getElementById('preview-area');
        if (!previewArea) return null;
        const range = sel.getRangeAt(0);
        if (!previewArea.contains(range.commonAncestorContainer)) return null;

        const pageOf = (node) => {
            const el = node && (node.nodeType === 1 ? node : node.parentElement);
            return el ? el.closest('.print-page') : null;
        };
        const allPages = Array.from(previewArea.querySelectorAll('.print-page'));
        let from = allPages.indexOf(pageOf(range.startContainer));
        let to = allPages.indexOf(pageOf(range.endContainer));
        if (from === -1 && to === -1) {
            // הסימון מתחיל/נגמר מחוץ לעמוד עצמו (למשל על המכל) - בודקים רק את העמודים שנוגעים בו
            from = 0; to = allPages.length - 1;
        } else {
            if (from === -1) from = to;
            if (to === -1) to = from;
            if (from > to) { const t = from; from = to; to = t; }
        }

        let min = null, max = null;
        for (let pi = from; pi <= to; pi++) {
            const pageEl = allPages[pi];
            if (!pageEl || !range.intersectsNode(pageEl)) continue;
            pageEl.querySelectorAll('[data-line-idx]').forEach(el => {
                if (!range.intersectsNode(el)) return;
                const idx = parseInt(el.getAttribute('data-line-idx'), 10);
                if (isNaN(idx)) return;
                if (min === null || idx < min) min = idx;
                if (max === null || idx > max) max = idx;
            });
        }
        if (min === null) return null;
        return { start: min, end: max };
    }

    function getVisibleLineRange() {
        const selectedRange = getSelectedLineRange();
        if (selectedRange) return selectedRange;
        const visiblePages = getCurrentVisiblePrintPages();
        if (visiblePages.length === 0) return null;
        let min = null, max = null;
        visiblePages.forEach(pageEl => {
            pageEl.querySelectorAll('[data-line-idx]').forEach(el => {
                const idx = parseInt(el.getAttribute('data-line-idx'), 10);
                if (isNaN(idx)) return;
                if (min === null || idx < min) min = idx;
                if (max === null || idx > max) max = idx;
            });
        });
        if (min === null) return null;
        return { start: min, end: max };
    }

    // סימון טקסט (או ביטולו) מרענן את חלונית המפרשים - עם דיבאונס, ועם הקאש לפי טווח של
    // refreshCommentaryPanel כך שלא נשלחות בקשות מיותרות כשהטווח לא השתנה בפועל.
    let commentarySelectionTimer = null;
    document.addEventListener('selectionchange', () => {
        const tab = (typeof getActiveCommentaryTab === 'function') ? getActiveCommentaryTab() : null;
        if (!tab || !tab.commentaryPanelOpen) return;
        clearTimeout(commentarySelectionTimer);
        commentarySelectionTimer = setTimeout(() => refreshCommentaryPanel(), 250);
    });

    // --- הצגה/הסתרה של חלונית המפרשים (ידית בקצה התצוגה וכפתור סגירה בחלונית) ---

    // אותם תזמונים ועקומה כמו פתיחת/סגירת חלונית ההגדרות (.settings-panel): החלקה + דעיכה,
    // שמתחילות מיד בלחיצה ורצות על ה-compositor (transform/opacity בלבד).
    const COMMENTARY_PANEL_SLIDE_MS = 280;
    const COMMENTARY_PANEL_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

    function clearCommentaryPanelGhost(panelEl) {
        panelEl.classList.remove('closing');
        ['position', 'top', 'left', 'width', 'height', 'margin'].forEach(prop => panelEl.style.removeProperty(prop));
    }

    function setCommentaryPanelOpen(panelEl, isOpen) {
        if (!panelEl) return;

        if (panelEl.__commentaryPanelCloseTimer) {
            clearTimeout(panelEl.__commentaryPanelCloseTimer);
            panelEl.__commentaryPanelCloseTimer = null;
        }

        const handleEl = document.getElementById('btn-commentary-panel');
        const wasHidden = panelEl.hidden;
        const activeAnimation = panelEl.__commentaryPanelAnimation;
        // כמה מהחלונית כבר "בפנים" (0..1): נקודת המוצא כשהכיוון מתהפך באמצע אנימציה.
        const progress = wasHidden
            ? 0
            : activeAnimation
                ? Math.max(0, Math.min(1, Number.parseFloat(getComputedStyle(panelEl).opacity) || 0))
                : panelEl.classList.contains('open') ? 1 : 0;

        if (activeAnimation) {
            activeAnimation.onfinish = null;
            activeAnimation.cancel();
            panelEl.__commentaryPanelAnimation = null;
        }

        const animate = (from, to, side, onFinish) => {
            const reduceMotion = typeof window.matchMedia === 'function' &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (reduceMotion || typeof panelEl.animate !== 'function') {
                if (onFinish) onFinish();
                return null;
            }
            const tx = (p) => `translateX(${(1 - p) * 100 * side}%)`;
            const duration = Math.max(120, Math.round(COMMENTARY_PANEL_SLIDE_MS * Math.abs(to - from)));
            const animation = panelEl.animate([
                { opacity: from, transform: tx(from) },
                { opacity: to, transform: tx(to), offset: 1 }
            ], { duration, easing: COMMENTARY_PANEL_EASING, fill: 'none' });
            panelEl.__commentaryPanelAnimation = animation;
            animation.onfinish = () => {
                if (panelEl.__commentaryPanelAnimation !== animation) return;
                panelEl.__commentaryPanelAnimation = null;
                if (onFinish) onFinish();
            };
            return animation;
        };
        // לכיוון הקצה הקרוב של המסך (בדיוק כמו פאנל ההגדרות שנכנס מהצד שלו)
        const sideOf = (rect) => ((rect.left + rect.width / 2) < window.innerWidth / 2 ? -1 : 1);

        if (isOpen) {
            if (handleEl) handleEl.classList.add('active');
            clearCommentaryPanelGhost(panelEl);
            panelEl.hidden = false;
            panelEl.inert = false;
            panelEl.removeAttribute('aria-hidden');
            panelEl.classList.add('open');
            if (progress < 1) animate(progress, 1, sideOf(panelEl.getBoundingClientRect()));
            return;
        }

        if (panelEl.contains(document.activeElement)) {
            const opener = document.getElementById('btn-commentary-panel');
            if (opener && !opener.disabled) opener.focus();
        }
        panelEl.inert = true;
        panelEl.setAttribute('aria-hidden', 'true');

        const wasVisible = !wasHidden &&
            (panelEl.classList.contains('open') || panelEl.classList.contains('closing'));
        const finishClose = () => {
            if (panelEl.classList.contains('open')) return;
            clearCommentaryPanelGhost(panelEl);
            panelEl.hidden = true;
            if (handleEl) handleEl.classList.remove('active');
        };
        if (!wasVisible) {
            panelEl.classList.remove('open');
            finishClose();
            return;
        }

        // התוכן שמאחורי החלונית מקבל את הרוחב מיד (בלי להמתין לסיום האנימציה); החלונית עצמה
        // ממשיכה להחליק החוצה כשכבה צפה באותו מקום, כמו חלונית ההגדרות.
        const rect = panelEl.getBoundingClientRect();
        const side = sideOf(rect);
        const wasGhost = panelEl.classList.contains('closing');
        if (!wasGhost) {
            panelEl.style.position = 'fixed';
            panelEl.style.top = rect.top + 'px';
            panelEl.style.left = rect.left + 'px';
            panelEl.style.width = rect.width + 'px';
            panelEl.style.height = rect.height + 'px';
            panelEl.style.margin = '0';
            panelEl.classList.add('closing');
        }
        panelEl.classList.remove('open');
        const animation = animate(progress, 0, side, finishClose);
        if (animation) {
            panelEl.__commentaryPanelCloseTimer = setTimeout(() => {
                if (panelEl.__commentaryPanelAnimation !== animation) return;
                animation.onfinish = null;
                panelEl.__commentaryPanelAnimation = null;
                animation.cancel();
                panelEl.__commentaryPanelCloseTimer = null;
                finishClose();
            }, COMMENTARY_PANEL_SLIDE_MS + 120);
        } else {
            finishClose();
        }
    }

    function cancelCommentaryOpenRender(panelEl) {
        if (!panelEl) return;
        for (const key of ['__commentaryOpenRenderFrame1', '__commentaryOpenRenderFrame2']) {
            if (panelEl[key]) {
                cancelAnimationFrame(panelEl[key]);
                panelEl[key] = null;
            }
        }
    }

    function scheduleCommentaryOpenRender(tab, panelEl) {
        cancelCommentaryOpenRender(panelEl);
        // Let the open state reach the screen before rendering potentially large cached lists.
        panelEl.__commentaryOpenRenderFrame1 = requestAnimationFrame(() => {
            panelEl.__commentaryOpenRenderFrame1 = null;
            panelEl.__commentaryOpenRenderFrame2 = requestAnimationFrame(() => {
                panelEl.__commentaryOpenRenderFrame2 = null;
                if (getActiveCommentaryTab() !== tab || !tab.commentaryPanelOpen || panelEl.hidden) return;
                showCommentaryContentForTab(tab);
            });
        });
    }

    function toggleCommentaryPanel() {
        const tab = getActiveCommentaryTab();
        const panelEl = document.getElementById('commentary-panel');
        if (!tab || !panelEl) return; // אין ספר טעון - שום דבר לעשות

        tab.commentaryPanelOpen = !tab.commentaryPanelOpen;
        if (!tab.commentaryPanelOpen) cancelCommentaryOpenRender(panelEl);
        setCommentaryPanelOpen(panelEl, tab.commentaryPanelOpen);
        if (tab.commentaryPanelOpen) {
            syncCommentarySubTabButtonsUI(tab);
            scheduleCommentaryOpenRender(tab, panelEl);
        }
    }

    // טוענת (פעם אחת, גם אם נקראת שוב בזמן הטעינה) את רשימת המפרשים של הטאב ומציגה את תוכן החלונית.
    // התוצאה נכתבת למסך רק אם הטאב עדיין הפעיל והחלונית פתוחה.
    function showCommentaryContentForTab(tab) {
        const show = () => {
            if (getActiveCommentaryTab() !== tab || !tab.commentaryPanelOpen) return;
            renderCommentaryBody(tab);
            refreshCommentaryPanel();
        };
        if (tab.commentaryDataLoaded) { show(); return; }
        if (!tab.commentaryInitPromise) {
            tab.commentaryInitPromise = initCommentaryDataForTab(tab)
                .finally(() => { tab.commentaryInitPromise = null; });
        }
        tab.commentaryInitPromise.then(show);
    }

    // נקרא בכל מעבר טאב (switchTab) - מציג/מסתיר את החלונית לפי מצב הטאב החדש, ומרענן את
    // תוכנה אם היא פתוחה (בדיוק כמו שחזור מצב פאנל הניווט דרך isDrawerOpen למעלה בקובץ).
    function applyCommentaryPanelStateForActiveTab() {
        const panelEl = document.getElementById('commentary-panel');
        const btn = document.getElementById('btn-commentary-panel');
        if (!panelEl) return;
        const tab = getActiveCommentaryTab();
        const isOpen = Boolean(tab && tab.commentaryPanelOpen);
        setCommentaryPanelOpen(panelEl, isOpen);
        if (btn) {
            btn.disabled = !tab; // כמו כפתור ההדפסה - לא רלוונטי בטאב "ספר חדש"/ללא טאב פעיל
        }
        if (!tab || !isOpen) {
            if (panelEl) cancelCommentaryOpenRender(panelEl);
            return;
        }
        syncCommentarySubTabButtonsUI(tab);
        scheduleCommentaryOpenRender(tab, panelEl);
    }

    // --- לשוניות חלונית המפרשים (מפרשים / קישורים / הערות / בחירת מפרשים) ---

    // מעדכנת את מצב "פעיל" של כפתורי הלשוניות (העיצוב עם אייקון+תווית, ראו commentary-tab-btn),
    // נראות שורת הכלים (מוסתרת כליל בלשונית "בחירת מפרשים" - יש לה שורת כלים משלה) ונראות כפתור
    // בחירת המפרשים בתוך שורת הכלים (רלוונטי רק ללשונית "מפרשים") - לפי הלשונית השמורה על הטאב
    // (tab.commentaryActiveSubTab). נקראת גם כשפותחים את החלונית מחדש, כדי שהתצוגה תשקף את
    // הלשונית שהייתה פתוחה לאותו טאב לאחרונה.
    function syncCommentarySubTabButtonsUI(tab) {
        const name = (tab && tab.commentaryActiveSubTab) || 'commentary';
        const isPicker = (name === 'picker');
        const effectiveTabName = isPicker ? 'commentary' : name;
        document.querySelectorAll('#commentary-panel .commentary-tab-btn').forEach(btn => {
            const isActive = btn.dataset.subtab === effectiveTabName;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', String(isActive));
            btn.tabIndex = isActive ? 0 : -1;
        });
        const toolbarRow = document.getElementById('commentary-toolbar-row');
        const searchRow = document.getElementById('commentary-search-row');
        const linksTools = document.getElementById('commentary-links-tools');
        if (toolbarRow) toolbarRow.hidden = isPicker || effectiveTabName !== 'commentary';
        if (searchRow) searchRow.hidden = isPicker || effectiveTabName !== 'commentary' || !tab || !tab.commentarySearchOpen;
        if (linksTools) linksTools.hidden = isPicker || effectiveTabName !== 'links';
        const pickerAnchor = document.getElementById('commentary-picker-anchor');
        if (pickerAnchor) pickerAnchor.style.display = effectiveTabName === 'commentary' ? '' : 'none';
        const searchInput = document.getElementById('commentary-search-input');
        if (searchInput && searchInput.value !== ((tab && tab.commentarySearchQuery) || '')) {
            searchInput.value = (tab && tab.commentarySearchQuery) || '';
        }
        if (tab && effectiveTabName === 'links') renderCommentaryLinksFilters(tab);
    }


    function normalizedCommentarySearchText(value) {
        return String(value || '').toLowerCase()
            .replace(/[\u0591-\u05C7]/g, '')
            .replace(/["'״׳’”“\x60]/g, '')
            .replace(/[-–־,.]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // תוכן המפרשים והקישורים מגיע מספריית המשתמש (כולל ספרים פרטיים) והערות אישיות, ונכנס ל-innerHTML.
    // הניקוי נעשה במסמך אינרטי (DOMParser): בלי הרצת סקריפטים ובלי טעינת תמונות בזמן הניתוח.
    const COMMENTARY_BLOCKED_TAGS = 'script,style,iframe,object,embed,link,meta,base,form,svg,math';
    // רווחים/תווי בקרה בתוך הסכמה ("java&#9;script:") מוסרים לפני הבדיקה, כמו שהדפדפן עושה.
    const COMMENTARY_UNSAFE_URL = /^(javascript|vbscript|data:(?!image\/))/i;
    // style מוטמע יכול לטעון משאבי רשת (url()/@import/image-set) - מסירים רק כשיש כאלה.
    const COMMENTARY_UNSAFE_STYLE = /url\s*\(|@import|image-set|expression\s*\(|javascript:/i;

    function sanitizeCommentaryHtml(html) {
        const doc = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html');
        doc.body.querySelectorAll(COMMENTARY_BLOCKED_TAGS).forEach(el => el.remove());
        doc.body.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                const name = attr.name.toLowerCase();
                const isUrlAttr = name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action' || name === 'formaction';
                if (name.startsWith('on') || name === 'srcdoc' || (isUrlAttr && COMMENTARY_UNSAFE_URL.test(attr.value.replace(/[\u0000-\u0020]/g, ''))) ||
                    (name === 'style' && COMMENTARY_UNSAFE_STYLE.test(attr.value))) {
                    el.removeAttribute(attr.name);
                }
            });
        });
        return doc.body.innerHTML;
    }

    function escapeCommentaryText(text) {
        return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    }

    // HTML מנוקה וטקסט מנורמל לחיפוש - מחושבים פעם אחת לכל רשומה ונשמרים עליה.
    function commentaryEntryHtml(entry) {
        if (entry._html === undefined) entry._html = sanitizeCommentaryHtml(entry.content || '');
        return entry._html;
    }

    function commentaryEntryContentText(entry) {
        if (entry._contentText === undefined) {
            const doc = new DOMParser().parseFromString('<body>' + String(entry.content || '') + '</body>', 'text/html');
            entry._contentText = normalizedCommentarySearchText(doc.body.textContent);
        }
        return entry._contentText;
    }

    function toggleCommentarySearch() {
        const tab = getActiveCommentaryTab();
        if (!tab) return;
        tab.commentarySearchOpen = !tab.commentarySearchOpen;
        if (!tab.commentarySearchOpen) tab.commentarySearchQuery = '';
        syncCommentarySubTabButtonsUI(tab);
        if (tab.commentarySearchOpen) {
            document.getElementById('commentary-search-input')?.focus();
        } else {
            scheduleCommentarySearchRender(tab, true);
        }
    }

    // בניית הגוף מחדש בכל הקשה יקרה בהרבה רשומות, לכן הרינדור מושהה עד סוף ההקלדה
    let commentarySearchRenderTimer = null;
    function scheduleCommentarySearchRender(tab, immediate) {
        clearTimeout(commentarySearchRenderTimer);
        const run = () => { if (getActiveCommentaryTab() === tab) renderCommentaryBody(tab); };
        if (immediate) run(); else commentarySearchRenderTimer = setTimeout(run, 150);
    }

    function updateCommentarySearch(value, immediate) {
        const tab = getActiveCommentaryTab();
        if (!tab) return;
        tab.commentarySearchQuery = value || '';
        const row = document.getElementById('commentary-search-row');
        const clearButton = document.getElementById('commentary-search-clear');
        if (row) row.classList.toggle('has-query', Boolean(tab.commentarySearchQuery));
        if (clearButton) clearButton.hidden = !tab.commentarySearchQuery;
        scheduleCommentarySearchRender(tab, immediate);
    }

    function clearCommentarySearchInput() {
        const input = document.getElementById('commentary-search-input');
        if (!input) return;
        input.value = '';
        updateCommentarySearch('', true);
        input.focus();
    }

    function closeCommentarySearch() {
        const tab = getActiveCommentaryTab();
        if (!tab) return;
        tab.commentarySearchOpen = false;
        tab.commentarySearchQuery = '';
        const input = document.getElementById('commentary-search-input');
        if (input) input.value = '';
        const clearButton = document.getElementById('commentary-search-clear');
        if (clearButton) clearButton.hidden = true;
        document.getElementById('commentary-search-row')?.classList.remove('has-query');
        syncCommentarySubTabButtonsUI(tab);
        scheduleCommentarySearchRender(tab, true);
    }

    // ניווט בחצים בין הלשוניות (תבנית tablist): ימין/שמאל לפי כיוון הקריאה, Home/End לקצוות
    document.addEventListener('keydown', e => {
        const btn = e.target && e.target.closest && e.target.closest('#commentary-panel .commentary-tab-btn');
        if (!btn || e.ctrlKey || e.altKey || e.metaKey) return;
        const tabs = Array.from(document.querySelectorAll('#commentary-panel .commentary-tab-btn'));
        const i = tabs.indexOf(btn);
        let next = -1;
        if (e.key === 'ArrowLeft') next = (i + 1) % tabs.length;
        else if (e.key === 'ArrowRight') next = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        if (next < 0) return;
        e.preventDefault();
        e.stopPropagation();
        tabs[next].focus();
        switchCommentarySubTab(tabs[next].dataset.subtab);
    });

    function switchCommentarySubTab(name) {
        const tab = getActiveCommentaryTab();
        if (!tab || tab.commentaryActiveSubTab === name) return;
        tab.commentaryActiveSubTab = name;
        if (name === 'notes') tab.notesLoadError = false; // מעבר ללשונית הוא ניסיון חוזר מפורש
        syncCommentarySubTabButtonsUI(tab);
        // מציג מיד את מה שכבר קיים במטמון ללשונית הזו (גם אם עדיין ריק/במצב "טוען") - ואז טוען
        // מחדש רק אם צריך בפועל (טווח/בחירה השתנו מאז הפעם האחרונה שהלשונית הזו נטענה, או שזו
        // הפעם הראשונה שהיא נפתחת לטאב הזה) - ראו refreshCommentaryPanel.
        renderCommentaryBody(tab);
        refreshCommentaryPanel(false);
    }

    // --- לשונית "בחירת מפרשים" (מסך מלא בתוך גוף החלונית - ראו renderCommentaryPickerScreen) ---
    // נכנסים אליה רק דרך לחיצה על כפתור בחירת המפרשים (היא אינה אחת מלשוניות הכותרת הרגילות),
    // ויוצאים ממנה רק דרך חץ החזרה שבראשה - שמחזיר בדיוק ללשונית שממנה נכנסו (בפועל תמיד
    // "מפרשים", כי כפתור בחירת המפרשים מוצג רק שם).
    // מגביל מקביליות: רק הקריאה לגשר עצמה תופסת מקום (לא ההמתנה לתת-חלונות), ולכן אין קיפאון.
    function createCommentaryLimiter(max) {
        let active = 0;
        const queue = [];
        const next = () => {
            if (active >= max || queue.length === 0) return;
            active++;
            const { fn, resolve, reject } = queue.shift();
            Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
        };
        return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
    }

    async function fetchCommentaryPickerTypeLinksWindow(tab, startLine, endLine, connectionTypes, limiter) {
        try {
            const { data } = await limiter(() => Otzaria.call('library.getLinks', {
                bookId: tab.id,
                startLine,
                endLine,
                connectionTypes
            }));
            const links = data && Array.isArray(data.links) ? data.links : [];
            if (!data || !data.truncated) return { links, complete: Boolean(data) };
            if (startLine >= endLine) return { links, complete: false };

            // אם חלון צפוף נחתך במגבלת הרשומות, מחלקים אותו כדי לא לאבד סוגי
            // קישור שמופיעים בהמשך הטווח. כל תת-חלון נשאר בתוך מגבלת 200 השורות.
            const middle = Math.floor((startLine + endLine) / 2);
            const [left, right] = await Promise.all([
                fetchCommentaryPickerTypeLinksWindow(tab, startLine, middle, connectionTypes, limiter),
                fetchCommentaryPickerTypeLinksWindow(tab, middle + 1, endLine, connectionTypes, limiter)
            ]);
            return {
                links: [...left.links, ...right.links],
                complete: left.complete && right.complete
            };
        } catch (error) {
            return { links: [], complete: false };
        }
    }

    async function loadCommentaryPickerTypeLinks(tab, startLine, endLine, connectionTypes) {
        const windows = [];
        for (let start = startLine; start <= endLine; start += 200) {
            windows.push([
                start,
                Math.min(endLine, start + 199)
            ]);
        }
        // מגבלת מקביליות משותפת לכל הרמות (כולל חלוקה רקורסיבית של חלונות חתוכים).
        const limiter = tab._pickerLinksLimiter || (tab._pickerLinksLimiter = createCommentaryLimiter(4));
        const results = await Promise.all(windows.map(([start, end]) =>
            fetchCommentaryPickerTypeLinksWindow(tab, start, end, connectionTypes, limiter)
        ));
        return {
            links: results.flatMap(result => result.links),
            complete: results.every(result => result.complete)
        };
    }

    function loadCommentaryPickerContext(tab, force = false) {
        const range = getVisibleLineRange();
        const rangeKey = range ? `${range.start}-${range.end}` : 'empty';
        const cacheKey = `${tab.id}::${rangeKey}`;
        if (!force && tab.commentaryPickerContextKey === cacheKey) {
            if (tab.commentaryPickerContextLoaded) return Promise.resolve();
            if (tab.commentaryPickerContextPromise) return tab.commentaryPickerContextPromise;
        }

        tab.commentaryPickerContextKey = cacheKey;
        tab.commentaryPickerContextLoaded = false;
        tab.commentaryPickerContextPromise = null;
        tab.commentaryPickerContextError = false;
        if (!range) {
            tab.commentaryPickerContextToken = (tab.commentaryPickerContextToken || 0) + 1;
            tab.commentaryPickerLineRelevant = new Set();
            tab.commentaryPickerCommentatorsByType = {};
            tab.commentaryPickerContextLoaded = true;
            if (tab.commentaryActiveSubTab === 'picker') renderCommentaryPickerListOnly(tab);
            return Promise.resolve();
        }

        const requestToken = (tab.commentaryPickerContextToken = (tab.commentaryPickerContextToken || 0) + 1);
        const filterTypeOrder = ['TARGUM', 'MIDRASH', 'PARSHANUT', 'DIBUR_HAMATCHIL', 'ELUCIDATION'];
        const endLine = range.end;

        // ה-API הייעודי מחזיר בדיוק את המפרשים שיש להם קישור בטווח השורות,
        // בלי להסתמך על getLinks שעלול להיחתך במגבלת הרשומות.
        const relevantPromise = Otzaria.call('library.getCommentators', {
            bookId: tab.id,
            startLine: range.start,
            endLine
        }).then(({ data }) => data && Array.isArray(data.commentators) ? data.commentators : null)
            .catch(() => null);

        // ציר סוגי המפרשים משתמש רק בחמשת הסוגים שאוצריא מגדירה לסינון.
        // commentary ו-super-commentary אינם צ'יפים; explication ממופה בשרת
        // לסוג הקנוני ELUCIDATION.
        const typeLinksPromise = loadCommentaryPickerTypeLinks(
            tab,
            range.start,
            endLine,
            filterTypeOrder
        ).catch(() => null);

        const contextPromise = Promise.all([relevantPromise, typeLinksPromise]).then(([relevant, linkData]) => {
            if (tab.commentaryPickerContextToken !== requestToken) return;

            // null פירושו כשל, ולא רשימה ריקה — במקרה כזה לא מסתירים מפרשים נדירים.
            tab.commentaryPickerLineRelevant = relevant === null
                ? null
                : new Set(relevant.map(item => item && item.title).filter(Boolean));

            const byType = {};
            const linksComplete = Boolean(linkData && linkData.complete && Array.isArray(linkData.links));
            if (linksComplete) {
                linkData.links.forEach(link => {
                    if (!link || !link.targetTitle) return;
                    const type = normalizeLinkType(link.connectionType);
                    if (!filterTypeOrder.includes(type)) return;
                    if (!byType[type]) byType[type] = new Set();
                    byType[type].add(link.targetTitle);
                });
            }

            tab.commentaryPickerCommentatorsByType = byType;
            tab.commentaryPickerContextError = relevant === null || !linksComplete;
            tab.commentaryPickerContextLoaded = true;

            if (getActiveCommentaryTab() === tab && tab.commentaryPanelOpen && tab.commentaryActiveSubTab === 'picker') {
                renderCommentaryPickerListOnly(tab);
            }
        });

        tab.commentaryPickerContextPromise = contextPromise;
        return contextPromise;
    }

    function openCommentaryPickerScreen() {
        const tab = getActiveCommentaryTab();
        if (!tab) return;
        if (tab.commentaryActiveSubTab !== 'picker') {
            tab.commentaryPickerPreviousSubTab = tab.commentaryActiveSubTab || 'commentary';
        }
        tab.commentaryActiveSubTab = 'picker';
        syncCommentarySubTabButtonsUI(tab);
        renderCommentaryBody(tab);
        loadCommentaryPickerContext(tab, Boolean(tab.commentaryPickerContextError));
    }

    function closeCommentaryPickerScreen() {
        const tab = getActiveCommentaryTab();
        if (!tab) return;
        tab.commentaryActiveSubTab = tab.commentaryPickerPreviousSubTab || 'commentary';
        syncCommentarySubTabButtonsUI(tab);
        renderCommentaryBody(tab);
        refreshCommentaryPanel(false);
    }

    function buildCommentaryCheckboxEl(checked) {
        const box = document.createElement('span');
        box.className = 'commentary-picker-checkbox' + (checked ? ' checked' : '');
        box.innerHTML = fluentIconHTML('checkmark');
        return box;
    }

    function commentaryPickerTopicKey(value) {
        return String(value || '').toLowerCase()
            .replace(/["״׳'’]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function orderCommentarySelection(tab, names, visibleOrder = []) {
        const remaining = new Set(names);
        const ordered = [];
        visibleOrder.forEach(name => {
            if (remaining.delete(name)) ordered.push(name);
        });
        // מפרשים מוסתרים נשארים בבחירה ובסדר שבו כבר נשמרו.
        (tab.activeCommentators || []).forEach(name => {
            if (remaining.delete(name)) ordered.push(name);
        });
        (tab.commentaryGroups || []).forEach(group => {
            (group.commentators || []).forEach(name => {
                if (remaining.delete(name)) ordered.push(name);
            });
        });
        remaining.forEach(name => ordered.push(name));
        return ordered;
    }

    function renderCommentaryPickerScreen(tab, body) {
        body.innerHTML = '';
        const screen = document.createElement('div');
        screen.className = 'commentary-picker-screen';

        const header = document.createElement('div');
        header.className = 'commentary-picker-screen-header';
        const backButton = document.createElement('button');
        backButton.type = 'button';
        backButton.className = 'commentary-picker-back-btn';
        backButton.setAttribute('aria-label', 'חזרה למפרשים');
        backButton.setAttribute('data-tooltip', 'חזרה למפרשים');
        backButton.innerHTML = fluentIconHTML('arrow_left');
        backButton.addEventListener('click', closeCommentaryPickerScreen);

        const title = document.createElement('span');
        title.className = 'commentary-picker-screen-title';
        title.textContent = 'בחירת מפרשים';
        header.append(backButton, title);
        screen.appendChild(header);

        const chips = document.createElement('div');
        chips.className = 'commentary-picker-era-chips';
        chips.id = 'commentary-picker-era-chips';
        screen.appendChild(chips);

        const searchRow = document.createElement('div');
        searchRow.className = 'commentary-picker-search-row';
        searchRow.id = 'commentary-picker-search-row';
        searchRow.hidden = !(tab.commentaryPickerSearchOpen || tab.commentaryPickerSearchTerm);

        const searchField = document.createElement('div');
        searchField.className = 'commentary-picker-search-field';
        const searchIcon = document.createElement('span');
        searchIcon.className = 'commentary-picker-search-icon';
        searchIcon.innerHTML = otzariaIconHTML('search_in_library');
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.id = 'commentary-picker-search-input';
        searchInput.placeholder = 'סינון מפרשים...';
        searchInput.setAttribute('aria-label', 'סינון מפרשים');
        searchInput.value = tab.commentaryPickerSearchTerm || '';
        let pickerSearchTimer = null;
        searchInput.addEventListener('input', () => {
            tab.commentaryPickerSearchTerm = searchInput.value;
            clearSearchButton.hidden = !searchInput.value;
            clearTimeout(pickerSearchTimer);
            pickerSearchTimer = setTimeout(() => renderCommentaryPickerListOnly(tab), 120);
        });

        const clearSearchButton = document.createElement('button');
        clearSearchButton.type = 'button';
        clearSearchButton.className = 'commentary-picker-search-clear';
        clearSearchButton.hidden = !searchInput.value;
        clearSearchButton.setAttribute('aria-label', 'נקה חיפוש');
        clearSearchButton.setAttribute('data-tooltip', 'נקה חיפוש');
        clearSearchButton.innerHTML = fluentIconHTML('dismiss');
        clearSearchButton.addEventListener('click', () => {
            clearTimeout(pickerSearchTimer);
            tab.commentaryPickerSearchTerm = '';
            searchInput.value = '';
            clearSearchButton.hidden = true;
            renderCommentaryPickerListOnly(tab);
            searchInput.focus();
        });

        const closeSearch = document.createElement('button');
        closeSearch.type = 'button';
        closeSearch.className = 'commentary-picker-search-close';
        closeSearch.setAttribute('aria-label', 'סגור חיפוש');
        closeSearch.setAttribute('data-tooltip', 'סגור חיפוש');
        closeSearch.innerHTML = fluentIconHTML('dismiss');
        closeSearch.addEventListener('click', () => {
            tab.commentaryPickerSearchOpen = false;
            tab.commentaryPickerSearchTerm = '';
            searchInput.value = '';
            clearSearchButton.hidden = true;
            searchRow.hidden = true;
            screen.classList.remove('search-open');
            renderCommentaryPickerListOnly(tab);
            syncCommentaryPickerFloatingSearch();
        });
        searchField.append(searchIcon, searchInput, clearSearchButton);
        searchRow.append(searchField, closeSearch);
        screen.appendChild(searchRow);

        const list = document.createElement('div');
        list.className = 'commentary-picker-list';
        list.id = 'commentary-picker-list';

        const floatingSearchToggle = document.createElement('button');
        floatingSearchToggle.type = 'button';
        floatingSearchToggle.className = 'commentary-picker-search-toggle-floating';
        floatingSearchToggle.setAttribute('aria-label', 'סינון מפרשים');
        floatingSearchToggle.setAttribute('aria-hidden', 'true');
        floatingSearchToggle.tabIndex = -1;
        floatingSearchToggle.setAttribute('data-tooltip', 'סינון מפרשים');
        floatingSearchToggle.innerHTML = fluentIconHTML('search');
        floatingSearchToggle.addEventListener('click', () => {
            const inlineToggle = list.querySelector('.commentary-picker-search-toggle');
            if (inlineToggle) inlineToggle.click();
        });

        screen.append(list, floatingSearchToggle);
        list.addEventListener('scroll', syncCommentaryPickerFloatingSearch, { passive: true });

        body.appendChild(screen);
        renderCommentaryPickerListOnly(tab);
        syncCommentaryPickerFloatingSearch();
        if (!searchRow.hidden) searchInput.focus();
    }

    function syncCommentaryPickerFloatingSearch() {
        const screen = document.querySelector('.commentary-picker-screen');
        if (!screen) return;
        const list = screen.querySelector('.commentary-picker-list');
        const floating = screen.querySelector('.commentary-picker-search-toggle-floating');
        const searchRow = screen.querySelector('.commentary-picker-search-row');
        const header = list && list.querySelector('.commentary-picker-tree-header');
        if (!list || !floating || !searchRow || !header) {
            if (floating) {
                floating.classList.remove('is-visible');
                floating.setAttribute('aria-hidden', 'true');
                floating.tabIndex = -1;
            }
            return;
        }
        const listRect = list.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        const headerVisible = headerRect.bottom > listRect.top && headerRect.top < listRect.bottom;
        const shouldShow = searchRow.hidden && !headerVisible;
        floating.classList.toggle('is-visible', shouldShow);
        floating.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
        floating.tabIndex = shouldShow ? 0 : -1;
        if (shouldShow) {
            const screenRect = screen.getBoundingClientRect();
            floating.style.top = `${Math.round(listRect.top - screenRect.top + 10)}px`;
        }
    }

    function renderCommentaryPickerListOnly(tab) {
        const list = document.getElementById('commentary-picker-list');
        const chips = document.getElementById('commentary-picker-era-chips');
        if (!list || !chips) return;
        // הרשימה נבנית מחדש בכל שינוי; מחזירים את המיקוד לשורה שהייתה בו (אחרת הוא נופל ל-body)
        const focused = document.activeElement;
        const focusKey = focused && list.contains(focused) ? focused.dataset.pickerKey : null;
        list.replaceChildren();
        chips.replaceChildren();
        if (focusKey) {
            queueMicrotask(() => {
                const again = Array.from(list.querySelectorAll('[data-picker-key]')).find(el => el.dataset.pickerKey === focusKey);
                if (again) again.focus({ preventScroll: true });
            });
        }

        if (tab.commentaryLoadError) {
            const error = document.createElement('div');
            error.className = 'commentary-picker-empty';
            error.textContent = 'שגיאה בטעינת רשימת המפרשים';
            list.appendChild(error);
            syncCommentaryPickerFloatingSearch();
            return;
        }

        const groups = (tab.commentaryGroups || []).filter(group =>
            Array.isArray(group.commentators) && group.commentators.length > 0
        );
        list.classList.toggle('full-panel', groups.length === 0);
        if (groups.length === 0) {
            chips.hidden = true;
            const searchRow = document.getElementById('commentary-picker-search-row');
            if (searchRow) searchRow.hidden = true;
            const empty = document.createElement('div');
            empty.className = 'commentary-picker-empty full-panel';
            empty.innerHTML = otzariaIconHTML('links', 'commentary-picker-empty-icon');
            const label = document.createElement('div');
            label.textContent = 'אין מפרשים';
            empty.appendChild(label);
            list.appendChild(empty);
            syncCommentaryPickerFloatingSearch();
            return;
        }

        chips.hidden = false;
        const searchRow = document.getElementById('commentary-picker-search-row');
        if (searchRow) searchRow.hidden = !(tab.commentaryPickerSearchOpen || tab.commentaryPickerSearchTerm);
        const selected = new Set(tab.activeCommentators || []);
        const selectedTopics = new Set(tab.commentaryPickerSelectedGroups || []);
        const searchTerm = tab.commentaryPickerSearchTerm || '';
        const bookTopic = 'על ' + (tab.title || '');
        const rare = tab.commentaryRare instanceof Set ? tab.commentaryRare : new Set(tab.commentaryRare || []);
        const lineRelevant = tab.commentaryPickerLineRelevant instanceof Set
            ? tab.commentaryPickerLineRelevant
            : null;
        const byType = tab.commentaryPickerCommentatorsByType || {};
        const typeOrder = ['TARGUM', 'MIDRASH', 'PARSHANUT', 'DIBUR_HAMATCHIL', 'ELUCIDATION'];
        const availableTypeKeys = typeOrder.filter(type => {
            const names = byType[type];
            return names && Array.from(names).some(name => selected.has(name));
        });
        const storedTypes = new Set(tab.commentaryPickerSelectedTypes || []);
        const effectiveTypes = new Set(availableTypeKeys.filter(type => storedTypes.has(type)));
        const visibleTypeKeys = (availableTypeKeys.length > 1 || effectiveTypes.size > 0)
            ? availableTypeKeys
            : [];

        const allowedByType = new Set();
        effectiveTypes.forEach(type => {
            (byType[type] || []).forEach(name => allowedByType.add(name));
        });

        // זהה ל-_eraChipItems של אוצריא: חמש תקופות בלבד, ובנוסף "על הספר".
        // "שאר מפרשים" היא קבוצת ברירת מחדל ברשימה, לא צ'יפ סינון.
        const eraTopics = ['תורה שבכתב', 'חז"ל', 'ראשונים', 'אחרונים', 'מחברי זמננו'];
        const eraChipItems = eraTopics.filter(topic =>
            groups.some(group => commentaryPickerTopicKey(group.title) === commentaryPickerTopicKey(topic))
        );
        eraChipItems.push(bookTopic);

        const axes = document.createElement('div');
        axes.className = 'commentary-picker-chip-axes';
        const eraAxis = document.createElement('div');
        eraAxis.className = 'commentary-picker-chip-axis commentary-picker-era-axis' + (visibleTypeKeys.length ? '' : ' full-width');
        const makeChip = (label, selectedValue, onClick, kind) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `commentary-picker-chip ${kind}${selectedValue ? ' selected' : ''}`;
            chip.textContent = label;
            chip.setAttribute('aria-pressed', selectedValue ? 'true' : 'false');
            chip.addEventListener('click', onClick);
            return chip;
        };

        eraChipItems.forEach(label => {
            const isSelected = selectedTopics.has(label);
            eraAxis.appendChild(makeChip(label, isSelected, () => {
                const next = new Set(tab.commentaryPickerSelectedGroups || []);
                if (next.has(label)) next.delete(label);
                else next.add(label);
                tab.commentaryPickerSelectedGroups = Array.from(next);
                renderCommentaryPickerListOnly(tab);
            }, 'era-chip'));
        });
        axes.appendChild(eraAxis);

        if (visibleTypeKeys.length) {
            const divider = document.createElement('div');
            divider.className = 'commentary-picker-chip-divider';
            divider.setAttribute('aria-hidden', 'true');
            axes.appendChild(divider);

            const typeAxis = document.createElement('div');
            typeAxis.className = 'commentary-picker-chip-axis commentary-picker-type-axis';
            visibleTypeKeys.forEach(type => {
                const isSelected = effectiveTypes.has(type);
                typeAxis.appendChild(makeChip(COMMENTARY_LINK_TYPE_LABELS[type] || type, isSelected, () => {
                    const next = new Set(tab.commentaryPickerSelectedTypes || []);
                    if (next.has(type)) next.delete(type);
                    else next.add(type);
                    tab.commentaryPickerSelectedTypes = Array.from(next);
                    renderCommentaryPickerListOnly(tab);
                }, 'type-chip'));
            });
            axes.appendChild(typeAxis);
        }
        chips.appendChild(axes);

        const term = searchTerm.trim();
        const visibleEntries = groups.map(group => {
            const label = group.title || 'שאר מפרשים';
            const names = (group.commentators || []).filter(name => {
                if (rare.has(name) && lineRelevant && !lineRelevant.has(name)) return false;
                if (effectiveTypes.size && !allowedByType.has(name)) return false;
                if (term && !String(name).includes(term)) return false;
                if (selectedTopics.size) {
                    const groupTopic = commentaryPickerTopicKey(label);
                    const onBookTopic = commentaryPickerTopicKey(bookTopic);
                    const matchesTopic = Array.from(selectedTopics).some(topic => {
                        const normalized = commentaryPickerTopicKey(topic);
                        if (normalized === groupTopic) return true;
                        if (normalized === onBookTopic) return String(name).includes(bookTopic);
                        return false;
                    });
                    if (!matchesTopic) return false;
                }
                return true;
            });
            return { group, names };
        }).filter(entry => entry.names.length > 0);

        const listTitle = document.createElement('div');
        listTitle.className = 'commentary-picker-tree-header';
        const heading = document.createElement('span');
        heading.textContent = 'מפרשים על ' + (tab.title || 'הספר');
        const searchToggle = document.createElement('button');
        searchToggle.type = 'button';
        searchToggle.className = 'commentary-picker-search-toggle';
        searchToggle.setAttribute('aria-label', 'סינון מפרשים');
        searchToggle.setAttribute('data-tooltip', 'סינון מפרשים');
        searchToggle.innerHTML = fluentIconHTML('search');
        searchToggle.addEventListener('click', () => {
            const row = document.getElementById('commentary-picker-search-row');
            const input = document.getElementById('commentary-picker-search-input');
            if (!row || !input) return;
            const opening = row.hidden;
            tab.commentaryPickerSearchOpen = opening;
            if (!opening) {
                tab.commentaryPickerSearchTerm = '';
                input.value = '';
            }
            row.hidden = !opening;
            const pickerScreen = list.closest('.commentary-picker-screen');
            if (pickerScreen) pickerScreen.classList.toggle('search-open', opening);
            if (opening) input.focus();
            renderCommentaryPickerListOnly(tab);
            syncCommentaryPickerFloatingSearch();
        });
        listTitle.append(heading, searchToggle);
        list.appendChild(listTitle);

        const allVisibleNames = visibleEntries.flatMap(entry => entry.names);
        const uniqueVisibleNames = Array.from(new Set(allVisibleNames));
        if (uniqueVisibleNames.length === 0) {
            // באוצריא מוצג מצב ריק רק כשהחיפוש עצמו לא מצא התאמות.
            // סינון לפי צ'יפים ללא התאמות משאיר את הרשימה ריקה מתחת לכותרת.
            if (term) {
                const empty = document.createElement('div');
                empty.className = 'commentary-picker-empty search-empty';
                const icon = document.createElement('i');
                icon.className = 'ui-icon otzaria-icon commentary-picker-empty-icon';
                icon.textContent = String.fromCodePoint(otzariaIconCodePoint('search_in_library'));
                icon.setAttribute('aria-hidden', 'true');
                empty.appendChild(icon);
                const label = document.createElement('div');
                label.textContent = 'לא נמצאו מפרשים תואמים';
                empty.appendChild(label);
                list.appendChild(empty);
            }
            syncCommentaryPickerFloatingSearch();
            return;
        }

        const makeTreeRow = ({ label, kind, checked, onClick, selectedRow = false }) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'commentary-picker-tree-row ' + kind + (selectedRow ? ' selected' : '');
            row.setAttribute('aria-pressed', checked ? 'true' : 'false');
            row.dataset.pickerKey = kind + ':' + label;
            const iconBox = document.createElement('span');
            iconBox.className = 'commentary-picker-icon-box';
            iconBox.innerHTML = kind === 'book'
                ? otzariaIconHTML('book')
                : fluentIconHTML('folder');
            const labelEl = document.createElement('span');
            labelEl.className = 'commentary-picker-row-label';
            labelEl.textContent = label;
            row.append(iconBox, labelEl, buildCommentaryCheckboxEl(checked));
            row.addEventListener('click', onClick);
            return row;
        };
        const makeCard = () => {
            const card = document.createElement('div');
            card.className = 'commentary-picker-tree-card';
            return card;
        };
        // הנתונים של לשונית "מפרשים" נטענים מחדש בחזרה אליה (מפתח הטווח כולל את הבחירה)
        const commitSelection = next => {
            tab.activeCommentators = orderCommentarySelection(tab, Array.from(next), uniqueVisibleNames);
            saveActiveCommentatorsForBook(tab);
            renderCommentaryPickerListOnly(tab);
        };
        const updateSelection = names => {
            const allSelected = names.length > 0 && names.every(name => selected.has(name));
            const next = new Set(tab.activeCommentators || []);
            names.forEach(name => {
                if (allSelected) next.delete(name);
                else next.add(name);
            });
            commitSelection(next);
        };

        const masterCard = makeCard();
        const masterSelected = uniqueVisibleNames.every(name => selected.has(name));
        masterCard.appendChild(makeTreeRow({
            label: 'הצג את כל המפרשים',
            kind: 'category',
            checked: masterSelected,
            selectedRow: masterSelected,
            onClick: () => updateSelection(uniqueVisibleNames)
        }));
        list.appendChild(masterCard);

        visibleEntries.forEach(({ group, names }) => {
            const groupTitle = document.createElement('div');
            groupTitle.className = 'commentary-picker-era-heading';
            groupTitle.textContent = group.title || 'שאר מפרשים';
            list.appendChild(groupTitle);

            const card = makeCard();
            const groupSelected = names.every(name => selected.has(name));
            card.appendChild(makeTreeRow({
                label: 'הצג את כל ' + (group.title || 'המפרשים'),
                kind: 'category',
                checked: groupSelected,
                selectedRow: groupSelected,
                onClick: () => updateSelection(names)
            }));

            names.forEach(name => {
                const isSelected = selected.has(name);
                card.appendChild(makeTreeRow({
                    label: name,
                    kind: 'book',
                    checked: isSelected,
                    selectedRow: isSelected,
                    onClick: () => {
                        const next = new Set(tab.activeCommentators || []);
                        if (next.has(name)) next.delete(name);
                        else next.add(name);
                        commitSelection(next);
                    }
                }));
            });
            list.appendChild(card);
        });
        syncCommentaryPickerFloatingSearch();
    }

    // --- רינדור גוף החלונית (מפנה ללשונית הפעילה) ---

    function renderCommentaryBody(tab) {
        const body = document.getElementById('commentary-panel-body');
        if (!body) return;
        const subTab = tab.commentaryActiveSubTab || 'commentary';
        body.dataset.subtab = subTab;

        // שדות החיפוש הם חלק קבוע מהחלונית; מסנכרנים אותם ממצב הטאב הפעיל,
        // כולל פעולת הניקוי שמופיעה רק כשיש טקסט, כמו OtzariaSearchField.
        const commentarySearchInput = document.getElementById('commentary-search-input');
        const commentarySearchRow = document.getElementById('commentary-search-row');
        const commentarySearchClear = document.getElementById('commentary-search-clear');
        if (commentarySearchInput && document.activeElement !== commentarySearchInput) {
            commentarySearchInput.value = tab.commentarySearchQuery || '';
        }
        if (commentarySearchRow) commentarySearchRow.classList.toggle('has-query', Boolean(tab.commentarySearchQuery));
        if (commentarySearchClear) commentarySearchClear.hidden = !tab.commentarySearchQuery;

        const linksSearchInput = document.getElementById('commentary-links-search-input');
        const linksSearchRow = document.querySelector('.commentary-links-search-row');
        const linksSearchClear = document.getElementById('commentary-links-search-clear');
        const linksContentRow = document.getElementById('commentary-links-search-content-row');
        const linksContentCheckbox = document.getElementById('commentary-links-search-in-content');
        if (linksSearchInput && document.activeElement !== linksSearchInput) {
            linksSearchInput.value = tab.linksSearchQuery || '';
        }
        if (linksSearchRow) linksSearchRow.classList.toggle('has-query', Boolean(tab.linksSearchQuery));
        if (linksSearchClear) linksSearchClear.hidden = !tab.linksSearchQuery;
        if (linksContentRow) linksContentRow.hidden = !tab.linksSearchQuery;
        if (linksContentCheckbox) linksContentCheckbox.checked = Boolean(tab.linksSearchInContent);

        if (subTab === 'links') renderCommentaryLinksBody(tab, body);
        else if (subTab === 'notes') renderCommentaryNotesBody(tab, body);
        else if (subTab === 'picker') renderCommentaryPickerScreen(tab, body);
        else renderCommentaryMefarshimBody(tab, body);
        updateCommentaryExpandAllButtonUI(tab);
    }

    // === כיווץ/הרחבה של קבוצות מפרשים וקישורים ===
    // מצב הכיווץ עצמאי לכל טאב ולכל לשונית. מפתח חסר מתחיל פתוח במפרשים וסגור בקישורים,
    // כמו ברירות המחדל באוצריא.
    function getCommentaryExpandState(tab, subTabKey) {
        const key = subTabKey === 'links' ? 'linksGroupExpandState' : 'mefarshimGroupExpandState';
        if (!tab[key]) tab[key] = {};
        return tab[key];
    }

    function isCommentaryGroupExpanded(tab, subTabKey, name) {
        const state = getCommentaryExpandState(tab, subTabKey)[name];
        return typeof state === 'boolean' ? state : subTabKey !== 'links';
    }


    function normalizeLinkType(value) {
        const type = String(value || 'OTHER').trim().toUpperCase().replace(/[\s-]+/g, '_');
        const aliases = {
            NONE: 'OTHER',
            ESSAY: 'OTHER',
            QUOTATION_AUTO: 'QUOTATION',
            QUOTATION_AUTO_TANAKH: 'QUOTATION',
            RELATED_PASSAGE: 'RELATED',
            EXPLICATION: 'ELUCIDATION',
            SUPERCOMMENTARY: 'SUPER_COMMENTARY',
            'EIN_MISHPAT_/_NER_MITSVAH': 'EIN_MISHPAT',
            'EIN_MISHPAT_/_NER_MITZVAH': 'EIN_MISHPAT',
            SIFREI_MITSVOT: 'SIFREI_MITZVOT',
            FOOTNOTE: 'FOOTNOTES'
        };
        return aliases[type] || type || 'OTHER';
    }

    const COMMENTARY_LINK_TYPE_LABELS = {
        SOURCE: 'מקור',
        EIN_MISHPAT: 'עין משפט',
        SIFREI_MITZVOT: 'ספרי מצוות',
        MESORAT_HASHAS: 'מסורת הש"ס',
        MISHNAH_IN_TALMUD: 'משנה בתלמוד',
        QUOTATION: 'ציטוט',
        LAW: 'פסיקת הלכה',
        LITURGY: 'תפילה',
        SUMMARY: 'סיכום',
        FOOTNOTES: 'הערות שוליים',
        ALLUSION: 'אזכור',
        ALT_TOC: 'חלוקה חלופית',
        COMMENTARY: 'פירוש',
        SUPER_COMMENTARY: 'פירוש על פירוש',
        TARGUM: 'תרגום',
        MIDRASH: 'מדרש',
        PARSHANUT: 'פרשנות',
        DIBUR_HAMATCHIL: 'דיבור המתחיל',
        ELUCIDATION: 'ביאור',
        OTHER: 'לא מסווג',
        LINKER: 'אוטומטי'
    };
    const COMMENTARY_LINK_TYPE_ORDER = [
        'SOURCE', 'EIN_MISHPAT', 'SIFREI_MITZVOT', 'MESORAT_HASHAS',
        'MISHNAH_IN_TALMUD', 'QUOTATION', 'LAW', 'LITURGY', 'SUMMARY',
        'FOOTNOTES', 'ALLUSION', 'ALT_TOC', 'ON_BOOK'
    ];
    const LINK_ERA_ORDER = ['TORAH_SHEBICHTAV', 'CHAZAL', 'RISHONIM', 'ACHARONIM', 'MODERN', 'OTHER'];
    const LINK_ERA_LABELS = Object.freeze({
        TORAH_SHEBICHTAV: 'תורה שבכתב',
        CHAZAL: 'חז"ל',
        RISHONIM: 'ראשונים',
        ACHARONIM: 'אחרונים',
        MODERN: 'מחברי זמננו',
        OTHER: 'ספרים נוספים'
    });
    const LINK_ERA_GROUPED_TYPES = new Set(['OTHER', 'RELATED', 'REFERENCE', 'LINKER']);

    function linkSourceKey(entry) {
        return entry.targetSource || (entry.targetIsUserBook ? 'u' : 'o');
    }

    // המפתחות מחושבים פעם אחת לרשומה (הם נקראים בכל מיון, סינון ורינדור)
    function linkTargetBookKey(entry) {
        if (entry._bookKey === undefined) {
            entry._bookKey = JSON.stringify([
                entry.targetTitle || '',
                linkSourceKey(entry),
                entry.targetCategoryId ?? null
            ]);
        }
        return entry._bookKey;
    }

    function linkTargetIdentity(entry) {
        if (entry._identity === undefined) {
            entry._identity = JSON.stringify([
                entry.targetTitle || '',
                linkSourceKey(entry),
                entry.targetLine ?? null,
                entry.targetLineEnd ?? null,
                Boolean(entry.targetIsUserBook),
                entry.targetCategoryId ?? null,
                normalizeLinkType(entry.connectionType)
            ]);
        }
        return entry._identity;
    }

    function dedupeCommentaryLinkEntries(entries) {
        const seen = new Set();
        return (entries || []).filter(entry => {
            const key = linkTargetIdentity(entry);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    // BookDetails.generation uses the same Hebrew era categories as splitByEra.
    // For multiple categories, prefer the earliest one, as CommentaryService does.
    function normalizedLinkEra(value) {
        const normalize = text => String(text || '').trim().replace(/["״׳]/g, '').replace(/\s+/g, ' ');
        const categories = new Set(String(value || '').split(',').map(normalize).filter(Boolean));
        const ordered = [
            ['TORAH_SHEBICHTAV', 'תורה שבכתב'],
            ['CHAZAL', 'חז"ל'],
            ['RISHONIM', 'ראשונים'],
            ['ACHARONIM', 'אחרונים'],
            ['MODERN', 'מחברי זמננו']
        ];
        for (const [key, label] of ordered) {
            if (categories.has(label.replace(/["״׳]/g, ''))) return key;
        }
        return 'OTHER';
    }

    async function ensureLinkTargetEras(tab, entries, isStale) {
        if (!tab.linkEraCache) tab.linkEraCache = {};
        if (!tab.linkEraPending) tab.linkEraPending = {};
        const targets = new Map();
        (entries || []).forEach(entry => {
            if (!entry.targetTitle) return;
            targets.set(linkTargetBookKey(entry), entry);
        });
        const keys = Array.from(targets.keys());
        let nextIndex = 0;
        const worker = async () => {
            while (nextIndex < keys.length) {
                if (isStale && isStale()) return; // טווח שהוחלף באמצע: לא מתחילים בקשות חדשות
                const key = keys[nextIndex++];
                if (Object.prototype.hasOwnProperty.call(tab.linkEraCache, key)) continue;
                if (!tab.linkEraPending[key]) {
                    const target = targets.get(key);
                    const args = { bookId: target.targetTitle };
                    if (target.targetCategoryId != null) args.categoryId = target.targetCategoryId;
                    if (target.targetSource) args.source = target.targetSource;
                    tab.linkEraPending[key] = Otzaria.call('library.getBookDetails', args)
                        .then(({ data }) => normalizedLinkEra(data && data.generation))
                        .catch(() => null) // כשל זמני לא נשמר, כדי שההצגה הבאה תנסה שוב
                        .then(era => {
                            if (era) tab.linkEraCache[key] = era;
                            delete tab.linkEraPending[key];
                            return era;
                        });
                }
                await tab.linkEraPending[key];
            }
        };
        await Promise.all(Array.from({ length: Math.min(6, keys.length) }, () => worker()));
    }

    function linkEraForEntry(tab, entry) {
        const key = linkTargetBookKey(entry);
        return (tab.linkEraCache && tab.linkEraCache[key]) || 'OTHER';
    }

    function notesBookBaseTitle(title) {
        const prefix = 'הערות על ';
        if (!String(title || '').startsWith(prefix)) return null;
        const base = String(title).slice(prefix.length).trim();
        return base || null;
    }

    // Matches CommentaryService.sortLinksByEraSync: era -> base title ->
    // base book before its notes -> notes title -> target line.
    function sortCommentaryLinkEntries(tab, entries) {
        const presentTitles = new Set(entries.map(entry => entry.targetTitle).filter(Boolean));
        const entryByTitle = new Map();
        entries.forEach(entry => {
            if (entry.targetTitle && !entryByTitle.has(entry.targetTitle)) entryByTitle.set(entry.targetTitle, entry);
        });
        const baseByTitle = new Map();
        presentTitles.forEach(title => {
            const base = notesBookBaseTitle(title);
            baseByTitle.set(title, base && presentTitles.has(base) ? base : null);
        });
        const compareText = (a, b) => a < b ? -1 : (a > b ? 1 : 0);
        const anchorFor = title => baseByTitle.get(title) || title;
        const eraByTitle = new Map();
        const eraForTitle = title => {
            if (!eraByTitle.has(title)) {
                const anchorEntry = entryByTitle.get(anchorFor(title)) || entryByTitle.get(title);
                eraByTitle.set(title, anchorEntry ? LINK_ERA_ORDER.indexOf(linkEraForEntry(tab, anchorEntry)) : LINK_ERA_ORDER.indexOf('OTHER'));
            }
            return eraByTitle.get(title);
        };
        return entries.slice().sort((a, b) => {
            const titleA = String(a.targetTitle || '');
            const titleB = String(b.targetTitle || '');
            const anchorA = anchorFor(titleA);
            const anchorB = anchorFor(titleB);
            const eraCompare = eraForTitle(titleA) - eraForTitle(titleB);
            if (eraCompare) return eraCompare;
            const anchorCompare = compareText(anchorA, anchorB);
            if (anchorCompare) return anchorCompare;
            const noteA = baseByTitle.get(titleA) ? 1 : 0;
            const noteB = baseByTitle.get(titleB) ? 1 : 0;
            if (noteA !== noteB) return noteA - noteB;
            const titleCompare = compareText(titleA, titleB);
            if (titleCompare) return titleCompare;
            return (Number(a.targetLine) || 0) - (Number(b.targetLine) || 0);
        });
    }

    function linkFilterKeysForEntry(tab, entry) {
        const type = normalizeLinkType(entry.connectionType);
        const keys = new Set();
        if (LINK_ERA_GROUPED_TYPES.has(type)) {
            keys.add('ERA:' + linkEraForEntry(tab, entry));
        } else {
            keys.add(type);
        }
        const openBookTitle = String(tab.title || tab.bookTitle || tab.id || '').trim();
        if (openBookTitle && String(entry.targetTitle || '').includes('על ' + openBookTitle)) {
            keys.add('ON_BOOK');
        }
        return Array.from(keys);
    }

    function linkFilterLabel(key, tab) {
        if (key === 'ON_BOOK') return 'על ' + String(tab.title || tab.bookTitle || tab.id || '').trim();
        if (key.startsWith('ERA:')) return LINK_ERA_LABELS[key.slice(4)] || 'ספרים נוספים';
        return COMMENTARY_LINK_TYPE_LABELS[key] || key;
    }

    function buildCommentaryLinkChipKeys(tab, entries) {
        const typeKeys = new Set();
        const eraKeys = new Set();
        (entries || []).forEach(entry => {
            linkFilterKeysForEntry(tab, entry).forEach(key => {
                (key.startsWith('ERA:') ? eraKeys : typeKeys).add(key);
            });
        });
        const types = Array.from(typeKeys).sort((a, b) => {
            const ai = COMMENTARY_LINK_TYPE_ORDER.indexOf(a);
            const bi = COMMENTARY_LINK_TYPE_ORDER.indexOf(b);
            if (ai !== bi) {
                if (ai === -1) return 1;
                if (bi === -1) return -1;
                return ai - bi;
            }
            return a.localeCompare(b);
        });
        const eras = Array.from(eraKeys).sort((a, b) =>
            LINK_ERA_ORDER.indexOf(a.slice(4)) - LINK_ERA_ORDER.indexOf(b.slice(4))
        );
        return { types, eras };
    }

    function effectiveCommentaryLinkFilters(tab, entries) {
        const chips = buildCommentaryLinkChipKeys(tab, entries);
        const available = new Set([...chips.types, ...chips.eras]);
        return new Set((tab.selectedLinkTypes || []).filter(key => available.has(key)));
    }

    function renderCommentaryLinksFilters(tab) {
        const typeRow = document.getElementById('commentary-links-type-chips');
        const eraRow = document.getElementById('commentary-links-era-chips');
        const searchInput = document.getElementById('commentary-links-search-input');
        const contentRow = document.getElementById('commentary-links-search-content-row');
        const contentCheckbox = document.getElementById('commentary-links-search-in-content');
        if (!typeRow || !eraRow) return;
        const entries = dedupeCommentaryLinkEntries(tab.linksEntries || []);
        const chips = buildCommentaryLinkChipKeys(tab, entries);
        typeRow.replaceChildren();
        eraRow.replaceChildren();
        const selected = effectiveCommentaryLinkFilters(tab, entries);
        const addChip = (row, key) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'commentary-filter-chip' + (selected.has(key) ? ' selected' : '');
            button.textContent = linkFilterLabel(key, tab);
            button.setAttribute('aria-pressed', selected.has(key) ? 'true' : 'false');
            button.addEventListener('click', () => {
                const current = new Set(tab.selectedLinkTypes || []);
                if (current.has(key)) current.delete(key);
                else current.add(key);
                tab.selectedLinkTypes = Array.from(current);
                renderCommentaryLinksFilters(tab);
                renderCommentaryBody(tab);
            });
            row.appendChild(button);
        };
        chips.types.forEach(key => addChip(typeRow, key));
        chips.eras.forEach(key => addChip(eraRow, key));
        const total = chips.types.length + chips.eras.length;
        typeRow.hidden = total <= 1 || chips.types.length === 0;
        eraRow.hidden = total <= 1 || chips.eras.length === 0;
        const query = tab.linksSearchQuery || '';
        if (searchInput && searchInput.value !== query) searchInput.value = query;
        if (contentRow) contentRow.hidden = !query;
        if (contentCheckbox) contentCheckbox.checked = Boolean(tab.linksSearchInContent);
    }

    function updateCommentaryLinkSearch(value, immediate) {
        const tab = getActiveCommentaryTab();
        if (!tab) return;
        tab.linksSearchQuery = value || '';
        const row = document.querySelector('.commentary-links-search-row');
        const clearButton = document.getElementById('commentary-links-search-clear');
        if (row) row.classList.toggle('has-query', Boolean(tab.linksSearchQuery));
        if (clearButton) clearButton.hidden = !tab.linksSearchQuery;
        renderCommentaryLinksFilters(tab);
        scheduleCommentarySearchRender(tab, immediate);
    }

    function clearCommentaryLinksSearch() {
        const input = document.getElementById('commentary-links-search-input');
        if (!input) return;
        input.value = '';
        updateCommentaryLinkSearch('', true);
        input.focus();
    }

    function updateCommentaryLinkContentSearch(checked) {
        const tab = getActiveCommentaryTab();
        if (!tab) return;
        tab.linksSearchInContent = Boolean(checked);
        renderCommentaryBody(tab);
    }



    // מזהי הקבוצות והקישורים המוצגים, לפי סדר הרינדור, עבור כפתור "הרחב/כווץ הכל".
    function getCommentaryGroupNamesForSubTab(tab, subTabKey) {
        if (subTabKey === 'links') {
            return Array.from(new Set((tab.linksEntries || []).map(linkTargetIdentity)));
        }
        const entries = tab.commentaryEntries || [];
        const activeNames = tab.activeCommentators || [];
        return activeNames.filter(name => entries.some(e => e.targetTitle === name));
    }

    function syncCommentaryGroupExpansionElement(groupEl, expanded) {
        const headerEl = groupEl.querySelector('.commentary-entry-group-header');
        const contentEl = groupEl.querySelector('.commentary-entry-group-content');
        if (!headerEl || !contentEl) return;
        headerEl.classList.toggle('expanded', expanded);
        headerEl.setAttribute('aria-expanded', String(expanded));
        contentEl.classList.toggle('collapsed', !expanded);
        contentEl.inert = !expanded; // תוכן מכווץ לא נגיש במקלדת ובקורא מסך
    }

    function syncCommentaryGroupExpansionUI(tab, subTabKey, names) {
        const body = document.getElementById('commentary-panel-body');
        if (!body || body.dataset.subtab !== subTabKey) return false;
        const nameSet = new Set(names);
        const groups = body.querySelectorAll('.commentary-entry-group[data-subtab]');
        let changed = false;
        groups.forEach(groupEl => {
            if (groupEl.dataset.subtab !== subTabKey || !nameSet.has(groupEl.dataset.groupKey || '')) return;
            const key = groupEl.dataset.groupKey;
            syncCommentaryGroupExpansionElement(groupEl, isCommentaryGroupExpanded(tab, subTabKey, key));
            changed = true;
        });
        return changed;
    }

    function toggleCommentaryGroupExpand(tab, subTabKey, name) {
        const stateMap = getCommentaryExpandState(tab, subTabKey);
        stateMap[name] = !isCommentaryGroupExpanded(tab, subTabKey, name);
        if (!syncCommentaryGroupExpansionUI(tab, subTabKey, [name])) {
            renderCommentaryBody(tab);
        } else {
            updateCommentaryExpandAllButtonUI(tab);
        }
    }

    // כפתור "הרחב/כווץ הכל" (ליד כפתור בחירת המפרשים) - פועל על הלשונית הפעילה כרגע בלבד
    // (מפרשים/קישורים), בדיוק כמו toggleAllExpanded באוצריא עצמה. לא רלוונטי בלשונית "הערות".
    function toggleCommentaryGroupsExpandAll() {
        const tab = getActiveCommentaryTab();
        if (!tab) return;
        const subTab = tab.commentaryActiveSubTab || 'commentary';
        if (subTab === 'notes' || subTab === 'picker') return;
        const subTabKey = subTab === 'links' ? 'links' : 'commentary';
        const names = getCommentaryGroupNamesForSubTab(tab, subTabKey);
        if (names.length === 0) return;
        const stateMap = getCommentaryExpandState(tab, subTabKey);
        const allExpanded = names.every(n => isCommentaryGroupExpanded(tab, subTabKey, n));
        const newVal = !allExpanded;
        names.forEach(n => { stateMap[n] = newVal; });
        if (!syncCommentaryGroupExpansionUI(tab, subTabKey, names)) {
            renderCommentaryBody(tab);
        } else {
            updateCommentaryExpandAllButtonUI(tab);
        }
    }

    function updateCommentaryExpandAllButtonUI(tab) {
        const btn = document.getElementById('btn-commentary-expand-all');
        const icon = document.getElementById('commentary-expand-all-icon');
        if (!btn || !icon) return;
        if (!tab) { btn.disabled = true; return; }
        const subTab = tab.commentaryActiveSubTab || 'commentary';
        if (subTab === 'notes' || subTab === 'picker') {
            btn.disabled = true;
            btn.setAttribute('data-tooltip', 'לא רלוונטי כאן');
            return;
        }
        const subTabKey = subTab === 'links' ? 'links' : 'commentary';
        const names = getCommentaryGroupNamesForSubTab(tab, subTabKey);
        btn.disabled = names.length === 0;
        const allExpanded = names.length > 0 && names.every(n => isCommentaryGroupExpanded(tab, subTabKey, n));
        const label = subTab === 'links' ? 'הקישורים' : 'המפרשים';
        const iconName = allExpanded ? 'arrow_collapse_all' : 'arrow_expand_all';
        const tooltip = (allExpanded ? 'כווץ את כל ' : 'הרחב את כל ') + label;
        icon.textContent = String.fromCodePoint(fluentIconCodePoint(iconName));
        icon.classList.remove('ui-icon-filled');
        btn.setAttribute('data-tooltip', tooltip);
        btn.setAttribute('aria-label', tooltip);
    }

    // בונה קבוצת מפרשים או פריט קישור, עם כותרת לחיצה ותוכן נפתח.
    function buildCommentaryEntryGroupEl(tab, subTabKey, name, forThis, displayTitle = name) {
        const isExpanded = isCommentaryGroupExpanded(tab, subTabKey, name);

        const groupEl = document.createElement('div');
        groupEl.className = 'commentary-entry-group';
        groupEl.dataset.subtab = subTabKey;
        groupEl.dataset.groupKey = name;

        const headerEl = document.createElement('div');
        headerEl.className = 'commentary-entry-group-header' + (isExpanded ? ' expanded' : '');
        headerEl.setAttribute('role', 'button');
        headerEl.setAttribute('tabindex', '0');
        headerEl.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

        const chevronEl = document.createElement('span');
        chevronEl.className = 'commentary-entry-group-chevron';
        chevronEl.innerHTML = fluentIconHTML('chevron_down', 'rotate-90');

        const headingEl = document.createElement('span');
        headingEl.className = 'commentary-entry-group-heading';
        const titleEl = document.createElement('span');
        titleEl.className = 'commentary-entry-group-title';
        titleEl.textContent = displayTitle;
        headingEl.appendChild(titleEl);
        if (subTabKey === 'links' && forThis[0].targetHeRef) {
            const subtitleEl = document.createElement('span');
            subtitleEl.className = 'commentary-entry-group-subtitle';
            subtitleEl.textContent = forThis[0].targetHeRef;
            headingEl.appendChild(subtitleEl);
        }

        headerEl.appendChild(chevronEl);
        headerEl.appendChild(headingEl);
        const onToggle = () => toggleCommentaryGroupExpand(tab, subTabKey, name);
        headerEl.addEventListener('click', onToggle);
        headerEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onToggle();
            }
        });
        groupEl.appendChild(headerEl);

        const contentWrapEl = document.createElement('div');
        contentWrapEl.className = 'commentary-entry-group-content' + (isExpanded ? '' : ' collapsed');
        contentWrapEl.inert = !isExpanded;
        const innerEl = document.createElement('div');
        innerEl.className = 'commentary-entry-group-inner';

        forThis.forEach(entry => {
            const entryEl = document.createElement('div');
            entryEl.className = 'commentary-entry';
            if (subTabKey !== 'links' && entry.targetHeRef) {
                const refEl = document.createElement('div');
                refEl.className = 'commentary-entry-ref';
                refEl.textContent = entry.targetHeRef;
                entryEl.appendChild(refEl);
            }
            const contentEl = document.createElement('div');
            contentEl.className = 'commentary-entry-content';
            if (subTabKey === 'links' && !entry.content) {
                contentEl.classList.add('is-empty');
                contentEl.textContent = 'אין תוכן זמין';
            } else {
                contentEl.innerHTML = applyCommentaryTextFilters(commentaryEntryHtml(entry));
            }
            entryEl.appendChild(contentEl);
            innerEl.appendChild(entryEl);
        });
        contentWrapEl.appendChild(innerEl);

        groupEl.appendChild(contentWrapEl);
        return groupEl;
    }

    function renderCommentaryEmptyState(body, iconName, title, message, iconLibrary = 'otzaria') {
        const state = document.createElement('div');
        state.className = 'commentary-panel-empty';

        const icon = document.createElement('i');
        icon.className = `ui-icon commentary-panel-empty-icon${iconLibrary === 'otzaria' ? ' otzaria-icon' : ''}`;
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = String.fromCodePoint(
            iconLibrary === 'otzaria'
                ? otzariaIconCodePoint(iconName)
                : fluentIconCodePoint(iconName)
        );
        state.appendChild(icon);

        const titleEl = document.createElement('div');
        titleEl.className = 'commentary-panel-empty-title';
        titleEl.textContent = title;
        state.appendChild(titleEl);

        if (message) {
            const messageEl = document.createElement('div');
            messageEl.className = 'commentary-panel-empty-message';
            messageEl.textContent = message;
            state.appendChild(messageEl);
        }

        body.replaceChildren(state);
    }

    function renderCommentaryPanelStatus(body, message, isLoading = false) {
        const status = document.createElement('div');
        status.className = `commentary-panel-status${isLoading ? ' is-loading' : ''}`;
        status.textContent = message;
        status.setAttribute('role', isLoading ? 'status' : 'alert');
        body.replaceChildren(status);
    }

    function renderCommentaryPanelSpinner(body, label) {
        const status = document.createElement('div');
        status.className = 'commentary-panel-loading-indicator';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-label', label);
        status.innerHTML = '<svg class="preview-loading-spinner" viewBox="0 0 50 50" aria-hidden="true">' +
            '<circle class="preview-loading-path" cx="25" cy="25" r="20" fill="none" stroke-width="4" stroke-linecap="round"></circle>' +
            '</svg>';
        body.replaceChildren(status);
    }

    function renderCommentarySkeletonLoading(body, label = 'טוען תוכן מפרשים') {
        const root = document.createElement('div');
        root.className = 'commentary-loading-skeleton';
        root.setAttribute('role', 'status');
        root.setAttribute('aria-label', label);

        for (let index = 0; index < 4; index++) {
            const group = document.createElement('div');
            group.className = 'commentary-loading-skeleton-group';

            const titleLine = document.createElement('div');
            titleLine.className = 'commentary-loading-skeleton-title';
            group.appendChild(titleLine);

            const textLines = document.createElement('div');
            textLines.className = 'commentary-loading-skeleton-lines';
            [95, 92, 88].forEach(width => {
                const line = document.createElement('div');
                line.className = 'commentary-loading-skeleton-line';
                line.style.width = width + '%';
                textLines.appendChild(line);
            });
            group.appendChild(textLines);
            root.appendChild(group);
        }

        body.replaceChildren(root);
    }

    function renderCommentaryMefarshimBody(tab, body) {
        if (tab.commentaryLoading) {
            renderCommentaryPanelSpinner(body, 'טוען רשימת מפרשים');
            return;
        }
        if (tab.commentaryLoadError) {
            renderCommentaryPanelStatus(body, 'שגיאה בטעינת רשימת המפרשים לספר זה');
            return;
        }
        if (!Array.isArray(tab.activeCommentators) || tab.activeCommentators.length === 0) {
            renderCommentaryEmptyState(body, 'links', 'לא נבחרו מפרשים להצגה', 'בחר מפרשים באמצעות סמל הבחירה שלמעלה.');
            return;
        }
        if (tab.commentaryContentLoading) {
            renderCommentarySkeletonLoading(body);
            return;
        }
        if (tab.commentaryContentError) {
            renderCommentaryPanelStatus(body, 'שגיאה בטעינת המפרשים');
            return;
        }
        const entries = tab.commentaryEntries || [];
        const query = normalizedCommentarySearchText(tab.commentarySearchQuery);
        const visibleEntries = query
            ? entries.filter(entry => normalizedCommentarySearchText(
                (entry.targetTitle || '') + ' ' + (entry.targetHeRef || '')
            ).includes(query) || commentaryEntryContentText(entry).includes(query))
            : entries;
        if (visibleEntries.length === 0) {
            renderCommentaryEmptyState(body, 'links', query ? 'לא נמצאו מפרשים התואמים לחיפוש' : 'לא נמצאו מפרשים מהנבחרים לקטע זה');
            return;
        }

        body.innerHTML = '';
        // קיבוץ לפי מפרש, בסדר הבחירה של המשתמש (tab.activeCommentators) - כל מפרש עם רשימת
        // ה"פגיעות" שלו על הטווח המוצג, ממוינות לפי שורת המקור. הקבוצות פתוחות כברירת מחדל,
        // כמו ברשימת המפרשים באוצריא.
        tab.activeCommentators.forEach(name => {
            const forThis = visibleEntries.filter(e => e.targetTitle === name).sort((a, b) => a.sourceLine - b.sourceLine);
            if (forThis.length === 0) return;
            body.appendChild(buildCommentaryEntryGroupEl(tab, 'commentary', name, forThis));
        });
        if (!body.firstChild) {
            renderCommentaryEmptyState(body, 'links', 'לא נמצאו מפרשים מהנבחרים לקטע זה');
        }
    }

    // לשונית "קישורים" - הפניות/תרגומים וכדומה (כל קישור שאינו מפרש, isCommentary===false) על
    // הטווח המוצג. כל קישור מוצג כפריט נפרד עם כותרת והפניה, כמו ברשימת הקישורים באוצריא.
    function renderCommentaryLinksBody(tab, body) {
        if (tab.linksContentLoading) {
            // Use the same animated skeleton shown while commentary content is loading.
            renderCommentarySkeletonLoading(body, 'טוען קישורים');
            return;
        }
        if (tab.linksLoadError) {
            renderCommentaryPanelStatus(body, 'שגיאה בטעינת הקישורים');
            return;
        }
        const entries = dedupeCommentaryLinkEntries(tab.linksEntries || []);
        if (entries.length === 0) {
            renderCommentaryEmptyState(body, 'links', 'אין קישורים לטקסט הנראה במסך');
            return;
        }

        const selected = effectiveCommentaryLinkFilters(tab, entries);
        const typeFiltered = selected.size === 0
            ? entries
            : entries.filter(entry => linkFilterKeysForEntry(tab, entry).some(key => selected.has(key)));
        if (typeFiltered.length === 0) {
            renderCommentaryEmptyState(body, 'links', 'לא נמצאו קישורים מהסוגים שנבחרו');
            return;
        }

        const query = normalizedCommentarySearchText(tab.linksSearchQuery);
        const visibleEntries = query
            ? typeFiltered.filter(entry => {
                const titleAndRef = normalizedCommentarySearchText((entry.targetTitle || '') + ' ' + (entry.targetHeRef || ''));
                if (titleAndRef.includes(query)) return true;
                return Boolean(tab.linksSearchInContent) && commentaryEntryContentText(entry).includes(query);
            })
            : typeFiltered;
        if (visibleEntries.length === 0) {
            renderCommentaryEmptyState(body, 'links', 'לא נמצאו קישורים התואמים לחיפוש');
            return;
        }

        body.innerHTML = '';
        sortCommentaryLinkEntries(tab, visibleEntries).forEach(entry => {
            const entryKey = linkTargetIdentity(entry);
            body.appendChild(buildCommentaryEntryGroupEl(tab, 'links', entryKey, [entry], entry.targetTitle));
        });
    }

    // לשונית "הערות" - תצוגה בלבד. אוצריא כן חושפת API לקריאת הערות אישיות (notes.list), אבל אין
    // כרגע דרך לשמור הערה חדשה שנכתבת כאן בחזרה לתוך האפליקציה עצמה (notes.add/notes.update כן
    // קיימות ב-SDK, אך במכוון לא חוברו כאן) - כדי לא ליצור מצב מטעה שבו נראה כאילו אפשר "לכתוב"
    // הערה בתוסף והיא בעצם לא נשמרת/מסונכרנת עם ההערות האמיתיות של המשתמש באוצריא. לכן מוצגות
    // כאן רק הערות שכבר קיימות (שנכתבו במסך העיון הרגיל), ואין שום שדה קלט/כפתור הוספה.
    function renderCommentaryNotesBody(tab, body) {
        if (tab.notesContentLoading) {
            renderCommentaryPanelStatus(body, 'טוען הערות אישיות...', true);
            return;
        }
        if (tab.notesLoadError) {
            renderCommentaryPanelStatus(body, 'שגיאה בטעינת ההערות האישיות');
            return;
        }
        const entries = tab.notesEntries || [];
        if (entries.length === 0) {
            const message = getVisibleLineRange()
                ? 'אין הערות לטקסט הנראה במסך'
                : 'אין עדיין הערות על ספר זה';
            // OtzariaEmptyState מציג במצב קומפקטי סמל וכותרת בלבד.
            renderCommentaryEmptyState(body, 'note', message, null, 'fluent');
            return;
        }

        body.innerHTML = '';
        if (!tab.noteExpandState) tab.noteExpandState = {};
        entries.forEach(note => {
            const entryEl = document.createElement('div');
            entryEl.className = 'commentary-note-card';
            const headerEl = document.createElement('div');
            headerEl.className = 'commentary-note-header';
            const titleBlockEl = document.createElement('div');
            titleBlockEl.className = 'commentary-note-title-block';
            const titleEl = document.createElement('div');
            titleEl.className = 'commentary-note-title';
            titleEl.textContent = note.displayTitle || 'הערה';
            titleBlockEl.appendChild(titleEl);
            const lineNumber = Number.isInteger(note.lineNumber) ? note.lineNumber : null;
            if (lineNumber !== null) {
                const locationEl = document.createElement('div');
                locationEl.className = 'commentary-note-location';
                locationEl.textContent = `שורה ${lineNumber}`;
                titleBlockEl.appendChild(locationEl);
            }
            headerEl.appendChild(titleBlockEl);
            const isExpanded = Boolean(tab.noteExpandState[note.id]);
            const toggleButton = document.createElement('button');
            toggleButton.type = 'button';
            toggleButton.className = 'commentary-note-toggle';
            toggleButton.setAttribute('aria-expanded', String(isExpanded));
            toggleButton.setAttribute('aria-label', isExpanded ? 'סגור הערה' : 'פתח הערה');
            const toggleIcon = document.createElement('i');
            toggleIcon.className = `ui-icon${isExpanded ? ' expanded' : ''}`;
            toggleIcon.textContent = String.fromCodePoint(fluentIconCodePoint('chevron_down'));
            toggleIcon.setAttribute('aria-hidden', 'true');
            toggleButton.appendChild(toggleIcon);
            headerEl.appendChild(toggleButton);
            entryEl.appendChild(headerEl);
            const contentEl = document.createElement('div');
            contentEl.className = 'commentary-entry-content commentary-note-content';
            contentEl.innerHTML = applyCommentaryTextFilters(
                note.contentPlain ? escapeCommentaryText(note.contentPlain) : sanitizeCommentaryHtml(note.content));
            contentEl.hidden = !isExpanded;
            toggleButton.addEventListener('click', () => {
                const nextExpanded = contentEl.hidden;
                tab.noteExpandState[note.id] = nextExpanded;
                contentEl.hidden = !nextExpanded;
                toggleButton.setAttribute('aria-expanded', String(nextExpanded));
                toggleButton.setAttribute('aria-label', nextExpanded ? 'סגור הערה' : 'פתח הערה');
                toggleIcon.classList.toggle('expanded', nextExpanded);
            });
            entryEl.appendChild(contentEl);
            body.appendChild(entryEl);
        });
    }

    let commentaryRefreshDebounceTimer = null;

    // מפנה לפונקציית הרענון של הלשונית הפעילה כרגע בלבד - כך שנתוני לשונית שאינה מוצגת כרגע
    // (למשל "קישורים"/"הערות" בזמן שהמשתמש נמצא בלשונית "מפרשים") אף פעם לא נטענים מיותר, בדיוק
    // כמו העיקרון של "טוען רק כשהחלונית פתוחה" - כאן מוחל גם ברמת הלשונית הבודדת בתוך החלונית.
    function refreshCommentaryPanel(force) {
        const tab = getActiveCommentaryTab();
        if (!tab || !tab.commentaryPanelOpen) return;
        if (!tab.commentaryDataLoaded || tab.commentaryLoading) return; // עוד בטעינה ראשונית (רשימת המפרשים הבסיסית)

        const subTab = tab.commentaryActiveSubTab || 'commentary';
        if (subTab === 'links') refreshCommentaryLinksSubTab(tab, force);
        else if (subTab === 'notes') refreshCommentaryNotesSubTab(tab, force);
        else if (subTab === 'picker') loadCommentaryPickerContext(tab, false);
        else refreshCommentaryMefarshimSubTab(tab, force);
    }

    // מרעננת את לשונית "מפרשים" לפי הטווח המוצג כרגע - עם קאש לפי טווח+בחירה כדי לא לשלוח
    // בקשות רשת מיותרות (למשל בכל אירוע גלילה קטן באמצע אותו עמוד). force=true מדלג על הקאש
    // (למשל מיד אחרי שינוי בבחירת המפרשים עצמם, או פתיחת החלונית/מעבר ללשונית הזו מחדש).
    // מרעננת את לשונית "מפרשים" לפי הטווח המוצג כרגע - עם קאש לפי טווח+בחירה כדי לא לשלוח
    // בקשות רשת מיותרות. force=true מדלג על הקאש. הפונקציה הזו נקראת גם כש"מפרשים" אינה
    // הלשונית המוצגת בפועל כרגע (למשל בזמן שהמשתמש נמצא בלשונית "בחירת מפרשים" ומסמן/מבטל
    // מפרשים - ראו renderCommentaryPickerListOnly) כדי לרענן מראש את הנתונים ברקע לקראת
    // החזרה ללשונית "מפרשים"; לכן כל קריאות ה-renderCommentaryBody כאן מוגנות בבדיקת הלשונית
    // הפעילה, כדי שלא "יגנבו" ויחליפו בטעות את מה שמוצג בפועל על המסך כרגע (למשל את מסך
    // הבחירה עצמו).
    function refreshCommentaryMefarshimSubTab(tab, force) {
        const isVisible = () => (tab.commentaryActiveSubTab || 'commentary') === 'commentary';
        const range = getVisibleLineRange();
        if (!range) {
            tab.commentaryReqToken = (tab.commentaryReqToken || 0) + 1;
            tab.commentaryEntries = [];
            tab.commentaryLastRangeKey = null;
            tab.commentaryContentLoading = false;
            tab.commentaryContentError = false;
            if (isVisible()) renderCommentaryBody(tab);
            return;
        }

        const activeKey = tab.activeCommentators.slice().sort().join('\u0001');
        const rangeKey = range.start + '-' + range.end + '::' + activeKey;
        if (!force && tab.commentaryLastRangeKey === rangeKey) return; // כבר מוצג בדיוק זה

        const myToken = (tab.commentaryReqToken = (tab.commentaryReqToken || 0) + 1);
        if (tab.activeCommentators.length === 0) {
            tab.commentaryEntries = [];
            tab.commentaryLastRangeKey = rangeKey;
            tab.commentaryContentLoading = false;
            tab.commentaryContentError = false;
            if (isVisible()) renderCommentaryBody(tab);
            return;
        }

        tab.commentaryLastRangeKey = rangeKey;
        tab.commentaryContentLoading = true;
        tab.commentaryContentError = false;
        if (isVisible()) renderCommentaryBody(tab);

        const finish = (entries, failed) => {
            if (tab.commentaryReqToken !== myToken) return; // בקשה מיושנת (הוחלפה בבקשה חדשה) - התעלם
            tab.commentaryEntries = entries;
            tab.commentaryContentLoading = false;
            tab.commentaryContentError = failed;
            if (failed) tab.commentaryLastRangeKey = null; // כדי שהרענון הבא ינסה שוב
            if (getActiveCommentaryTab() === tab && tab.commentaryPanelOpen && isVisible()) renderCommentaryBody(tab);
        };
        loadCommentaryEntriesForRange(tab, range.start, range.end, () => tab.commentaryReqToken !== myToken)
            .then(entries => finish(entries, false), () => finish([], true));
    }

    // מבצעת בפועל את שתי הקריאות (getLinks + getLinkContent ב"אצוות" של עד 25) ומחזירה מערך
    // שטוח של {sourceLine, targetTitle, targetHeRef, content} - מסונן למפרשים הפעילים בלבד.
    async function loadCommentaryEntriesForRange(tab, startLine, endLine, isStale) {
        const clampedEnd = Math.min(endLine, startLine + 199);
        const { data } = await Otzaria.call('library.getLinks', {
            bookId: tab.id,
            startLine,
            endLine: clampedEnd,
            connectionTypes: [
                'COMMENTARY', 'SUPER_COMMENTARY', 'TARGUM', 'MIDRASH',
                'PARSHANUT', 'DIBUR_HAMATCHIL', 'ELUCIDATION', 'EXPLICATION', 'FOOTNOTES'
            ],
            targetTitles: tab.activeCommentators
        });
        const links = ((data && data.links) || []).filter(link => link.isCommentary === true);
        if (links.length === 0) return [];
        return fetchLinkContents(links, isStale);
    }

    // מרעננת את לשונית "קישורים" (הפניות/תרגומים - לא מפרשים) - אותו עיקרון קאש+דיבאונס-בקשה
    // כמו לשונית המפרשים, רק בלי תלות בבחירת מפרשים (אין כאן בחירה ידנית כלל).
    function refreshCommentaryLinksSubTab(tab, force) {
        const range = getVisibleLineRange();
        if (!range) {
            tab.linksReqToken = (tab.linksReqToken || 0) + 1;
            tab.linksEntries = [];
            tab.linksLastRangeKey = null;
            tab.linksLoadError = false;
            tab.linksContentLoading = false;
            renderCommentaryLinksFilters(tab);
            renderCommentaryBody(tab);
            return;
        }

        const rangeKey = range.start + '-' + range.end;
        if (!force && tab.linksLastRangeKey === rangeKey) return;

        tab.linksLastRangeKey = rangeKey;
        const myToken = (tab.linksReqToken = (tab.linksReqToken || 0) + 1);
        tab.linksContentLoading = true;
        renderCommentaryBody(tab);

        const isStale = () => tab.linksReqToken !== myToken;
        const finish = (entries, failed) => {
            if (isStale()) return;
            tab.linksEntries = entries;
            tab.linksLoadError = failed;
            tab.linksContentLoading = false;
            if (failed) tab.linksLastRangeKey = null; // כדי שהרענון הבא ינסה שוב
            if (getActiveCommentaryTab() === tab && tab.commentaryPanelOpen && tab.commentaryActiveSubTab === 'links') {
                renderCommentaryLinksFilters(tab);
                renderCommentaryBody(tab);
            }
        };
        loadNonCommentaryLinksForRange(tab, range.start, range.end, isStale).then(async entries => {
            // טווח שהוחלף (גלילה) לא שולח בקשות getBookDetails עבור קישורים שכבר לא יוצגו
            if (isStale()) return [];
            await ensureLinkTargetEras(tab, entries, isStale);
            return sortCommentaryLinkEntries(tab, dedupeCommentaryLinkEntries(entries));
        }).then(entries => finish(entries, false), () => finish([], true));
    }

    // כמו loadCommentaryEntriesForRange, אבל בלי סינון connectionTypes/targetTitles (כל
    // הקישורים בטווח) ואז מסננת בצד הלקוח רק את מה שאינו מפרש (isCommentary === false).
    async function loadNonCommentaryLinksForRange(tab, startLine, endLine, isStale) {
        const clampedEnd = Math.min(endLine, startLine + 199);
        const { data } = await Otzaria.call('library.getLinks', {
            bookId: tab.id,
            startLine,
            endLine: clampedEnd
        });
        const allLinks = (data && data.links) || [];
        const links = allLinks.filter(l => l.isCommentary === false);
        if (links.length === 0) return [];
        return fetchLinkContents(links, isStale);
    }

    // משותפת לשתי הלשוניות (מפרשים/קישורים) - שולפת תוכן בפועל עבור מערך links (מ-getLinks) דרך
    // library.getLinkContent, באצוות של עד 25 (מגבלת ה-API), ומחזירה מערך שטוח עם התוכן ממוזג.
    async function fetchLinkContents(links, isStale) {
        const contentByIndex = new Array(links.length).fill(null);
        const batchStarts = [];
        for (let i = 0; i < links.length; i += 25) batchStarts.push(i);
        // עד 3 אצוות במקביל; בקשה שכבר הוחלפה לא שולחת אצוות נוספות
        let nextBatch = 0;
        const worker = async () => {
            while (nextBatch < batchStarts.length) {
                if (isStale && isStale()) return;
                const i = batchStarts[nextBatch++];
                const { data: contentData } = await Otzaria.call('library.getLinkContent', {
                    links: links.slice(i, i + 25).map(l => ({
                        targetTitle: l.targetTitle,
                        targetLine: l.targetLine,
                        targetLineEnd: l.targetLineEnd,
                        targetIsUserBook: l.targetIsUserBook,
                        targetSource: l.targetSource,
                        targetCategoryId: l.targetCategoryId
                    }))
                });
                const items = (contentData && contentData.items) || [];
                items.forEach((item, j) => { contentByIndex[i + j] = item; });
            }
        };
        await Promise.all(Array.from({ length: Math.min(3, batchStarts.length) }, worker));

        const result = [];
        links.forEach((l, i) => {
            const item = contentByIndex[i];
            if (!item || item.error) return;
            result.push({
                sourceLine: l.sourceLine,
                targetTitle: l.targetTitle,
                targetHeRef: l.targetHeRef,
                targetLine: l.targetLine,
                targetLineEnd: l.targetLineEnd,
                targetIsUserBook: l.targetIsUserBook,
                targetSource: l.targetSource,
                targetCategoryId: l.targetCategoryId,
                connectionType: l.connectionType,
                content: item.content
            });
        });
        return result;
    }

    // מרעננת את לשונית "הערות" - תצוגה בלבד (ראו הסבר מפורט ב-renderCommentaryNotesBody). רשימת
    // ההערות המלאה של הספר (notes.list) נטענת פעם אחת בלבד לכל טאב (ה-API לא תומך בסינון טווח,
    // ומחזיר תמיד את כל הספר) ונשמרת במטמון (tab.notesFullList) - כל שינוי בטווח המוצג רק מסנן
    // ומרנדר מחדש מתוך המטמון הזה, בלי שום קריאת רשת נוספת.
    function refreshCommentaryNotesSubTab(tab, force) {
        const proceedWithFilter = () => {
            const range = getVisibleLineRange();
            tab.notesEntries = !range ? [] : (tab.notesFullList || [])
                .filter(n => typeof n.lineNumber === 'number' && n.lineNumber >= range.start && n.lineNumber <= range.end)
                .sort((a, b) => a.lineNumber - b.lineNumber);
            renderCommentaryBody(tab);
        };

        if (tab.notesFullListLoaded && !force) { proceedWithFilter(); return; }
        if (tab.notesFullListLoaded && force) {
            // force נדרש כאן רק בגלל שינוי טווח/לשונית - הרשימה המלאה עצמה לא משתנה בלי סגירה
            // ופתיחה מחדש של הטאב, כך שדי בסינון מחדש בלי לשלוף שוב את כל הספר מהרשת.
            proceedWithFilter();
            return;
        }

        if (tab.notesContentLoading) return; // בקשה כבר בדרך
        if (tab.notesLoadError && !force) return; // לא מנסים שוב בכל גלילה; פתיחה מחדש של הלשונית תנסה
        tab.notesContentLoading = true;
        tab.notesLoadError = false;
        renderCommentaryBody(tab);
        const showIfCurrent = apply => {
            tab.notesContentLoading = false;
            if (getActiveCommentaryTab() === tab && tab.commentaryPanelOpen && tab.commentaryActiveSubTab === 'notes') apply();
        };
        Otzaria.call('notes.list', { bookId: tab.id }).then(({ data }) => {
            tab.notesFullList = Array.isArray(data) ? data : [];
            tab.notesFullListLoaded = true;
            showIfCurrent(proceedWithFilter);
        }, () => {
            tab.notesLoadError = true;
            showIfCurrent(() => renderCommentaryBody(tab));
        });
    }


    /* ==========================================================================================
       מונה עמודים (X/X) וכותרת ניווט ממורכזת בסרגל הכלים.
       • מונה העמודים: המספר הכללי = מספר העמודים שנטענו עד כה; התיבה מציגה את העמוד הנוכחי
         ומאפשרת להקליד מספר עמוד ולעבור אליו (Enter).
       • כותרת הניווט: שם הספר והנתיב ההיררכי הנוכחי; לחצני המעבר מנווטים בין הכותרות
         שמופיעות בתוכן העניינים הרשמי, ובהיעדרו בין כותרות ה-DOM. בריחוף מוצג הנתיב המלא.
       ========================================================================================== */
    // רוחב המרכז כולל עכשיו ארבעה חיצים (תחילה/כותרת קודמת/כותרת הבאה/סוף) במקום שניים
    const NAV_CENTER_MAX_WIDTH = 528;
    // רוחב כותרת מזערי (ReaderNavCenter.minTitleWidth באוצריא); החיצים לא נספרים כאן - ראו layoutNavCenter
    const NAV_CENTER_MIN_WIDTH = 80;

    let navBarUpdateQueued = false;
    let navHeadingCache = null;   // { tab, key, items }
    let navBreadcrumbCache = null;
    let navHeadingLock = null;    // מונע "תקיעה" אחרי קפיצה לכותרת שלא ניתן ליישר בדיוק לראש התצוגה

    function scheduleNavBarUpdate() {
        if (navBarUpdateQueued) return;
        navBarUpdateQueued = true;
        requestAnimationFrame(() => {
            navBarUpdateQueued = false;
            try { updateNavBar(); } catch (e) { console.error('updateNavBar', e); }
        });
    }

    function getNavCurrentPageIndex(pages) {
        if (!pages || pages.length === 0) return -1;
        const raw = currentSettings.isBookView ? (currentLeaf * 2) : getScrollCurrentPage();
        return Math.min(Math.max(raw, 0), pages.length - 1);
    }

    // רשימת כל הכותרות שנטענו כרגע, באותן רמות שמוצגות בתוכן העניינים
    function getNavHeadingItems() {
        const tab = tabs[activeTabIndex];
        if (!tab || tab.isNewBookTab) return [];
        const previewArea = document.getElementById('preview-area');

        if (hasOfficialToc(tab)) {
            const loaded = getOfficialTocLoaded(tab);
            const key = 'o' + loaded.length;
            if (navHeadingCache && navHeadingCache.tab === tab && navHeadingCache.key === key && navHeadingCache.src === tab.officialToc) {
                return navHeadingCache.items;
            }
            const items = [];
            loaded.forEach(it => {
                const text = (it && it.text ? String(it.text) : '').trim();
                if (!text || typeof it.index !== 'number') return;
                const level = Math.max(1, parseInt(it.level, 10) || 1);
                items.push({ text, level, lineIndex: it.index, el: null });
            });
            navHeadingCache = { tab, key, items, src: tab.officialToc };
            return items;
        }

        const headings = Array.from(previewArea.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        const first = headings.length ? headings[0] : null;
        const key = 'd' + headings.length;
        if (navHeadingCache && navHeadingCache.tab === tab && navHeadingCache.key === key && navHeadingCache.first === first && !navHeadingCache.src) {
            return navHeadingCache.items;
        }
        const items = [];
        headings.forEach(h => {
            const text = h.textContent.trim();
            if (!text) return;
            items.push({ text, level: parseInt(h.tagName.substring(1), 10), lineIndex: null, el: h });
        });
        navHeadingCache = { tab, key, items, first, src: null };
        return items;
    }

    function getNavBreadcrumbItems() {
        const tab = tabs[activeTabIndex];
        if (!tab || tab.isNewBookTab) return [];
        const previewArea = document.getElementById('preview-area');

        if (hasOfficialToc(tab)) {
            const loaded = getOfficialTocLoaded(tab);
            const key = 'o' + loaded.length;
            if (navBreadcrumbCache && navBreadcrumbCache.tab === tab && navBreadcrumbCache.key === key && navBreadcrumbCache.src === tab.officialToc) {
                return navBreadcrumbCache.items;
            }
            const items = [];
            loaded.forEach(it => {
                const text = (it && it.text ? String(it.text) : '').trim();
                if (!text || typeof it.index !== 'number') return;
                const level = Math.max(1, parseInt(it.level, 10) || 1);
                items.push({ text, level, lineIndex: it.index, el: null });
            });
            navBreadcrumbCache = { tab, key, items, src: tab.officialToc };
            return items;
        }

        const headings = Array.from(previewArea.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        const first = headings.length ? headings[0] : null;
        const key = 'd' + headings.length;
        if (navBreadcrumbCache && navBreadcrumbCache.tab === tab && navBreadcrumbCache.key === key && navBreadcrumbCache.first === first && !navBreadcrumbCache.src) {
            return navBreadcrumbCache.items;
        }
        const items = [];
        headings.forEach(h => {
            const text = h.textContent.trim();
            if (!text) return;
            items.push({ text, level: parseInt(h.tagName.substring(1), 10), lineIndex: null, el: h });
        });
        navBreadcrumbCache = { tab, key, items, first, src: null };
        return items;
    }

    // השורה הראשונה (data-line-idx) שנראית בראש אזור התצוגה בגלילה רגילה
    function getFirstVisibleLineIdx(pages, pageIdx) {
        const previewArea = document.getElementById('preview-area');
        const areaTop = previewArea.getBoundingClientRect().top;
        const from = Math.max(0, pageIdx - 1);
        const to = Math.min(pages.length - 1, pageIdx + 2);
        for (let p = from; p <= to; p++) {
            if (pages[p].getBoundingClientRect().bottom <= areaTop + 1) continue;
            const marked = pages[p].querySelectorAll('[data-line-idx]');
            for (let i = 0; i < marked.length; i++) {
                if (marked[i].getBoundingClientRect().bottom > areaTop + 1) {
                    const v = parseInt(marked[i].getAttribute('data-line-idx'), 10);
                    if (!isNaN(v)) return v;
                }
            }
        }
        return null;
    }

    // מחזיר { idx, atHeading } - אינדקס הכותרת הנוכחית ברשימה (-1 אם אין) והאם התצוגה נמצאת בדיוק בראשה
    function computeCurrentNavHeading(items, respectHeadingLock = true) {
        if (items.length === 0) return { idx: -1, atHeading: false };
        const previewArea = document.getElementById('preview-area');
        const pages = Array.from(previewArea.querySelectorAll('.print-page'));
        const pageIdx = getNavCurrentPageIndex(pages);
        const isBook = Boolean(currentSettings.isBookView);

        if (respectHeadingLock && navHeadingLock) {
            const lockIdx = items.indexOf(navHeadingLock.item);
            const stillThere = isBook
                ? (navHeadingLock.isBook && navHeadingLock.pageIdx === pageIdx)
                : (!navHeadingLock.isBook && Math.abs(previewArea.scrollTop - navHeadingLock.scrollTop) <= 3);
            if (lockIdx >= 0 && stillThere) return { idx: lockIdx, atHeading: true };
            navHeadingLock = null;
        }

        const official = items[0].lineIndex !== null;
        if (official) {
            const line = isBook ? getCurrentDisplayedLineIndex() : getFirstVisibleLineIdx(pages, Math.max(pageIdx, 0));
            if (typeof line !== 'number') return { idx: -1, atHeading: false };
            let lo = 0, hi = items.length - 1, found = -1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (items[mid].lineIndex <= line) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
            }
            return { idx: found, atHeading: found >= 0 && items[found].lineIndex === line };
        }

        // כותרות DOM (בלי תוכן עניינים רשמי)
        if (isBook) {
            let found = -1;
            for (let i = 0; i < items.length; i++) {
                const pe = items[i].el.closest('.print-page');
                const pi = pe ? pages.indexOf(pe) : -1;
                if (pi !== -1 && pi <= pageIdx) found = i; else if (pi > pageIdx) break;
            }
            return { idx: found, atHeading: false };
        }
        const areaTop = previewArea.getBoundingClientRect().top;
        let lo = 0, hi = items.length - 1, found = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (items[mid].el.getBoundingClientRect().top <= areaTop + 4) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
        }
        const atHeading = found >= 0 && Math.abs(items[found].el.getBoundingClientRect().top - areaTop) <= 12;
        return { idx: found, atHeading };
    }

    // טקסט הכותרת מגיע גולמי מתוכן העניינים - מעבירים אותו דרך אותם סינונים של טקסט הספר (הסתרת שמות
    // קדושים כולל י"י, ניקוד, טעמים, פיסוק), כדי שהכותרת בסרגל תוצג בדיוק כמו בגוף הטקסט.
    let navTitleFilterCache = { key: '', value: '' };
    function filterNavTitleText(text) {
        if (!text) return '';
        const key = [text, currentSettings.holyNamesFilter, currentSettings.holyNamesDisplay, currentSettings.holyNamesYY,
            currentSettings.holyNamesAggressiveAlef, currentSettings.hideNikud, currentSettings.hideTeamim,
            currentSettings.hidePunctuation].join('|');
        if (navTitleFilterCache.key === key) return navTitleFilterCache.value;
        let value = text;
        try {
            const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const tmp = document.createElement('div');
            tmp.innerHTML = applyTextFilters(escaped);
            value = tmp.textContent;
        } catch (e) { value = text; }
        navTitleFilterCache = { key, value };
        return value;
    }

    function significantNavTitleWords(text) {
        return String(text)
            .replace(/[\u0591-\u05C7]/g, '')
            .replace(/["'״׳’”“`]/g, '')
            .replace(/[-–־,.]/g, ' ')
            .split(/\s+/)
            .map(word => word.trim())
            .filter(word => word.length > 2);
    }

    function buildNavTitle(tab, items, index) {
        const activePath = [];
        for (let i = 0; i <= index; i++) {
            const item = items[i];
            while (activePath.length && activePath[activePath.length - 1].level >= item.level) {
                activePath.pop();
            }
            activePath.push(item);
        }

        const location = activePath.map(item => filterNavTitleText(item.text)).filter(Boolean).join(', ');
        const bookTitle = tab && tab.title ? tab.title.trim() : '';
        if (!location) return bookTitle;
        if (!bookTitle || location.startsWith(bookTitle)) return location;

        const bookWords = significantNavTitleWords(bookTitle);
        const locationWords = new Set(significantNavTitleWords(location));
        if (bookWords.length > 0 && bookWords.every(word => locationWords.has(word))) return location;
        return bookTitle + ', ' + location;
    }

    function updateNavBar() {
        const previewArea = document.getElementById('preview-area');
        if (!previewArea) return;
        const tab = tabs[activeTabIndex];
        const hasBook = Boolean(tab && !tab.isNewBookTab);

        // ----- מונה עמודים -----
        const indicator = document.getElementById('page-indicator');
        const input = document.getElementById('page-indicator-input');
        const currentEl = document.getElementById('page-indicator-current');
        const totalEl = document.getElementById('page-indicator-total');
        if (indicator && input && currentEl && totalEl) {
            const pages = hasBook ? Array.from(previewArea.querySelectorAll('.print-page')) : [];
            const total = pages.length;
            const cur = total ? getNavCurrentPageIndex(pages) + 1 : 0;
            if (total === 0 && document.activeElement === input) input.blur();
            indicator.hidden = total === 0;
            currentEl.textContent = String(cur);
            totalEl.textContent = String(total);
            input.placeholder = `1-${total}`;
            if (document.activeElement !== input) input.value = String(cur);
        }

        // ----- כותרת ניווט -----
        const center = document.getElementById('toolbar-nav-center');
        const titleEl = document.getElementById('nav-heading-title');
        const prevBtn = document.getElementById('btn-heading-prev');
        const nextBtn = document.getElementById('btn-heading-next');
        if (center && titleEl && prevBtn && nextBtn) {
            const items = hasBook ? getNavHeadingItems() : [];
            const state = computeCurrentNavHeading(items);
            const breadcrumbItems = hasBook ? getNavBreadcrumbItems() : [];
            const breadcrumbState = computeCurrentNavHeading(breadcrumbItems, false);
            const shownTitle = hasBook ? buildNavTitle(tab, breadcrumbItems, breadcrumbState.idx) : '';
            titleEl.textContent = shownTitle;
            center.classList.toggle('nav-center-empty', items.length === 0);
            prevBtn.disabled = items.length === 0 || state.idx < 0 || (state.idx === 0 && state.atHeading);
            nextBtn.disabled = items.length === 0 || state.idx >= items.length - 1;
            // חיצי תחילת/סוף הספר פעילים כל עוד יש עמודים (לא תלויים בכותרות)
            const edgeHasPages = hasBook && previewArea.querySelector('.print-page') !== null;
            const startEdgeBtn = document.getElementById('btn-book-start');
            const endEdgeBtn = document.getElementById('btn-book-end');
            if (startEdgeBtn) startEdgeBtn.disabled = !edgeHasPages;
            if (endEdgeBtn) endEdgeBtn.disabled = !edgeHasPages;
        }
        layoutNavCenter();
    }

    // ---- מונה ומעבר לעמוד ----
    function beginPageIndicatorEdit() {
        const indicator = document.getElementById('page-indicator');
        const input = document.getElementById('page-indicator-input');
        if (!indicator || !input || indicator.hidden) return;

        const pages = Array.from(document.querySelectorAll('#preview-area .print-page'));
        const page = pages.length ? getNavCurrentPageIndex(pages) + 1 : 1;
        input.value = String(page);
        indicator.classList.add('is-editing');
        input.focus();
        input.select();
    }

    function onPageIndicatorKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const value = e.target.value.trim();
            const pages = document.querySelectorAll('#preview-area .print-page');
            const total = pages.length;
            if (/^\d+$/.test(value) && total > 0) {
                const page = Math.min(Math.max(Number(value), 1), total);
                goToPageIndex(page - 1);
            }
            e.target.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.target.blur();
        }
        e.stopPropagation(); // קיצורי המקלדת הכלליים לא צריכים להגיב להקלדה בתיבה
    }

    function onPageIndicatorBlur() {
        const indicator = document.getElementById('page-indicator');
        if (indicator) indicator.classList.remove('is-editing');
        scheduleNavBarUpdate();
        setTimeout(updateNavBar, 120);
    }

    // ---- מעבר לכותרת קודמת/הבאה ----
    function scrollElementToTopInScrollView(el) {
        const previewArea = document.getElementById('preview-area');
        const delta = el.getBoundingClientRect().top - previewArea.getBoundingClientRect().top;
        previewArea.scrollTo({ top: Math.max(0, previewArea.scrollTop + delta - 6), behavior: 'instant' });
    }

    function findMarkedElementForLine(targetIdx) {
        const previewArea = document.getElementById('preview-area');
        const marked = previewArea.querySelectorAll('[data-line-idx]');
        let bestEl = null, bestIdx = -1;
        for (let i = 0; i < marked.length; i++) {
            const v = parseInt(marked[i].getAttribute('data-line-idx'), 10);
            if (isNaN(v) || v > targetIdx) continue;
            if (v > bestIdx) { bestIdx = v; bestEl = marked[i]; }
        }
        return bestEl;
    }

    function goToAdjacentHeading(dir) {
        const items = getNavHeadingItems();
        if (items.length === 0) return;
        const state = computeCurrentNavHeading(items);
        let target;
        if (dir > 0) {
            target = state.idx + 1;
        } else {
            // באמצע קטע (לא בראש הכותרת הנוכחית) - "הקודמת" חוזרת לראש הכותרת הנוכחית, ורק משם לקודמת לה
            target = (state.idx >= 0 && !state.atHeading) ? state.idx : state.idx - 1;
        }
        if (target < 0 || target >= items.length) return;
        const item = items[target];
        const previewArea = document.getElementById('preview-area');
        const isBook = Boolean(currentSettings.isBookView);

        let targetEl = item.el;
        let pageIdx = -1;
        if (item.lineIndex !== null) {
            targetEl = findMarkedElementForLine(item.lineIndex);
            pageIdx = locatePageIndexForLineIndex(item.lineIndex);
        } else if (targetEl) {
            const pe = targetEl.closest('.print-page');
            pageIdx = pe ? Array.from(previewArea.querySelectorAll('.print-page')).indexOf(pe) : -1;
        }
        if (pageIdx < 0 && !targetEl) return;

        isScrollingFromTOC = true;
        if (isBook) {
            if (pageIdx >= 0) {
                currentLeaf = Math.floor(pageIdx / 2) + (pageIdx % 2);
                updateBookViewPages(true);
            }
        } else if (targetEl) {
            scrollElementToTopInScrollView(targetEl);
        } else {
            scrollToPageInScrollView(pageIdx);
        }
        setTimeout(() => { isScrollingFromTOC = false; }, 1500);

        const pagesNow = Array.from(previewArea.querySelectorAll('.print-page'));
        navHeadingLock = { item, isBook, pageIdx: getNavCurrentPageIndex(pagesNow), scrollTop: previewArea.scrollTop };
        requestAnimationFrame(() => {
            if (navHeadingLock && navHeadingLock.item === item) navHeadingLock.scrollTop = previewArea.scrollTop;
            scheduleNavBarUpdate();
        });
        scheduleNavBarUpdate();
    }

    // ---- רוחב קבוע וממורכז לכותרת; מוסתרת כשאין מקום (ובתצוגה מפוצלת) ----
    function layoutNavCenter() {
        const center = document.getElementById('toolbar-nav-center');
        const toolbar = document.getElementById('main-toolbar');
        if (!center || !toolbar) return;
        const splitHidden = document.body.classList.contains('split-pane-b') ||
            Boolean(document.querySelector('#split-view-wrapper.split-active'));
        if (splitHidden || toolbar.offsetWidth === 0) {
            center.classList.add('nav-center-hidden');
            toolbar.style.removeProperty('--nav-start-max');
            return;
        }
        // קודם מחליטים אילו כפתורים נשארים בסרגל ואילו עוברים לתפריט "עוד" (responsive-layout.js),
        // ורק אז מחלקים את המקום שנשאר בין הכותרת לחיצי הניווט
        if (typeof window.layoutToolbarActions === 'function') window.layoutToolbarActions();
        const startSide = toolbar.querySelector('.toolbar-side-start');
        const sides = toolbar.querySelectorAll(':scope > .toolbar-side');
        const endSide = sides[sides.length - 1];
        const padding = 14;
        const gapMargin = 10;
        // הצד הימני: כפתורי הסרגל; הצד השמאלי: כל הכפתורים (לא מצטמצם)
        let startFixed = 0;
        if (startSide) {
            const startGap = parseFloat(getComputedStyle(startSide).columnGap) || 8;
            startSide.querySelectorAll(':scope > button').forEach(b => { startFixed += b.offsetWidth + startGap; });
        }
        const tbRect = toolbar.getBoundingClientRect();
        const endRight = endSide ? (endSide.getBoundingClientRect().right - tbRect.left) : padding;
        // האזור הפנוי בין שני הצדדים (בקואורדינטות מהקצה השמאלי של הסרגל)
        const gapL = endRight + gapMargin;
        const gapR = toolbar.clientWidth - padding - startFixed - gapMargin;
        const gapW = gapR - gapL;
        const width = Math.min(NAV_CENTER_MAX_WIDTH, gapW);
        // כמו ReaderNavCenter באוצריא: ארבעת החיצים קודמים לכותרת - כל עוד הם נכנסים הם בסרגל והכותרת
        // מקבלת את מה שנשאר; כשאין מקום לארבעתם הם עוברים לשורת האייקונים שבראש התפריט "עוד", והכותרת
        // מקבלת את כל המרכז. מתחת לרוחב מזערי של כותרת (80) המרכז כולו מוסתר.
        const navBtn = (document.body.classList.contains('compact-toolbar') ||
            document.body.classList.contains('app-compact-density') || width < 240) ? 36 : 40;
        // מחוון העמודים הוא רכיב ברוחב קבוע בתוך המרכז, ולכן הוא חייב להיכלל
        // בחישוב רוחב החיצים; אחרת הוא עלול לגלוש על כפתורי הסרגל שבצדדים.
        // כשהמרכז מוסתר זמנית ברוחב קטן, מציגים אותו לרגע כדי למדוד את המחוון.
        const wasHidden = center.classList.contains('nav-center-hidden');
        if (wasHidden) center.classList.remove('nav-center-hidden');
        const indicatorEl = document.getElementById('page-indicator');
        const indicatorWidth = indicatorEl && !indicatorEl.hidden
            ? Math.ceil(indicatorEl.getBoundingClientRect().width)
            : 0;
        // 4 חיצים, כותרת ומחוון = 5 רווחים; בלי מחוון = 4 רווחים.
        const arrowsWidth = 4 * navBtn + indicatorWidth + (indicatorWidth > 0 ? 5 : 4) * 4;
        const arrowsFit = width >= arrowsWidth;
        window.__navArrowsInBar = arrowsFit;
        if (width < Math.max(NAV_CENTER_MIN_WIDTH, indicatorWidth)) {
            center.classList.add('nav-center-hidden');
            toolbar.style.removeProperty('--nav-start-max');
            window.__navArrowsInBar = false;
            if (typeof window.renderToolbarOverflowMenu === 'function') window.renderToolbarOverflowMenu();
            return;
        }
        center.classList.remove('nav-center-hidden');
        center.classList.toggle('nav-center-no-arrows', !arrowsFit);
        center.classList.toggle('nav-center-tight', width < 240);
        if (typeof window.renderToolbarOverflowMenu === 'function') window.renderToolbarOverflowMenu();
        // ממורכזת בסרגל כשיש מקום; אם לא - זזה בדיוק כמה שצריך כדי לא לכסות אף לחצן
        const idealLeft = toolbar.clientWidth / 2 - width / 2;
        const left = Math.max(gapL, Math.min(idealLeft, gapR - width));
        center.style.setProperty('--nav-center-w', Math.floor(width) + 'px');
        center.style.setProperty('--nav-center-left', Math.floor(left) + 'px');
        const startMax = toolbar.clientWidth - padding - (left + width) - gapMargin;
        toolbar.style.setProperty('--nav-start-max', Math.max(0, Math.floor(startMax)) + 'px');
    }

    // ---- בועת הכותרת המלאה בריחוף ----
    (function initNavBar() {
        if (window.top !== window.self) document.body.classList.add('split-pane-b');

        const previewArea = document.getElementById('preview-area');
        if (previewArea) {
            previewArea.addEventListener('scroll', scheduleNavBarUpdate, { passive: true });
            // עמודים שנוספים/מוחלפים (טעינה הדרגתית, מעבר טאב, עימוד מחדש) - עדכון המונה והכותרת
            new MutationObserver(scheduleNavBarUpdate).observe(previewArea, { childList: true, subtree: true });
        }
        window.addEventListener('resize', scheduleNavBarUpdate);
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(scheduleNavBarUpdate);
            const tb = document.getElementById('main-toolbar');
            if (tb) {
                ro.observe(tb);
                tb.querySelectorAll(':scope > .toolbar-side').forEach(el => ro.observe(el));
            }
        }
        scheduleNavBarUpdate();
    })();
