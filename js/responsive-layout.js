/* ==========================================================================================
   responsive-layout.js - התנהגות רספונסיבית זהה לזו של אוצריא (חצי מסך / מסכים קטנים)

   הערכים והאלגוריתמים כאן נלקחו מהקוד של אוצריא:
   • סרגל הכלים: ResponsiveActionBar / partitionToolbarActionsForWidth (סדר העברה לתפריט "...",
     קבוצה אטומית של זום+/זום-, שחזור LIFO) ו-ReaderNavCenter (ארבעת החיצים קודמים לכותרת;
     כשאין להם מקום הם עוברים לשורת האייקונים שבראש התפריט "עוד").
   • חלונית המפרשים: AdaptiveSidePane + SplitedViewScreen._calculatePaneWidths - דוחקת את
     הטקסט רק כשנשאר לו מקום (רוחב החלונית + 22 + 200), אחרת מרחפת מעליו עם הצללה.
   • חלונית הניווט: ראו updateNavigationPanelLayout ב-tabs-ui.js (סף דחיפה 520, כפתור נעיצה מ-600).
   • הדף עצמו: באוצריא הטקסט זורם לרוחב החלון. כאן הדפים בגודל קבוע (העימוד תלוי בגודל העמוד),
     ולכן ה"זרימה" היא התאמה אוטומטית לרוחב (זום ויזואלי בלבד - בלי עימוד מחדש), כל עוד המשתמש
     לא קבע זום ידני.
   ========================================================================================== */
(function () {
    'use strict';

    // ---- קבועים מאוצריא ----
    const OTZ = {
        compactWidth: 600,          // LayoutBreakpoints.compact (חלון צר)
        navMinTitle: 80,            // ReaderNavCenter.minTitleWidth
        navGap: 4,                  // ReaderNavCenter.navGap
        barSpacingReserve: 16,      // middleSpacing * 2 ב-AppTopBar
        commentaryMinPane: 280,     // _calculatePaneWidths.minPaneWidth
        commentaryMinText: 300,     // _calculatePaneWidths.minTextWidth
        commentaryMaxShare: 0.75,   // _calculatePaneWidths.maxPaneWidth
        commentaryMinMain: 200,     // AdaptiveSidePane.minMainContentWidth של חלונית המפרשים
        paneGaps: 22                // 10 (חיצוני) + 12 (פנימי) - ראו margin של #commentary-panel
    };
    window.OTZARIA_LAYOUT = OTZ;

    const $ = (id) => document.getElementById(id);

    function raf(fn) { return window.requestAnimationFrame(fn); }

    /* ==========================================================================
       1. סרגל הכלים: העברת כפתורים לתפריט "..." לפי רוחב ועדיפות
       ========================================================================== */

    // ככל שהמספר נמוך יותר - הכפתור עובר לתפריט קודם (toolbarOverflowOrder באוצריא):
    // חיפוש, מצב יד, זום (זוג אטומי), התאמה לרוחב, טורים, מסך מלא, מצב תצוגה, חזרה לתצוגה הרגילה.
    const ACTION_DEFS = [
        { id: 'backToReader', rootId: 'btn-back-to-reader', rank: 8 },
        { id: 'columns', rootId: 'column-anchor', rank: 5, popoverId: 'column-popover' },
        { id: 'viewMode', rootId: 'view-mode-anchor', rank: 7, popoverId: 'view-mode-menu' },
        { id: 'search', rootId: 'btn-toolbar-search', rank: 1 },
        { id: 'hand', rootId: 'btn-hand-mode', rank: 2 },
        { id: 'zoomIn', rootId: 'btn-increase-font', rank: 3, atomic: 'zoom' },
        { id: 'zoomOut', rootId: 'btn-decrease-font', rank: 3, atomic: 'zoom' },
        { id: 'fit', rootId: 'btn-fit-width', rank: 4 },
        { id: 'fullscreen', rootId: 'btn-toolbar-fullscreen', rank: 6 }
    ];

    // port של partitionToolbarActionsForWidth (responsive_action_bar.dart)
    function partitionActions(actions, maxWidth, overflowButtonWidth) {
        const indexed = actions.map((a, i) => ({ a, i }));
        const candidates = indexed.slice().sort((x, y) =>
            (x.a.rank - y.a.rank) || (y.i - x.i)); // באותה עדיפות מסתירים קודם את המאוחר בסדר התצוגה
        const hidden = new Set();
        const removedGroups = [];
        let visibleWidth = actions.reduce((s, a) => s + a.width, 0);
        const overflowRequired = true; // בתפריט תמיד יש פריטים קבועים (הדפסה, רענון)

        const mustHideMore = () =>
            (visibleWidth + (overflowRequired ? overflowButtonWidth : 0)) > maxWidth;

        let cursor = 0;
        while (mustHideMore() && cursor < candidates.length) {
            const candidate = candidates[cursor++];
            if (hidden.has(candidate.i)) continue;

            const groupMembers = candidate.a.atomic
                ? indexed.filter(e => !hidden.has(e.i) && e.a.atomic === candidate.a.atomic)
                : [candidate];

            const removed = [];
            groupMembers.forEach(m => {
                hidden.add(m.i);
                visibleWidth -= m.a.width;
                removed.push(m.i);
            });
            removedGroups.push(removed);

            // שחזור LIFO: מנסים להחזיר קבוצות שהוסרו קודם, מהאחרונה, אם נכנסות יחד
            for (let gi = removedGroups.length - 2; gi >= 0; gi--) {
                const groupIdx = removedGroups[gi];
                if (groupIdx.every(idx => !hidden.has(idx))) continue;
                const stillHidden = groupIdx.filter(idx => hidden.has(idx));
                const groupWidth = stillHidden.reduce((s, idx) => s + actions[idx].width, 0);
                if (visibleWidth + groupWidth + overflowButtonWidth <= maxWidth) {
                    stillHidden.forEach(idx => {
                        hidden.delete(idx);
                        visibleWidth += actions[idx].width;
                    });
                }
            }
        }
        return hidden;
    }

    let toolbarActions = null;       // [{def, root}]
    let hiddenActionIds = new Set();

    function getToolbarActions() {
        if (toolbarActions) return toolbarActions;
        toolbarActions = ACTION_DEFS
            .map(def => ({ def, root: $(def.rootId) }))
            .filter(a => a.root);
        return toolbarActions;
    }

    function getEndSide() {
        const toolbar = $('main-toolbar');
        if (!toolbar) return null;
        const sides = toolbar.querySelectorAll(':scope > .toolbar-side');
        return sides[sides.length - 1] || null;
    }

    function layoutToolbarActions() {
        const toolbar = $('main-toolbar');
        const startSide = toolbar && toolbar.querySelector('.toolbar-side-start');
        const endSide = getEndSide();
        const moreBtn = $('btn-more');
        if (!toolbar || !startSide || !endSide || !moreBtn || toolbar.offsetWidth === 0) return;

        const actions = getToolbarActions();
        // מדידה במצב "נקי": כל הכפתורים גלויים, והצד ההתחלתי לא מוגבל ברוחב
        actions.forEach(a => a.root.classList.remove('tb-overflowed'));
        toolbar.style.removeProperty('--nav-start-max');

        const gap = parseFloat(getComputedStyle(endSide).columnGap) || 4;
        const measured = actions.map(a => ({
            id: a.def.id,
            rank: a.def.rank,
            atomic: a.def.atomic || null,
            width: a.root.getBoundingClientRect().width + gap
        }));
        const overflowButtonWidth = moreBtn.getBoundingClientRect().width + gap;

        const cs = getComputedStyle(toolbar);
        const inner = toolbar.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
        // כמו AppTopBar האדפטיבי: הצד ההתחלתי נמדד קודם, והכותרת שומרת לפחות 80 פיקסלים;
        // פעולות הסרגל מקבלות את השאר
        const budget = inner - startSide.getBoundingClientRect().width - OTZ.navMinTitle - OTZ.barSpacingReserve;

        const hiddenIdx = partitionActions(measured, budget, overflowButtonWidth);
        hiddenActionIds = new Set();
        measured.forEach((m, i) => {
            if (hiddenIdx.has(i)) {
                hiddenActionIds.add(m.id);
                actions[i].root.classList.add('tb-overflowed');
            }
        });
        renderOverflowMenu();
    }

    /* ---- תוכן התפריט "עוד": שורת חיצי ניווט + פעולות שהוסתרו ---- */

    function cloneIcon(fromEl) {
        const icon = fromEl && fromEl.querySelector('.ui-icon');
        return icon ? icon.cloneNode(true) : null;
    }

    function makeMenuItem(label, iconEl, onClick, opts) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'popover-item more-menu-item overflow-item';
        if (opts && opts.radio) {
            btn.setAttribute('role', 'menuitemradio');
            btn.setAttribute('aria-checked', String(Boolean(opts.checked)));
        }
        if (opts && opts.disabled) btn.disabled = true;
        if (iconEl) btn.appendChild(iconEl);
        const span = document.createElement('span');
        span.className = 'more-menu-text';
        span.textContent = label;
        btn.appendChild(span);
        if (opts && opts.radio) {
            const check = document.createElement('i');
            check.className = 'ui-icon view-mode-check';
            check.setAttribute('aria-hidden', 'true');
            const ref = document.querySelector('.view-mode-check');
            check.textContent = ref ? ref.textContent : '';
            btn.appendChild(check);
        }
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof closeAllPopovers === 'function') closeAllPopovers();
            onClick();
        });
        return btn;
    }

    function makeDivider() {
        const d = document.createElement('div');
        d.className = 'more-menu-divider overflow-item';
        d.setAttribute('role', 'separator');
        return d;
    }

    // ארבעת חיצי הניווט: מופיעים בראש התפריט כשאין להם מקום בסרגל (ReaderNavCenter)
    const NAV_ARROWS = [
        { id: 'btn-book-start', flip: true },
        { id: 'btn-heading-prev', flip: true },
        { id: 'btn-heading-next', flip: true },
        { id: 'btn-book-end', flip: true }
    ];

    function renderNavRow(menu) {
        const row = document.createElement('div');
        row.className = 'more-menu-nav-row overflow-item';
        NAV_ARROWS.forEach(({ id }) => {
            const src = $(id);
            if (!src) return;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'more-menu-nav-btn';
            b.disabled = src.disabled;
            b.setAttribute('aria-label', src.getAttribute('data-tooltip') || '');
            b.title = src.getAttribute('data-tooltip') || '';
            const icon = cloneIcon(src);
            if (icon) b.appendChild(icon);
            // לחיצה לא סוגרת את התפריט (כמו _MenuIconActionRow באוצריא)
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                src.click();
                raf(() => {
                    row.querySelectorAll('.more-menu-nav-btn').forEach((nb, i) => {
                        const s = $(NAV_ARROWS[i].id);
                        if (s) nb.disabled = s.disabled;
                    });
                });
            });
            row.appendChild(b);
        });
        return row;
    }

    function renderOverflowMenu() {
        const menu = $('more-menu');
        if (!menu) return;
        menu.querySelectorAll('.overflow-item').forEach(el => el.remove());

        const frag = document.createDocumentFragment();
        let count = 0;

        const arrowsInBar = window.__navArrowsInBar !== false;
        const splitHidden = document.body.classList.contains('split-pane-b');
        if (!arrowsInBar && !splitHidden) {
            frag.appendChild(renderNavRow(menu));
            count++;
        }

        const hidden = getToolbarActions().filter(a => hiddenActionIds.has(a.def.id));
        if (count > 0 && hidden.length > 0) frag.appendChild(makeDivider());
        hidden.forEach(({ def, root }) => {
            if (def.popoverId) {
                // טורים / מצב תצוגה: כל האפשרויות כפריטי רדיו בתפריט
                const pop = $(def.popoverId);
                if (!pop) return;
                if (frag.childNodes.length > 0 && frag.lastChild.className.indexOf('more-menu-divider') === -1) {
                    frag.appendChild(makeDivider());
                }
                pop.querySelectorAll('.popover-item').forEach(opt => {
                    const label = (opt.querySelector('.view-mode-label') || opt).textContent.trim();
                    frag.appendChild(makeMenuItem(label, cloneIcon(opt), () => opt.click(), {
                        radio: true,
                        checked: opt.getAttribute('aria-checked') === 'true'
                    }));
                });
                frag.appendChild(makeDivider());
                count++;
                return;
            }
            const label = root.getAttribute('data-tooltip') || root.getAttribute('aria-label') || '';
            frag.appendChild(makeMenuItem(label, cloneIcon(root), () => root.click(), { disabled: root.disabled }));
            count++;
        });

        if (count === 0) return;
        // מפריד בין הפריטים המועברים לפריטים הקבועים של התפריט (הדפסה, רענון)
        if (frag.lastChild && frag.lastChild.className.indexOf('more-menu-divider') === -1) {
            frag.appendChild(makeDivider());
        }
        menu.insertBefore(frag, menu.firstChild);
    }

    // מצב הרדיו והפעיל/מושבת של הפריטים משתנים בזמן שהתפריט סגור - מרעננים בכל פתיחה
    const origToggleMoreMenu = window.toggleMoreMenu;
    if (typeof origToggleMoreMenu === 'function') {
        window.toggleMoreMenu = function (e) {
            renderOverflowMenu();
            return origToggleMoreMenu.apply(this, arguments);
        };
    }

    window.layoutToolbarActions = layoutToolbarActions;
    window.renderToolbarOverflowMenu = renderOverflowMenu;

    /* ==========================================================================
       2. חלונית המפרשים: דוחקת את הטקסט רק כשיש מקום, אחרת מרחפת עם הצללה
       ========================================================================== */

    function mainContentWidth() {
        const mc = document.querySelector('.main-content');
        return mc ? mc.clientWidth : window.innerWidth;
    }

    // _calculatePaneWidths ב-splited_view_screen.dart
    function commentaryWidths(available, savedWidth) {
        const min = OTZ.commentaryMinPane;
        const maxPane = Math.max(min, available * OTZ.commentaryMaxShare);
        const effectiveMax = Math.min(maxPane, Math.max(min, available - OTZ.commentaryMinText));
        const pane = Math.min(effectiveMax, Math.max(min, savedWidth || 340));
        return { pane, min, maxPane };
    }
    window.getCommentaryWidths = () => commentaryWidths(
        mainContentWidth(),
        (typeof currentSettings !== 'undefined' && currentSettings.commentaryPanelWidth) || 340);

    function updateCommentaryLayout() {
        const panel = $('commentary-panel');
        const scrim = $('commentary-scrim');
        if (!panel) return;
        const available = mainContentWidth();
        const saved = (typeof currentSettings !== 'undefined' && currentSettings.commentaryPanelWidth) || 340;
        const widths = commentaryWidths(available, saved);

        // רוחב החלונית - גם כשאין גרירה פעילה (בגרירה הרוחב נקבע ע"י הידית עצמה)
        if (!panel.classList.contains('resizing')) {
            panel.style.flexBasis = widths.pane + 'px';
            panel.style.width = widths.pane + 'px';
        }

        const hasRoom = available >= widths.pane + OTZ.paneGaps + OTZ.commentaryMinMain;
        const isOpen = panel.classList.contains('open');
        document.body.classList.toggle('commentary-overlay', !hasRoom);
        if (scrim) scrim.classList.toggle('visible', isOpen && !hasRoom);
    }
    window.updateCommentaryLayout = updateCommentaryLayout;

    // סגירה ב-Esc כשהחלונית מרחפת מעל התוכן (AdaptiveSidePane._handleKey)
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!document.body.classList.contains('commentary-overlay')) return;
        const panel = $('commentary-panel');
        if (!panel || !panel.classList.contains('open')) return;
        const ae = document.activeElement;
        if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
        if (typeof toggleCommentaryPanel === 'function') toggleCommentaryPanel();
    });

    // אחרי כל פתיחה/סגירה/מעבר טאב מעדכנים את מצב ההצללה והרוחב
    ['toggleCommentaryPanel', 'applyCommentaryPanelStateForActiveTab'].forEach(name => {
        const orig = window[name];
        if (typeof orig !== 'function') return;
        window[name] = function () {
            const r = orig.apply(this, arguments);
            updateCommentaryLayout();
            return r;
        };
    });

    /* ==========================================================================
       3. הדף: התאמה אוטומטית לרוחב כל עוד המשתמש לא קבע זום ידני
       ========================================================================== */

    const PX_PER_MM = 3.78;
    let userZoomed = false;      // זום+/זום-/גלגלת: מנצח התאמה אוטומטית
    let fitFollow = null;        // 'width' | 'page' | 'height' - המשתמש בחר "התאם" והמצב נשמר בשינוי גודל
    let autoFitActive = false;   // הדף הוקטן אוטומטית כי הוא לא נכנס ברוחב
    let scaleBeforeAutoFit = null;
    let suppressScalePersist = false;

    function wrapGlobal(name, make) {
        const orig = window[name];
        if (typeof orig === 'function') window[name] = make(orig);
    }

    wrapGlobal('zoomIn', (orig) => function () {
        userZoomed = true; fitFollow = null; autoFitActive = false;
        return orig.apply(this, arguments);
    });
    wrapGlobal('zoomOut', (orig) => function () {
        userZoomed = true; fitFollow = null; autoFitActive = false;
        return orig.apply(this, arguments);
    });

    const origFitToScreen = window.fitToScreen;
    if (typeof origFitToScreen === 'function') {
        window.fitToScreen = function (mode) {
            // קריאה יזומה של המשתמש (כפתור ההתאמה): המצב נשמר ומתעדכן בשינוי גודל
            userZoomed = false;
            autoFitActive = false;
            fitFollow = (mode === 'width' || mode === 'page' || mode === 'height') ? mode : null;
            return origFitToScreen.apply(this, arguments);
        };
    }

    // התאמה אוטומטית לא נשמרת כזום של המשתמש (אחרת ההפעלה הבאה במסך רחב הייתה קטנה)
    wrapGlobal('applyPageScale', (orig) => function () {
        if (!suppressScalePersist) return orig.apply(this, arguments);
        let before = null;
        try { before = localStorage.getItem('advanced_print_scale'); } catch (e) { /* ignore */ }
        const r = orig.apply(this, arguments);
        if (before !== null) {
            try { localStorage.setItem('advanced_print_scale', before); } catch (e) { /* ignore */ }
            if (typeof mirrorToOtzariaStorage === 'function') mirrorToOtzariaStorage('advanced_print_scale', before);
        }
        return r;
    });

    function silentFit(mode) {
        const keepNext = typeof nextFitMode !== 'undefined' ? nextFitMode : null;
        suppressScalePersist = true;
        try { origFitToScreen.call(window, mode); } finally { suppressScalePersist = false; }
        // כפתור ההתאמה נשאר כפי שהיה - ההתאמה האוטומטית לא "לחיצה" של המשתמש
        if (keepNext !== null && typeof updateFitModeButton === 'function') {
            nextFitMode = keepNext;
            updateFitModeButton();
        }
    }

    function pageNaturalWidthPx() {
        const mm = (typeof currentSettings !== 'undefined' && currentSettings.pageWidthMm) || 210;
        return mm * PX_PER_MM;
    }

    function evaluatePageFit() {
        if (typeof origFitToScreen !== 'function') return;
        const pa = $('preview-area');
        if (!pa || pa.clientWidth === 0 || document.body.classList.contains('split-pane-b')) return;
        const inBookView = typeof currentSettings !== 'undefined' && currentSettings.isBookView;
        if (inBookView || userZoomed) return;

        if (fitFollow) { // המשתמש בחר התאמה - ממשיכים להתאים בשינוי גודל
            try {
                suppressScalePersist = false;
                const keepNext = typeof nextFitMode !== 'undefined' ? nextFitMode : null;
                origFitToScreen.call(window, fitFollow);
                if (keepNext !== null && typeof updateFitModeButton === 'function') {
                    nextFitMode = keepNext;
                    updateFitModeButton();
                }
            } catch (e) { console.error('fit follow', e); }
            return;
        }

        const scrollbarW = Math.max(0, pa.offsetWidth - pa.clientWidth);
        const available = pa.clientWidth - scrollbarW;
        const base = autoFitActive && scaleBeforeAutoFit ? scaleBeforeAutoFit : pageScale;
        const needsFit = pageNaturalWidthPx() * base > available + 1;

        if (needsFit) {
            if (!autoFitActive) { scaleBeforeAutoFit = pageScale; autoFitActive = true; }
            silentFit('width');
        } else if (autoFitActive) {
            // חזרה לגודל שהמשתמש ראה לפני הצמצום
            autoFitActive = false;
            const restore = scaleBeforeAutoFit;
            scaleBeforeAutoFit = null;
            if (restore) {
                pageScale = restore;
                suppressScalePersist = true;
                try { applyPageScale(); } finally { suppressScalePersist = false; }
            }
        }
    }
    window.evaluatePageFit = evaluatePageFit;

    /* ==========================================================================
       חיווט: שינוי גודל חלון/אזורים
       ========================================================================== */

    let layoutQueued = false;
    function scheduleResponsiveLayout() {
        if (layoutQueued) return;
        layoutQueued = true;
        raf(() => {
            layoutQueued = false;
            try { updateCommentaryLayout(); } catch (e) { console.error('commentary layout', e); }
            try { layoutToolbarActions(); } catch (e) { console.error('toolbar layout', e); }
            if (typeof scheduleNavBarUpdate === 'function') scheduleNavBarUpdate();
        });
    }
    window.scheduleResponsiveLayout = scheduleResponsiveLayout;

    let fitTimer = null;
    function scheduleFitEvaluation() {
        clearTimeout(fitTimer);
        fitTimer = setTimeout(() => raf(evaluatePageFit), 120);
    }

    window.addEventListener('resize', () => { scheduleResponsiveLayout(); scheduleFitEvaluation(); });
    if (typeof ResizeObserver !== 'undefined') {
        const toolbar = $('main-toolbar');
        if (toolbar) {
            const ro = new ResizeObserver(scheduleResponsiveLayout);
            ro.observe(toolbar);
            const start = toolbar.querySelector('.toolbar-side-start');
            if (start) ro.observe(start);
        }
        const mc = document.querySelector('.main-content');
        if (mc) new ResizeObserver(() => { updateCommentaryLayout(); }).observe(mc);
        const pa = $('preview-area');
        if (pa) new ResizeObserver(scheduleFitEvaluation).observe(pa);
    }

    // הפעלה ראשונית: אחרי שהסרגל, האייקונים והעמודים קיימים
    function initialPass() {
        scheduleResponsiveLayout();
        scheduleFitEvaluation();
    }
    if (document.readyState === 'complete') initialPass();
    else window.addEventListener('load', initialPass);
    setTimeout(initialPass, 600);
})();
