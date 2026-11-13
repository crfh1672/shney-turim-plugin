/* ==========================================================================================
   === מטמון עימוד (Pagination Cache) ===
   העימוד של ספר (מדידת גלישה בכל צעד, חיפוש בינארי בתוך פסקאות, הערות שוליים) הוא החלק האיטי
   בפתיחת ספר גדול. כשאותו ספר נפתח שוב עם אותן הגדרות פריסה, התוצאה זהה לחלוטין - ולכן אפשר
   לשמור את העמודים המוגמרים (ה-HTML הסופי של כל העמודים, בדיוק כפי שנשמר ב-tab.cachedPreview)
   ולהציג אותם מיד בפתיחה הבאה, בלי למדוד שום דבר.

   למה שומרים את ה-HTML הסופי ולא רק "מיקומי חיתוך": העימוד חותך פסקאות בכמה רמות (טקסט, צאצאים,
   פריטי רשימה, שרידי הערות שוליים), וכל חיתוך משאיר מחלקות ומבנה ספציפיים. שחזור מתוך מיקומי
   חיתוך חייב לשכפל את כל הלוגיקה הזו בדיוק; שמירת התוצאה הסופית מבטיחה שהעמודים זהים בייט
   לבייט למה שהעימוד היה מייצר. המחיר הוא נפח, ולכן הנתונים נדחסים (gzip) ויש הגבלת נפח/כמות.

   בטיחות: מפתח המטמון כולל "חתימת פריסה" (כל מה שמשפיע על חיתוך העמודים: הגדרות, סגנונות
   מחושבים בפועל, גופן, קוד העימוד עצמו וגרסת הדפדפן), ובנוסף כל פתיחה מהמטמון מאומתת ברקע
   מול תוכן הספר הנוכחי בספרייה (ראו generateView) - אם הספר השתנה, מעמדים מחדש. כל כשל באחסון
   (IndexedDB חסום, מכסה מלאה וכו') נבלע בשקט והתוסף ממשיך לעבוד בדיוק כמו בלי מטמון.
   ========================================================================================== */
(function () {
    'use strict';

    const DB_NAME = 'shney-turim-pagination-cache';
    const DB_VERSION = 1;
    const STORE_META = 'meta';   // רשומות קטנות (מטא-דאטה) - מאפשרות פינוי בלי לטעון את הנתונים הכבדים
    const STORE_DATA = 'data';   // ה-HTML הדחוס עצמו
    // יש להעלות כשמשנים את מבנה הרשומה או את מבנה ה-HTML של עמוד באופן שחתימת הקוד לא תופסת
    // 2: טביעת האצבע של התוכן כוללת גם את הערות השוליים; חתימת הקוד כוללת את נתוני שמות הקודש
    const FORMAT_VERSION = 2;

    const MAX_LAYOUTS_PER_BOOK = 2;            // כמה הגדרות פריסה שונות נשמרות לאותו ספר
    const MAX_ENTRIES = 30;                    // כמה רשומות בסך הכל
    const MAX_TOTAL_BYTES = 150 * 1024 * 1024; // נפח כולל (דחוס) לכל הרשומות
    const MAX_ENTRY_BYTES = 60 * 1024 * 1024;  // רשומה בודדת גדולה מזה אינה נשמרת
    const SAVE_DELAY_MS = 400;                 // השהיה לפני שמירה, כדי לא להתחרות בציור/ניווט אחרי העימוד

    // הגדרות שאינן משפיעות על חיתוך העמודים: צבעים, קיצורים, תצוגת ספר/שני עמודים (שינוי תצוגה
    // בלבד, בלי עימוד מחדש), כותרת עליונה (מוסתרת ויזואלית בלבד - ראו preparePageWithHeader) וכו'.
    // כל מפתח אחר ב-currentSettings נכנס לחתימה, כך ששכחה של מפתח חדש גורמת לכל היותר לפספוס
    // מטמון מיותר - ולא להצגת עימוד מיושן.
    const IGNORED_SETTING_KEYS = new Set([
        'customShortcuts', 'bgColor', 'pageColor', 'textColor', 'savedFontNames', 'compactToolbar',
        'isBookView', 'twoColumnScroll', 'concurrency', 'showHeader'
    ]);

    // פונקציות שהקוד שלהן קובע את מבנה העמודים. חתימה מקוד המקור שלהן מבטלת את המטמון
    // אוטומטית כשמעדכנים את לוגיקת העימוד, בלי להסתמך על כך שמישהו יזכור להעלות גרסה.
    const CODE_SIGNATURE_FUNCTIONS = [
        'paginateContent', 'preparePageWithHeader', 'numToGematria', 'syncPageFootnotes',
        'trimFootnotesToFitPage', 'splitTextNodesIntoWords', 'applyTextFilters', 'isOverflowing',
        'isOverflowingExcludingFootnotes', 'wouldFootnoteFitOnBlankPage', 'appendToMeasureContainer'
    ];

    function log() {
        try { console.info.apply(console, ['[שני טורים · מטמון עימוד]'].concat(Array.prototype.slice.call(arguments))); } catch (e) { /* לא קריטי */ }
    }

    function isAvailable() {
        try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch (e) { return false; }
    }

    /* ------------------------------- גיבוב (hash) ------------------------------- */
    // cyrb53 - גיבוב מהיר של 53 ביט על יחידות UTF-16. מספיק לזיהוי שינוי תוכן (לא קריפטוגרפי);
    // יחד עם השוואת אורך, סיכוי ההתנגשות בין שתי גרסאות של אותו ספר זניח.
    function hashString(str, seed) {
        seed = seed || 0;
        let h1 = 0xdeadbeef ^ seed;
        let h2 = 0x41c6ce57 ^ seed;
        for (let i = 0; i < str.length; i++) {
            const ch = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
    }

    /* ------------------------------- חתימת פריסה ------------------------------- */
    let cachedCodeSignature = null;
    function getCodeSignature() {
        if (cachedCodeSignature) return cachedCodeSignature;
        const parts = [];
        CODE_SIGNATURE_FUNCTIONS.forEach((name) => {
            try {
                const fn = (typeof window !== 'undefined') ? window[name] : null;
                parts.push(name + ':' + (typeof fn === 'function' ? Function.prototype.toString.call(fn) : 'missing'));
            } catch (e) { parts.push(name + ':error'); }
        });
        // נתוני עזר שהפונקציות למעלה קוראות ושקובעים את הטקסט שמגיע לעימוד (applyTextFilters):
        // שינוי בהם משנה את העמודים בלי שקוד הפונקציות עצמו ישתנה, ולכן הם נכנסים לחתימה בנפרד
        try {
            parts.push('HOLY_NAMES:' + (typeof HOLY_NAMES !== 'undefined' ? JSON.stringify(HOLY_NAMES) : 'missing'));
            parts.push('HOLY_DIACRITIC_RE_SRC:' + (typeof HOLY_DIACRITIC_RE_SRC !== 'undefined' ? HOLY_DIACRITIC_RE_SRC : 'missing'));
            parts.push('PREFIX_LETTERS_RE_SRC:' + (typeof PREFIX_LETTERS_RE_SRC !== 'undefined' ? PREFIX_LETTERS_RE_SRC : 'missing'));
            parts.push('PREFIX_GROUP_RE_SRC:' + (typeof PREFIX_GROUP_RE_SRC !== 'undefined' ? PREFIX_GROUP_RE_SRC : 'missing'));
        } catch (e) { parts.push('data-error'); }
        cachedCodeSignature = hashString(parts.join('\u0003'));
        return cachedCodeSignature;
    }

    function readStyle(el, props) {
        const cs = getComputedStyle(el);
        return props.map((p) => p + '=' + cs.getPropertyValue(p)).join(';');
    }

    // סגנונות מחושבים בפועל של עמוד לדוגמה (אותו מבנה כמו מכל המדידה של paginateContent):
    // לוכד כל משתנה CSS שמשפיע על הפריסה (גופן התוכנה/המותאם, גודל גופן, שוליים, טורים, מרווחים,
    // הערות שוליים...) בלי להכיר את שמות המשתנים, וגם שינוי בקובץ ה-CSS בין גרסאות של התוסף.
    // zoom נקבע ל-1 כדי שזום התצוגה (--page-scale, שאינו אמור להשפיע על העימוד) לא ייכנס לחתימה.
    function probeLayoutStyles(tab) {
        const probe = document.createElement('div');
        probe.className = 'print-page';
        probe.style.cssText = 'position:fixed;top:-9999px;left:0;visibility:hidden;zoom:1;content-visibility:visible;';
        probe.style.setProperty('--cols', (tab && tab.cols) || '2');
        probe.style.height = ((typeof currentSettings !== 'undefined' && currentSettings.pageHeightMm) || 297) + 'mm';
        probe.innerHTML =
            '<p>א</p><h1>א</h1><div class="page-header">א</div>' +
            '<div class="page-footnotes-block"><div class="page-footnote-line"><sup>1</sup>א</div></div>';
        document.body.appendChild(probe);
        try {
            const pageProps = ['font-family', 'font-size', 'line-height', 'padding-top', 'padding-right', 'padding-bottom',
                'padding-left', 'column-count', 'column-gap', 'column-fill', 'width', 'height', 'text-align', 'word-break',
                'overflow-wrap', 'letter-spacing', 'word-spacing', 'direction', 'hyphens', 'font-kerning'];
            const out = [
                'page{' + readStyle(probe, pageProps) + '}',
                'p{' + readStyle(probe.querySelector('p'), ['margin-bottom', 'line-height', 'font-size']) + '}',
                'h1{' + readStyle(probe.querySelector('h1'), ['font-size', 'font-weight', 'margin-bottom', 'line-height']) + '}',
                'hd{' + readStyle(probe.querySelector('.page-header'), ['font-size', 'margin-bottom', 'padding-bottom', 'height']) + '}',
                'fn{' + readStyle(probe.querySelector('.page-footnotes-block'), ['font-family', 'font-size', 'line-height', 'margin-top', 'padding-top', 'border-top-width']) + '}',
                'fl{' + readStyle(probe.querySelector('.page-footnote-line'), ['line-height', 'margin-bottom']) + '}'
            ];
            return out.join('|');
        } finally {
            if (probe.parentNode) probe.parentNode.removeChild(probe);
        }
    }

    // חתימה אחת לכל מה שקובע איך ייחתכו העמודים של הטאב הזה כרגע. שוויון חתימות = אותו עימוד.
    function computeLayoutSignature(tab) {
        const parts = ['fmt' + FORMAT_VERSION, getCodeSignature()];

        const settings = {};
        if (typeof currentSettings !== 'undefined' && currentSettings) {
            Object.keys(currentSettings).sort().forEach((k) => {
                if (IGNORED_SETTING_KEYS.has(k) || k.indexOf('commentary') === 0) return;
                settings[k] = currentSettings[k];
            });
        }
        parts.push(JSON.stringify(settings));
        parts.push('cols=' + ((tab && tab.cols) || '2'));
        // כותרת הספר מודפסת בראש כל עמוד (preparePageWithHeader)
        parts.push('title=' + ((tab && tab.title) || ''));
        try { parts.push(probeLayoutStyles(tab)); } catch (e) { parts.push('probe-error'); }
        parts.push(typeof navigator !== 'undefined' ? navigator.userAgent : '');
        parts.push('dpr=' + (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1));
        return hashString(parts.join('\u0002'));
    }

    // טביעת אצבע של מה שהעמודים נבנים ממנו: גוף הטקסט *וגם* הערות השוליים (העמודים מכילים את
    // טקסט ההערות עצמו, ולכן שינוי בהערה בלבד חייב לבטל את הרשומה). מחושבת באותה צורה בשמירה
    // (תחילת העימוד) ובאימות (אחרי המשיכה), כך ששוויון = אותו קלט לעימוד.
    function contentFingerprint(rawContent, footnotes) {
        const raw = String(rawContent || '');
        let fn = '';
        try { fn = footnotes ? JSON.stringify(footnotes) : ''; } catch (e) { fn = 'unserializable'; }
        return { hash: hashString(raw) + ':' + hashString(fn, 7), len: raw.length };
    }

    /* ------------------------------- אחסון (IndexedDB) ------------------------------- */
    let dbPromise = null;
    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            let req;
            try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_META)) {
                    const meta = db.createObjectStore(STORE_META, { keyPath: 'key' });
                    meta.createIndex('bookId', 'bookId', { unique: false });
                }
                if (!db.objectStoreNames.contains(STORE_DATA)) {
                    db.createObjectStore(STORE_DATA, { keyPath: 'key' });
                }
            };
            req.onsuccess = () => {
                const db = req.result;
                db.onversionchange = () => { try { db.close(); } catch (e) { /* בסדר */ } dbPromise = null; };
                resolve(db);
            };
            req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
            req.onblocked = () => reject(new Error('indexedDB open blocked'));
        });
        // כישלון בפתיחה לא נשמר - ניסיון הבא ינסה שוב
        dbPromise.catch(() => { dbPromise = null; });
        return dbPromise;
    }

    function reqToPromise(req) {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function txDone(tx) {
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
        });
    }

    function makeKey(bookId, layoutSig) {
        return String(bookId) + '\u0001' + layoutSig;
    }

    async function compress(str) {
        if (typeof CompressionStream === 'function') {
            try {
                const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
                const buf = await new Response(stream).arrayBuffer();
                return { enc: 'gzip', payload: buf, size: buf.byteLength };
            } catch (e) { /* נופלים לשמירה לא דחוסה */ }
        }
        return { enc: 'plain', payload: str, size: str.length * 2 };
    }

    async function decompress(enc, payload) {
        if (enc === 'gzip') {
            const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream('gzip'));
            return await new Response(stream).text();
        }
        return payload;
    }

    // פתיחה מהמטמון. מחזירה null בכל מצב של "אין" / "לא תואם" / "פגום" / "שגיאה".
    async function load(bookId, layoutSig, bookUid) {
        if (!isAvailable()) return null;
        try {
            const key = makeKey(bookId, layoutSig);
            const db = await openDb();
            const tx = db.transaction([STORE_META, STORE_DATA], 'readonly');
            const [meta, data] = await Promise.all([
                reqToPromise(tx.objectStore(STORE_META).get(key)),
                reqToPromise(tx.objectStore(STORE_DATA).get(key))
            ]);
            if (!meta || !data) return null;
            if (meta.formatVersion !== FORMAT_VERSION || meta.layoutSig !== layoutSig) return null;
            // שני ספרים בעלי אותו שם (bookId) אך מזהה יציב שונה - לא אותו ספר
            if (bookUid && meta.bookUid && bookUid !== meta.bookUid) return null;
            const html = await decompress(meta.enc, data.payload);
            if (typeof html !== 'string' || html.length === 0 || html.length !== meta.htmlLen) return null;
            touch(key);
            return {
                html,
                contentHash: meta.contentHash,
                contentLen: meta.contentLen,
                pageCount: meta.pageCount,
                bookUid: meta.bookUid || null
            };
        } catch (e) {
            log('קריאה מהמטמון נכשלה', e && e.message ? e.message : e);
            return null;
        }
    }

    function touch(key) {
        openDb().then((db) => {
            const tx = db.transaction([STORE_META], 'readwrite');
            const store = tx.objectStore(STORE_META);
            const getReq = store.get(key);
            getReq.onsuccess = () => {
                const meta = getReq.result;
                if (meta) { meta.lastUsed = Date.now(); store.put(meta); }
            };
            return txDone(tx);
        }).catch(() => { /* לא קריטי */ });
    }

    async function putEntry(db, meta, payload) {
        const tx = db.transaction([STORE_META, STORE_DATA], 'readwrite');
        tx.objectStore(STORE_META).put(meta);
        tx.objectStore(STORE_DATA).put({ key: meta.key, payload });
        await txDone(tx);
    }

    async function deleteKeys(db, keys) {
        if (!keys.length) return;
        const tx = db.transaction([STORE_META, STORE_DATA], 'readwrite');
        keys.forEach((k) => {
            tx.objectStore(STORE_META).delete(k);
            tx.objectStore(STORE_DATA).delete(k);
        });
        await txDone(tx);
    }

    async function getAllMeta(db) {
        const tx = db.transaction([STORE_META], 'readonly');
        return await reqToPromise(tx.objectStore(STORE_META).getAll());
    }

    // פינוי: עודף הגדרות פריסה לאותו ספר, עודף רשומות, ועודף נפח - תמיד את הישנות ביותר (לפי
    // שימוש אחרון), ולעולם לא את הרשומה שנכתבה זה עתה (protectedKey).
    async function evict(db, protectedKey) {
        let all = await getAllMeta(db);
        const toDelete = new Set();
        const byLastUsed = (a, b) => a.lastUsed - b.lastUsed;

        const perBook = new Map();
        all.forEach((m) => {
            if (!perBook.has(m.bookId)) perBook.set(m.bookId, []);
            perBook.get(m.bookId).push(m);
        });
        perBook.forEach((list) => {
            if (list.length <= MAX_LAYOUTS_PER_BOOK) return;
            list.sort(byLastUsed);
            let excess = list.length - MAX_LAYOUTS_PER_BOOK;
            for (let i = 0; i < list.length && excess > 0; i++) {
                if (list[i].key === protectedKey) continue;
                toDelete.add(list[i].key);
                excess--;
            }
        });

        all = all.filter((m) => !toDelete.has(m.key)).sort(byLastUsed);
        let count = all.length;
        let total = all.reduce((s, m) => s + (m.size || 0), 0);
        for (let i = 0; i < all.length && (count > MAX_ENTRIES || total > MAX_TOTAL_BYTES); i++) {
            if (all[i].key === protectedKey) continue;
            toDelete.add(all[i].key);
            count--;
            total -= (all[i].size || 0);
        }

        await deleteKeys(db, Array.from(toDelete));
        return toDelete.size;
    }

    function isQuotaError(e) {
        return e && (e.name === 'QuotaExceededError' || e.code === 22);
    }

    async function save(entry) {
        if (!isAvailable()) return false;
        try {
            const comp = await compress(entry.html);
            if (comp.size > MAX_ENTRY_BYTES) {
                log('הספר גדול מדי לשמירה במטמון', Math.round(comp.size / 1048576) + 'MB');
                return false;
            }
            const now = Date.now();
            const meta = {
                key: makeKey(entry.bookId, entry.layoutSig),
                bookId: String(entry.bookId),
                bookUid: entry.bookUid || null,
                layoutSig: entry.layoutSig,
                contentHash: entry.contentHash,
                contentLen: entry.contentLen,
                pageCount: entry.pageCount || 0,
                htmlLen: entry.html.length,
                enc: comp.enc,
                size: comp.size,
                formatVersion: FORMAT_VERSION,
                createdAt: now,
                lastUsed: now
            };
            const db = await openDb();
            try {
                await putEntry(db, meta, comp.payload);
            } catch (e) {
                if (!isQuotaError(e)) throw e;
                // מכסה מלאה - מפנים את הישנות ביותר ומנסים פעם אחת נוספת
                await evictForSpace(db, comp.size, meta.key);
                await putEntry(db, meta, comp.payload);
            }
            await evict(db, meta.key);
            return true;
        } catch (e) {
            log('שמירה למטמון נכשלה', e && e.message ? e.message : e);
            return false;
        }
    }

    async function evictForSpace(db, neededBytes, protectedKey) {
        const all = (await getAllMeta(db)).filter((m) => m.key !== protectedKey).sort((a, b) => a.lastUsed - b.lastUsed);
        let freed = 0;
        const keys = [];
        for (let i = 0; i < all.length && freed < neededBytes * 2; i++) {
            keys.push(all[i].key);
            freed += (all[i].size || 0);
        }
        await deleteKeys(db, keys);
    }

    async function remove(bookId, layoutSig) {
        if (!isAvailable()) return;
        try { await deleteKeys(await openDb(), [makeKey(bookId, layoutSig)]); } catch (e) { /* לא קריטי */ }
    }

    async function removeBook(bookId) {
        if (!isAvailable()) return;
        try {
            const db = await openDb();
            const tx = db.transaction([STORE_META], 'readonly');
            const metas = await reqToPromise(tx.objectStore(STORE_META).index('bookId').getAll(String(bookId)));
            await deleteKeys(db, metas.map((m) => m.key));
        } catch (e) { /* לא קריטי */ }
    }

    async function clear() {
        if (!isAvailable()) return;
        try {
            const db = await openDb();
            const tx = db.transaction([STORE_META, STORE_DATA], 'readwrite');
            tx.objectStore(STORE_META).clear();
            tx.objectStore(STORE_DATA).clear();
            await txDone(tx);
        } catch (e) { /* לא קריטי */ }
    }

    async function stats() {
        if (!isAvailable()) return { available: false, entries: 0, totalBytes: 0, items: [] };
        try {
            const all = await getAllMeta(await openDb());
            return {
                available: true,
                entries: all.length,
                totalBytes: all.reduce((s, m) => s + (m.size || 0), 0),
                items: all.map((m) => ({ bookId: m.bookId, pages: m.pageCount, bytes: m.size, lastUsed: m.lastUsed }))
            };
        } catch (e) {
            return { available: false, entries: 0, totalBytes: 0, items: [] };
        }
    }

    /* ------------------------------- שמירה בסיום עימוד ------------------------------- */
    const pendingSaves = new Map();

    function countPages(html) {
        const m = html.match(/class="print-page[ "]/g);
        return m ? m.length : 0;
    }

    // נקראת בסיום עימוד מלא של טאב. השמירה עצמה מתבצעת מעט אחר כך (לא חוסמת את הציור/הניווט
    // שאחרי העימוד), ורק אם בינתיים כלום לא השתנה: הטאב לא נסגר, העמודים לא הוחלפו בעימוד חדש,
    // חתימת הפריסה זהה, והגופנים כבר נטענו (עימוד שנמדד לפני שהגופן נטען אינו אמין).
    function scheduleSave(tab, fingerprint, html, layoutSig) {
        if (!isAvailable() || !tab || tab.isExternal || !tab.id || !html || !fingerprint || !layoutSig) return;
        const key = makeKey(tab.id, layoutSig);
        clearTimeout(pendingSaves.get(key));
        const timer = setTimeout(async () => {
            pendingSaves.delete(key);
            try {
                if (document.fonts && document.fonts.status === 'loading') {
                    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]);
                }
                if (tab._closed || tab.cachedPreview !== html) return;
                if (document.fonts && document.fonts.status === 'loading') return;
                if (computeLayoutSignature(tab) !== layoutSig) return;
                const t0 = performance.now();
                const ok = await save({
                    bookId: tab.id,
                    bookUid: tab.bookUid || null,
                    layoutSig,
                    contentHash: fingerprint.hash,
                    contentLen: fingerprint.len,
                    html,
                    pageCount: countPages(html)
                });
                if (ok) log('העימוד נשמר במטמון', Math.round(performance.now() - t0) + 'ms');
            } catch (e) {
                log('שמירה למטמון נכשלה', e && e.message ? e.message : e);
            }
        }, SAVE_DELAY_MS);
        pendingSaves.set(key, timer);
    }

    window.PaginationCache = {
        isAvailable,
        computeLayoutSignature,
        contentFingerprint,
        hashString,
        load,
        save,
        scheduleSave,
        remove,
        removeBook,
        clear,
        stats,
        log
    };
})();
