/* שחזור מופע (session restore).
 *
 * כל מופע של התוסף (לשונית באוצריא) שומר דרך plugin.setRestoreState מה הוא מציג: ספר, שורה,
 * מספר טורים, גודל גופן ומצב חלונית המפרשים. כשהדף נטען מחדש - אחרי סגירה ופתיחה של התוכנה
 * (reason: 'session'), אחרי שאוצריא פינתה את הלשונית כדי לפנות זיכרון ('discarded'), אחרי קריסה
 * ('crashed') או טעינה מחדש ('reloaded') - plugin.boot מגיע עם restore.state, והספר נפתח ישר
 * באותה שורה. בזכות מטמון העימוד (pagination-cache.js) הפתיחה כמעט מיידית.
 *
 * הערה: מרגע שהתוסף שומר מצב, אוצריא רשאית לפנות את הלשונית כשהיא מושהית זמן רב. זה בסדר
 * כאן - השחזור מחזיר אותה כמו שהייתה.
 */
(function () {
    'use strict';

    const SCHEMA_VERSION = 1;
    const POLL_MS = 1500;          // בדיקת שינוי במצב (זולה: קריאה של כמה שדות)
    const MAX_STATE_BYTES = 60 * 1024; // המגבלה של אוצריא היא 64KB

    let armed = false;             // נשמר רק אחרי שה-boot טופל - אחרת היינו מוחקים מצב שעוד לא שוחזר
    let lastSavedJson = undefined; // undefined = עוד לא נשמר כלום; 'null' = נוקה
    let lineDirty = true;          // נדרש חישוב מחדש של השורה הנוכחית מה-DOM
    let saving = false;
    let pollTimer = null;
    let boundScroll = false;

    function hasHost() {
        return typeof Otzaria !== 'undefined' && Otzaria && typeof Otzaria.call === 'function';
    }

    // השורה הראשונה (data-line-idx) הנראית בראש אזור התצוגה. בתצוגת ספר - השורה הראשונה בעמוד
    // שבראש העלה הנוכחי. null כשאי אפשר לקבוע (אין עדיין עמודים).
    function computeCurrentLine(tab) {
        try {
            const previewArea = document.getElementById('preview-area');
            if (!previewArea) return null;
            const pages = Array.from(previewArea.querySelectorAll('.print-page'));
            if (pages.length === 0) return null;

            let startPage;
            if (currentSettings && currentSettings.isBookView) {
                startPage = Math.min(pages.length - 1, Math.max(0, (typeof currentLeaf === 'number' ? currentLeaf : 0) * 2));
                for (let p = startPage; p < Math.min(pages.length, startPage + 2); p++) {
                    const first = pages[p].querySelector('[data-line-idx]');
                    if (first) {
                        const v = parseInt(first.getAttribute('data-line-idx'), 10);
                        if (!isNaN(v)) return v;
                    }
                }
                return null;
            }

            startPage = getScrollCurrentPage();
            const areaTop = previewArea.getBoundingClientRect().top;
            const from = Math.max(0, startPage - 1);
            const to = Math.min(pages.length - 1, startPage + 2);
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
        } catch (e) { /* נשארים עם הערך הקודם */ }
        return null;
    }

    // האם אלמנט השורה (data-line-idx) מצויר כרגע ונראה (גם חלקית) באזור התצוגה
    function isLineVisible(lineIdx) {
        try {
            const pa = document.getElementById('preview-area');
            if (!pa) return false;
            const area = pa.getBoundingClientRect();
            const els = pa.querySelectorAll('[data-line-idx="' + lineIdx + '"]');
            for (let i = 0; i < els.length; i++) {
                const r = els[i].getBoundingClientRect();
                if (r.width > 0 && r.height > 0 && r.bottom > area.top + 1 && r.top < area.bottom - 1 && r.right > area.left && r.left < area.right) return true;
            }
        } catch (e) { /* לא נראה */ }
        return false;
    }

    // המצב לשמירה של הטאב הפעיל, או null כשאין מה לשחזר (מסך "בחר ספר", קובץ חיצוני, אין טאב)
    function collectState() {
        const tab = (typeof tabs !== 'undefined' && typeof activeTabIndex !== 'undefined') ? tabs[activeTabIndex] : null;
        if (!tab || tab.isNewBookTab || tab.isExternal || !tab.id) return null;

        let line = null;
        if (tab.pagesRendered && lineDirty && typeof tab._restoreLine === 'number' && isLineVisible(tab._restoreLine)) {
            // השורה ששמורה עדיין על המסך (למשל אחרי קפיצה אוטומטית לשורה מדויקת באמצע עמוד) - לא מזיזים אותה
            // לראש העמוד: אחרת כל פתיחה/שחזור היה גורם לסחף קטן אחורה בכל פעם
            lineDirty = false;
        } else if (tab.pagesRendered && lineDirty) {
            line = computeCurrentLine(tab);
            if (line !== null) { tab._restoreLine = line; lineDirty = false; }
        }
        if (typeof tab._restoreLine !== 'number') {
            // עוד לא עומד: הקפיצה שממתינה היא המיקום הנכון, ובלעדיה - תחילת הספר
            tab._restoreLine = (typeof tab.pendingScrollLineIndex === 'number') ? tab.pendingScrollLineIndex : 0;
        } else if (!tab.pagesRendered && typeof tab.pendingScrollLineIndex === 'number') {
            tab._restoreLine = tab.pendingScrollLineIndex;
        }

        return {
            schemaVersion: SCHEMA_VERSION,
            bookId: tab.id,
            title: tab.title || '',
            bookUid: tab.bookUid || null,
            line: tab._restoreLine,
            cols: tab.cols != null ? String(tab.cols) : null,
            fontSize: tab.fontSize != null ? tab.fontSize : null,
            commentaryPanelOpen: Boolean(tab.commentaryPanelOpen)
        };
    }

    async function pushState(force) {
        if (!armed || !hasHost() || saving) return;
        let state;
        try { state = collectState(); } catch (e) { return; }
        const json = JSON.stringify(state);
        if (!force && json === lastSavedJson) return;
        if (json && json.length > MAX_STATE_BYTES) return;
        saving = true;
        try {
            await Otzaria.call('plugin.setRestoreState', { state });
            lastSavedJson = json;
        } catch (e) {
            // כשל בשמירה לא קריטי - ננסה שוב בבדיקה הבאה (lastSavedJson לא עודכן)
        } finally {
            saving = false;
        }
    }

    function markLineDirty() { lineDirty = true; }

    function start() {
        armed = true;
        if (!boundScroll) {
            boundScroll = true;
            const pa = document.getElementById('preview-area');
            if (pa) pa.addEventListener('scroll', markLineDirty, { passive: true });
            // מעבר עמוד בתצוגת ספר ושינויי פריסה לא תמיד מייצרים אירוע גלילה
            document.addEventListener('click', markLineDirty, true);
            document.addEventListener('keydown', markLineDirty, true);
            const flush = () => { markLineDirty(); pushState(true); };
            document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
            window.addEventListener('pagehide', flush);
            try { if (typeof Otzaria !== 'undefined' && Otzaria.on) Otzaria.on('plugin.suspended', flush); } catch (e) { /* ignore */ }
        }
        if (!pollTimer) {
            pollTimer = setInterval(() => {
                // השורה מחושבת מחדש מה-DOM רק אחרי אינטראקציה (גלילה/לחיצה/מקלדת) - כך שמיד אחרי פתיחה או
                // שחזור נשארת השורה המדויקת שביקשו, ולא תחילת העמוד שהיא נמצאת בו
                pushState(false);
            }, POLL_MS);
        }
    }

    function isValidState(s) {
        return s && typeof s === 'object' && s.schemaVersion === SCHEMA_VERSION &&
            typeof s.bookId === 'string' && s.bookId.length > 0;
    }

    // מטפל ב-restore מ-plugin.boot. מחזיר true אם הספר נפתח מהמצב השמור (ואז אין לפתוח "בחר ספר").
    async function restoreFromBoot(payload) {
        const restore = payload && payload.restore;
        if (!restore || !isValidState(restore.state)) return false;
        const s = restore.state;
        try {
            // ההגדרות (גופן, שוליים וכו') חייבות להיטען לפני הפתיחה, אחרת חתימת הפריסה לא תתאים למטמון
            if (typeof settingsReadyPromise !== 'undefined' && settingsReadyPromise) await settingsReadyPromise;

            const line = (typeof s.line === 'number' && s.line >= 0) ? s.line : null;
            // הפרופס עוברים כבר ביצירת הטאב: חתימת הפריסה של מטמון העימוד נקבעת מיד בפתיחה, ולכן
            // טורים וגודל גופן חייבים להיות על הטאב לפני switchTab ולא להתעדכן אחריו
            const props = { _restoreLine: line !== null ? line : 0 };
            if (s.cols != null) props.cols = String(s.cols);
            if (typeof s.fontSize === 'number' && s.fontSize > 0) props.fontSize = s.fontSize;
            if (s.commentaryPanelOpen) props.commentaryPanelOpen = true;
            setBookSelection(s.bookId, s.title || s.bookId, line, s.bookUid || undefined, props);
            if (!tabs[activeTabIndex]) return false;
            // שומר את אותו מצב מיד, כדי שמופע שוחזר ימשיך להיות ניתן לשחזור גם אם יפונה שוב
            lastSavedJson = JSON.stringify(s);
            lineDirty = false; // נשארים עם השורה השמורה עד שהמשתמש מתקדם
            return true;
        } catch (e) {
            console.error('[שני טורים] שחזור מופע נכשל - ממשיכים למסך בחירת ספר', e);
            return false;
        }
    }

    window.SessionRestore = { start, restoreFromBoot, collectState, pushState, isValidState };
})();
