        let tabs = [];
        let activeTabIndex = -1;
        let fontSizeChangeTimer = null;
        let repaginateTimer = null;
        let isPinned = false;
        let pageScale = 1.0;
        // היסט אנכי (בפיקסלים) של הספר בתצוגת ספר, בשימוש רק כשהזום גדול מספיק שהספר חורג
        // מגבולות המסך למעלה/למטה - ראו applyBookPanY/resetBookPanY למטה
        let bookPanY = 0;
        let lastKnownTheme = null; // ה-theme האחרון שהתקבל מ-plugin.boot/theme.changed - לשימוש כשחוזרים ל"גופן תוכנה"
        // הערה: מזהה ביטול העימוד (paginationToken) נשמר כעת per-tab (על אובייקט הטאב עצמו, ראו
        // paginateContent) ולא כמונה גלובלי אחד - כך שעימוד של טאב אחד לא מבטל עימוד שרץ במקביל
        // בטאב אחר (זה בדיוק מה שגרם לכך שרק משיכת הספר האחרונה שנפתחה המשיכה, וכל משיכה קודמת
        // שעדיין הייתה באמצע נעצרה לגמרי - כי כל טאב חדש הזיז את אותו מונה גלובלי יחיד).


        // שכבת טעינה (ספינר בלבד) מעל אזור העמודים - ראו #preview-loading ב-index.html.
        function showPreviewLoading() {
            const el = document.getElementById('preview-loading');
            if (el) el.classList.add('visible');
        }
        function hidePreviewLoading() {
            const el = document.getElementById('preview-loading');
            if (el) el.classList.remove('visible');
        }
        // הסתרה אחרי שהדפדפן צייר את הקפיצה/הגלילה למיקום - כדי שלא יבהבו עמודים במיקום הלא נכון
        function hidePreviewLoadingAfterPaint() {
            requestAnimationFrame(() => requestAnimationFrame(hidePreviewLoading));
        }

// פונקציית עזר למציאת מספר העמוד הלבן שמוצג כרגע במרכז הגלילה
        function getScrollCurrentPage() {
            const previewArea = document.getElementById('preview-area');
            const pages = Array.from(previewArea.querySelectorAll('.print-page'));
            if (pages.length === 0) return 0;

            // "העמוד הנוכחי" מחושב לפי המיקום הוויזואלי האמיתי על המסך (getBoundingClientRect),
            // ולא לפי offsetTop/scrollTop. הסיבה: הדפים משתמשים ב-CSS zoom (var(--page-scale))
            // כדי להתאים את גודל התצוגה בלי לגרום לעימוד מחדש - ו-offsetTop/offsetHeight על
            // אלמנטים עם zoom עלולים להיות לא מדויקים/לא עקביים בחלק מהמנועים (במיוחד כשיש הרבה
            // עמודים בזום שאינו 1.0), מה שגורם לסטייה שמצטברת ככל שמתקדמים בספר - בדיוק התסמין
            // של "דפדוף שמתחיל לעבוד טוב ובהדרגה זז לעמוד לא נכון". getBoundingClientRect תמיד
            // מחזיר את המיקום המצויר בפועל על המסך, ולכן לא יכול לסטות בגלל zoom - "העמוד הנוכחי"
            // הוא פשוט העמוד האחרון שראש שלו (visually) נמצא בשורה העליונה של אזור התצוגה או מעליה.
            const areaTop = previewArea.getBoundingClientRect().top;
            const tolerance = 2;

            // חיפוש בינארי במקום מעבר ליניארי על כל העמודים: מכיוון שהעמודים מסודרים בזרימה
            // רגילה אחד מתחת לשני, המיקום האנכי שלהם תמיד עולה (או נשאר) עם האינדקס - בדיוק
            // התנאי הדרוש לחיפוש בינארי תקין. הפעולה הזו רצה בכל עזיבת טאב בתצוגת גלילה, כך
            // שההבדל בין O(מספר העמודים) ל-O(log מספר העמודים) מדידות getBoundingClientRect
            // משמעותי בספרים גדולים עם מאות/אלפי עמודים - התוצאה זהה בדיוק לסריקה הליניארית.
            let lo = 0, hi = pages.length - 1, currentPageIndex = 0;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                const pageTop = pages[mid].getBoundingClientRect().top - areaTop;
                if (pageTop > tolerance) {
                    hi = mid - 1;
                } else {
                    currentPageIndex = mid;
                    lo = mid + 1;
                }
            }
            return currentPageIndex;
        }

        // פונקציית עזר לגלילה לעמוד מסוים במצב גלילה - קפיצה מיידית (כמו בקוראי PDF), לא הנפשה חלקה,
        // כדי שדפדוף בחיצים ירגיש מיידי ולא "יגלוש" לעמוד לא נכון בזמן האנימציה
        function scrollToPageInScrollView(pageIndex) {
            const previewArea = document.getElementById('preview-area');
            const pages = Array.from(previewArea.querySelectorAll('.print-page'));
            const targetPage = pages[pageIndex];
            if (!targetPage) return;

            // יישור מדויק וקבוע: ראש העמוד המבוקש נוחת בדיוק בראש אזור התצוגה (0px offset) - כדי
            // שדפדוף עם החיצים יתנהג בדיוק כמו בקוראי PDF: כל לחיצה מציגה את ראש העמוד הבא/הקודם
            // בדיוק מתחת לסרגל, בלי תלות בגודל התצוגה (זום).
            //
            // החישוב מבוסס על getBoundingClientRect (המיקום הוויזואלי האמיתי על המסך) ולא על
            // offsetTop: הדפים מוגדלים/מוקטנים באמצעות CSS zoom (var(--page-scale)) כדי לאפשר
            // שינוי תצוגה בלי עימוד מחדש, ו-offsetTop על אלמנטים בתוך zoom עלול להיות לא מדויק
            // בחלק מהמנועים - מה שגרם בדיוק לתקלה שדווחה: קפיצה שמתחילה טוב ובהדרגה "נסחפת" עד
            // שבשלב מסוים כבר לא מגיעה לראש העמוד הנכון בכלל. getBoundingClientRect מחזיר תמיד את
            // המיקום המצויר בפועל, ולכן לא יכול לסטות בגלל zoom - מחשבים כמה פיקסלים (בפועל, על
            // המסך) צריך להזיז את הגלילה כדי שראש העמוד המבוקש ינחת בדיוק על קו ה-0 של אזור התצוגה,
            // ומוסיפים את זה ל-scrollTop הנוכחי (לא קופצים למספר "מוחלט" מחושב מראש).
            const areaTop = previewArea.getBoundingClientRect().top;
            const pageTop = targetPage.getBoundingClientRect().top;
            const delta = pageTop - areaTop;
            const targetScrollTop = Math.max(0, previewArea.scrollTop + delta);

            // שימוש ב-scrollTo({behavior:'instant'}) במקום הצבה ישירה ל-scrollTop (עם הדלקה/כיבוי
            // זמניים של scroll-behavior דרך style, כמו שהיה קודם): הטריק הישן תלוי בתזמון מדויק
            // בין הצבת ה-style להצבת scrollTop, ובזום גבוה (שבו כל קפיצת עמוד נעה על פני מרחק גדול
            // בהרבה בפיקסלים) חלק מהדפדפנים המוטמעים מפרשים את זה כגלילה חלקה (smooth) שרצה
            // ברקע במקום קפיצה מיידית - ואם לוחצים על חץ נוסף (או מחזיקים אותו לחוץ) לפני
            // שהאנימציה הקודמת הספיקה להסתיים, הגלילות "מתנגשות" זו בזו ונראה כאילו הניווט נתקע
            // ולא מתקדם. behavior:'instant' הוא ערך תקני (חלק מ-CSSOM View spec) שמבטיח קפיצה
            // מיידית תמיד, ללא תלות בהגדרת ה-CSS scroll-behavior של האלמנט וללא תזמון עדין.
            previewArea.scrollTo({ top: targetScrollTop, behavior: 'instant' });
        }

        // ערכי ברירת מחדל להגדרות
        const DEFAULT_SETTINGS = {
            margin: 20,
            columnGap: 12,
            concurrency: 6, // הורד מ-15 - ריבוי בקשות מקבילות מדי לאותו ספר גרם לעמודים לא מסודרים בספרים גדולים
            fontSize: 14,
            lineHeight: 1.5,
            paragraphSpacing: 0.3,
            showColumnRule: true,
            showHeader: true,
            isBookView: false, // ברירת מחדל: תצוגת גלילה רגילה
            twoColumnScroll: false, // תצוגת שני עמודים בשורה בתוך תצוגת הגלילה הרגילה (לא תצוגת ספר) - ברירת מחדל: עמוד בודד
            hideNikud: false,
            hideTeamim: false,
            hidePunctuation: false,
            holyNamesFilter: 'havaya', // ברירת מחדל: רק שם הוי"ה המפורש
            holyNamesDisplay: 'hyphen', // ברירת מחדל: מקף בין כל אות (י-ה-ו-ה)
            holyNamesYY: false, // ברירת מחדל: כבוי - שם הוי"ה בכינוי יופיע כ-יקוק; מופעל: י"י
            holyNamesAggressiveAlef: false, // ברירת מחדל: כבוי - הסתרת שם "אל" אגרסיבית (גם בלי ניקוד כלל)
            compactToolbar: false,
            customFontFamily: null, // null = עוקב אחרי גופן התוכנה; מחרוזת = גופן שנבחר ידנית מהתוסף, עצמאי מהתוכנה
            savedFontNames: [], // גופנים שהמשתמש הקליד/בחר ידנית בעבר - נשמרים ברשימת הבחירה לצמיתות
            pageWidthMm: 210, // A4 כברירת מחדל; ניתן לשינוי דרך הגדרות > גודל עמוד
            pageHeightMm: 297,
            customShortcuts: {}, // מיפוי actionId -> {ctrl, shift, alt, meta, key} - קיצורי מקשים מותאמים אישית (הגדרות > קיצורי מקשים)
            bgColor: null, // צבע רקע מותאם אישית (מאחורי העמוד) - null = ברירת מחדל (עוקב אחרי ה-theme)
            pageColor: null, // צבע עמוד מותאם אישית - null = ברירת מחדל (לבן)
            textColor: null, // צבע כתב מותאם אישית - null = ברירת מחדל (שחור)

            // --- הגדרות הערות שוליים (הגדרות > הערות) - כל הערכים כאן null/false כברירת מחדל
            // כדי שהתצוגה הראשונית תישאר בדיוק כפי שהייתה לפני הוספת הלשונית הזו (ראו fallback-ים
            // ב-CSS: var(--font-size-footnote, calc(var(--font-size-book) * 0.72)) וכו') -
            // השוליים הצדדיים במכוון *לא* מופיעים כאן: הם משותפים לגמרי עם הטקסט (setting-margin)
            footnoteFontFamily: null, // null = עוקב אחרי גופן ההערות/הספר; מחרוזת = גופן נפרד שנבחר להערות בלבד
            footnoteFontSize: null, // null = יחסי לגודל גופן הטקסט (0.72 ממנו, כפי שהיה תמיד); מספר = pt קבוע
            footnoteLineHeight: null, // null = 1.35 קבוע (כפי שהיה תמיד)
            footnoteParagraphSpacing: null, // null = 3px קבוע בין הערות (כפי שהיה תמיד)
            footnoteTwoColumn: false, // ברירת מחדל: טור בודד (כפי שהיה תמיד)
            footnoteColumnGap: 12, // מ"מ - זהה לברירת המחדל של מרווח הטורים בטקסט
            footnoteShowColumnRule: true, // רלוונטי רק כש-footnoteTwoColumn פעיל

            // --- הגדרות חלונית המפרשים (הגדרות > הערות > הגדרות גופן למפרשים) - עצמאיות
            // לגמרי מהגדרות הטקסט הראשי ומהגדרות ההערות שמעליהן, ומהגדרות הספר. כל הערכים
            // כאן null/false כברירת מחדל: null בגופן = עוקב אחרי גופן "מפרשים" של התוכנה עצמה
            // (commentatorsFontFamily, לא גופן הטקסט הרגיל) - ראו applyTheme. null בגודל/מרווח
            // שורות = עוקב אחרי ברירות המחדל של אוצריא ב-CSS (--font-size-commentators/
            // --line-height-book), עם אפשרות לדריסה עצמאית כאן. דגלי ההסתרה עצמאיים לחלוטין מ-hideNikud/
            // hideTeamim/hidePunctuation של הספר - ראו applyCommentaryTextFilters.
            commentaryFontFamily: null,
            commentaryFontSize: null,
            commentaryLineHeight: null,
            commentaryHideNikud: false,
            commentaryHideTeamim: false,
            commentaryHidePunctuation: false,

            // צבע רקע חלונית המפרשים (ראו COLOR_TARGETS.commentaryBg) ורוחב החלונית (נגרר ביד
            // דרך #commentary-panel-resize-handle) - שניהם null כברירת מחדל: צבע ה-null נופל
            // לברירת המחדל הקבועה ב-CSS (--commentary-panel-bg-color: #F6EDE5), ורוחב ה-null
            // נופל לרוחב הקבוע ב-CSS (340px, ראו #commentary-panel).
            commentaryBgColor: null,
            commentaryPanelWidth: null,
            // הצגת כותרת מקור (שם המפרש+מיקום) לפני כל קטע בחלונית המפרשים - ברירת המחדל היא
            // הצגה (true), כמו שהיה תמיד עד כה. ראו updateCommentaryShowRefsSetting/body.hide-commentary-refs.
            commentaryShowRefs: true
        };
        let currentSettings = { ...DEFAULT_SETTINGS };
        let drawerState = {};

        // גיבוי אחסון: כל השמירה העיקרית היא ב-localStorage (כמו שהיה בקוד המקורי), אבל בנוסף
        // משקפים (best-effort, בלי לחכות) כל שמירה גם ל-storage.* הרשמי של אוצריא, כדי שההגדרות/
        // מצב התוסף לא ילכו לאיבוד אם ה-localStorage של ה-webview יימחק מסיבה כלשהי. קריאה חוזרת
        // מ-Otzaria נעשית רק כ"רשת ביטחון" - אם ואך ורק אם ה-localStorage ריק.
        function mirrorToOtzariaStorage(key, value) {
            try {
                Otzaria.call('storage.set', { key, value }).catch(() => {});
            } catch (e) { /* לא קריטי - ה-localStorage הוא המקור העיקרי */ }
        }

        async function loadFromOtzariaStorageFallback(key) {
            try {
                const { data } = await Otzaria.call('storage.get', { key });
                return data;
            } catch (e) {
                return undefined;
            }
        }

        /* ===================== גופן שנבחר כקובץ מתוך בורר "גופן הספר" ===================== */
        // נשמר בנפרד מ-currentSettings (לא כחלק ממנו) כי מדובר בבייטי גופן שלמים בבסיס 64 -
        // גדולים משמעותית משאר ההגדרות, ואין טעם לגרור אותם בכל saveSettings() רגיל.
        // הבייטים משמשים ליצוא PDF; אינם קשורים לתצוגה על המסך (זו כבר עובדת דרך FontFace,
        // ראו onFontPickerFileChosen).
        let pdfExportFontBytes = null;
        let pdfExportFontName = null;

        function arrayBufferToBase64(buffer) {
            let binary = '';
            const bytes = new Uint8Array(buffer);
            const chunkSize = 0x8000;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
            }
            return btoa(binary);
        }

        function base64ToArrayBuffer(base64) {
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return bytes.buffer;
        }

        function savePdfExportFontBytes(buf, name) {
            pdfExportFontBytes = buf;
            pdfExportFontName = name;
            try {
                const b64 = arrayBufferToBase64(buf);
                localStorage.setItem('advanced_print_pdf_font_b64', b64);
                localStorage.setItem('advanced_print_pdf_font_name', name);
                mirrorToOtzariaStorage('advanced_print_pdf_font_b64', b64);
                mirrorToOtzariaStorage('advanced_print_pdf_font_name', name);
            } catch (err) {
                console.error('שמירת גופן היצוא נכשלה (ייתכן שקובץ הגופן גדול מדי לאחסון המקומי)', err);
            }
        }

        // נקראת בהפעלה הראשונית, אחרי שההגדרות כבר נטענו: אם יש בייטי גופן שמורים מבחירה קודמת,
        // וגופן הספר הנוכחי (customFontFamily) הוא בדיוק אותו שם - רושמים מחדש FontFace מהבייטים
        // השמורים, כדי שהתצוגה על המסך תמשיך להציג את הגופן הנכון גם אחרי טעינה מחדש של התוסף
        // (רישום FontFace הוא זמני-לזיכרון בלבד ולא שורד רענון עמוד מעצמו).
        async function loadPdfExportFontAndRehydrate() {
            let b64 = null, name = null;
            try {
                b64 = localStorage.getItem('advanced_print_pdf_font_b64');
                name = localStorage.getItem('advanced_print_pdf_font_name');
            } catch (e) { /* בסדר - נמשיך לנסות גיבוי Otzaria למטה */ }

            if (!b64) {
                b64 = await loadFromOtzariaStorageFallback('advanced_print_pdf_font_b64');
                name = await loadFromOtzariaStorageFallback('advanced_print_pdf_font_name');
            }
            if (!b64) return;

            try {
                pdfExportFontBytes = base64ToArrayBuffer(b64);
                pdfExportFontName = name;

                if (currentSettings.customFontFamily && currentSettings.customFontFamily === name) {
                    const fontFace = new FontFace(name, pdfExportFontBytes);
                    await fontFace.load();
                    document.fonts.add(fontFace);
                }
            } catch (e) {
                console.error('שחזור גופן היצוא נכשל', e);
            }
        }

        async function loadDrawerState() {
            try {
                const stored = localStorage.getItem('advanced_print_drawer_state');
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed && typeof parsed === 'object') {
                        drawerState = parsed;
                        return;
                    }
                }
            } catch (e) {
                console.error('Failed to load drawer state', e);
            }
            const fallback = await loadFromOtzariaStorageFallback('advanced_print_drawer_state');
            if (fallback && typeof fallback === 'object') drawerState = fallback;
        }

        function saveDrawerState() {
            try {
                localStorage.setItem('advanced_print_drawer_state', JSON.stringify(drawerState));
            } catch (e) {
                console.error('Failed to save drawer state', e);
            }
            mirrorToOtzariaStorage('advanced_print_drawer_state', drawerState);
        }

        function getTabDrawerOpen(tabId) {
            return Boolean(drawerState[tabId]);
        }

        function setTabDrawerOpen(tabId, isOpen) {
            drawerState[tabId] = Boolean(isOpen);
            saveDrawerState();
        }

        // טעינת הגדרות שמורות ב-Webview