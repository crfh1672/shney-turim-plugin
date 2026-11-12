        function capturePositionState() {
            if (currentSettings.isBookView) {
                return { isBookView: true, leaf: currentLeaf };
            }
            return { isBookView: false, pageIndex: getScrollCurrentPage() };
        }

        function restorePositionState(state) {
            if (!state) return;
            if (state.isBookView && currentSettings.isBookView) {
                currentLeaf = state.leaf || 0;
                updateBookViewPages();
            } else if (!state.isBookView && !currentSettings.isBookView) {
                requestAnimationFrame(() => {
                    scrollToPageInScrollView(state.pageIndex || 0);
                });
            }
        }

        // שמירת מיקום "מוקדמת" לפני סידור מחדש של הספר (בעקבות שינוי הגדרה כמו גופן/עמודות/
        // שוליים) - במקום לחכות לסיום המלא של הסידור לפני שחוזרים למיקום (כמו restorePositionState
        // הישנה), משתמשים באותו מנגנון בדיוק שכבר קיים לקפיצה למיקום בטעינת ספר מקישור חיצוני/
        // תוצאת חיפוש (pendingScrollLineIndex + tryEarlyPendingScrollJump, ב-paginateContent) -
        // כך שהחזרה למיקום קורית כבר ברגע שהסידור ברקע מגיע לשורה הזו, ולא רק בסיומו המלא.
        // מחזירה גם posState "ישן" (עמוד/עלה) כגיבוי, ליד המקרה הנדיר שבו השורה עצמה כבר לא
        // קיימת בתוכן המחודש (ואז finishPositionRestore נופלת חזרה לשחזור הישן).
        function beginEarlyPositionRestore(targetTab) {
            const posState = capturePositionState();
            const lineIdx = getCurrentDisplayedLineIndex();
            if (typeof lineIdx === 'number') {
                targetTab.pendingScrollLineIndex = lineIdx;
            }
            return posState;
        }

        // נקראת אחרי סיום מלא של paginateContent. אם pendingScrollLineIndex עדיין מוגדר בשלב
        // הזה, סימן שהקפיצה המוקדמת (tryEarlyPendingScrollJump) מעולם לא הצליחה לאתר את השורה
        // בפועל - נופלים חזרה לשחזור הישן מבוסס עמוד/עלה, כדי לא להישאר בלי שום שחזור מיקום.
        function finishPositionRestore(targetTab, posState) {
            if (typeof targetTab.pendingScrollLineIndex === 'number') {
                targetTab.pendingScrollLineIndex = null;
                restorePositionState(posState);
            }
        }

        function triggerRepagination() {
            clearTimeout(repaginateTimer);
            const targetTabIndex = activeTabIndex;
            const currentTab = tabs[targetTabIndex];
            if (!currentTab || !currentTab.rawContent) return;

            repaginateTimer = setTimeout(async () => {
                if (activeTabIndex !== targetTabIndex) return;
                const posState = beginEarlyPositionRestore(currentTab);
                await paginateContent(currentTab.rawContent, targetTabIndex);
                if (activeTabIndex !== targetTabIndex) return;
                buildTOC();
                finishPositionRestore(currentTab, posState);
            }, 500);
        }

        // גרסה מיידית (כמעט ללא השהיה) של triggerRepagination - מיועדת להגדרות "טוגל" חד-פעמיות
        // (הסתר ניקוד/טעמים/פיסוק, שמות קדושים, כותרת עליונה) שאינן זקוקות ל-debounce ארוך כמו
        // מחוונים (sliders) שנגררים ברצף. ה-500ms של triggerRepagination הרגילה יצרו מירוץ אמיתי:
        // אם המשתמש הפעיל טוגל ומיד לאחר מכן חיפש בספר (שיש לו debounce משלו של 500ms), החיפוש
        // עלול לרוץ על ה-DOM הישן (עדיין עם ניקוד, למשל) לפני שהעימוד מחדש הספיק להסתיים - למרות
        // שההגדרה עצמה כבר סומנה כפעילה. השהיה כמעט אפסית (setTimeout 0) עדיין מאפשרת ל-UI
        // (הטוגל עצמו) להתעדכן קודם, אך לא משאירה חלון זמן ממשי למירוץ מול חיפוש.
        function triggerRepaginationFast() {
            clearTimeout(repaginateTimer);
            const targetTabIndex = activeTabIndex;
            const currentTab = tabs[targetTabIndex];
            if (!currentTab || !currentTab.rawContent) return;

            repaginateTimer = setTimeout(async () => {
                if (activeTabIndex !== targetTabIndex) return;
                const posState = beginEarlyPositionRestore(currentTab);
                await paginateContent(currentTab.rawContent, targetTabIndex);
                if (activeTabIndex !== targetTabIndex) return;
                buildTOC();
                finishPositionRestore(currentTab, posState);
            }, 0);
        }

        function renderTabs() {
            // כל מופע מכיל ספר אחד בלבד - אין צורך בסרגל טאבים
            const container = document.getElementById('plugin-tabs');
            container.innerHTML = '';
            const tabBarOuter = document.querySelector('.tab-bar-outer');
            if (tabBarOuter) tabBarOuter.style.display = 'none';
        }

        // הגבלת זיכרון (MRU): מחזיקים תוכן מלא בזיכרון (DOM חי + rawContent + cachedPreview) רק
        // לכמה הטאבים האחרונים שבאמת ביקרנו בהם. טאב "ישן" שנופל מהרשימה משוחרר לגמרי מהזיכרון -
        // כשחוזרים אליו הוא נטען מחדש מהספרייה (בדיוק כמו טאב חדש), במחיר טעינה מחדש חד-פעמית
        // תמורת לא לצבור בלי גבול תוכן של כל ספר שנפתח אי-פעם באותה הפעלה. הועלה מ-5 ל-30 כדי
        // שבשימוש רגיל (אפילו הרבה טאבים פתוחים) המעבר תמיד יהיה מיידי; התקרה נשארת קיימת רק כרשת
        // ביטחון למקרי קיצון אמיתיים (עשרות ספרים ענקיים שנפתחו ברצף באותה הפעלה).
        let recentlyVisitedTabIds = [];
        const MAX_TABS_KEPT_IN_MEMORY = 30;

        function trackCachedFragmentUsage(tabId) {
            recentlyVisitedTabIds = recentlyVisitedTabIds.filter(id => id !== tabId);
            recentlyVisitedTabIds.unshift(tabId);
            if (recentlyVisitedTabIds.length > MAX_TABS_KEPT_IN_MEMORY) {
                const evicted = recentlyVisitedTabIds.slice(MAX_TABS_KEPT_IN_MEMORY);
                recentlyVisitedTabIds = recentlyVisitedTabIds.slice(0, MAX_TABS_KEPT_IN_MEMORY);
                evicted.forEach(id => {
                    const t = tabs.find(tab => tab.id === id);
                    if (!t) return;
                    t.cachedPreviewFragment = null;
                    t.cachedBookViewFragment = null;
                    t.cachedPreview = null;
                    t.rawContent = "";
                    t.pagesRendered = false;
                });
            }
        }

function switchTab(index) {
            if (index === activeTabIndex) return;
            
            clearTimeout(fontSizeChangeTimer);
            
            if (activeTabIndex !== -1) {
                const prevTab = tabs[activeTabIndex];
                const previewAreaForReset = document.getElementById('preview-area');

                // איפוס מצב חיפוש-בספר לפני עזיבת הטאב: קודם משחזרים תוכן נקי אם הייתה הדגשה פעילה
                // (אחרת ה-<mark> של ההדגשה "יאפו" לצמיתות לתוך המטמון של הטאב), ואז מוחקים את הדגל
                // עצמו - dataset.searchBaseHtml נשאר דבוק ל-#preview-area (תכונה על האלמנט עצמו, לא
                // נמחקת בהחלפת innerHTML/childNodes) - בלעדי האיפוס הזה חיפוש בטאב החדש היה עלול
                // "לשחזר" בטעות את תוכן הטאב הישן ולחפש רק בו לנצח.
                clearSearchHighlights();
                delete previewAreaForReset.dataset.searchBaseHtml;
                const bookSearchInput = document.getElementById('book-search');
                if (bookSearchInput) bookSearchInput.value = '';
                const searchResultsList = document.getElementById('search-results-list');
                if (searchResultsList) searchResultsList.innerHTML = '<div class="search-empty">הקלד מילה לחיפוש בתוכן הספר. התוצאות יופיעו כאן עם נתיב הכותרות והקשר סביב המילה.</div>';
                // איפוס מעקב התוצאות (הבא/הקודם) - אחרת יישארו הפניות לאלמנטים מהטאב הקודם
                currentSearchResults = [];
                currentSearchResultIndex = -1;
                updateSearchResultCount();

                if (prevTab && !prevTab.isNewBookTab) {
                    tabs[activeTabIndex].cols = document.getElementById('column-selector').value;
                    const rawFs = getComputedStyle(document.documentElement).getPropertyValue('--font-size-book').trim();
                    const fsNum = parseFloat(rawFs) || 14;
                    // נורמליזציה ליחידת pt תמיד, ללא קשר ליחידה שהוזרקה בפועל (px/pt), כדי למנוע קפיצות גודל
                    prevTab.fontSize = rawFs.endsWith('px') ? Math.round(fsNum * 0.75 * 10) / 10 : fsNum;
                }
                // שמירת מיקום חכמה של הטאב הנוכחי לפני עזיבתו - חייב לקרות לפני העברת ה-DOM (למטה),
                // כי getScrollCurrentPage/previewArea.scrollTop דורשים שהעמודים עדיין יהיו בפועל בתוך המסך
                const previewArea = document.getElementById('preview-area');
                if (prevTab && !prevTab.isNewBookTab) {
                    const panel = document.querySelector('.overlay-panel');
                    prevTab.isDrawerOpen = panel ? panel.classList.contains('open') : false;

                    // שמירת המיקום המדויק בהתאם למצב הנוכחי
                    if (currentSettings.isBookView) {
                        prevTab.savedPageIndex = currentLeaf * 2;
                        prevTab.currentLeaf = currentLeaf;
                        // שמירת ההיסט האנכי (פאן) של תצוגת הספר עבור הטאב הזה בלבד - כך שהוא לא
                        // "יידבק" ויושפע גם על טאבים אחרים (ראו שחזור מקביל בהמשך switchTab)
                        prevTab.bookPanY = bookPanY;
                    } else {
                        prevTab.savedPageIndex = getScrollCurrentPage();
                        prevTab.scrollPosition = previewArea.scrollTop;
                    }
                }

                // מעבר טאב מהיר בתצוגת גלילה: אם הטאב שעוזבים סיים להיטען, מעבירים את צמתי
                // ה-DOM החיים שלו (לא ממחרזים/מפרסרים!) לפרגמנט מנותק, כדי שהכניסה הבאה לטאב
                // הזה תהיה מיידית. משאירים גם את cachedPreview (המחרוזת) כגיבוי - נחוץ למקרה שבין
                // העזיבה לחזרה שונה מצב התצוגה (גלילה/ספר) בטאב אחר, ואז המסלול המהיר לא יתאים.
                if (prevTab && !prevTab.isNewBookTab && prevTab.pagesRendered && !currentSettings.isBookView) {
                    const frag = document.createDocumentFragment();
                    while (previewAreaForReset.firstChild) frag.appendChild(previewAreaForReset.firstChild);
                    prevTab.cachedPreviewFragment = frag;
                    trackCachedFragmentUsage(prevTab.id);
                } else if (prevTab && !prevTab.isNewBookTab && prevTab.pagesRendered && currentSettings.isBookView) {
                    // אותו רעיון בדיוק, עבור תצוגת ספר דו-עמודי: שומרים את ה-DOM החי של
                    // book-wrapper (כולל כל ה"עלים"/endpapers שכבר נבנו) בפרגמנט מנותק משלו
                    // (cachedBookViewFragment - שדה נפרד מ-cachedPreviewFragment, כי אלו שני ייצוגי
                    // DOM שונים לחלוטין של אותו תוכן), כדי שכניסה חוזרת לטאב הזה באותה תצוגה תהיה
                    // מיידית - בלי לבנות מחדש (buildBookDOM) מתוך מחרוזת ה-HTML מאפס בכל פעם.
                    const bookFrag = document.createDocumentFragment();
                    while (previewAreaForReset.firstChild) bookFrag.appendChild(previewAreaForReset.firstChild);
                    prevTab.cachedBookViewFragment = bookFrag;
                    trackCachedFragmentUsage(prevTab.id);
                }
            }

            document.getElementById('pagination-banner').classList.remove('visible');

            activeTabIndex = index;
            const tab = tabs[index];
            updateNavPaneTitle();
            tab.isDrawerOpen = tab.isDrawerOpen ?? getTabDrawerOpen(tab.id);

            // שחזור מצב סרגל הניווט עבור הטאב החדש
            const panel = document.querySelector('.overlay-panel');
            if (panel) {
                // זמנית נשבית אנימציות כדי למנוע הבהוב במעבר בין טאבים
                panel.style.transition = 'none';
                if (tab.isNewBookTab || !tab.isDrawerOpen) {
                    panel.classList.remove('open');
                } else {
                    panel.classList.add('open');
                }
                // נחזיר את האנימציות לאחר זמן קצר
                requestAnimationFrame(() => {
                    panel.style.transition = '';
                });
            }
            updateNavigationPanelLayout();

            // החלפת toolbar בהתאם לסוג הטאב
            if (tab.isNewBookTab) {
                document.querySelector('.toolbar:not(#new-book-toolbar)').style.display = 'none';
                document.getElementById('new-book-toolbar').style.display = '';
            } else {
                document.getElementById('new-book-toolbar').style.display = 'none';
                document.querySelector('.toolbar:not(#new-book-toolbar)').style.display = '';
                
                document.getElementById('column-selector').value = tab.cols || "2";
                document.getElementById('column-toggle-label').innerText = tab.cols === '1' ? 'טור 1' : tab.cols === '3' ? '3 טורים' : '2 טורים';
                document.documentElement.style.setProperty('--cols', tab.cols || "2");
                
                const currentFontSize = tab.fontSize || 14;
                document.documentElement.style.setProperty('--font-size-book', currentFontSize + 'pt');
                
                const fsInput = document.getElementById('setting-font-size');
                const fsVal = document.getElementById('setting-font-size-val');
                if (fsInput && fsVal) {
                    fsInput.value = currentFontSize;
                    fsVal.innerText = currentFontSize + 'pt';
                }
            }
            
const previewArea = document.getElementById('preview-area');
            // ניקוי אחיד ובטוח - בין אם הטאב הקודם השאיר פרגמנט "לקוח" (ראה למעלה), טאב-ספר-חדש,
            // או תוכן שעדיין בטעינה ברקע; המסלולים למטה מניחים preview-area ריק לפני הכנסת התוכן.
            previewArea.innerHTML = '';

            if (!tab.isNewBookTab && !currentSettings.isBookView && tab.cachedPreviewFragment && tab.cachedPreviewFragment.childNodes.length > 0) {
                // מסלול מהיר (תצוגת גלילה): מכניסים בחזרה את צמתי ה-DOM החיים שכבר נבנו בעבר
                // לטאב הזה - בלי לפרסר HTML מחדש. זה מה שהופך מעבר בין טאבים שכבר נטענו למיידי
                // במקום "כמה שניות".
                previewArea.appendChild(tab.cachedPreviewFragment);
                document.getElementById('btn-print').disabled = false;
                buildTOC();

                // שחזור מיקום הגלילה מיד, ללא המתנה לפריים נוסף (requestAnimationFrame) - מדידת
                // המיקום דרך getBoundingClientRect (בתוך scrollToPageInScrollView) בין כה וכה
                // מכריחה את הדפדפן לבצע reflow מיידי ברגע הקריאה, כך שאין שום יתרון בהמתנה לפריים
                // נוסף - רק עיכוב מיותר שגרם למעבר טאבים בתצוגת גלילה להרגיש איטי יותר מאשר
                // בתצוגת ספר (שם השחזור כבר קורה באופן מיידי וסינכרוני).
                const originalBehavior = previewArea.style.scrollBehavior;
                previewArea.style.scrollBehavior = 'auto';
                if (tab.savedPageIndex !== undefined) {
                    scrollToPageInScrollView(tab.savedPageIndex);
                } else {
                    previewArea.scrollTop = tab.scrollPosition || 0;
                }
                previewArea.style.scrollBehavior = originalBehavior;
            } else if (!tab.isNewBookTab && currentSettings.isBookView && tab.cachedBookViewFragment && tab.cachedBookViewFragment.childNodes.length > 0) {
                // מסלול מהיר (תצוגת ספר דו-עמודי) - אותו רעיון בדיוק: מכניסים בחזרה את ה-DOM החי
                // של book-wrapper (עלים/endpapers) שכבר נבנה בעבר לטאב הזה, בלי לבנות אותו מחדש
                // (buildBookDOM) מתוך מחרוזת ה-HTML. אם הפרגמנט הזה לא זמין (למשל כי הטאב נשמר
                // בפעם האחרונה בתצוגת גלילה, לא בתצוגת ספר) - נופלים בחזרה למסלול המבוסס-מחרוזת
                // הרגיל למטה, שכבר יודע לבנות את הספר מאפס במקרה כזה.
                previewArea.appendChild(tab.cachedBookViewFragment);
                document.getElementById('btn-print').disabled = false;
                buildTOC();
                currentLeaf = tab.currentLeaf || Math.floor((tab.savedPageIndex || 0) / 2);
                updateBookViewPages(true);
                restoreBookPanYForTabInstant(tab.bookPanY);
            } else if (tab.cachedPreview) {
                previewArea.innerHTML = tab.cachedPreview;
                document.getElementById('btn-print').disabled = tab.isNewBookTab;
                if (!tab.isNewBookTab) buildTOC();

                if (currentSettings.isBookView && !tab.isNewBookTab) {
                    buildBookDOM();
                    // שחזור העלה (Leaf) המדויק של הטאב החדש
                    currentLeaf = tab.currentLeaf || Math.floor((tab.savedPageIndex || 0) / 2);
                    updateBookViewPages(true);
                    restoreBookPanYForTabInstant(tab.bookPanY);
                } else {
                    // שחזור הגלילה של הטאב החדש בצורה מדויקת - מיידית וללא המתנה לפריים נוסף
                    // (ראו הסבר מפורט באותו תיקון במסלול המהיר למעלה)
                    const originalBehavior = previewArea.style.scrollBehavior;
                    previewArea.style.scrollBehavior = 'auto';
                    if (tab.savedPageIndex !== undefined) {
                        scrollToPageInScrollView(tab.savedPageIndex);
                    } else {
                        previewArea.scrollTop = tab.scrollPosition || 0;
                    }
                    previewArea.style.scrollBehavior = originalBehavior;
                }
            } else {
                if (tab.isNewBookTab) {
                    // טאב ספר חדש ללא תוכן - טוען מחדש
                    loadNewBookList();
                } else {
                    document.getElementById('pagination-banner').classList.add('visible');
                    previewArea.innerHTML = "";
                    document.getElementById('toc-list').innerHTML = "";
                    document.getElementById('btn-print').disabled = true;
                    // טאב אמיתי בלי תוכן בזיכרון בכלל (rawContent/cachedPreview שוחררו כי הוא "נשכח" -
                    // ראו trackCachedFragmentUsage) - טוענים אותו מחדש מהספרייה בדיוק כמו טאב חדש.
                    // טאב של קובץ חיצוני מוחרג: אין לו מקור בספרייה לחזור אליו.
                    if (tab.id && !tab.rawContent && !tab.isExternal) {
                        generateView();
                    }
                }
            }

            // שחזור מצב חלונית המפרשים עבור הטאב החדש (עצמאי לחלוטין לכל טאב, בדיוק כמו
            // isDrawerOpen של פאנל הניווט למעלה) - ראו applyCommentaryPanelStateForActiveTab
            applyCommentaryPanelStateForActiveTab();

            renderTabs();
        }

        function closeTab(index, e) {
            if (e && e.stopPropagation) e.stopPropagation();
            const wasActive = index === activeTabIndex;

            // סגירת טאב מוחקת את הזיכרון שלו לגמרי ומיידית (לא רק ניתוק הפניה שממתין ל-GC) -
            // בניגוד למעבר בין טאבים, ששומר במכוון DOM/טקסט של טאבים קודמים למעבר מהיר.
            const closedTab = tabs[index];
            if (closedTab) {
                // מסמנים את הטאב כסגור *לפני* כל ניקוי אחר - אובייקט הטאב עצמו (בניגוד לאינדקס
                // שלו במערך tabs) ממשיך להיות מוחזק בחיים דרך closures של כל משיכה/עימוד אסינכרוני
                // שעדיין רץ עליו ברקע (fetchEntireBook/generateView/paginateContent). הדגל הזה הוא
                // מה שמאפשר לאותם תהליכי רקע לזהות, בנקודת הבדיקה הקרובה שלהם, שהטאב נסגר ולעצור
                // מיד - במקום להמשיך למשוך תוכן מהרשת ולעבד אותו לתוך טאב שכבר לא קיים.
                closedTab._closed = true;
                closedTab.cachedPreview = null;
                closedTab.cachedPreviewFragment = null;
                closedTab.cachedBookViewFragment = null;
                closedTab.rawContent = "";
                // שני שדות נוספים שיכולים להיות כבדים בספר גדול ולא נוקו קודם: תוכן העניינים
                // הרשמי (officialToc - יכול להכיל אלפי כותרות) ומילון הערות השוליים (footnotes -
                // טקסט מלא של כל הערה בספר). בלי הניקוי הזה, גם אחרי שה-DOM/הטקסט הראשי משוחררים,
                // האובייקטים הכבדים האלה עדיין תלויים על אובייקט הטאב עד שה-GC מגיע אליו בפועל -
                // וזו הסיבה שבספר גדול הזיכרון היה יורד רק חלקית אחרי סגירת הטאב, ולא חוזר לבסיס.
                closedTab.officialToc = null;
                closedTab.footnotes = null;
                recentlyVisitedTabIds = recentlyVisitedTabIds.filter(id => id !== closedTab.id);
            }

            // מצאתי דליפה נוספת, אמיתית ומשמעותית: מערך תוצאות החיפוש (currentSearchResults)
            // מחזיק הפניות ישירות לאלמנטי DOM בתוך תוכן הספר עצמו (result.element - ה-<mark>
            // המודגש). כשמחליפים טאב באופן רגיל (switchTab) יש בלוק שמאפס את זה - אבל למטה
            // closeTab מאפס את activeTabIndex ל- -1 *לפני* הקריאה ל-switchTab (כדי לאלץ מעבר גם
            // אם האינדקס "החדש" זהה למספרית לישן) - ולכן אותו בלוק ניקוי (שתלוי בבדיקת
            // activeTabIndex !== -1 בתחילת switchTab) פשוט לא רץ בכלל בסגירת הטאב הפעיל. התוצאה:
            // כל עוד קיימת ולו הפניה אחת חיה לתוך עץ ה-DOM שהיה שייך לספר (דרך .element ב-
            // currentSearchResults), כל עץ ה-DOM המקושר אליה (פרנטים/אחים, שיכולים להיות מאות
            // עמודים בספר גדול) נשאר "תפוס" ולא משתחרר ב-GC בכלל, לא משנה כמה זמן עובר. משחררים
            // כאן במפורש, אך ורק אם הטאב שנסגר היה הטאב הפעיל (כי רק תוכן של הטאב הפעיל יכול היה
            // להיות מוצג/מסומן בחיפוש) - כדי לא לפגוע בתוצאות חיפוש שכן שייכות לטאב אחר שנשאר פעיל.
            if (wasActive) {
                clearSearchHighlights();
                currentSearchResults = [];
                currentSearchResultIndex = -1;
                lastSearchedQuery = null;
            }

            tabs.splice(index, 1);

            if (tabs.length === 0) {
                activeTabIndex = -1;
                openNewBookTab();
                return;
            }

            if (wasActive) {
                // הטאב שנסגר הוא הטאב הפעיל - יש לבחור טאב סמוך (הבא, או האחרון אם היה אחרון)
                const newActive = Math.min(index, tabs.length - 1);
                activeTabIndex = -1;
                switchTab(newActive);
            } else if (index < activeTabIndex) {
                // טאב שנסגר היה לפני הטאב הפעיל במערך - יש להזיז את האינדקס אחורה בהתאם לשינוי
                activeTabIndex -= 1;
            }
            // אם הטאב שנסגר היה אחרי הטאב הפעיל - אין צורך בשינוי כלל

            renderTabs();
        }

        const tooltipEl = document.getElementById('global-tooltip');

        document.addEventListener('mouseover', (e) => {
            const target = e.target.closest('[data-tooltip]');
            if (!target) return;
            
            tooltipEl.textContent = target.getAttribute('data-tooltip');
            tooltipEl.classList.add('visible');
            
            const rect = target.getBoundingClientRect();
            let left = rect.left + (rect.width / 2) - (tooltipEl.offsetWidth / 2);
            let top = rect.bottom + 8;
            
            if (left < 8) left = 8;
            if (left + tooltipEl.offsetWidth > window.innerWidth - 8) {
                left = window.innerWidth - tooltipEl.offsetWidth - 8;
            }
            if (top + tooltipEl.offsetHeight > window.innerHeight - 8) {
                top = rect.top - tooltipEl.offsetHeight - 8;
            }
            
            tooltipEl.style.left = left + 'px';
            tooltipEl.style.top = top + 'px';
        });

        document.addEventListener('mouseout', (e) => {
            const target = e.target.closest('[data-tooltip]');
            if (!target) return;
            tooltipEl.classList.remove('visible');
        });

        document.addEventListener('mousedown', () => {
            tooltipEl.classList.remove('visible');
        });

        async function openNewBookTab() {
            // כל מופע של התוסף מכיל ספר אחד בלבד - מנקים כל טאב קיים לפני יצירת טאב חדש
            tabs = [];
            activeTabIndex = -1;
            
            tabs.push({ 
                id: `new-book-${Date.now()}`, 
                title: 'ספר חדש', 
                isNewBookTab: true,
                cachedPreview: null,
                rawContent: "",
                cols: "2",
                fontSize: currentSettings.fontSize || 14,
                isRendering: false,
                pagesRendered: false, 
                isDrawerOpen: false // ברירת מחדל: סרגל הניווט סגור בטאב חדש
            });
            
            switchTab(0);
            
            // טעינת רשימת הספרים
            await loadNewBookList();
        }

        async function loadNewBookList() {
            const previewArea = document.getElementById('preview-area');
            previewArea.innerHTML = `
                <div class="new-book-tab-content" id="new-book-tab-content">
                    <div class="new-book-tab-header">
                        <h2>בחר ספר לפתיחה</h2>
                        <p>בחר ספר מהרשימה כדי לפתוח אותו בטאב חדש</p>
                        <button type="button" class="btn-secondary open-external-btn" onclick="openExternalDocument()" data-tooltip="פתח קובץ Word / טקסט מהמחשב בתצוגת הטורים">
                            פתח קובץ Word מהמחשב
                        </button>
                        <input type="file" id="external-file-input" accept=".docx,.doc,.txt,.htm,.html" style="display:none;" onchange="handleExternalFileInput(event)">
                    </div>
                    <div class="new-book-search-wrapper">
                        <input type="text" id="new-book-search" placeholder="חיפוש ספר בכל ספריית אוצריא..." oninput="handleNewBookSearchInput()" onkeydown="handleNewBookSearchKeydown(event)" autofocus>
                        ${fluentIconHTML('search')}
                    </div>
                    <div class="new-book-grid" id="new-book-grid">
                        <div class="new-book-loading">מאתר ספרים פתוחים באוצריא...</div>
                    </div>
                    <div class="new-book-dedication">
                        <div class="new-book-dedication-text">זכות הלימוד מוקדש בל"נ לעלוי נשמתו הטהורה של הבה"ח מאיר בן יבדלחט"א אברהם הראל שאער זצ"ל</div>
                    </div>
                </div>
            `;

            // מיקוד מיידי בשורת החיפוש - גם בטאב הראשוני וגם בכל טאב "+" חדש
            document.getElementById('new-book-search')?.focus();

            try {
                const { data } = await Otzaria.call('reader.getCurrentState');
                const grid = document.getElementById('new-book-grid');
                if (!grid) return;

                if (data && data.openTabs && data.openTabs.length > 0) {
                    grid.innerHTML = '';
                    window._newBookList = data.openTabs;
                    renderNewBookGrid(data.openTabs);
                } else {
                    grid.innerHTML = '<div class="new-book-loading">אין ספרים פתוחים באוצריא כרגע.</div>';
                }
            } catch (err) {
                const grid = document.getElementById('new-book-grid');
                if (grid) grid.innerHTML = '<div class="new-book-error">שגיאה בטעינת הספרים.</div>';
            }
        }

        async function refreshNewBookList() {
            const grid = document.getElementById('new-book-grid');
            if (!grid) return;
            // אנימציית סיבוב על כפתור הריענון
            const btn = document.querySelector('#new-book-toolbar .icon-btn');
            if (btn) {
                btn.style.transition = 'transform 0.5s ease';
                btn.style.transform = 'rotate(360deg)';
                setTimeout(() => { btn.style.transition = ''; btn.style.transform = ''; }, 500);
            }
            grid.innerHTML = '<div class="new-book-loading">מרענן רשימת ספרים...</div>';
            try {
                const { data } = await Otzaria.call('reader.getCurrentState');
                if (!grid.isConnected) return;
                if (data && data.openTabs && data.openTabs.length > 0) {
                    grid.innerHTML = '';
                    window._newBookList = data.openTabs;
                    renderNewBookGrid(data.openTabs);
                    // שחזור חיפוש אם היה
                    const searchInput = document.getElementById('new-book-search');
                    if (searchInput && searchInput.value.trim()) handleNewBookSearchInput();
                } else {
                    grid.innerHTML = '<div class="new-book-loading">אין ספרים פתוחים באוצריא כרגע.</div>';
                }
            } catch (err) {
                if (grid.isConnected) grid.innerHTML = '<div class="new-book-error">שגיאה בטעינת הספרים.</div>';
            }
        }

        // התוסף יודע למשוך ולעמד ספרי טקסט רגילים, וכן ספרי Word (docx) אישיים שכבר נוספו
        // לספריית אוצריא (נבדק ואומת: library.getBookContent מחזיר עבורם טקסט תקין בדיוק כמו
        // ספר רגיל) - קבצי PDF וחלונית המפרשים אינם נתמכים (הניסיון למשוך אותם דרך
        // library.getBookContent פשוט נתקע) - ולכן מסוננים כבר כאן, לפני שהם בכלל מוצגים לבחירה.
        // הבדיקה כוללת כמה שמות שדה אפשריים (בהתאם למידע שסופק בפועל על הפריט) וגם נפילה-אחורה
        // על סיומת/שם הכותרת, כדי שהסינון יעבוד גם אם שם השדה המדויק שונה מהמשוער.
        function isFetchableLibraryItem(item) {
            if (!item) return false; if (item.toolId) return false;
            const type = (item.type || item.bookType || item.kind || item.tabType || '').toString().toLowerCase();
            // 'docx'/'doc' נכללים כאן במפורש - ספרי Word אישיים (כולל פורמט ה-doc הישן) נמשכים
            // ומעומדים כמו ספר טקסט רגיל
            if (type && type !== 'text' && type !== 'book' && type !== 'docx' && type !== 'doc') return false;
            if (item.isPdf || item.pdf) return false;
            if (item.isCommentary || item.isCommentator || item.isCommentators || item.isLinks || item.isLinksPanel) return false;
            // התוסף לא יודע למשוך תוצאות חיפוש (טאב "חיפוש" במסך העיון) - בדיוק כמו PDF/מפרשים,
            // מסננים אותו כבר כאן כדי שלא ינסה להימשך, לא יופיע ברשימת הבחירה, וגם לא ייטען
            // אוטומטית אם הוא הטאב הפעיל בזמן פתיחת התוסף (ראו syncToReaderCurrentBook למטה)
            if (item.isSearch || item.isSearchPanel || item.isSearchResults || item.isSearchTab) return false;
            if (type === 'search') return false;
            const label = (item.book || item.title || '').toString();
            if (/\.pdf$/i.test(label)) return false;
            if (label.includes('מפרשים')) return false;
            if (label.includes('חיפוש')) return false;
            return true;
        }

        function renderNewBookGrid(books) {
            const grid = document.getElementById('new-book-grid');
            if (!grid) return;
            newBookHighlightIndex = -1;
            grid.innerHTML = '';
            const filteredBooks = (books || []).filter(isFetchableLibraryItem);
            if (filteredBooks.length === 0) {
                grid.innerHTML = '<div class="new-book-loading">לא נמצאו ספרי טקסט זמינים.</div>';
                return;
            }
            filteredBooks.forEach(item => {
                const label = item.book || item.title || '';
                const card = document.createElement('div');
                card.className = 'new-book-card';
                card.setAttribute('data-book-name', label.toLowerCase());
                card.innerHTML = `
                    ${fluentIconHTML('book_open')}
                    <span></span>
                `;
                card.querySelector('span').textContent = label;
                card.onclick = () => {
                    openBookInNewInstance(item.bookId, label, undefined, item.bookUid);
                };
                grid.appendChild(card);
            });
        }

        let newBookHighlightIndex = -1;
        let newBookSearchTimer = null;

        async function handleNewBookSearchInput() {
            clearTimeout(newBookSearchTimer);
            const searchInput = document.getElementById('new-book-search');
            const query = searchInput ? searchInput.value.trim() : '';
            newBookHighlightIndex = -1;

            if (!query) {
                renderNewBookGrid(window._newBookList || []);
                return;
            }

            const grid = document.getElementById('new-book-grid');
            if (grid) grid.innerHTML = '<div class="new-book-loading">מחפש בספריית אוצריא...</div>';

            newBookSearchTimer = setTimeout(async () => {
                try {
                    const { data } = await Otzaria.call('library.findBooks', { query, limit: 100 });
                    const stillCurrent = document.getElementById('new-book-search')?.value.trim() === query;
                    if (!stillCurrent) return;
                    if (data && data.length > 0) {
                        renderNewBookGrid(data);
                    } else {
                        const g = document.getElementById('new-book-grid');
                        if (g) g.innerHTML = '<div class="new-book-loading">לא נמצאו ספרים תואמים.</div>';
                    }
                } catch (err) {
                    const g = document.getElementById('new-book-grid');
                    if (g) g.innerHTML = '<div class="new-book-error">שגיאה בחיפוש ספרים.</div>';
                }
            }, 300);
        }

        function handleNewBookSearchKeydown(e) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveNewBookHighlight(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveNewBookHighlight(-1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                activateHighlightedNewBookCard();
            }
        }

        function moveNewBookHighlight(delta) {
            const cards = Array.from(document.querySelectorAll('.new-book-card'));
            if (cards.length === 0) return;
            if (newBookHighlightIndex >= 0 && cards[newBookHighlightIndex]) {
                cards[newBookHighlightIndex].classList.remove('highlighted');
            }
            newBookHighlightIndex = (newBookHighlightIndex + delta + cards.length) % cards.length;
            const target = cards[newBookHighlightIndex];
            target.classList.add('highlighted');
            target.scrollIntoView({ block: 'nearest' });
        }

        function activateHighlightedNewBookCard() {
            const cards = Array.from(document.querySelectorAll('.new-book-card'));
            if (cards.length === 0) return;
            const target = newBookHighlightIndex >= 0 && cards[newBookHighlightIndex] ? cards[newBookHighlightIndex] : cards[0];
            target.click();
        }

        document.addEventListener('click', closeAllPopovers);
        document.querySelectorAll('.popover').forEach(pop => {
            pop.addEventListener('click', (e) => e.stopPropagation());
        });

        function closeAllPopovers() {
            const colPopover = document.getElementById('column-popover');
            if (colPopover) colPopover.classList.remove('open');
            const colToggle = document.getElementById('column-toggle');
            if (colToggle) colToggle.classList.remove('open');
            const moreMenu = document.getElementById('more-menu');
            if (moreMenu) moreMenu.classList.remove('open');
            const moreButton = document.getElementById('btn-more');
            if (moreButton) {
                moreButton.classList.remove('active');
                moreButton.setAttribute('aria-expanded', 'false');
            }
            const viewModeMenu = document.getElementById('view-mode-menu');
            if (viewModeMenu) viewModeMenu.classList.remove('open');
            const viewModeButton = document.getElementById('btn-book-toggle');
            if (viewModeButton) {
                viewModeButton.classList.remove('active');
                viewModeButton.setAttribute('aria-expanded', 'false');
            }
        }

        function positionViewModeMenu(button, menu) {
            const anchor = document.getElementById('view-mode-anchor') || button;
            const rect = anchor.getBoundingClientRect();
            const menuWidth = menu.offsetWidth;
            const menuHeight = menu.offsetHeight;
            const spaceLeft = rect.left;
            const spaceRight = window.innerWidth - rect.right;
            const opensLeft = spaceLeft > spaceRight ||
                (spaceLeft === spaceRight && getComputedStyle(button).direction === 'rtl');
            const spaceAbove = rect.top;
            const spaceBelow = window.innerHeight - rect.bottom;
            const opensBelow = spaceBelow >= menuHeight || spaceBelow >= spaceAbove;

            const preferredLeft = opensLeft ? rect.right - menuWidth : rect.left;
            const preferredTop = opensBelow ? rect.bottom + 4 : rect.top - menuHeight - 4;
            const maxLeft = Math.max(8, window.innerWidth - 8 - menuWidth);
            const maxTop = Math.max(8, window.innerHeight - 8 - menuHeight);
            menu.style.left = `${Math.max(8, Math.min(maxLeft, preferredLeft)) - rect.left}px`;
            menu.style.right = 'auto';
            menu.style.top = `${Math.max(8, Math.min(maxTop, preferredTop)) - rect.top}px`;
            menu.style.bottom = 'auto';
            menu.classList.toggle('opens-left', opensLeft);
            menu.classList.toggle('opens-above', !opensBelow);
        }

        function toggleViewModeMenu(e) {
            e.stopPropagation();
            const menu = document.getElementById('view-mode-menu');
            const button = document.getElementById('btn-book-toggle');
            if (!menu || !button) return;
            const wasOpen = menu.classList.contains('open');
            closeAllPopovers();
            if (!wasOpen) {
                positionViewModeMenu(button, menu);
                menu.classList.add('open');
                button.classList.add('active');
                button.setAttribute('aria-expanded', 'true');
            }
        }

        // תפריט שלוש הנקודות (בקצה השמאלי של הסרגל): הדפסת מסמך + מספר הטורים
        function toggleMoreMenu(e) {
            e.stopPropagation();
            const menu = document.getElementById('more-menu');
            if (!menu) return;
            const wasOpen = menu.classList.contains('open');
            closeAllPopovers();
            if (!wasOpen) {
                menu.classList.add('open');
                const button = document.getElementById('btn-more');
                if (button) {
                    button.classList.add('active');
                    button.setAttribute('aria-expanded', 'true');
                }
            }
        }

        // פתיחה/סגירה של רשימת בחירת מספר הטורים בתוך התפריט (התפריט עצמו נשאר פתוח)
        function toggleColumnPopover(e) {
            e.stopPropagation();
            const popover = document.getElementById('column-popover');
            const toggle = document.getElementById('column-toggle');
            const willOpen = !popover.classList.contains('open');
            popover.classList.toggle('open', willOpen);
            if (toggle) toggle.classList.toggle('open', willOpen);
        }

        function selectColumn(value) {
            const label = value === 1 ? 'טור 1' : value === 3 ? '3 טורים' : '2 טורים';
            document.getElementById('column-toggle-label').innerText = label;
            document.getElementById('column-selector').value = value;
            document.getElementById('column-selector').dataset.value = value;
            updateColumns(value);
            closeAllPopovers();
        }

        // targetLineIndex: אינדקס שורה (0-based, כמו currentIndex שמוחזר מ-reader.getCurrentState) -
        // כשמסופק, קופצים אליו ישירות - גם בטאב חדש (אחרי שהעימוד הראשוני מסתיים, ראו
        // generateView) וגם בטאב קיים (ראו למטה) - כדי לפתוח בדיוק במקום שבו היה המשתמש במסך
        // העיון הרגיל, ולא תמיד מעמוד א'/מהמיקום שבו הטאב נשאר בפעם הקודמת.
        // bookUid: המזהה היציב וחוצה-הספקים של הספר (כשידוע) - נשמר על הטאב כדי שכפתור "חזרה
        // לתצוגה הרגילה" יוכל להשתמש בו מול reader.openBook במקום להסתמך רק על bookId (כותרת),
        // שאינו מובטח ייחודי ועלול להתנגש בין שני ספרים בעלי אותו שם.
        // דף הבית של התוסף הוא מסך בחירת ספרים בלבד - פתיחת ספר פותחת מופע חדש
        async function openBookInNewInstance(bookId, bookTitle, targetLineIndex, bookUid) {
            try {
                await Otzaria.call('plugin.openSelf', {
                    newTab: true,
                    param: { bookId, bookTitle, targetLineIndex, bookUid }
                });
            } catch (e) {
                console.error('שני טורים: פתיחת מופע חדש נכשלה', e);
            }
        }

        function setBookSelection(id, title, targetLineIndex, bookUid) {
            const pendingScrollLineIndex = (typeof targetLineIndex === 'number' && targetLineIndex >= 0) ? targetLineIndex : null;

            const existingIdx = tabs.findIndex(t => t.id === id);
            if (existingIdx !== -1) {
                // ספר קיים - משלימים bookUid אם הוא עכשיו ידוע ועדיין חסר על הטאב הקיים
                if (bookUid && !tabs[existingIdx].bookUid) tabs[existingIdx].bookUid = bookUid;

                if (pendingScrollLineIndex !== null) {
                    // שומרים על הטאב תמיד - אם התוכן עדיין לא בזיכרון (פונה מחדש ברקע דרך
                    // switchTab/generateView), הקפיצה תתבצע משם בסיום העימוד בדיוק כמו בטאב חדש
                    tabs[existingIdx].pendingScrollLineIndex = pendingScrollLineIndex;
                }

                switchTab(existingIdx);

                // אם התוכן כבר קיים בזיכרון (pagesRendered) - switchTab לא קורא ל-generateView
                // בכלל, ולכן הקפיצה לא הייתה מתבצעת מעצמה; מבצעים אותה כאן במפורש, אחרי שה-DOM
                // של הטאב כבר במקום (ה-requestAnimationFrame נותן ללייאאוט להתייצב לפני המדידה).
                if (pendingScrollLineIndex !== null && tabs[existingIdx].pagesRendered) {
                    tabs[existingIdx].pendingScrollLineIndex = null;
                    requestAnimationFrame(() => {
                        const pageIdx = locatePageIndexForLineIndex(pendingScrollLineIndex);
                        if (pageIdx >= 0) goToPageIndex(pageIdx);
                    });
                }
                return;
            }

            // ספר חדש נבחר - בדוק אם נבחר מתוך טאב "ספר חדש"
            const currentTab = tabs[activeTabIndex];
            if (currentTab && currentTab.isNewBookTab) {
                // מחליפים את טאב "ספר חדש" בספר החדש
                tabs[activeTabIndex] = {
                    id,
                    title,
                    cachedPreview: null,
                    rawContent: "",
                    cols: "2",
                    fontSize: currentSettings.fontSize || 14,
                    isRendering: false,
                    pagesRendered: false,
                    pendingScrollLineIndex,
                    bookUid: bookUid || null
                };
                // אילוץ עדכון - מאפסים את activeTabIndex ואז קוראים לswitchTab
                const targetIndex = activeTabIndex;
                activeTabIndex = -1;
                // switchTab עצמו כבר קורא ל-generateView בסיומו (הטאב טרי, ללא rawContent) - קריאה
                // נוספת כאן הייתה מפעילה שתי הרצות משיכה/עימוד מקבילות על אותו טאב בדיוק, מה
                // שגרם למירוץ: ההרצה ה"מפסידה" (שמבוטלת באמצע דרך paginationToken של הטאב) עדיין
                // מגיעה ראשונה לבדיקת pendingScrollLineIndex, מאפסת אותה מוקדם מדי מול DOM חלקי
                // בלבד - ולכן הקפיצה למיקום המדויק תמיד נחתה קרוב לתחילת הספר בפתיחה ראשונה.
                switchTab(targetIndex);
            } else {
                // כל מופע מכיל ספר אחד בלבד - מחליפים את הטאב הנוכחי בספר החדש
                tabs = [{ id, title, cachedPreview: null, rawContent: "", cols: "2", fontSize: currentSettings.fontSize || 14, isRendering: false, pagesRendered: false, pendingScrollLineIndex, bookUid: bookUid || null }];
                activeTabIndex = -1;
                // ראו הערה מעל - switchTab כבר קורא ל-generateView בעצמו, אין לקרוא לה שוב כאן
                switchTab(0);
            }
        }

        function scheduleFontUpdate() {
            clearTimeout(fontSizeChangeTimer);
            const targetTabIndex = activeTabIndex;
            const currentTab = tabs[targetTabIndex];
            if (!currentTab || !currentTab.rawContent) return;

            fontSizeChangeTimer = setTimeout(async () => {
                if (activeTabIndex !== targetTabIndex) return;
                const posState = beginEarlyPositionRestore(currentTab);
                await paginateContent(currentTab.rawContent, targetTabIndex);
                if (activeTabIndex !== targetTabIndex) return;
                buildTOC();
                finishPositionRestore(currentTab, posState);
            }, 600);
        }

        function updateColumns(val) {
            document.documentElement.style.setProperty('--cols', val);
            document.getElementById('column-toggle-label').innerText = val === '1' || val === 1 ? 'טור 1' : val === '3' || val === 3 ? '3 טורים' : '2 טורים';
            const targetTabIndex = activeTabIndex;
            const currentTab = tabs[targetTabIndex];
            if (currentTab) currentTab.cols = String(val);
            
            if (currentTab && currentTab.rawContent) {
                const posState = beginEarlyPositionRestore(currentTab);

                setTimeout(async () => {
                    await paginateContent(currentTab.rawContent, targetTabIndex);
                    if (targetTabIndex !== activeTabIndex) return;
                    buildTOC();
                    finishPositionRestore(currentTab, posState);
                }, 50);
            }
        }

        function toggleDrawer() {
            const panel = document.querySelector('.overlay-panel');
            if (panel && panel.classList.contains('open')) {
                closeDrawer();
            } else {
                openDrawer();
            }
        }

        function openDrawer() {
            const panel = document.querySelector('.overlay-panel');
            // סגירת הגדרות אם פתוחות
            document.querySelector('.settings-panel').classList.remove('open');
            document.querySelector('.overlay-scrim').classList.remove('settings-open'); // ניווט — ללא scrim
            panel.classList.add('open');
            updateNavigationPanelLayout();
            if (activeTabIndex !== -1 && tabs[activeTabIndex]) {
                tabs[activeTabIndex].isDrawerOpen = true;
                setTabDrawerOpen(tabs[activeTabIndex].id, true);
            }
        }

        function openSettings() {
            const scrim = document.querySelector('.overlay-scrim');
            const panel = document.querySelector('.settings-panel');
            // סגירת ניווט אם פתוח - אך לא אם הוא נעוץ (isPinned); פאנל נעוץ אמור להישאר פתוח
            // (במצב "פתוח") גם כשפותחים את ההגדרות - הוא פשוט מוצג מתחת לשכבת ה-scrim המחשיכה
            // בדיוק כמו שאר התוכן שמאחורי חלונית ההגדרות, ולא מבטל את מה שהיה פתוח בו
            if (!isPinned) {
                document.querySelector('.overlay-panel').classList.remove('open');
                if (activeTabIndex !== -1 && tabs[activeTabIndex]) {
                    tabs[activeTabIndex].isDrawerOpen = false;
                    setTabDrawerOpen(tabs[activeTabIndex].id, false);
                }
            }
            scrim.classList.add('settings-open'); // הגדרות — עם scrim
            panel.classList.add('open');
            updateNavigationPanelLayout();
        }

        function closeAllDrawers() {
            // סגירה של ניווט בלבד - הגדרות נשארות עם pinned mode
            document.querySelector('.overlay-scrim').classList.remove('settings-open');
            document.querySelector('.overlay-panel').classList.remove('open');
            if (activeTabIndex !== -1 && tabs[activeTabIndex]) {
                tabs[activeTabIndex].isDrawerOpen = false;
                setTabDrawerOpen(tabs[activeTabIndex].id, false);
            }
            updateNavigationPanelLayout();
        }

        function closeDrawer() {
            // סגירת ניווט בלבד — ה-scrim לא קשור לניווט
            document.querySelector('.overlay-panel').classList.remove('open');
            if (activeTabIndex !== -1 && tabs[activeTabIndex]) {
                tabs[activeTabIndex].isDrawerOpen = false;
                setTabDrawerOpen(tabs[activeTabIndex].id, false);
            }
            updateNavigationPanelLayout();
        }

        function closeSettings() {
            // סגירת הגדרות בלבד
            document.querySelector('.overlay-scrim').classList.remove('settings-open');
            document.querySelector('.settings-panel').classList.remove('open');
        }

        function closeSettingsOnly() {
            // סגירת הגדרות בלחיצה על scrim (לא ניווט)
            const settingsPanel = document.querySelector('.settings-panel');
            if (settingsPanel.classList.contains('open')) {
                closeSettings();
            }
        }

        const previewArea = document.getElementById('preview-area');
        let isScrollingFromTOC = false;
        
        if (previewArea) {
            previewArea.addEventListener('wheel', (e) => {
                if (isScrollingFromTOC || isPinned) return;
                // סגירת ניווט בגלילה (לא הגדרות) - אלא אם הפאנל נעוץ
                closeDrawer();
            }, { passive: true });

            previewArea.addEventListener('scroll', () => {
                if (isScrollingFromTOC || isPinned) return;
                // סגירת ניווט בגלילה (לא הגדרות) - אלא אם הפאנל נעוץ
                closeDrawer();
            }, { passive: true });

            // היפוך כיוון הגלילה האופקית במחוות מגע דו-אצבעית (טאצ'פד) בתצוגת עמוד רגילה,
            // כשהעמוד רחב יותר מהמסך וניתן לגלול אופקית - הכיוון הטבעי יצא הפוך, ולכן מיירטים
            // כאן ומיישמים בעצמנו את הכיוון ההפוך למה שהדפדפן היה עושה כברירת מחדל
            previewArea.addEventListener('wheel', (e) => {
                if (currentSettings.isBookView) return; // בתצוגת ספר אין גלילה אופקית כלל
                if (e.deltaX === 0) return; // גלילה אנכית רגילה - לא נוגעים בה
                if (previewArea.scrollWidth <= previewArea.clientWidth) return; // אין חריגה אופקית לגלול בה
                e.preventDefault();
                // #preview-area מוגדר עם scroll-behavior:smooth (לצורך ניווט/קפיצות אחרות) - אבל
                // זה גורם לכל עדכון scrollLeft כאן להתחיל אנימציה חדשה שמתנגשת עם קודמתה, ויוצר
                // תנועה מקוטעת ולא זורמת בזמן גלילה רציפה. משביתים זמנית כדי שהעדכון יהיה מיידי.
                const prevBehavior = previewArea.style.scrollBehavior;
                previewArea.style.scrollBehavior = 'auto';
                previewArea.scrollLeft -= e.deltaX;
                previewArea.style.scrollBehavior = prevBehavior;
            }, { passive: false });

            // רענון חלונית המפרשים תוך כדי גלילה (תצוגת גלילה רגילה/שני-עמודים-בשורה) - עם
            // דיבאונס כדי לא לשלוח בקשת רשת בכל פיקסל גלילה, רק כשהגלילה "נרגעת" לרגע. ראו
            // refreshCommentaryPanel - יש שם גם קאש לפי טווח, כך שגם אם זה נורה בטעות בלי
            // שהעמוד המוצג באמת השתנה, לא נשלחת בקשה מיותרת.
            previewArea.addEventListener('scroll', () => {
                if (activeTabIndex === -1 || !tabs[activeTabIndex] || !tabs[activeTabIndex].commentaryPanelOpen) return;
                clearTimeout(commentaryRefreshDebounceTimer);
                commentaryRefreshDebounceTimer = setTimeout(() => refreshCommentaryPanel(), 180);
            }, { passive: true });
        }

        let currentRailTab = 'nav';
        let navPanelWidth = 300;
        let navPanelResizeActive = false;

        function restoreNavPanelPreferences() {
            try {
                const savedWidth = Number(localStorage.getItem('advanced_print_nav_panel_width'));
                if (Number.isFinite(savedWidth) && savedWidth > 0) {
                    navPanelWidth = Math.min(600, Math.max(200, savedWidth));
                }
                isPinned = localStorage.getItem('advanced_print_nav_panel_pinned') === 'true';
            } catch (error) {
                console.warn('לא ניתן לטעון את הגדרות חלונית הניווט:', error);
            }
        }

        function updateNavigationPanelLayout() {
            const panel = document.getElementById('nav-panel');
            const mainContent = document.querySelector('.main-content');
            const scrim = document.getElementById('nav-panel-scrim');
            const corner = document.getElementById('nav-panel-corner');
            const toggle = document.getElementById('btn-drawer-toggle');
            const pinButton = document.getElementById('pin-btn');
            if (!panel || !mainContent || !scrim || !corner || !toggle || !pinButton) return;

            const isOpen = panel.classList.contains('open');
            const availableWidth = mainContent.clientWidth;
            const actualPanelWidth = Math.min(navPanelWidth, Math.max(0, availableWidth - 20));
            const pushLayout = navPanelResizeActive
                ? mainContent.classList.contains('nav-push-mode')
                : isOpen && isPinned && availableWidth >= actualPanelWidth + 200;

            panel.style.setProperty('--nav-panel-width', `${navPanelWidth}px`);
            mainContent.classList.toggle('nav-push-mode', pushLayout);
            scrim.classList.toggle('visible', isOpen && !pushLayout);
            corner.classList.toggle('visible', isOpen && pushLayout);
            corner.style.right = `${panel.getBoundingClientRect().width}px`;
            toggle.classList.toggle('active', isOpen);
            toggle.setAttribute('aria-expanded', String(isOpen));
            toggle.dataset.tooltip = isOpen ? 'הסתר ניווט' : 'הצג ניווט';
            pinButton.classList.toggle('visible', isOpen && availableWidth >= 500);
            pinButton.classList.toggle('pinned', isPinned);
            pinButton.setAttribute('aria-pressed', String(isPinned));
            pinButton.setAttribute('aria-label', isPinned ? 'בטל נעיצת חלונית הניווט' : 'נעץ את חלונית הניווט');
            pinButton.dataset.tooltip = isPinned ? 'בטל נעיצה' : 'נעץ את חלונית הניווט';
            updateFloatingTocSearch();
        }

        function setNavPanelWidth(width) {
            navPanelWidth = Math.min(600, Math.max(200, width));
            document.getElementById('nav-panel').style.setProperty('--nav-panel-width', `${navPanelWidth}px`);
            updateNavigationPanelLayout();
        }

        function saveNavPanelPreferences() {
            try {
                localStorage.setItem('advanced_print_nav_panel_width', String(navPanelWidth));
                localStorage.setItem('advanced_print_nav_panel_pinned', String(isPinned));
            } catch (error) {
                console.warn('לא ניתן לשמור את הגדרות חלונית הניווט:', error);
            }
        }

        function initializeNavPanelResize() {
            const handle = document.getElementById('nav-panel-resize-handle');
            if (!handle) return;

            handle.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                const startX = event.clientX;
                const startWidth = navPanelWidth;
                navPanelResizeActive = true;
                handle.classList.add('dragging');
                updateNavigationPanelLayout();

                const onPointerMove = (moveEvent) => {
                    setNavPanelWidth(startWidth + startX - moveEvent.clientX);
                };
                const onPointerUp = () => {
                    document.removeEventListener('pointermove', onPointerMove);
                    document.removeEventListener('pointerup', onPointerUp);
                    document.removeEventListener('pointercancel', onPointerUp);
                    navPanelResizeActive = false;
                    handle.classList.remove('dragging');
                    updateNavigationPanelLayout();
                    saveNavPanelPreferences();
                };

                document.addEventListener('pointermove', onPointerMove);
                document.addEventListener('pointerup', onPointerUp);
                document.addEventListener('pointercancel', onPointerUp);
            });
        }

        restoreNavPanelPreferences();
        initializeNavPanelResize();
        window.addEventListener('resize', updateNavigationPanelLayout);
        window.addEventListener('resize', updateFloatingTocSearch);
        updateNavigationPanelLayout();

        function togglePin() {
            isPinned = !isPinned;
            saveNavPanelPreferences();
            updateNavigationPanelLayout();
        }

        function switchRailTab(tab, navSubTab) {
            if (tab === 'nav' && navSubTab === 'pages') tab = 'pages';
            currentRailTab = tab;
            document.querySelectorAll('.drawer-icon-btn[id^="rail-"]').forEach(btn => btn.classList.remove('active'));
            document.getElementById('rail-' + tab).classList.add('active');
            document.getElementById('drawer-pane-nav').classList.toggle('active', tab === 'nav');
            document.getElementById('drawer-pane-search').classList.toggle('active', tab === 'search');
            document.getElementById('drawer-pane-pages').classList.toggle('active', tab === 'pages');
            updateNavPaneTitle();
            if (tab === 'search') {
                document.getElementById('book-search').focus();
                searchInBook();
            } else if (tab === 'pages') {
                buildPageNav();
                filterPageNav();
                if (document.getElementById('drawer-search-pages').classList.contains('expanded')) {
                    document.getElementById('page-filter').focus();
                }
            } else {
                if (document.getElementById('toc-filter').value) {
                    document.getElementById('drawer-search-nav').classList.add('expanded');
                    setTocSearchToggleState(true);
                }
                if (document.getElementById('drawer-search-nav').classList.contains('expanded')) {
                    document.getElementById('toc-filter').focus();
                }
                if (document.getElementById('toc-filter').value) filterTOC();
            }
            requestAnimationFrame(updateFloatingTocSearch);
        }

        function openSearchFromToolbar() {
            const panel = document.querySelector('.overlay-panel');
            if (panel && !panel.classList.contains('open')) openDrawer();
            switchRailTab('search');
        }

        function updateNavPaneTitle() {
            const titleElement = document.getElementById('drawer-pane-nav-title');
            if (!titleElement) return;
            const activeTab = activeTabIndex >= 0 ? tabs[activeTabIndex] : null;
            const title = activeTab && !activeTab.isNewBookTab ? activeTab.title || '' : '';
            titleElement.textContent = title;
            if (title) titleElement.dataset.tooltip = title;
            else delete titleElement.dataset.tooltip;
        }

        function updateFloatingTocSearch() {
            const floatingToggle = document.getElementById('toc-search-toggle-floating');
            const titleToggle = document.getElementById('toc-search-toggle');
            const scrollArea = document.getElementById('toc-scroll-area');
            const panel = document.getElementById('nav-panel');
            if (!floatingToggle || !titleToggle || !scrollArea || !panel) return;

            const titleBounds = titleToggle.getBoundingClientRect();
            const scrollBounds = scrollArea.getBoundingClientRect();
            const titleCenter = titleBounds.top + titleBounds.height / 2;
            const titleIsVisible = titleCenter >= scrollBounds.top && titleCenter <= scrollBounds.bottom;
            const searchIsOpen = document.getElementById('drawer-search-nav').classList.contains('expanded');
            const showFloatingToggle = panel.classList.contains('open')
                && currentRailTab === 'nav'
                && !searchIsOpen
                && !titleIsVisible;
            floatingToggle.classList.toggle('visible', showFloatingToggle);
        }

        function setTocSearchToggleState(isOpen) {
            document.getElementById('drawer-pane-nav').classList.toggle('search-open', isOpen);
            ['toc-search-toggle', 'toc-search-toggle-floating'].forEach((id) => {
                const toggle = document.getElementById(id);
                toggle.dataset.tooltip = 'חיפוש סימניה...';
                toggle.setAttribute('aria-expanded', String(isOpen));
            });
        }

        const tocScrollArea = document.getElementById('toc-scroll-area');
        if (tocScrollArea) tocScrollArea.addEventListener('scroll', updateFloatingTocSearch, { passive: true });

        function toggleTocSearch() {
            const search = document.getElementById('drawer-search-nav');
            if (search.classList.contains('expanded')) {
                closeTocSearch();
                return;
            }
            search.classList.add('expanded');
            setTocSearchToggleState(true);
            document.getElementById('toc-filter').focus();
            updateFloatingTocSearch();
        }

        function closeTocSearch() {
            document.getElementById('drawer-search-nav').classList.remove('expanded');
            setTocSearchToggleState(false);
            const input = document.getElementById('toc-filter');
            input.value = '';
            filterTOC();
            requestAnimationFrame(() => {
                updateFloatingTocSearch();
                const floatingToggle = document.getElementById('toc-search-toggle-floating');
                const titleToggle = document.getElementById('toc-search-toggle');
                (floatingToggle.classList.contains('visible') ? floatingToggle : titleToggle).focus();
            });
        }

        function togglePageSearch() {
            const search = document.getElementById('drawer-search-pages');
            if (search.classList.contains('expanded')) {
                closePageSearch();
                return;
            }
            search.classList.add('expanded');
            const toggle = document.getElementById('page-search-toggle');
            toggle.dataset.tooltip = 'סגור איתור דפים';
            toggle.setAttribute('aria-expanded', 'true');
            document.getElementById('page-filter').focus();
        }

        function closePageSearch() {
            document.getElementById('drawer-search-pages').classList.remove('expanded');
            const toggle = document.getElementById('page-search-toggle');
            toggle.dataset.tooltip = 'עבור לדף לפי מספר';
            toggle.setAttribute('aria-expanded', 'false');
            document.getElementById('page-filter').value = '';
            filterPageNav();
            document.getElementById('page-search-toggle').focus();
        }

        // בניית רשימת ניווט לפי מספרי דפים - לחיצה על דף קופצת אליו ישירות, בלי תלות בכותרות
        function buildPageNav() {
            const previewArea = document.getElementById('preview-area');
            const listEl = document.getElementById('page-nav-list');
            if (!listEl) return;

            const pages = Array.from(previewArea.querySelectorAll('.print-page'));
            if (pages.length === 0) {
                listEl.innerHTML = '<div style="padding: 20px; color: var(--color-outline); text-align: center;">יש לטעון ספר כדי לראות רשימת דפים.</div>';
                return;
            }

            listEl.innerHTML = '';
            pages.forEach((pageEl, idx) => {
                const item = document.createElement('div');
                item.className = 'toc-item page-nav-item';
                const humanNum = idx + 1;
                item.dataset.pageNumber = String(humanNum);
                const gem = numToGematria(humanNum);
                item.innerHTML = `${fluentIconHTML('document_pdf')}<span class="toc-text">${gem} <span style="color: var(--color-on-surface-subtle); font-weight: 400;">(${humanNum})</span></span>`;
                item.onclick = () => goToPageIndex(idx);
                listEl.appendChild(item);
            });
            filterPageNav();
        }

        function filterPageNav() {
            const query = document.getElementById('page-filter').value.trim();
            document.querySelectorAll('#page-nav-list .page-nav-item').forEach((item) => {
                item.style.display = !query || item.dataset.pageNumber.includes(query) ? 'flex' : 'none';
            });
        }

        function handlePageNavKeydown(event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closePageSearch();
                return;
            }
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const pageNumber = parseInt(document.getElementById('page-filter').value.trim(), 10);
            if (Number.isInteger(pageNumber) && pageNumber > 0) {
                goToPageIndex(pageNumber - 1);
            }
        }

        // קפיצה ישירה לעמוד לפי אינדקס - תומך גם בתצוגת גלילה וגם בתצוגת ספר דו-עמודי
        function goToPageIndex(pageIndex) {
            const previewArea = document.getElementById('preview-area');
            const pages = Array.from(previewArea.querySelectorAll('.print-page'));
            if (pageIndex < 0 || pageIndex >= pages.length) return;

            isScrollingFromTOC = true;

            if (currentSettings.isBookView) {
                currentLeaf = Math.floor(pageIndex / 2) + (pageIndex % 2);
                updateBookViewPages(true);
            } else {
                scrollToPageInScrollView(pageIndex);
            }

            setTimeout(() => { isScrollingFromTOC = false; }, 1500);
            if (window.innerWidth < 800) closeAllDrawers();
        }

        // איתור אינדקס העמוד (בתוך העימוד הנוכחי) שמכיל שורה נתונה מהטקסט הגולמי (ראו data-line-idx
        // ב-fetchEntireBook) - מוצא את התכונה עם הערך הגדול ביותר שעדיין קטן/שווה ליעד, כדי לתמוד
        // גם ביעד שנופל על שורה ריקה שלא קיבלה תכונה משלה (למשל רווח בין פסקאות).
        function locatePageIndexForLineIndex(targetIdx) {
            const previewArea = document.getElementById('preview-area');
            const marked = Array.from(previewArea.querySelectorAll('[data-line-idx]'));
            if (marked.length === 0) return -1;

            let bestEl = null;
            let bestLineIdx = -1;
            marked.forEach((el) => {
                const idx = parseInt(el.getAttribute('data-line-idx'), 10);
                if (isNaN(idx) || idx > targetIdx) return;
                if (idx > bestLineIdx) {
                    bestLineIdx = idx;
                    bestEl = el;
                }
            });
            if (!bestEl) bestEl = marked[0]; // היעד נמצא לפני תחילת התוכן המסומן - פתח בעמוד הראשון

            const pageEl = bestEl.closest('.print-page');
            if (!pageEl) return -1;
            const pages = Array.from(previewArea.querySelectorAll('.print-page'));
            return pages.indexOf(pageEl);
        }

        // בדיקה שמופעלת אחרי כל "באץ'" במהלך העימוד ברקע (ראו paginateContent): האם התוכן
        // שכבר סודר עד כה (ונמצא בפועל ב-DOM) הגיע כבר לשורת היעד הממתינה (pendingScrollLineIndex),
        // ואם כן - קופצים אליה כבר עכשיו, בלי לחכות לסיום המלא של סידור הספר (שממשיך ברקע כרגיל
        // מייד אחרי, בדיוק כמו קודם). "הגענו לשם" נבדק לפי ה-data-line-idx המסומן האחרון שקיים
        // כרגע ב-DOM (הם מופיעים לפי סדר הטקסט, ולכן האחרון תמיד הגדול ביותר עד כה) - רק כשהוא
        // גדול/שווה ליעד ניתן לדעת בוודאות שהעמוד שמכיל אותו כבר קיים במלואו ב-DOM.
        function tryEarlyPendingScrollJump(targetTab) {
            if (typeof targetTab.pendingScrollLineIndex !== 'number') return;
            const previewArea = document.getElementById('preview-area');
            const marked = previewArea.querySelectorAll('[data-line-idx]');
            if (marked.length === 0) return;
            const lastIdx = parseInt(marked[marked.length - 1].getAttribute('data-line-idx'), 10);
            if (isNaN(lastIdx) || lastIdx < targetTab.pendingScrollLineIndex) return; // עדיין לא הגענו לשורת היעד

            const targetLine = targetTab.pendingScrollLineIndex;
            targetTab.pendingScrollLineIndex = null;
            const pageIdx = locatePageIndexForLineIndex(targetLine);
            if (pageIdx >= 0) goToPageIndex(pageIdx);
        }

        // הפעולה ההפוכה: מהי שורת הטקסט הגולמי (data-line-idx) הראשונה המוצגת כרגע בעמוד/בעלה
        // הנוכחי - משמשת את כפתור "חזרה לתצוגה הרגילה" כדי לפתוח את הספר במסך העיון הרגיל
        // בדיוק במקום שבו המשתמש נמצא כרגע בתוך התוסף.
        function getCurrentDisplayedLineIndex() {
            const previewArea = document.getElementById('preview-area');
            const pages = Array.from(previewArea.querySelectorAll('.print-page'));
            if (pages.length === 0) return null;

            const rawPageIdx = currentSettings.isBookView ? (currentLeaf * 2) : getScrollCurrentPage();
            const startIdx = Math.min(Math.max(rawPageIdx, 0), pages.length - 1);

            for (let p = startIdx; p < pages.length; p++) {
                const marked = pages[p].querySelector('[data-line-idx]');
                if (marked) return parseInt(marked.getAttribute('data-line-idx'), 10);
            }
            // העמוד הנוכחי (ואילך) ללא שום שורה מסומנת (למשל עמוד המשך של הערת שוליים בלבד) -
            // נופלים אחורה לשורה המסומנת האחרונה שלפניו
            for (let p = startIdx - 1; p >= 0; p--) {
                const marked = pages[p].querySelector('[data-line-idx]');
                if (marked) return parseInt(marked.getAttribute('data-line-idx'), 10);
            }
            return null;
        }

        // כפתור "חזרה לתצוגה הרגילה" בסרגל הכלים של התוסף - פותח את אותו ספר במסך העיון הרגיל
        // של אוצריא, בדיוק במיקום (שורה) שבו נמצא כרגע בתוך תצוגת הטורים.
        async function returnToNormalReading() {
            const tab = tabs[activeTabIndex];
            if (!tab || tab.isNewBookTab || tab.isExternal) return; // אין ספר אמיתי מהספרייה לחזור אליו

            const lineIdx = getCurrentDisplayedLineIndex();
            const params = {
                bookId: tab.id,
                index: (typeof lineIdx === 'number' && lineIdx >= 0) ? lineIdx : 0,
                navigateToPositionIfReused: true
            };
            // bookUid (כשידוע לטאב הזה) הוא המזהה היציב וחד-המשמעי המומלץ - כשהוא מסופק,
            // reader.openBook פותר לפיו ישירות ומתעלם מ-bookId שעלול להתנגש בין שני ספרים
            // בעלי אותו שם, או להשתנות בעדכון ספרייה. bookId עדיין נשלח לצדו כגיבוי.
            if (tab.bookUid) {
                params.bookUid = tab.bookUid;
            }

            try {
                const { data } = await Otzaria.call('reader.openBook', params);
                // reader.openBook מחזיר true/false (לא זורק שגיאה) כשהספר לא נמצא/הזהות לא תואמת -
                // בלי הבדיקה הזו כישלון כזה היה קורה בשקט מוחלט, בלי שום משוב למשתמש.
                if (data === false) {
                    await Otzaria.call('ui.showError', { message: 'לא ניתן היה לפתוח את הספר בתצוגה הרגילה' });
                }
            } catch (e) {
                console.error('פתיחה בתצוגה הרגילה נכשלה', e);
                try {
                    await Otzaria.call('ui.showError', { message: 'פתיחה בתצוגה הרגילה נכשלה' });
                } catch (_) { /* אם גם הצגת השגיאה נכשלת - אין מה לעשות מעבר לרישום ל-console */ }
            }
        }


        /* ==================== קיצורי מקשים מותאמים אישית ====================
           רשימת כל הפונקציות שיש להן קיצור מקשים קבוע בתוכנה (SHORTCUT_DEFS), עם
           האפשרות להחליף כל אחת מהן בקיצור מותאם אישית שנשמר תחת
           currentSettings.customShortcuts (מיפוי actionId -> קיצור). מוצג בהגדרות >
           קיצורי מקשים, ונבדק בפועל בתוך מאזין המקלדת הראשי (ראו matchesShortcutAction). */
        const SHORTCUT_DEFS = [
            { id: 'fullscreen', label: 'מסך מלא', combo: { ctrl: true, shift: true, key: 'M' } },
            { id: 'toolbarToggle', label: 'הצג/הסתר סרגל כלים', combo: { ctrl: true, shift: true, key: 'J' } },
            { id: 'searchPanel', label: 'פתיחת חיפוש בספר', combo: { ctrl: true, shift: true, key: 'F' } },
            { id: 'headingsPanel', label: 'פתיחת ניווט כותרות', combo: { ctrl: true, shift: true, key: 'L' } },
            { id: 'pagesPanel', label: 'פתיחת לשונית דפים', combo: { ctrl: true, shift: true, key: 'K' } },
            { id: 'fitWidth', label: 'התאמה לרוחב המסך', combo: { ctrl: true, shift: true, key: 'B' } },
            { id: 'fitHeight', label: 'התאמה לגובה המסך', combo: { ctrl: true, shift: true, key: 'H' } },
            { id: 'fitPage', label: 'התאמה לעמוד שלם', combo: { ctrl: true, shift: true, key: 'O' } },
            { id: 'toggleBookView', label: 'מעבר בין תצוגת גלילה לתצוגת ספר', combo: { ctrl: true, shift: true, key: 'S' } },
            { id: 'returnNormal', label: 'חזרה לתצוגה הרגילה', combo: { ctrl: true, shift: true, key: 'I' } },
            { id: 'newBookTab', label: 'פתיחת טאב ספר חדש', combo: { ctrl: true, shift: true, key: 'N' } },
            { id: 'toggleSettings', label: 'פתיחת/סגירת הגדרות', combo: { ctrl: true, shift: true, key: 'U' } },
            { id: 'refreshTab', label: 'ריענון הטאב הנוכחי', combo: { ctrl: true, shift: true, key: 'T' } },
            { id: 'print', label: 'הדפסה', combo: { ctrl: true, shift: true, key: 'P' } },
            { id: 'nextTab', label: 'מעבר לטאב הבא (Tab)', combo: { ctrl: true, key: 'Tab' } },
            { id: 'prevTab', label: 'מעבר לטאב הקודם (Tab)', combo: { ctrl: true, shift: true, key: 'Tab' } },
            { id: 'closeAllTabs', label: 'סגירת כל הטאבים', combo: { ctrl: true, shift: true, key: 'W' } },
            { id: 'closeTab', label: 'סגירת הטאב הנוכחי', combo: { ctrl: true, key: 'W' } },
            { id: 'zoomIn', label: 'הגדלת זום', combo: { ctrl: true, key: '=' } },
            { id: 'zoomOut', label: 'הקטנת זום', combo: { ctrl: true, key: '-' } }
        ];

        const SHORTCUT_KEY_LABELS = {
            ' ': 'SPACE', 'ArrowUp': '↑', 'ArrowDown': '↓', 'ArrowLeft': '←', 'ArrowRight': '→',
            'Escape': 'ESC', 'Enter': 'ENTER', 'Tab': 'TAB', 'Backspace': 'BACKSPACE', 'Delete': 'DELETE',
            '=': '+', '-': '-'
        };
