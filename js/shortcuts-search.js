        function formatShortcutKeyLabel(key) {
            if (!key) return '';
            if (SHORTCUT_KEY_LABELS[key]) return SHORTCUT_KEY_LABELS[key];
            return key.toUpperCase();
        }

        function comboToLabel(combo) {
            if (!combo || !combo.key) return 'לא הוגדר קיצור';
            const parts = [];
            if (combo.ctrl) parts.push('CTRL');
            if (combo.shift) parts.push('SHIFT');
            if (combo.alt) parts.push('ALT');
            if (combo.meta) parts.push('WIN');
            parts.push(formatShortcutKeyLabel(combo.key));
            return parts.join(' + ');
        }

        function getShortcutCombo(id) {
            const custom = currentSettings.customShortcuts && currentSettings.customShortcuts[id];
            if (custom && custom.key) return custom;
            const def = SHORTCUT_DEFS.find(d => d.id === id);
            return def ? def.combo : null;
        }

        function eventMatchesShortcutCombo(e, combo) {
            if (!combo || !combo.key) return false;
            if (Boolean(e.ctrlKey) !== Boolean(combo.ctrl)) return false;
            if (Boolean(e.shiftKey) !== Boolean(combo.shift)) return false;
            if (Boolean(e.altKey) !== Boolean(combo.alt)) return false;
            if (Boolean(e.metaKey) !== Boolean(combo.meta)) return false;
            const k = combo.key;
            if (k === '=') return (e.key === '=' || e.key === '+' || e.key === 'Add');
            if (k === '-') return (e.key === '-' || e.key === 'Subtract');
            if (k.length === 1) return e.key.toLowerCase() === k.toLowerCase();
            return e.key === k;
        }

        function matchesShortcutAction(e, id) {
            return eventMatchesShortcutCombo(e, getShortcutCombo(id));
        }

        const SHORTCUT_ICON_UNCHECKED = fluentIconHTML('checkbox_unchecked');
        const SHORTCUT_ICON_CHECKED = fluentIconHTML('checkbox_checked');
        const SHORTCUT_PENCIL_ICON = fluentIconHTML('edit', 'shortcut-pencil-icon');

        let shortcutModalActionId = null;
        let shortcutModalPendingCombo = null;
        let isRecordingShortcut = false;

        // מעבר בין לשוניות פאנל ההגדרות (כללי / קיצורים)
        function switchSettingsTab(tab) {
            const btnGeneral = document.getElementById('settings-tab-btn-general');
            const btnNotes = document.getElementById('settings-tab-btn-notes');
            const btnShortcuts = document.getElementById('settings-tab-btn-shortcuts');
            const paneGeneral = document.getElementById('settings-pane-general');
            const paneNotes = document.getElementById('settings-pane-notes');
            const paneShortcuts = document.getElementById('settings-pane-shortcuts');
            if (btnGeneral) btnGeneral.classList.toggle('active', tab === 'general');
            if (btnNotes) btnNotes.classList.toggle('active', tab === 'notes');
            if (btnShortcuts) btnShortcuts.classList.toggle('active', tab === 'shortcuts');
            if (paneGeneral) paneGeneral.classList.toggle('active', tab === 'general');
            if (paneNotes) paneNotes.classList.toggle('active', tab === 'notes');
            if (paneShortcuts) paneShortcuts.classList.toggle('active', tab === 'shortcuts');
        }

        function renderShortcutsList() {
            const container = document.getElementById('shortcuts-list-container');
            if (!container) return;
            container.innerHTML = '';
            SHORTCUT_DEFS.forEach(def => {
                const card = document.createElement('div');
                card.className = 'settings-card';

                const group = document.createElement('div');
                group.className = 'settings-control-group';

                const label = document.createElement('label');
                label.textContent = def.label;
                group.appendChild(label);

                const box = document.createElement('button');
                box.type = 'button';
                box.className = 'shortcut-value-box';
                box.setAttribute('data-tooltip', 'שנה קיצור מקשים');
                box.onclick = () => openShortcutModal(def.id);

                const textSpan = document.createElement('span');
                textSpan.className = 'shortcut-value-text';
                textSpan.textContent = comboToLabel(getShortcutCombo(def.id));
                box.appendChild(textSpan);
                box.insertAdjacentHTML('beforeend', SHORTCUT_PENCIL_ICON);

                group.appendChild(box);
                card.appendChild(group);
                container.appendChild(card);
            });
        }

        function openShortcutModal(id) {
            const def = SHORTCUT_DEFS.find(d => d.id === id);
            if (!def) return;
            shortcutModalActionId = id;
            shortcutModalPendingCombo = getShortcutCombo(id);
            isRecordingShortcut = false;
            document.getElementById('shortcut-modal-funcname').textContent = def.label;
            updateShortcutModalDisplay();
            document.getElementById('shortcut-modal-overlay').classList.add('open');
        }

        function closeShortcutModal() {
            isRecordingShortcut = false;
            shortcutModalActionId = null;
            shortcutModalPendingCombo = null;
            document.getElementById('shortcut-modal-overlay').classList.remove('open');
        }

        function updateShortcutModalDisplay() {
            const valueEl = document.getElementById('shortcut-modal-value');
            const boxEl = document.getElementById('shortcut-modal-box');
            const recordLabelEl = document.getElementById('shortcut-modal-record-label');
            const recordBtn = document.getElementById('shortcut-modal-record-btn');
            const iconEl = document.getElementById('shortcut-modal-record-icon');
            if (!valueEl || !boxEl || !recordLabelEl || !recordBtn || !iconEl) return;

            if (isRecordingShortcut) {
                boxEl.classList.add('recording');
                valueEl.textContent = (shortcutModalPendingCombo && shortcutModalPendingCombo.key)
                    ? comboToLabel(shortcutModalPendingCombo)
                    : 'לחץ על המקשים...';
                recordLabelEl.textContent = 'עצור הקלטה';
                iconEl.innerHTML = SHORTCUT_ICON_CHECKED;
                recordBtn.classList.add('recording');
            } else {
                boxEl.classList.remove('recording');
                valueEl.textContent = comboToLabel(shortcutModalPendingCombo);
                recordLabelEl.textContent = 'התחל הקלטה';
                iconEl.innerHTML = SHORTCUT_ICON_UNCHECKED;
                recordBtn.classList.remove('recording');
            }
        }

        function toggleShortcutRecording() {
            if (isRecordingShortcut) {
                // עצירת הקלטה - אם לא נלחץ אף מקש תוכן (רק מקשי-עזר, או כלום) חוזרים ל"לא הוגדר קיצור"
                isRecordingShortcut = false;
                if (!shortcutModalPendingCombo || !shortcutModalPendingCombo.key) {
                    shortcutModalPendingCombo = null;
                }
                updateShortcutModalDisplay();
            } else {
                isRecordingShortcut = true;
                shortcutModalPendingCombo = { ctrl: false, shift: false, alt: false, meta: false, key: null };
                updateShortcutModalDisplay();
            }
        }

        function handleShortcutRecordingKeydown(e) {
            e.preventDefault();
            e.stopPropagation();
            const key = e.key;

            if (key === 'Escape') {
                // Escape מבטל את ההקלטה הנוכחית (לא נשמר כקיצור) ומחזיר למצב "לא הוגדר קיצור"
                isRecordingShortcut = false;
                shortcutModalPendingCombo = null;
                updateShortcutModalDisplay();
                return;
            }

            if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') {
                // מקש-עזר בלבד נלחץ עד כה - מציגים את הצירוף החי, אך עדיין ללא מקש "עיקרי"
                shortcutModalPendingCombo = {
                    ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
                    key: (shortcutModalPendingCombo ? shortcutModalPendingCombo.key : null)
                };
                updateShortcutModalDisplay();
                return;
            }

            shortcutModalPendingCombo = { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, key: key };
            updateShortcutModalDisplay();
        }

        // איפוס קיצורי המקשים בלבד לברירת המחדל שלהם (SHORTCUT_DEFS) - בשונה מכפתור "איפוס
        // להגדרות ברירת מחדל" שבלשונית "כללי" (resetToDefaults), שממשיך לאפס את כל ההגדרות יחד
        // כולל הקיצורים; כאן נוגעים אך ורק ב-customShortcuts ולא בשום הגדרה אחרת.
        function resetShortcutsToDefaults() {
            currentSettings.customShortcuts = {};
            saveSettings();
            renderShortcutsList();
        }

        function confirmShortcutModal() {
            if (!shortcutModalActionId) return;
            if (!currentSettings.customShortcuts) currentSettings.customShortcuts = {};
            if (shortcutModalPendingCombo && shortcutModalPendingCombo.key) {
                currentSettings.customShortcuts[shortcutModalActionId] = shortcutModalPendingCombo;
            } else {
                delete currentSettings.customShortcuts[shortcutModalActionId];
            }
            saveSettings();
            renderShortcutsList();
            closeShortcutModal();
        }

let searchDebounceTimer = null;
        function handleDrawerSearch() {
            if (currentRailTab === 'search') {
                document.getElementById('drawer-search-book')?.classList.toggle(
                    'has-query',
                    Boolean(document.getElementById('book-search')?.value)
                );
                // ביטול החיפוש הקודם אם המשתמש עדיין מקליד
                clearTimeout(searchDebounceTimer);
                
                // המתנה של 350ms לאחר הפסקת ההקלדה לפני הרצת החיפוש
                searchDebounceTimer = setTimeout(() => {
                    searchInBook();
                }, 500);
            } else {
                filterTOC();
            }
        }

        function clearBookSearch() {
            const input = document.getElementById('book-search');
            input.value = '';
            document.getElementById('drawer-search-book')?.classList.remove('has-query');
            clearTimeout(searchDebounceTimer);
            searchInBook();
            input.focus();
        }

        function refreshSearchIfActive() {
            if (currentRailTab !== 'search') return;
            const query = document.getElementById('book-search')?.value?.trim();
            if (query && query.length >= 3) {
                searchInBook();
            }
        }

        function applyTheme(theme) {
            if (!theme || !theme.colorScheme) return;
            lastKnownTheme = theme;
            const root = document.documentElement;
            const cs = theme.colorScheme;
          
            root.style.setProperty('--color-primary', cs.primary);
            root.style.setProperty('--color-on-primary', cs.onPrimary);
            root.style.setProperty('--color-primary-container', cs.primaryContainer);
            root.style.setProperty('--color-on-primary-container', cs.onPrimaryContainer);
    
            root.style.setProperty('--color-secondary', cs.secondary);
            root.style.setProperty('--color-on-secondary', cs.onSecondary);
            root.style.setProperty('--color-secondary-container', cs.secondaryContainer);
            root.style.setProperty('--color-on-secondary-container', cs.onSecondaryContainer);
    
            root.style.setProperty('--color-tertiary', cs.tertiary);
            root.style.setProperty('--color-on-tertiary', cs.onTertiary);
            root.style.setProperty('--color-tertiary-container', cs.tertiaryContainer);
            root.style.setProperty('--color-on-tertiary-container', cs.onTertiaryContainer);
    
            root.style.setProperty('--color-surface', cs.surface);
            root.style.setProperty('--color-on-surface', cs.onSurface);
            root.style.setProperty('--color-on-surface-variant', cs.onSurfaceVariant || cs.onSurface);
            root.style.setProperty('--color-inverse-surface', cs.inverseSurface || cs.onSurface);
            root.style.setProperty('--color-on-inverse-surface', cs.onInverseSurface || cs.surface);
    
            root.style.setProperty('--color-surface-container-lowest', cs.surfaceContainerLowest || cs.surface);
            root.style.setProperty('--color-surface-container-low', cs.surfaceContainerLow || cs.surface);
            root.style.setProperty('--color-surface-container', cs.surfaceContainer || cs.surface);
            root.style.setProperty('--color-surface-container-high', cs.surfaceContainerHigh || cs.surfaceContainerHighest || cs.surface);
            root.style.setProperty('--color-surface-container-highest', cs.surfaceContainerHighest || cs.surface);
    
            root.style.setProperty('--color-error', cs.error);
            root.style.setProperty('--color-on-error', cs.onError);
            root.style.setProperty('--color-error-container', cs.errorContainer);
                      
            // קו המתאר מבוסס על onSurfaceVariant לפי רשימת הצבעים
            root.style.setProperty('--color-outline', cs.onSurfaceVariant || cs.outline);
            root.style.setProperty('--color-outline-variant', cs.outlineVariant || cs.outline);

            const surfaces = theme.surfaces || {};
            const topBarBackground = surfaces.topBar || cs.surfaceContainerHigh || cs.surface;
            root.style.setProperty('--color-top-bar-background', topBarBackground);
            root.style.setProperty('--color-panel-background', surfaces.panel || cs.surface);
            root.style.setProperty('--color-card-background', surfaces.card || cs.surface);
            root.style.setProperty('--color-nav-panel-background', topBarBackground);
            root.style.setProperty('--app-radius', `${theme.radius || 8}px`);

            const density = theme.density || {};
            const topBarHeight = Number(density.topBarHeight) || 56;
            root.style.setProperty('--top-bar-height', `${topBarHeight}px`);
            root.style.setProperty('--toolbar-button-size', density.compact ? '36px' : '40px');
            root.style.setProperty('--toolbar-icon-size', density.compact ? '18px' : '20px');
            document.body.classList.toggle('app-compact-density', Boolean(density.compact));

            root.style.setProperty('--color-primary-subtle', hexToRgba(cs.primary, 0.12));
            root.style.setProperty('--color-secondary-subtle', hexToRgba(cs.secondary, 0.12));
            root.style.setProperty('--color-border-subtle', hexToRgba(cs.outlineVariant || cs.outline, 0.2));
            root.style.setProperty('--color-error-subtle', hexToRgba(cs.error, 0.12));
            root.style.setProperty('--color-on-surface-subtle', hexToRgba(cs.onSurface, 0.6));
            root.style.setProperty('--color-outline-subtle', hexToRgba(cs.outlineVariant || cs.outline, 0.2));

            // כיסוי על-ידי המצב (כהה/בהיר) עם class ב-body
            document.body.classList.toggle('dark-mode', theme.mode === 'dark');

            if (theme.typography) {
                const t = theme.typography;
                const uiFont = t.uiFont || (t.uiFontFamily
                    ? `'${t.uiFontFamily}', 'Segoe UI', Arial, sans-serif`
                    : null);
                if (uiFont) root.style.setProperty('--font-ui', uiFont);
                // אם המשתמש בחר גופן ידני מתוך התוסף (customFontFamily/commentaryFontFamily) -
                // הוא עצמאי לחלוטין מהתוכנה, ואסור שעדכון theme.changed/plugin.boot ידרוס אותו.
                // שני הגופנים (ספר/מפרשים) נבדקים ומעודכנים בנפרד לגמרי זה מזה - בחירה ידנית
                // באחד אינה משפיעה על השני (ראו FONT_PICKER_TARGETS).
                if (!currentSettings.customFontFamily) {
                    // שימוש בגופן המדוייק שמגיע מהתוכנה (עם ברירת מחדל ל-Segoe UI אם חסר)
                    const bookFontFamily = t.fontFamily ? `'${t.fontFamily}'` : "'Segoe UI'";
                    root.style.setProperty('--font-book', `${bookFontFamily}, 'Segoe UI', Arial, sans-serif`);
                }
                if (!currentSettings.commentaryFontFamily) {
                    const commentatorsFontFamily = t.commentatorsFontFamily ? `'${t.commentatorsFontFamily}'` : "'Segoe UI'";
                    root.style.setProperty('--font-commentators', `${commentatorsFontFamily}, 'Segoe UI', Arial, sans-serif`);
                }

                // גודל הגופן ומרווח השורות מוחרגים בכוונה: לא נמשכים מהתוכנה בכלל, נשארים תלויים
                // אך ורק בהגדרות התוסף עצמו (אותה סיבה בדיוק שבגללה הוחרג גודל הגופן קודם).
            }
        }

        function hexToRgba(hex, alpha) {
            if(!hex) return `rgba(0,0,0,${alpha})`;
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }

// בניית עץ הניווט מתוכן העניינים ה"רשמי" של הספר (library.getBookToc) - כל פריט מגיע כבר עם
        // level ועם index (אינדקס שורה 0-based, אותה מערכת מספור בדיוק כמו data-line-idx שהוזרק
        // ב-fetchEntireBook) - כך שניתן לקפוץ לעמוד המדויק דרך locatePageIndexForLineIndex, בלי
        // תלות בכותרות HTML שהתגלו בפועל בטקסט המעובד.
        // כפתור הרחבה/כיווץ של שורת כותרת - בסוף השורה (כמו IconButton של NavTreeTile באוצריא), עם
        // טולטיפ לפי הפעולה ("הרחב"/"כווץ") ושברון שמסתובב לפי המצב
        function syncTocToggle(toggleBtn) {
            const wrapper = toggleBtn.closest('.toc-item-wrapper');
            const expanded = Boolean(wrapper && wrapper.classList.contains('expanded'));
            const label = expanded ? 'כווץ' : 'הרחב';
            toggleBtn.setAttribute('data-tooltip', label);
            toggleBtn.setAttribute('aria-label', label);
            toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }

        // מרענן את מצב כל הכפתורים אחרי הרחבה/כיווץ תכנותיים (שחזור מצב, סינון, ניקוי סינון)
        function refreshTocToggleStates() {
            document.querySelectorAll('#toc-list .toc-toggle').forEach(syncTocToggle);
        }


        // ===== הדגשת הכותרת הנוכחית בתוכן העניינים (כמו השורה הנבחרת ב-NavTreeTile באוצריא) =====
        // "הכותרת הנוכחית" = הכותרת האחרונה שהתחילה עד קו הייחוס: אמצע אזור התצוגה בגלילה רגילה,
        // ועד סוף העמוד המוצג בתצוגת ספר. כשהכותרת נמצאת בתוך ענף מכווץ, ההדגשה (העדינה) עוברת להורה
        // המכווץ הגלוי הקרוב - כך שתמיד רואים באיזה חלק של הספר נמצאים.
        let tocCurrentItem = null;
        let tocCurrentRep = null;
        let tocCurrentTimer = null;

        function isNavTocVisible() {
            const panel = document.querySelector('.overlay-panel');
            return Boolean(panel && panel.classList.contains('open') && currentRailTab === 'nav');
        }

        function computeCurrentTocItem() {
            const tocList = document.getElementById('toc-list');
            const previewArea = document.getElementById('preview-area');
            if (!tocList || !previewArea) return null;
            const items = Array.from(tocList.querySelectorAll('.toc-item[data-line-index], .toc-item[data-heading-id]'));
            if (items.length === 0) return null;
            const pages = Array.from(previewArea.querySelectorAll('.print-page'));
            if (pages.length === 0) return null;
            const isBook = Boolean(currentSettings.isBookView);
            const pageIdx = Math.min(Math.max(isBook ? currentLeaf * 2 : getScrollCurrentPage(), 0), pages.length - 1);
            const refLine = previewArea.getBoundingClientRect().top + previewArea.clientHeight * 0.5;

            // חיפוש בינארי על פריטים שמסודרים לפי סדר הטקסט: האחרון שמקיים את התנאי
            const lastWhere = (pred) => {
                let lo = 0, hi = items.length - 1, best = -1;
                while (lo <= hi) {
                    const mid = (lo + hi) >> 1;
                    if (pred(items[mid])) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
                }
                return best >= 0 ? items[best] : null;
            };

            if (items[0].dataset.lineIndex !== undefined) {
                let lineIdx = -1;
                if (isBook) {
                    for (let p = pageIdx; p >= 0 && lineIdx < 0; p--) {
                        const marked = pages[p].querySelectorAll('[data-line-idx]');
                        if (marked.length) lineIdx = parseInt(marked[marked.length - 1].getAttribute('data-line-idx'), 10);
                    }
                } else {
                    const from = Math.max(0, pageIdx - 1);
                    for (let p = from; p <= Math.min(pages.length - 1, pageIdx + 1); p++) {
                        pages[p].querySelectorAll('[data-line-idx]').forEach((el) => {
                            const v = parseInt(el.getAttribute('data-line-idx'), 10);
                            if (!isNaN(v) && el.getBoundingClientRect().top <= refLine && v > lineIdx) lineIdx = v;
                        });
                    }
                    if (lineIdx < 0) {
                        const first = pages[pageIdx].querySelector('[data-line-idx]');
                        if (first) lineIdx = parseInt(first.getAttribute('data-line-idx'), 10);
                    }
                }
                if (isNaN(lineIdx) || lineIdx < 0) return null;
                return lastWhere((it) => Number(it.dataset.lineIndex) <= lineIdx);
            }

            const pageEl = pages[pageIdx];
            return lastWhere((it) => {
                const h = document.getElementById(it.dataset.headingId);
                if (!h) return false;
                if (isBook) {
                    return h === pageEl || Boolean(pageEl.compareDocumentPosition(h) & (Node.DOCUMENT_POSITION_PRECEDING | Node.DOCUMENT_POSITION_CONTAINED_BY));
                }
                return h.getBoundingClientRect().top <= refLine;
            });
        }

        // מסמן פריט כנוכחי (או מנקה כשאין). הפריט הגלוי המייצג = הפריט עצמו, או ההורה המכווץ הגבוה ביותר
        function setTocCurrentItem(item, reveal) {
            if (tocCurrentItem) { tocCurrentItem.classList.remove('active-item'); tocCurrentItem.removeAttribute('aria-current'); }
            if (tocCurrentRep) { tocCurrentRep.classList.remove('active-parent'); tocCurrentRep.removeAttribute('aria-current'); }
            tocCurrentItem = (item && item.isConnected) ? item : null;
            tocCurrentRep = null;
            if (!tocCurrentItem) return;
            let rep = tocCurrentItem;
            let w = tocCurrentItem.closest('.toc-item-wrapper');
            w = w && w.parentElement ? w.parentElement.closest('.toc-item-wrapper') : null;
            while (w) {
                if (!w.classList.contains('expanded')) rep = w.querySelector(':scope > .toc-item') || rep;
                w = w.parentElement ? w.parentElement.closest('.toc-item-wrapper') : null;
            }
            if (rep === tocCurrentItem) {
                tocCurrentItem.classList.add('active-item');
                tocCurrentItem.setAttribute('aria-current', 'true');
            } else {
                // הפריט עצמו מוסתר - סימון "נוכחי" לטכנולוגיות מסייעות עובר להורה הגלוי
                rep.classList.add('active-parent');
                rep.setAttribute('aria-current', 'true');
                tocCurrentRep = rep;
            }
            if (!reveal || rep.offsetParent === null) return;
            const area = document.getElementById('toc-scroll-area');
            if (!area) return;
            const areaRect = area.getBoundingClientRect();
            const r = rep.getBoundingClientRect();
            if (r.top < areaRect.top || r.bottom > areaRect.bottom) {
                area.scrollTop += r.top - areaRect.top - (area.clientHeight - r.height) / 2;
            }
        }

        function updateTocCurrentHeading(reveal) {
            if (isScrollingFromTOC) return; // אחרי לחיצה על כותרת - ההדגשה כבר נקבעה
            setTocCurrentItem(computeCurrentTocItem(), reveal);
        }

        // גרסה מושהית לקריאה מאירועי גלילה/דפדוף - פועלת רק כשרשימת הכותרות גלויה
        function scheduleTocCurrentUpdate() {
            clearTimeout(tocCurrentTimer);
            tocCurrentTimer = setTimeout(() => {
                if (isNavTocVisible()) updateTocCurrentHeading(true);
            }, 140);
        }

        // שינוי גודל חלון משנה את קו הייחוס (אמצע אזור התצוגה) - מחשבים מחדש כשהרשימה גלויה
        window.addEventListener('resize', scheduleTocCurrentUpdate);

        function createTocToggle(wrapper) {
            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'toc-toggle';
            toggleBtn.innerHTML = fluentIconHTML('chevron_down');
            toggleBtn.onclick = (e) => {
                e.stopPropagation();
                wrapper.classList.toggle('expanded');
                syncTocToggle(toggleBtn);
                setTocCurrentItem(tocCurrentItem); // ההדגשה עוברת בין השורה עצמה להורה המכווץ
            };
            // הכפתור עדיין לא מחובר לשורה בזמן היצירה - המצב ההתחלתי נלקח מהעטיפה ישירות
            const expanded = wrapper.classList.contains('expanded');
            toggleBtn.setAttribute('data-tooltip', expanded ? 'כווץ' : 'הרחב');
            toggleBtn.setAttribute('aria-label', expanded ? 'כווץ' : 'הרחב');
            toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            return toggleBtn;
        }

        function buildTOCFromOfficialData(items, tocList) {
            const root = { children: [], level: 0 };
            const stack = [root];

            items.forEach((item) => {
                const titleText = (item && item.text ? String(item.text) : '').trim();
                if (!titleText || typeof item.index !== 'number') return;
                const level = Math.max(1, parseInt(item.level, 10) || 1);

                while (stack.length > 1 && stack[stack.length - 1].level >= level) {
                    stack.pop();
                }

                const node = { titleText, level, lineIndex: item.index, children: [] };
                stack[stack.length - 1].children.push(node);
                stack.push(node);
            });

            function renderNode(node, container) {
                const wrapper = document.createElement('div');
                wrapper.className = 'toc-item-wrapper';
                wrapper.dataset.tocKey = 'l' + node.lineIndex;
                if (node.level === 1) wrapper.classList.add('expanded');

                const el = document.createElement('div');
                el.className = 'toc-item';
                el.dataset.lineIndex = String(node.lineIndex);
                el.dataset.level = String(Math.min(node.level, 3));
                el.style.paddingInlineStart = (12 + (node.level - 1) * 12) + 'px';

                const hasChildren = node.children.length > 0;
                el.insertAdjacentHTML('beforeend', `<span class="toc-text">${node.titleText}</span>`);
                if (hasChildren) el.appendChild(createTocToggle(wrapper));

                el.onclick = () => {
                    const pageIdx = locatePageIndexForLineIndex(node.lineIndex);
                    if (pageIdx >= 0) { goToPageIndex(pageIdx); setTocCurrentItem(el); }
                };

                wrapper.appendChild(el);

                if (hasChildren) {
                    const childrenContainer = document.createElement('div');
                    childrenContainer.className = 'toc-children';
                    node.children.forEach(child => renderNode(child, childrenContainer));
                    wrapper.appendChild(childrenContainer);
                }
                container.appendChild(wrapper);
            }

            root.children.forEach(node => renderNode(node, tocList));
        }

// עטיפה סביב buildTOCCore: שומרת את מצב הפתיחה/כיווץ של הכותרות ואת מיקום הגלילה של הרשימה בין
        // בניות חוזרות של אותו טאב - כך שרשימת הכותרות יכולה להתעדכן תוך כדי טעינת הספר (ראו
        // updateTOCProgressive) בלי שהפריטים שהמשתמש פתח ייסגרו או שהרשימה תקפוץ לראש.
        function buildTOC() {
            const tocList = document.getElementById('toc-list');
            const tocScrollArea = document.getElementById('toc-scroll-area');
            const tab = tabs[activeTabIndex];
            let prevState = null;
            let prevScroll = 0;
            if (tocList && tab && tocList._builtForTab === tab) {
                prevState = new Map();
                tocList.querySelectorAll('.toc-item-wrapper[data-toc-key]').forEach(w => {
                    prevState.set(w.dataset.tocKey, w.classList.contains('expanded'));
                });
                prevScroll = tocScrollArea.scrollTop;
            }
            buildTOCCore();
            if (!tocList) return;
            if (prevState) {
                tocList.querySelectorAll('.toc-item-wrapper[data-toc-key]').forEach(w => {
                    if (prevState.has(w.dataset.tocKey)) w.classList.toggle('expanded', prevState.get(w.dataset.tocKey));
                });
                refreshTocToggleStates();
                tocScrollArea.scrollTop = prevScroll;
                const filterInput = document.getElementById('toc-filter');
                if (filterInput && filterInput.value) filterTOC();
            }
            tocList._builtForTab = tab || null;
            if (tab) {
                tab._tocLoadedKey = getTocLoadedKey(tab);
                tab._tocLastBuild = performance.now();
            }
            requestAnimationFrame(updateFloatingTocSearch);
            if (typeof scheduleNavBarUpdate === 'function') scheduleNavBarUpdate();
            tocCurrentItem = null; tocCurrentRep = null; // האלמנטים הישנים הוחלפו
            updateTocCurrentHeading(false);
        }

        // השורה (data-line-idx) הגדולה ביותר שכבר קיימת ב-DOM - העמודים נוספים לפי סדר הטקסט, ולכן זו
        // השורה האחרונה המסומנת בעמוד האחרון שיש בו שורות מסומנות. -1 אם עדיין לא נטען כלום.
        function getMaxLoadedLineIdx() {
            const previewArea = document.getElementById('preview-area');
            if (!previewArea) return -1;
            const pages = previewArea.querySelectorAll('.print-page');
            for (let p = pages.length - 1, scanned = 0; p >= 0 && scanned < 60; p--, scanned++) {
                const marked = pages[p].querySelectorAll('[data-line-idx]');
                if (marked.length) {
                    const v = parseInt(marked[marked.length - 1].getAttribute('data-line-idx'), 10);
                    if (!isNaN(v)) return v;
                }
            }
            return -1;
        }

        // תוכן העניינים הרשמי של הספר, מצומצם לכותרות שהעמוד שלהן כבר נטען בפועל (עד שהעימוד מסתיים).
        // אחרי סיום העימוד - כל הפריטים. כך הרשימה גדלה בהדרגה בדיוק כמו רשימת העמודים.
        function getOfficialTocLoaded(tab) {
            const items = (tab && Array.isArray(tab.officialToc)) ? tab.officialToc : [];
            if (items.length === 0) return [];
            if (tab.pagesRendered || tab._tocComplete) return items;
            const maxLoaded = getMaxLoadedLineIdx();
            if (maxLoaded < 0) return [];
            return items.filter(it => it && typeof it.index === 'number' && it.index <= maxLoaded);
        }

        function hasOfficialToc(tab) {
            return Boolean(tab && Array.isArray(tab.officialToc) && tab.officialToc.length > 0);
        }

        // מפתח קטן שמשתנה בכל פעם שמספר הכותרות שנטענו משתנה - לזיהוי הצורך בבנייה מחדש
        function getTocLoadedKey(tab) {
            if (hasOfficialToc(tab)) return 'o' + getOfficialTocLoaded(tab).length;
            const previewArea = document.getElementById('preview-area');
            return 'd' + (previewArea ? previewArea.querySelectorAll('h1, h2, h3, h4, h5, h6').length : 0);
        }

        // נקראת מלולאת העימוד אחרי כל באץ': בונה מחדש את עץ הכותרות רק אם נוספו כותרות חדשות (ולא יותר
        // מפעם ב-400ms, כדי לא להכביד בספרים גדולים) - הבנייה הסופית נעשית בסיום העימוד.
        function updateTOCProgressive() {
            const tab = tabs[activeTabIndex];
            if (!tab) return;
            if (getTocLoadedKey(tab) === tab._tocLoadedKey) return;
            if (performance.now() - (tab._tocLastBuild || 0) < 400) return;
            buildTOC();
        }

function buildTOCCore() {
            const previewArea = document.getElementById('preview-area');
            const tocList = document.getElementById('toc-list');
            tocList.innerHTML = '';

            // רשימת העמודים נבנית מחדש רק כשהטאב "דפים" מוצג, כדי להימנע מיצירת DOM מיותרת
            // בספרים גדולים בזמן שהמשתמש נמצא בכותרות או בחיפוש.
            if (currentRailTab === 'pages') buildPageNav();

            // עדיפות לתוכן העניינים הרשמי של הספר (נמשך פעם אחת ב-generateView) - נופלים לסריקת
            // כותרות ה-HTML (הלוגיקה הקיימת, ללא שינוי) רק כשאין תוכן עניינים רשמי זמין (למשל
            // קובץ חיצוני, או ספר שמשיכת ה-TOC שלו נכשלה/החזירה רשימה ריקה).
            const activeTabForToc = tabs[activeTabIndex];
            if (hasOfficialToc(activeTabForToc)) {
                const loadedItems = getOfficialTocLoaded(activeTabForToc);
                if (loadedItems.length === 0) {
                    tocList.innerHTML = '<div style="padding: 20px; color: var(--color-outline); text-align: center;">טוען כותרות...</div>';
                    return;
                }
                buildTOCFromOfficialData(loadedItems, tocList);
                return;
            }

            const headings = Array.from(previewArea.querySelectorAll('h1, h2, h3, h4, h5, h6'));

            if (headings.length === 0) {
                 tocList.innerHTML = '<div style="padding: 20px; color: var(--color-outline); text-align: center;">אין תוכן עניינים</div>';
                 return;
            }

            // בניית עץ מקונן לפי רמות הכותרות (h1..h6) בעזרת מחסנית - כל כותרת נכנסת כילד של
            // הכותרת האחרונה ברמה נמוכה יותר שעדיין פתוחה במחסנית. הרמה העליונה מוצגת פתוחה,
            // וכל שאר הרמות מכווצות כברירת מחדל עד ללחיצה על החץ.
            const root = { children: [], level: 0 };
            const stack = [root];

            headings.forEach((heading, index) => {
                const titleText = heading.textContent.trim();
                if (!titleText) return;
                const headingId = 'print-heading-' + index;
                if (!heading.id) heading.id = headingId;
                const level = parseInt(heading.tagName.substring(1));

                while (stack.length > 1 && stack[stack.length - 1].level >= level) {
                    stack.pop();
                }

                const node = { heading, titleText, level, children: [] };
                stack[stack.length - 1].children.push(node);
                stack.push(node);
            });

            function renderTocNode(node, container) {
                const wrapper = document.createElement('div');
                wrapper.className = 'toc-item-wrapper';
                wrapper.dataset.tocKey = 'h' + node.heading.id;
                // כותרות רמה 1 פתוחות כברירת מחדל (מציגות את תתי-הכותרות שלהן מיד)
                if (node.level === 1) wrapper.classList.add('expanded');

                const item = document.createElement('div');
                item.className = 'toc-item';
                item.dataset.headingId = node.heading.id;
                item.dataset.level = String(Math.min(node.level, 3));
                item.style.paddingInlineStart = (12 + (node.level - 1) * 12) + 'px';

                const hasChildren = node.children.length > 0;
                item.insertAdjacentHTML('beforeend', `<span class="toc-text">${node.titleText}</span>`);
                if (hasChildren) item.appendChild(createTocToggle(wrapper));

                item.onclick = () => {
                    const target = document.getElementById(node.heading.id);
                    if (target) {
                        isScrollingFromTOC = true;

                        // בדיקה האם אנו במצב ספר
                        if (currentSettings.isBookView) {
                            const pageEl = target.closest('.print-page');
                            if (pageEl) {
                                const pages = Array.from(document.querySelectorAll('.print-page'));
                                const pageIndex = pages.indexOf(pageEl);
                                if (pageIndex !== -1) {
                                    // חישוב העלה המתאים ודפדוף אליו - עמודים זוגיים (ימין) ואי-זוגיים
                                    // (שמאל) דורשים עלה שונה כדי שהעמוד המבוקש אכן יופיע בתצוגה
                                    currentLeaf = Math.floor(pageIndex / 2) + (pageIndex % 2);
                                    updateBookViewPages(true);
                                }
                            }
                        } else {
                            // מצב גלילה רגיל
                            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }

                        setTimeout(() => { isScrollingFromTOC = false; }, 1500);
                        setTocCurrentItem(item);
                        if (window.innerWidth < 800) closeAllDrawers();
                    }
                };

                wrapper.appendChild(item);

                if (hasChildren) {
                    const childrenContainer = document.createElement('div');
                    childrenContainer.className = 'toc-children';
                    node.children.forEach(child => renderTocNode(child, childrenContainer));
                    wrapper.appendChild(childrenContainer);
                }

                container.appendChild(wrapper);
            }

            root.children.forEach(node => renderTocNode(node, tocList));
        }

        function clearTocSearchFilter() {
            const input = document.getElementById('toc-filter');
            input.value = '';
            filterTOC();
            input.focus();
        }

        function filterTOC() {
            const query = document.getElementById('toc-filter').value.toLowerCase();
            const wrappers = document.querySelectorAll('.toc-item-wrapper');
            document.getElementById('drawer-search-nav').classList.toggle('has-query', Boolean(query));

            if (!query) {
                // אין חיפוש - חוזרים למצב ברירת המחדל המדויק שבו נבנה העץ מלכתחילה (ראו buildTOC):
                // הכל גלוי, ורק הרמה העליונה (ילדים ישירים של #toc-list) פתוחה - כדי שכותרות רמה 2
                // יישארו גלויות. קודם כל הרמות (כולל הרמה העליונה) כווצו כאן בטעות בכל ניקוי חיפוש.
                const tocList = document.getElementById('toc-list');
                wrappers.forEach(w => {
                    const item = w.querySelector(':scope > .toc-item');
                    if (item) item.style.display = 'flex';
                    const isTopLevel = Boolean(tocList) && w.parentElement === tocList;
                    w.classList.toggle('expanded', isTopLevel);
                });
                tocHighlightIndex = -1;
                refreshTocToggleStates();
                return;
            }

            wrappers.forEach(w => {
                const item = w.querySelector(':scope > .toc-item');
                const text = item.querySelector('.toc-text').textContent.toLowerCase();
                const matches = text.includes(query);
                item.style.display = matches ? 'flex' : 'none';
                // אם יש התאמה, פותחים את כל האבות כדי שהתוצאה תהיה גלויה בפועל ולא בתוך קבוצה מכווצת
                if (matches) {
                    let ancestor = w.parentElement.closest('.toc-item-wrapper');
                    while (ancestor) {
                        ancestor.classList.add('expanded');
                        ancestor = ancestor.parentElement.closest('.toc-item-wrapper');
                    }
                }
            });
            tocHighlightIndex = -1;
            refreshTocToggleStates();
        }

        // ניווט בחיצים משדה החיפוש/סינון של הכותרות אל תוך הרשימה עצמה - offsetParent (לא display
        // ישיר על הפריט) כדי לזהות נכון גם פריטים שמוסתרים כי אב מכווץ, לא רק סינון טקסט
        let tocHighlightIndex = -1;
        function handleTocFilterKeydown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeTocSearch();
                return;
            }
            const items = Array.from(document.querySelectorAll('.toc-item')).filter(el => el.offsetParent !== null);
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (items.length === 0) return;
                if (tocHighlightIndex >= 0 && items[tocHighlightIndex]) items[tocHighlightIndex].classList.remove('kb-highlighted');
                tocHighlightIndex = (tocHighlightIndex + 1) % items.length;
                items[tocHighlightIndex].classList.add('kb-highlighted');
                items[tocHighlightIndex].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (items.length === 0) return;
                if (tocHighlightIndex >= 0 && items[tocHighlightIndex]) items[tocHighlightIndex].classList.remove('kb-highlighted');
                tocHighlightIndex = (tocHighlightIndex - 1 + items.length) % items.length;
                items[tocHighlightIndex].classList.add('kb-highlighted');
                items[tocHighlightIndex].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (tocHighlightIndex >= 0 && items[tocHighlightIndex]) items[tocHighlightIndex].click();
            }
        }

        function escapeRegExp(value) {
            return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        // חיפוש בספר מתעלם תמיד מניקוד וטעמי מקרא (\u0591-\u05C7 - אותו טווח המשמש כבר במקומות
        // אחרים בקובץ, כמו HOLY_DIACRITIC_RE_SRC) - בלי תלות בהגדרות "הסתר ניקוד/טעמים" הנוכחיות.
        // מחזירים גם מיפוי מאינדקס במחרוזת המנוקה בחזרה לאינדקס במחרוזת המקורית, כדי שההדגשה
        // (וקטע התצוגה המקדימה) ימשיכו להציג את הטקסט האמיתי בדיוק כפי שהוא מוצג במסך.
        const SEARCH_DIACRITIC_RE = /[\u0591-\u05C7]/;
        function normalizeForSearch(text) {
            let out = '';
            const map = [];
            for (let i = 0; i < text.length; i++) {
                const ch = text[i];
                if (SEARCH_DIACRITIC_RE.test(ch)) continue;
                out += ch;
                map.push(i);
            }
            return { text: out, map };
        }

        function clearSearchHighlights() {
            const previewArea = document.getElementById('preview-area');
            if (previewArea && previewArea.dataset.searchBaseHtml) {
                previewArea.innerHTML = previewArea.dataset.searchBaseHtml;
                return;
            }

            document.querySelectorAll('.search-highlight').forEach((node) => {
                const parent = node.parentNode;
                if (!parent) return;
                parent.replaceChild(document.createTextNode(node.textContent), node);
            });
            document.querySelectorAll('.search-highlight').forEach((node) => node.remove());
        }

        function getHeadingPath(node) {
            const previewArea = document.getElementById('preview-area');
            const currentElement = node && node.nodeType === 3 ? node.parentElement : node;
            if (!previewArea || !currentElement) return 'כל הספר';

            const walker = document.createTreeWalker(previewArea, NodeFilter.SHOW_ELEMENT);
            const headingStack = [];

            while (walker.nextNode()) {
                const current = walker.currentNode;

                if (/^H[1-6]$/.test(current.tagName)) {
                    const level = parseInt(current.tagName.substring(1), 10);
                    const text = current.textContent.trim();

                    while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
                        headingStack.pop();
                    }

                    if (text) {
                        headingStack.push({ level, text });
                    }
                }

                if (current === currentElement) {
                    // מציגים רק רמות h2..h5 בנתיב - h1 כללי מדי ו-h6 יורד לפרטי פרטים מיותרים
                    const path = headingStack.filter(item => item.level >= 2 && item.level <= 5).map(item => item.text).join(' › ');
                    return path || 'כל הספר';
                }
            }

            return 'כל הספר';
        }

        function createSnippet(text, query) {
            const { text: normText, map } = normalizeForSearch(text);
            const normQuery = normalizeForSearch(query).text;
            const normIndex = normText.toLowerCase().indexOf(normQuery.toLowerCase());

            // ביטחון בלבד - לא אמור לקרות בפועל, כי הצומת הזה כבר נבחר בגלל שהוא מכיל התאמה
            if (normIndex === -1 || map.length === 0) {
                const start = Math.max(0, text.length - 95);
                return text.slice(start);
            }

            const normEnd = normIndex + normQuery.length;
            const index = map[normIndex];
            const matchEnd = normEnd < map.length ? map[normEnd] : text.length;

            const start = Math.max(0, index - 35);
            const end = Math.min(text.length, matchEnd + 60);
            const before = text.slice(start, index);
            const match = text.slice(index, matchEnd);
            const after = text.slice(matchEnd, end);
            return `${before}<mark>${match}</mark>${after}`;
        }

        // בשונה מ-createSnippet (שתמיד מוצא את ההופעה הראשונה של השאילתה בטקסט המלא של הפסקה),
        // הפונקציה הזו בונה את קטע התצוגה המקדימה סביב המיקום המדויק של אלמנט ה-mark הספציפי
        // שהתקבל - כך שכאשר יש כמה תוצאות חיפוש שונות באותה פסקה, כל תוצאה מציגה את ההקשר האמיתי
        // שלה ולא תמיד את ההקשר של ההתאמה הראשונה בפסקה.
        function createSnippetForMarkElement(markEl) {
            const parent = markEl.parentElement;
            if (!parent) return markEl.textContent;
            const fullText = parent.textContent;

            // חישוב המיקום המדויק של ה-mark הזה (לא הראשון שנמצא) בתוך טקסט האב - ע"י סכימת
            // האורך של כל הצמתים שקדמו לו בפועל ב-DOM
            let offset = 0;
            for (const child of parent.childNodes) {
                if (child === markEl) break;
                offset += child.textContent.length;
            }

            const matchLen = markEl.textContent.length;
            const start = offset;
            const end = offset + matchLen;
            const before = fullText.slice(Math.max(0, start - 35), start);
            const match = fullText.slice(start, end);
            const after = fullText.slice(end, Math.min(fullText.length, end + 60));
            return `${before}<mark>${match}</mark>${after}`;
        }

        // מחזירה false אם החיפוש בוטל באמצע (shouldStop), ואז ההדגשות החלקיות מנוקות ע"י הקורא.
        // רצה בנתחים קצרים עם החזרת שליטה ל-event loop (yieldIfNeeded) כדי שהממשק ימשיך להגיב
        async function highlightSearchMatches(query, yieldIfNeeded) {
            const previewArea = document.getElementById('preview-area');
            if (!previewArea || !query) return true;

            previewArea.dataset.searchBaseHtml = previewArea.innerHTML;
            clearSearchHighlights();

            // מנקים ניקוד/טעמים מהשאילתה עצמה - כדי שהחיפוש יתעלם מהם תמיד, גם אם המשתמש הדביק
            // בטעות טקסט מנוקד לתוך תיבת החיפוש
            const normQuery = normalizeForSearch(query).text;
            if (!normQuery) return true;
            const normQueryLower = normQuery.toLowerCase();

            const textNodes = document.createTreeWalker(previewArea, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    // דילוג על כותרות עליונות/מספרי עמוד (page-header) - אלו תוספת עיצובית של התוסף
                    // ולא חלק מתוכן הספר עצמו, ולכן לא אמורות להופיע כתוצאות חיפוש
                    if (node.parentElement && node.parentElement.closest('.page-header')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return node.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            });

            const nodes = [];
            while (textNodes.nextNode()) {
                const candidate = textNodes.currentNode;
                if (normalizeForSearch(candidate.textContent).text.toLowerCase().includes(normQueryLower)) nodes.push(candidate);
                if (await yieldIfNeeded()) return false;
            }

            for (let n = 0; n < nodes.length; n++) {
                if (await yieldIfNeeded()) return false;
                const node = nodes[n];
                const parent = node.parentNode;
                if (!parent) continue;
                const text = node.textContent || '';
                const { text: normText, map } = normalizeForSearch(text);
                if (map.length === 0) continue;

                const localRegex = new RegExp(escapeRegExp(normQuery), 'gi');
                let match;
                let lastIndex = 0;
                const frag = document.createDocumentFragment();
                let foundAny = false;

                while ((match = localRegex.exec(normText)) !== null) {
                    foundAny = true;
                    const normStart = match.index;
                    const normEnd = normStart + match[0].length;
                    // תחילת ההתאמה במחרוזת המקורית - תמיד האות הבסיסית עצמה (ניקוד/טעמים תמיד
                    // צמודים אחרי האות שהם שייכים אליה, ולכן לעולם לא נמצאים "לפני" תחילת ההתאמה)
                    const origStart = map[normStart];
                    // סוף ההתאמה במחרוזת המקורית - כולל כל ניקוד/טעמים שצמודים ישירות אחרי האות
                    // האחרונה שבהתאמה (כדי שההדגשה תכסה גם אותם, ולא תשאיר ניקוד "יתום" חשוף מיד
                    // אחרי ה-</mark>)
                    const origEnd = normEnd < map.length ? map[normEnd] : text.length;

                    if (origStart > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, origStart)));
                    const mark = document.createElement('mark');
                    mark.className = 'search-highlight';
                    mark.textContent = text.slice(origStart, origEnd);
                    frag.appendChild(mark);
                    lastIndex = origEnd;

                    if (localRegex.lastIndex === normStart) localRegex.lastIndex++; // ביטחון מפני התאמה באורך 0
                }

                if (!foundAny) continue;
                if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
                parent.replaceChild(frag, node);
            }
            return true;
        }

        function groupResultsByPath(results) {
            const groups = [];
            results.forEach((result) => {
                const key = result.path || 'כל הספר';
                let group = groups[groups.length - 1];
                if (!group || group[0] !== key) {
                    group = [key, []];
                    groups.push(group);
                }
                group[1].push(result);
            });
            return groups;
        }

        // מעבר אל תוצאת חיפוש (אלמנט <mark class="search-highlight">) - גם דרך לחיצה על תוצאה
        // ברשימה וגם דרך ניווט הבא/הקודם במקלדת
        function jumpToSearchResultElement(target) {
            if (!target) return;
            isScrollingFromTOC = true;

            if (currentSettings.isBookView) {
                const pageEl = target.closest('.print-page');
                if (pageEl) {
                    const pages = Array.from(document.querySelectorAll('.print-page'));
                    const pageIndex = pages.indexOf(pageEl);
                    if (pageIndex !== -1) {
                        // עמודים זוגיים (ימין) ואי-זוגיים (שמאל) דורשים עלה שונה כדי שהעמוד המבוקש
                        // אכן יופיע בתצוגה (ולא העמוד/הכריכה שלפניו)
                        currentLeaf = Math.floor(pageIndex / 2) + (pageIndex % 2);
                        updateBookViewPages(true);
                    }
                }
            } else {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            setTimeout(() => { isScrollingFromTOC = false; }, 1500);
        }

        let currentSearchResults = [];
        let currentSearchResultIndex = -1;
        // מעקב אחר השאילתה שכבר חופשה בפועל בפעם האחרונה - ראו searchInBook: משמש כדי לזהות
        // הפעלה "ריקה" (למשל קיצור מקלדת שרק פותח/ממקד את פאנל החיפוש בלי לשנות את הטקסט) ולדלג
        // עליה לגמרי, במקום לבצע שוב ניקוי+בנייה מחדש של ההדגשות ולסכן קפיצת גלילה מיותרת
        let lastSearchedQuery = null;

        function updateSearchResultCount() {
            const title = document.querySelector('.search-results-title');
            const previousButton = document.getElementById('prev-search-result');
            const nextButton = document.getElementById('next-search-result');
            const total = currentSearchResults.length;
            document.getElementById('drawer-pane-search')?.classList.toggle('has-results', total > 0);
            if (title) title.textContent = searchRunning ? 'מחפש...' : (total ? `נמצאו ${total} תוצאות` : '');
            if (previousButton) previousButton.disabled = !total || currentSearchResultIndex <= 0;
            if (nextButton) {
                nextButton.disabled = !total || Math.max(currentSearchResultIndex, 0) >= total - 1;
            }
        }

        function setActiveSearchResult(index) {
            document.querySelectorAll('.search-result-item.active').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('mark.search-highlight.active-match').forEach(el => el.classList.remove('active-match'));

            currentSearchResultIndex = index;
            const result = currentSearchResults[index];
            if (!result) { updateSearchResultCount(); return; }

            if (result.itemEl) {
                result.itemEl.classList.add('active');
                result.itemEl.scrollIntoView({ block: 'nearest' });
            }
            if (result.element) result.element.classList.add('active-match');

            updateSearchResultCount();
            jumpToSearchResultElement(result.element);
        }

        function nextSearchResult() {
            if (currentSearchResults.length === 0) return;
            const next = (currentSearchResultIndex + 1) % currentSearchResults.length;
            setActiveSearchResult(next);
        }

        function prevSearchResult() {
            if (currentSearchResults.length === 0) return;
            const prev = (currentSearchResultIndex - 1 + currentSearchResults.length) % currentSearchResults.length;
            setActiveSearchResult(prev);
        }

        function handleBookSearchKeydown(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) prevSearchResult(); else nextSearchResult();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                nextSearchResult();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                prevSearchResult();
            }
        }

// --- הרצת חיפוש בנתחים: מצב "מחפש", עצירה וביטול ---
        // החיפוש רץ בנתחים קצרים של כ-14ms עם החזרת שליטה לדפדפן בין נתח לנתח, כך שפס ההתקדמות
        // מונפש, הממשק ממשיך להגיב, ואפשר לעצור (כפתור "עצור את החיפוש") או להחליף שאילתה באמצע.
        let searchRunId = 0;
        let searchRunning = false;
        let searchRunPosState = null;

        function setSearchRunning(on) {
            searchRunning = on;
            const pane = document.getElementById('drawer-pane-search');
            if (pane) pane.classList.toggle('is-searching', on);
            const progress = document.getElementById('search-progress');
            if (progress) progress.hidden = !on;
            const stopBtn = document.getElementById('stop-search');
            if (stopBtn) stopBtn.hidden = !on;
            updateSearchResultCount();
        }

        // מבטל ריצה פעילה (בלי לגעת בתצוגה) - למעבר טאב, שאילתה חדשה או ניקוי
        function cancelBookSearchRun() {
            searchRunId++;
            if (searchRunning) setSearchRunning(false);
        }

        // כפתור "עצור את החיפוש": מבטל וחוזר לתצוגה נקייה בלי הדגשות
        function stopBookSearch() {
            if (!searchRunning) return;
            cancelBookSearchRun();
            clearSearchHighlights();
            currentSearchResults = [];
            currentSearchResultIndex = -1;
            lastSearchedQuery = null;
            const resultsBox = document.getElementById('search-results-list');
            if (resultsBox) resultsBox.innerHTML = '<div class="search-empty">החיפוש נעצר.</div>';
            updateSearchResultCount();
            if (searchRunPosState) restorePositionState(searchRunPosState);
            searchRunPosState = null;
        }

        const searchNextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

        async function searchInBook() {
            const query = document.getElementById('book-search').value.trim();

            // אם השאילתה זהה בדיוק למה שכבר חופש בפעם הקודמת - אין שום שינוי בפועל
            // בהדגשות, ולכן אין צורך לגעת ב-DOM או במיקום הגלילה בכלל. זה קריטי בעיקר עבור קיצור
            // המקלדת (Ctrl+Shift+F) שרק פותח/ממקד את פאנל החיפוש בלי לשנות את הטקסט - קודם
            // הפעולה תמיד "קפצה" אל ראש העמוד הנוכחי גם כשלא היה שום צורך בכך.
            if (query === lastSearchedQuery) {
                return;
            }
            lastSearchedQuery = query;
            // כל קריאה מבטלת את הריצה הקודמת (אם עוד רצה)
            const runId = ++searchRunId;
            if (searchRunning) setSearchRunning(false);

            const resultsBox = document.getElementById('search-results-list');
            const previewArea = document.getElementById('preview-area');

            // שמירה ושחזור של מיקום הגלילה נחוצים רק כאשר בפועל עומד להתבצע שינוי: ניקוי
            // הדגשות קודמות שכבר קיימות (searchBaseHtml) ו/או בניית הדגשות חדשות.
            const hadPreviousHighlights = Boolean(previewArea.dataset.searchBaseHtml);
            const willSearch = query.length >= 3;
            const posState = (hadPreviousHighlights || willSearch) ? capturePositionState() : null;

            // 1. ניקוי סימונים קודמים
            clearSearchHighlights();
            currentSearchResults = [];
            currentSearchResultIndex = -1;

            if (!query) {
                resultsBox.innerHTML = '';
                updateSearchResultCount();
                if (posState) restorePositionState(posState);
                return;
            }

            if (query.length < 3) {
                resultsBox.innerHTML = '<div class="search-empty">יש להקליד לפחות 3 תווים כדי להתחיל בחיפוש.</div>';
                updateSearchResultCount();
                if (posState) restorePositionState(posState);
                return;
            }

            searchRunPosState = posState;
            resultsBox.innerHTML = '';
            setSearchRunning(true);

            // ריצה "מיושנת": הוחלפה בריצה חדשה / נעצרה, או שהתוכן התחלף (lastSearchedQuery אופס)
            const isStale = () => runId !== searchRunId || lastSearchedQuery !== query;
            let sliceStart = performance.now();
            // מחזירה true כשצריך לצאת. מחזירה שליטה לדפדפן רק כשהנתח הנוכחי ארך יותר מ-14ms
            const yieldIfNeeded = async () => {
                if (performance.now() - sliceStart > 14) {
                    await searchNextTurn();
                    sliceStart = performance.now();
                }
                return isStale();
            };

            try {
                // 2. ביצוע סימון (Highlight) ב-DOM
                if (!(await highlightSearchMatches(query, yieldIfNeeded))) return;

                // 3. סריקה במעבר יחיד (Single-Pass) למציאת הכותרות והתוצאות יחד
                const walker = document.createTreeWalker(previewArea, NodeFilter.SHOW_ELEMENT);
                const headingStack = [];
                const results = [];

                while (walker.nextNode()) {
                    const current = walker.currentNode;

                    // עדכון היררכיית הכותרות במידה והגענו לכותרת חדשה
                    if (/^H[1-6]$/.test(current.tagName)) {
                        const level = parseInt(current.tagName.substring(1), 10);
                        const text = current.textContent.trim();
                        while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
                            headingStack.pop();
                        }
                        if (text) {
                            headingStack.push({ level, text });
                        }
                    }

                    // שמירת התוצאה עם נתיב הכותרת המהיר שכבר מחושב בזיכרון ב-O(1)
                    if (current.classList.contains('search-highlight')) {
                        // מציגים רק רמות h2..h5 בנתיב - h1 כללי מדי ו-h6 יורד לפרטי פרטים מיותרים
                        const path = headingStack.filter(item => item.level >= 2 && item.level <= 5).map(item => item.text).join(' › ') || 'כל הספר';
                        const snippet = createSnippetForMarkElement(current);
                        results.push({
                            element: current,
                            path,
                            snippet
                        });
                    }
                    if (await yieldIfNeeded()) return;
                }

                if (results.length === 0) {
                    resultsBox.innerHTML = '<div class="search-empty">לא נמצאו תוצאות לחיפוש זה בספר.</div>';
                    restorePositionState(posState);
                    return;
                }

                resultsBox.innerHTML = '';

                const groupedResults = groupResultsByPath(results);
                for (const [path, pathResults] of groupedResults) {
                    const group = document.createElement('div');
                    group.className = 'search-result-group';

                    const pathLabel = document.createElement('div');
                    pathLabel.className = 'search-result-path';
                    pathLabel.textContent = path;
                    group.appendChild(pathLabel);

                    const items = document.createElement('div');
                    items.className = 'search-result-items';
                    pathResults.forEach((result) => {
                        const item = document.createElement('button');
                        item.type = 'button';
                        item.className = 'search-result-item';
                        item.innerHTML = `
                        <div class="search-result-snippet">${result.snippet}</div>
                    `;
                        result.itemEl = item;
                        const resultIndex = currentSearchResults.length;
                        currentSearchResults.push(result);
                        item.addEventListener('click', () => {
                            setActiveSearchResult(resultIndex);
                        });
                        items.appendChild(item);
                    });

                    group.appendChild(items);
                    resultsBox.appendChild(group);
                    if (await yieldIfNeeded()) return;
                }

                // סימון ההדגשות (highlightSearchMatches) מבצע החלפת innerHTML מלאה של אזור התצוגה, מה
                // שמאפס את מיקום הגלילה - לכן משחזרים כאן את המיקום שנשמר בתחילת הפונקציה, כדי שהקלדה
                // או מחיקה בתיבת החיפוש לעולם לא "יזיזו" את התצוגה מהעמוד שבו המשתמש נמצא כרגע
                restorePositionState(posState);
            } finally {
                // רק הריצה הנוכחית מכבה את מצב "מחפש" (ריצה שהוחלפה/נעצרה כבר טופלה במי שהחליף אותה)
                if (runId === searchRunId) {
                    searchRunPosState = null;
                    setSearchRunning(false);
                }
            }
        }

        /* --- תיקון תגיות שבורות: מזהה רק תגיות HTML תקינות ומאזן פתיחה/סגירה על פני כל תוכן הספר --- 
           --- (לא רק שורה בודדת) - כל תג שלא נסגר כלל, נסגר בצורה לא תקינה, או תג סגירה יתום ---
           --- מוסר לחלוטין ואינו מוצג כטקסט וגם אינו משפיע על שאר הטקסט שאחריו --- */
        const VALID_TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*\s*\/?>/g;
        const VOID_TAG_NAMES = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);

        // גרסה א-סינכרונית עם "נשימות" (yield) תקופתיות ל-event loop, כדי שספרים ענקיים (כמו
        // אנציקלופדיה) לא יתקעו את כל התוכנה לכמה שניות בזמן עיבוד תגיות סינכרוני על פני מיליוני
        // תווים בבת אחת. הלוגיקה זהה לחלוטין לגרסה המקורית - רק מפוצלת לצעדים עם נקודות עצירה.