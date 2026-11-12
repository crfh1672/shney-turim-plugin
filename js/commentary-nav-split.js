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
            const { data } = await Otzaria.call('library.getCommentators', {
                bookId: tab.id,
                grouped: true
            });
            tab.commentaryGroups = (data && data.groups) || [];
            const flat = [];
            tab.commentaryGroups.forEach(g => (g.commentators || []).forEach(name => {
                if (!flat.includes(name)) flat.push(name);
            }));
            tab.commentaryAvailable = flat;
            tab.commentaryLoadError = false;
        } catch (e) {
            tab.commentaryGroups = [];
            tab.commentaryAvailable = [];
            tab.commentaryLoadError = true;
        }

        // ברירת מחדל לבחירת המפרשים הפעילים: קודם כל בודקים אם יש בחירה שמורה מפעם קודמת
        // לספר הזה בדיוק (ראו תיקון #11/loadActiveCommentatorsForBook) - אם כן, זו הבחירה
        // שנטענת (מסוננת לרשימת המפרשים הזמינה בפועל לספר, למקרה שהזמינות השתנתה מאז).
        // רק אם אין שום בחירה שמורה, נופלים לברירת המחדל הישנה: מה שפעיל כרגע בטאב הקריאה
        // הפתוח באוצריא, מסונן לרשימת המפרשים שקיימת בפועל לספר הזה (כדי לא "לאמץ" בחירה
        // לא-רלוונטית אם באותו רגע הטאב הפעיל באוצריא הוא בכלל ספר אחר) - אם אין חפיפה, הבחירה
        // מתחילה ריקה והמשתמש בוחר ידנית.
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
                } catch (e) { /* אין ברירת מחדל זמינה - נשאר ריק, המשתמש יבחר ידנית */ }
            }
            tab.activeCommentators = defaults;
        }

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

    function toggleCommentaryPanel() {
        const tab = getActiveCommentaryTab();
        const panelEl = document.getElementById('commentary-panel');
        const btn = document.getElementById('btn-commentary-panel');
        if (!tab || !panelEl) return; // אין ספר טעון - שום דבר לעשות

        tab.commentaryPanelOpen = !tab.commentaryPanelOpen;
        panelEl.classList.toggle('open', tab.commentaryPanelOpen);
        if (btn) btn.classList.toggle('active', tab.commentaryPanelOpen);
        if (tab.commentaryPanelOpen) syncCommentarySubTabButtonsUI(tab);

        if (tab.commentaryPanelOpen) {
            if (!tab.commentaryDataLoaded) {
                initCommentaryDataForTab(tab).then(() => {
                    renderCommentaryBody(tab);
                    refreshCommentaryPanel(true);
                });
            } else {
                renderCommentaryBody(tab);
                refreshCommentaryPanel(true);
            }
        }
    }

    // נקרא בכל מעבר טאב (switchTab) - מציג/מסתיר את החלונית לפי מצב הטאב החדש, ומרענן את
    // תוכנה אם היא פתוחה (בדיוק כמו שחזור מצב פאנל הניווט דרך isDrawerOpen למעלה בקובץ).
    function applyCommentaryPanelStateForActiveTab() {
        const panelEl = document.getElementById('commentary-panel');
        const btn = document.getElementById('btn-commentary-panel');
        if (!panelEl) return;
        const tab = getActiveCommentaryTab();
        const isOpen = Boolean(tab && tab.commentaryPanelOpen);
        panelEl.classList.toggle('open', isOpen);
        if (btn) {
            btn.classList.toggle('active', isOpen);
            btn.disabled = !tab; // כמו כפתור ההדפסה - לא רלוונטי בטאב "ספר חדש"/ללא טאב פעיל
        }
        if (!tab || !isOpen) return;
        syncCommentarySubTabButtonsUI(tab);

        if (!tab.commentaryDataLoaded) {
            initCommentaryDataForTab(tab).then(() => {
                renderCommentaryBody(tab);
                refreshCommentaryPanel(true);
            });
        } else {
            renderCommentaryBody(tab);
            refreshCommentaryPanel(true);
        }
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
            btn.classList.toggle('active', btn.dataset.subtab === effectiveTabName);
        });
        const toolbarRow = document.getElementById('commentary-toolbar-row');
        if (toolbarRow) toolbarRow.style.display = isPicker ? 'none' : '';
        const pickerAnchor = document.getElementById('commentary-picker-anchor');
        if (pickerAnchor) pickerAnchor.style.display = (effectiveTabName === 'commentary') ? '' : 'none';
    }

    function switchCommentarySubTab(name) {
        const tab = getActiveCommentaryTab();
        if (!tab || tab.commentaryActiveSubTab === name) return;
        tab.commentaryActiveSubTab = name;
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
    function openCommentaryPickerScreen() {
        const tab = getActiveCommentaryTab();
        if (!tab) return;
        if (tab.commentaryActiveSubTab !== 'picker') {
            tab.commentaryPickerPreviousSubTab = tab.commentaryActiveSubTab || 'commentary';
        }
        tab.commentaryActiveSubTab = 'picker';
        syncCommentarySubTabButtonsUI(tab);
        renderCommentaryBody(tab);
    }

    function closeCommentaryPickerScreen() {
        const tab = getActiveCommentaryTab();
        if (!tab) return;
        tab.commentaryActiveSubTab = tab.commentaryPickerPreviousSubTab || 'commentary';
        syncCommentarySubTabButtonsUI(tab);
        renderCommentaryBody(tab);
        refreshCommentaryPanel(false);
    }

    // בונה תיבת סימון מעוצבת (☑) עבור לשונית "בחירת מפרשים" - שלושה מצבים: ריקה, מסומנת
    // (checked, כשכל הפריטים הרלוונטיים נבחרו), וחלקית (indeterminate, כשרק חלק נבחרו - למשל
    // שורת "הצג את כל X" כשרק חלק מהמפרשים בקטגוריה פעילים).
    function buildCommentaryCheckboxEl(checked, indeterminate) {
        const box = document.createElement('span');
        box.className = 'commentary-picker-checkbox' + (checked ? ' checked' : '') + (indeterminate ? ' indeterminate' : '');
        box.innerHTML = fluentIconHTML('checkmark');
        return box;
    }

    // בונה את כל "מסך" לשונית בחירת המפרשים (שורת חזרה+כותרת, תיבת סינון, שבבי קטגוריות לקפיצה
    // מהירה, ואת הרשימה עצמה) - בדיוק כמו התמונה שהועלתה. נקראת פעם אחת בכל כניסה ללשונית הזו
    // (openCommentaryPickerScreen/renderCommentaryBody); הרשימה עצמה מתעדכנת בנפרד בלי לבנות
    // מחדש את כל המסך (ראו renderCommentaryPickerListOnly) כדי לא לאבד את הפוקוס/הסמן בתיבת
    // הסינון בכל הקלדה, ולא לאבד את מיקום הגלילה בכל סימון/ביטול סימון של מפרש בודד.
    function renderCommentaryPickerScreen(tab, body) {
        body.innerHTML = '';
        const screen = document.createElement('div');
        screen.className = 'commentary-picker-screen';

        const backRow = document.createElement('div');
        backRow.className = 'commentary-picker-back-row';
        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'commentary-picker-back-btn';
        backBtn.setAttribute('data-tooltip', 'חזרה למפרשים');
        backBtn.innerHTML = fluentIconHTML('chevron_down', 'rotate-270');
        backBtn.addEventListener('click', closeCommentaryPickerScreen);
        const titleEl = document.createElement('span');
        titleEl.className = 'commentary-picker-title';
        titleEl.textContent = 'בחירת מפרשים';
        backRow.appendChild(backBtn);
        backRow.appendChild(titleEl);
        screen.appendChild(backRow);

        const searchRow = document.createElement('div');
        searchRow.className = 'commentary-picker-search-row';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.id = 'commentary-picker-search-input';
        searchInput.placeholder = 'סינון מפרשים...';
        searchInput.value = tab.commentaryPickerSearchTerm || '';
        searchInput.addEventListener('input', () => {
            tab.commentaryPickerSearchTerm = searchInput.value;
            renderCommentaryPickerListOnly(tab);
        });
        searchRow.appendChild(searchInput);
        screen.appendChild(searchRow);

        const pillsRow = document.createElement('div');
        pillsRow.className = 'commentary-picker-pills-row';
        pillsRow.id = 'commentary-picker-pills-row';
        screen.appendChild(pillsRow);

        const listEl = document.createElement('div');
        listEl.className = 'commentary-picker-list';
        listEl.id = 'commentary-picker-list';
        screen.appendChild(listEl);

        body.appendChild(screen);
        renderCommentaryPickerListOnly(tab);
    }

    // מרנדרת רק את שבבי הקטגוריות + הרשימה עצמה (בלי לגעת בשורת החזרה/תיבת הסינון) - לפי
    // tab.commentaryPickerSearchTerm הנוכחי. שבבי הקטגוריות אינם מסננים כלום - הם רק קופצים
    // (גלילה חלקה) אל הקטגוריה המתאימה ברשימה, בדיוק כמו עוגני ניווט.
    function renderCommentaryPickerListOnly(tab) {
        const listEl = document.getElementById('commentary-picker-list');
        const pillsRow = document.getElementById('commentary-picker-pills-row');
        if (!listEl) return;
        listEl.innerHTML = '';
        if (pillsRow) pillsRow.innerHTML = '';

        if (tab.commentaryLoadError) {
            listEl.innerHTML = '<div class="commentary-picker-empty">שגיאה בטעינת רשימת המפרשים</div>';
            return;
        }
        const groups = (tab.commentaryGroups || []).filter(g => g.commentators && g.commentators.length);
        if (groups.length === 0) {
            listEl.innerHTML = '<div class="commentary-picker-empty">לא נמצאו מפרשים לספר זה</div>';
            return;
        }

        const term = (tab.commentaryPickerSearchTerm || '').trim();

        if (pillsRow) {
            groups.forEach((group, gi) => {
                const pill = document.createElement('button');
                pill.type = 'button';
                pill.className = 'commentary-picker-pill';
                pill.textContent = group.title || '';
                pill.addEventListener('click', () => {
                    const target = document.getElementById('commentary-picker-cat-' + gi);
                    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
                pillsRow.appendChild(pill);
            });
        }

        const allNames = [];
        groups.forEach(g => g.commentators.forEach(n => { if (!allNames.includes(n)) allNames.push(n); }));

        const masterRow = document.createElement('div');
        masterRow.className = 'commentary-picker-master-row';
        const allChecked = allNames.length > 0 && allNames.every(n => tab.activeCommentators.includes(n));
        const someChecked = allNames.some(n => tab.activeCommentators.includes(n));
        masterRow.appendChild(buildCommentaryCheckboxEl(allChecked, someChecked && !allChecked));
        const masterLabel = document.createElement('span');
        masterLabel.className = 'commentary-picker-master-label';
        masterLabel.textContent = 'הצג את כל המפרשים';
        masterRow.appendChild(masterLabel);
        masterRow.addEventListener('click', () => {
            tab.activeCommentators = allChecked ? [] : allNames.slice();
            saveActiveCommentatorsForBook(tab);
            refreshCommentaryPanel(true);
            renderCommentaryPickerListOnly(tab);
        });
        listEl.appendChild(masterRow);

        let anyVisible = false;
        groups.forEach((group, gi) => {
            const names = group.commentators;
            const visibleNames = term ? names.filter(n => n.includes(term)) : names;
            if (term && visibleNames.length === 0) return;
            anyVisible = true;

            const catWrap = document.createElement('div');
            catWrap.className = 'commentary-picker-category';
            catWrap.id = 'commentary-picker-cat-' + gi;

            const catRow = document.createElement('div');
            catRow.className = 'commentary-picker-category-row';
            const folderIcon = document.createElement('span');
            folderIcon.className = 'commentary-picker-folder-icon';
            folderIcon.innerHTML = fluentIconHTML('folder');
            catRow.appendChild(folderIcon);
            const catChecked = names.length > 0 && names.every(n => tab.activeCommentators.includes(n));
            const catSome = names.some(n => tab.activeCommentators.includes(n));
            catRow.appendChild(buildCommentaryCheckboxEl(catChecked, catSome && !catChecked));
            const catLabel = document.createElement('span');
            catLabel.className = 'commentary-picker-category-label';
            catLabel.textContent = 'הצג את כל ' + (group.title || '');
            catRow.appendChild(catLabel);
            catRow.addEventListener('click', () => {
                if (catChecked) {
                    tab.activeCommentators = tab.activeCommentators.filter(n => !names.includes(n));
                } else {
                    names.forEach(n => { if (!tab.activeCommentators.includes(n)) tab.activeCommentators.push(n); });
                }
                saveActiveCommentatorsForBook(tab);
                refreshCommentaryPanel(true);
                renderCommentaryPickerListOnly(tab);
            });
            catWrap.appendChild(catRow);

            visibleNames.forEach(name => {
                const itemRow = document.createElement('div');
                itemRow.className = 'commentary-picker-item-row';
                const checked = tab.activeCommentators.includes(name);
                itemRow.appendChild(buildCommentaryCheckboxEl(checked, false));
                const itemLabel = document.createElement('span');
                itemLabel.className = 'commentary-picker-item-label';
                itemLabel.textContent = name;
                itemRow.appendChild(itemLabel);
                itemRow.addEventListener('click', () => {
                    if (tab.activeCommentators.includes(name)) {
                        tab.activeCommentators = tab.activeCommentators.filter(n => n !== name);
                    } else {
                        tab.activeCommentators.push(name);
                    }
                    saveActiveCommentatorsForBook(tab);
                    refreshCommentaryPanel(true);
                    renderCommentaryPickerListOnly(tab);
                });
                catWrap.appendChild(itemRow);
            });

            listEl.appendChild(catWrap);
        });

        if (!anyVisible) {
            listEl.innerHTML = '<div class="commentary-picker-empty">לא נמצאו מפרשים תואמים לסינון</div>';
        }
    }

    // --- רינדור גוף החלונית (מפנה ללשונית הפעילה) ---

    function renderCommentaryBody(tab) {
        const body = document.getElementById('commentary-panel-body');
        if (!body) return;
        const subTab = tab.commentaryActiveSubTab || 'commentary';
        body.dataset.subtab = subTab;
        if (subTab === 'links') renderCommentaryLinksBody(tab, body);
        else if (subTab === 'notes') renderCommentaryNotesBody(tab, body);
        else if (subTab === 'picker') renderCommentaryPickerScreen(tab, body);
        else renderCommentaryMefarshimBody(tab, body);
        updateCommentaryExpandAllButtonUI(tab);
    }

    // === כיווץ/הרחבה של קבוצות מפרשים/קישורים ===
    // מצב הכיווץ עצמאי לכל טאב, ועצמאי בין לשונית "מפרשים" ללשונית "קישורים" (כל אחת עם המפה
    // שלה) - בדיוק כמו _expansionStates באוצריא עצמה. מפתח חסר במפה = מכווץ (ברירת המחדל בפתיחת
    // החלונית היא הכל מכווץ, כפי שהתבקש).
    function getCommentaryExpandState(tab, subTabKey) {
        const key = subTabKey === 'links' ? 'linksGroupExpandState' : 'mefarshimGroupExpandState';
        if (!tab[key]) tab[key] = {};
        return tab[key];
    }

    // שמות הקבוצות (כותרות) המוצגות כרגע בפועל בלשונית הנתונה, לפי אותו סדר שבו הן מרונדרות -
    // משמש גם את הרינדור עצמו וגם את כפתור "הרחב/כווץ הכל" כדי לדעת על אילו קבוצות לפעול.
    function getCommentaryGroupNamesForSubTab(tab, subTabKey) {
        if (subTabKey === 'links') {
            const entries = tab.linksEntries || [];
            const order = [];
            entries.forEach(e => { if (!order.includes(e.targetTitle)) order.push(e.targetTitle); });
            return order;
        }
        const entries = tab.commentaryEntries || [];
        const activeNames = tab.activeCommentators || [];
        return activeNames.filter(name => entries.some(e => e.targetTitle === name));
    }

    function toggleCommentaryGroupExpand(tab, subTabKey, name) {
        const stateMap = getCommentaryExpandState(tab, subTabKey);
        stateMap[name] = !stateMap[name];
        renderCommentaryBody(tab);
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
        const allExpanded = names.every(n => stateMap[n]);
        const newVal = !allExpanded;
        names.forEach(n => { stateMap[n] = newVal; });
        renderCommentaryBody(tab);
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
        const stateMap = getCommentaryExpandState(tab, subTabKey);
        const allExpanded = names.length > 0 && names.every(n => stateMap[n]);
        const label = subTab === 'links' ? 'הקישורים' : 'המפרשים';
        const iconName = allExpanded ? 'arrow_collapse_all' : 'arrow_expand_all';
        const tooltip = (allExpanded ? 'כווץ את כל ' : 'הרחב את כל ') + label;
        icon.textContent = String.fromCodePoint(fluentIconCodePoint(iconName));
        icon.classList.remove('ui-icon-filled');
        btn.setAttribute('data-tooltip', tooltip);
        btn.setAttribute('aria-label', tooltip);
    }

    // בונה DOM עבור קבוצת מפרשים/קישורים אחת: כותרת לחיצה (חץ + שם) שמרחיבה/מכווצת, ותוכן
    // (רשימת ה"פגיעות" של אותו מפרש/קישור בטווח המוצג) - מוסתר כברירת מחדל (ראו
    // getCommentaryExpandState). subTabKey קובע לאיזו מפת כיווץ (מפרשים/קישורים) הקבוצה שייכת.
    function buildCommentaryEntryGroupEl(tab, subTabKey, name, forThis) {
        const stateMap = getCommentaryExpandState(tab, subTabKey);
        const isExpanded = Boolean(stateMap[name]);

        const groupEl = document.createElement('div');
        groupEl.className = 'commentary-entry-group';
        groupEl.dataset.subtab = subTabKey;

        const headerEl = document.createElement('div');
        headerEl.className = 'commentary-entry-group-header' + (isExpanded ? ' expanded' : '');
        headerEl.setAttribute('role', 'button');
        headerEl.setAttribute('tabindex', '0');
        headerEl.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

        const chevronEl = document.createElement('span');
        chevronEl.className = 'commentary-entry-group-chevron';
        chevronEl.innerHTML = fluentIconHTML('chevron_down', 'rotate-90');

        const titleEl = document.createElement('span');
        titleEl.className = 'commentary-entry-group-title';
        titleEl.textContent = name;

        headerEl.appendChild(chevronEl);
        headerEl.appendChild(titleEl);
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
        contentWrapEl.className = 'commentary-entry-group-content';
        if (!isExpanded) contentWrapEl.style.display = 'none';

        forThis.forEach(entry => {
            const entryEl = document.createElement('div');
            entryEl.className = 'commentary-entry';
            if (entry.targetHeRef) {
                const refEl = document.createElement('div');
                refEl.className = 'commentary-entry-ref';
                refEl.textContent = entry.targetHeRef;
                entryEl.appendChild(refEl);
            }
            const contentEl = document.createElement('div');
            contentEl.className = 'commentary-entry-content';
            contentEl.innerHTML = applyCommentaryTextFilters(entry.content || '');
            entryEl.appendChild(contentEl);
            contentWrapEl.appendChild(entryEl);
        });

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

    function renderCommentaryMefarshimBody(tab, body) {
        if (tab.commentaryLoading) {
            renderCommentaryPanelStatus(body, 'טוען רשימת מפרשים...', true);
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
            renderCommentaryPanelStatus(body, 'טוען תוכן מפרשים...', true);
            return;
        }
        const entries = tab.commentaryEntries || [];
        if (entries.length === 0) {
            renderCommentaryEmptyState(body, 'links', 'לא נמצאו מפרשים מהנבחרים לקטע זה');
            return;
        }

        body.innerHTML = '';
        // קיבוץ לפי מפרש, בסדר הבחירה של המשתמש (tab.activeCommentators) - כל מפרש עם רשימת
        // ה"פגיעות" שלו על הטווח המוצג, ממוינות לפי שורת המקור. כל קבוצה מוצגת מכווצת כברירת
        // מחדל, עם כותרת לחיצה שמרחיבה/מכווצת אותה (ראו buildCommentaryEntryGroupEl).
        tab.activeCommentators.forEach(name => {
            const forThis = entries.filter(e => e.targetTitle === name).sort((a, b) => a.sourceLine - b.sourceLine);
            if (forThis.length === 0) return;
            body.appendChild(buildCommentaryEntryGroupEl(tab, 'commentary', name, forThis));
        });
        if (!body.firstChild) {
            renderCommentaryEmptyState(body, 'links', 'לא נמצאו מפרשים מהנבחרים לקטע זה');
        }
    }

    // לשונית "קישורים" - הפניות/תרגומים וכדומה (כל קישור שאינו מפרש, isCommentary===false) על
    // הטווח המוצג. בניגוד ללשונית "מפרשים" - אין כאן בחירה ידנית של המשתמש; מוצגים כל הקישורים
    // הלא-מפרשיים שנמצאו, מקובצים לפי כותרת היעד לפי סדר הופעתם הראשון בטווח.
    function renderCommentaryLinksBody(tab, body) {
        if (tab.linksContentLoading) {
            renderCommentaryPanelStatus(body, 'טוען קישורים...', true);
            return;
        }
        if (tab.linksLoadError) {
            renderCommentaryPanelStatus(body, 'שגיאה בטעינת הקישורים');
            return;
        }
        const entries = tab.linksEntries || [];
        if (entries.length === 0) {
            renderCommentaryEmptyState(body, 'links', 'אין קישורים לטקסט הנראה במסך');
            return;
        }

        body.innerHTML = '';
        const order = getCommentaryGroupNamesForSubTab(tab, 'links');
        order.forEach(name => {
            const forThis = entries.filter(e => e.targetTitle === name).sort((a, b) => a.sourceLine - b.sourceLine);
            if (forThis.length === 0) return;
            body.appendChild(buildCommentaryEntryGroupEl(tab, 'links', name, forThis));
        });
        if (!body.firstChild) {
            renderCommentaryEmptyState(body, 'links', 'אין קישורים לטקסט הנראה במסך');
        }
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
            renderCommentaryEmptyState(
                body,
                'note',
                message,
                'ליצירה או לעריכת הערות, יש להשתמש במסך העיון הרגיל של אוצריא.',
                'fluent'
            );
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
            contentEl.innerHTML = applyCommentaryTextFilters(note.contentPlain || note.content || '');
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
            tab.commentaryEntries = [];
            tab.commentaryLastRangeKey = null;
            if (isVisible()) renderCommentaryBody(tab);
            return;
        }

        const activeKey = tab.activeCommentators.slice().sort().join('\u0001');
        const rangeKey = range.start + '-' + range.end + '::' + activeKey;
        if (!force && tab.commentaryLastRangeKey === rangeKey) return; // כבר מוצג בדיוק זה

        if (tab.activeCommentators.length === 0) {
            tab.commentaryEntries = [];
            tab.commentaryLastRangeKey = rangeKey;
            if (isVisible()) renderCommentaryBody(tab);
            return;
        }

        tab.commentaryLastRangeKey = rangeKey;
        const myToken = (tab.commentaryReqToken = (tab.commentaryReqToken || 0) + 1);
        tab.commentaryContentLoading = true;
        if (isVisible()) renderCommentaryBody(tab);

        loadCommentaryEntriesForRange(tab, range.start, range.end).then(entries => {
            if (tab.commentaryReqToken !== myToken) return; // בקשה מיושנת (הוחלפה בבקשה חדשה) - התעלם
            tab.commentaryEntries = entries;
            tab.commentaryContentLoading = false;
            if (getActiveCommentaryTab() === tab && tab.commentaryPanelOpen && isVisible()) renderCommentaryBody(tab);
        }).catch(() => {
            if (tab.commentaryReqToken !== myToken) return;
            tab.commentaryEntries = [];
            tab.commentaryContentLoading = false;
            if (getActiveCommentaryTab() === tab && tab.commentaryPanelOpen && isVisible()) renderCommentaryBody(tab);
        });
    }

    // מבצעת בפועל את שתי הקריאות (getLinks + getLinkContent ב"אצוות" של עד 25) ומחזירה מערך
    // שטוח של {sourceLine, targetTitle, targetHeRef, content} - מסונן למפרשים הפעילים בלבד.
    async function loadCommentaryEntriesForRange(tab, startLine, endLine) {
        // חלון ה-API מוגבל ל-200 שורות - שני עמודים אמורים תמיד להיכנס בנוחות, אך גוזרים
        // בזהירות ליתר ביטחון בספר עם עמודים חריגים בגודלם.
        const clampedEnd = Math.min(endLine, startLine + 199);

        const { data } = await Otzaria.call('library.getLinks', {
            bookId: tab.id,
            startLine,
            endLine: clampedEnd,
            connectionTypes: ['COMMENTARY'],
            targetTitles: tab.activeCommentators
        });
        const links = (data && data.links) || [];
        if (links.length === 0) return [];
        return fetchLinkContents(links);
    }

    // מרעננת את לשונית "קישורים" (הפניות/תרגומים - לא מפרשים) - אותו עיקרון קאש+דיבאונס-בקשה
    // כמו לשונית המפרשים, רק בלי תלות בבחירת מפרשים (אין כאן בחירה ידנית כלל).
    function refreshCommentaryLinksSubTab(tab, force) {
        const range = getVisibleLineRange();
        if (!range) {
            tab.linksEntries = [];
            tab.linksLastRangeKey = null;
            renderCommentaryBody(tab);
            return;
        }

        const rangeKey = range.start + '-' + range.end;
        if (!force && tab.linksLastRangeKey === rangeKey) return;

        tab.linksLastRangeKey = rangeKey;
        const myToken = (tab.linksReqToken = (tab.linksReqToken || 0) + 1);
        tab.linksContentLoading = true;
        renderCommentaryBody(tab);

        loadNonCommentaryLinksForRange(tab, range.start, range.end).then(entries => {
            if (tab.linksReqToken !== myToken) return;
            tab.linksEntries = entries;
            tab.linksContentLoading = false;
            if (getActiveCommentaryTab() === tab && tab.commentaryPanelOpen && tab.commentaryActiveSubTab === 'links') renderCommentaryBody(tab);
        }).catch(() => {
            if (tab.linksReqToken !== myToken) return;
            tab.linksEntries = [];
            tab.linksLoadError = true;
            tab.linksContentLoading = false;
            if (getActiveCommentaryTab() === tab && tab.commentaryPanelOpen && tab.commentaryActiveSubTab === 'links') renderCommentaryBody(tab);
        });
    }

    // כמו loadCommentaryEntriesForRange, אבל בלי סינון connectionTypes/targetTitles (כל
    // הקישורים בטווח) ואז מסננת בצד הלקוח רק את מה שאינו מפרש (isCommentary === false).
    async function loadNonCommentaryLinksForRange(tab, startLine, endLine) {
        const clampedEnd = Math.min(endLine, startLine + 199);
        const { data } = await Otzaria.call('library.getLinks', {
            bookId: tab.id,
            startLine,
            endLine: clampedEnd
        });
        const allLinks = (data && data.links) || [];
        const links = allLinks.filter(l => l.isCommentary === false);
        if (links.length === 0) return [];
        return fetchLinkContents(links);
    }

    // משותפת לשתי הלשוניות (מפרשים/קישורים) - שולפת תוכן בפועל עבור מערך links (מ-getLinks) דרך
    // library.getLinkContent, באצוות של עד 25 (מגבלת ה-API), ומחזירה מערך שטוח עם התוכן ממוזג.
    async function fetchLinkContents(links) {
        const contentByIndex = new Array(links.length).fill(null);
        for (let i = 0; i < links.length; i += 25) {
            const batch = links.slice(i, i + 25);
            const { data: contentData } = await Otzaria.call('library.getLinkContent', {
                links: batch.map(l => ({
                    targetTitle: l.targetTitle,
                    targetLine: l.targetLine,
                    targetLineEnd: l.targetLineEnd,
                    targetIsUserBook: l.targetIsUserBook,
                    targetCategoryId: l.targetCategoryId
                }))
            });
            const items = (contentData && contentData.items) || [];
            items.forEach((item, j) => { contentByIndex[i + j] = item; });
        }

        const result = [];
        links.forEach((l, i) => {
            const item = contentByIndex[i];
            if (!item || item.error) return;
            result.push({
                sourceLine: l.sourceLine,
                targetTitle: l.targetTitle,
                targetHeRef: l.targetHeRef,
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

        tab.notesContentLoading = true;
        renderCommentaryBody(tab);
        Otzaria.call('notes.list', { bookId: tab.id }).then(({ data }) => {
            tab.notesFullList = Array.isArray(data) ? data : [];
            tab.notesFullListLoaded = true;
            tab.notesContentLoading = false;
            if (getActiveCommentaryTab() === tab && tab.commentaryPanelOpen && tab.commentaryActiveSubTab === 'notes') proceedWithFilter();
        }).catch(() => {
            tab.notesFullList = [];
            tab.notesFullListLoaded = true;
            tab.notesLoadError = true;
            tab.notesContentLoading = false;
            if (getActiveCommentaryTab() === tab && tab.commentaryPanelOpen && tab.commentaryActiveSubTab === 'notes') renderCommentaryBody(tab);
        });
    }


    /* ==========================================================================================
       מונה עמודים (X/X) וכותרת ניווט ממורכזת בסרגל הכלים.
       • מונה העמודים: המספר הכללי = מספר העמודים שנטענו עד כה; התיבה מציגה את העמוד הנוכחי
         ומאפשרת להקליד מספר עמוד ולעבור אליו (Enter).
       • כותרת הניווט: שם הספר והנתיב ההיררכי הנוכחי; לחצני המעבר מנווטים בין הכותרות
         שמופיעות בתוכן העניינים הרשמי, ובהיעדרו בין כותרות ה-DOM. בריחוף מוצג הנתיב המלא.
       ========================================================================================== */
    const NAV_CENTER_MAX_WIDTH = 440;
    const NAV_CENTER_MIN_WIDTH = 150;

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
        const input = document.getElementById('page-indicator-input');
        const totalEl = document.getElementById('page-indicator-total');
        if (input && totalEl) {
            const pages = hasBook ? Array.from(previewArea.querySelectorAll('.print-page')) : [];
            const total = pages.length;
            const cur = total ? getNavCurrentPageIndex(pages) + 1 : 0;
            totalEl.textContent = String(total);
            input.style.width = (Math.max(String(total).length, 2) + 1) + 'ch';
            if (document.activeElement !== input) input.value = String(cur);
            input.disabled = total === 0;
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
            const tip = document.getElementById('nav-heading-tooltip');
            if (tip && tip.classList.contains('visible')) tip.textContent = shownTitle;
        }
        layoutNavCenter();
    }

    // ---- תיבת מספר העמוד ----
    function onPageIndicatorKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const input = e.target;
            const previewArea = document.getElementById('preview-area');
            const total = previewArea.querySelectorAll('.print-page').length;
            const n = parseInt(String(input.value).replace(/[^0-9]/g, ''), 10);
            if (!isNaN(n) && total > 0) {
                goToPageIndex(Math.min(Math.max(n, 1), total) - 1);
            }
            input.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.target.blur();
        }
        e.stopPropagation(); // קיצורי המקלדת הכלליים לא צריכים להגיב להקלדה בתיבה
    }

    function onPageIndicatorBlur() {
        // חזרה להצגת העמוד הנוכחי בפועל (גם אם הוקלד ערך שלא אושר)
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
        const startSide = toolbar.querySelector('.toolbar-side-start');
        const sides = toolbar.querySelectorAll(':scope > .toolbar-side');
        const endSide = sides[sides.length - 1];
        const padding = 14;
        const gapMargin = 10;
        // הצד הימני: כפתורי הסרגל; הצד השמאלי: כל הכפתורים (לא מצטמצם)
        let startFixed = 0;
        if (startSide) {
            startSide.querySelectorAll(':scope > button').forEach(b => { startFixed += b.offsetWidth + 6; });
        }
        const tbRect = toolbar.getBoundingClientRect();
        const endRight = endSide ? (endSide.getBoundingClientRect().right - tbRect.left) : padding;
        // האזור הפנוי בין שני הצדדים (בקואורדינטות מהקצה השמאלי של הסרגל)
        const gapL = endRight + gapMargin;
        const gapR = toolbar.clientWidth - padding - startFixed - gapMargin;
        const gapW = gapR - gapL;
        const width = Math.min(NAV_CENTER_MAX_WIDTH, gapW);
        if (width < NAV_CENTER_MIN_WIDTH) {
            center.classList.add('nav-center-hidden');
            toolbar.style.removeProperty('--nav-start-max');
            return;
        }
        center.classList.remove('nav-center-hidden');
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

        const tip = document.createElement('div');
        tip.id = 'nav-heading-tooltip';
        tip.className = 'no-print';
        document.body.appendChild(tip);

        const wrap = document.getElementById('nav-heading-title-wrap');
        if (wrap) {
            wrap.addEventListener('mouseenter', () => {
                const full = (document.getElementById('nav-heading-title') || {}).textContent || '';
                if (!full) return;
                tip.textContent = full;
                const toolbar = document.getElementById('main-toolbar');
                const tbRect = toolbar ? toolbar.getBoundingClientRect() : wrap.getBoundingClientRect();
                const wRect = wrap.getBoundingClientRect();
                tip.style.top = (tbRect.bottom + 4) + 'px';
                tip.style.left = '0px';
                tip.classList.add('visible');
                const tw = tip.offsetWidth;
                let left = wRect.left + wRect.width / 2 - tw / 2;
                left = Math.max(6, Math.min(left, window.innerWidth - tw - 6));
                tip.style.left = left + 'px';
            });
            wrap.addEventListener('mouseleave', () => tip.classList.remove('visible'));
        }

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
