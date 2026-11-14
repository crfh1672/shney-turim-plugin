        async function loadExternalFile(file) {
            const name = (file.name || 'מסמך').replace(/\.[^.]+$/, '');
            const lower = (file.name || '').toLowerCase();
            const previewArea = document.getElementById('preview-area');
            if (previewArea) {
                previewArea.innerHTML = `<div class="print-page" style="column-count:1;text-align:center;"><br><br><h2 style="color:var(--color-primary);">פותח את הקובץ...</h2></div>`;
            }

            let html = '';
            let footnotesMap = {};
            try {
                if (lower.endsWith('.docx')) {
                    const buffer = await file.arrayBuffer();
                    // הערות שוליים ומספור שלהן (word/footnotes.xml + word/settings.xml) נמשכים
                    // ומפוענחים לפני פענוח תוכן המסמך עצמו (word/document.xml) - כדי שכל הפניה
                    // להערה בתוך הטקסט (w:footnoteReference) תוכל כבר להיות מותאמת לצורת התצוגה
                    // הנכונה (מספרים/אותיות/רומיות - ראו parseDocxFootnotesXml) בזמן בניית ה-HTML,
                    // ולא רק בתחתית העמוד. לא כל מסמך כולל הערות שוליים כלל - כשל כאן אינו קריטי
                    // ופשוט משאיר את המסמך בלי הערות (ומספור ברירת המחדל 'decimal' לא משנה דבר
                    // כשאין בכלל הפניות להערות).
                    const footnotesXml = await extractDocxFootnotesXml(buffer);
                    const footnoteNumFmt = await extractDocxFootnoteNumFmt(buffer);
                    const { footnotesByLabel, idToLabel } = parseDocxFootnotesXml(footnotesXml, footnoteNumFmt);
                    const stylesXml = await extractDocxStylesXml(buffer);
                    const headingStyles = parseDocxHeadingStyles(stylesXml);
                    html = docxXmlToHtml(await extractDocxDocumentXml(buffer), idToLabel, headingStyles);
                    footnotesMap = footnotesByLabel;
                } else if (lower.endsWith('.doc')) {
                    // פורמט .doc ישן (Word 97-2003) - כותרות/בולד/נטוי/קו-תחתון/הערות שוליים
                    // משוחזרים במלואם (ראו extractLegacyDocRich למעלה), עם נפילה-חזרה אוטומטית
                    // לטקסט פשוט אם הקובץ הספציפי בעל מבנה חריג שאי אפשר לפענח עיצוב ממנו
                    const legacyResult = await extractLegacyDocText(await file.arrayBuffer());
                    html = legacyResult.html;
                    footnotesMap = legacyResult.footnotesByLabel;
                } else if (lower.endsWith('.htm') || lower.endsWith('.html')) {
                    const raw = await file.text();
                    const body = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                    html = await sanitizeAndBalanceTags(body ? body[1] : raw);
                } else {
                    html = (await file.text()).split(/\r?\n/)
                        .map(l => l.trim()).filter(Boolean)
                        .map(l => `<p>${escapeHtmlText(l)}</p>`).join('');
                }
            } catch (err) {
                if (previewArea) {
                    previewArea.innerHTML = `<div class="print-page" style="column-count:1;text-align:center;"><br><br><h3>שגיאה בפתיחת הקובץ</h3><p>${escapeHtmlText(err && err.message ? err.message : String(err))}</p></div>`;
                }
                return;
            }

            if (!html) {
                if (previewArea) previewArea.innerHTML = `<div class="print-page" style="column-count:1;text-align:center;"><br><br><h3>הקובץ ריק מטקסט.</h3></div>`;
                return;
            }

            // הקובץ החיצוני נטען לתוך הטאב הנוכחי (טאב "ספר חדש") ומעומד בדיוק כמו ספר רגיל.
            // footnotes: מיפוי מזהה-הערה -> טקסט ההערה, נקרא בזמן העימוד (paginateContent) כדי
            // להציג כל הערה בתחתית העמוד המדויק שבו מופיעה ההפניה אליה - לא בעמוד קבוע/מרוחק
            const externalId = `external-file-${Date.now()}`;
            const targetIndex = activeTabIndex !== -1 ? activeTabIndex : 0;
            tabs[targetIndex] = {
                id: externalId,
                title: name,
                isExternal: true,
                cachedPreview: null,
                cachedPreviewFragment: null,
                cachedBookViewFragment: null,
                rawContent: html,
                footnotes: footnotesMap,
                cols: "2",
                fontSize: currentSettings.fontSize || 14,
                isRendering: false,
                pagesRendered: false
            };
            activeTabIndex = -1;
            switchTab(targetIndex);
            await paginateContent(html, targetIndex);
            buildTOC();
        }

        async function refreshCurrentTab() {
            if (activeTabIndex === -1 || !tabs[activeTabIndex] || tabs[activeTabIndex].isNewBookTab) return;
            const t = tabs[activeTabIndex];

            // קובץ חיצוני: אין מאיפה למשוך מחדש (הקובץ כבר לא בידינו) - רק מעמדים מחדש את הטקסט
            if (t.isExternal) {
                t.cachedPreviewFragment = null;
                t.cachedBookViewFragment = null;
                t.cachedPreview = null;
                if (currentSettings.isBookView) { destroyBookDOM(); currentLeaf = 0; }
                await paginateContent(t.rawContent, activeTabIndex);
                buildTOC();
                if (currentSettings.isBookView) { currentLeaf = 0; updateBookViewPages(); }
                return;
            }

            // מחיקה מלאה של כל זכר לספר בזיכרון - כולל הטקסט הגולמי - כדי שהרענון באמת ימשוך
            // ויעמד הכל מאפס ולא ישתמש בשום שארית מהטעינה הקודמת
            t.cachedPreviewFragment = null;
            t.cachedBookViewFragment = null;
            t.cachedPreview = null;
            t.rawContent = "";
            t.pagesRendered = false;
            t.savedPageIndex = undefined;
            t.scrollPosition = 0;
            t.currentLeaf = 0;
            // סימון דגל "עוקף מטמון": רענון מפורש מהמשתמש חייב למשוך ולעמד מאפס - הוא מבקש אותו
            // בדיוק כשמשהו נראה לו שבור, ולכן אסור להציג לו שוב את אותם עמודים מהמטמון
            t._bypassPaginationCache = true;
            const pa = document.getElementById('preview-area');
            if (pa) delete pa.dataset.searchBaseHtml;

            // בתצוגת ספר דו-עמודי חייבים לפרק את מבנה ה-book-wrapper/leaves הישן ולאפס את העלה
            // הנוכחי לפני הטעינה מחדש - אחרת הרענון בונה עמודים חדשים לתוך מבנה ישן והסידור משתבש
            const wasBookView = currentSettings.isBookView;
            if (wasBookView) {
                destroyBookDOM();
                currentLeaf = 0;
            }

            await generateView();

            // אחרי שהעימוד הסתיים במלואו - בונים מחדש את הספר ומציגים אותו מתחילתו
            if (wasBookView && currentSettings.isBookView) {
                currentLeaf = 0;
                updateBookViewPages();
            }
        }

        // משיכת תוכן העניינים הרשמי של הספר מהספרייה - [{ text, index, level }] כאשר index הוא
        // אינדקס שורה 0-based (אותה מערכת מספור בדיוק כמו data-line-idx). בכישלון (למשל ספר ללא
        // TOC רשמי, או קובץ שאינו מזוהה בספרייה) מוחזר מערך ריק, ו-buildTOC נופל בחזרה לסריקת
        // כותרות ה-HTML הקיימת כרגיל - כדי שהתכונה החדשה לא תשבור אף ספר קיים.
        async function fetchOfficialToc(bookId) {
            try {
                const { data } = await Otzaria.call('library.getBookToc', { bookId });
                return Array.isArray(data) ? data : [];
            } catch (e) {
                console.error('משיכת תוכן העניינים הרשמי נכשלה', e);
                return [];
            }
        }

        // --- הפרדת הערות שוליים בספרי DOC/DOCX שנמשכים מהתוכנה (library.getBookContent) ---
        // בניגוד לקובץ DOCX/DOC שנפתח ידנית (ראו loadExternalFile/docxXmlToHtml למעלה, שקוראים
        // ישירות מ-word/footnotes.xml בתוך ה-ZIP), ספר Word שכבר נוסף לספריית אוצריא ונמשך דרך
        // library.getBookContent מגיע כטקסט "שטוח" שבו התוכנה כבר המירה כל הערת שוליים לצמד
        // תגיות רציף בתוך זרימת הטקסט הרגילה, בדיוק במקום שבו הייתה ההפניה במסמך המקורי:
        //   <sup class="footnote-marker">1</sup><i class="footnote">טקסט ההערה...</i>
        // (אומת בפועל מול פלט גולמי אמיתי של התוכנה על ספר Word אישי). בלי הפונקציה הזו, שני
        // התגים נשארים כפי שהם בתוך הפסקה - הערת השוליים "יושבת" בגוף הטקסט בכתב נטוי, בדיוק
        // התסמין שדווח.
        //
        // הפתרון: מזהים כל צירוף כזה, מוציאים את טקסט ההערה למיפוי נפרד (footnotes map - בדיוק
        // כמו footnotesMap שבונה loadExternalFile), ומחליפים את שני התגים בתגית יחידה
        //   <sup class="footnote-ref" data-fn-id="...">1</sup>
        // שהיא **אותה תגית בדיוק** שמייצרת docxXmlToHtml עבור הפניות הערה בקובץ DOCX שנפתח
        // ידנית (ראו שורה עם 'footnote-ref' data-fn-id למעלה) - כך שכל מנגנון התצוגה הקיים בתחתית
        // העמוד (syncPageFootnotes, trimFootnotesToFitPage וכו') עובד על זה ללא שום שינוי נוסף.
        //
        // מזהה ההערה הפנימי (data-fn-id) הוא הלייבל המוצג עצמו (המספר/אות שכבר בתוך ה-sup
        // המקורי) - **בדיוק** כמו ב-docxXmlToHtml עבור DOCX שנפתח ידנית (שם data-fn-id הוא
        // תמיד הלייבל המוצג, ראו למעלה) - כי syncPageFootnotes מציג בפועל את ה-data-fn-id עצמו
        // כמספר ההערה בתחתית העמוד (`<sup>${id}</sup> ${text}`), ולא רק כמזהה טכני פנימי.
        const LIBRARY_FOOTNOTE_RE = /<sup\b[^>]*\bclass\s*=\s*["'][^"']*\bfootnote-marker\b[^"']*["'][^>]*>([\s\S]*?)<\/sup>\s*<i\b[^>]*\bclass\s*=\s*["'][^"']*\bfootnote\b[^"']*["'][^>]*>([\s\S]*?)<\/i>/g;

        // ניקוי שרידי שדה-Word (NOTEREF) שדולפים כטקסט גלוי בתוך הפניות "עי' הערה X" - התוכנה
        // (לא התוסף) ממירה שדה NOTEREF (הפניה דינמית להערה אחרת) לטקסט, אך משאירה גם את קוד
        // השדה הגולמי (למשל "NOTEREF _Ref403477913 ") לצד התוצאה המחושבת שאחריו (המספר עצמו) -
        // מסירים רק את קוד השדה, ומשאירים את המספר המחושב במקומו כרגיל.
        const NOTEREF_ARTIFACT_RE = /\bNOTEREF\s+_Ref\d+\s*/g;
        function stripNoterefArtifacts(text) {
            return text ? text.replace(NOTEREF_ARTIFACT_RE, '') : text;
        }

        function extractLibraryFootnotes(html) {
            // בדיקה זולה מראש - ברוב הספרים (טקסט רגיל, לא ממקור Word) התבנית כלל לא קיימת,
            // ואין טעם להריץ regex כבד על כל תוכן הספר סתם
            if (!html || html.indexOf('footnote-marker') === -1) return { html, footnotes: null };

            const footnotes = {};
            let processedHtml = html.replace(LIBRARY_FOOTNOTE_RE, (match, label, noteText) => {
                const id = (label != null && label.trim()) ? label.trim() : '';
                if (!id) return match; // לייבל ריק/לא צפוי - לא מזהים, משאירים כפי שהיה במקור
                footnotes[id] = stripNoterefArtifacts(noteText);
                return `<sup class="footnote-ref" data-fn-id="${id}">${id}</sup>`;
            });

            // גם בגוף הטקסט הראשי (מחוץ להערות) יכולות להופיע אותן שאריות NOTEREF (פחות נפוץ,
            // אך נמצא בפועל גם שם) - מנקים באותו אופן
            processedHtml = stripNoterefArtifacts(processedHtml);

            return { html: processedHtml, footnotes: Object.keys(footnotes).length > 0 ? footnotes : null };
        }

        // --- פתיחה מהירה מתוך מטמון העימוד (ראו pagination-cache.js) ---
        // אם העימוד המוגמר של הספר הזה (עם הגדרות הפריסה הנוכחיות) שמור מפתיחה קודמת - מציגים אותו
        // מיד וקופצים לשורה המבוקשת, בלי למשוך ולמדוד את כל הספר קודם. משיכת הספר ממשיכה ברקע
        // ומשמשת לאימות (verifyCachedViewAgainstBook). מחזירה את הרשומה שהוצגה, או null כשאין
        // מטמון מתאים (או שכל שלב נכשל) - ואז generateView ממשיכה בעימוד הרגיל בדיוק כמו קודם.
        async function tryRenderFromPaginationCache(tab, viewGen, tocPromise, startedAt) {
            if (typeof PaginationCache === 'undefined' || !PaginationCache.isAvailable()) return null;
            if (!tab || tab.isExternal || !tab.id) return null;
            let rendered = false;
            try {
                const layoutSig = PaginationCache.computeLayoutSignature(tab);
                const entry = await PaginationCache.load(tab.id, layoutSig, tab.bookUid);
                if (!entry) return null;
                // לא מחכים ל-TOC הרשמי יותר מרגע קצר: בקשת TOC איטית לא צריכה לעכב את העמודים השמורים.
                // אם הוא מגיע בזמן - מוצג איתם בלי הבהוב; אחרת העמודים מוצגים מיד והוא מתעדכן כשמגיע.
                const TOC_PENDING = {};
                const tocOrPending = await Promise.race([tocPromise, new Promise((r) => setTimeout(() => r(TOC_PENDING), 150))]);
                const tocIsPending = (tocOrPending === TOC_PENDING);
                const officialToc = tocIsPending ? null : tocOrPending;
                if (tab._closed || tab._viewGen !== viewGen) return null;
                const idx = tabs.indexOf(tab);
                if (idx === -1) return null;
                // אם הפריסה השתנתה בזמן ההמתנה (גופן/עמודות...), העימוד השמור כבר אינו מתאים
                if (PaginationCache.computeLayoutSignature(tab) !== layoutSig) return null;

                tab.cachedPreview = entry.html;
                tab.cachedPreviewFragment = null;
                tab.cachedBookViewFragment = null;
                tab.officialToc = officialToc;
                tab.pagesRendered = true;
                tab._tocComplete = true;
                tab.isRendering = false;
                rendered = true;

                if (activeTabIndex === idx) {
                    const previewArea = document.getElementById('preview-area');
                    const banner = document.getElementById('pagination-banner');
                    delete previewArea.dataset.searchBaseHtml;
                    lastSearchedQuery = null;
                    previewArea.innerHTML = entry.html;
                    if (currentSettings.isBookView) {
                        currentLeaf = 0;
                        buildBookDOM();
                    }
                    buildTOC();
                    refreshSearchIfActive();
                    document.getElementById('btn-print').disabled = false;
                    if (banner) {
                        const span = banner.querySelector('span');
                        if (span) span.innerText = 'נטען מהמטמון - מאמת מול הספר...';
                        banner.classList.add('visible');
                    }
                    if (typeof tab.pendingScrollLineIndex === 'number') {
                        const targetLine = tab.pendingScrollLineIndex;
                        tab.pendingScrollLineIndex = null;
                        const pageIdx = locatePageIndexForLineIndex(targetLine);
                        if (pageIdx >= 0) goToPageIndex(pageIdx);
                    }
                    if (tab.commentaryPanelOpen) refreshCommentaryPanel(true);
                }
                if (tocIsPending) {
                    tocPromise.then((late) => {
                        if (tab._closed || tab._viewGen !== viewGen) return;
                        tab.officialToc = late;
                        if (tabs[activeTabIndex] === tab && tab.pagesRendered) buildTOC();
                    }).catch(() => {});
                }
                console.info('[שני טורים] נפתח מהמטמון', Math.round(performance.now() - startedAt) + 'ms', '(' + entry.pageCount + ' עמודים)');
                return { entry, layoutSig };
            } catch (e) {
                console.error('פתיחה מהמטמון נכשלה - ממשיכים בעימוד רגיל', e);
                if (rendered) {
                    tab.cachedPreview = null;
                    tab.pagesRendered = false;
                    tab._tocComplete = false;
                    tab.isRendering = true;
                }
                return null;
            }
        }

        // אחרי שהספר הוצג מהמטמון: משווים מול התוכן שנמשך עכשיו מהספרייה. תוכן זהה והגדרות פריסה
        // זהות - אין מה לעשות (רק משלימים את rawContent וההערות לטובת עימוד מחדש בהמשך). תוכן שונה
        // (הספר עודכן בספרייה), או שהמשתמש שינה הגדרת פריסה בזמן שהמשיכה רצה (שינויים כאלה נבלעים
        // כל עוד rawContent ריק) - מעמדים מחדש וחוזרים לאותה שורה.
        async function verifyCachedViewAgainstBook(tab, hit, allData, officialToc, viewGen) {
            const banner = document.getElementById('pagination-banner');
            const hideBanner = () => {
                if (banner && tabs[activeTabIndex] === tab) banner.classList.remove('visible');
            };
            if (tab._closed || tab._viewGen !== viewGen) return;
            if (!allData) {
                // משיכה נכשלה - נשארים עם מה שמוצג; ריענון ידני (Ctrl+Shift+T) ינסה שוב מאפס
                hideBanner();
                return;
            }
            const { html: contentForDisplay, footnotes: libFootnotes } = extractLibraryFootnotes(allData);
            const fp = PaginationCache.contentFingerprint(contentForDisplay, libFootnotes);
            const sameContent = fp.len === hit.entry.contentLen && fp.hash === hit.entry.contentHash;

            tab.rawContent = contentForDisplay;
            tab.footnotes = libFootnotes;
            tab.officialToc = officialToc;

            const idx = tabs.indexOf(tab);
            if (idx === -1) return;
            const layoutUnchanged = PaginationCache.computeLayoutSignature(tab) === hit.layoutSig;
            if (sameContent && layoutUnchanged) {
                hideBanner();
                return;
            }

            console.info('[שני טורים] מעמדים מחדש אחרי פתיחה מהמטמון:', sameContent ? 'הגדרות הפריסה השתנו' : 'תוכן הספר השתנה');
            if (!sameContent) PaginationCache.remove(tab.id, hit.layoutSig);
            const isActive = (activeTabIndex === idx);
            const posState = isActive ? beginEarlyPositionRestore(tab) : null;
            await paginateContent(contentForDisplay, idx);
            if (isActive && activeTabIndex === idx) {
                buildTOC();
                finishPositionRestore(tab, posState);
            }
        }

        async function generateView() {
            const targetTabIndex = activeTabIndex;
            const currentTab = tabs[targetTabIndex];
            if (!currentTab) return;

            // מזהה "דור" לכל הרצה של generateView על הטאב: מאפשר לפתיחה מהמטמון ולאימות שאחריה
            // לזהות שבינתיים התחילה הרצה חדשה (למשל רענון ידני) ולהפסיק בלי לדרוך עליה
            currentTab._viewGen = (currentTab._viewGen || 0) + 1;
            const viewGen = currentTab._viewGen;

            currentTab.cachedPreview = null;
            currentTab.cachedPreviewFragment = null;
            currentTab.cachedBookViewFragment = null;
            currentTab.isRendering = true;
            currentTab.pagesRendered = false;

            closeAllDrawers();
            const previewArea = document.getElementById('preview-area');

            document.getElementById('btn-print').disabled = true;
            previewArea.innerHTML = `
                <div class="print-page" style="column-count:1;text-align:center;display:flex;flex-direction:column;justify-content:center;">
                    <h2 id="loading-text" style="color:var(--color-primary);">מושך נתונים מהספר...</h2>
                    <p>נא להמתין.</p>
                </div>`;

            try {
                const viewStartedAt = performance.now();
                const bypassCache = Boolean(currentTab._bypassPaginationCache);
                currentTab._bypassPaginationCache = false;

                // תוכן הספר ותוכן העניינים הרשמי שלו נמשכים במקביל - כך שברגע שהעימוד הראשוני
                // מתחיל, ה-TOC הרשמי (אם קיים) כבר מוכן וישמש את buildTOC מייד, בלי "הבהוב" של
                // תוכן עניינים מבוסס-כותרות שמוחלף בהמשך. המשיכה מתחילה מיד, במקביל לבדיקת מטמון
                // העימוד: בפגיעה היא משמשת לאימות ברקע, ובפספוס אין שום עיכוב לעומת קודם.
                const bookPromise = fetchEntireBook(currentTab.id, (loaded) => {
                    if (currentTab._closed || targetTabIndex !== activeTabIndex) return;
                    const lt = document.getElementById('loading-text');
                    if (lt) lt.innerHTML = `מושך נתונים... (${loaded})`;
                }, currentTab);
                bookPromise.catch(() => {}); // השגיאה (אם תהיה) מטופלת ב-Promise.all למטה
                const tocPromise = fetchOfficialToc(currentTab.id);

                const cacheHit = bypassCache
                    ? null
                    : await tryRenderFromPaginationCache(currentTab, viewGen, tocPromise, viewStartedAt);

                const [allData, officialToc] = await Promise.all([bookPromise, tocPromise]);
                const bookFetchedAt = performance.now();

                // הטאב נסגר בזמן שהמשיכה הייתה באמצע - לא ממשיכים לעבד (עימוד, בניית DOM וכו') בשביל
                // טאב שכבר לא קיים; ה-await למעלה כבר עצר את משיכת הנתונים בפועל עצמה (ראו fetchEntireBook)
                if (currentTab._closed) {
                    currentTab.isRendering = false;
                    return;
                }

                if (cacheHit) {
                    await verifyCachedViewAgainstBook(currentTab, cacheHit, allData, officialToc, viewGen);
                    return;
                }

                // הרצה חדשה של generateView על אותו טאב (למשל רענון ידני) כבר השתלטה - היא תטפל בהכל
                if (currentTab._viewGen !== viewGen) return;

                if (!allData) {
                    currentTab.isRendering = false;
                    return;
                }

                // הפרדת הערות שוליים inline (ספרי DOC/DOCX שנמשכו מהתוכנה - ראו הפונקציה
                // extractLibraryFootnotes למעלה) - לפני שמירת התוכן על הטאב ולפני העימוד, כך
                // ש-paginateContent/syncPageFootnotes יראו כבר את tabs.footnotes המוכן, בדיוק
                // כמו שקורה ב-loadExternalFile עבור קובץ DOCX שנפתח ידנית.
                const { html: contentForDisplay, footnotes: libFootnotes } = extractLibraryFootnotes(allData);

                currentTab.rawContent = contentForDisplay;
                // תמיד נקבע מחדש (גם ל-null) ולא רק כש-libFootnotes קיים - כדי שרענון ספר (ראו
                // refreshCurrentTab) לא ישאיר בטעות הערות "יתומות" מהמשיכה הקודמת אם ההערות
                // כבר לא קיימות בתוכן שנמשך עכשיו
                currentTab.footnotes = libFootnotes;
                currentTab.officialToc = officialToc;
                const paginationStartedAt = performance.now();
                await paginateContent(contentForDisplay, targetTabIndex);
                console.info('[שני טורים] פתיחה בלי מטמון: משיכה ' + Math.round(bookFetchedAt - viewStartedAt) + 'ms, עימוד ' + Math.round(performance.now() - paginationStartedAt) + 'ms');

                // קפיצה חד-פעמית למיקום המדויק שבו היה המשתמש במסך העיון הרגיל (ראו
                // setBookSelection) - רק אחרי שהעימוד הסתיים במלואו וכל העמודים כבר קיימים ב-DOM.
                if (targetTabIndex === activeTabIndex && typeof currentTab.pendingScrollLineIndex === 'number') {
                    const targetLine = currentTab.pendingScrollLineIndex;
                    currentTab.pendingScrollLineIndex = null;
                    const pageIdx = locatePageIndexForLineIndex(targetLine);
                    if (pageIdx >= 0) goToPageIndex(pageIdx);
                }

            } catch (error) {
                currentTab.isRendering = false;
                if (targetTabIndex !== activeTabIndex) return;
                previewArea.innerHTML = "<div class='print-page'><h3>שגיאה בטעינת הספר.</h3></div>";
            }
        }

        // הערה: כפתור "פתח בתצוגת שני טורים" בסרגל הכלים של מסך העיון כבר אינו נרשם כאן בזמן
        // ריצה - הוא מוצהר באופן דקלרטיבי ב-manifest.json תחת contributes.startup.toolbarItems,
        // שהיא הדרך המומלצת (הכפתור קיים תמיד, גם בלי שמנוע ה-JS של התוסף רץ בכלל, ומופעל
        // בעצלנות רק בלחיצה).

        // פותח/מסנכרן לספר ולמיקום המדויק לפי אובייקט "מצב קריאה נוכחי" - משמש הן ב-plugin.boot
        // (עם הנתונים מ-reader.getCurrentState) והן במאזין ללחיצות חוזרות על כפתור מסך העיון
        // (עם הנתונים שמגיעים ישירות באירוע reader.toolbar_item_clicked, ראו למטה).
        function syncToReaderCurrentBook(state) {
            // אותה בדיקה בדיוק כמו ברשימת/חיפוש הספרים (isFetchableLibraryItem) - אם הספר הפתוח
            // כרגע במסך העיון הוא PDF או חלונית מפרשים (שהתוסף לא יכול למשוך), לא מנסים למשוך אותו
            // כלל (זה מה שגרם לתקיעה) - במקום זה נפתח ישר על מסך "בחר ספר" הרגיל.
            const isFetchable = state && state.currentBookId && isFetchableLibraryItem({
                type: state.currentBookType || state.currentType,
                book: state.currentBook,
                isPdf: state.isPdf || state.currentIsPdf,
                isCommentary: state.isCommentary || state.isCommentators || state.isLinks || state.isLinksPanel,
                isSearch: state.isSearch || state.isSearchPanel || state.currentIsSearch || state.isSearchTab
            });
            if (isFetchable) {
                setBookSelection(state.currentBookId, state.currentBook, state.currentIndex, state.currentBookUid);
            } else {
                openNewBookTab();
            }
        }

        // אתחול ראשוני והאזנה ל-API
        const settingsReadyPromise = loadSettings().then(() => loadPdfExportFontAndRehydrate());

        // אתחול התוסף רץ גם במצבי תצוגה שבהם Otzaria SDK אינו זמין.
        if (typeof Otzaria !== 'undefined' && Otzaria && typeof Otzaria.on === 'function') {
            Otzaria.on('plugin.boot', async (payload) => {
                applyTheme(payload.theme);
                // פתיחה רגילה: מסך בחירת ספרים בלבד - הספר מגיע דרך reader.toolbar_item_clicked (כפתור
                // הקורא) או plugin.page_opened (מדף הבית). אבל כשהדף נטען מחדש עבור לשונית שכבר הייתה
                // קיימת - אחרי סגירה ופתיחה של התוכנה, פינוי זיכרון, קריסה או טעינה מחדש - אוצריא
                // מוסרת ב-payload.restore את המצב ששמרנו (session-restore.js), והספר חוזר כמו שהיה.
                let restored = false;
                try { restored = await SessionRestore.restoreFromBoot(payload); } catch (e) { restored = false; }
                if (!restored) await openNewBookTab();
                SessionRestore.start();
            });

            // plugin.boot נורה רק בטעינה ראשונה של ה-webview של התוסף. אם המשתמש כבר פתח את התוסף
            // פעם אחת באותה הפעלה (וה-webview נשאר טעון ברקע, כפי שמקובל לטאב מוצמד) - לחיצות חוזרות
            // על כפתור "פתח בתצוגת שני טורים" בסרגל מסך העיון לא יגרמו ל-plugin.boot נוסף, אלא רק
            // לאירוע הזה. בלעדי המאזין הזה, כל כניסה חוזרת דרך הכפתור הייתה פשוט מציגה את התוסף כפי
            // שהוא (בלי לסנכרן מחדש ספר/מיקום) - וזו הסיבה שהקפיצה למיקום המדויק לא עבדה בלחיצות חוזרות.
            Otzaria.on('reader.toolbar_item_clicked', (data) => {
                if (data && data.itemId === 'shney-turim-open') {
                    syncToReaderCurrentBook(data);
                }
            });

            // פתיחת ספר מדף הבית של התוסף - הנתונים מגיעים דרך plugin.page_opened
            // (נשלחו על ידי plugin.openSelf עם newTab: true מתוך openBookInNewInstance).
            Otzaria.on('plugin.page_opened', (data) => {
                if (!data || !data.param || !data.param.bookId) return;
                const p = data.param;
                syncToReaderCurrentBook({
                    currentBookId: p.bookId,
                    currentBook: p.bookTitle,
                    currentIndex: p.targetLineIndex,
                    currentBookUid: p.bookUid,
                    currentBookType: 'text',
                    currentType: 'text'
                });
            });

            // קיצור מקלדת ברמת התוכנה (מוצהר ב-manifest.json תחת contributes.startup.shortcuts,
            // זמין מגרסת אוצריא 0.9.97) - מפעיל את אותה פעולה בדיוק כמו לחיצה על כפתור "פתח בתצוגת
            // שני טורים" בסרגל מסך העיון. בשונה מ-reader.toolbar_item_clicked (שמגיע עם פרטי הספר
            // הנוכחי כבר בתוך ה-payload), אירוע app.command מגיע רק עם {command, shortcutId} - ולכן
            // שולפים את מצב הקריאה הנוכחי בעצמנו, באותו אופן בדיוק כמו ב-plugin.boot למעלה.
            Otzaria.on('app.command', async (payload) => {
                if (!payload || payload.command !== 'shney-turim-open-shortcut') return;
                // קיצור מקלדת - פותח מופע חדש עם הספר הנוכחי מהקורא, בדיוק כמו כפתור הקורא.
                try {
                    const { data } = await Otzaria.call('reader.getCurrentState');
                    if (data && data.currentBookId) {
                        await Otzaria.call('plugin.openSelf', {
                            newTab: true,
                            param: {
                                bookId: data.currentBookId,
                                bookTitle: data.currentBook,
                                targetLineIndex: data.currentIndex,
                                bookUid: data.currentBookUid
                            }
                        });
                    } else {
                        await Otzaria.call('plugin.openSelf', {});
                    }
                } catch (e) {
                    try {
                        await Otzaria.call('plugin.openSelf', {});
                    } catch (e2) { /* נכשל בשקט */ }
                }
            });

            Otzaria.on('theme.changed', (theme) => applyTheme(theme));
        }
// שמירת הגדרות חירום בעת סגירה פתאומית או מעבר לשונית באוצריא. מה שפתוח במופע נשמר בנפרד
// דרך plugin.setRestoreState ומשוחזר ב-plugin.boot (ראו session-restore.js)
        window.addEventListener('pagehide', () => {
            saveSettings();
        });

        /* --- מסך מלא (F11 / Esc) --- */
        function isInFullscreenMode() {
            return Boolean(document.fullscreenElement) || document.body.classList.contains('fullscreen-mode');
        }

        function enterFullscreen() {
            // הפעלת מסך מלא אמיתי דרך ה-Fullscreen API של הדפדפן/webview
            try {
                const el = document.documentElement;
                if (el.requestFullscreen) {
                    const req = el.requestFullscreen();
                    if (req && typeof req.catch === 'function') {
                        req.catch(() => {});
                    }
                }
            } catch (e) { /* ignore */ }
            // התכונה הנוספת שלנו: הסתרת שורת הטאבים כדי לפנות עוד קצת מקום לתוכן
            document.body.classList.add('fullscreen-mode');
        }

        function exitFullscreenMode() {
            if (document.fullscreenElement && document.exitFullscreen) {
                document.exitFullscreen().catch(() => {});
            }
            document.body.classList.remove('fullscreen-mode');
        }

        function toggleFullscreen() {
            if (isInFullscreenMode()) {
                exitFullscreenMode();
            } else {
                enterFullscreen();
            }
        }

        // אם המשתמש יוצא ממסך מלא אמיתי בדרך אחרת (כפתור מערכת וכד') - נסנכרן ונחזיר את שורת הטאבים
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) {
                document.body.classList.remove('fullscreen-mode');
            }
        });

        /* --- ניווט בין עמודים באמצעות מקלדת --- */
        function goToNextPageScroll() {
            const previewArea = document.getElementById('preview-area');
            if (!previewArea) return;
            const idx = getScrollCurrentPage();
            scrollToPageInScrollView(idx + 1);
        }

        function goToPrevPageScroll() {
            const previewArea = document.getElementById('preview-area');
            if (!previewArea) return;
            const idx = getScrollCurrentPage();

            // בתצוגת "שני עמודים בשורה" (twoColumnScroll) שני העמודים באותה שורה חולקים בדיוק
            // אותו top ויזואלי - ולכן getScrollCurrentPage (שמכריע שוויון לטובת האינדקס הגבוה
            // יותר) תמיד מחזיר את העמוד השני (הימני) בשורה. בלי התיקון הזה, הפחתה של 1 בלבד
            // הייתה נוחתת על העמוד השני-באותה-שורה - שיש לו את אותו top בדיוק, כך שהגלילה
            // בפועל לא זזה בכלל (delta=0), ולחיצות "הקודם" חוזרות תמיד לאותו idx ונתקעות
            // לצמיתות (אפשר להתקדם קדימה, אבל אי אפשר לחזור אחורה). הצעד הנכון לשורה קודמת הוא 2.
            const step = (currentSettings.twoColumnScroll && !currentSettings.isBookView) ? 2 : 1;

            // אם באמצע עמוד (לא בראש שלו בדיוק) - הלחיצה הראשונה על "הקודם" צריכה להחזיר לראש
            // אותו עמוד עצמו, לא לקפוץ לעמוד שלפניו - בדיוק כמו בקוראי PDF. רק אם כבר נמצאים
            // בראש העמוד הנוכחי, לחיצה נוספת עוברת בפועל לעמוד הקודם.
            const pages = previewArea.querySelectorAll('.print-page');
            const currentPage = pages[idx];
            if (currentPage) {
                const tolerance = 2;
                const currentPageTop = currentPage.getBoundingClientRect().top - previewArea.getBoundingClientRect().top;
                if (currentPageTop < -tolerance) {
                    scrollToPageInScrollView(idx);
                    return;
                }
            }

            scrollToPageInScrollView(Math.max(0, idx - step));
        }

        function closeAllTabs() {
            while (tabs.length > 0) {
                const closedTab = tabs.pop();
                // אותו ניקוי בדיוק כמו בסגירת טאב בודדת (ראו closeTab) - גם דגל הסגירה (כדי
                // שמשיכה/עימוד שעדיין רצים ברקע יעצרו מיד) וגם שני השדות הכבדים (officialToc/
                // footnotes) שספר גדול יכול להחזיק בהם הרבה זיכרון
                if (closedTab) {
                    closedTab._closed = true;
                    closedTab.officialToc = null;
                    closedTab.footnotes = null;
                }
            }
            activeTabIndex = -1;
            openNewBookTab();
        }

        // Ctrl+Tab / Ctrl+Shift+Tab (וגם Ctrl+חצים) - מעבר בין טאבים במעגליות
        function switchToAdjacentTab(delta) {
            if (tabs.length < 2 || activeTabIndex === -1) return;
            const nextIndex = (activeTabIndex + delta + tabs.length) % tabs.length;
            switchTab(nextIndex);
        }

        document.addEventListener('keydown', (e) => {
            if (isRecordingShortcut) {
                handleShortcutRecordingKeydown(e);
                return;
            }
            const shortcutModalOverlayEl = document.getElementById('shortcut-modal-overlay');
            if (shortcutModalOverlayEl && shortcutModalOverlayEl.classList.contains('open')) {
                if (e.key === 'Escape') closeShortcutModal();
                return;
            }
            const targetTag = (e.target && e.target.tagName || '').toLowerCase();
            const isTypingContext = targetTag === 'input' || targetTag === 'textarea' || (e.target && e.target.isContentEditable);

            // Ctrl+Shift+M - מסך מלא (במקום F11, עובד גם בתוך שדות טקסט)
            if (matchesShortcutAction(e, 'fullscreen')) {
                e.preventDefault();
                toggleFullscreen();
                return;
            }
            // Esc - יציאה ממסך מלא (גם אמיתי וגם מצב ה-CSS המדומה)
            if (e.key === 'Escape' && isInFullscreenMode()) {
                exitFullscreenMode();
                return;
            }
            // Ctrl + Shift + F / L / K - מעבר בין חיפוש / כותרות / דפים בפאנל הצד. אלו חייבים
            // להיבדק גם כאן, לפני בדיקת isTypingContext למטה: פתיחת הפאנל ממקדת (focus) את שדה
            // החיפוש/הסינון שבתוכו, כך שברגע שהפאנל כבר פתוח על אחת הלשוניות, ה-focus כבר נמצא
            // בתוך input - ובלי החריגה הזו isTypingContext היה חוסם את הקיצורים הללו בדיוק כשהם
            // הכי נחוצים: כדי לעבור מלשונית אחת לשנייה בזמן שהפאנל כבר פתוח.
            if (matchesShortcutAction(e, 'searchPanel')) {
                e.preventDefault();
                if (activeTabIndex !== -1 && tabs[activeTabIndex] && !tabs[activeTabIndex].isNewBookTab) {
                    openDrawer();
                    switchRailTab('search');
                }
                return;
            }
            if (matchesShortcutAction(e, 'headingsPanel')) {
                e.preventDefault();
                if (activeTabIndex !== -1 && tabs[activeTabIndex] && !tabs[activeTabIndex].isNewBookTab) {
                    openDrawer();
                    switchRailTab('nav', 'headings');
                }
                return;
            }
            if (matchesShortcutAction(e, 'pagesPanel')) {
                e.preventDefault();
                if (activeTabIndex !== -1 && tabs[activeTabIndex] && !tabs[activeTabIndex].isNewBookTab) {
                    openDrawer();
                    switchRailTab('pages');
                }
                return;
            }

            // Ctrl+Shift+B - התאמה לרוחב המסך
            if (matchesShortcutAction(e, 'fitWidth')) {
                e.preventDefault();
                fitToScreen('width');
                return;
            }
            // Ctrl+Shift+H - התאמה לגובה המסך
            if (matchesShortcutAction(e, 'fitHeight')) {
                e.preventDefault();
                fitToScreen('height');
                return;
            }
            // Ctrl+Shift+O - התאמה אוטומטית לגודל העמוד (לא רק רוחב ולא רק גובה, אלא מה שנכנס
            // במלואו משני הכיוונים בו-זמנית) - אין כפתור ייעודי לפעולה זו בסרגל הכלים
            if (matchesShortcutAction(e, 'fitPage')) {
                e.preventDefault();
                fitToScreen('page');
                return;
            }
            // Ctrl+Shift+S - מעבר בין תצוגת עמוד (גלילה) לתצוגת ספר דו-עמודי
            if (matchesShortcutAction(e, 'toggleBookView')) {
                e.preventDefault();
                toggleBookView();
                return;
            }
            // Ctrl+Shift+I - חזרה לתצוגה הרגילה במסך העיון
            if (matchesShortcutAction(e, 'returnNormal')) {
                e.preventDefault();
                returnToNormalReading();
                return;
            }
            // Ctrl+Shift+N - פתיחת טאב ספר חדש
            if (matchesShortcutAction(e, 'newBookTab')) {
                e.preventDefault();
                openNewBookTab();
                return;
            }
            // Ctrl+Shift+U - פתיחת/סגירת חלונית ההגדרות (טוגל: אם כבר פתוחה, הקיצור סוגר אותה)
            if (matchesShortcutAction(e, 'toggleSettings')) {
                e.preventDefault();
                const settingsPanel = document.querySelector('.settings-panel');
                if (settingsPanel && settingsPanel.classList.contains('open')) {
                    closeSettings();
                } else {
                    openSettings();
                }
                return;
            }
            // Ctrl+Shift+T - ריענון הטאב הנוכחי
            if (matchesShortcutAction(e, 'refreshTab')) {
                e.preventDefault();
                refreshCurrentTab();
                return;
            }
            // Ctrl+Shift+P - פתיחת חלונית ההדפסה/יצוא (רק אם כפתור ההדפסה פעיל, כלומר יש תוכן טעון)
            if (matchesShortcutAction(e, 'print')) {
                e.preventDefault();
                const printBtn = document.getElementById('btn-print');
                if (printBtn && !printBtn.disabled) openPrintExportModal();
                return;
            }

            // Ctrl+Tab / Ctrl+Shift+Tab - מעבר בין טאבים במעגליות. חייב להיבדק כאן, לפני בדיקת
            // isTypingContext למטה: בטאב "ספר חדש" הפוקוס נמצא באופן אוטומטי בתוך שדה החיפוש
            // (autofocus/focus מיידי), ובלי החריגה הזו isTypingContext היה חוסם את הקיצור בדיוק
            // כשעוברים לטאב כזה - וגורם לכך שצריך ללחוץ בתוך התוכן פעם אחת לפני שאפשר להמשיך לדפדף.
            if (matchesShortcutAction(e, 'nextTab')) {
                e.preventDefault();
                switchToAdjacentTab(1);
                return;
            }
            if (matchesShortcutAction(e, 'prevTab')) {
                e.preventDefault();
                switchToAdjacentTab(-1);
                return;
            }

            if (isTypingContext) return;

            // Ctrl + Shift + W - סגירת כל הטאבים
            if (matchesShortcutAction(e, 'closeAllTabs')) {
                e.preventDefault();
                closeAllTabs();
                return;
            }
            // Ctrl + W - סגירת הטאב הנוכחי
            if (matchesShortcutAction(e, 'closeTab')) {
                e.preventDefault();
                if (activeTabIndex !== -1) closeTab(activeTabIndex, { stopPropagation: () => {} });
                return;
            }

            // Ctrl + '+' / Ctrl + '=' - הגדלת זום | Ctrl + '-' - הקטנת זום
            if (matchesShortcutAction(e, 'zoomIn')) {
                e.preventDefault();
                zoomIn();
                return;
            }
            if (matchesShortcutAction(e, 'zoomOut')) {
                e.preventDefault();
                zoomOut();
                return;
            }

            // Ctrl+Home / Ctrl+End - לתחילת/סוף הספר (ניתנים להתאמה בהגדרות הקיצורים)
            if (!isTypingContext && activeTabIndex !== -1 && tabs[activeTabIndex] && !tabs[activeTabIndex].isNewBookTab) {
                if (matchesShortcutAction(e, 'bookStart')) {
                    e.preventDefault();
                    goToBookEdge('start');
                    return;
                }
                if (matchesShortcutAction(e, 'bookEnd')) {
                    e.preventDefault();
                    goToBookEdge('end');
                    return;
                }
            }

            // חצי מקלדת ימינה/שמאלה - דפדוף בין עמודים (גם בתצוגת ספר וגם בתצוגת גלילה)
            // ימינה = לכיוון תחילת הספר (אחורה), שמאלה = לכיוון סוף הספר (קדימה) - בהתאם לכיווניות RTL
            if (activeTabIndex !== -1 && tabs[activeTabIndex] && !tabs[activeTabIndex].isNewBookTab) {
                if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    if (currentSettings.isBookView) {
                        prevBookPage();
                    } else {
                        goToPrevPageScroll();
                    }
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    if (currentSettings.isBookView) {
                        nextBookPage();
                    } else {
                        goToNextPageScroll();
                    }
                } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    // חצי מקלדת מעלה/מטה - הזזה אנכית (פאן) של הספר, רק בתצוגת ספר וכשהוא
                    // חורג בפועל מגבולות המסך למעלה/למטה בזום הנוכחי (ראו panBookVertically).
                    // חשוב: אין כאן שום הזזה לצדדים - זו נשארת בדיוק כפי שהייתה, מוגבלת לחיצים
                    // ימינה/שמאלה בלבד, ולא מושפעת מהוספת הפאן האנכי הזה.
                    if (currentSettings.isBookView) {
                        const delta = (e.key === 'ArrowUp') ? BOOK_PAN_STEP_PX : -BOOK_PAN_STEP_PX;
                        if (panBookVertically(delta)) {
                            e.preventDefault();
                        }
                    }
                }
            }
        });
    /* ==========================================================================================
       === חלונית מפרשים בצד (הצגת המפרשים הפעילים על העמוד/העמודים המוצגים) ===
       עצמאית לחלוטין לכל טאב (state ~ isDrawerOpen), ולכן גם עצמאית מלאה בין שני חלוני התצוגה
       המפוצלת - כל חלונית מציגה את המפרשים של הטאב הפעיל שלה בלבד, בלי שום קשר לחלונית השנייה
       (בדיוק כמו כל שאר מצב הטאבים בקובץ הזה - כל חלון/iframe מריץ עותק נפרד ומלא של הסקריפט).

       ברירת המחדל לבחירת המפרשים (כשספר נטען לראשונה בטאב) מגיעה ממצב המפרשים הפעילים בטאב
       הקריאה הפתוח כרגע באוצריא (reader.getActiveCommentators) - רק אם יש חפיפה בין הרשימה שהיא
       מחזירה לבין מפרשי הספר הזה עצמו (ראו initCommentaryDataForTab). מרגע הטעינה, הבחירה עצמאית
       לגמרי בתוך התוסף ואינה מתעדכנת שוב אוטומטית - בדיוק כפי שהמשתמש ביקש.

       טווח השורות המוצג: תלוי בתצוגה הנוכחית (ראו getCurrentVisiblePrintPages) - עלה שלם (2
       עמודים) בתצוגת ספר, שורת רשת שלמה (2 עמודים) בתצוגת "שני עמודים בשורה", או עמוד בודד בכל
       תצוגה אחרת. הצגה לפי טקסט מסומן (בחירה) לא מומשה כרגע - הושארה לעתיד לפי בקשת המשתמש.
       ========================================================================================== */
