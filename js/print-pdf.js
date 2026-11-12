        function printCurrentView(excludedPageIndices) {
            const excludeSet = excludedPageIndices instanceof Set ? excludedPageIndices : null;

            if (!currentSettings.isBookView) {
                // תצוגת גלילה: מדפיסים ישירות מה-DOM החי, ולכן טווח עמודים מטופל ע"י הסתרה זמנית
                // (display:none) של העמודים שמחוץ לטווח, עם שחזור מובטח אחרי ההדפסה (afterprint +
                // גיבוי setTimeout, אותו דפוס בדיוק כמו הניקוי של printing-flat-mode למטה)
                let hiddenPages = [];
                if (excludeSet && excludeSet.size > 0) {
                    const pages = Array.from(document.querySelectorAll('#preview-area .print-page'));
                    pages.forEach((p, idx) => {
                        if (excludeSet.has(idx)) {
                            p.classList.add('print-range-excluded');
                            hiddenPages.push(p);
                        }
                    });
                }

                let restoredScroll = false;
                function restoreHiddenPages() {
                    if (restoredScroll) return;
                    restoredScroll = true;
                    window.removeEventListener('afterprint', restoreHiddenPages);
                    hiddenPages.forEach(p => p.classList.remove('print-range-excluded'));
                }

                if (hiddenPages.length > 0) {
                    window.addEventListener('afterprint', restoreHiddenPages);
                    window.print();
                    setTimeout(restoreHiddenPages, 2000);
                } else {
                    window.print();
                }
                return;
            }

            const previewArea = document.getElementById('preview-area');
            const printContainer = document.createElement('div');
            printContainer.id = 'print-flat-pages';

            let pageIdx = 0;
            previewArea.querySelectorAll('.print-page').forEach((page) => {
                const currentIdx = pageIdx++;
                if (excludeSet && excludeSet.has(currentIdx)) return; // טווח עמודים: דילוג מלא על שכפול העמוד לקונטיינר השטוח החד-פעמי
                const clone = page.cloneNode(true);
                clone.classList.remove('front', 'back');
                const shadow = clone.querySelector(':scope > .page-shadow');
                if (shadow) shadow.remove();
                printContainer.appendChild(clone);
            });

            document.body.appendChild(printContainer);
            document.body.classList.add('printing-flat-mode');

            let restored = false;
            function cleanupPrintContainer() {
                if (restored) return;
                restored = true;
                window.removeEventListener('afterprint', cleanupPrintContainer);
                document.body.classList.remove('printing-flat-mode');
                printContainer.remove();
            }

            window.addEventListener('afterprint', cleanupPrintContainer);
            window.print();
            // גיבוי: בחלק מהדפדפנים/webview-ים המוטמעים אירוע afterprint לא תמיד נורה באופן אמין -
            // ה-setTimeout מבטיח ניקוי של קונטיינר ההדפסה הזמני בכל מקרה
            setTimeout(cleanupPrintContainer, 2000);
        }

        /* ==================== חלונית "הדפסה ויצוא" ==================== */
        // כפתור ההדפסה בסרגל הכלים וקיצור המקלדת (Ctrl+Shift+P) פותחים כעת את החלונית הזו במקום
        // להדפיס ישירות.

        function getCurrentTabPageCount() {
            return document.querySelectorAll('#preview-area .print-page').length;
        }

        function onPrintRangeModeChange(value) {
            const row = document.getElementById('print-export-range-row');
            if (row) row.style.display = value === 'custom' ? 'flex' : 'none';
        }

        function openPrintExportModal() {
            // איפוס לברירות המחדל בכל פתיחה - "הכל" / A4 / לגובה / איכות רגילה
            const rangeModeSelect = document.getElementById('print-export-range-mode');
            const rangeRow = document.getElementById('print-export-range-row');
            const fromInput = document.getElementById('print-export-range-from');
            const toInput = document.getElementById('print-export-range-to');
            const sizeSelect = document.getElementById('print-export-page-size');
            const orientationSelect = document.getElementById('print-export-orientation');
            const qualitySelect = document.getElementById('print-export-quality');

            const pageCount = Math.max(1, getCurrentTabPageCount());
            if (rangeModeSelect) rangeModeSelect.value = 'all';
            if (rangeRow) rangeRow.style.display = 'none';
            if (fromInput) { fromInput.min = 1; fromInput.max = pageCount; fromInput.value = 1; }
            if (toInput) { toInput.min = 1; toInput.max = pageCount; toInput.value = pageCount; }
            if (sizeSelect) sizeSelect.value = 'a4';
            if (orientationSelect) orientationSelect.value = 'portrait';
            if (qualitySelect) qualitySelect.value = currentSettings.printExportQuality || 'standard';

            setPrintExportStatus('');
            document.getElementById('print-export-modal-overlay').classList.add('open');
        }

        function closePrintExportModal() {
            document.getElementById('print-export-modal-overlay').classList.remove('open');
        }

        // מחשבת את קבוצת אינדקסי העמודים (0-based) שיש לדלג עליהם, לפי הבחירה בחלונית - משותפת
        // בין "הדפסה" ו"ייצוא PDF" כדי ששתיהן יתייחסו לטווח בדיוק באותו אופן
        function computeExcludedPageIndices() {
            const rangeMode = document.getElementById('print-export-range-mode').value;
            if (rangeMode !== 'custom') return null;

            const pageCount = Math.max(1, getCurrentTabPageCount());
            let from = parseInt(document.getElementById('print-export-range-from').value, 10) || 1;
            let to = parseInt(document.getElementById('print-export-range-to').value, 10) || pageCount;
            from = Math.max(1, Math.min(from, pageCount));
            to = Math.max(1, Math.min(to, pageCount));
            if (from > to) { const t = from; from = to; to = t; }
            const excludeSet = new Set();
            for (let i = 0; i < pageCount; i++) {
                const humanPageNum = i + 1;
                if (humanPageNum < from || humanPageNum > to) excludeSet.add(i);
            }
            return excludeSet;
        }

        // הזרקת/הסרת דריסה זמנית של גודל וכיוון הדף להדפסה בלבד (לא משפיעה על התצוגה במסך כלל) -
        // הכלל מתווסף כתגית <style> חדשה בסוף ה-head, כך שהיא "מנצחת" את כלל ה-@media print הקבוע
        // (גם הוא עם !important) לפי סדר ההופעה במסמך, בלי לגעת בכלל הקבוע עצמו
        function applyTempPrintPageSize(sizeKey, orientation) {
            const preset = PAGE_SIZE_PRESETS[sizeKey] || PAGE_SIZE_PRESETS.a4;
            let w = preset.w, h = preset.h;
            if (orientation === 'landscape') { const t = w; w = h; h = t; }

            const styleEl = document.createElement('style');
            styleEl.id = 'temp-print-size-override';
            styleEl.textContent = `
                @media print {
                    @page { size: ${w}mm ${h}mm; margin: 0; }
                    .print-page {
                        width: ${w}mm !important;
                        height: ${h}mm !important;
                    }
                }
            `;
            document.head.appendChild(styleEl);
            return () => { const el = document.getElementById('temp-print-size-override'); if (el) el.remove(); };
        }

        function confirmPrintFromModal() {
            const sizeKey = document.getElementById('print-export-page-size').value;
            const orientation = document.getElementById('print-export-orientation').value;
            const quality = document.getElementById('print-export-quality').value;

            // איכות נשמרת כבר עכשיו לצורך יצוא ה-PDF - אינה משפיעה על הדפסה רגילה
            currentSettings.printExportQuality = quality;
            saveSettings();

            const excludeSet = computeExcludedPageIndices();

            closePrintExportModal();

            const removeOverride = applyTempPrintPageSize(sizeKey, orientation);
            let cleaned = false;
            function cleanupOverride() {
                if (cleaned) return;
                cleaned = true;
                window.removeEventListener('afterprint', cleanupOverride);
                removeOverride();
            }
            window.addEventListener('afterprint', cleanupOverride);

            printCurrentView(excludeSet);

            // גיבוי לניקוי הדריסה הזמנית - אותו דפוס בדיוק כמו שאר מנגנוני הניקוי הזמניים בקובץ הזה
            setTimeout(cleanupOverride, 2500);
        }

        function setPrintExportStatus(text) {
            const el = document.getElementById('print-export-status');
            if (!el) return;
            el.style.display = text ? 'block' : 'none';
            el.textContent = text || '';
        }

        /* ==================== יצוא PDF קל משקל (מבוסס על הפרוטוטייפ המאומת) ==================== */
        // הרעיון: לא בונים מנוע עימוד/shaping חדש - "מצלמים" את העמודים שכבר נבנו ומעוצבים נכון
        // ע"י הדפדפן עצמו (כולל ניקוד/טעמים/RTL/יישור - הכל כבר פתור שם), תו-תו, ומציירים אותם
        // ב-pdf-lib עם הטמעת גופן מצומצמת (subset) - זה מה שנותן גם דיוק חזותי מלא וגם קובץ קטן.
        // הקונטיינר נבנה תמיד מתוך tab.cachedPreview (ייצוג "תצוגת עמוד" השטוח) - בדיוק כמו
        // שההדפסה בתצוגת ספר כבר עושה בכוונה - כך היצוא תמיד עקבי, בלי קשר למצב התצוגה הנוכחי.

        function isCombiningMarkForPdf(ch) {
            const code = ch.codePointAt(0);
            return code >= 0x0591 && code <= 0x05C7;
        }

        // מיפוי "bidi mirroring" - תווים כמו סוגריים מוצגים ע"י הדפדפן הפוכים חזותית בתוך הקשר RTL
        // (למשל "(" מצויר בפועל כ-")"), כדי שהטקסט ייקרא נכון. אנחנו מעתיקים את המיקום המדויק
        // שהדפדפן קבע (וזה כבר נכון), אבל צריך לצייר ב-PDF את הצורה ה-*מוצגת* בפועל, לא את התו
        // הגולמי מתוך צומת הטקסט - אחרת הסוגריים יוצאים הפוכים. כל התוכן כאן הוא RTL (dir="rtl"
        // בכל הקובץ), ולכן ההיפוך חל תמיד, ללא צורך בחישוב רמת הטמעת bidi מלא.
        const BIDI_MIRROR_MAP_FOR_PDF = {
            '(': ')', ')': '(',
            '[': ']', ']': '[',
            '{': '}', '}': '{',
            '<': '>', '>': '<',
            '«': '»', '»': '«',
            '‹': '›', '›': '‹'
        };
        function mirrorCharForRtlPdf(ch) {
            return BIDI_MIRROR_MAP_FOR_PDF[ch] || ch;
        }

        function collectCharBoxesForPdf(root) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            const boxes = [];
            let node;
            let lastBaseBottom = null; // מתאפס בכל קריאה לפונקציה - כלומר בכל עמוד בנפרד
            while ((node = walker.nextNode())) {
                const text = node.textContent;
                const parentStyle = getComputedStyle(node.parentElement);
                // תיקון קריטי: getComputedStyle().fontSize מחזיר תמיד את הגודל המקורי (הלוגי), בלי
                // קשר לזום התצוגה הנוכחי (--page-scale, המוחל ע"י CSS zoom על .print-page) - בעוד
                // ש-getBoundingClientRect (המשמש למיקומים בהמשך) כן משקף את הזום בפועל. בלי הכפלה
                // ב-pageScale כאן, כל שינוי בזום (או ב"התאמה לרוחב", שמחשבת זום לפי רוחב החלון
                // הנוכחי) גורם לאי-התאמה בין המיקומים (זום אמיתי) לגודל הגופן המצויר (קבוע) - זה
                // בדיוק מה שגרם לריווח להיראות פעם צפוף ופעם מרווח מדי, תלוי בגודל החלון בזמן היצוא.
                const fontSizePx = parseFloat(parentStyle.fontSize) * (pageScale || 1);
                // משקל הגופן (bold) של התו - נקבע פעם אחת לכל node לפי הסטייל המחושב של האב,
                // בדיוק כמו fontSizePx למעלה. נבדק גם כמילת-מפתח ('bold'/'bolder') וגם כמספר
                // (הדפדפן בד"כ מנרמל ל-string מספרי כמו '400'/'700', אבל שומרים גם על המקרה המילולי)
                const fontWeightRaw = String(parentStyle.fontWeight || '').trim().toLowerCase();
                const isBold = fontWeightRaw === 'bold' || fontWeightRaw === 'bolder' ||
                    parseInt(fontWeightRaw, 10) >= 600;
                for (let i = 0; i < text.length; i++) {
                    const ch = text[i];
                    if (ch.trim() === '' && ch !== '\u00A0') continue;
                    const range = document.createRange();
                    range.setStart(node, i);
                    range.setEnd(node, i + 1);
                    const rect = range.getBoundingClientRect();
                    if (rect.width === 0 && rect.height === 0) continue;

                    const isMark = isCombiningMarkForPdf(ch);
                    let anchorBottom;
                    if (isMark && lastBaseBottom !== null) {
                        anchorBottom = lastBaseBottom;
                    } else {
                        anchorBottom = rect.bottom;
                        if (!isMark) lastBaseBottom = rect.bottom;
                    }

                    // מסמנים ניקוד חולם (U+05B9) בנפרד: בניגוד לשאר הניקוד (שממורכז נכון בתוך
                    // תיבת התו ע"י drawText הרגיל), חולם אמור להיות צמוד לצד שמאל של האות, לא
                    // ממורכז - ראו שימוש בדגל isHolam בפונקציות הציור למטה
                    const isHolam = (ch === '\u05B9');
                    boxes.push({ ch: mirrorCharForRtlPdf(ch), isHolam, rect, anchorBottom, fontSizePx, isBold });
                }
            }
            return boxes;
        }

        const PDF_PX_TO_PT = 0.75; // בהנחת 96dpi -> 72pt

        // הטמעת תמונה בודדת מתוך אלמנט <img> - עם מטמון פר-יצוא (imageCache) כדי שאותה תמונה
        // שמופיעה כמה פעמים באותו ספר לא תיטען/תוטמע פעם נוספת מיותרת. pdf-lib תומך הטמעה ישירה
        // רק ל-PNG/JPEG; פורמטים אחרים (webp/gif/svg) מדולגים בשקט (כמו שהיה קודם לכל התמונות).
        async function embedImageElementForPdf(pdfDoc, imgEl, imageCache) {
            const src = imgEl.currentSrc || imgEl.src;
            if (!src) return null;
            if (imageCache.has(src)) return imageCache.get(src);

            const promise = (async () => {
                try {
                    const resp = await fetch(src);
                    const blob = await resp.blob();
                    const buf = await blob.arrayBuffer();
                    const type = (blob.type || '').toLowerCase();
                    if (type.includes('png') || /\.png(\?|#|$)/i.test(src)) {
                        return await pdfDoc.embedPng(buf);
                    }
                    if (type.includes('jpeg') || type.includes('jpg') || /\.jpe?g(\?|#|$)/i.test(src)) {
                        return await pdfDoc.embedJpg(buf);
                    }
                    return null; // פורמט לא נתמך ישירות ע"י pdf-lib - מדלגים כמו קודם
                } catch (e) {
                    console.error('הטמעת תמונה ביצוא PDF נכשלה', src, e);
                    return null;
                }
            })();
            imageCache.set(src, promise);
            return promise;
        }

        // גרסת ציור "דחוסה" (אופציונלית) לתווי עמוד: זהה במיקומים, בגודל ובגופן בדיוק לגרסה
        // הרגילה (pdfPage.drawText לכל תו בנפרד) - ההבדל היחיד הוא ברמת אופרטורי ה-PDF הגולמיים
        // שנכתבים לזרם התוכן. כל קריאת drawText בודדת מייצרת בפועל תשעה אופרטורים (q, BT, צבע,
        // Tf, TL, Tm, Tj, T*, ET, Q) שחוזרים על עצמם עבור כל תו ותו בעמוד - כפי שאומת ישירות מול
        // קוד המקור של pdf-lib (api/operations.js: drawLinesOfText). כאן, לעומת זאת, נקבעים
        // הצבע והגופן פעם אחת בלבד לכל העמוד (הם קבועים תמיד: צבע שחור אחיד, וגופן ההטמעה היחיד),
        // וכל תווי העמוד נכתבים בתוך בלוק BT/ET יחיד - כל תו עדיין מקבל Tm מוחלט משלו (בדיוק אותם
        // ערכים מספריים כמו בגרסה הרגילה) ולכן אין שום שינוי במיקום/בגודל/במראה החזותי, רק צמצום
        // מספר האופרטורים החוזרים בזרם התוכן. הבנייה משתמשת אך ורק בפונקציות הציבוריות והמתועדות
        // של pdf-lib עצמו (pushOperators, setTextMatrix, showText, setFontAndSize, setFillingColor) -
        // אותן פונקציות בדיוק ש-drawText משתמש בהן פנימית - ולא בשום מבנה נתונים פנימי לא-מתועד.
        function drawCharBoxesCompact(pdfPage, regularFont, boldFont, boxes, pageRect) {
            if (!boxes || boxes.length === 0) return; // בלי טקסט בעמוד - בלי שום שינוי בזרם התוכן, בדיוק כמו בגרסה הרגילה

            const { pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setTextMatrix, showText, setFillingColor, rgb } = PDFLib;

            // רושמים את שני הגופנים במילון המשאבים של העמוד הזה (פעם אחת בלבד לכל אחד), ושומרים
            // את מפתח המשאב של כל אחד בנפרד - pdfPage.fontKey תמיד משקף רק את הקריאה האחרונה
            // ל-setFont, ולכן חייבים ללכוד אותו מיד אחרי כל קריאה כדי להשתמש בשניהם בהמשך
            pdfPage.setFont(regularFont);
            const regularFontKey = pdfPage.fontKey;
            pdfPage.setFont(boldFont);
            const boldFontKey = pdfPage.fontKey;

            const ops = [pushGraphicsState(), setFillingColor(rgb(0, 0, 0)), beginText()];
            let currentSizePt = null;
            let currentFontKey = null;

            for (const box of boxes) {
                try {
                    const font = box.isBold ? boldFont : regularFont;
                    const fontKey = box.isBold ? boldFontKey : regularFontKey;

                    const relAnchorBottom = (box.anchorBottom - pageRect.top) * PDF_PX_TO_PT;
                    const y = (pageRect.height * PDF_PX_TO_PT) - relAnchorBottom;
                    const sizePt = box.fontSizePx * PDF_PX_TO_PT;

                    const relBoxLeft = (box.rect.left - pageRect.left) * PDF_PX_TO_PT;
                    const boxWidthPt = box.rect.width * PDF_PX_TO_PT;
                    let glyphWidthPt = 0;
                    try {
                        glyphWidthPt = font.widthOfTextAtSize(box.ch, sizePt);
                    } catch (e) { /* תו לא נתמך במדידה - נמשיך עם 0, בדיוק כמו בגרסה הרגילה */ }
                    // חולם: יישור לצד שמאל של תיבת התו (במקום מירכוז) - ראו isHolam למעלה
                    const relX = box.isHolam ? relBoxLeft : relBoxLeft + (boxWidthPt - glyphWidthPt) / 2;

                    // קידוד התו לבייטי הגופן - זו הפעולה שעלולה לזרוק עבור תו שאין לו glyph
                    // בגופן שנבחר (בגרסה הרגילה זו בדיוק הפעולה שקורית בתוך drawText עצמו)
                    const encoded = font.encodeText(box.ch);

                    if (currentSizePt === null || sizePt !== currentSizePt || fontKey !== currentFontKey) {
                        ops.push(setFontAndSize(fontKey, sizePt));
                        currentSizePt = sizePt;
                        currentFontKey = fontKey;
                    }
                    ops.push(setTextMatrix(1, 0, 0, 1, relX, y));
                    ops.push(showText(encoded));
                } catch (e) {
                    // תו שאין לו glyph בגופן שנבחר - מדלגים בלב שקט, לא עוצרים את כל היצוא -
                    // בדיוק אותה התנהגות כמו בגרסה הרגילה
                }
            }

            ops.push(endText(), popGraphicsState());
            pdfPage.pushOperators(...ops);
        }

        // גרסת ציור "דחוס יותר" (אופציונלית, ניסיונית מאוד): מרחיבה את המנגנון של drawCharBoxesCompact
        // למעלה צעד נוסף. במקום Tm+Tj נפרד לכל תו (גם כשכולם כבר תחת אותו בלוק BT/ET), מאחדת רצפים
        // מקסימליים של תווים החולקים בדיוק אותו קו-בסיס (y) ואותו גודל גופן, ומונוטוניים בכיוון ה-x
        // (עולה או יורד - למשל רצף עברי רגיל שזורם מימין לשמאל, או רצף מספרים/לועזית שזורם משמאל
        // לימין בתוך שורה עברית) - לכדי אופרטור PDF יחיד מסוג TJ, עם מספרי-תיקון מדויקים בין התווים
        // במקום מיקום מוחלט (Tm) לכל תו בנפרד. שני יתרונות: (1) צמצום משמעותי נוסף בגודל הקובץ
        // מעבר ל"דחוסה" הרגילה, ו-(2) שכבת הטקסט הופכת לניתנת-להעתקה כמילים רציפות (במקום כל תו
        // כפקודת-הצגה נפרדת, שרוב תוכנות ה-PDF מפרשות כגבול-מילה אפשרי - זו הסיבה שהעתקת טקסט
        // משכבת ה-PDF נתקלה עד כה ברווח בין כל תו ותו).
        //
        // שימור מיקום מדויק: מספר-התיקון (adj) בתוך מערך ה-TJ מחושב כך שההתקדמות בפועל בין כל
        // שני תווים - לפי נוסחת המפרט המדויקת של PDF (ISO 32000-1, סעיף 9.4.3):
        // displacement = w0 - (adj/1000)*Tfs - שווה בדיוק להפרש בין ה-relX המקורי של שני התווים
        // (אותו relX-בדיוק שמחושב כאן בדיוק כמו בשתי הגרסאות האחרות למעלה). זו זהות אלגברית
        // מוחלטת (לא קירוב) - אומתה גם בנפרד מול נוסחת המפרט ומול pdf-lib עצמו לפני השילוב כאן.
        // תו יחיד (רצף באורך 1 - למשל תו בודד שמוקף בתווים בגודל גופן שונה, כמו מספר הערת שוליים)
        // ממשיך להיכתב כ-Tm+Tj רגיל, בדיוק כמו ב"דחוסה", בלי שום מערך TJ מיותר.
        //
        // כיוון (RTL מול LTR): מכיוון שב-PDF טקסט תמיד "מתקדם" ב-x גדל (אין תמיכה מובנית בכיוון
        // הפוך בלי להפוך את צורת האותיות עצמן, שזה כמובן לא רצוי) - רצף שבו ה-x *יורד* (כמו זרימת
        // עברית רגילה מימין לשמאל) נאסף ונכתב במערך ה-TJ *בסדר הפוך* לסדר המקורי (מהתו השמאלי
        // ביותר לימני ביותר) - צורת כל גליף בפני עצמו לא משתנה כלל (רק סדר הכתיבה בזרם התוכן),
        // כך שהתוצאה הוויזואלית זהה ב-100% לגרסאות האחרות.
        function drawCharBoxesCompactTJ(pdfPage, regularFont, boldFont, boxes, pageRect) {
            if (!boxes || boxes.length === 0) return; // בלי טקסט בעמוד - בלי שום שינוי בזרם התוכן

            const { pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setTextMatrix, showText, setFillingColor, rgb, PDFArray, PDFNumber, PDFOperator } = PDFLib;

            // רושמים את שני הגופנים במילון המשאבים של העמוד הזה (פעם אחת בלבד לכל אחד), ושומרים
            // את מפתח המשאב של כל אחד בנפרד - pdfPage.fontKey תמיד משקף רק את הקריאה האחרונה
            // ל-setFont, ולכן חייבים ללכוד אותו מיד אחרי כל קריאה כדי להשתמש בשניהם בהמשך
            pdfPage.setFont(regularFont);
            const regularFontKey = pdfPage.fontKey;
            pdfPage.setFont(boldFont);
            const boldFontKey = pdfPage.fontKey;

            // חישוב relX/y/sizePt/glyphWidthPt מראש לכל תו - אותו חישוב מדויק בדיוק כמו בשתי
            // הגרסאות האחרות למעלה (drawCharBoxesCompact והמסלול הרגיל ב-buildPdfFromPages),
            // עם בחירת הגופן (רגיל/בולד) המתאים לכל תו לפי box.isBold
            const items = [];
            for (const box of boxes) {
                const font = box.isBold ? boldFont : regularFont;
                const relAnchorBottom = (box.anchorBottom - pageRect.top) * PDF_PX_TO_PT;
                const y = (pageRect.height * PDF_PX_TO_PT) - relAnchorBottom;
                const sizePt = box.fontSizePx * PDF_PX_TO_PT;

                const relBoxLeft = (box.rect.left - pageRect.left) * PDF_PX_TO_PT;
                const boxWidthPt = box.rect.width * PDF_PX_TO_PT;
                let glyphWidthPt = 0;
                try {
                    glyphWidthPt = font.widthOfTextAtSize(box.ch, sizePt);
                } catch (e) { /* תו לא נתמך במדידה - נמשיך עם 0, בדיוק כמו בגרסאות האחרות */ }
                // חולם: יישור לצד שמאל של תיבת התו (במקום מירכוז) - ראו isHolam למעלה
                const relX = box.isHolam ? relBoxLeft : relBoxLeft + (boxWidthPt - glyphWidthPt) / 2;

                items.push({ ch: box.ch, sizePt, relX, y, glyphWidthPt, isBold: !!box.isBold, font, fontKey: box.isBold ? boldFontKey : regularFontKey });
            }

            const ops = [pushGraphicsState(), setFillingColor(rgb(0, 0, 0)), beginText()];
            let currentSizePt = null;
            let currentFontKey = null;
            let i = 0;

            while (i < items.length) {
                // איתור רצף מקסימלי: אותו y (קו-בסיס), גודל גופן ומשקל (isBold), ומונוטוני ב-x
                // (הכיוון נקבע ע"י הזוג הראשון ברצף ונשמר קבוע לכל אורכו - כל שינוי כיוון/גודל/
                // קו-בסיס/משקל פותח רצף חדש)
                let j = i + 1;
                let direction = 0; // 0=לא נקבע עדיין, 1=עולה (LTR), -1=יורד (RTL)
                while (j < items.length) {
                    const a = items[j - 1], b = items[j];
                    if (a.sizePt !== b.sizePt || a.y !== b.y || a.isBold !== b.isBold) break;
                    const d = b.relX - a.relX;
                    if (d === 0) break; // אין התקדמות אמיתית - לא ממזגים כדי לא לסבך את החישוב לשווא
                    const dir = d > 0 ? 1 : -1;
                    if (direction === 0) direction = dir;
                    else if (dir !== direction) break;
                    j++;
                }

                let run = items.slice(i, j);
                if (direction === -1) run = run.slice().reverse(); // תמיד מהתו השמאלי ביותר לימני ביותר

                // קידוד לגופן, עם דילוג שקט על תווים ללא glyph - בדיוק כמו בשתי הגרסאות האחרות.
                // תו שמדולג בתוך רצף פשוט לא נכנס למערך ה-TJ; שאר תווי הרצף ממשיכים כרגיל.
                const encodedRun = [];
                for (const it of run) {
                    try {
                        encodedRun.push(Object.assign({}, it, { encoded: it.font.encodeText(it.ch) }));
                    } catch (e) { /* דילוג שקט */ }
                }

                if (encodedRun.length > 0) {
                    const sizePt = encodedRun[0].sizePt;
                    const fontKey = encodedRun[0].fontKey;
                    if (currentSizePt === null || sizePt !== currentSizePt || fontKey !== currentFontKey) {
                        ops.push(setFontAndSize(fontKey, sizePt));
                        currentSizePt = sizePt;
                        currentFontKey = fontKey;
                    }
                    ops.push(setTextMatrix(1, 0, 0, 1, encodedRun[0].relX, encodedRun[0].y));

                    if (encodedRun.length === 1) {
                        ops.push(showText(encodedRun[0].encoded));
                    } else {
                        const tjArray = PDFArray.withContext(pdfPage.doc.context);
                        tjArray.push(encodedRun[0].encoded);
                        for (let k = 1; k < encodedRun.length; k++) {
                            const prev = encodedRun[k - 1], cur = encodedRun[k];
                            const desiredDisplacement = cur.relX - prev.relX;
                            const naturalAdvance = prev.glyphWidthPt;
                            const adj = (naturalAdvance - desiredDisplacement) * 1000 / sizePt;
                            tjArray.push(PDFNumber.of(adj));
                            tjArray.push(cur.encoded);
                        }
                        ops.push(PDFOperator.of('TJ', [tjArray]));
                    }
                }

                i = j;
            }

            ops.push(endText(), popGraphicsState());
            pdfPage.pushOperators(...ops);
        }

        async function buildPdfFromPages(pageElements, fontBytesObj, onProgress, compressionMode) {
            const { PDFDocument, rgb } = PDFLib;
            const pdfDoc = await PDFDocument.create();
            pdfDoc.registerFontkit(fontkit);
            const regularFont = await pdfDoc.embedFont(fontBytesObj.regular, { subset: true });
            // אין וריאנט בולד זמין (בחירה ידנית, או שה-API לא סיפק בלוק @font-face נפרד למשקל
            // הזה) - נופלים לאותו גופן רגיל גם לטקסט מודגש, בדיוק כפי שהיה תמיד עד כה
            const boldFont = fontBytesObj.bold
                ? await pdfDoc.embedFont(fontBytesObj.bold, { subset: true })
                : regularFont;
            const imageCache = new Map();

            for (let p = 0; p < pageElements.length; p++) {
                const pageEl = pageElements[p];
                const pageRect = pageEl.getBoundingClientRect();
                if (pageRect.width === 0 || pageRect.height === 0) continue; // ביטחון - עמוד לא מרונדר בפועל

                const pdfPage = pdfDoc.addPage([pageRect.width * PDF_PX_TO_PT, pageRect.height * PDF_PX_TO_PT]);

                // תמונות מוטמעות ומצוירות לפני הטקסט - כך שאם יש חפיפה כלשהי (לא צפוי בפועל,
                // התמונות תמיד column-span:all בעמוד עצמו), הטקסט תמיד יישאר קריא מעליהן
                const imgs = Array.from(pageEl.querySelectorAll('img'));
                for (const imgEl of imgs) {
                    const imgRect = imgEl.getBoundingClientRect();
                    if (imgRect.width === 0 || imgRect.height === 0) continue;
                    const embedded = await embedImageElementForPdf(pdfDoc, imgEl, imageCache);
                    if (!embedded) continue;
                    const ix = (imgRect.left - pageRect.left) * PDF_PX_TO_PT;
                    const iyTop = (imgRect.top - pageRect.top) * PDF_PX_TO_PT;
                    const iw = imgRect.width * PDF_PX_TO_PT;
                    const ih = imgRect.height * PDF_PX_TO_PT;
                    const iy = (pageRect.height * PDF_PX_TO_PT) - iyTop - ih;
                    pdfPage.drawImage(embedded, { x: ix, y: iy, width: iw, height: ih });
                }

                const boxes = collectCharBoxesForPdf(pageEl);

                if (compressionMode === 'compact-tj') {
                    // מסלול "דחוס יותר" (ניסיוני מאוד) - ראו drawCharBoxesCompactTJ למעלה. משמש רק כשנבחר במפורש.
                    drawCharBoxesCompactTJ(pdfPage, regularFont, boldFont, boxes, pageRect);
                } else if (compressionMode === 'compact') {
                    // מסלול "דחוסה" - ראו drawCharBoxesCompact למעלה. משמש רק כשנבחר במפורש.
                    drawCharBoxesCompact(pdfPage, regularFont, boldFont, boxes, pageRect);
                } else {
                    // מסלול רגיל/גבוהה - זהה ב-100% לקוד המקורי, מלבד בחירת גופן (רגיל/בולד) לכל תו
                    for (const box of boxes) {
                        const boxFont = box.isBold ? boldFont : regularFont;
                        const relAnchorBottom = (box.anchorBottom - pageRect.top) * PDF_PX_TO_PT;
                        const y = (pageRect.height * PDF_PX_TO_PT) - relAnchorBottom;
                        const sizePt = box.fontSizePx * PDF_PX_TO_PT;

                        const relBoxLeft = (box.rect.left - pageRect.left) * PDF_PX_TO_PT;
                        const boxWidthPt = box.rect.width * PDF_PX_TO_PT;
                        let glyphWidthPt = 0;
                        try {
                            glyphWidthPt = boxFont.widthOfTextAtSize(box.ch, sizePt);
                        } catch (e) { /* תו לא נתמך במדידה - נמשיך עם 0 */ }
                        // חולם: יישור לצד שמאל של תיבת התו (במקום מירכוז) - ראו isHolam למעלה
                        const relX = box.isHolam ? relBoxLeft : relBoxLeft + (boxWidthPt - glyphWidthPt) / 2;

                        try {
                            pdfPage.drawText(box.ch, { x: relX, y, size: sizePt, font: boxFont, color: rgb(0, 0, 0) });
                        } catch (e) {
                            // תו שאין לו glyph בגופן שנבחר - מדלגים בלב שקט, לא עוצרים את כל היצוא
                        }
                    }
                }

                if (onProgress) onProgress(p + 1, pageElements.length);
                if (p % 3 === 0) await new Promise(r => requestAnimationFrame(r));
            }

            // useObjectStreams: אופציה תקנית ובטוחה של pdf-lib - אורזת אובייקטים פנימיים (לא
            // תוכן/מיקומים בעמוד עצמו) ביעילות רבה יותר, ומצמצמת משקל בלי שום שינוי חזותי - תמיד
            // מופעלת, בשני המסלולים. (בדיקה מול קוד המקור של pdf-lib העלתה ש"useCompression" אינו
            // פרמטר אמיתי של save() - תוכן העמודים, הגופן והתמונות כבר נדחסים תמיד באופן אוטומטי
            // ע"י הספרייה עצמה; הצמצום האמיתי במשקל מגיע ממספר האופרטורים הקטן יותר במסלול
            // "הדחוסה" למעלה, לא מדגל דחיסה נוסף בשמירה עצמה.)
            return await pdfDoc.save({ useObjectStreams: true });
        }

        // מחלצת מתוך מחרוזת css (המוחזרת מ-fonts.resolveFamilies) את כתובת ה-data: של בלוק
        // @font-face שמתאים למשקל המבוקש (bold/רגיל). לפי API_REFERENCE, האוצריא מזריקה "את
        // ה-face הבולד האמיתי שלה" יחד עם הרגיל בהזרקה האוטומטית לתצוגה - ולכן סביר שגם כאן
        // ה-css יכול להכיל כמה בלוקי @font-face לאותה משפחה (אחד לכל משקל). קודם ניסינו לוקחים
        // רק את בלוק ה-url הראשון בקובץ כולו, בלי קשר למשקל - מה שגרם לטקסט מודגש להיות מיוצא
        // תמיד עם הגליפים הרגילים. אם לא נמצא בלוק שתואם בדיוק למשקל המבוקש, מוחזר הבלוק
        // הראשון שכן נמצא (עדיף גופן קיים בכל משקל, מאשר שום גופן).
        function extractFontFaceUrl(css, wantBold) {
            if (!css) return null;
            const blockRegex = /@font-face\s*\{([^}]*)\}/g;
            let m;
            let fallbackUrl = null;
            while ((m = blockRegex.exec(css))) {
                const block = m[1];
                const urlMatch = block.match(/src:\s*url\((['"]?)(data:[^'")]+)\1\)/);
                if (!urlMatch) continue;
                if (!fallbackUrl) fallbackUrl = urlMatch[2];
                const weightMatch = block.match(/font-weight:\s*([^;]+);?/i);
                const weightRaw = weightMatch ? weightMatch[1].trim().toLowerCase() : 'normal';
                const isBoldFace = weightRaw === 'bold' || weightRaw === 'bolder' || parseInt(weightRaw, 10) >= 600;
                if (isBoldFace === wantBold) return urlMatch[2];
            }
            return fallbackUrl;
        }

        // שרשרת השגת בייטי הגופן ליצוא, לפי סדר עדיפות:
        // 1) בייטים שנשמרו ידנית מבחירת קובץ מתוך בורר "גופן הספר" (ראו onFontPickerFileChosen),
        //    ורק אם הם שייכים בדיוק למשפחה הנוכחית (pdfExportFontName === familyName). אלו הבייטים
        //    המדויקים שהמשתמש בחר בעצמו, ולכן גוברים על ה-API - וזה גם קריטי טכנית: כשבוחרים קובץ
        //    ידנית, השם שנשמר הוא שם הקובץ, שכמעט לעולם אינו גופן מערכת/גופן ארוז מוכר. קריאה ל-
        //    fonts.resolveFamilies על שם כזה לא תמצא את הגופן המבוקש עצמו, אבל היא כן "מצליחה" -
        //    result.success=true עם css תקין - כי היא נופלת לאחד מהתחליפים (substitutes), למשל
        //    'David' שכמעט תמיד ארוז. אין דרך להבחין מתוך result.success בין התאמה אמיתית לנפילה-
        //    לתחליף, ולכן אם ה-API היה נבדק ראשון הוא היה "מנצח" בטעות ומייצא עם גופן שגוי (התחליף)
        //    במקום עם הגופן שנבחר בפועל. הבחירה הידנית היא קובץ יחיד (משקל רגיל בלבד) - אין וריאנט
        //    בולד זמין לה, ולכן טקסט מודגש ימשיך להיות מיוצא עם אותו גופן (bold: null).
        // 2) ניסיון שקט לפי ה-API הרשמי (fonts.resolveFamilies, זמין מגרסת אוצריא 0.9.97 ואילך -
        //    ראו API_REFERENCE) - רלוונטי כשנבחר גופן לפי שם (למשל גופן מערכת מותקן) בלי בחירת קובץ.
        //    מחזיר גם את וריאנט הבולד אם קיים בלוק @font-face נפרד עבורו (ראו extractFontFaceUrl).
        // 3) נפילה חזרה לבייטים שנשמרו ידנית בכל מקרה אחר (גם אם הם ממשפחה אחרת - עדיף מכלום).
        //
        // הערך המוחזר הוא תמיד { regular, bold } (או null אם לא נמצא שום גופן) - regular הוא
        // ArrayBuffer שתמיד קיים כשהפונקציה לא מחזירה null, bold הוא ArrayBuffer או null אם
        // אין וריאנט בולד זמין (ואז buildPdfFromPages נופל חזרה לשימוש ב-regular גם לטקסט מודגש).
        async function getFontBytesForExport() {
            const familyName = currentSettings.customFontFamily ||
                (lastKnownTheme && lastKnownTheme.typography && lastKnownTheme.typography.fontFamily) ||
                'David';

            if (pdfExportFontBytes && pdfExportFontName === familyName) {
                return { regular: pdfExportFontBytes, bold: null };
            }

            try {
                const result = await Otzaria.call('fonts.resolveFamilies', {
                    // השם המבוקש (familyName) מופיע גם בראש substitutes, לא רק בשדה name: בבדיקה
                    // בפועל, resolveFamilies נטתה תמיד לגופן הראשון ב-substitutes (Times New Roman)
                    // גם כשה-name עצמו היה גופן קיים ומדויק (David, SBL Hebrew) - כלומר בפועל לא
                    // ניתנת עדיפות אמיתית ל-name לעומת substitutes כפי שהתיעוד מתאר. כפילות familyName
                    // כאן היא הביטוח שהגופן שבאמת נבחר יקבל את הניסיון הראשון בכל מקרה, ו-Times New
                    // Roman (הגנרי ביותר, וכמעט תמיד מותקן) נדחף לסוף כתחליף אחרון באמת.
                    families: [{ name: familyName, substitutes: [familyName, 'David', 'Segoe UI', 'Times New Roman'] }]
                });
                if (result && result.success && result.data && result.data.css) {
                    const css = result.data.css;
                    const regularUrl = extractFontFaceUrl(css, false);
                    if (regularUrl) {
                        const regular = await (await fetch(regularUrl)).arrayBuffer();
                        let bold = null;
                        const boldUrl = extractFontFaceUrl(css, true);
                        if (boldUrl && boldUrl !== regularUrl) {
                            try {
                                bold = await (await fetch(boldUrl)).arrayBuffer();
                            } catch (e) { /* וריאנט בולד לא נטען - נמשיך בלי, ראו fallback ב-buildPdfFromPages */ }
                        }
                        return { regular, bold };
                    }
                }
            } catch (e) {
                // לא זמין בגרסה הנוכחית - נופלים לגופן שנשמר ידנית, ראו למטה
            }

            return pdfExportFontBytes ? { regular: pdfExportFontBytes, bold: null } : null;
        }

        async function exportPdfFromModal() {
            const tab = tabs[activeTabIndex];
            if (!tab || tab.isNewBookTab || !tab.cachedPreview) {
                setPrintExportStatus('אין ספר טעון לייצוא.');
                return;
            }
            if (typeof PDFLib === 'undefined' || typeof fontkit === 'undefined') {
                setPrintExportStatus('שגיאה: pdf-lib.min.js ו/או fontkit.umd.min.js לא נטענו כראוי.');
                return;
            }

            const btn = document.getElementById('print-export-pdf-btn');
            const cancelBtn = document.querySelector('.print-export-cancel-btn');
            btn.disabled = true;
            if (cancelBtn) cancelBtn.disabled = true;
            setPrintExportStatus('מכין גופן...');

            const fontBytes = await getFontBytesForExport();
            if (!fontBytes) {
                setPrintExportStatus('לא נמצא גופן לייצוא. בחר קובץ גופן דרך "גופן הספר" בהגדרות.');
                btn.disabled = false;
                if (cancelBtn) cancelBtn.disabled = false;
                return;
            }

            const excludeSet = computeExcludedPageIndices();
            setPrintExportStatus('מכין עמודים...');

            // קונטיינר זמני מחוץ למסך (לא display:none - כדי ש-getBoundingClientRect ימשיך לעבוד
            // נכון) מתוך tab.cachedPreview - "תצוגת עמוד" שטוחה, בדיוק כמו שההדפסה בתצוגת ספר כבר
            // עושה בכוונה - כך היצוא תמיד עקבי בלי תלות במצב התצוגה הנוכחי ובלי לגעת בווירטואליזציה
            const offscreen = document.createElement('div');
            offscreen.id = 'pdf-export-offscreen-pages';
            offscreen.style.position = 'fixed';
            offscreen.style.top = '0';
            offscreen.style.left = '-99999px';
            offscreen.innerHTML = tab.cachedPreview;
            document.body.appendChild(offscreen);

            try {
                let pageElements = Array.from(offscreen.querySelectorAll(':scope > .print-page'));
                if (excludeSet) {
                    pageElements = pageElements.filter((_, idx) => !excludeSet.has(idx));
                }
                if (pageElements.length === 0) {
                    setPrintExportStatus('אין עמודים בטווח שנבחר.');
                    return;
                }

                const selectedQuality = document.getElementById('print-export-quality').value;
                const compressionMode = selectedQuality === 'compressed-more' ? 'compact-tj'
                    : selectedQuality === 'compressed' ? 'compact'
                    : null;
                const pdfBytes = await buildPdfFromPages(pageElements, fontBytes, (done, total) => {
                    setPrintExportStatus('מייצא... עמוד ' + done + ' מתוך ' + total);
                }, compressionMode);

                const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = (tab.title || 'ספר') + '.pdf';
                a.click();

                setPrintExportStatus('הושלם! (' + (pdfBytes.length / 1024).toFixed(0) + ' KB)');
            } catch (err) {
                console.error('יצוא PDF נכשל', err);
                setPrintExportStatus('שגיאה ביצוא: ' + err.message);
            } finally {
                offscreen.remove();
                btn.disabled = false;
                if (cancelBtn) cancelBtn.disabled = false;
            }
        }
