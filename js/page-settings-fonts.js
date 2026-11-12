        function updateConcurrencyValue(val) {
            currentSettings.concurrency = parseInt(val, 10);
            const concVal = document.getElementById('setting-concurrency-val');
            if (concVal) concVal.innerText = val + ' ערוצים';
        }

        function updateFontSizeSetting(val) {
            const currentTab = tabs[activeTabIndex];
            if (!currentTab) return;
            const size = parseInt(val, 10);
            currentTab.fontSize = size;
            // שמירת גודל הגופן גם כברירת המחדל הגלובלית לספרים הבאים שייפתחו (ולשחזור אחרי סגירת
            // התוסף) - קודם זה נשמר רק לטאב הנוכחי ולכן כל ספר חדש נפתח תמיד ב-14pt קבוע
            currentSettings.fontSize = size;
            saveSettings();
            document.documentElement.style.setProperty('--font-size-book', val + 'pt');
            const fsVal = document.getElementById('setting-font-size-val');
            if (fsVal) fsVal.innerText = val + 'pt';

            scheduleFontUpdate();
        }

        function resetToDefaults() {
            currentSettings = { ...DEFAULT_SETTINGS };
            saveSettings();
            applySettingsToCSS();
            // איפוס גם מחזיר למעקב אחרי גופן התוכנה - נדרש ליישם מיד את גופן התוכנה במקום להשאיר
            // את הגופן המותאם-אישית הקודם "תקוע" (applyCustomFontFamily לא עושה כלום כש-null)
            if (lastKnownTheme) applyTheme(lastKnownTheme);

            if (activeTabIndex !== -1 && tabs[activeTabIndex]) {
                tabs[activeTabIndex].fontSize = DEFAULT_SETTINGS.fontSize;
                document.documentElement.style.setProperty('--font-size-book', DEFAULT_SETTINGS.fontSize + 'pt');
            }

            rerenderOpenCommentaryPanel();
            triggerRepagination();
        }

        function updateLineHeightValue(val) {
            const value = parseFloat(val);
            currentSettings.lineHeight = value;
            document.documentElement.style.setProperty('--line-height-book', value);
            const lhVal = document.getElementById('setting-line-height-val');
            if (lhVal) lhVal.innerText = value.toFixed(2);
            triggerRepagination();
        }

        function updateParagraphSpacingValue(val) {
            const value = parseFloat(val);
            currentSettings.paragraphSpacing = value;
            document.documentElement.style.setProperty('--paragraph-spacing', value + 'em');
            const psVal = document.getElementById('setting-paragraph-spacing-val');
            if (psVal) psVal.innerText = value.toFixed(2) + 'em';
            triggerRepagination();
        }

        // ============================================================================
        // === הגדרות הערות שוליים (הגדרות > הערות) ===
        // כל הגדרה כאן עצמאית לגמרי מהגדרות הטקסט המקבילות (footnoteFontSize/footnoteLineHeight/
        // footnoteParagraphSpacing/footnoteFontFamily), חוץ מהשוליים הצדדיים (setting-margin) שהם
        // במכוון *לא* משוכפלים כאן - הם משותפים לטקסט ולהערות דרך אותו --page-margin יחיד, כי שני
        // התוכן נמצאים בתוך אותו .print-page. כל עוד currentSettings.footnoteXxx הוא null - ה-CSS
        // (ראו .page-footnotes-block) נופל לברירת המחדל הישנה (יחסית לגודל/רווח הטקסט), בדיוק כפי
        // שהוצג לפני הוספת הלשונית הזו.
        // ============================================================================

        // מציג במחוון את הערך האפקטיבי הנוכחי (מותאם אישית אם קיים, אחרת הערך המחושב כברירת
        // מחדל) - כדי שהמחוון לא "יקפוץ" סתם כשעדיין לא נגעו בו
        function applyFootnoteFontSizeCSS() {
            const val = currentSettings.footnoteFontSize;
            if (val) {
                document.documentElement.style.setProperty('--font-size-footnote', val + 'pt');
            } else {
                document.documentElement.style.removeProperty('--font-size-footnote');
            }
            const input = document.getElementById('setting-footnote-font-size');
            const label = document.getElementById('setting-footnote-font-size-val');
            if (input && label) {
                const bodyFs = (activeTabIndex !== -1 && tabs[activeTabIndex] && tabs[activeTabIndex].fontSize) || currentSettings.fontSize || 14;
                const effective = val || Math.round(bodyFs * 0.72);
                input.value = effective;
                label.innerText = effective + 'pt';
            }
        }

        function updateFootnoteFontSizeValue(val) {
            const value = parseInt(val, 10);
            currentSettings.footnoteFontSize = value;
            document.documentElement.style.setProperty('--font-size-footnote', value + 'pt');
            const label = document.getElementById('setting-footnote-font-size-val');
            if (label) label.innerText = value + 'pt';
            triggerRepagination();
        }

        function applyFootnoteLineHeightCSS() {
            const val = currentSettings.footnoteLineHeight;
            if (val) {
                document.documentElement.style.setProperty('--line-height-footnote', val);
            } else {
                document.documentElement.style.removeProperty('--line-height-footnote');
            }
            const input = document.getElementById('setting-footnote-line-height');
            const label = document.getElementById('setting-footnote-line-height-val');
            if (input && label) {
                const effective = val || 1.35;
                input.value = effective;
                label.innerText = effective.toFixed(2);
            }
        }

        function updateFootnoteLineHeightValue(val) {
            const value = parseFloat(val);
            currentSettings.footnoteLineHeight = value;
            document.documentElement.style.setProperty('--line-height-footnote', value);
            const label = document.getElementById('setting-footnote-line-height-val');
            if (label) label.innerText = value.toFixed(2);
            triggerRepagination();
        }

        function applyFootnoteParagraphSpacingCSS() {
            const val = currentSettings.footnoteParagraphSpacing;
            if (val) {
                document.documentElement.style.setProperty('--paragraph-spacing-footnote', val + 'em');
            } else {
                document.documentElement.style.removeProperty('--paragraph-spacing-footnote');
            }
            const input = document.getElementById('setting-footnote-paragraph-spacing');
            const label = document.getElementById('setting-footnote-paragraph-spacing-val');
            if (input && label) {
                const effective = val || 0.3;
                input.value = effective;
                label.innerText = effective.toFixed(2) + 'em';
            }
        }

        function updateFootnoteParagraphSpacingValue(val) {
            const value = parseFloat(val);
            currentSettings.footnoteParagraphSpacing = value;
            document.documentElement.style.setProperty('--paragraph-spacing-footnote', value + 'em');
            const label = document.getElementById('setting-footnote-paragraph-spacing-val');
            if (label) label.innerText = value.toFixed(2) + 'em';
            triggerRepagination();
        }

        // מרווח/קו מפריד בין טורי ההערות + מתג "שני טורים" - כל בלוקי ההערות נבנים דינמית בזמן
        // העימוד (ראו syncPageFootnotes/wouldFootnoteFitOnBlankPage) וקוראים משם את
        // currentSettings.footnoteTwoColumn ישירות, כך שרק צריך עימוד מחדש כדי שהם ייבנו עם
        // המחלקה הנכונה - בדיוק כמו עמודות הטקסט הרגילות (--cols) בשינוי גודל גופן/מרווחים.
        function applyFootnoteColumnSettingsCSS() {
            document.documentElement.style.setProperty('--footnote-column-gap', (currentSettings.footnoteColumnGap || 12) + 'mm');
            const showRule = currentSettings.footnoteShowColumnRule !== false;
            document.documentElement.style.setProperty('--footnote-column-rule-style', showRule ? '2px solid var(--color-outline-subtle)' : 'none');

            const twoColCheckbox = document.getElementById('setting-footnote-two-column');
            if (twoColCheckbox) twoColCheckbox.checked = Boolean(currentSettings.footnoteTwoColumn);

            const gapInput = document.getElementById('setting-footnote-column-gap');
            const gapVal = document.getElementById('setting-footnote-column-gap-val');
            if (gapInput && gapVal) {
                gapInput.value = currentSettings.footnoteColumnGap || 12;
                gapVal.innerText = (currentSettings.footnoteColumnGap || 12) + ' מ"מ';
            }

            const ruleCheckbox = document.getElementById('setting-footnote-show-column-rule');
            if (ruleCheckbox) ruleCheckbox.checked = showRule;
        }

        function updateFootnoteTwoColumnSetting(isChecked) {
            currentSettings.footnoteTwoColumn = isChecked;
            triggerRepagination();
        }

        function updateFootnoteColumnGapValue(val) {
            currentSettings.footnoteColumnGap = parseInt(val, 10);
            document.documentElement.style.setProperty('--footnote-column-gap', val + 'mm');
            const gapVal = document.getElementById('setting-footnote-column-gap-val');
            if (gapVal) gapVal.innerText = val + ' מ"מ';
            triggerRepagination();
        }

        function updateFootnoteColumnRuleSetting(isChecked) {
            currentSettings.footnoteShowColumnRule = isChecked;
            document.documentElement.style.setProperty('--footnote-column-rule-style', isChecked ? '2px solid var(--color-outline-subtle)' : 'none');
            // כמו קו המפריד של הטקסט הרגיל - זהו רק משתנה CSS גלובלי, אין צורך בעימוד מחדש
        }

        // איפוס הגדרות ההערות בלבד לברירת המחדל (הגדרות > הערות > "איפוס הערות לברירת מחדל") -
        // לא נוגע בשום הגדרה אחרת (טקסט/פריסה/צבע/וכו'), ומחזיר בדיוק לתצוגה שהייתה קיימת לפני
        // הוספת הלשונית הזו: גופן/גודל/מרווח שורות/מרווח בין הערות יחסיים לטקסט, וטור בודד.
        function resetFootnoteSettings() {
            currentSettings.footnoteFontFamily = null;
            currentSettings.footnoteFontSize = null;
            currentSettings.footnoteLineHeight = null;
            currentSettings.footnoteParagraphSpacing = null;
            currentSettings.footnoteTwoColumn = false;
            currentSettings.footnoteColumnGap = DEFAULT_SETTINGS.footnoteColumnGap;
            currentSettings.footnoteShowColumnRule = true;
            saveSettings();
            applyCustomFontFamily('note');
            applyFootnoteFontSizeCSS();
            applyFootnoteLineHeightCSS();
            applyFootnoteParagraphSpacingCSS();
            applyFootnoteColumnSettingsCSS();
            triggerRepagination();
        }

        // ============================================================================
        // === הגדרות חלונית המפרשים (הגדרות > הערות > הגדרות גופן למפרשים) ===
        // עצמאיות לגמרי מהגדרות הטקסט/ההערות המקבילות (fontSize/lineHeight/footnoteFontSize/
        // footnoteLineHeight) - וגם לא משפיעות על עימוד הדפים (הפאנל אינו חלק מהדפסה), ולכן
        // בשונה מפונקציות ה-CSS המקבילות של ההערות, כאן קוראים לרינדור מחדש של גוף החלונית
        // (renderCommentaryBody) במקום ל-triggerRepagination.
        // ============================================================================

        function applyCommentaryFontSizeCSS() {
            const val = currentSettings.commentaryFontSize;
            if (val) {
                document.documentElement.style.setProperty('--font-size-commentary-panel', val + 'pt');
            } else {
                document.documentElement.style.removeProperty('--font-size-commentary-panel');
            }
            const input = document.getElementById('setting-commentary-font-size');
            const label = document.getElementById('setting-commentary-font-size-val');
            if (input && label) {
                const effective = val || 12;
                input.value = effective;
                label.innerText = effective + 'pt';
            }
        }

        function updateCommentaryFontSizeValue(val) {
            const value = parseInt(val, 10);
            currentSettings.commentaryFontSize = value;
            document.documentElement.style.setProperty('--font-size-commentary-panel', value + 'pt');
            const label = document.getElementById('setting-commentary-font-size-val');
            if (label) label.innerText = value + 'pt';
        }

        function applyCommentaryLineHeightCSS() {
            const val = currentSettings.commentaryLineHeight;
            if (val) {
                document.documentElement.style.setProperty('--line-height-commentary-panel', val);
            } else {
                document.documentElement.style.removeProperty('--line-height-commentary-panel');
            }
            const input = document.getElementById('setting-commentary-line-height');
            const label = document.getElementById('setting-commentary-line-height-val');
            if (input && label) {
                const effective = val || 1.55;
                input.value = effective;
                label.innerText = effective.toFixed(2);
            }
        }

        function updateCommentaryLineHeightValue(val) {
            const value = parseFloat(val);
            currentSettings.commentaryLineHeight = value;
            document.documentElement.style.setProperty('--line-height-commentary-panel', value);
            const label = document.getElementById('setting-commentary-line-height-val');
            if (label) label.innerText = value.toFixed(2);
        }

        // מרנדר מחדש רק את גוף החלונית הפתוחה כרגע (אם יש) - משתמש בישויות שכבר נטענו במטמון
        // (tab.commentaryEntries/linksEntries/notesEntries), בלי שום קריאת רשת נוספת. משמש את
        // כל שינויי גופן/גודל/מרווח שורות/הסתרת ניקוד-טעמים-פיסוק של חלונית המפרשים.
        function rerenderOpenCommentaryPanel() {
            const tab = getActiveCommentaryTab();
            if (tab && tab.commentaryPanelOpen) renderCommentaryBody(tab);
        }

        function updateCommentaryHideNikudSetting(val) {
            currentSettings.commentaryHideNikud = val;
            rerenderOpenCommentaryPanel();
        }

        function updateCommentaryHideTeamimSetting(val) {
            currentSettings.commentaryHideTeamim = val;
            rerenderOpenCommentaryPanel();
        }

        function updateCommentaryHidePunctuationSetting(val) {
            currentSettings.commentaryHidePunctuation = val;
            rerenderOpenCommentaryPanel();
        }

        // מציג/מסתיר את כותרות המקור שלפני כל קטע בחלונית המפרשים - מחלקת CSS בלבד
        // (body.hide-commentary-refs), בלי לרנדר מחדש את תוכן החלונית ובלי לגעת בספר עצמו
        // (ראו גם תיקון #8 - שינויי תצוגה כאלה לא אמורים "לגעת" בספר).
        function updateCommentaryShowRefsSetting(val) {
            currentSettings.commentaryShowRefs = val;
            document.body.classList.toggle('hide-commentary-refs', !val);
        }

        // מסנכרן את המתגים (ניקוד/טעמים/פיסוק/הצגת כותרות מקור) של חלונית המפרשים עם המצב
        // השמור - נקרא מתוך applySettingsToCSS, בדיוק כמו סנכרון המתגים המקבילים של הספר עצמו.
        function syncCommentaryFilterCheckboxesUI() {
            const nikudCb = document.getElementById('setting-commentary-hide-nikud');
            if (nikudCb) nikudCb.checked = Boolean(currentSettings.commentaryHideNikud);
            const teamimCb = document.getElementById('setting-commentary-hide-teamim');
            if (teamimCb) teamimCb.checked = Boolean(currentSettings.commentaryHideTeamim);
            const punctCb = document.getElementById('setting-commentary-hide-punctuation');
            if (punctCb) punctCb.checked = Boolean(currentSettings.commentaryHidePunctuation);
            const showRefsCb = document.getElementById('setting-commentary-show-refs');
            const showRefs = currentSettings.commentaryShowRefs !== false;
            if (showRefsCb) showRefsCb.checked = showRefs;
            document.body.classList.toggle('hide-commentary-refs', !showRefs);
        }

        // איפוס הגדרות חלונית המפרשים בלבד לברירת המחדל שלהן - לא נוגע בשום הגדרה אחרת (טקסט/
        // הערות/פריסה/צבע וכו').
        function resetCommentarySettings() {
            currentSettings.commentaryFontFamily = null;
            currentSettings.commentaryFontSize = null;
            currentSettings.commentaryLineHeight = null;
            currentSettings.commentaryHideNikud = false;
            currentSettings.commentaryHideTeamim = false;
            currentSettings.commentaryHidePunctuation = false;
            currentSettings.commentaryBgColor = null;
            currentSettings.commentaryShowRefs = true;
            saveSettings();
            applyCustomFontFamily('commentary');
            if (lastKnownTheme) applyTheme(lastKnownTheme);
            applyCommentaryFontSizeCSS();
            applyCommentaryLineHeightCSS();
            syncCommentaryFilterCheckboxesUI();
            applyColorCSSVar('commentaryBg');
            updateColorControlUI('commentaryBg');
            rerenderOpenCommentaryPanel();
        }

        // ============================================================================
        // === שינוי רוחב חלונית המפרשים ע"י גרירה (#commentary-panel-resize-handle) ===
        // הרוחב נשמר ב-currentSettings.commentaryPanelWidth (null = הרוחב הקבוע שב-CSS, 340px)
        // ומוחל בכל טעינת הגדרות (applyCommentaryPanelWidth, נקראת מתוך applySettingsToCSS).
        // ============================================================================

        const COMMENTARY_PANEL_MIN_WIDTH = 220; // תואם ל-min-width שב-CSS על #commentary-panel

        function getCommentaryPanelMaxWidth() {
            // תואם ל-max-width: 45vw שב-CSS על #commentary-panel
            return Math.round(window.innerWidth * 0.45);
        }

        // מחיל על #commentary-panel את הרוחב השמור (אם יש), או חוזר לרוחב הקבוע שב-CSS אם אין
        // (currentSettings.commentaryPanelWidth === null). בטוח לקרוא שוב ושוב (אידמפוטנטי).
        function applyCommentaryPanelWidth() {
            const panel = document.getElementById('commentary-panel');
            if (!panel) return;
            const w = currentSettings.commentaryPanelWidth;
            if (w) {
                const clamped = Math.max(COMMENTARY_PANEL_MIN_WIDTH, Math.min(getCommentaryPanelMaxWidth(), w));
                panel.style.flexBasis = clamped + 'px';
                panel.style.width = clamped + 'px';
            } else {
                panel.style.flexBasis = '';
                panel.style.width = '';
            }
        }

        let commentaryPanelResizeInitialized = false;

        // מאתחל את מנגנון הגרירה פעם אחת בלבד (נקרא בכל applySettingsToCSS, אך נכנס לפעולה רק
        // בפעם הראשונה) - עוקב אחרי עכבר/מגע על #commentary-panel-resize-handle ומעדכן את רוחב
        // #commentary-panel בזמן אמת. בסיום הגרירה שומר את הרוחב הסופי להגדרות, ומפעיל חלוקה
        // מחדש של הדפים (כדי שרוחב האזור הראשי יתעדכן בהתאם למקום שהתפנה/נתפס).
        function initCommentaryPanelResizeOnce() {
            if (commentaryPanelResizeInitialized) return;
            const handle = document.getElementById('commentary-panel-resize-handle');
            const panel = document.getElementById('commentary-panel');
            if (!handle || !panel) return;
            commentaryPanelResizeInitialized = true;

            let dragging = false;
            let startX = 0;
            let startWidth = 0;

            function getClientX(e) {
                if (e.touches && e.touches.length) return e.touches[0].clientX;
                if (e.changedTouches && e.changedTouches.length) return e.changedTouches[0].clientX;
                return e.clientX;
            }

            function onPointerDown(e) {
                dragging = true;
                handle.classList.add('dragging');
                startX = getClientX(e);
                startWidth = panel.getBoundingClientRect().width;
                document.body.style.userSelect = 'none';
                e.preventDefault();
            }

            function onPointerMove(e) {
                if (!dragging) return;
                const clientX = getClientX(e);
                // dir="rtl" תמיד באפליקציה זו (ראו <html dir="rtl">) - החלונית יושבת בצד שמאל
                // המסך, וידית הגרירה נמצאת על הגבול הפנימי שלה (מול תוכן הספר, שנמצא מימינה).
                // גרירה ימינה (כלפי הספר, clientX גדל) דוחפת את הגבול פנימה לתוך שטח הספר -
                // ולכן מרחיבה את החלונית; גרירה שמאלה (הרחק מהספר) מצמצמת אותה.
                const delta = clientX - startX;
                let newWidth = startWidth + delta;
                newWidth = Math.max(COMMENTARY_PANEL_MIN_WIDTH, Math.min(getCommentaryPanelMaxWidth(), newWidth));
                panel.style.flexBasis = newWidth + 'px';
                panel.style.width = newWidth + 'px';
                e.preventDefault();
            }

            function onPointerUp() {
                if (!dragging) return;
                dragging = false;
                handle.classList.remove('dragging');
                document.body.style.userSelect = '';
                const width = Math.round(panel.getBoundingClientRect().width);
                currentSettings.commentaryPanelWidth = width;
                saveSettings();
                // אין צורך בסידור מחדש של הספר - רוחב העמוד קבוע (mm) ואינו תלוי ברוחב חלונית
                // המפרשים כלל, ראו .print-page.
            }

            // לחיצה כפולה על הידית - איפוס הרוחב לברירת המחדל הקבועה (אין צורך בסידור מחדש של
            // הספר, מאותה סיבה כמו ב-onPointerUp למעלה)
            handle.addEventListener('dblclick', () => {
                currentSettings.commentaryPanelWidth = null;
                saveSettings();
                applyCommentaryPanelWidth();
            });

            handle.addEventListener('mousedown', onPointerDown);
            handle.addEventListener('touchstart', onPointerDown, { passive: false });
            window.addEventListener('mousemove', onPointerMove);
            window.addEventListener('touchmove', onPointerMove, { passive: false });
            window.addEventListener('mouseup', onPointerUp);
            window.addEventListener('touchend', onPointerUp);
        }

        // שינוי ה-Zoom (Display Scale) של הדפים ללא חלוקה מחדש
        const MAX_PAGE_SCALE = 4.0;
        const MIN_PAGE_SCALE = 0.45;
        let nextFitMode = 'width';

        function updateFitModeButton() {
            const button = document.getElementById('btn-fit-width');
            if (!button) return;
            const fitsPageNext = nextFitMode === 'page';
            button.innerHTML = fluentIconHTML(fitsPageNext ? 'arrow_autofit_height' : 'arrow_autofit_width');
            button.setAttribute('data-tooltip', fitsPageNext ? 'התאם לעמוד שלם' : 'התאם לרוחב המסך');
        }

        function toggleFitMode() {
            fitToScreen(nextFitMode);
        }

        let handModeEnabled = false;
        let handPointerState = null;

        function toggleHandMode() {
            handModeEnabled = !handModeEnabled;
            const previewArea = document.getElementById('preview-area');
            const button = document.getElementById('btn-hand-mode');
            if (previewArea) previewArea.classList.toggle('hand-mode', handModeEnabled);
            if (button) {
                button.classList.toggle('active', handModeEnabled);
                button.setAttribute('aria-pressed', String(handModeEnabled));
                button.innerHTML = fluentIconHTML('hand_left', '', handModeEnabled);
            }
        }

        const handPreviewArea = document.getElementById('preview-area');
        if (handPreviewArea) {
            handPreviewArea.addEventListener('pointerdown', (event) => {
                if (!handModeEnabled || event.button !== 0) return;
                const target = event.target instanceof Element ? event.target : null;
                if (target && target.closest('button, a, input, select, textarea, [contenteditable="true"]')) return;
                handPointerState = {
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    lastX: event.clientX,
                    lastY: event.clientY
                };
                handPreviewArea.setPointerCapture(event.pointerId);
                event.preventDefault();
            });
            handPreviewArea.addEventListener('pointermove', (event) => {
                if (!handPointerState || handPointerState.pointerId !== event.pointerId) return;
                const deltaX = event.clientX - handPointerState.lastX;
                const deltaY = event.clientY - handPointerState.lastY;
                handPointerState.lastX = event.clientX;
                handPointerState.lastY = event.clientY;
                if (currentSettings.isBookView) {
                    panBookVertically(-deltaY);
                } else {
                    handPreviewArea.scrollBy({
                        left: -deltaX,
                        top: -deltaY,
                        behavior: 'instant'
                    });
                }
                event.preventDefault();
            });
            const finishHandDrag = (event) => {
                if (!handPointerState || handPointerState.pointerId !== event.pointerId) return;
                const deltaX = event.clientX - handPointerState.startX;
                const deltaY = event.clientY - handPointerState.startY;
                if (currentSettings.isBookView && Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
                    if (deltaX < 0) nextBookPage();
                    else prevBookPage();
                }
                handPointerState = null;
            };
            handPreviewArea.addEventListener('pointerup', finishHandDrag);
            handPreviewArea.addEventListener('pointercancel', () => {
                handPointerState = null;
            });
        }

        function zoomIn() {
            if (pageScale >= MAX_PAGE_SCALE) return;
            pageScale = Math.min(pageScale + 0.05, MAX_PAGE_SCALE);
            applyPageScale();
        }

        function zoomOut() {
            if (pageScale <= MIN_PAGE_SCALE) return;
            pageScale = Math.max(pageScale - 0.05, MIN_PAGE_SCALE);
            applyPageScale();
        }

        /* --- גודל עמוד ניתן להתאמה אישית (הגדרות > הגדרות פריסה) ---
           זה שונה מ-fitToScreen/pageScale (זום ויזואלי בלבד): כאן משנים את הממדים האמיתיים של
           העמוד (מ"מ), כך שהעימוד עצמו מתחשב בגודל החדש - יותר טקסט נכנס לעמוד "רחב" יותר, למשל.
           זה מה שמאפשר עמוד שממלא את המסך משני הכיוונים בלי לצמצם (זום) את הטקסט. */
        const PAGE_SIZE_PRESETS = {
            a4: { w: 210, h: 297 },
            a5: { w: 148, h: 210 },
            letter: { w: 215.9, h: 279.4 },
            legal: { w: 215.9, h: 355.6 }
        };

        function applyPageSizeToCSS() {
            const w = currentSettings.pageWidthMm || 210;
            const h = currentSettings.pageHeightMm || 297;
            document.documentElement.style.setProperty('--page-width', w + 'mm');
            document.documentElement.style.setProperty('--page-height', h + 'mm');

            const presetSelect = document.getElementById('setting-page-size-preset');
            const widthInput = document.getElementById('setting-page-width-mm');
            const heightInput = document.getElementById('setting-page-height-mm');
            const customCard = document.getElementById('page-size-custom-card');
            if (widthInput) widthInput.value = w;
            if (heightInput) heightInput.value = h;

            const matchedPreset = Object.keys(PAGE_SIZE_PRESETS).find(key => {
                const p = PAGE_SIZE_PRESETS[key];
                return Math.abs(p.w - w) < 0.5 && Math.abs(p.h - h) < 0.5;
            });
            if (presetSelect) presetSelect.value = matchedPreset || 'custom';
            if (customCard) customCard.style.display = matchedPreset ? 'none' : '';
        }

        function onPageSizePresetChange(value) {
            const customCard = document.getElementById('page-size-custom-card');
            if (value === 'custom') {
                if (customCard) customCard.style.display = '';
                return; // מחכים שהמשתמש יזין מידות בעצמו (או ילחץ "התאם למסך") - לא משנים כלום עדיין
            }
            const preset = PAGE_SIZE_PRESETS[value];
            if (!preset) return;
            if (customCard) customCard.style.display = 'none';
            currentSettings.pageWidthMm = preset.w;
            currentSettings.pageHeightMm = preset.h;
            saveSettings();
            applyPageSizeToCSS();
            triggerRepagination();
        }

        function updateCustomPageSize() {
            const w = parseFloat(document.getElementById('setting-page-width-mm').value);
            const h = parseFloat(document.getElementById('setting-page-height-mm').value);
            if (!w || !h || w < 40 || h < 40) return;
            currentSettings.pageWidthMm = w;
            currentSettings.pageHeightMm = h;
            saveSettings();
            document.documentElement.style.setProperty('--page-width', w + 'mm');
            document.documentElement.style.setProperty('--page-height', h + 'mm');
            triggerRepagination();
        }

        // "התאם אוטומטית למסך שלי" - מחשב גודל עמוד (לא זום!) שממלא את שטח הקריאה הזמין בדיוק,
        // כך שאין רווחים ריקים בצדדים ואין צורך להקטין (לזום) את הטקסט כדי שהעמוד ייכנס
        function fitPageSizeToScreen() {
            const previewArea = document.getElementById('preview-area');
            if (!previewArea) return;
            const pxPerMm = 3.78;
            const availWidthPx = previewArea.clientWidth - 40;
            const availHeightPx = previewArea.clientHeight - 40;
            let wMm = availWidthPx / pxPerMm;
            const hMm = availHeightPx / pxPerMm;
            if (currentSettings.isBookView) wMm = wMm / 2; // בתצוגת ספר יש שני עמודים זה לצד זה

            currentSettings.pageWidthMm = Math.max(60, Math.round(wMm));
            currentSettings.pageHeightMm = Math.max(60, Math.round(hMm));
            pageScale = 1.0; // גודל העמוד עצמו כבר מותאם למסך במלואו - אין צורך גם לזום
            saveSettings();
            applyPageSizeToCSS();
            applyPageScale();
            triggerRepagination();
        }

        // התאמת התצוגה לרוחב או לגובה המסך הזמין
        function fitToScreen(mode) {
            const previewArea = document.getElementById('preview-area');
            if (!previewArea) return;
            // מאפסים קודם כל שינוי padding אופקי שנקבע בעבר ע"י קריאה קודמת ל"התאמה לרוחב" (ראו
            // למטה) - כדי שהמדידות הבאות (clientWidth, פס גלילה) תמיד יתייחסו למצב "נקי" ועקבי,
            // ולא יצטברו/יתעוותו מקריאה לקריאה
            previewArea.style.paddingLeft = '';
            previewArea.style.paddingRight = '';
            const availWidth = previewArea.clientWidth - 40; // מרווח קטן מהקצוות (השוליים האופקיים תמיד נשארים גלויים בפועל, כי העמוד ממורכז ע"י margin:auto)
            // בשונה מהרוחב, ה-padding העליון/תחתון של אזור התצוגה בתצוגת גלילה רגילה (לא ספר) אף
            // פעם לא נשאר גלוי בפועל בזמן קריאה/דפדוף: כל שינוי זום (applyPageScale) גורר אוטומטית
            // גלילה שמיישרת את ראש העמוד הנוכחי בדיוק לראש אזור התצוגה (scrollToPageInScrollView),
            // כלומר ה-padding העליון תמיד "נגלל" הצידה. אם מחשבים את קנה המידה תוך הפחתת ה-padding
            // הזה, העמוד יוצא קטן מדי ונשאר רווח ריק גדול בין תחתית העמוד לתחתית המסך אחרי שהגלילה
            // מתיישרת - ולכן בתצוגת גלילה משתמשים בגובה המלא. בתצוגת ספר (ממורכזת ב-flex, בלי
            // גלילה כזו) הפחתת ה-padding עדיין נכונה כפי שהייתה.
            const availHeight = currentSettings.isBookView ? (previewArea.clientHeight - 40) : previewArea.clientHeight;

            // ממדי העמוד הנוכחי בפיקסלים (בקירוב, לפי 96dpi ~ 3.78 פיקסל למ"מ) - לפי הגודל שהוגדר
            // בהגדרות (--page-width/--page-height), לא בהכרח A4
            const pxPerMm = 3.78;
            const baseWidthMm = currentSettings.pageWidthMm || 210;
            const baseHeightMm = currentSettings.pageHeightMm || 297;
            let pageWidthPx, pageHeightPx;

            if (currentSettings.isBookView) {
                pageWidthPx = baseWidthMm * pxPerMm * 2; // ספר פתוח - שני עמודים
                pageHeightPx = baseHeightMm * pxPerMm;
            } else {
                pageWidthPx = baseWidthMm * pxPerMm;
                pageHeightPx = baseHeightMm * pxPerMm;
            }

            // תצוגת "שני עמודים בשורה" (גלילה רגילה, לא ספר) - כמו בתצוגת ספר, יש להתחשב בכך
            // ששני עמודים מוצגים זה לצד זה באותה שורה בעת חישוב ההתאמה לרוחב/לעמוד. בשונה
            // מתצוגת ספר, כאן אין הכפלה פנימית של 0.46 (זו לא תצוגת book-wrapper), אלא רק תוספת
            // מרווח קבוע בין העמודים (column-gap, ראו הכלל "body.two-column-scroll-active
            // #preview-area") שאינו מוגדל ע"י הזום, ולכן מחוסר מהרוחב הזמין לפני החלוקה.
            const isTwoColumnScroll = currentSettings.twoColumnScroll && !currentSettings.isBookView;
            const TWO_COLUMN_SCROLL_GAP_PX = 8; // חייב להתאים ל-column-gap של body.two-column-scroll-active #preview-area
            const widthBasedScale = isTwoColumnScroll
                ? (availWidth - TWO_COLUMN_SCROLL_GAP_PX) / (pageWidthPx * 2)
                : availWidth / pageWidthPx;

            // תיקון: "התאמה לרוחב" לא צריכה להגיע ממש עד הקצוות בלי שום רווח - במקום זה משאירים
            // בשני הצדדים רווח ריק בגודל בדיוק של פס הגלילה האנכי (0 אם אין פס גלילה כרגע, למשל
            // בתוכן קצר או במערכת עם פסי גלילה "צפים"): בצד שיש בו פס גלילה (משמאל, ב-RTL) העמוד
            // מגיע בדיוק עד לאיפה שהוא מתחיל (clientWidth כבר לא כולל את פס הגלילה עצמו), ובצד
            // הימני (שאין בו פס גלילה) משאירים בדיוק אותו רוחב רווח ריק, לסימטריה - ראו את הגדרת
            // ה-padding בתחתית הפונקציה, אחרי applyPageScale().
            const scrollbarWidth = Math.max(0, previewArea.offsetWidth - previewArea.clientWidth);
            const fullAvailWidth = previewArea.clientWidth - scrollbarWidth;
            const widthBasedScaleEdgeToEdge = isTwoColumnScroll
                ? (fullAvailWidth - TWO_COLUMN_SCROLL_GAP_PX) / (pageWidthPx * 2)
                : fullAvailWidth / pageWidthPx;

            let targetScale;
            if (mode === 'width') {
                targetScale = widthBasedScaleEdgeToEdge;
            } else if (mode === 'height') {
                targetScale = availHeight / pageHeightPx;
            } else {
                // 'page' - העמוד השלם בתוך המסך משני הכיוונים בו-זמנית (כמו "התאם לעמוד" בקוראי PDF) -
                // לוקחים את קנה המידה הקטן מבין השניים, כדי שאף ממד לא ייחתך
                targetScale = Math.min(widthBasedScale, availHeight / pageHeightPx);
            }

            // בתצוגת ספר יש הכפלה פנימית של 0.46, יש להתחשב בכך כדי שהתוצאה תהיה מדויקת
            if (currentSettings.isBookView) {
                targetScale = targetScale / 0.46;
            }

            pageScale = Math.min(MAX_PAGE_SCALE, Math.max(MIN_PAGE_SCALE, targetScale));
            applyPageScale();

            if (mode === 'width') {
                // padding-left:0 - העמוד יגיע בדיוק עד לאיפה שמתחיל פס הגלילה (משמאל, ב-RTL);
                // padding-right בגודל פס הגלילה - אותו רווח ריק בדיוק, בצד שאין בו פס גלילה
                previewArea.style.paddingLeft = '0px';
                previewArea.style.paddingRight = scrollbarWidth + 'px';
            }
            if (mode === 'width' || mode === 'page') {
                nextFitMode = mode === 'width' ? 'page' : 'width';
                updateFitModeButton();
            }
        }

        function applyPageScale() {
            // שימור המיקום הנוכחי (העמוד שרואים כרגע) - שינוי זום לא אמור "להזיז" אותנו לעמוד אחר.
            // זה מה שגרם לבאג שבו התאמה לרוחב תמיד "קפצה" אחורה והתאמה לגובה תמיד "קפצה" קדימה:
            // שינוי קנה המידה משנה את גובה/רוחב העמודים, ומיקום הגלילה (scrollTop) הישן פשוט הפך
            // להצביע על עמוד אחר תחת קנה המידה החדש.
            const posState = (!currentSettings.isBookView) ? capturePositionState() : null;

            document.documentElement.style.setProperty('--page-scale', pageScale);
            localStorage.setItem('advanced_print_scale', pageScale);
            mirrorToOtzariaStorage('advanced_print_scale', pageScale);

            // תיקון: מאפסים כאן את ה-padding האופקי המותאם-אישית שרק "התאמה לרוחב" קובעת (ראו
            // fitToScreen) - כך שכל שינוי קנה מידה אחר (זום+/זום-, התאמה לעמוד/לגובה) חוזר תמיד
            // ל-padding הרגיל, ולא נשאר "תקוע" עם ריפוד לא-סימטרי משארית של "התאמה לרוחב" קודמת.
            // fitToScreen('width') עצמה קוראת שוב ל-applyPageScale (שמאפס כאן), ורק אז מגדירה
            // מחדש את ה-padding המותאם שלה - כך שהאיפוס כאן לא "מנצח" אותה.
            const previewAreaEl = document.getElementById('preview-area');
            if (previewAreaEl) {
                previewAreaEl.style.paddingLeft = '';
                previewAreaEl.style.paddingRight = '';
            }

            document.getElementById('btn-increase-font').disabled = pageScale >= MAX_PAGE_SCALE;
            document.getElementById('btn-decrease-font').disabled = pageScale <= MIN_PAGE_SCALE;

            if (posState) {
                requestAnimationFrame(() => restorePositionState(posState));
            }
            // שינוי זום משנה את גודל הספר, ולכן גם את מגבלות ההיסט האנכי (ראו getMaxBookPanY) -
            // מאפסים את ההיסט הישן כדי שלא יישאר "תקוע" בערך שכבר לא תקף בקנה המידה החדש
            resetBookPanY();
            // שינוי זום משנה את גודל הספר ולכן גם את החפיפה עם חצי הניווט
            requestAnimationFrame(updateNavArrowOverlap);
            // תיקון: מאפשרים גלילה אופקית באזור התצוגה רק כשהתוכן אכן חורג לרוחב בפועל (זום
            // מוגדל מעבר ל"התאמה לרוחב") - כדי שלא יהיה אפשר "לגלול לצדדים" כשהעמוד כבר נכנס
            // לגמרי ברוחב המסך. הבדיקה עצמה רצה בתוך requestAnimationFrame כי ה-padding וה-scale
            // שהוגדרו למעלה עוד לא בהכרח השפיעו על הפריסה בפועל באותו טיק.
            requestAnimationFrame(updatePreviewHorizontalScroll);
        }

        function updatePreviewHorizontalScroll() {
            const previewAreaEl = document.getElementById('preview-area');
            if (!previewAreaEl) return;
            previewAreaEl.style.overflowX =
                (previewAreaEl.scrollWidth > previewAreaEl.clientWidth + 1) ? 'auto' : 'hidden';
        }

        /* --- הזזה אנכית (פאן) של הספר בתצוגת ספר, כשהזום גדול מספיק שהוא חורג מגבולות
           המסך למעלה/למטה --- ניתנת בעזרת חיצי המקלדת מעלה/מטה בלבד; ההזזה הצידה
           (ימינה/שמאלה) ממשיכה לדפדף בין עמודים כרגיל ולא משתנה כלל. */

        // ההיסט האנכי המרבי המותר (בפיקסלים, בכל כיוון) - נגזר מההפרש בין הגובה בפועל של
        // הספר בקנה המידה הנוכחי לבין הגובה הזמין באזור התצוגה. אם הספר לא חורג מהמסך
        // (ההפרש אפס/שלילי) - אין בכלל אפשרות לזוז, והגבול הוא 0.
        function getMaxBookPanY() {
            const previewArea = document.getElementById('preview-area');
            if (!previewArea || !currentSettings.isBookView) return 0;
            const pxPerMm = 3.78;
            const baseHeightMm = currentSettings.pageHeightMm || 297;
            const bookHeightPx = baseHeightMm * pxPerMm * pageScale * 0.46;
            const overflowPx = bookHeightPx - previewArea.clientHeight;
            return overflowPx > 0 ? overflowPx / 2 : 0;
        }

        // איפוס ההיסט האנכי - נקרא בכל פעם שהתוכן/קנה המידה המוצגים משתנים (שינוי זום,
        // דפדוף עמוד, מעבר טאב וכו'), כי היסט ישן לא בהכרח תקין עבורם
        function resetBookPanY() {
            bookPanY = 0;
            document.documentElement.style.setProperty('--book-pan-y', '0px');
        }

        // שחזור ההיסט האנכי (פאן) השמור של טאב ספציפי (או 0 אם אין) - נקרא במעבר בין טאבים
        // בתצוגת ספר, כדי שההיסט יהיה מבודד לכל טאב בנפרד ולא "ידלוף" מטאב לטאב
        function restoreBookPanYForTab(savedValue) {
            bookPanY = savedValue || 0;
            const maxPan = getMaxBookPanY();
            bookPanY = Math.max(-maxPan, Math.min(maxPan, bookPanY));
            document.documentElement.style.setProperty('--book-pan-y', bookPanY + 'px');
        }

        // כמו restoreBookPanYForTab, אך ללא האנימציה (transition) של .book-wrapper - נועד
        // במיוחד למעבר בין טאבים: אם לשני הטאבים היסט אנכי שונה, החלת הערך החדש דרך האנימציה
        // הרגילה הייתה גורמת לספר "לזחול" בצורה נראית לעין למיקומו הנכון מיד אחרי המעבר, במקום
        // להופיע ישר במקום הנכון. משביתים את ה-transition לרגע קצר (עד שהערך הבא מצויר בפועל),
        // ואז מחזירים אותה - כך שדפדוף/פאן רגילים בתוך אותו טאב ממשיכים להיות מונפשים כרגיל.
        function restoreBookPanYForTabInstant(savedValue) {
            const previewArea = document.getElementById('preview-area');
            const bookWrapper = previewArea ? previewArea.querySelector('.book-wrapper') : null;
            if (!bookWrapper) {
                restoreBookPanYForTab(savedValue);
                return;
            }
            const prevTransition = bookWrapper.style.transition;
            bookWrapper.style.transition = 'none';
            restoreBookPanYForTab(savedValue);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    bookWrapper.style.transition = prevTransition;
                });
            });
        }

        // הזזת הספר למעלה/למטה בעזרת חיצי המקלדת. deltaPx חיובי = לכיוון למעלה (חושף את
        // החלק העליון של הספר), שלילי = לכיוון למטה (חושף את החלק התחתון). ההזזה מוגבלת
        // (clamp) לגבולות הספר בפועל ולא מעבר להם. מחזירה true אם בוצעה הזזה בפועל.
        const BOOK_PAN_STEP_PX = 60;
        function panBookVertically(deltaPx) {
            const maxPan = getMaxBookPanY();
            if (maxPan <= 0) return false; // הספר לא חורג מהמסך בזום הנוכחי - אין מה להזיז
            const newPanY = Math.max(-maxPan, Math.min(maxPan, bookPanY + deltaPx));
            if (newPanY === bookPanY) return false; // כבר בגבול - לא זזים יותר
            bookPanY = newPanY;
            document.documentElement.style.setProperty('--book-pan-y', bookPanY + 'px');
            return true;
        }

        function getSettingsStorageKey() {
            return 'advanced_print_settings';
        }

        function saveSettings() {
            const key = getSettingsStorageKey();
            try {
                localStorage.setItem(key, JSON.stringify(currentSettings));
            } catch (e) {
                console.error("Failed to save settings to localStorage", e);
            }
            mirrorToOtzariaStorage(key, currentSettings);
        }

        /* --- בורר גופן עצמאי מהתוכנה (הגדרות > הגדרות גופן) ---
           המקור העיקרי לרשימה הוא fonts.listInstalled (ראו loadInstalledFontsList) - כל הגופנים
           המותקנים בפועל שתומכים בעברית, עם השם המדויק שגם fonts.resolveFamilies תזהה ביצוא.
           רק אם ה-API הזה לא זמין (גרסת אוצריא ישנה) נופלים ל-Local Font Access הסטנדרטי
           (window.queryLocalFonts) ואז לניחוש דרך קנבס, ראו למטה. */
        let installedFontsCache = null;
        let fontPickerHighlightIndex = -1;

        // הגדרות כל בורר גופן: מפתח ההגדרה השמור, משתני ה-CSS שהוא שולט בהם, הטקסט המוצג
        // כברירת מחדל (כשלא נבחר גופן מותאם אישית), והאם נשמרים בייטי גופן ליצוא PDF (ראו
        // getFontBytesForExport) - רלוונטי רק לגופן הספר עצמו, לא לגופן ההערות (תצוגה בלבד).
        const FONT_PICKER_TARGETS = {
            book: { settingKey: 'customFontFamily', cssVar: '--font-book', extraCssVar: null, savePdfBytes: true, defaultLabel: 'גופן תוכנה' },
            note: { settingKey: 'footnoteFontFamily', cssVar: '--font-footnote', extraCssVar: null, savePdfBytes: false, defaultLabel: 'כמו הטקסט (ברירת מחדל)' },
            // גופן חלונית המפרשים - עצמאי לגמרי מגופן הספר (בשונה מהעבר, שבו שינוי גופן הספר היה
            // "חוטף" גם את --font-commentators דרך extraCssVar, בהיעדר בורר ייעודי משלו). ברירת
            // המחדל (value=null) עוקבת אחרי גופן "מפרשים" שמגיע מהתוכנה עצמה - ראו applyTheme.
            commentary: { settingKey: 'commentaryFontFamily', cssVar: '--font-commentators', extraCssVar: null, savePdfBytes: false, defaultLabel: 'גופן מפרשים (ברירת מחדל)' }
        };

        // target חסר = מיישם על שני הבוררים (גופן הספר וגופן ההערות) יחד - נוח לקריאה כללית
        // אחת בעת טעינת/איפוס ההגדרות (ראו applySettingsToCSS/resetToDefaults)
        function applyCustomFontFamily(target) {
            const targets = target ? [target] : Object.keys(FONT_PICKER_TARGETS);
            targets.forEach(t => {
                const cfg = FONT_PICKER_TARGETS[t];
                const root = document.documentElement;
                const trigger = document.getElementById('font-picker-current-name-' + t);
                const appFontBtn = document.getElementById('font-picker-app-font-btn-' + t);
                const value = currentSettings[cfg.settingKey];
                if (value) {
                    const family = `'${value}', 'Segoe UI', Arial, sans-serif`;
                    root.style.setProperty(cfg.cssVar, family);
                    if (cfg.extraCssVar) root.style.setProperty(cfg.extraCssVar, family);
                    if (trigger) trigger.textContent = value;
                    if (appFontBtn) appFontBtn.style.display = '';
                } else {
                    // גופן ההערות (בשונה מגופן הספר וגופן המפרשים) לא מוזן אף פעם דרך ה-theme של
                    // התוכנה - איפוס שלו חייב להסיר את המשתנה במפורש כדי שה-fallback ב-CSS
                    // (var(--font-footnote, var(--font-book))) יחזור לחול. גופן הספר וגופן
                    // המפרשים שניהם עוקבים אחרי ה-theme (ראו applyTheme), ולכן מוחרגים כאן בדיוק
                    // כמו זה מזה - הערך יתעדכן מיד למטה דרך useAppFont.
                    if (t !== 'book' && t !== 'commentary') root.style.removeProperty(cfg.cssVar);
                    if (trigger) trigger.textContent = cfg.defaultLabel;
                    if (appFontBtn) appFontBtn.style.display = 'none';
                }
            });
        }

        function useAppFont(target) {
            const cfg = FONT_PICKER_TARGETS[target];
            currentSettings[cfg.settingKey] = null;
            saveSettings();
            applyCustomFontFamily(target);
            // גופן הספר וגופן המפרשים עוקבים אחרי גופן התוכנה (theme, כל אחד אחרי המשתנה שלו) -
            // חוזרים למעקב מיד, בלי לחכות לאירוע theme.changed הבא. גופן ההערות פשוט חוזר לעקוב
            // אחרי גופן הספר דרך ה-CSS fallback.
            if ((target === 'book' || target === 'commentary') && lastKnownTheme) applyTheme(lastKnownTheme);
        }

        async function toggleFontPickerInline(target) {
            const inline = document.getElementById('font-picker-inline-' + target);
            const trigger = document.getElementById('font-picker-trigger-' + target);
            const isOpen = inline.classList.contains('open');
            // סוגר את הבורר השני אם פתוח, כדי שרק בורר גופן אחד יהיה פתוח בכל רגע (כמו בורר הצבע)
            Object.keys(FONT_PICKER_TARGETS).forEach(t => {
                if (t !== target) closeFontPickerInline(t);
            });
            if (isOpen) {
                closeFontPickerInline(target);
                return;
            }
            inline.classList.add('open');
            trigger.classList.add('open');
            const searchInput = document.getElementById('font-picker-search-' + target);
            searchInput.value = '';
            searchInput.focus();
            fontPickerHighlightIndex = -1;
            await loadInstalledFontsList(target);
        }

        function closeFontPickerInline(target) {
            const inline = document.getElementById('font-picker-inline-' + target);
            const trigger = document.getElementById('font-picker-trigger-' + target);
            if (inline) inline.classList.remove('open');
            if (trigger) trigger.classList.remove('open');
        }

        // רשימת גופנים "מועמדים" לבדיקת זמינות בפועל (Windows/Office נפוצים + גופני עברית/יודאיקה
        // נפוצים) - משמשת רק כשה-Local Font Access API (queryLocalFonts) לא זמין/נדחה, שזה המצב
        // הנפוץ בתוך webview מוטמע כמו של אוצריא. זו לא באמת "כל הגופנים האפשריים במחשב" - אם חסר
        // גופן ברשימה אפשר תמיד להקליד את שמו המדויק בשדה החיפוש וללחוץ Enter.
        const FONT_TEST_STRING = 'מבדק1234abcXYZ';
        const FONT_DETECTION_CANDIDATES = [
            'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas',
            'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic Medium', 'Gabriola',
            'Gadugi', 'Georgia', 'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Malgun Gothic',
            'Microsoft Sans Serif', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Black',
            'Segoe UI Light', 'Segoe UI Semibold', 'Sylfaen', 'Tahoma', 'Times New Roman',
            'Trebuchet MS', 'Verdana', 'Bahnschrift',
            'Book Antiqua', 'Bookman Old Style', 'Century Gothic', 'Century', 'Garamond',
            'Palatino Linotype', 'Rockwell',
            'David', 'David CLM', 'Frank Ruhl', 'Frank Ruhl CLM', 'Frank Ruhl Libre', 'Miriam',
            'Miriam CLM', 'Miriam Mono CLM', 'Narkisim', 'Rod', 'Guttman Yad', 'Guttman Stam',
            'Guttman Aharoni', 'Guttman Haim', 'Guttman Rashi', 'Guttman Vilna', 'Guttman Yad-Brush',
            'Nachlieli', 'Aharoni', 'Aharoni CLM', 'Ktav', 'Shofar', 'Simple CLM', 'Yehuda CLM',
            'Cardo', 'SBL Hebrew', 'Ezra SIL', 'Taamey Frank CLM', 'Adobe Hebrew', 'Alef',
            'Alef Hebrew', 'Rubik', 'Heebo', 'Assistant', 'Open Sans Hebrew', 'Noto Sans Hebrew',
            'Noto Serif Hebrew'
        ];

        function detectAvailableFontsViaCanvas() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const fallbacks = ['monospace', 'serif', 'sans-serif'];
            const baseWidths = {};
            fallbacks.forEach(fb => {
                ctx.font = `72px ${fb}`;
                baseWidths[fb] = ctx.measureText(FONT_TEST_STRING).width;
            });

            return FONT_DETECTION_CANDIDATES.filter(name => {
                return fallbacks.some(fb => {
                    ctx.font = `72px '${name}', ${fb}`;
                    return ctx.measureText(FONT_TEST_STRING).width !== baseWidths[fb];
                });
            }).sort((a, b) => a.localeCompare(b, 'he'));
        }

        // רשימת הגופנים המוצגת היא איחוד של הגופנים שזוהו אוטומטית + כל גופן שהמשתמש הקליד/בחר
        // בעבר ונשמר (currentSettings.savedFontNames) - כדי שגם גופן שהוקלד ידנית פעם אחת יופיע
        // ברשימה בפעם הבאה, עם אפשרות הסרה (X) שרלוונטית רק לגופנים שנשמרו ידנית
        function getMergedFontList() {
            const detected = installedFontsCache || [];
            const saved = currentSettings.savedFontNames || [];
            const merged = Array.from(new Set([...detected, ...saved]));
            return merged.sort((a, b) => a.localeCompare(b, 'he'));
        }

        async function loadInstalledFontsList(target) {
            const list = document.getElementById('font-picker-list-' + target);
            if (installedFontsCache) {
                renderFontPickerList(getMergedFontList(), target);
                return;
            }
            list.innerHTML = '<div class="font-picker-empty">טוען רשימת גופנים...</div>';

            let names = [];

            // מקור ראשון ומהימן: fonts.listInstalled (זמין מ-0.9.97, ראו API_REFERENCE) - מחזיר
            // את כל הגופנים המותקנים במחשב בפועל, עם השם המדויק כפי ש-CSS font-family מקבל אותו
            // וגם את רשימת הסקריפטים שכל גופן תומך בהם - ולכן אפשר לסנן ישירות לגופנים שתומכים
            // עברית. חשוב: מכיוון שהשם מגיע מדויק מה-API ולא מניחוש, הוא יימצא בדיוק גם על ידי
            // fonts.resolveFamilies בזמן יצוא PDF (ראו getFontBytesForExport) - בלי אי-התאמות כתיב.
            // שים לב: גופן עם הגבלת רישיון הטבעה (fsType) עדיין יופיע כאן (הוא מותקן בפועל), אבל
            // יצוא PDF עדיין ייפול עבורו לתחליף - לכך עדיין קיימת אפשרות "בחר קובץ מהמחשב" למטה.
            try {
                const result = await Otzaria.call('fonts.listInstalled');
                if (result && result.success && result.data && Array.isArray(result.data.families)) {
                    names = result.data.families
                        .filter(f => Array.isArray(f.scripts) && f.scripts.includes('hebrew'))
                        .map(f => f.name);
                }
            } catch (e) { /* לא זמין בגרסה הנוכחית - ננסה את השיטות החלופיות למטה */ }

            if (names.length === 0) {
                try {
                    if ('queryLocalFonts' in window) {
                        const fonts = await window.queryLocalFonts();
                        names = Array.from(new Set(fonts.map(f => f.family)));
                    }
                } catch (e) { /* לא זמין/נדחה - ננסה את שיטת הזיהוי החלופית למטה */ }
            }

            if (names.length > 0) {
                names.sort((a, b) => a.localeCompare(b, 'he'));
            } else {
                // שיטה חלופית שעובדת בכל webview בלי הרשאות מיוחדות: משווים רוחב טקסט מדוד
                // בקנבס מול גופן ברירת מחדל, כדי לגלות אילו מתוך רשימת המועמדים מותקנים בפועל
                try {
                    names = detectAvailableFontsViaCanvas();
                } catch (e) {
                    names = [];
                }
            }

            installedFontsCache = names;
            const merged = getMergedFontList();
            if (merged.length > 0) {
                renderFontPickerList(merged, target);
            } else {
                list.innerHTML = `
                    <div class="font-picker-empty">
                        לא ניתן לזהות אוטומטית גופנים מותקנים כרגע.<br>
                        אפשר במקום זאת להקליד למעלה את השם המדויק של הגופן הרצוי וללחוץ Enter.
                    </div>`;
            }
        }

        function renderFontPickerList(names, target) {
            const list = document.getElementById('font-picker-list-' + target);
            const cfg = FONT_PICKER_TARGETS[target];
            fontPickerHighlightIndex = -1;
            list.innerHTML = '';

            if (!names || names.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'font-picker-empty';
                empty.textContent = 'לא נמצאו גופנים תואמים.';
                list.appendChild(empty);
            } else {
                const savedNames = currentSettings.savedFontNames || [];
                names.forEach(name => {
                    const item = document.createElement('div');
                    item.className = 'font-picker-item';
                    if (name === currentSettings[cfg.settingKey]) item.classList.add('selected');
                    item.style.fontFamily = `'${name}'`;

                    const label = document.createElement('span');
                    label.textContent = name;
                    item.appendChild(label);
                    item.onclick = () => selectFontFromPicker(name, target);

                    if (savedNames.includes(name)) {
                        const removeBtn = document.createElement('button');
                        removeBtn.type = 'button';
                        removeBtn.className = 'font-picker-item-remove';
                        removeBtn.textContent = '✕';
                        removeBtn.setAttribute('data-tooltip', 'הסר מהרשימה');
                        removeBtn.onclick = (e) => {
                            e.stopPropagation();
                            removeSavedFontName(name);
                        };
                        item.appendChild(removeBtn);
                    }

                    list.appendChild(item);
                });
            }

            // שורה קבועה בתחתית הרשימה - בחירת קובץ גופן מהמחשב (מוצגת תמיד, גם כשהרשימה למעלה ריקה)
            const fileItem = document.createElement('div');
            fileItem.className = 'font-picker-item font-picker-item-file-option';
            fileItem.innerHTML = '<span>בחר קובץ מהמחשב...</span>';
            fileItem.onclick = () => document.getElementById('font-picker-file-input-' + target).click();
            list.appendChild(fileItem);
        }

        function removeSavedFontName(name) {
            currentSettings.savedFontNames = (currentSettings.savedFontNames || []).filter(n => n !== name);
            saveSettings();
            // אם הגופן שהוסר הוא הנבחר כרגע (בגופן הספר ו/או בגופן ההערות) - חוזרים לברירת המחדל
            // של אותו בורר כדי לא להישאר עם הגדרה יתומה
            Object.keys(FONT_PICKER_TARGETS).forEach(t => {
                if (currentSettings[FONT_PICKER_TARGETS[t].settingKey] === name) {
                    useAppFont(t);
                }
            });
            Object.keys(FONT_PICKER_TARGETS).forEach(t => {
                const searchInput = document.getElementById('font-picker-search-' + t);
                if (searchInput && document.getElementById('font-picker-inline-' + t).classList.contains('open')) {
                    filterFontPickerList(t);
                }
            });
        }

        function filterFontPickerList(target) {
            const query = document.getElementById('font-picker-search-' + target).value.trim().toLowerCase();
            fontPickerHighlightIndex = -1;
            const all = getMergedFontList();
            const filtered = query ? all.filter(n => n.toLowerCase().includes(query)) : all;
            renderFontPickerList(filtered, target);
        }

        function handleFontPickerKeydown(e, target) {
            const items = Array.from(document.querySelectorAll('#font-picker-list-' + target + ' .font-picker-item'));
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (items.length === 0) return;
                if (fontPickerHighlightIndex >= 0 && items[fontPickerHighlightIndex]) items[fontPickerHighlightIndex].classList.remove('highlighted');
                fontPickerHighlightIndex = (fontPickerHighlightIndex + 1) % items.length;
                items[fontPickerHighlightIndex].classList.add('highlighted');
                items[fontPickerHighlightIndex].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (items.length === 0) return;
                if (fontPickerHighlightIndex >= 0 && items[fontPickerHighlightIndex]) items[fontPickerHighlightIndex].classList.remove('highlighted');
                fontPickerHighlightIndex = (fontPickerHighlightIndex - 1 + items.length) % items.length;
                items[fontPickerHighlightIndex].classList.add('highlighted');
                items[fontPickerHighlightIndex].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (fontPickerHighlightIndex >= 0 && items[fontPickerHighlightIndex]) {
                    items[fontPickerHighlightIndex].click();
                } else {
                    // אין גופן מסומן ברשימה (או שהרשימה ריקה/לא נתמכת) - נשתמש בטקסט שהוקלד כשם גופן חופשי
                    const typed = document.getElementById('font-picker-search-' + target).value.trim();
                    if (typed) selectFontFromPicker(typed, target);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeFontPickerInline(target);
            }
        }

        function selectFontFromPicker(name, target) {
            const cfg = FONT_PICKER_TARGETS[target];
            currentSettings[cfg.settingKey] = name;
            // שמירת הגופן ברשימה הקבועה (אם עוד לא שמור) - כדי שגם גופן שהוקלד ידנית יופיע ברשימה בפעם הבאה
            if (!currentSettings.savedFontNames) currentSettings.savedFontNames = [];
            if (!currentSettings.savedFontNames.includes(name) && !(installedFontsCache || []).includes(name)) {
                currentSettings.savedFontNames.push(name);
            }
            saveSettings();
            applyCustomFontFamily(target);
            closeFontPickerInline(target);
        }

        // בחירת גופן מתוך קובץ מהמחשב (שורת "בחר קובץ מהמחשב..." שבתחתית בורר הגופנים) - בשונה
        // מבחירה לפי שם, כאן גם נרשם FontFace אמיתי (כי סביר שהשם לא מזוהה כגופן מערכת מותקן).
        // בגופן הספר (target='book') נשמרים גם הבייטים הגולמיים לצורך יצוא PDF (ראו
        // getFontBytesForExport); גופן ההערות הוא לתצוגה בלבד ואינו משפיע על יצוא PDF, ולכן
        // הבייטים לא נשמרים עבורו. בכוונה לא נשמר ל-savedFontNames הרגילה: בחירה חוזרת של אותו
        // שם דרך המסלול הרגיל (לפי שם בלבד) לא הייתה רושמת מחדש FontFace, ולכן הייתה "נשברת"
        // חזותית בטעות.
        async function onFontPickerFileChosen(e, target) {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const buf = await file.arrayBuffer();
            const displayName = file.name.replace(/\.[^.]+$/, '');

            try {
                const fontFace = new FontFace(displayName, buf);
                await fontFace.load();
                document.fonts.add(fontFace);
            } catch (err) {
                console.error('רישום קובץ הגופן כ-FontFace נכשל', err);
            }

            if (FONT_PICKER_TARGETS[target].savePdfBytes) {
                savePdfExportFontBytes(buf, displayName);
            }

            currentSettings[FONT_PICKER_TARGETS[target].settingKey] = displayName;
            saveSettings();
            applyCustomFontFamily(target);
            closeFontPickerInline(target);
        }

        // שמירת ושחזור המיקום הנוכחי (עמוד/עלה) כדי שסידור מחדש של הדפים לא יקפוץ לתחילת הספר