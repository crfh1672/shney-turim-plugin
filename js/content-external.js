        async function sanitizeAndBalanceTags(text) {
            if (!text) return '';

            const tokens = [];
            let lastIndex = 0;
            let match;
            VALID_TAG_RE.lastIndex = 0;
            let opCount = 0;
            let batchStart = performance.now();

            while ((match = VALID_TAG_RE.exec(text)) !== null) {
                if (match.index > lastIndex) {
                    tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) });
                }
                const raw = match[0];
                const isClosing = raw.charAt(1) === '/';
                const nameMatch = raw.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/);
                const tagName = nameMatch ? nameMatch[1].toLowerCase() : '';
                const isSelfClosing = /\/>\s*$/.test(raw) || VOID_TAG_NAMES.has(tagName);
                tokens.push({
                    type: isClosing ? 'close' : (isSelfClosing ? 'void' : 'open'),
                    tag: tagName,
                    raw
                });
                lastIndex = VALID_TAG_RE.lastIndex;

                if (++opCount % 2000 === 0 && performance.now() - batchStart > 30) {
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    batchStart = performance.now();
                }
            }
            if (lastIndex < text.length) {
                tokens.push({ type: 'text', value: text.slice(lastIndex) });
            }

            // ניקוי טקסט משאריות של תגיות שבורות/לא-תקינות תחבירית (< או > בודדים שלא היו חלק מתג תקין),
            // וגם משאריות תכונות HTML כמו data-commentator="..." data-label=... שנשארות כטקסט גלוי
            // כשתג נשבר/נחתך (לרוב מפוצל בין שני צ'אנקים) ולכן לא זוהה כתג תקין מלכתחילה
            batchStart = performance.now();
            for (let i = 0; i < tokens.length; i++) {
                const tok = tokens[i];
                if (tok.type === 'text') {
                    tok.value = tok.value
                        .replace(/<[^>]*$/g, '')
                        // תכונות HTML שדלפו כטקסט. חייב לכסות גם צורה *לא מאוזנת* כמו
                        // data-commentator=Mishnah Berurah"  (בלי מרכאה פותחת) - זה מה שקורה
                        // כשתג נחתך בדיוק על גבול צ'אנק, ולכן הניקוי הקודם שדרש זוג מרכאות פספס אותו.
                        .replace(/\bdata-[a-zA-Z-]+\s*=\s*"[^"]*"/g, '')
                        .replace(/\bdata-[a-zA-Z-]+\s*=\s*[^"'\s>]*[^\s>]*"?/g, '')
                        .replace(/\bdata-[a-zA-Z-]+\s*=?/g, '')
                        .replace(/\b[a-zA-Z_:][-a-zA-Z0-9_:.]*\s*=\s*(?:"[^"]*"|'[^']*')/g, '')
                        .replace(/\b(?:class|id|style|href|src|title|lang|dir)\s*=\s*[^\s>]*/gi, '')
                        .replace(/[<>]/g, '');
                }
                if (i % 5000 === 0 && performance.now() - batchStart > 30) {
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    batchStart = performance.now();
                }
            }

            const output = [];
            const stack = []; // {tag, outIdx}
            const removedIdxs = new Set();

            batchStart = performance.now();
            for (let i = 0; i < tokens.length; i++) {
                const tok = tokens[i];
                if (tok.type === 'text' || tok.type === 'void') {
                    output.push(tok.type === 'text' ? tok.value : tok.raw);
                } else if (tok.type === 'open') {
                    stack.push({ tag: tok.tag, outIdx: output.length });
                    output.push(tok.raw);
                } else if (tok.type === 'close') {
                    // חיפוש תג הפתיחה התואם במחסנית (מהסוף להתחלה)
                    let foundIdx = -1;
                    for (let s = stack.length - 1; s >= 0; s--) {
                        if (stack[s].tag === tok.tag) { foundIdx = s; break; }
                    }
                    if (foundIdx === -1) {
                        // תג סגירה יתום, ללא פתיחה תואמת - מדלגים עליו לגמרי, לא מוצג
                    } else {
                        // כל תג שנפתח אחרי ההתאמה ולא נסגר עדיין (קינון שבור) - מוסר לגמרי כדי לא לזהם את הטקסט
                        for (let s = stack.length - 1; s > foundIdx; s--) {
                            removedIdxs.add(stack[s].outIdx);
                        }
                        stack.length = foundIdx; // מסיר עד ותוך כדי ההתאמה עצמה (שנסגרת עכשיו כהלכה)
                        output.push(tok.raw);
                    }
                }

                if (i % 5000 === 0 && performance.now() - batchStart > 30) {
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    batchStart = performance.now();
                }
            }

            // כל תג שנשאר פתוח עד סוף התוכן ומעולם לא נסגר - מסירים גם את הפתיחה שלו (לא משאירים אותו פתוח)
            stack.forEach(s => removedIdxs.add(s.outIdx));

            return output.filter((_, idx) => !removedIdxs.has(idx)).join('');
        }

        /* --- שיפור 1: משיכה מקבילית מהירה מבוססת הגדרת משתמש --- */
        // קריאה בודדת עם ניסיונות חוזרים - כדי שכשל רשת חד-פעמי לא יפיל את כל משיכת הספר או יקטע אותה באמצע
        async function fetchChunkWithRetry(bookId, offset, limit, retries) {
            for (let attempt = 0; attempt <= retries; attempt++) {
                try {
                    const res = await Otzaria.call('library.getBookContent', { bookId, offset, limit });
                    return res;
                } catch (err) {
                    console.error(`fetchChunkWithRetry: כשל בקבלת תוכן (offset=${offset}, ניסיון ${attempt + 1}/${retries + 1})`, err);
                    if (attempt < retries) {
                        await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
                    }
                }
            }
            // כל הניסיונות נכשלו - מחזירים תוצאה ריקה במקום להפיל את כל תהליך המשיכה
            return { data: '' };
        }

        async function fetchEntireBook(bookId, progressCallback, tabRef) {
            const limit = 5000;
            const concurrency = currentSettings.concurrency || 6;
            // בלם ביטחון מוחלט - מונע לולאה אינסופית גם אם ה-API מחזיר נתונים שלא נגמרים כראוי
            const MAX_ITERATIONS = 20000; // בטבור: 20000 * concurrency * limit ~= מיליארד תווים, מעבר לזה יש בעיה אמיתית

            // שיפור מהירות: מאגר עובדים מתמשך (worker pool) במקום משיכה ב"סבבים" סינכרוניים
            // (Promise.all של concurrency בקשות, המתנה לכולן, ואז הסבב הבא). בגישה הקודמת ערוץ
            // יחיד שמתעכב (למשל בגלל ניסיון חוזר עם השהיה) היה עוצר את הסבב כולו - כולל ערוצים
            // שכבר סיימו וחיכו לסבב הבא. כאן כל "עובד" פונה מייד לפיסה הבאה בתור ברגע שסיים את
            // הקודמת שלו, כך שכל ערוצי המשיכה עסוקים כמעט תמיד. סדר ההרכבה הסופי של הטקסט לא
            // נפגע: כל פיסה נשמרת לפי אינדקס קבוע-מראש (chunkIndex, הנקבע בסדר עלייה קפדני בזמן
            // ה"הוצאה לדרך" של הבקשות), ולא לפי סדר קבלת התשובה בפועל.
            const results = [];
            let nextChunkToLaunch = 0;
            let totalChunksKnown = Infinity; // גבול עליון (לא כולל) לאינדקס הפיסה האחרונה - נקבע ברגע שמתקבלת פיסה קצרה/ריקה
            let completedCount = 0;

            async function worker() {
                while (true) {
                    // ביטול מיידי אם הטאב שעבורו נמשך הספר נסגר בינתיים (ראו closeTab) - כל עובד
                    // בודק זאת לפני שהוא יוצא לדרך עם עוד בקשת רשת, כך שסגירת טאב תעצור את כל
                    // המשיכה תוך פסק זמן קצר של בקשה אחת שכבר הייתה באוויר (ולא ימשיך לגרור עוד
                    // ועוד פיסות ברקע לספר שכבר לא רלוונטי לאף אחד).
                    if (tabRef && tabRef._closed) return;
                    if (nextChunkToLaunch >= totalChunksKnown) return;
                    if (nextChunkToLaunch >= MAX_ITERATIONS) {
                        if (totalChunksKnown === Infinity) {
                            console.error('fetchEntireBook: הגעה למספר איטרציות מקסימלי - עצירת בטיחות למניעת לולאה אינסופית');
                            totalChunksKnown = MAX_ITERATIONS;
                        }
                        return;
                    }
                    const chunkIndex = nextChunkToLaunch++;
                    const res = await fetchChunkWithRetry(bookId, chunkIndex * limit, limit, 2);
                    // הבקשה כבר הייתה באוויר כשהטאב נסגר - בודקים שוב מיד לאחר קבלת התשובה ולפני
                    // כתיבתה, כדי לא לעדכן results/completedCount/progressCallback עבור טאב סגור
                    if (tabRef && tabRef._closed) return;
                    const rawData = (res && typeof res.data === 'string') ? res.data : '';
                    // שומרים את הטקסט הגולמי כפי שהוא (ללא עיבוד) - החיבור הרציף בין הצ'אנקים מבטיח
                    // שתגית שנחתכה בדיוק על גבול צ'אנק תתאחד בחזרה לתגית שלמה ותקינה
                    results[chunkIndex] = rawData;
                    completedCount++;
                    if (progressCallback) progressCallback(completedCount * limit);

                    if (rawData.trim() === "") {
                        // פיסה ריקה - הספר הסתיים לפני האינדקס הזה, הפיסה הריקה עצמה לא נכללת
                        if (chunkIndex < totalChunksKnown) totalChunksKnown = chunkIndex;
                    } else if (rawData.length < limit) {
                        // פיסה לא-ריקה אך קצרה יותר ממה שביקשנו - זהו קטע התוכן האחרון של הספר, כן נכלל
                        if (chunkIndex + 1 < totalChunksKnown) totalChunksKnown = chunkIndex + 1;
                    }
                }
            }

            const workers = [];
            for (let i = 0; i < concurrency; i++) workers.push(worker());
            await Promise.all(workers);

            const finalChunkCount = (totalChunksKnown === Infinity) ? nextChunkToLaunch : totalChunksKnown;
            const rawChunks = [];
            for (let i = 0; i < finalChunkCount; i++) rawChunks.push(results[i] || '');

            // חיבור רציף של כל הצ'אנקים כפי שהתקבלו (ללא מפריד מלאכותי), איזון תגיות על פני כל הספר,
            // ורק אז פיצול לשורות ועטיפת כל שורה לא-ריקה בתגית פסקה תקנית
            const fullRawText = rawChunks.join('');
            const balanced = await sanitizeAndBalanceTags(fullRawText);
            const lines = balanced.split(/\r?\n/);
            const wrapped = [];
            let formatBatchStart = performance.now();
            // contentLineIdx: אינדקס עוקב (0-based) שסופר רק שורות תוכן שאינן ריקות - זו, ולא
            // מספר השורה הפיזי בתוך הטקסט הגולמי (i), היא ההשערה הסבירה ביותר למערכת המספור
            // שמשמשת גם את reader.getCurrentState (currentIndex) וגם את library.getBookToc
            // (index): כנראה שמערכת אוצריא מאחסנת את הספר כמערך של שורות-תוכן בלבד (ללא שורות
            // ריקות), ו-library.getBookContent פשוט מוסיף שורות ריקות בין הפסקאות לצורך תצוגה
            // כטקסט שטוח. ספירה לפי מספר השורה הפיזי (כולל הרווחים המלאכותיים האלה) הייתה גורמת
            // לסטייה שהולכת ומצטברת ככל שמתקדמים בספר - בדיוק התסמין שדווח (קפיצה שנוחתת תמיד
            // ליד תחילת הספר בפועל, במקום במיקום האמיתי).
            let contentLineIdx = 0;
            for (let i = 0; i < lines.length; i++) {
                const trimmed = lines[i].trim();
                // data-line-idx: אינדקס שורת התוכן (0-based, סופר רק שורות לא-ריקות) - נשמר
                // כתכונת HTML כדי לאפשר בהמשך לאתר את העמוד המדויק שמכיל שורה נתונה (ראו
                // locatePageIndexForLineIndex).
                if (trimmed) {
                    wrapped.push(`<p data-line-idx="${contentLineIdx}">${trimmed}</p>`);
                    contentLineIdx++;
                }
                if (i % 5000 === 0 && performance.now() - formatBatchStart > 30) {
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    formatBatchStart = performance.now();
                }
            }
            return wrapped.join("");
        }

        /* --- שיפור 2: דיוק סידור דפים ללא חיתוך מילים --- */
        function isOverflowing(el) {
            return el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
        }

        // בדיקת גלישה תוך התעלמות מוחלטת מבלוק ההערות שבתחתית העמוד (אם קיים). משמשת אך ורק
        // בהרחבת הבחירה עבור הערת שוליים ענקית (ראו למטה) - לעולם לא בהחלטות "כפייה" רגילות, כדי
        // לא לחזור על הבאג הקודם (לולאה אינסופית של עמודים ריקים כשהפניה בודדת לא הצליחה להיכנס).
        function isOverflowingExcludingFootnotes(container) {
            const block = container.querySelector(':scope > .page-footnotes-block');
            if (!block) return isOverflowing(container);
            const prevDisplay = block.style.display;
            block.style.display = 'none';
            const result = isOverflowing(container);
            block.style.display = prevDisplay;
            return result;
        }

        // בדיקה האם הערת שוליים נתונה הייתה נכנסת במלואה אילו הוצגה לבדה בעמוד ריק וטרי לגמרי -
        // משמשת כדי להבחין בין הערה "רגילה" (שפשוט לא נכנסת בשארית המקום של העמוד הנוכחי, אבל
        // כן הייתה נכנסת בשלמותה בעמוד חדש - ואז עדיף להמשיך ולדחות את כולה כרגיל, כמקובל בדפוס)
        // לבין הערה "ענקית באמת" (שלא הייתה נכנסת גם בעמוד ריק לגמרי) - שעבורה אין שום תועלת
        // בדחייה, ועדיף לתפוס את ההפניה כבר עכשיו ולמצות את שארית המקום הפנוי בעמוד הנוכחי.
        function wouldFootnoteFitOnBlankPage(footnoteId, footnoteText, cols, pageHeightMm, bookTitle) {
            const testPage = document.createElement('div');
            testPage.className = 'print-page';
            testPage.style.setProperty('--cols', cols || '2');
            testPage.style.position = 'fixed';
            testPage.style.top = '-9999px';
            testPage.style.height = (pageHeightMm || 297) + 'mm';
            testPage.style.overflow = 'hidden';
            document.body.appendChild(testPage);
            preparePageWithHeader(testPage, 1, bookTitle, '');
            const block = document.createElement('div');
            block.className = 'page-footnotes-block' + (currentSettings.footnoteTwoColumn ? ' footnote-two-col' : '');
            const line = document.createElement('div');
            line.className = 'page-footnote-line';
            line.dataset.fnId = footnoteId;
            line.innerHTML = `<sup>${footnoteId}</sup> ${footnoteText}`;
            block.appendChild(line);
            testPage.appendChild(block);
            const fits = !isOverflowing(testPage);
            document.body.removeChild(testPage);
            return fits;
        }

        // הוספת תוכן ל-measureContainer תוך שמירה על כך שבלוק ההערות (אם קיים) תמיד יישאר
        // הצאצא האחרון - כדי שבתמונה הסופית של העמוד ההערות תמיד יופיעו בסוף, אחרי כל שאר התוכן
        function appendToMeasureContainer(container, node) {
            const footnotesBlock = container.querySelector(':scope > .page-footnotes-block');
            container.insertBefore(node, footnotesBlock || null);
        }

        // סנכרון בלוק ההערות שבתחתית העמוד לפי מה שבאמת נמצא כרגע ב-measureContainer: סורק את כל
        // הפניות ההערות (sup.footnote-ref) שכבר נכנסו בפועל לעמוד הזה, ובונה/מעדכן לפיהן את הבלוק.
        // הפעלה חוזרת של הפונקציה הזו זולה ובטוחה - היא תמיד בונה מחדש מאפס לפי המצב הנוכחי, כך
        // שגם אם חלק מהתוכן (ועימו הפניה להערה) הוחזר לתור בגלל פיצול עמוד, ההערה תוסר אוטומטית
        // מהעמוד הנוכחי ותופיע בעמוד הבא יחד עם ההפניה עצמה.
        //
        // carryEntry: { id, text } - "זנב" של הערת שוליים ארוכה שלא נכנסה במלואה בעמוד הקודם (ראו
        // trimFootnotesToFitPage למטה). ה-text כאן הוא רק החלק שנותר להצגה, לא הטקסט המלא של ההערה.
        // שורת ההמשך הזו מוצגת תמיד ראשונה בבלוק ההערות של העמוד הנוכחי - גם אם אין בעמוד הזה שום
        // הפניה חדשה - כדי שהערה ארוכה תמשיך ברצף על פני כמה עמודים במקום להיחתך/להיעלם.
        function syncPageFootnotes(container, footnotesMap, carryEntry) {
            const refs = container.querySelectorAll('sup.footnote-ref');
            let block = container.querySelector(':scope > .page-footnotes-block');

            if (refs.length === 0 && !carryEntry) {
                if (block) block.remove();
                return;
            }

            const seenIds = [];
            refs.forEach(r => {
                const id = r.getAttribute('data-fn-id');
                if (id && !seenIds.includes(id)) seenIds.push(id);
            });

            if (!block) {
                block = document.createElement('div');
            }
            // תמיד מסונכרן מחדש (לא רק ביצירה) - כדי שאם המשתמש שינה את המתג "שני טורים" באמצע
            // הפעלה, בלוקים קיימים שנעשה בהם שימוש חוזר בתוך אותו מעבר עימוד עדיין ישקפו את הערך
            // הנוכחי של currentSettings.footnoteTwoColumn
            block.className = 'page-footnotes-block' + (currentSettings.footnoteTwoColumn ? ' footnote-two-col' : '');
            block.innerHTML = '';

            if (carryEntry && carryEntry.text) {
                const carryLine = document.createElement('div');
                carryLine.className = carryEntry.isFirstAppearance ? 'page-footnote-line' : 'page-footnote-line page-footnote-continued';
                carryLine.dataset.fnId = carryEntry.id;
                carryLine.innerHTML = `<sup>${carryEntry.id}</sup> ${carryEntry.text}`;
                block.appendChild(carryLine);
            }

            if (footnotesMap) {
                seenIds.forEach(id => {
                    if (carryEntry && String(carryEntry.id) === String(id)) return; // כבר טופל למעלה כשורת המשך
                    const text = footnotesMap[id];
                    if (!text) return;
                    const line = document.createElement('div');
                    line.className = 'page-footnote-line';
                    line.dataset.fnId = id;
                    line.innerHTML = `<sup>${id}</sup> ${text}`;
                    block.appendChild(line);
                });
            }

            if (block.childNodes.length === 0) {
                block.remove();
                return;
            }
            container.appendChild(block); // מוזז/נוסף תמיד כצאצא האחרון
        }

        // צמצום חכם של בלוק ההערות כאשר הערת השוליים האחרונה בעמוד גדולה מדי ולא נכנסת בשלמותה:
        // מקצצים אותה ברמת מילה (חיפוש בינארי מדויק מול isOverflowing, בדיוק כמו עם טקסט הגוף הרגיל)
        // עד שהעמוד כבר לא גולש, ומחזירים את "הזנב" שנשאר - כדי שהוא יוצג בתור שורת המשך בראש בלוק
        // ההערות של העמוד הבא (syncPageFootnotes עם carryEntry), במקום פשוט לדחוף את כל ההערה
        // כמקשה אחת לעמוד הבא (או להציג אותה גולשת/חתוכה בעמוד הנוכחי).
        function trimFootnotesToFitPage(measureContainer) {
            const block = measureContainer.querySelector(':scope > .page-footnotes-block');
            if (!block) return null;

            const lines = Array.from(block.querySelectorAll(':scope > .page-footnote-line'));
            if (lines.length === 0) return null;

            // מטפלים תמיד בהערה האחרונה בבלוק - זו שכמעט תמיד האחראית לגלישה (ההערה שההפניה אליה
            // נוספה לאחרונה לעמוד הזה)
            const line = lines[lines.length - 1];
            const id = line.dataset.fnId;
            const supEl = line.querySelector('sup');
            const supHtml = supEl ? supEl.outerHTML : '';
            const currentHtml = (supEl ? line.innerHTML.slice(supHtml.length) : line.innerHTML).trim();

            if (!currentHtml) {
                line.remove();
                return null;
            }

            // בודקים מראש אם השורה כבר הייתה שורת "המשך" (page-footnote-continued) - כלומר האם
            // כבר הוצג חלק כלשהו מההערה הזו בעמוד קודם. חשוב להבחין בין זה לבין מקרה שבו כל ההערה
            // (כולל תחילתה) נדחית כעת לעמוד הבא בפעם הראשונה - במקרה השני אסור לתייג את השורה
            // בעמוד הבא כ"המשך", כי בפועל שום דבר ממנה עוד לא הוצג בשום מקום.
            const wasAlreadyContinuation = line.classList.contains('page-footnote-continued');

            const words = currentHtml.split(/\s+/).filter(Boolean);
            let low = 0, high = words.length, fit = 0;

            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                line.innerHTML = `${supHtml} ${words.slice(0, mid).join(' ')}`;
                if (!isOverflowing(measureContainer)) {
                    fit = mid;
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }

            if (fit <= 0) {
                // אפילו מילה אחת מההערה לא נכנסת בעמוד הזה - כל ההערה עוברת בשלמותה לעמוד הבא.
                // מסמנים isFirstAppearance כדי שהעמוד הבא לא יתייג אותה בטעות כ"המשך" אם זו למעשה
                // הופעתה הראשונה של ההערה (ראו syncPageFootnotes).
                line.remove();
                return { id, text: currentHtml, isFirstAppearance: !wasAlreadyContinuation };
            }

            line.innerHTML = `${supHtml} ${words.slice(0, fit).join(' ')}`;
            if (fit < words.length) {
                line.classList.add('footnote-line-continues');
                return { id, text: words.slice(fit).join(' '), isFirstAppearance: false };
            }
            return null; // כל ההערה נכנסה בסופו של דבר - אין המשך נדרש
        }

// פונקציית עזר המפרקת את צמתי הטקסט בתוך פסקה למילים בודדות כדי לאפשר עימוד ברמת המילה
        function splitTextNodesIntoWords(element) {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            const textNodes = [];
            while (walker.nextNode()) {
                textNodes.push(walker.currentNode);
            }
            textNodes.forEach(node => {
                const text = node.textContent;
                const tokens = text.split(/(\s+)/); // פיצול לפי מילים ורווחים
                if (tokens.length > 1) {
                    const parent = node.parentNode;
                    if (parent) {
                        const frag = document.createDocumentFragment();
                        tokens.forEach(token => {
                            if (token !== '') {
                                frag.appendChild(document.createTextNode(token));
                            }
                        });
                        parent.replaceChild(frag, node);
                    }
                }
            });
        }

async function paginateContent(htmlContent, targetTabIndex) {
            const targetTab = tabs[targetTabIndex];
            if (!targetTab) return;

            // לשמירה במטמון העימוד (ראו pagination-cache.js) בסיום: התוכן הגולמי *לפני* הסינון, כדי
            // שהגיבוב יתאים לזה שמחושב בפתיחה הבאה מתוך tab.rawContent, וחתימת הפריסה כפי שהייתה
            // ברגע תחילת המדידה. קבצים חיצוניים (docx/טקסט מהמחשב) אינם נשמרים - אין להם מקור לאמת מולו.
            const rawContentForCache = htmlContent;
            const layoutSigAtStart = (typeof PaginationCache !== 'undefined' && PaginationCache.isAvailable() && !targetTab.isExternal && targetTab.id)
                ? PaginationCache.computeLayoutSignature(targetTab)
                : null;

            htmlContent = applyTextFilters(htmlContent);

            targetTab.cachedPreview = ''; // ניקוי מטמון בהתחלה
            // מזהה ביטול per-tab (ולא מונה גלובלי משותף לכל הטאבים) - כדי שעימוד של טאב אחד לא
            // יבטל עימוד שרץ במקביל בטאב אחר, ובכך יאפשר משיכה/עימוד מקבילים של כמה ספרים בו-זמנית.
            // עדיין מבטל נכון קריאה קודמת *לאותו טאב* (למשל שינוי גופן/עמודות תוך כדי טעינה).
            targetTab.paginationToken = (targetTab.paginationToken || 0) + 1;
            const currentPaginationSession = targetTab.paginationToken;

            targetTab.pagesRendered = false;
            targetTab._tocComplete = false;
            targetTab.isRendering = true;
            
            const previewArea = document.getElementById('preview-area');
            const banner = document.getElementById('pagination-banner');

            const measureContainer = document.createElement('div');
            measureContainer.className = 'print-page';
            measureContainer.style.setProperty('--cols', targetTab.cols || "2");
            measureContainer.style.position = 'fixed';
            measureContainer.style.top = '-9999px';
            // גובה נמדד לפי גודל העמוד הנוכחי (--page-height) ולא A4 קבוע, כדי שעימוד יתחשב בגודל
            // עמוד מותאם-אישית
            measureContainer.style.height = (currentSettings.pageHeightMm || 297) + 'mm';
            measureContainer.style.overflow = 'hidden';
            // בידוד ה-reflow של מכל המדידה משאר המסמך: הדפדפן מקבל הבטחה מפורשת שהתוכן כאן
            // לא משפיע על שום דבר מחוץ למכל (layout+paint) ושמונים/ציטוטי CSS לא "בורחים" ממנו
            // (style) - כך שבדיקת isOverflowing כאן לא צריכה לבדוק/לחשב מחדש שום דבר מעבר למכל
            // הזה עצמו, גם אם מסמך התצוגה (previewArea) כבר מכיל אלפי עמודים שנוספו קודם. זה לא
            // משנה שום ערך שנמדד (scrollHeight/clientHeight נשארים מדויקים בדיוק כמו קודם) - זה
            // רק מצמצם לדפדפן כמה מהמסמך הוא צריך לבדוק מחדש כדי לחשב את אותה תוצאה בדיוק. הוגבל
            // רק למופע הבודד הזה (style inline, לא על מחלקת ה-CSS המשותפת .print-page) כדי לא
            // לגעת בשום עמוד אמיתי/גלוי אחר.
            measureContainer.style.contain = 'layout style paint';
            document.body.appendChild(measureContainer);

            const tempContainer = document.createElement('div');
            tempContainer.innerHTML = htmlContent;
            
            if (targetTabIndex === activeTabIndex && !targetTab.isNewBookTab) {
                previewArea.innerHTML = '';
                // ביטול "תמונת הבסיס" הישנה של החיפוש (dataset.searchBaseHtml) - היא נשארת דבוקה
                // לאלמנט #preview-area (לא נמחקת בהצבת innerHTML=''), ולכן בלי הביטול המפורש הזה
                // היא ממשיכה להצביע על תוכן ישן (למשל עם/בלי ניקוד, לפי המצב שהיה בזמן החיפוש
                // האחרון) - כך שחיפוש חוזר אחרי שינוי הגדרה (כמו הסתרת/הצגת ניקוד) היה "משחזר"
                // בטעות את התוכן הישן במקום להציג את התוכן המעודכן שנבנה זה עתה. מאפסים גם את
                // lastSearchedQuery כדי ש-refreshSearchIfActive (שמופעל בהמשך הפונקציה הזו) לא
                // ידלג על הרצת חיפוש מחדש רק כי הטקסט בתיבת החיפוש לא השתנה בפועל.
                delete previewArea.dataset.searchBaseHtml;
                lastSearchedQuery = null;
                banner.classList.add('visible');
                banner.querySelector('span').innerText = 'טוען ומסדר עמודים ראשונים...';
            }

            const nodesQueue = Array.from(tempContainer.childNodes);
            let fragment = document.createDocumentFragment();
            let pageCount = 1;
            let batchIterations = 0;
            const MAX_BATCH_ITERATIONS = 20000; // בלם ביטחון: מונע לולאה אינסופית תיאורטית בסידור העמודים
            const bookTitle = targetTab.title || 'ספר';
            let runningHeading = "";
            // "זנב" של הערת שוליים ארוכה שלא נכנסה במלואה בעמוד שבו הופיעה ההפניה אליה - ראו
            // syncPageFootnotes/trimFootnotesToFitPage. מתעדכן בכל פעם שעמוד מסתיים.
            let footnoteCarry = null;
            preparePageWithHeader(measureContainer, pageCount, bookTitle, runningHeading);
            const BATCH_SIZE = 70;

            // לולאה חיצונית יחידה (לא רקורסיה עצמית דרך setTimeout כמו שהיה) - כדי ש-paginateContent
            // באמת יהיה ניתן ל-await עד לסיום המלא של העימוד (כולל כל הבאצ'ים ברקע), ולא רק הטיק
            // הראשון. בלי זה, כל קוד ששומר מיקום ואז קורא await paginateContent(...) ומשחזר מיקום
            // (שינוי הגדרה, זום, טעינת ספר) היה ממשיך מיד אחרי הבאץ' הראשון בלבד - כשרוב הספר עדיין
            // לא קיים ב-DOM - וזה בדיוק מה שגרם ל"קפיצה להתחלה" ולשיבוש העמודים אחרי שינוי הגדרה.
            while (true) {
                if (targetTab._closed || currentPaginationSession !== targetTab.paginationToken) {
                    if (measureContainer.parentNode) {
                        document.body.removeChild(measureContainer);
                    }
                    return;
                }

                batchIterations++;
                if (batchIterations > MAX_BATCH_ITERATIONS) {
                    console.error('paginateContent: הגעה למספר איטרציות מקסימלי - עצירת בטיחות למניעת לולאה אינסופית בסידור עמודים');
                    nodesQueue.length = 0;
                }

                let startTime = performance.now();
                let nodesProcessedInBatch = 0;

                while (nodesQueue.length > 0 && nodesProcessedInBatch < BATCH_SIZE) {
                    if (performance.now() - startTime > 30) {
                        await new Promise(resolve => requestAnimationFrame(resolve));
                        startTime = performance.now();
                    }

                    const node = nodesQueue.shift();
                    nodesProcessedInBatch++;

                    if (node.nodeType === 3 && node.textContent.trim() === '') continue;
                    
                    if (node.nodeType === 1) {
                        const h = node.querySelector('h1, h2, h3, h4, h5, h6');
                        if (h) {
                            runningHeading = h.textContent.trim();
                        } else if (/^H[1-6]$/.test(node.tagName)) {
                            runningHeading = node.textContent.trim();
                        }
                    }
                
                    appendToMeasureContainer(measureContainer, node);
                    syncPageFootnotes(measureContainer, targetTab.footnotes, footnoteCarry);

                    if (isOverflowing(measureContainer)) {
                        measureContainer.removeChild(node);

                        // בדיקה האם העמוד ריק לחלוטין (פרט לכותרת) - חיוני למניעת לולאה אינסופית כאשר
                        // מילה/רכיב בודד רחב יותר מעמוד שלם (למשל מספר ארוך, קישור, או טקסט הערה דבוק).
                        // חשוב: יש להתעלם מבלוק ההערות עצמו בספירה - הוא עלול להיות נוכח כשריד "אופטימי"
                        // מהבדיקה המקדימה (syncPageFootnotes) גם כשבפועל אין עדיין שום תוכן אמיתי בעמוד,
                        // ובלעדי ההתעלמות הזו העמוד היה נחשב "לא ריק" בטעות - מה שמונע את הכפייה של
                        // תוכן שלא נכנס, ומייצר לולאה אינסופית של עמודים ריקים.
                        //
                        // תיקון: ספירת "ריקנות" לפי מספר הצמתים בלבד אינה מספיקה - עמוד חדש שנפתח מיד
                        // אחרי הערת שוליים ענקית שגלשה (footnoteCarry) עשוי כבר להיות "מלא" בפועל רק
                        // מכותרת+המשך ההערה, עוד לפני שמנסים להכניס אליו ולו מילה אחת מגוף הטקסט. במצב
                        // כזה נחשב העמוד "ריק" בטעות (כי childNodes סופר רק כותרת+בלוק הערות), והתוכנה
                        // "מאלצת" מילה בודדת להיכנס לצידה של הערת השוליים הענקית - וזו בדיוק הסיבה
                        // למילים יתומות (כגון מילה בודדת שנדחסת לבד ליד המשך הערת שוליים גדולה). לכן
                        // בודקים בפועל (isOverflowing) האם העמוד כבר גלש רק מכותרת+הערות, ללא הנוד
                        // שנכשל - ואם כן, לא מדובר בעמוד "ריק" כלל, וניתן לדחות את כל הנוד לעמוד הבא.
                        syncPageFootnotes(measureContainer, targetTab.footnotes, footnoteCarry);
                        const containerAlreadyFullFromCarry = isOverflowing(measureContainer);

                        const footnoteBlockPresent = measureContainer.querySelector(':scope > .page-footnotes-block') ? 1 : 0;
                        // הכותרת (page-header) תמיד קיימת בעמוד כעת (ראו preparePageWithHeader) גם
                        // כשההגדרה כבויה - היא רק מוסתרת ויזואלית - ולכן הבדיקה כבר לא תלויה בהגדרה
                        const pageIsEmpty = !containerAlreadyFullFromCarry &&
                            (measureContainer.childNodes.length - footnoteBlockPresent) <= 1;

                        if (node.nodeType === 3) {
                            const fullText = node.textContent;
                            const tokens = fullText.split(/(\s+)/);
                            
                            if (tokens.length <= 1) {
                                if (pageIsEmpty && !footnoteCarry) {
                                    // מחרוזת בודדת (ללא רווחים) שרחבה מעמוד ריק שלם - נכריח אותה להיכנס
                                    // כדי להבטיח התקדמות ולמנוע תקיעה מוחלטת של הטעינה. הכפייה מוגבלת
                                    // למצב שאין כרגע המשך הערת שוליים גדולה שגלשה (footnoteCarry) - כי
                                    // כשיש כזה, ההתקדמות כבר מובטחת ממילא (הוא מתקצר עמוד-עמוד בעצמו),
                                    // ועדיף לדחות את כל הנוד לעמוד הבא מאשר לדחוס שריד יתום ליד ההמשך.
                                    appendToMeasureContainer(measureContainer, node);
                                } else {
                                    nodesQueue.unshift(node);
                                }
                            } else {
                                let low = 0;
                                let high = tokens.length;
                                let splitIdx = 0;
                                const testNode = document.createTextNode("");
                                appendToMeasureContainer(measureContainer, testNode);

                                while (low <= high) {
                                    let mid = Math.floor((low + high) / 2);
                                    testNode.textContent = tokens.slice(0, mid).join("");
                                    if (!isOverflowing(measureContainer)) {
                                        splitIdx = mid;
                                        low = mid + 1;
                                    } else {
                                        high = mid - 1;
                                    }
                                }

                                if (splitIdx === 0 && pageIsEmpty && !footnoteCarry) {
                                    // אפילו המילה הראשונה בלבד רחבה מדי לעמוד ריק - מכריחים אותה
                                    // (או את הטוקן הראשון הלא-ריק) כדי להבטיח התקדמות. מוגבל לכשאין
                                    // כרגע המשך הערת שוליים גדולה שגלשה (footnoteCarry) - ראו הסבר למעלה.
                                    splitIdx = 1;
                                    while (splitIdx < tokens.length && tokens.slice(0, splitIdx).join("").trim() === '') {
                                        splitIdx++;
                                    }
                                }

                                testNode.textContent = tokens.slice(0, splitIdx).join("");
                                
                                const remainText = tokens.slice(splitIdx).join("");
                                if (remainText.trim() !== '') {
                                    nodesQueue.unshift(document.createTextNode(remainText));
                                }
                            }
                        } 
                        else if (node.nodeType === 1 && !['IMG', 'TABLE', 'HR', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(node.tagName.toUpperCase())) {
                            splitTextNodesIntoWords(node);

                            const fitClone = node.cloneNode(false);
                            appendToMeasureContainer(measureContainer, fitClone);
                            const children = Array.from(node.childNodes);
                            
                            let low = 0;
                            let high = children.length;
                            let splitIdx = 0;

                            while (low <= high) {
                                let mid = Math.floor((low + high) / 2);
                                
                                fitClone.innerHTML = '';
                                for (let i = 0; i < mid; i++) {
                                    fitClone.appendChild(children[i].cloneNode(true));
                                }
                                // סנכרון בלוק ההערות לפי הניסיון הנוכחי בדיוק (mid) - לא לפי הפסקה
                                // המלאה שנבדקה פסימית בתחילת הטיפול. בלי זה, הפניה להערה שנמצאת
                                // בהמשך הפסקה (אחרי mid, ולכן עדיין לא כלולה בניסיון) הייתה "שומרת
                                // מקום" בטעות גם עבור mid-ים קטנים שבהם ההערה כלל לא רלוונטית עדיין,
                                // מה שגרם לעמוד להיחתך קטן יותר מהנדרש בפועל.
                                syncPageFootnotes(measureContainer, targetTab.footnotes, footnoteCarry);

                                if (!isOverflowing(measureContainer)) {
                                    splitIdx = mid;
                                    low = mid + 1;
                                } else {
                                    high = mid - 1;
                                }
                            }

                            // תיקון קריטי: כשהלולאה למעלה מסתיימת, ה-DOM בפועל בתוך fitClone/measureContainer
                            // עדיין משקף את הניסיון (mid) האחרון שנבדק - שלרוב הוא ניסיון שנכשל (גדול
                            // מ-splitIdx), ולאו דווקא את splitIdx המנצח עצמו! בלי איפוס מפורש כאן, שריד
                            // (clone) של המילה/הפניה הבאה (מעבר ל-splitIdx) עלול להישאר תקוע בתוך
                            // ה-DOM החי של measureContainer - ואז כשבודקים בהמשך "האם יש הפניה חדשה
                            // שטרם טופלה" (querySelector על measureContainer), ההפניה הזו נראית בטעות
                            // כאילו כבר טופלה (כי היא עדיין שם פיזית, כשריד), והקוד מדלג עליה ותופס
                            // בטעות את ההפניה הבאה אחריה במקומה. לכן מאפסים כאן במפורש את fitClone
                            // ואת בלוק ההערות כך שישקפו בדיוק את splitIdx, לפני כל המשך טיפול.
                            fitClone.innerHTML = '';
                            for (let i = 0; i < splitIdx; i++) {
                                fitClone.appendChild(children[i].cloneNode(true));
                            }
                            syncPageFootnotes(measureContainer, targetTab.footnotes, footnoteCarry);

                            // תיקון ממוקד: אם הילד שבו הבינארי הראשי עצר (הראשון שלא נכנס בשלמותו)
                            // הוא בעצמו תגית <i> (כתב נטוי) או <li> (פריט רשימה) עם כמה מילים/רכיבים
                            // בתוכו - במקום לדחות אותו כמקשה אחת לעמוד הבא ולהשאיר את שארית העמוד
                            // הנוכחי פנויה לשווא, מנסים להכניס ממנו כבר עכשיו כמה שיותר (חיפוש בינארי
                            // ברמת מילה, בדיוק כמו עם טקסט רגיל), ומשאירים כ"המשך" בעמוד הבא רק את
                            // מה שבאמת לא הצליח להיכנס. (splitTextNodesIntoWords כבר פוצל את הטקסט
                            // הפנימי שלו למילים בודדות למעלה, ברמת כל הצאצאים של node כולו).
                            if (splitIdx < children.length) {
                                const boundaryChild = children[splitIdx];
                                if (boundaryChild.nodeType === 1 && (boundaryChild.tagName === 'I' || boundaryChild.tagName === 'LI')) {
                                    const subChildren = Array.from(boundaryChild.childNodes);
                                    if (subChildren.length > 1) {
                                        const subFitClone = boundaryChild.cloneNode(false);
                                        fitClone.appendChild(subFitClone);

                                        let subLow = 0, subHigh = subChildren.length, subSplitIdx = 0;
                                        while (subLow <= subHigh) {
                                            const subMid = Math.floor((subLow + subHigh) / 2);
                                            subFitClone.innerHTML = '';
                                            for (let i = 0; i < subMid; i++) {
                                                subFitClone.appendChild(subChildren[i].cloneNode(true));
                                            }
                                            syncPageFootnotes(measureContainer, targetTab.footnotes, footnoteCarry);
                                            if (!isOverflowing(measureContainer)) {
                                                subSplitIdx = subMid;
                                                subLow = subMid + 1;
                                            } else {
                                                subHigh = subMid - 1;
                                            }
                                        }

                                        // subFitClone שימש רק למדידה - ההרכבה בפועל של העמוד תמיד
                                        // נעשית בהמשך מתוך מערך ה-children המקורי (צמתים אמיתיים,
                                        // לא שיבוטים), ולכן מסירים אותו כאן ומעדכנים במקום זאת את
                                        // boundaryChild עצמו ואת מערך ה-children.
                                        fitClone.removeChild(subFitClone);

                                        if (subSplitIdx > 0) {
                                            if (subSplitIdx < subChildren.length) {
                                                const subRemainClone = boundaryChild.cloneNode(false);
                                                for (let i = subSplitIdx; i < subChildren.length; i++) {
                                                    subRemainClone.appendChild(subChildren[i]); // מזיז בפועל - לא שיבוט
                                                }
                                                children.splice(splitIdx + 1, 0, subRemainClone);
                                                // תיקון ממוקד: הנקודה/תבליט של הרשימה שייכים לחלק שנשאר
                                                // בעמוד הנוכחי (boundaryChild, תחילת הפריט) - לא להמשך
                                                // שעובר לעמוד הבא. משתמשים במחלקה נפרדת מ-split-continued
                                                // (זו שמטפלת ביישור השורה האחרונה) כדי שלא יתערבבו יחד.
                                                subRemainClone.classList.add('split-continuation');
                                                // תיקון: יישור השורה האחרונה לשני הצדדים שייך ל-boundaryChild
                                                // עצמו (החלק שנשאר בעמוד הנוכחי ומסתיים באמצע המשפט) - בדיוק
                                                // כמו fitClone.classList.add('split-continued') להלן עבור פסקה
                                                // רגילה שנחתכת. לא ל-subRemainClone (החלק שעובר לעמוד הבא):
                                                // אם הוא באמת מסתיים שם (ולא נחתך שוב), השורה האחרונה שלו היא
                                                // השורה האחרונה האמיתית של הפריט/המשפט, וחובה שתישאר לא-מוצדקת
                                                // (רגילה) ולא תימתח לשני הצדדים בלי מספיק מילים.
                                                boundaryChild.classList.add('split-continued');
                                            }
                                            // boundaryChild עצמו (המקורי) נשאר עכשיו עם רק החלק שנכנס
                                            // (הצאצאים מ-subSplitIdx ואילך כבר הוזזו החוצה ל-subRemainClone
                                            // למעלה, אם היה צורך), ולכן ניתן לכלול אותו בעמוד הנוכחי
                                            splitIdx++;
                                            syncPageFootnotes(measureContainer, targetTab.footnotes, footnoteCarry);
                                        }
                                    }
                                }
                            }

                            // אם הבינארי הרגיל עצר לפני שכל הילדים נכנסו, יש לבדוק האם זה קרה בגלל
                            // הפניה חדשה להערת שוליים ענקית באמת (כזו שלא הייתה נכנסת גם בעמוד ריק
                            // וטרי). אם כן - עדיף לתפוס את ההפניה כבר כאן ולמצות את שארית המקום הפנוי
                            // בעמוד הנוכחי (ו-trimFootnotesToFitPage בהמשך יצמצם את ההערה בהתאם), במקום
                            // לדחות הכל לעמוד הבא ולהשאיר את העמוד הזה חצי-ריק לשווא. הערת שוליים
                            // "רגילה" (שכן הייתה נכנסת בשלמותה בעמוד טרי) ממשיכה להידחות כרגיל כמקובל.
                            let refAnchorExtended = false;
                            if (splitIdx < children.length) {
                                let newRefId = null;
                                for (let i = splitIdx; i < children.length; i++) {
                                    const c = children[i];
                                    if (c.nodeType === 1) {
                                        const supRef = (c.tagName === 'SUP' && c.classList.contains('footnote-ref')) ? c : (c.querySelector ? c.querySelector('sup.footnote-ref') : null);
                                        if (supRef) {
                                            const fid = supRef.getAttribute('data-fn-id');
                                            if (fid && !measureContainer.querySelector(`sup.footnote-ref[data-fn-id="${fid}"]`)) {
                                                newRefId = fid;
                                            }
                                        }
                                    }
                                    if (newRefId) break;
                                }

                                if (newRefId && targetTab.footnotes && targetTab.footnotes[newRefId]) {
                                    // תיקון: לפני כן ניסינו "לדחוס" הערה חדשה לעמוד הנוכחי רק אם היא
                                    // "ענקית" (לא הייתה נכנסת גם בעמוד ריק לגמרי - wouldFootnoteFitOnBlankPage).
                                    // הערות "רגילות" (שכן היו נכנסות בעמוד ריק) פשוט נדחו כמקשה אחת
                                    // לעמוד הבא - גם אם היה בעמוד הנוכחי מקום ניכר (למשל 40%-50% פנויים)
                                    // שפשוט לא הספיק לכל ההערה. זה גרם לעמודים עם המון שטח ריק מבוזבז.
                                    // עכשיו מנסים תמיד להתחיל את ההערה כבר בעמוד של ההפניה אליה, ולתת לה
                                    // להמשיך בעמוד הבא אם לא נכנסת כולה - בדיוק כמו שמבוקש: "אם המקום לא
                                    // מספיק לכולה היא תמשיך בעמוד הבא". משתמשים בתצוגה מקדימה קצרה בזמן
                                    // החיפוש הבינארי (ולא בטקסט המלא) כדי להבטיח שתמיד יישמר בעמוד הזה
                                    // מקום אמיתי לפחות לתחילת ההערה, ולא רק למספר ההפניה שלה; הטקסט המלא
                                    // מוחזר בסוף כדי ש-trimFootnotesToFitPage יחתוך אותו למידה המדויקת
                                    // שבאמת נכנסת בשארית המקום הפנוי.
                                    const fullFootnoteText = targetTab.footnotes[newRefId];
                                    const previewWords = fullFootnoteText.split(/\s+/).slice(0, 6).join(' ');
                                    targetTab.footnotes[newRefId] = previewWords;

                                    let extLow = splitIdx, extHigh = children.length, extSplit = splitIdx;
                                    while (extLow <= extHigh) {
                                        const emid = Math.floor((extLow + extHigh) / 2);
                                        fitClone.innerHTML = '';
                                        for (let i = 0; i < emid; i++) fitClone.appendChild(children[i].cloneNode(true));
                                        syncPageFootnotes(measureContainer, targetTab.footnotes, footnoteCarry);
                                        if (!isOverflowing(measureContainer)) {
                                            extSplit = emid;
                                            extLow = emid + 1;
                                        } else {
                                            extHigh = emid - 1;
                                        }
                                    }

                                    targetTab.footnotes[newRefId] = fullFootnoteText; // משחזרים את הטקסט המלא - trimFootnotesToFitPage בהמשך יחתוך אותו למידה המדויקת שבאמת נכנסת
                                    // איפוס זהה לזה שבוצע אחרי החיפוש הבינארי הראשי - fitClone עדיין
                                    // משקף את הניסיון (emid) האחרון שנבדק ולא בהכרח את extSplit עצמו.
                                    fitClone.innerHTML = '';
                                    for (let i = 0; i < extSplit; i++) fitClone.appendChild(children[i].cloneNode(true));
                                    syncPageFootnotes(measureContainer, targetTab.footnotes, footnoteCarry);
                                    if (extSplit > splitIdx) {
                                        splitIdx = extSplit;
                                        refAnchorExtended = true;
                                    }
                                }
                            }

                            // בקרת "שריד יתום" (orphan control): אם רק מילה אחת (או שתיים) מצליחה להיכנס
                            // לעמוד הנוכחי בעוד שרוב הפסקה נדחית להמשך בעמוד הבא - התוצאה החזותית היא
                            // מילה בודדת התלושה מהקשרה (בד"כ צמודה להמשך הערת שוליים גדולה שגלשה
                            // מהעמוד הקודם, שתפסה כמעט את כל השטח והשאירה רק פירור מקום). עדיף במקרה
                            // כזה לדחות את כל שארית הפסקה כמקשה אחת לעמוד הבא (העמוד הנוכחי ייסגר בלי
                            // תוכן גוף כלל, רק כותרת+המשך ההערה) - מאשר להשאיר שריד יתום שכזה. הדחייה
                            // בטוחה גם כשהעמוד "נחשב ריק" (pageIsEmpty): המשך הערת השוליים ממילא מתקצר
                            // (trimFootnotesToFitPage) מחדש בכל עמוד עד שהוא נגמר, כך שההתקדמות מובטחת
                            // גם בלי לאלץ את המילה היתומה להיכנס - ולכן יש לדלג גם על מנגנון "האילוץ"
                            // הישן (הבא בהמשך) במקרה הזה. חריג: אם ה-splitIdx הנוכחי הגיע מהרחבת "עיגון
                            // הערת שוליים" למעלה (refAnchorExtended) - זו בדיוק ההתנהגות הרצויה (עיגון
                            // ההפניה + תחילת ההערה בעמוד שלה), ואסור לבקרת היתום לבטל אותה.
                            let orphanWordGuardTriggered = false;
                            if (splitIdx > 0 && splitIdx < children.length && !refAnchorExtended) {
                                let realWordCount = 0;
                                for (let wi = 0; wi < splitIdx; wi++) {
                                    const c = children[wi];
                                    if (c.nodeType === 3 && c.textContent.trim() !== '') realWordCount++;
                                }
                                const MIN_WORDS_TO_KEEP = 2;
                                if (realWordCount > 0 && realWordCount < MIN_WORDS_TO_KEEP) {
                                    splitIdx = 0;
                                    orphanWordGuardTriggered = true;
                                }
                            }

                            if (splitIdx === 0 && pageIsEmpty && !footnoteCarry && children.length > 0 && !orphanWordGuardTriggered) {
                                // אין אפשרות לפצל יותר ואין תוכן אחר בעמוד - מכריחים איבר אחד לפחות
                                // כדי למנוע לולאה אינסופית (מקובל שהעמוד יחרוג מעט במקרה הקצה הזה).
                                // הכפייה מוגבלת למצב שאין כרגע המשך הערת שוליים גדולה שגלשה
                                // (footnoteCarry): כשיש כזה, ההתקדמות מובטחת ממילא בלי לאלץ שריד יתום
                                // (ה-carry עצמו מצטמצם עמוד-עמוד, ראו trimFootnotesToFitPage), ועדיף
                                // לדחות את כל הנוד לעמוד הבא ולתת לו להתחיל בעמוד באמת פנוי.
                                splitIdx = 1;
                            }

                            if (splitIdx === 0) {
                                measureContainer.removeChild(fitClone);
                                nodesQueue.unshift(node);
                            } else {
                                fitClone.innerHTML = '';
                                for (let i = 0; i < splitIdx; i++) {
                                    fitClone.appendChild(children[i]);
                                }

                                if (splitIdx < children.length) {
                                    const remainClone = node.cloneNode(false);
                                    for (let i = splitIdx; i < children.length; i++) {
                                        remainClone.appendChild(children[i]);
                                    }
                                    nodesQueue.unshift(remainClone);
                                    fitClone.classList.add('split-continued');
                                }
                            }
                        } else {
                            if (pageIsEmpty && !footnoteCarry) {
                                // אלמנט אטומי (תמונה/טבלה/כותרת) שגדול מעמוד שלם - מכניסים אותו על אף
                                // שהוא חורג, כדי להבטיח התקדמות ולמנוע תקיעת הטעינה. מוגבל לכשאין כרגע
                                // המשך הערת שוליים גדולה שגלשה - ראו הסבר למעלה.
                                appendToMeasureContainer(measureContainer, node);
                            } else {
                                nodesQueue.unshift(node);
                            }
                        }

                        syncPageFootnotes(measureContainer, targetTab.footnotes, footnoteCarry);
                        // אם הערת שוליים (חדשה או ממשיכה) עדיין גדולה מדי לעמוד הזה - מצמצמים אותה
                        // ברמת מילה ושומרים את מה שנשאר כ"המשך" לעמוד הבא, במקום לדחוף את כולה בענק
                        // לעמוד הבא או להציג אותה חתוכה/גולשת בעמוד הנוכחי.
                        if (isOverflowing(measureContainer)) {
                            footnoteCarry = trimFootnotesToFitPage(measureContainer) || null;
                        } else {
                            footnoteCarry = null;
                        }
                        const finishedPage = measureContainer.cloneNode(true);
                        finishedPage.style.cssText = ''; 
                        fragment.appendChild(finishedPage);
                        pageCount++;
                        preparePageWithHeader(measureContainer, pageCount, bookTitle, runningHeading);
                    }
                }

                // *** תיקון באג העמודים הכפולים בתחילת הספר ***
                // בדיקת "האם אני עדיין הסשן הפעיל" נעשתה קודם רק בראש הלולאה החיצונית. לולאת
                // העיבוד הפנימית ארוכה, ולכן סשן ישן שכבר בוטל (למשל בגלל טעינה/רענון/שינוי הגדרה
                // חדשים) הספיק לסיים את המנה הנוכחית שלו ולהוסיף אותה ל-preview-area *אחרי*
                // שהסשן החדש כבר ניקה אותו. התוצאה: כמה עמודים מאמצע הספר (המקום שבו הסשן הישן
                // עמד) נדבקו בראש, ומיד אחריהם הספר התחיל כרגיל מעמוד א'. לכן חובה לבדוק שוב כאן,
                // ממש לפני ההוספה ל-DOM ולמטמון.
                if (targetTab._closed || currentPaginationSession !== targetTab.paginationToken) {
                    if (measureContainer.parentNode) document.body.removeChild(measureContainer);
                    return;
                }

                const isVisibleTab = (targetTabIndex === activeTabIndex) && !targetTab.isNewBookTab;

                const fragmentHtml = Array.from(fragment.childNodes).map(n => n.outerHTML).join('');
                targetTab.cachedPreview += fragmentHtml;

                if (isVisibleTab) {
                    if (currentSettings.isBookView) {
                        appendPagesToBookDOM(fragment);
                    } else {
                        previewArea.appendChild(fragment);
                    }
                    // בניית תוכן העניינים רק בבאץ' הראשון (כדי שתהיה רשימה מיד) ואז שוב רק בסיום.
                    // קודם זה נבנה מחדש בכל באץ' - מה שהרס בכל פעם את פריטי ה-DOM שהמשתמש בדיוק
                    // ניסה ללחוץ עליהם, ואיפס את מצב הפתיחה/כיווץ. זו הייתה הסיבה ש"קופץ" ולא
                    // מצליחים לפתוח כותרת בזמן שהספר עדיין נטען.
                    if (batchIterations === 1) {
                        buildTOC();
                    } else {
                        // רשימת הכותרות מתעדכנת אוטומטית עם הכותרות שנטענו (ראו updateTOCProgressive)
                        updateTOCProgressive();
                    }
                    if (batchIterations !== 1 && currentRailTab === 'pages') {
                        // רשימת "דפים" (בשונה מעץ הכותרות) היא רשימה שטוחה בלי מצב פתיחה/כיווץ
                        // לשמר, ולכן אפשר וכדאי לעדכן אותה בכל באץ' - אבל רק אם הלשונית הזו באמת
                        // מוצגת כרגע, בדיוק כמו בתיקון buildTOC. בלי זה, הרשימה נשארה "תקועה" על
                        // מה שהיה קיים בבאץ' הראשון בלבד עד לסיום הטעינה המלא של הספר
                        buildPageNav();
                    }
                    refreshSearchIfActive();
                    document.getElementById('btn-print').disabled = false;
                    tryEarlyPendingScrollJump(targetTab);
                }
                fragment = document.createDocumentFragment();

                if (nodesQueue.length > 0) {
                    if (isVisibleTab) {
                        banner.classList.add('visible');
                        banner.querySelector('span').innerText = `מסדר דפים ברקע... עמודים מוכנים: ${pageCount}`;
                    }
                    await new Promise(resolve => setTimeout(resolve, 0));
                    continue; // ממשיכים לבאץ' הבא באותה לולאה - לא רקורסיה
                } else {
                    syncPageFootnotes(measureContainer, targetTab.footnotes, footnoteCarry);
                    if (isOverflowing(measureContainer)) {
                        footnoteCarry = trimFootnotesToFitPage(measureContainer) || null;
                    } else {
                        footnoteCarry = null;
                    }
                    // הכותרת (page-header) תמיד קיימת בעמוד כעת (ראו preparePageWithHeader) גם
                    // כשההגדרה כבויה - היא רק מוסתרת ויזואלית - ולכן הבדיקה כבר לא תלויה בהגדרה
                    const hasContent = measureContainer.childNodes.length > 1;

                    if (hasContent) {
                        const last = measureContainer.cloneNode(true);
                        last.style.cssText = '';
                        
                        targetTab.cachedPreview += last.outerHTML;

                        if (isVisibleTab) {
                            if (currentSettings.isBookView) {
                                const tempFrag = document.createDocumentFragment();
                                tempFrag.appendChild(last);
                                appendPagesToBookDOM(tempFrag);
                            } else {
                                previewArea.appendChild(last);
                            }
                        }
                    }

                    // אם נשאר "זנב" של הערת שוליים ענקית שאפילו העמוד האחרון של תוכן הספר לא הספיק
                    // להכיל - פותחים עוד עמוד/י המשך ייעודיים רק להשלמת ההערה, עד שהיא מוצגת במלואה
                    let extraFootnotePagesGuard = 0;
                    while (footnoteCarry && extraFootnotePagesGuard < 500) {
                        extraFootnotePagesGuard++;
                        pageCount++;
                        preparePageWithHeader(measureContainer, pageCount, bookTitle, runningHeading);
                        syncPageFootnotes(measureContainer, targetTab.footnotes, footnoteCarry);
                        if (isOverflowing(measureContainer)) {
                            footnoteCarry = trimFootnotesToFitPage(measureContainer) || null;
                        } else {
                            footnoteCarry = null;
                        }
                        const extraPage = measureContainer.cloneNode(true);
                        extraPage.style.cssText = '';
                        targetTab.cachedPreview += extraPage.outerHTML;
                        if (isVisibleTab) {
                            if (currentSettings.isBookView) {
                                const tempFrag = document.createDocumentFragment();
                                tempFrag.appendChild(extraPage);
                                appendPagesToBookDOM(tempFrag);
                            } else {
                                previewArea.appendChild(extraPage);
                            }
                        }
                    }

                    if (measureContainer.parentNode) {
                        document.body.removeChild(measureContainer);
                    }

                    if (isVisibleTab) {
                        targetTab._tocComplete = true; // כל העמודים כבר ב-DOM - מציגים את כל הכותרות
                        buildTOC();
                        refreshSearchIfActive();
                    }
                 banner.classList.remove('visible');
                 targetTab.pagesRendered = true;
                 targetTab.isRendering = false;
                 // שמירת העימוד המוגמר במטמון, כדי שפתיחה חוזרת של הספר (עם אותן הגדרות פריסה) תציג
                 // את העמודים מיד בלי למדוד מחדש. השמירה מתבצעת ברקע ואינה משפיעה על התצוגה.
                 if (layoutSigAtStart) {
                     try {
                         PaginationCache.scheduleSave(targetTab, rawContentForCache, targetTab.cachedPreview, layoutSigAtStart);
                     } catch (e) { /* המטמון אינו קריטי */ }
                 }
                 // עימוד הסתיים - אם חלונית המפרשים פתוחה לטאב הזה (והוא עדיין הטאב הפעיל), טווח
                 // השורות המוצג עשוי היה להשתנות (למשל טעינה ראשונית, או שינוי גודל גופן ששינה
                 // כמה שורות נכנסות בכל עמוד) - מרעננים כדי שהתוכן יתאים בדיוק למה שמוצג עכשיו.
                 if (isVisibleTab && targetTab.commentaryPanelOpen) refreshCommentaryPanel(true);
                 return; // סיום אמיתי - כאן ה-await אצל הקוראים לסיים סוף-סוף
             }
         }
        }

        // רענון הטאב הנוכחי - משיכה ועימוד מחדש מהספרייה מאפס (משתמש באותה generateView שמשמשת
        // גם לטעינה ראשונית של ספר, רק שכאן היא מופעלת על טאב שכבר טעון בעבר)
        /* ===================== פתיחת קובץ Word/טקסט חיצוני מהמחשב =====================
           .docx הוא בפועל ארכיון ZIP שבתוכו word/document.xml. כאן ממומש קורא ZIP מינימלי
           (איתור הרשומה בתוך ה-Central Directory + פריסה בעזרת DecompressionStream שקיים
           ב-webview מודרני), ואז המרה של פסקאות/כותרות ה-XML ל-HTML פשוט שהעימוד יודע לסדר.
           אין כאן שום ספרייה חיצונית - הכל מקומי, בהתאם למגבלות התוסף. */

        function openExternalDocument() {
            const input = document.getElementById('external-file-input');
            if (!input) return;
            input.value = '';
            input.click();
        }

        function handleExternalFileInput(e) {
            const file = e.target && e.target.files && e.target.files[0];
            if (file) loadExternalFile(file);
        }

        // קריאת מספרים ליטל-אנדיאן מתוך ה-ZIP
        function zipU16(dv, p) { return dv.getUint16(p, true); }
        function zipU32(dv, p) { return dv.getUint32(p, true); }

        // שליפת רשומה בודדת מתוך ארכיון ZIP (docx) לפי שמה המלא בתוך הארכיון. מחזירה null אם
        // הרשומה לא נמצאה (למשל: מסמך Word בלי הערות שוליים בכלל - אין word/footnotes.xml)
        async function extractZipEntryText(arrayBuffer, entryName) {
            const dv = new DataView(arrayBuffer);
            const bytes = new Uint8Array(arrayBuffer);

            // איתור End Of Central Directory (חתימה 0x06054b50) מהסוף אחורה
            let eocd = -1;
            for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
                if (zipU32(dv, i) === 0x06054b50) { eocd = i; break; }
            }
            if (eocd === -1) throw new Error('קובץ ה-Word אינו תקין (לא נמצא מבנה ZIP)');

            const entryCount = zipU16(dv, eocd + 10);
            let p = zipU32(dv, eocd + 16); // תחילת ה-Central Directory

            for (let n = 0; n < entryCount; n++) {
                if (zipU32(dv, p) !== 0x02014b50) break;
                const method = zipU16(dv, p + 10);
                const compSize = zipU32(dv, p + 20);
                const nameLen = zipU16(dv, p + 28);
                const extraLen = zipU16(dv, p + 30);
                const commentLen = zipU16(dv, p + 32);
                const localOffset = zipU32(dv, p + 42);
                const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

                if (name === entryName) {
                    // מעבר ל-Local File Header כדי לחשב את המיקום המדויק של הנתונים
                    if (zipU32(dv, localOffset) !== 0x04034b50) throw new Error('מבנה ZIP שגוי');
                    const lNameLen = zipU16(dv, localOffset + 26);
                    const lExtraLen = zipU16(dv, localOffset + 28);
                    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
                    const raw = bytes.subarray(dataStart, dataStart + compSize);

                    if (method === 0) return new TextDecoder().decode(raw);
                    if (method === 8) {
                        if (typeof DecompressionStream !== 'function') {
                            throw new Error('הדפדפן המוטמע אינו תומך בפריסת קבצים דחוסים');
                        }
                        const ds = new DecompressionStream('deflate-raw');
                        const stream = new Blob([raw]).stream().pipeThrough(ds);
                        return await new Response(stream).text();
                    }
                    throw new Error('שיטת דחיסה לא נתמכת בקובץ');
                }
                p += 46 + nameLen + extraLen + commentLen;
            }
            return null; // הרשומה לא נמצאה בארכיון
        }

        async function extractDocxDocumentXml(arrayBuffer) {
            const xml = await extractZipEntryText(arrayBuffer, 'word/document.xml');
            if (xml === null) throw new Error('לא נמצא תוכן מסמך בקובץ ה-Word');
            return xml;
        }

        // שליפת word/styles.xml כדי לזהות כותרות גם כאשר מזהה הסגנון ב-Word אינו
        // "Heading1", "Heading2" וכו'. בחלק מקבצי Word (למשל "שנים אוחזין")
        // מזהה הסגנון הוא מספרי (כגון 1), בעוד ששמו הפנימי הוא "heading 1".
        // לכן אי אפשר להסתמך רק על w:pStyle@w:val מתוך document.xml.
        async function extractDocxStylesXml(arrayBuffer) {
            try {
                return await extractZipEntryText(arrayBuffer, 'word/styles.xml');
            } catch (e) {
                return null;
            }
        }

        // בונה מיפוי styleId -> רמת כותרת. נותנים עדיפות לשם הסגנון (heading N / כותרת N),
        // ואם אין שם כזה משתמשים ב-outlineLvl של הסגנון - מנגנון תקני נוסף של Word לכותרות.
        function parseDocxHeadingStyles(stylesXml) {
            const map = {};
            if (!stylesXml) return map;
            try {
                const doc = new DOMParser().parseFromString(stylesXml, 'application/xml');
                const styles = doc.getElementsByTagName('w:style');
                for (let i = 0; i < styles.length; i++) {
                    const style = styles[i];
                    const styleId = style.getAttribute('w:styleId');
                    if (!styleId) continue;

                    let level = 0;
                    const names = style.getElementsByTagName('w:name');
                    if (names.length) {
                        const name = (names[0].getAttribute('w:val') || '').trim();
                        const m = name.match(/^heading\s*(\d+)$/i) || name.match(/^כותרת\s*(\d+)$/);
                        if (m) level = Math.min(6, parseInt(m[1], 10));
                    }

                    if (!level) {
                        const outlineLvls = style.getElementsByTagName('w:outlineLvl');
                        if (outlineLvls.length) {
                            const raw = parseInt(outlineLvls[0].getAttribute('w:val'), 10);
                            if (Number.isFinite(raw) && raw >= 0 && raw <= 5) level = raw + 1;
                        }
                    }

                    if (level) map[styleId] = level;
                }
            } catch (e) {
                console.warn('לא ניתן היה לפענח את סגנונות הכותרות של קובץ ה-Word', e);
            }
            return map;
        }

        // שליפת קובץ הערות השוליים - לא כל מסמך Word כולל אותו, ולכן כשל כאן אינו קריטי (מחזיר null
        // בלבד, בלי לזרוק שגיאה שתעצור את פתיחת המסמך כולו)
        async function extractDocxFootnotesXml(arrayBuffer) {
            try {
                return await extractZipEntryText(arrayBuffer, 'word/footnotes.xml');
            } catch (e) {
                return null;
            }
        }

        // קריאת פורמט מספור הערות השוליים המוגדר בקובץ עצמו (word/settings.xml > w:footnotePr >
        // w:numFmt) - כדי שהתוסף יציג את ההערות באותה צורת מספור בדיוק שהוגדרה במסמך המקורי
        // (מספרים/אותיות לועזיות/רומיות/אותיות עבריות בגימטריה), ולא תמיד כמספרים בלבד. לא כל
        // מסמך כולל הגדרה מפורשת כזו (ברירת המחדל הפנימית של Word היא "decimal" - מספרים רגילים) -
        // ולכן כשל כאן אינו קריטי ופשוט נופל בחזרה ל-'decimal', בדיוק כפי שהתצוגה התנהגה עד כה.
        async function extractDocxFootnoteNumFmt(arrayBuffer) {
            try {
                const xml = await extractZipEntryText(arrayBuffer, 'word/settings.xml');
                if (!xml) return 'decimal';
                const doc = new DOMParser().parseFromString(xml, 'application/xml');
                const footnotePrList = doc.getElementsByTagName('w:footnotePr');
                if (!footnotePrList.length) return 'decimal';
                const numFmtList = footnotePrList[0].getElementsByTagName('w:numFmt');
                if (!numFmtList.length) return 'decimal';
                return numFmtList[0].getAttribute('w:val') || 'decimal';
            } catch (e) {
                return 'decimal';
            }
        }

        // המרת מספר סידורי (1,2,3...) לצורת התצוגה המבוקשת לפי w:numFmt שנקרא ב-
        // extractDocxFootnoteNumFmt לעיל - תומך בצורות הנפוצות של Word; כל צורה שלא מזוהה (או
        // "decimal" עצמה) נופלת בחזרה למספר רגיל, בדיוק כפי שהוצג עד כה.
        function formatFootnoteNumber(n, numFmt) {
            switch (numFmt) {
                case 'lowerLetter':
                    return formatLetterCycleNumbering(n).toLowerCase();
                case 'upperLetter':
                    return formatLetterCycleNumbering(n).toUpperCase();
                case 'lowerRoman':
                    return formatRomanNumeral(n).toLowerCase();
                case 'upperRoman':
                    return formatRomanNumeral(n).toUpperCase();
                case 'hebrew1':
                case 'hebrew2':
                    return numToGematria(n); // שימוש בפונקציית הגימטריה הקיימת כבר באפליקציה (מספרי עמוד)
                case 'decimal':
                default:
                    return String(n);
            }
        }

        // מספור אותיות לועזיות בסגנון Word (a, b, c... z, aa, bb, cc... zz, aaa...) - כל אות
        // חוזרת על עצמה במספר הפעמים המתאים למחזור הנוכחי, בדיוק כמו התנהגות
        // numFmt="lowerLetter"/"upperLetter" בפועל
        function formatLetterCycleNumbering(n) {
            const letters = 'abcdefghijklmnopqrstuvwxyz';
            const cycle = Math.floor((n - 1) / 26) + 1;
            const letterIndex = (n - 1) % 26;
            return letters[letterIndex].repeat(cycle);
        }

        // המרה לספרות רומיות (עבור numFmt="lowerRoman"/"upperRoman")
        function formatRomanNumeral(n) {
            const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
            let result = '';
            let num = n;
            for (const [value, symbol] of table) {
                while (num >= value) {
                    result += symbol;
                    num -= value;
                }
            }
            return result;
        }

        function escapeHtmlText(s) {
            return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        // קריאת עיצוב התו (bold/italic/underline) המוגדר על ריצת טקסט (w:r) בקובץ Word, מתוך
        // ה-w:rPr שלה. w:val="0"/"false"/"off" הוא הדרך שבה Word מסמן "כבוי במפורש" (למשל ריצה
        // שמבטלת הדגשה שהגיעה מסגנון הפסקה) - ולכן לא מספיק לבדוק רק "האם התגית קיימת".
        function getDocxRunFormatting(run) {
            const rPrList = run.getElementsByTagName('w:rPr');
            const result = { bold: false, italic: false, underline: false };
            if (!rPrList.length) return result;
            const rPr = rPrList[0];

            const bEls = rPr.getElementsByTagName('w:b');
            if (bEls.length) {
                const val = bEls[0].getAttribute('w:val');
                result.bold = !(val === '0' || val === 'false' || val === 'off');
            }
            const iEls = rPr.getElementsByTagName('w:i');
            if (iEls.length) {
                const val = iEls[0].getAttribute('w:val');
                result.italic = !(val === '0' || val === 'false' || val === 'off');
            }
            const uEls = rPr.getElementsByTagName('w:u');
            if (uEls.length) {
                const val = uEls[0].getAttribute('w:val');
                result.underline = !(!val || val === 'none');
            }
            return result;
        }

        // המרת פסקת Word (w:p) ל-HTML פנימי, תוך שמירה על המיקום היחסי של הפניות להערות שוליים
        // (w:footnoteReference) בתוך זרימת הטקסט - קודם לכן הפניות אלו פשוט נעלמו כי רק w:t נאסף.
        // כמו כן, כל ריצת טקסט (w:r) נבדקת לעיצוב מודגש/נטוי/קו תחתון (getDocxRunFormatting)
        // ועטופה בתגית ה-HTML התואמת (strong/em/u) - כדי שהדגשות מקובץ ה-Word יוצגו בתצוגת
        // הטורים בדיוק כמו שהן מוצגות כבר עבור תגיות בולד/כותרת בקבצי טקסט/HTML רגילים.
        //
        // idToLabel (אופציונלי): מיפוי מזהה-הערה גולמי של Word -> התווית שבה יש להציג את ההערה
        // בפועל (מספר/אות/רומית, לפי w:numFmt - ראו parseDocxFootnotesXml/extractDocxFootnoteNumFmt),
        // כך שגם ה"מספר" שמוצג בפועל בתוך הטקסט (לא רק בתחתית העמוד) יתאים לצורת המספור שהוגדרה
        // במסמך המקורי. אם לא סופק מיפוי (או שההערה חסרה ממנו) נופלים בחזרה למזהה הגולמי עצמו -
        // בדיוק ההתנהגות שהייתה קיימת קודם.
        function docxParagraphToInlineHtml(para, idToLabel) {
            const runs = para.getElementsByTagName('w:r');
            let html = '';
            for (let i = 0; i < runs.length; i++) {
                const run = runs[i];
                const fnRefs = run.getElementsByTagName('w:footnoteReference');
                if (fnRefs.length > 0) {
                    const fnId = fnRefs[0].getAttribute('w:id');
                    if (fnId) {
                        const label = (idToLabel && idToLabel[fnId]) ? idToLabel[fnId] : fnId;
                        html += `<sup class="footnote-ref" data-fn-id="${label}">${label}</sup>`;
                    }
                    continue;
                }
                const texts = run.getElementsByTagName('w:t');
                let runText = '';
                for (let j = 0; j < texts.length; j++) {
                    runText += escapeHtmlText(texts[j].textContent || '');
                }
                if (!runText) continue;

                const fmt = getDocxRunFormatting(run);
                if (fmt.underline) runText = `<u>${runText}</u>`;
                if (fmt.italic) runText = `<em>${runText}</em>`;
                if (fmt.bold) runText = `<strong>${runText}</strong>`;
                html += runText;
            }
            return html;
        }

        // המרת word/document.xml ל-HTML. זיהוי הכותרת נעשה לפי סגנון הפסקה בפועל,
        // ובנוסף לפי מיפוי styleId שנבנה מתוך word/styles.xml, כך שגם סגנונות בעלי מזהים
        // מספריים/מותאמים אישית מזוהים נכון. idToLabel מועבר הלאה לצורך תצוגת מספור ההערות.
        function docxXmlToHtml(xml, idToLabel, headingStyles) {
            const doc = new DOMParser().parseFromString(xml, 'application/xml');
            const paras = doc.getElementsByTagName('w:p');
            const out = [];
            for (let i = 0; i < paras.length; i++) {
                const para = paras[i];
                const inlineHtml = docxParagraphToInlineHtml(para, idToLabel);
                const plainText = inlineHtml.replace(/<[^>]+>/g, '').trim();
                if (!plainText) continue;

                let level = 0;
                const styles = para.getElementsByTagName('w:pStyle');
                if (styles.length) {
                    const val = styles[0].getAttribute('w:val') || '';
                    const directMatch = val.match(/^Heading(\d)$/i) || val.match(/^כותרת\s*(\d)$/);
                    if (directMatch) {
                        level = Math.min(6, parseInt(directMatch[1], 10));
                    } else if (headingStyles && headingStyles[val]) {
                        level = headingStyles[val];
                    }
                }

                // גם כאשר אין pStyle מפורש, Word יכול להגדיר outlineLvl ישירות על הפסקה.
                // זהו fallback תקני נוסף, בלי להשפיע על מסמכים רגילים שאין בהם outlineLvl.
                if (!level) {
                    const outlineLvls = para.getElementsByTagName('w:outlineLvl');
                    if (outlineLvls.length) {
                        const raw = parseInt(outlineLvls[0].getAttribute('w:val'), 10);
                        if (Number.isFinite(raw) && raw >= 0 && raw <= 5) level = raw + 1;
                    }
                }

                out.push(level ? `<h${level}>${inlineHtml}</h${level}>` : `<p>${inlineHtml}</p>`);
            }
            return out.join('');
        }

        // פענוח word/footnotes.xml - בונה שני מיפויים יחד: footnotesByLabel (התווית המוצגת בפועל,
        // כפי שחושבה לפי numFmt וסדר ההופעה של ההערות -> טקסט ההערה) ו-idToLabel (מזהה גולמי של
        // Word -> אותה תווית), כדי שגם ההפניה בתוך הטקסט וגם תחתית העמוד יציגו את אותה תווית בדיוק
        // בלי שום שינוי בקוד העימוד/התצוגה הגנרי (syncPageFootnotes וכו') - הוא ממילא לא מניח כלום
        // על צורת ה-id/המפתח, רק מציג את הערך שנשמר. משמש בזמן העימוד (syncPageFootnotes) כדי
        // להציג כל הערה בתחתית העמוד המדויק שבו מופיעה ההפניה אליה, ולא בעמוד קבוע/מרוחק
        function parseDocxFootnotesXml(xml, numFmt) {
            const footnotesByLabel = {};
            const idToLabel = {};
            if (!xml) return { footnotesByLabel, idToLabel };
            try {
                const doc = new DOMParser().parseFromString(xml, 'application/xml');
                const notes = doc.getElementsByTagName('w:footnote');
                let sequentialIndex = 0;
                for (let i = 0; i < notes.length; i++) {
                    const note = notes[i];
                    const id = note.getAttribute('w:id');
                    const type = note.getAttribute('w:type'); // separator/continuationSeparator - לדלג
                    if (!id || type) continue;
                    sequentialIndex++;
                    const label = formatFootnoteNumber(sequentialIndex, numFmt);
                    idToLabel[id] = label;
                    const texts = note.getElementsByTagName('w:t');
                    let text = '';
                    for (let j = 0; j < texts.length; j++) text += texts[j].textContent || '';
                    text = text.trim();
                    if (text) footnotesByLabel[label] = escapeHtmlText(text);
                }
            } catch (e) {
                console.error('שגיאה בפענוח הערות השוליים של קובץ ה-Word', e);
            }
            return { footnotesByLabel, idToLabel };
        }

        /* ==================== קריאת קבצי Word ישנים (.doc בפורמט Word 97-2003) ====================
           בשונה מ-.docx (שהוא ZIP+XML פשוט לפענוח), .doc ישן הוא קובץ בפורמט בינארי שונה לגמרי -
           Compound File Binary (CFB, לשעבר OLE2) - עם מבנה נתונים פנימי (FIB + טבלת "פיסות" טקסט)
           שיכול לפזר את הטקסט הלוגי בסדר לא-רציף בתוך הקובץ. שני הפורמטים ([MS-CFB] ו-[MS-DOC])
           מתועדים רשמית ע"י מיקרוסופט, ולכן ניתן לממש קורא עצמאי. בנוסף לחילוץ הטקסט הפשוט
           (extractDocPlainText, המשמש כנתיב-גיבוי) מפוענחים כאן גם גיליון הסגנונות (STSH, לזיהוי
           כותרות רמה 1-6), טבלאות העיצוב הבינאריות CHPX/PAPX (לזיהוי בולד/נטוי/קו-תחתון ברמת
           ריצת-תווים) וטבלאות ההפניה להערות השוליים (PlcffndRef/PlcffndTxt) - ראו את הבלוק
           "שחזור עיצוב" בהמשך הקובץ (extractLegacyDocRich וכל הפונקציות שלפניו) שמייצר בדיוק
           את אותו מבנה HTML כמו docxXmlToHtml/parseDocxFootnotesXml עבור .docx, כדי שכל שאר
           האפליקציה תמשיך לעבוד בלי שינוי. אם קובץ ספציפי בעל מבנה חריג נכשל בפענוח העשיר,
           extractLegacyDocText נופל אוטומטית בחזרה לטקסט הפשוט הבסיסי במקום לקרוס.
           הערה חשובה: זהו מימוש עצמאי שנבדק ותוקן מול קובץ .doc עברי אמיתי (כולל כותרות מרובות
           רמות, הדגשות והערות שוליים רבות) - אך עדיין מומלץ לבדוק גם מול קבצים נוספים. */

        const CFB_FREESECT = 0xFFFFFFFF;
        const CFB_ENDOFCHAIN = 0xFFFFFFFE;

        // פענוח מבנה ה-Compound File Binary (CFB/OLE2): כותרת + FAT + Mini-FAT + טבלת ספריות,
        // עם פונקציית getStream(name) לשליפת זרם לפי שם מדויק (למשל "WordDocument", "1Table")
        function parseCfbContainer(arrayBuffer) {
            const dv = new DataView(arrayBuffer);
            const bytes = new Uint8Array(arrayBuffer);

            const sig = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
            for (let i = 0; i < 8; i++) {
                if (bytes[i] !== sig[i]) throw new Error('הקובץ אינו בפורמט Compound File Binary תקין (.doc ישן)');
            }

            const sectorShift = dv.getUint16(30, true);
            const miniSectorShift = dv.getUint16(32, true);
            const sectorSize = 1 << sectorShift;
            const miniSectorSize = 1 << miniSectorShift;
            const firstDirSector = dv.getUint32(48, true);
            const miniStreamCutoff = dv.getUint32(56, true);
            const firstMiniFatSector = dv.getUint32(60, true);
            const numMiniFatSectors = dv.getUint32(64, true);
            const firstDifatSector = dv.getUint32(68, true);

            function sectorOffset(sectorNum) { return (sectorNum + 1) * sectorSize; }
            function readSector(sectorNum) {
                const off = sectorOffset(sectorNum);
                return bytes.subarray(off, off + sectorSize);
            }

            // מערך ה-DIFAT (מיקומי סקטורי ה-FAT): 109 הראשונים בכותרת עצמה, וההמשך (אם יש)
            // בשרשרת סקטורי DIFAT נפרדת המצוינת בכותרת
            const difat = [];
            for (let i = 0; i < 109; i++) {
                const val = dv.getUint32(76 + i * 4, true);
                if (val !== CFB_FREESECT) difat.push(val);
            }
            let difatSector = firstDifatSector;
            let difatGuard = 0;
            while (difatSector !== CFB_ENDOFCHAIN && difatSector !== CFB_FREESECT && difatGuard < 10000) {
                difatGuard++;
                const off = sectorOffset(difatSector);
                const entriesPerSector = sectorSize / 4 - 1;
                for (let i = 0; i < entriesPerSector; i++) {
                    const val = dv.getUint32(off + i * 4, true);
                    if (val !== CFB_FREESECT) difat.push(val);
                }
                difatSector = dv.getUint32(off + entriesPerSector * 4, true);
            }

            // טבלת ה-FAT המלאה: מערך המחזיק, לכל מספר סקטור, את מספר הסקטור הבא בשרשרת שלו
            const entriesPerFatSector = sectorSize / 4;
            const fat = new Uint32Array(difat.length * entriesPerFatSector);
            for (let i = 0; i < difat.length; i++) {
                const sectorData = readSector(difat[i]);
                const sdv = new DataView(sectorData.buffer, sectorData.byteOffset, sectorData.byteLength);
                for (let j = 0; j < entriesPerFatSector; j++) {
                    fat[i * entriesPerFatSector + j] = sdv.getUint32(j * 4, true);
                }
            }

            // קריאת שרשרת סקטורים החל מסקטור נתון, לפי ה-FAT, עד ENDOFCHAIN
            function readChain(startSector, knownSize) {
                const chunks = [];
                let sector = startSector;
                let guard = 0;
                while (sector !== CFB_ENDOFCHAIN && sector !== CFB_FREESECT && sector < fat.length && guard < 200000) {
                    guard++;
                    chunks.push(readSector(sector));
                    sector = fat[sector];
                }
                const combined = new Uint8Array(chunks.length * sectorSize);
                let offset = 0;
                for (const c of chunks) { combined.set(c, offset); offset += c.length; }
                return typeof knownSize === 'number' ? combined.subarray(0, knownSize) : combined;
            }

            // קריאת כל סקטורי ה-Directory ופענוח לרשומות של 128 בייט כל אחת
            const dirBytes = readChain(firstDirSector);
            const entryCount = Math.floor(dirBytes.length / 128);
            const entries = [];
            const utf16Decoder = new TextDecoder('utf-16le');
            for (let i = 0; i < entryCount; i++) {
                const base = i * 128;
                const nameLenBytes = new DataView(dirBytes.buffer, dirBytes.byteOffset + base + 64, 2).getUint16(0, true);
                const nameLen = Math.max(0, nameLenBytes - 2); // לא כולל תו הסיום null
                const name = nameLen > 0 ? utf16Decoder.decode(dirBytes.subarray(base, base + nameLen)) : '';
                const objType = dirBytes[base + 66];
                const edv = new DataView(dirBytes.buffer, dirBytes.byteOffset + base, 128);
                entries.push({ name, objType, startSector: edv.getUint32(116, true), size: edv.getUint32(120, true) });
            }

            // ה-Root Entry (objType===5) מגדיר את "מיני-הזרם" - הזרם הווירטואלי שממנו נקראים כל
            // ה"מיני-סקטורים" של זרמים קטנים (מתחת ל-miniStreamCutoff בייטים, בד"כ 4096)
            const rootEntry = entries.find(e => e.objType === 5);
            const miniStreamData = rootEntry ? readChain(rootEntry.startSector, rootEntry.size) : new Uint8Array(0);

            // ה-Mini-FAT (אותו עיקרון בדיוק כמו ה-FAT הרגיל, עבור מיני-סקטורים בתוך מיני-הזרם)
            let miniFat = new Uint32Array(0);
            if (numMiniFatSectors > 0 && firstMiniFatSector !== CFB_ENDOFCHAIN) {
                const miniFatBytes = readChain(firstMiniFatSector);
                miniFat = new Uint32Array(Math.floor(miniFatBytes.length / 4));
                const mdv = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
                for (let i = 0; i < miniFat.length; i++) miniFat[i] = mdv.getUint32(i * 4, true);
            }

            function readMiniChain(startMiniSector, knownSize) {
                const chunks = [];
                let sector = startMiniSector;
                let guard = 0;
                while (sector !== CFB_ENDOFCHAIN && sector !== CFB_FREESECT && sector < miniFat.length && guard < 200000) {
                    guard++;
                    const off = sector * miniSectorSize;
                    chunks.push(miniStreamData.subarray(off, off + miniSectorSize));
                    sector = miniFat[sector];
                }
                const combined = new Uint8Array(chunks.length * miniSectorSize);
                let offset = 0;
                for (const c of chunks) { combined.set(c, offset); offset += c.length; }
                return typeof knownSize === 'number' ? combined.subarray(0, knownSize) : combined;
            }

            // שליפת זרם לפי שם מדויק - חיפוש שטוח על כל רשומות ה-Directory (אין צורך לשחזר את
            // עץ ה-red-black שלהן, כל הרשומות קיימות במערך גם בלי זה)
            function getStream(name) {
                const entry = entries.find(e => e.objType === 2 && e.name === name);
                if (!entry) return null;
                return entry.size < miniStreamCutoff
                    ? readMiniChain(entry.startSector, entry.size)
                    : readChain(entry.startSector, entry.size);
            }

            return { getStream };
        }

        // מיפוי התווים המיוחדים היחידים המוגדרים בתקן [MS-DOC] לפיסת טקסט "דחוסה" (single-byte);
        // כל בייט אחר מתחת ל-0x80 הוא ASCII ישיר, ומעל 0x80 שאינו ברשימה נופל ל-Latin-1 כברירת
        // מחדל. בפועל תוכן עברי כמעט תמיד מאוחסן בפיסות הלא-דחוסות (Unicode דו-בייטי, מפוענח
        // ישירות למטה) ולכן אינו תלוי במיפוי הזה כלל.
        const DOC_COMPRESSED_SPECIAL_MAP = {
            0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026,
            0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030,
            0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x91: 0x2018,
            0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022,
            0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122,
            0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9F: 0x0178
        };
        function decodeDocCompressedByte(b) {
            if (b < 0x80) return b;
            return DOC_COMPRESSED_SPECIAL_MAP[b] !== undefined ? DOC_COMPRESSED_SPECIAL_MAP[b] : b;
        }

        // פענוח ה-FIB (File Information Block) מתחילת זרם ה-WordDocument. כל ההיסטים אחרי
        // FibBase (32 הבייטים הראשונים, קבועים) נמדדים דינמית לפי הערכים שנקראים בפועל מהקובץ
        // (csw/cslw) ולא לפי מספרים קבועים מנוחשים - כך שהחילוץ תקין גם אם הגרסה הפנימית משתנה.
        //
        // בנוסף לשדות שכבר נקראו כאן (fcClx וכו') נקראים כעת גם השדות הדרושים לשחזור עיצוב:
        // fcStshf/lcbStshf (גיליון הסגנונות - לזיהוי כותרות), fcPlcfBteChpx/fcPlcfBtePapx
        // (טבלאות עיצוב תווים/פסקאות) ו-fcPlcffndRef/fcPlcffndTxt עם ccpText/ccpFtn (הערות
        // שוליים). מיקומי הזוגות (pair index, כל זוג=8 בייט) מתועדים ב-[MS-DOC] 2.5.6, ו-
        // ccpText/ccpFtn ב-[MS-DOC] 2.5.4 (fibRgLw97, ליד תחילת המבנה - נקראים עם offset קבוע
        // מתוך fibRgLwStart שכבר מחושב דינמית למעלה, ולא עם מספר בייט מנוחש בקובץ כולו).
        function parseDocFib(wordDocBytes) {
            const dv = new DataView(wordDocBytes.buffer, wordDocBytes.byteOffset, wordDocBytes.byteLength);
            const wIdent = dv.getUint16(0, true);
            if (wIdent !== 0xA5EC) throw new Error('מבנה FIB לא תקין - ייתכן שהקובץ פגום, מוצפן, או אינו קובץ .doc אמיתי');

            const flags1 = dv.getUint16(10, true); // FibBase.flags1
            const fWhichTblStm = (flags1 & 0x0200) !== 0; // ביט 9: 1='1Table', 0='0Table'
            const fcMin = dv.getUint32(24, true); // נתיב גיבוי - תחילת טקסט אם אין טבלת פיסות
            const fcMac = dv.getUint32(28, true); // נתיב גיבוי - סוף טקסט אם אין טבלת פיסות

            let offset = 32; // סוף FibBase הקבוע
            const csw = dv.getUint16(offset, true);
            offset += 2 + csw * 2; // דילוג על fibRgW97
            const cslw = dv.getUint16(offset, true);
            const fibRgLwStart = offset + 2; // תחילת fibRgLw97 - כאן נמצאים ccpText/ccpFtn
            offset += 2 + cslw * 4; // דילוג על fibRgLw97
            const cbRgFcLcb = dv.getUint16(offset, true);
            offset += 2; // תחילת מערך fibRgFcLcb97
            const fibRgFcLcbStart = offset;

            // שליפת זוג (fc,lcb) ממערך fibRgFcLcb97 לפי אינדקס-הזוג המתועד (כל זוג = 8 בייט:
            // 4 בייט fc + 4 בייט lcb), עם בדיקת גבולות מול cbRgFcLcb שנקרא בפועל מהקובץ.
            function fcLcbPair(pairIndex) {
                if (pairIndex >= cbRgFcLcb) return { fc: 0, lcb: 0 };
                const pairOffset = fibRgFcLcbStart + pairIndex * 8;
                return { fc: dv.getUint32(pairOffset, true), lcb: dv.getUint32(pairOffset + 4, true) };
            }

            const { fc: fcClx, lcb: lcbClx } = fcLcbPair(33); // [MS-DOC] 2.5.6: fcClx/lcbClx
            const { fc: fcDop, lcb: lcbDop } = fcLcbPair(31); // Dop (מאפייני מסמך) - כולל את פורמט מספור הערות השוליים (nfcFtnRef)
            const { fc: fcStshf, lcb: lcbStshf } = fcLcbPair(1); // גיליון הסגנונות (STSH)
            const { fc: fcPlcffndRef, lcb: lcbPlcffndRef } = fcLcbPair(2); // הפניות להערות שוליים בטקסט הראשי
            const { fc: fcPlcffndTxt, lcb: lcbPlcffndTxt } = fcLcbPair(3); // גבולות טקסט ההערות במסמך-המשנה שלהן
            const { fc: fcPlcfBteChpx, lcb: lcbPlcfBteChpx } = fcLcbPair(12); // טבלת עיצוב תווים (בולד/נטוי/קו-תחתון)
            const { fc: fcPlcfBtePapx, lcb: lcbPlcfBtePapx } = fcLcbPair(13); // טבלת עיצוב פסקאות (istd - לזיהוי כותרות)

            // ccpText/ccpFtn נמצאים בתוך fibRgLw97 (לא במערך fibRgFcLcb97) - ב-offset קבוע
            // מתחילת אותו מבנה ([MS-DOC] 2.5.4: cbMac,reserved1,reserved2,ccpText,ccpFtn...),
            // ותחילת המבנה עצמו (fibRgLwStart) כבר מחושבת דינמית למעלה לפי csw שנקרא מהקובץ.
            const ccpText = dv.getInt32(fibRgLwStart + 12, true);
            const ccpFtn = dv.getInt32(fibRgLwStart + 16, true);

            return {
                fWhichTblStm, fcMin, fcMac, fcClx, lcbClx, fcDop, lcbDop,
                fcStshf, lcbStshf,
                fcPlcffndRef, lcbPlcffndRef, fcPlcffndTxt, lcbPlcffndTxt,
                fcPlcfBteChpx, lcbPlcfBteChpx, fcPlcfBtePapx, lcbPlcfBtePapx,
                ccpText, ccpFtn
            };
        }

        // קריאת פורמט מספור הערות השוליים המוגדר בקובץ .doc הישן עצמו: שדה nfcFtnRef (2 בייט,
        // ערך מסוג MSONFC - [MS-OSHARED] 2.2.1.3) השוכן בהיסט קבוע 492 בייט מתחילת מבנה ה-Dop97
        // (fcDop/lcbDop מה-FIB לעיל) - נבדק ואומת מול שני קבצי .doc אמיתיים (אחד עם מספור
        // decimal, אחד עם מספור hebrew1). זהו המקביל בדיוק ל-extractDocxFootnoteNumFmt עבור
        // .docx, כדי שגם כאן ההערות יוצגו בצורת המספור שהוגדרה במסמך המקורי ולא תמיד כמספרים.
        // כשל כאן (מבנה חריג/lcbDop קטן מדי) אינו קריטי ופשוט נופל בחזרה ל-'decimal'.
        function extractDocFootnoteNumFmt(tableBytes, fcDop, lcbDop) {
            try {
                const NFC_OFFSET = 492;
                if (!lcbDop || lcbDop < NFC_OFFSET + 2 || fcDop + NFC_OFFSET + 2 > tableBytes.length) return 'decimal';
                const nfcFtnRef = tableBytes[fcDop + NFC_OFFSET] | (tableBytes[fcDop + NFC_OFFSET + 1] << 8);
                switch (nfcFtnRef) {
                    case 0x01: return 'upperRoman';
                    case 0x02: return 'lowerRoman';
                    case 0x03: return 'upperLetter';
                    case 0x04: return 'lowerLetter';
                    case 0x2D: return 'hebrew1';
                    case 0x2F: return 'hebrew2';
                    case 0x00:
                    default: return 'decimal';
                }
            } catch (e) {
                return 'decimal';
            }
        }

        // פענוח ה-Clx (מתוך זרם הטבלה) לאיתור ה-PlcPcd - טבלת ה"פיסות" שמגדירה את סדר הטקסט
        // הלוגי האמיתי (שיכול להיות שונה מהסדר הפיזי בזרם ה-WordDocument, בגלל שמירות מהירות)
        function parseDocClx(tableBytes, fcClx, lcbClx) {
            if (!lcbClx || fcClx + lcbClx > tableBytes.length) return null;
            const clxBytes = tableBytes.subarray(fcClx, fcClx + lcbClx);
            const dv = new DataView(clxBytes.buffer, clxBytes.byteOffset, clxBytes.byteLength);

            let pos = 0, plcPcdOffset = -1, plcPcdLen = 0, guard = 0;
            while (pos < clxBytes.length && guard < 10000) {
                guard++;
                const clxt = clxBytes[pos];
                if (clxt === 0x01) {
                    // Prc - מבנה שינויי-מאפיינים שאינו רלוונטי לחילוץ טקסט - מדלגים לפי אורכו המוצהר
                    const cbGrpprl = dv.getUint16(pos + 1, true);
                    pos += 1 + 2 + cbGrpprl;
                } else if (clxt === 0x02) {
                    // Pcdt - עוטף את ה-PlcPcd שאנחנו מחפשים
                    plcPcdLen = dv.getUint32(pos + 1, true);
                    plcPcdOffset = pos + 5;
                    break;
                } else {
                    break; // ערך לא צפוי - עוצרים בבטחה במקום להמשיך לקרוא זבל
                }
            }
            if (plcPcdOffset === -1) return null;

            const plcBytes = clxBytes.subarray(plcPcdOffset, plcPcdOffset + plcPcdLen);
            const n = Math.floor((plcBytes.length - 4) / 12); // n פיסות: n+1 עמדות CP + n רשומות Pcd (8 בייט כ"א)
            if (n <= 0) return null;
            const pdv = new DataView(plcBytes.buffer, plcBytes.byteOffset, plcBytes.byteLength);

            const cpArray = [];
            for (let i = 0; i <= n; i++) cpArray.push(pdv.getUint32(i * 4, true));

            const pieces = [];
            const pcdArrayStart = (n + 1) * 4;
            for (let i = 0; i < n; i++) {
                // כל Pcd הוא 8 בייט: 2 בייט ביטפילד (לא רלוונטי כאן) + 4 בייט FcCompressed + 2 בייט Prm
                const fcValueRaw = pdv.getUint32(pcdArrayStart + i * 8 + 2, true);
                pieces.push({
                    cpStart: cpArray[i],
                    cpEnd: cpArray[i + 1],
                    fc: fcValueRaw & 0x3FFFFFFF,           // 30 הביטים התחתונים
                    fCompressed: ((fcValueRaw >>> 30) & 1) === 1  // ביט 30
                });
            }
            return pieces;
        }

        /* ==================== שחזור עיצוב (כותרות/בולד/נטוי/קו-תחתון/הערות שוליים) ל-.doc ====
           הרחבה של קורא ה-.doc הישן: מעבר לטקסט הפשוט (extractDocPlainText למעלה), כאן נקרא
           גם גיליון הסגנונות (STSH, לזיהוי כותרות), טבלאות העיצוב הבינאריות CHPX/PAPX (לזיהוי
           בולד/נטוי/קו-תחתון ברמת תו, וה-istd של כל פסקה), וטבלאות ההפניה להערות השוליים -
           כדי לייצר את אותו מבנה HTML בדיוק שכבר קיים לקבצי .docx (h1..h6 / strong / em / u /
           <sup class="footnote-ref">). המנגנון של ה-.docx עצמו (docxXmlToHtml וכו' למעלה) לא
           משתנה כלל - כאן רק "מתרגמים" את הפורמט הבינארי הישן לאותה תפוקה.
           מבנים בינאריים: [MS-DOC] 2.9.271 (STSH), 2.9.270 (STD), 2.9.32 (ChpxFkp),
           2.9.137 (PapxInFkp), 2.8.25/2.8.26 (PlcBtePapx/PlcBteChpx). */

        // פענוח גיליון הסגנונות (STSH) לכדי מערך תיאורי-סגנון לפי istd (אינדקס הסגנון):
        // {sti, sgc, istdBase, name} לכל סגנון. sti הוא מזהה הסגנון המובנה (1-9=כותרת 1-9),
        // sgc מבחין בין סגנון פסקה (1) לסגנון תו (2), istdBase הוא הסגנון שעליו מבוסס הסגנון
        // הנוכחי (לשרשור ירושה, למשל סגנון מותאם-אישית שמבוסס על "כותרת 1").
        function parseDocStyleSheet(tableBytes, fcStshf, lcbStshf) {
            const styles = [];
            if (!lcbStshf || lcbStshf < 8 || fcStshf + lcbStshf > tableBytes.length) return styles;
            const stsh = tableBytes.subarray(fcStshf, fcStshf + lcbStshf);
            function u16(off) { return (off + 1 < stsh.length) ? (stsh[off] | (stsh[off + 1] << 8)) : null; }
            const cbStshi = u16(0), cstd = u16(2), cbStdBase = u16(4);
            if (cbStshi === null || cstd === null || cbStdBase === null) return styles;
            if (cbStdBase !== 10 && cbStdBase !== 18) return styles; // שני הגדלים התקניים היחידים של STDF הבסיסי

            let p = 2 + cbStshi; // תחילת מערך רשומות הסגנון (rglpstd), מיד אחרי ה-STSHI
            for (let s = 0; s < cstd; s++) {
                const cbStd = u16(p);
                if (cbStd === null) break;
                p += 2;
                if (cbStd === 0) { styles.push(null); continue; } // "חריץ" ריק - עדיין תופס istd
                if (p + cbStd > stsh.length) { styles.push(null); break; }
                const std = stsh.subarray(p, p + cbStd);
                p += cbStd;

                const stiRaw = std.length >= 2 ? (std[0] | (std[1] << 8)) : null;
                const grf = std.length >= 4 ? (std[2] | (std[3] << 8)) : null;
                if (stiRaw === null || grf === null) { styles.push(null); continue; }
                const sti = stiRaw & 0x0FFF;
                const sgc = grf & 0x000F;
                const istdBase = (grf >> 4) & 0x0FFF;

                // שם הסגנון (Xstz): מתחיל מיד אחרי ה"בסיס" הקבוע (cbStdBase), כמחרוזת
                // UTF-16LE באורך cch תווים ואחריה תו-סיום 0
                let name = '';
                const cch = (std.length >= cbStdBase + 2) ? (std[cbStdBase] | (std[cbStdBase + 1] << 8)) : null;
                if (cch !== null) {
                    const charsStart = cbStdBase + 2, charsEnd = charsStart + cch * 2;
                    if (charsEnd <= std.length) {
                        const units = [];
                        for (let i = charsStart; i + 1 < charsEnd; i += 2) units.push(std[i] | (std[i + 1] << 8));
                        name = String.fromCharCode.apply(null, units);
                    }
                }
                styles.push({ sti, sgc, istdBase, name });
            }
            return styles;
        }

        // זיהוי כותרת לפי שם הסגנון בלבד (נתיב גיבוי) - אותו היגיון בדיוק שכבר קיים למעלה
        // עבור סגנונות docx (parseDocxHeadingStyles): "heading N" או "כותרת N"
        function docHeadingLevelFromName(name) {
            const m = (name || '').trim().match(/^heading\s*(\d+)$/i) || (name || '').trim().match(/^כותרת\s*(\d+)$/);
            if (m) { const n = parseInt(m[1], 10); if (n >= 1 && n <= 6) return n; }
            return null;
        }

        // בניית מיפוי istd -> רמת כותרת (1-6) או null. עדיפות ראשונה ל-sti המובנה (1-9 = כותרת
        // 1-9, 0 = "רגיל"/Normal), לאחר מכן שרשור ירושה (סגנון מותאם-אישית שמבוסס, ישירות או
        // בעקיפין, על "כותרת N"), ולבסוף נתיב גיבוי לפי שם הסגנון. isVisiting מונע לולאה
        // אינסופית אם קובץ פגום מגדיר שרשור ירושה מעגלי בין סגנונות.
        function buildDocHeadingMap(styles) {
            const map = new Array(styles.length).fill(null);
            const visiting = new Array(styles.length).fill(false);
            function resolve(istd, depth) {
                if (depth > 64 || istd < 0 || istd >= styles.length || visiting[istd]) return null;
                const st = styles[istd];
                if (!st) return null;
                visiting[istd] = true;
                let result = null;
                if (st.sti >= 1 && st.sti <= 9) result = Math.min(6, st.sti);
                else if (st.sti !== 0 && st.sgc === 1 && st.istdBase !== 0x0FFF && st.istdBase !== istd) {
                    result = resolve(st.istdBase, depth + 1);
                }
                if (result === null) result = docHeadingLevelFromName(st.name);
                visiting[istd] = false;
                return result;
            }
            for (let i = 0; i < styles.length; i++) map[i] = resolve(i, 0);
            return map;
        }

        // קודי ה-sprm הרלוונטיים לעיצוב תווים (CHPX) ולפסקאות (PAPX) הדרושים כאן בלבד -
        // מתוך רשימת ה-sprm המלאה שמוגדרת ב-[MS-DOC] 2.6.1/2.6.2
        const SPRM_C_F_BOLD = 0x0835, SPRM_C_F_ITALIC = 0x0836, SPRM_C_KUL = 0x2A3E;

        // אורך האופרנד (בבייטים) של sprm נתון, לפי שדה ה-spra שלו (הביטים 13-15 בקוד ה-sprm) -
        // נדרש כדי לדעת כמה בייטים לדלג עבור sprm-ים שאינם רלוונטיים כאן, בלי "לאבד את הצעד"
        // בפענוח שאר ה-grpprl. ([MS-DOC] 2.2.5: 0/1=בייט אחד, 2/4/5=שני בייטים, 3=ארבעה
        // בייטים, 7=שלושה בייטים, 6=אורך משתנה עם בייט-אורך מוביל)
        function docSprmOperandLen(sprm, bytes, operandOffset) {
            const spra = (sprm >> 13) & 0x7;
            if (spra === 0 || spra === 1) return 1;
            if (spra === 2 || spra === 4 || spra === 5) return 2;
            if (spra === 3) return 4;
            if (spra === 7) return 3;
            if (spra === 6) {
                const lenByte = bytes[operandOffset];
                return lenByte === undefined ? null : 1 + lenByte;
            }
            return null; // spra לא תקין - נעצור בבטחה במקום להמשיך לקרוא זבל
        }

        // פענוח ה-grpprl (רשימת sprm-ים) של CHPX בודד: מחפש רק את שלושת ה-sprm-ים הרלוונטיים
        // (בולד/נטוי/קו-תחתון) ומדלג על כל השאר לפי אורכם המוצהר
        function docScanChpxGrpprl(gp) {
            let bold = false, italic = false, underline = false;
            let pos = 0;
            while (pos + 2 <= gp.length) {
                const sprm = gp[pos] | (gp[pos + 1] << 8);
                const operandOffset = pos + 2;
                const len = docSprmOperandLen(sprm, gp, operandOffset);
                if (len === null) break;
                const operandEnd = operandOffset + len;
                if (operandEnd > gp.length) break;
                const v0 = gp[operandOffset];
                if (sprm === SPRM_C_F_BOLD) bold = (v0 === 0x01 || v0 === 0x81); // 0x81=היפוך מול סגנון-בסיס, קרוב מספיק
                else if (sprm === SPRM_C_F_ITALIC) italic = (v0 === 0x01 || v0 === 0x81);
                else if (sprm === SPRM_C_KUL) underline = !!v0; // sprmCKul: 0=ללא קו תחתון, כל ערך אחר=יש
                pos = operandEnd;
            }
            return { bold, italic, underline };
        }

        // פענוח עמוד FKP בודד (512 בייט) של CHPX: מבנה קבוע לפי [MS-DOC] 2.9.32 - מערך של
        // (crun+1) גבולות FC (4 בייט כ"א) ואחריו מערך של crun בייטי-היסט (rgb, בייט אחד כ"א,
        // 0=ברירת מחדל ללא עיצוב, אחרת ההיסט בתוך העמוד הוא b*2), ואילו מבני ה-Chpx עצמם
        // (בייט cb + cb בייטי grpprl) יושבים בסוף העמוד וגדלים אחורה
        function docParseChpxFkpPage(wordDocBytes, pageOffset, outEntries) {
            const page = wordDocBytes.subarray(pageOffset, pageOffset + 512);
            if (page.length < 512) return;
            const crun = page[511];
            if (crun < 1 || crun > 0x65) return; // 0x65 הוא המספר המרבי המתועד של ריצות בעמוד FKP
            const rgfcEnd = 4 * (crun + 1);
            const rgbStart = rgfcEnd, rgbEnd = rgbStart + crun;
            if (rgbEnd > 511) return;

            // אימות מוקדם שכל טווחי ה-FC בעמוד תקינים (מונוטוניים) - עמוד פגום מדולג כיחידה
            // אחת, כדי שלא ליצור טווחי-חיפוש חופפים/לא-ברורים בהמשך
            for (let i = 0; i < crun; i++) {
                const fcStart = rgU32(page, i * 4), fcLim = rgU32(page, (i + 1) * 4);
                if (fcStart === null || fcLim === null || fcStart >= fcLim) return;
            }
            for (let i = 0; i < crun; i++) {
                const fcStart = rgU32(page, i * 4), fcLim = rgU32(page, (i + 1) * 4);
                const b = page[rgbStart + i];
                let props = { bold: false, italic: false, underline: false };
                if (b !== 0) {
                    const chpxOffset = b * 2;
                    if (chpxOffset >= rgbEnd && chpxOffset < 511) {
                        const cb = page[chpxOffset];
                        const dataStart = chpxOffset + 1, dataEnd = dataStart + cb;
                        if (dataEnd <= 511) props = docScanChpxGrpprl(page.subarray(dataStart, dataEnd));
                    }
                }
                outEntries.push({ fcStart, fcLim, bold: props.bold, italic: props.italic, underline: props.underline });
            }
        }

        // קריאה בטוחה של uint32 (little-endian) מתוך מערך בייטים, עם החזרת null אם חסרים בייטים
        function rgU32(bytes, off) {
            if (off + 3 >= bytes.length) return null;
            return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
        }

        // פענוח טבלת ה-BTE (PlcBteChpx) המפנה לעמודי ה-FKP: מערך של (n+1) ערכי FC (4 בייט
        // כ"א, שאינם בשימוש כאן) ואחריו n מספרי-עמוד (4 בייט כ"א, כאשר רק 22 הביטים
        // התחתונים הם מספר העמוד בפועל - [MS-DOC] 2.8.26). כל עמוד הוא 512 בייט בזרם
        // ה-WordDocument עצמו (לא בזרם הטבלה!). התוצאה ממוינת לפי fcStart לחיפוש בינארי מהיר.
        function parseDocChpxTable(wordDocBytes, tableBytes, fcPlcf, lcbPlcf) {
            const entries = [];
            if (!lcbPlcf || lcbPlcf < 4 || fcPlcf + lcbPlcf > tableBytes.length) return entries;
            const plc = tableBytes.subarray(fcPlcf, fcPlcf + lcbPlcf);
            const payloadLen = plc.length - 4;
            if (payloadLen % 8 !== 0) return entries;
            const n = payloadLen / 8;
            if (n === 0) return entries;
            const pnBase = (n + 1) * 4;
            for (let i = 0; i < n; i++) {
                const pnRaw = rgU32(plc, pnBase + i * 4);
                if (pnRaw === null) break;
                const page = pnRaw & 0x003FFFFF;
                docParseChpxFkpPage(wordDocBytes, page * 512, entries);
            }
            entries.sort((a, b) => a.fcStart - b.fcStart);
            return entries;
        }

        // חיפוש בינארי: מחזיר את עיצוב התו (בולד/נטוי/קו-תחתון) החל בהיסט הבייט הנתון בזרם
        // ה-WordDocument, או "הכל כבוי" אם לא נמצא טווח מתאים (ברירת המחדל התקנית)
        function docChpAt(entries, fc) {
            let lo = 0, hi = entries.length - 1, ans = -1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (entries[mid].fcStart <= fc) { ans = mid; lo = mid + 1; } else hi = mid - 1;
            }
            if (ans >= 0 && fc < entries[ans].fcLim) return entries[ans];
            return { bold: false, italic: false, underline: false };
        }

        // פענוח PapxInFkp בודד בתוך עמוד FKP ([MS-DOC] 2.9.137): בייט cb ראשון קובע את גודל
        // ה-grpprlAndIstd שאחריו - אם cb!=0 הגודל הוא 2*cb-1 בייט (מתחיל מיד אחרי בייט ה-cb);
        // אם cb==0 הגודל האמיתי נתון בבייט הבא (cb2) כ-2*cb2 בייט. בכל מקרה שני הבייטים
        // הראשונים של grpprlAndIstd הם ה-istd (אינדקס הסגנון) של הפסקה - וזה כל מה שדרוש כאן
        // (אין צורך לפענח את שאר ה-grpprl של הפסקה עצמה לזיהוי כותרות)
        function docParsePapxIstd(page, off) {
            const cb = page[off];
            let dataOff, dataLen;
            if (cb !== undefined && cb !== 0) { dataOff = off + 1; dataLen = cb * 2 - 1; }
            else { const cb2 = page[off + 1] || 0; dataOff = off + 2; dataLen = cb2 * 2; }
            if (dataLen < 2 || dataOff + 1 >= page.length) return 0;
            return page[dataOff] | (page[dataOff + 1] << 8);
        }

        // פענוח עמוד FKP בודד (512 בייט) של PAPX ([MS-DOC] 2.9.137 סביבתו): (crun+1) גבולות
        // FC (4 בייט כ"א) ואחריהם מערך של crun רשומות BxPap (13 בייט כ"א - הבייט הראשון הוא
        // "bOffset", היסט-מילה בתוך העמוד למבנה ה-PapxInFkp; 12 הבייטים הנותרים הם מטמון
        // גובה-פסקה שאינו רלוונטי כאן ומדולג)
        function docParsePapxFkpPage(wordDocBytes, pageOffset, outEntries) {
            const page = wordDocBytes.subarray(pageOffset, pageOffset + 512);
            if (page.length < 512) return;
            const crun = page[511];
            if (crun === 0 || 4 * (crun + 1) + 13 * crun >= 512) return;
            for (let i = 0; i < crun; i++) {
                const fcLim = rgU32(page, 4 * (i + 1));
                if (fcLim === null) break;
                const bxOffset = 4 * (crun + 1) + i * 13;
                const bOffset = page[bxOffset] || 0;
                const istd = bOffset !== 0 ? docParsePapxIstd(page, bOffset * 2) : 0;
                outEntries.push({ fcLim, istd });
            }
        }

        // פענוח טבלת ה-BTE (PlcBtePapx) - אותו מבנה בדיוק כמו PlcBteChpx למעלה, רק שהעמודים
        // מכילים PAPX ולא CHPX. ה-fcLim בלבד (לא fcStart) נאסף מכל עמוד ואז ממוין גלובלית -
        // מספיק כדי לשייך כל היסט-בייט לפסקה שהוא נמצא בתוכה (הפסקה הראשונה שגבולה העליון
        // גדול מההיסט המבוקש), בלי תלות בסדר הפיזי של העמודים בקובץ.
        function parseDocPapxTable(wordDocBytes, tableBytes, fcPlcf, lcbPlcf) {
            const entries = [];
            if (!lcbPlcf || lcbPlcf < 4 || fcPlcf + lcbPlcf > tableBytes.length) return entries;
            const plc = tableBytes.subarray(fcPlcf, fcPlcf + lcbPlcf);
            const n = Math.floor((plc.length - 4) / 8);
            if (n === 0) return entries;
            const pnBase = 4 * (n + 1);
            for (let i = 0; i < n; i++) {
                const pnRaw = rgU32(plc, pnBase + i * 4);
                if (pnRaw === null) break;
                const page = pnRaw & 0x003FFFFF;
                docParsePapxFkpPage(wordDocBytes, page * 512, entries);
            }
            entries.sort((a, b) => a.fcLim - b.fcLim);
            return entries;
        }

        // חיפוש בינארי: ה-istd (אינדקס סגנון) של הפסקה שמכילה את היסט-הבייט הנתון - זו
        // הפסקה הראשונה (הכי "צרה") שגבולה העליון (fcLim) גדול מההיסט המבוקש
        function docIstdAt(entries, fc) {
            let lo = 0, hi = entries.length - 1, ans = -1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (entries[mid].fcLim > fc) { ans = mid; hi = mid - 1; } else lo = mid + 1;
            }
            return ans >= 0 ? entries[ans].istd : 0;
        }

        // פענוח PLC "פשוט" שמכיל רק מערך CP (ללא נתונים נלווים, או עם נתונים ברוחב קבוע
        // שאינו נחוץ כאן) - משמש הן ל-PlcffndTxt (גבולות טקסט ההערות, ברוחב-נתון 0) והן
        // לשליפת רשימת ה-CP הגולמית של PlcffndRef (ברוחב-נתון 2, ה-FRD - לא נדרש כאן כי
        // המספור הרציף מספיק, באותו היגיון בדיוק כמו parseDocxFootnotesXml למעלה)
        function docParsePlcCpArray(tableBytes, fc, lcb, elemSize) {
            if (!lcb || fc + lcb > tableBytes.length) return [];
            const plc = tableBytes.subarray(fc, fc + lcb);
            const n = Math.floor((plc.length - 4) / (4 + elemSize));
            const cps = [];
            for (let i = 0; i <= n; i++) {
                const v = rgU32(plc, i * 4);
                if (v === null) break;
                cps.push(v);
            }
            return cps;
        }

        // בניית מפת CP -> תו, לשליפה נוחה של טקסט הערות השוליים לפי טווח CP (הערות השוליים
        // יושבות במסמך-משנה נפרד באותו זרם הטקסט הלוגי, אחרי המסמך הראשי - ראו למטה)
        function docBuildCpCharMap(wordDocBytes, pieces) {
            const map = new Map();
            const wdv = new DataView(wordDocBytes.buffer, wordDocBytes.byteOffset, wordDocBytes.byteLength);
            for (const piece of pieces) {
                const numChars = piece.cpEnd - piece.cpStart;
                if (numChars <= 0) continue;
                if (piece.fCompressed) {
                    const byteStart = Math.floor(piece.fc / 2);
                    for (let i = 0; i < numChars; i++) {
                        const b = wordDocBytes[byteStart + i];
                        if (b === undefined) break;
                        map.set(piece.cpStart + i, decodeDocCompressedByte(b));
                    }
                } else {
                    for (let i = 0; i < numChars; i++) {
                        const off = piece.fc + i * 2;
                        if (off + 1 >= wordDocBytes.length) break;
                        map.set(piece.cpStart + i, wdv.getUint16(off, true));
                    }
                }
            }
            return map;
        }

        // חילוץ טקסט פשוט (ללא עיצוב - כמו בהערות השוליים של ה-docx למעלה) מטווח CP נתון מתוך
        // מפת התווים, עם המרת מפרידי פסקה/עמוד/תא (\r \x0c \x07) לירידות שורה והסרת תווי-בקרה.
        // בנוסף מוסתר כאן קוד-השדה הפנימי של Word (כגון "NOTEREF ..."): שדה מיוצג בזרם הטקסט
        // כ-0x13 (התחלת שדה) + טקסט-ההוראה הפנימי (שוורד עצמו אינו מציג בתצוגה רגילה) + 0x14
        // (מפריד) + הערך המוצג בפועל + 0x15 (סוף שדה) - ולכן רק טקסט-ההוראה בין 0x13 ל-0x14
        // מדולג, ואילו הערך המוצג בפועל (אחרי ה-0x14) ממשיך להיכלל כרגיל.
        function docPlainTextFromCpRange(cpCharMap, cpStart, cpEnd) {
            let s = '';
            let inFieldInstruction = false;
            for (let cp = cpStart; cp < cpEnd; cp++) {
                const ch = cpCharMap.get(cp);
                if (ch === undefined) continue;
                if (ch === 0x13) { inFieldInstruction = true; continue; } // תחילת שדה - מתחילים לדלג
                if (ch === 0x14) { inFieldInstruction = false; continue; } // מפריד - מכאן הערך המוצג בפועל
                if (ch === 0x15) { inFieldInstruction = false; continue; } // סוף שדה (הגנה גם ללא מפריד תקין)
                if (inFieldInstruction) continue;
                if (ch === 0x0d || ch === 0x07 || ch === 0x0c) { s += '\n'; continue; }
                if (ch === 0x02) continue; // תו הפניית ההערה עצמו, בתחילת טווח ההערה
                if (ch < 0x20 && ch !== 0x09) continue;
                s += String.fromCharCode(ch);
            }
            return s.trim();
        }

        // בניית הטקסט הלוגי המלא לפי סדר הפיסות (או נתיב גיבוי ישיר אם אין טבלת פיסות כלל)
        function extractDocPlainText(wordDocBytes, tableBytes, fib) {
            const wdv = new DataView(wordDocBytes.buffer, wordDocBytes.byteOffset, wordDocBytes.byteLength);
            const pieces = fib.lcbClx > 0 ? parseDocClx(tableBytes, fib.fcClx, fib.lcbClx) : null;
            let text = '';

            if (pieces && pieces.length > 0) {
                for (const piece of pieces) {
                    const numChars = piece.cpEnd - piece.cpStart;
                    if (numChars <= 0) continue;
                    if (piece.fCompressed) {
                        const byteStart = Math.floor(piece.fc / 2);
                        for (let i = 0; i < numChars; i++) {
                            const b = wordDocBytes[byteStart + i];
                            if (b === undefined) break;
                            text += String.fromCharCode(decodeDocCompressedByte(b));
                        }
                    } else {
                        for (let i = 0; i < numChars; i++) {
                            const off = piece.fc + i * 2;
                            if (off + 1 >= wordDocBytes.length) break;
                            text += String.fromCharCode(wdv.getUint16(off, true));
                        }
                    }
                }
            } else {
                // נתיב גיבוי (מסמכים ישנים/פשוטים ביותר ללא טבלת פיסות כלל) - קריאה ישירה של
                // טווח fcMin..fcMac כטקסט Unicode דו-בייטי רציף
                const numChars = fib.fcMac - fib.fcMin;
                for (let i = 0; i < numChars; i++) {
                    const off = fib.fcMin + i * 2;
                    if (off + 1 >= wordDocBytes.length) break;
                    text += String.fromCharCode(wdv.getUint16(off, true));
                }
            }
            return text;
        }

        // המרת מפרידי הפסקה/עמוד/תא הפנימיים של Word (\r \x0c \x07) לפסקאות HTML, והסרת תווי
        // בקרה פנימיים נדירים (סימוני שדה/תמונה/הערת שוליים) שאין להם ייצוג טקסטואלי הגיוני כאן -
        // תוצר סופי ברמת "טקסט פשוט" בלבד, ללא כותרות/הדגשות/הערות שוליים (ראו הערת ההיקף למעלה)
        function docTextToParagraphHtml(rawText) {
            const normalized = rawText
                .replace(/[\r\x0c\x07]/g, '\n')
                .replace(/[\x00-\x06\x08\x0b\x0e-\x1f]/g, '');
            return normalized.split(/\n+/)
                .map(l => l.trim())
                .filter(Boolean)
                .map(l => `<p>${escapeHtmlText(l)}</p>`)
                .join('');
        }

        // בניית מערך תווים שטוח לפי סדר קריאה לוגי (CP), כשלכל תו נשמר גם ה-CP וגם ה-FC (היסט
        // הבייט בזרם ה-WordDocument) שלו בפועל - ה-FC הוא המפתח לחיפוש בטבלאות ה-CHPX/PAPX
        // (ראו את שתי הפונקציות למעלה) בעוד ה-CP הוא המפתח לזיהוי הפניות/גבולות הערות שוליים.
        // לתו דחוס (ANSI, בייט אחד) ה-FC בפועל הוא fc/2 (כפי שכבר נעשה ב-extractDocPlainText
        // וב-docBuildCpCharMap למעלה) בתוספת מספר-התו בתוך הפיסה; לתו לא-דחוס (Unicode, שני
        // בייטים) ה-FC בפועל הוא fc בתוספת פי-2 ממספר התו.
        function docBuildCharArray(wordDocBytes, pieces) {
            const wdv = new DataView(wordDocBytes.buffer, wordDocBytes.byteOffset, wordDocBytes.byteLength);
            const chars = [];
            for (const piece of pieces) {
                const numChars = piece.cpEnd - piece.cpStart;
                if (numChars <= 0) continue;
                if (piece.fCompressed) {
                    const byteStart = Math.floor(piece.fc / 2);
                    for (let i = 0; i < numChars; i++) {
                        const b = wordDocBytes[byteStart + i];
                        if (b === undefined) break;
                        chars.push({ ch: decodeDocCompressedByte(b), fc: byteStart + i, cp: piece.cpStart + i });
                    }
                } else {
                    for (let i = 0; i < numChars; i++) {
                        const off = piece.fc + i * 2;
                        if (off + 1 >= wordDocBytes.length) break;
                        chars.push({ ch: wdv.getUint16(off, true), fc: piece.fc + i * 2, cp: piece.cpStart + i });
                    }
                }
            }
            return chars;
        }

        // עטיפת טקסט-ריצה בתגיות ה-HTML המתאימות לעיצוב שלו - בדיוק אותו סדר קינון (u בפנים,
        // אחר-כך em, ואז strong בחוץ) כמו ב-docxParagraphToInlineHtml למעלה, כדי שהתוצאה תיראה
        // זהה בין .doc ל-.docx עבור אותו שילוב עיצוב
        function docWrapRunFormatting(text, fmt) {
            if (!fmt || !text) return text;
            if (fmt.underline) text = `<u>${text}</u>`;
            if (fmt.italic) text = `<em>${text}</em>`;
            if (fmt.bold) text = `<strong>${text}</strong>`;
            return text;
        }

        // הפונקציה המרכזית: קריאת קובץ .doc (ArrayBuffer) והחזרת {html, footnotesMap} עשירים -
        // עם כותרות (h1..h6 לפי גיליון הסגנונות), הדגשות בולד/נטוי/קו-תחתון ברמת ריצת-תווים,
        // והערות שוליים - באותו מבנה HTML בדיוק שמייצר docxXmlToHtml/parseDocxFootnotesXml
        // עבור .docx, כך שכל שאר האפליקציה (עימוד, תצוגת הערות שוליים בתחתית העמוד וכו')
        // ממשיכה לעבוד בלי שום שינוי. אם שלב כלשהו נכשל (מבנה לא-צפוי בקובץ ספציפי) הפונקציה
        // זורקת חריגה, וextractLegacyDocText למטה נופל בחזרה לחילוץ הטקסט הפשוט הקיים.
        function extractLegacyDocRich(wordDocBytes, tableBytes, fib) {
            if (!fib.lcbClx) throw new Error('אין טבלת פיסות (Clx) - לא ניתן לשחזר עיצוב, רק טקסט פשוט');
            const pieces = parseDocClx(tableBytes, fib.fcClx, fib.lcbClx);
            if (!pieces || !pieces.length) throw new Error('טבלת הפיסות ריקה');

            const styles = parseDocStyleSheet(tableBytes, fib.fcStshf, fib.lcbStshf);
            const headingMap = buildDocHeadingMap(styles);
            const chpxEntries = parseDocChpxTable(wordDocBytes, tableBytes, fib.fcPlcfBteChpx, fib.lcbPlcfBteChpx);
            const papxEntries = parseDocPapxTable(wordDocBytes, tableBytes, fib.fcPlcfBtePapx, fib.lcbPlcfBtePapx);
            const footnoteNumFmt = extractDocFootnoteNumFmt(tableBytes, fib.fcDop, fib.lcbDop);

            // ccpText (אורך המסמך הראשי, ב-CP) חוסם את הטקסט הראשי מפני מסמכי-המשנה שבאים
            // אחריו באותו זרם CP לוגי (הערות שוליים, הערות-סיום, כותרות עליונות/תחתונות וכו',
            // [MS-DOC] 2.5.4) - בלעדיו תוכן ההערות עצמו היה "נדלף" לתוך גוף המסמך הראשי
            const ccpText = fib.ccpText > 0 ? fib.ccpText : Infinity;
            const chars = docBuildCharArray(wordDocBytes, pieces);
            const mainChars = ccpText === Infinity ? chars : chars.filter(c => c.cp < ccpText);

            function chpAt(fc) {
                let lo = 0, hi = chpxEntries.length - 1, ans = -1;
                while (lo <= hi) {
                    const mid = (lo + hi) >> 1;
                    if (chpxEntries[mid].fcStart <= fc) { ans = mid; lo = mid + 1; } else hi = mid - 1;
                }
                if (ans >= 0 && fc < chpxEntries[ans].fcLim) return chpxEntries[ans];
                return { bold: false, italic: false, underline: false };
            }

            const paragraphs = []; // { runsHtml: string, level: number|null }
            let curRunsHtml = '';
            let curRunText = '';
            let curFmtKey = null;
            let curFmt = null;
            let footnoteCount = 0;
            // מעקב אחר קוד-שדה פנימי של Word בתוך גוף המסמך הראשי (כגון "NOTEREF ...") - באותו
            // אופן בדיוק כמו ב-docPlainTextFromCpRange למעלה (המשמש להערות השוליים): שדה מיוצג
            // כ-0x13 (תחילת שדה) + טקסט-ההוראה הפנימי + 0x14 (מפריד) + הערך המוצג בפועל + 0x15
            // (סוף שדה). בלי המעקב הזה, תווי הסימון (0x13/0x14/0x15) עצמם נבלעים כתווי-בקרה
            // (השורה למטה, c.ch < 0x20), אך טקסט-ההוראה הפנימי שביניהם (תווים רגילים, לא תווי-
            // בקרה) היה ממשיך להצטרף לריצת הטקסט הרגילה ולדלוף כטקסט גלוי בגוף המסמך - בדיוק
            // התקלה שדווחה: הסינון עבד רק בהערות השוליים, ולא בטקסט הראשי.
            let inFieldInstruction = false;

            function flushRun() {
                if (curRunText) {
                    curRunsHtml += docWrapRunFormatting(escapeHtmlText(curRunText), curFmt);
                    curRunText = '';
                }
            }

            for (const c of mainChars) {
                if (c.ch === 0x13) { flushRun(); inFieldInstruction = true; continue; } // תחילת שדה - מתחילים לדלג
                if (c.ch === 0x14) { inFieldInstruction = false; continue; } // מפריד - מכאן הערך המוצג בפועל
                if (c.ch === 0x15) { inFieldInstruction = false; continue; } // סוף שדה (הגנה גם ללא מפריד תקין)
                if (inFieldInstruction) continue;
                if (c.ch === 0x02) { // תו הפניית הערת שוליים
                    flushRun();
                    footnoteCount++;
                    const label = formatFootnoteNumber(footnoteCount, footnoteNumFmt);
                    curRunsHtml += `<sup class="footnote-ref" data-fn-id="${label}">${label}</sup>`;
                    continue;
                }
                if (c.ch === 0x0d || c.ch === 0x07 || c.ch === 0x0c) { // סוף פסקה / תא טבלה / עמוד
                    flushRun();
                    const istd = docIstdAt(papxEntries, c.fc); // סגנון הפסקה נלקח מה-PAPX שחל *על* תו-הסימון עצמו
                    const level = headingMap[istd] || null;
                    if (curRunsHtml) paragraphs.push({ runsHtml: curRunsHtml, level });
                    curRunsHtml = '';
                    continue;
                }
                if (c.ch < 0x20 && c.ch !== 0x09) continue; // תווי בקרה נדירים אחרים - מדולגים, כמו בנתיב הפשוט
                const fmt = chpAt(c.fc);
                const fmtKey = fmt.bold + '|' + fmt.italic + '|' + fmt.underline;
                if (fmtKey !== curFmtKey) { flushRun(); curFmtKey = fmtKey; curFmt = fmt; }
                curRunText += String.fromCharCode(c.ch);
            }
            flushRun();
            if (curRunsHtml) paragraphs.push({ runsHtml: curRunsHtml, level: null });

            const html = paragraphs
                .map(p => p.level ? `<h${p.level}>${p.runsHtml}</h${p.level}>` : `<p>${p.runsHtml}</p>`)
                .join('');

            // הערות השוליים עצמן (טקסט פשוט בלבד, ללא עיצוב פנימי - באותו היקף בדיוק כמו
            // parseDocxFootnotesXml למעלה) יושבות במסמך-משנה נפרד מיד אחרי גוף המסמך הראשי
            // באותו זרם CP לוגי, מופרד ע"י CP בודד (סימן הסוף של המסמך הראשי - [MS-DOC] 2.5.4:
            // "אם ccpFtn/... שונים מאפס, ה-CP האחרון שווה לסכומם ועוד ccpText+1")
            const footnotesByLabel = {};
            if (fib.ccpFtn > 0 && footnoteCount > 0) {
                const cpCharMap = docBuildCpCharMap(wordDocBytes, pieces);
                const ftnTxtCps = docParsePlcCpArray(tableBytes, fib.fcPlcffndTxt, fib.lcbPlcffndTxt, 0);
                const ftnDocStart = fib.ccpText + 1;
                const ftnRangeCount = Math.max(0, ftnTxtCps.length - 1);
                const pairCount = Math.min(footnoteCount, ftnRangeCount);
                for (let i = 0; i < pairCount; i++) {
                    const label = formatFootnoteNumber(i + 1, footnoteNumFmt);
                    const text = docPlainTextFromCpRange(cpCharMap, ftnDocStart + ftnTxtCps[i], ftnDocStart + ftnTxtCps[i + 1]);
                    if (text) footnotesByLabel[label] = escapeHtmlText(text);
                }
            }

            return { html, footnotesByLabel };
        }

        async function extractLegacyDocText(arrayBuffer) {
            const cfb = parseCfbContainer(arrayBuffer);
            const wordDocBytes = cfb.getStream('WordDocument');
            if (!wordDocBytes) throw new Error('לא נמצא זרם WordDocument בקובץ - ייתכן שהקובץ פגום או אינו קובץ .doc תקין');
            const fib = parseDocFib(wordDocBytes);
            const tableBytes = cfb.getStream(fib.fWhichTblStm ? '1Table' : '0Table') || new Uint8Array(0);
            try {
                const rich = extractLegacyDocRich(wordDocBytes, tableBytes, fib);
                if (rich.html) return rich;
            } catch (err) {
                console.error('שחזור העיצוב המלא של קובץ ה-.doc נכשל - נופל בחזרה לטקסט פשוט', err);
            }
            // נתיב גיבוי: טקסט פשוט בלבד (ללא כותרות/הדגשות/הערות שוליים), למקרה של קובץ .doc
            // בעל מבנה חריג שהפענוח העשיר למעלה לא הצליח להתמודד איתו
            return { html: docTextToParagraphHtml(extractDocPlainText(wordDocBytes, tableBytes, fib)), footnotesByLabel: {} };
        }
