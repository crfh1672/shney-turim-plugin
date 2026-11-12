        function updateBookViewModeUI() {
            const isBookView = Boolean(currentSettings.isBookView);
            const toggleBtn = document.getElementById('btn-book-toggle');
            if (toggleBtn) {
                toggleBtn.innerHTML = otzariaIconHTML(isBookView ? 'book_open_medium_lines' : 'book');
                toggleBtn.setAttribute('data-tooltip', 'מצב תצוגה');
            }

            const regularOption = document.getElementById('view-mode-regular');
            const bookOption = document.getElementById('view-mode-book');
            if (regularOption) {
                regularOption.setAttribute('aria-checked', String(!isBookView));
            }
            if (bookOption) {
                bookOption.setAttribute('aria-checked', String(isBookView));
            }
        }

        async function loadSettings() {
            loadDrawerState(); // אסינכרוני, אך לא ממתינים לו - יש לו נפילה עצמאית ל-Otzaria storage אם צריך
            const key = getSettingsStorageKey();
            let settingsFoundLocally = false;
            try {
                const stored = localStorage.getItem(key);
                if (stored) {
                    currentSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
                    settingsFoundLocally = true;
                }
                const storedScale = localStorage.getItem('advanced_print_scale');
                if (storedScale) {
                    pageScale = parseFloat(storedScale);
                }
            } catch (e) {
                console.error("Failed to load settings", e);
            }
            applySettingsToCSS();
            applyPageScale();

            // רשת ביטחון: אם אין כלום ב-localStorage (למשל נמחק), ננסה למשוך גיבוי מ-Otzaria storage
            if (!settingsFoundLocally) {
                const fallback = await loadFromOtzariaStorageFallback(key);
                if (fallback && typeof fallback === 'object') {
                    currentSettings = { ...DEFAULT_SETTINGS, ...fallback };
                    applySettingsToCSS();
                }
            }
        }

        function applySettingsToCSS() {
            applyCustomFontFamily();
            applyPageSizeToCSS();
            document.documentElement.style.setProperty('--page-margin', currentSettings.margin + 'mm');
            document.documentElement.style.setProperty('--column-gap', currentSettings.columnGap + 'mm');

            const marginInput = document.getElementById('setting-margin');
            const marginVal = document.getElementById('setting-margin-val');
            if (marginInput && marginVal) {
                marginInput.value = currentSettings.margin;
                marginVal.innerText = currentSettings.margin + ' מ"מ';
            }

            const gapInput = document.getElementById('setting-column-gap');
            const gapVal = document.getElementById('setting-column-gap-val');
            if (gapInput && gapVal) {
                gapInput.value = currentSettings.columnGap;
                gapVal.innerText = currentSettings.columnGap + ' מ"מ';
            }

            const concInput = document.getElementById('setting-concurrency');
            const concVal = document.getElementById('setting-concurrency-val');
            if (concInput && concVal) {
                concInput.value = currentSettings.concurrency || 6;
                concVal.innerText = (currentSettings.concurrency || 6) + ' ערוצים';
            }

            const lhInput = document.getElementById('setting-line-height');
            const lhVal = document.getElementById('setting-line-height-val');
            if (lhInput && lhVal) {
                const lh = currentSettings.lineHeight || 1.5;
                lhInput.value = lh;
                lhVal.innerText = lh.toFixed(2);
                document.documentElement.style.setProperty('--line-height-book', lh);
            }

            const psInput = document.getElementById('setting-paragraph-spacing');
            const psVal = document.getElementById('setting-paragraph-spacing-val');
            if (psInput && psVal) {
                const ps = currentSettings.paragraphSpacing || 0.3;
                psInput.value = ps;
                psVal.innerText = ps.toFixed(2) + 'em';
                document.documentElement.style.setProperty('--paragraph-spacing', ps + 'em');
            }

            // עדכון וסנכרון גודל הגופן לטאב הפעיל הנוכחי
            if (activeTabIndex !== -1 && tabs[activeTabIndex]) {
                const activeTab = tabs[activeTabIndex];
                const fs = activeTab.fontSize || currentSettings.fontSize || 14;
                document.documentElement.style.setProperty('--font-size-book', fs + 'pt');
                
                const fsInput = document.getElementById('setting-font-size');
                const fsVal = document.getElementById('setting-font-size-val');
                if (fsInput && fsVal) {
                    fsInput.value = fs;
                    fsVal.innerText = fs + 'pt';
                }
            }
            const showRule = currentSettings.showColumnRule !== false;
            const ruleStyle = showRule ? '2px solid var(--color-outline-subtle)' : 'none';
            document.documentElement.style.setProperty('--column-rule-style', ruleStyle);

            const ruleCheckbox = document.getElementById('setting-show-column-rule');
            if (ruleCheckbox) {
                ruleCheckbox.checked = showRule;
            }

            // סנכרון מצב סרגל כלים מצומצם
            document.body.classList.toggle('compact-toolbar', Boolean(currentSettings.compactToolbar));
            const compactCheckbox = document.getElementById('setting-compact-toolbar');
            if (compactCheckbox) {
                compactCheckbox.checked = Boolean(currentSettings.compactToolbar);
            }

            // עדכון מצב כותרת עליונה ומספרי עמודים במתג הממשק
            const showHeader = currentSettings.showHeader !== false;
            document.body.classList.toggle('hide-page-header', !showHeader);
            const headerCheckbox = document.getElementById('setting-show-header');
            if (headerCheckbox) {
                headerCheckbox.checked = showHeader;
            }

            const nikudCheckbox = document.getElementById('setting-hide-nikud');
            if (nikudCheckbox) {
                nikudCheckbox.checked = Boolean(currentSettings.hideNikud);
            }
            const teamimCheckbox = document.getElementById('setting-hide-teamim');
            if (teamimCheckbox) {
                teamimCheckbox.checked = Boolean(currentSettings.hideTeamim);
            }
            const punctCheckbox = document.getElementById('setting-hide-punctuation');
            if (punctCheckbox) {
                punctCheckbox.checked = Boolean(currentSettings.hidePunctuation);
            }

            const holyNamesFilterSelect = document.getElementById('setting-holy-names-filter');
            const holyNamesFilterVal = currentSettings.holyNamesFilter || 'havaya';
            if (holyNamesFilterSelect) holyNamesFilterSelect.value = holyNamesFilterVal;
            const holyNamesDisplaySelect = document.getElementById('setting-holy-names-display');
            if (holyNamesDisplaySelect) holyNamesDisplaySelect.value = currentSettings.holyNamesDisplay || 'hyphen';
            const holyNamesDisplayCard = document.getElementById('holy-names-display-card');
            if (holyNamesDisplayCard) holyNamesDisplayCard.style.display = holyNamesFilterVal === 'none' ? 'none' : '';
            const holyNamesYYCheckbox = document.getElementById('setting-holy-names-yy');
            if (holyNamesYYCheckbox) holyNamesYYCheckbox.checked = Boolean(currentSettings.holyNamesYY);
            updateHolyNamesYYCardVisibility();

            const aggressiveAlefCheckbox = document.getElementById('setting-aggressive-alef');
            if (aggressiveAlefCheckbox) aggressiveAlefCheckbox.checked = Boolean(currentSettings.holyNamesAggressiveAlef);
            // תיקון מצב ספר בעת פתיחת התוסף (החזרת לחצני דפדוף והסתרת פסי גלילה)
            document.body.classList.toggle('book-view-active', currentSettings.isBookView);
            // סנכרון תצוגת "שני עמודים בשורה" (גלילה רגילה) בעת טעינת ההגדרות
            document.body.classList.toggle('two-column-scroll-active', Boolean(currentSettings.twoColumnScroll));
            const twoColumnScrollCheckbox = document.getElementById('setting-two-column-scroll');
            if (twoColumnScrollCheckbox) twoColumnScrollCheckbox.checked = Boolean(currentSettings.twoColumnScroll);
            updateBookViewModeUI();
            // סנכרון הגדרות הצבע המותאמות אישית (רקע/עמוד/כתב) עם ה-CSS ועם ממשק ההגדרות
            initColorPickersOnce();
            applyColorCSSVar('bg');
            applyColorCSSVar('page');
            applyColorCSSVar('text');
            applyColorCSSVar('commentaryBg');
            updateColorControlUI('bg');
            updateColorControlUI('page');
            updateColorControlUI('text');
            updateColorControlUI('commentaryBg');

            // סנכרון הגדרות ההערות (הגדרות > הערות) - ראו FOOTNOTE_DEFAULTS/הפונקציות
            // applyFootnote*CSS למטה. כל הערך שם null עדיין מציג ב-CSS את הברירת מחדל הקודמת
            // (יחסית לטקסט), רק שדה המחוון עצמו מציג את הערך הנוכחי (המחושב או המותאם אישית).
            applyFootnoteFontSizeCSS();
            applyFootnoteLineHeightCSS();
            applyFootnoteParagraphSpacingCSS();
            applyFootnoteColumnSettingsCSS();

            // סנכרון הגדרות חלונית המפרשים (הגדרות > הערות > הגדרות גופן למפרשים) - עצמאיות
            // לגמרי מהגדרות ההערות שמעליהן ומהגדרות הספר, ראו applyCommentaryTextFilters.
            applyCommentaryFontSizeCSS();
            applyCommentaryLineHeightCSS();
            syncCommentaryFilterCheckboxesUI();
            applyCommentaryPanelWidth();
            initCommentaryPanelResizeOnce();

            renderShortcutsList();
        } 

        // ============================================================================
        // === בורר צבעים מותאם אישית (הגדרות > הגדרות צבע: רקע / עמוד / כתב) ===
        // ============================================================================

        // הגדרות כל בורר צבע: מפתח ההגדרה השמור, משתנה ה-CSS שהוא שולט בו, וצבע ברירת
        // המחדל להצגה (לתצוגת המדגם) כשלא נבחר צבע מותאם אישית.
        const COLOR_TARGETS = {
            bg: {
                settingKey: 'bgColor',
                cssVar: '--user-bg-color',
                fallback: '#fff8f4',
                presets: ['#f5f0e8', '#ece5d8', '#e8e4dc', '#eef1eb', '#e9eef2', '#f2ecf4', '#232323', '#121212'],
                presetNames: ['קרם בהיר', 'בז\' חול', 'אפור חמים בהיר', 'ירוק מנטה בהיר', 'תכלת בהיר', 'סגול לבנדר בהיר', 'אפור כהה', 'שחור']
            },
            page: {
                settingKey: 'pageColor',
                cssVar: '--user-page-color',
                fallback: '#ffffff',
                presets: ['#fdf6e3', '#f4ecd8', '#f0e6cf', '#eef2e6', '#e7eef5', '#2b2b2b', '#1a1a1a', '#000000'],
                presetNames: ['קרם עתיק', 'בז\' ספיה', 'בז\' חם', 'ירוק בהיר', 'כחול בהיר', 'אפור כהה', 'שחור כמעט', 'שחור']
            },
            text: {
                settingKey: 'textColor',
                cssVar: '--user-text-color',
                fallback: '#000000',
                presets: ['#1a1a1a', '#2b2b2b', '#3a2c1a', '#1a2e1a', '#0d1b33', '#3a1a1a', '#e8e8e8', '#ffffff'],
                presetNames: ['שחור כמעט', 'אפור כהה', 'חום כהה', 'ירוק כהה', 'כחול כהה', 'אדום כהה', 'אפור בהיר', 'לבן']
            },
            // צבע רקע חלונית המפרשים בצד (הגדרות > הערות > הגדרות גופן למפרשים) - ברירת המחדל
            // #F6EDE5 (קרם חם), עצמאי לגמרי מצבעי התצוגה של הספר עצמו (רקע/עמוד/כתב) שמעליו.
            commentaryBg: {
                settingKey: 'commentaryBgColor',
                cssVar: '--commentary-panel-bg-color',
                fallback: '#F6EDE5',
                presets: ['#F6EDE5', '#FBF3E7', '#F0EAE0', '#EAEFE6', '#E8EEF2', '#F1EAF4', '#2b2b2b', '#1a1a1a'],
                presetNames: ['קרם חם (ברירת מחדל)', 'שנהב', 'בז\' עדין', 'ירוק בהיר', 'תכלת בהיר', 'לבנדר בהיר', 'אפור כהה', 'שחור כמעט']
            }
        };

        // מצב (Hue/Saturation/Value) נוכחי של כל בורר - נשמר בזיכרון בלבד כדי לאפשר גרירה חלקה
        const colorPickerState = {
            bg: { h: 0, s: 0, v: 0 },
            page: { h: 0, s: 0, v: 0 },
            text: { h: 0, s: 0, v: 0 },
            commentaryBg: { h: 0, s: 0, v: 0 }
        };

        let colorPickersInitialized = false;

        function initColorPickersOnce() {
            if (colorPickersInitialized) return;
            colorPickersInitialized = true;
            Object.keys(COLOR_TARGETS).forEach(target => {
                buildColorPresets(target);
                attachColorPickerDragHandlers(target);
                const hexInput = document.getElementById('color-picker-hex-' + target);
                const rInput = document.getElementById('color-picker-r-' + target);
                const gInput = document.getElementById('color-picker-g-' + target);
                const bInput = document.getElementById('color-picker-b-' + target);
                if (hexInput) hexInput.addEventListener('change', () => onColorHexInputChange(target));
                [rInput, gInput, bInput].forEach(inp => {
                    if (inp) inp.addEventListener('change', () => onColorRgbInputChange(target));
                });
            });
        }

        function buildColorPresets(target) {
            const container = document.getElementById('color-picker-presets-' + target);
            if (!container) return;
            container.innerHTML = '';

            // אפשרות "ללא" - חזרה לברירת המחדל של התוכנה
            const noneBtn = document.createElement('button');
            noneBtn.type = 'button';
            noneBtn.className = 'color-picker-preset-swatch none-swatch';
            noneBtn.setAttribute('data-tooltip', 'ברירת מחדל');
            noneBtn.onclick = () => resetColorSetting(target);
            container.appendChild(noneBtn);

            COLOR_TARGETS[target].presets.forEach((hex, i) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'color-picker-preset-swatch';
                btn.style.backgroundColor = hex;
                btn.setAttribute('data-preset-hex', hex.toLowerCase());
                btn.setAttribute('data-tooltip', COLOR_TARGETS[target].presetNames[i]);
                btn.onclick = () => selectPresetColor(target, hex);
                container.appendChild(btn);
            });
        }

        function toggleColorPickerInline(target) {
            const inline = document.getElementById('color-picker-inline-' + target);
            const trigger = document.getElementById('color-picker-trigger-' + target);
            if (!inline || !trigger) return;
            const isOpen = inline.classList.contains('open');
            // סוגר את שאר בוררי הצבע הפתוחים, כדי שרק אחד יהיה פתוח בכל רגע (כמו בורר הגופן)
            Object.keys(COLOR_TARGETS).forEach(t => {
                if (t !== target) closeColorPickerInline(t);
            });
            if (isOpen) {
                closeColorPickerInline(target);
            } else {
                inline.classList.add('open');
                trigger.classList.add('open');
            }
        }

        function closeColorPickerInline(target) {
            const inline = document.getElementById('color-picker-inline-' + target);
            const trigger = document.getElementById('color-picker-trigger-' + target);
            if (inline) inline.classList.remove('open');
            if (trigger) trigger.classList.remove('open');
        }

        function toggleColorPickerCustom(target) {
            const custom = document.getElementById('color-picker-custom-' + target);
            if (!custom) return;
            const willOpen = !custom.classList.contains('open');
            custom.classList.toggle('open', willOpen);
            if (willOpen) {
                // מאתחל את מצב ה-HSV מהצבע הנוכחי (או מברירת המחדל) בכל פתיחה
                const current = currentSettings[COLOR_TARGETS[target].settingKey] || COLOR_TARGETS[target].fallback;
                const rgb = hexToRgb(current);
                if (rgb) {
                    colorPickerState[target] = rgbToHsv(rgb.r, rgb.g, rgb.b);
                    redrawColorPickerCustom(target);
                }
            }
        }

        function selectPresetColor(target, hex) {
            applyColorSetting(target, hex);
        }

        function resetColorSetting(target) {
            applyColorSetting(target, null);
        }

        function applyColorSetting(target, hexOrNull) {
            currentSettings[COLOR_TARGETS[target].settingKey] = hexOrNull;
            applyColorCSSVar(target);
            updateColorControlUI(target);
            // צבע (רקע/עמוד/כתב/חלונית מפרשים) הוא תמיד רק משתנה CSS - אינו משפיע בשום צורה על
            // גודל/רוחב העמוד (הקבוע ב-mm, ראו .print-page) ולכן לעולם לא משנה את חלוקת העמודים
            // עצמה. אין טעם/צורך לחייב סידור מחדש של כל הספר בגללו.
            saveSettings();
        }

        // ============================================================================
        function applyColorCSSVar(target) {
            const cfg = COLOR_TARGETS[target];
            const val = currentSettings[cfg.settingKey];
            if (val) {
                document.documentElement.style.setProperty(cfg.cssVar, val);
            } else {
                document.documentElement.style.removeProperty(cfg.cssVar);
            }
        }

        function updateColorControlUI(target) {
            const cfg = COLOR_TARGETS[target];
            const val = currentSettings[cfg.settingKey];
            const swatch = document.getElementById('color-picker-swatch-' + target);
            const label = document.getElementById('color-picker-label-' + target);
            if (swatch) {
                if (val) {
                    swatch.style.backgroundImage = 'none';
                    swatch.style.backgroundColor = val;
                } else {
                    swatch.style.backgroundColor = cfg.fallback;
                }
            }
            if (label) {
                label.textContent = val ? val.toUpperCase() : 'ברירת מחדל';
            }
            // סימון ה-preset הנבחר (אם הצבע הנוכחי תואם אחד מהם)
            const presetContainer = document.getElementById('color-picker-presets-' + target);
            if (presetContainer) {
                presetContainer.querySelectorAll('.color-picker-preset-swatch').forEach(btn => {
                    const presetHex = btn.getAttribute('data-preset-hex');
                    const isNone = btn.classList.contains('none-swatch');
                    btn.classList.toggle('selected', isNone ? !val : Boolean(val && presetHex === val.toLowerCase()));
                });
            }
            // סנכרון שדות ה-RGB/HEX אם הבורר המורחב פתוח כרגע
            const custom = document.getElementById('color-picker-custom-' + target);
            if (custom && custom.classList.contains('open')) {
                const rgb = hexToRgb(val || cfg.fallback);
                if (rgb) {
                    colorPickerState[target] = rgbToHsv(rgb.r, rgb.g, rgb.b);
                    redrawColorPickerCustom(target);
                }
            }
        }

        function redrawColorPickerCustom(target) {
            const state = colorPickerState[target];
            const { r, g, b } = hsvToRgb(state.h, state.s, state.v);
            const hex = rgbToHex(r, g, b);

            const svEl = document.getElementById('color-picker-sv-' + target);
            const svCursor = document.getElementById('color-picker-sv-cursor-' + target);
            const hueEl = document.getElementById('color-picker-hue-' + target);
            const hueCursor = document.getElementById('color-picker-hue-cursor-' + target);
            const rInput = document.getElementById('color-picker-r-' + target);
            const gInput = document.getElementById('color-picker-g-' + target);
            const bInput = document.getElementById('color-picker-b-' + target);
            const hexInput = document.getElementById('color-picker-hex-' + target);

            if (svEl) {
                svEl.style.backgroundColor = 'hsl(' + state.h + ', 100%, 50%)';
            }
            if (svCursor) {
                svCursor.style.left = (state.s * 100) + '%';
                svCursor.style.top = ((1 - state.v) * 100) + '%';
            }
            if (hueCursor) {
                hueCursor.style.left = (state.h / 360 * 100) + '%';
            }
            if (rInput) rInput.value = r;
            if (gInput) gInput.value = g;
            if (bInput) bInput.value = b;
            if (hexInput) hexInput.value = hex;
        }

        function onColorHexInputChange(target) {
            const hexInput = document.getElementById('color-picker-hex-' + target);
            if (!hexInput) return;
            const rgb = hexToRgb(hexInput.value);
            if (!rgb) {
                // ערך לא תקין - משחזר את התצוגה הקודמת התקינה
                redrawColorPickerCustom(target);
                return;
            }
            colorPickerState[target] = rgbToHsv(rgb.r, rgb.g, rgb.b);
            redrawColorPickerCustom(target);
            applyColorSetting(target, rgbToHex(rgb.r, rgb.g, rgb.b));
        }

        function onColorRgbInputChange(target) {
            const rInput = document.getElementById('color-picker-r-' + target);
            const gInput = document.getElementById('color-picker-g-' + target);
            const bInput = document.getElementById('color-picker-b-' + target);
            if (!rInput || !gInput || !bInput) return;
            const clamp = v => Math.max(0, Math.min(255, isNaN(v) ? 0 : v));
            const r = clamp(parseInt(rInput.value, 10));
            const g = clamp(parseInt(gInput.value, 10));
            const b = clamp(parseInt(bInput.value, 10));
            colorPickerState[target] = rgbToHsv(r, g, b);
            redrawColorPickerCustom(target);
            applyColorSetting(target, rgbToHex(r, g, b));
        }

        // מצמיד גרירה (עכבר/מגע) לריבוע הרוויה/בהירות ולרצועת הגוון של בורר נתון
        function attachColorPickerDragHandlers(target) {
            const svEl = document.getElementById('color-picker-sv-' + target);
            const hueEl = document.getElementById('color-picker-hue-' + target);

            if (svEl) {
                const handleSvPointer = (evt) => {
                    const rect = svEl.getBoundingClientRect();
                    const x = Math.max(0, Math.min(1, (evt.clientX - rect.left) / rect.width));
                    const y = Math.max(0, Math.min(1, (evt.clientY - rect.top) / rect.height));
                    colorPickerState[target].s = x;
                    colorPickerState[target].v = 1 - y;
                    redrawColorPickerCustom(target);
                    const { r, g, b } = hsvToRgb(colorPickerState[target].h, x, 1 - y);
                    applyColorSetting(target, rgbToHex(r, g, b));
                };
                svEl.addEventListener('pointerdown', (evt) => {
                    svEl.setPointerCapture(evt.pointerId);
                    handleSvPointer(evt);
                    const onMove = (e) => handleSvPointer(e);
                    const onUp = (e) => {
                        svEl.removeEventListener('pointermove', onMove);
                        svEl.removeEventListener('pointerup', onUp);
                    };
                    svEl.addEventListener('pointermove', onMove);
                    svEl.addEventListener('pointerup', onUp);
                });
            }

            if (hueEl) {
                const handleHuePointer = (evt) => {
                    const rect = hueEl.getBoundingClientRect();
                    const x = Math.max(0, Math.min(1, (evt.clientX - rect.left) / rect.width));
                    const h = Math.round(x * 360);
                    colorPickerState[target].h = h;
                    redrawColorPickerCustom(target);
                    const { r, g, b } = hsvToRgb(h, colorPickerState[target].s, colorPickerState[target].v);
                    applyColorSetting(target, rgbToHex(r, g, b));
                };
                hueEl.addEventListener('pointerdown', (evt) => {
                    hueEl.setPointerCapture(evt.pointerId);
                    handleHuePointer(evt);
                    const onMove = (e) => handleHuePointer(e);
                    const onUp = (e) => {
                        hueEl.removeEventListener('pointermove', onMove);
                        hueEl.removeEventListener('pointerup', onUp);
                    };
                    hueEl.addEventListener('pointermove', onMove);
                    hueEl.addEventListener('pointerup', onUp);
                });
            }
        }

        // --- המרות צבע (HEX/RGB/HSV) ---
        function hexToRgb(hex) {
            if (!hex) return null;
            let h = hex.trim().replace(/^#/, '');
            if (h.length === 3) {
                h = h.split('').map(c => c + c).join('');
            }
            if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
            return {
                r: parseInt(h.substring(0, 2), 16),
                g: parseInt(h.substring(2, 4), 16),
                b: parseInt(h.substring(4, 6), 16)
            };
        }

        function rgbToHex(r, g, b) {
            const toHex = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
            return '#' + toHex(r) + toHex(g) + toHex(b);
        }

        function rgbToHsv(r, g, b) {
            r /= 255; g /= 255; b /= 255;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            const d = max - min;
            let h = 0;
            if (d !== 0) {
                if (max === r) h = ((g - b) / d) % 6;
                else if (max === g) h = (b - r) / d + 2;
                else h = (r - g) / d + 4;
                h = Math.round(h * 60);
                if (h < 0) h += 360;
            }
            const s = max === 0 ? 0 : d / max;
            const v = max;
            return { h, s, v };
        }

        function hsvToRgb(h, s, v) {
            const c = v * s;
            const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
            const m = v - c;
            let r1 = 0, g1 = 0, b1 = 0;
            if (h < 60) { r1 = c; g1 = x; b1 = 0; }
            else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
            else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
            else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
            else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
            else { r1 = c; g1 = 0; b1 = x; }
            return {
                r: Math.round((r1 + m) * 255),
                g: Math.round((g1 + m) * 255),
                b: Math.round((b1 + m) * 255)
            };
        }

let currentLeaf = 0;

function updateBookViewSetting(val) {
            const previewArea = document.getElementById('preview-area');
            let targetPageIndex = 0;

            // חישוב ושמירת העמוד הנוכחי לפני שמבצעים את המעבר
            if (val === true) {
                targetPageIndex = getScrollCurrentPage();
                currentLeaf = Math.floor(targetPageIndex / 2);
                
                // ביטול זמני של הגלילה החלקה לנעילת איפוס מיידית ומניעת הסטה של הספר
                const originalScrollBehavior = previewArea.style.scrollBehavior;
                previewArea.style.scrollBehavior = 'auto';
                previewArea.scrollTop = 0;
                previewArea.scrollLeft = 0;
                
                setTimeout(() => {
                    previewArea.style.scrollBehavior = originalScrollBehavior;
                }, 60);
            } else {
                targetPageIndex = currentLeaf * 2;
            }

            currentSettings.isBookView = val;
            document.body.classList.toggle('book-view-active', val);

            // ביטול "תמונת הבסיס" הישנה של החיפוש (searchBaseHtml) בכל מעבר בין תצוגת ספר
            // לתצוגת עמוד: היא נשארת דבוקה למבנה ה-DOM של התצוגה שעוזבים (עמודים שטוחים מול
            // book-wrapper/book-leaf) - ובלי הביטול הזה, הקלדה/מחיקה הבאה בתיבת החיפוש
            // (שמפעילה clearSearchHighlights) הייתה משחזרת בטעות את מבנה ה-DOM הישן במקום זה
            // של התצוגה הנוכחית, וכל התצוגה הייתה משתבשת. אותו תיקון בדיוק כבר קיים היום
            // לריענון עימוד (ראו למטה בקובץ) ולמעבר בין טאבים (switchTab).
            delete previewArea.dataset.searchBaseHtml;
            lastSearchedQuery = null;

            updateBookViewModeUI();
            if (val) {
                buildBookDOM();
            } else {
                destroyBookDOM();

                // גלילה אוטומטית לעמוד הנכון מיד לאחר פירוק הספר
                setTimeout(() => {
                    scrollToPageInScrollView(targetPageIndex);
                }, 50);
            }
        }

// הפעלה/כיבוי של תצוגת "שני עמודים בשורה" בתוך תצוגת הגלילה הרגילה (לא תצוגת ספר).
// בכוונה לא נוגעת בשום דבר מתצוגת הספר (currentLeaf / buildBookDOM / destroyBookDOM וכו') -
// זו רק מחלקת CSS על ה-body שמשנה את פריסת #preview-area (ראו הכלל
// body.two-column-scroll-active #preview-area). מנגנון הגלילה, דפדוף החיצים ושמירת המיקום
// (getScrollCurrentPage / scrollToPageInScrollView) ממשיכים לעבוד בדיוק כפי שהם, ללא שינוי -
// כי הם מבוססים על המיקום הוויזואלי בפועל של כל עמוד (getBoundingClientRect), לא על מספר
// העמודים בכל שורה.
function updateTwoColumnScrollSetting(val) {
    // שמירת המיקום הנוכחי לפני שינוי הפריסה, בדיוק כמו בשינוי זום (ראו applyPageScale) - כדי
    // שהמעבר בין עמוד בודד בשורה לשני עמודים בשורה לא "יקפיץ" את הגלילה לעמוד אחר
    const posState = (!currentSettings.isBookView) ? capturePositionState() : null;

    currentSettings.twoColumnScroll = val;
    document.body.classList.toggle('two-column-scroll-active', val);

    if (posState) {
        requestAnimationFrame(() => restorePositionState(posState));
    }
}

function buildBookDOM() {
            const previewArea = document.getElementById('preview-area');
            if (previewArea.querySelector('.book-wrapper')) return;

            // ביטול זמני של גלילה חלקה למרכוז אבסולוטי ומניעת שיבושי מיקום
            const originalScrollBehavior = previewArea.style.scrollBehavior;
            previewArea.style.scrollBehavior = 'auto';
            previewArea.scrollTop = 0;
            previewArea.scrollLeft = 0;

            const pages = Array.from(previewArea.querySelectorAll('.print-page'));
            if (pages.length === 0) {
                previewArea.style.scrollBehavior = originalScrollBehavior;
                return;
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'book-wrapper';

            // הזרקת דף בטנה שמאלי קבוע (מודבק לכריכה השמאלית)
            const leftEndpaper = document.createElement('div');
            leftEndpaper.className = 'book-endpaper left-endpaper';
            wrapper.appendChild(leftEndpaper);

            // הזרקת דף בטנה ימני קבוע (מודבק לכריכה הימנית)
            const rightEndpaper = document.createElement('div');
            rightEndpaper.className = 'book-endpaper right-endpaper';
            wrapper.appendChild(rightEndpaper);

            let leafCount = Math.ceil(pages.length / 2);
            for (let i = 0; i < leafCount; i++) {
                const leaf = document.createElement('div');
                leaf.className = 'book-leaf';

                const frontPage = pages[i * 2];
                const backPage = pages[i * 2 + 1];

                if (frontPage) {
                    frontPage.classList.add('front');
                    if (!frontPage.querySelector('.page-shadow')) {
                        frontPage.insertAdjacentHTML('beforeend', '<div class="page-shadow"></div>');
                    }
                    leaf.appendChild(frontPage);
                }
                if (backPage) {
                    backPage.classList.add('back');
                    if (!backPage.querySelector('.page-shadow')) {
                        backPage.insertAdjacentHTML('beforeend', '<div class="page-shadow"></div>');
                    }
                    leaf.appendChild(backPage);
                }

                wrapper.appendChild(leaf);
            }

            previewArea.innerHTML = '';
            previewArea.appendChild(wrapper);
            updateBookViewPages();

            // החזרת מצב הגלילה לקדמותו לאחר שהספר נבנה במרכז אבסולוטי
            setTimeout(() => {
                previewArea.style.scrollBehavior = originalScrollBehavior;
            }, 60);
        }

        // הדפסה: כשנמצאים בתצוגת ספר, ההדפסה צריכה להשתמש במנגנון/מבנה ההדפסה של תצוגת גלילה -
        // אבל בלי לשנות בכלל את התצוגה החיה על המסך, אפילו לא לרגע. לכן לא מפרקים ולא נוגעים
        // ב-DOM האמיתי של הספר (כמו שנעשה בניסיון קודם) - במקום זה בונים עותק שטוח נפרד ("צילום")
        // של כל עמודי הספר בדיוק כפי שהם מוצגים בתצוגת גלילה, בתוך קונטיינר חדש שמוסתר לחלוטין
        // במסך (display:none כברירת מחדל) ונחשף רק בפועל בזמן ההדפסה עצמה (media print). כך
        // התצוגה על המסך לא זזה, לא מהבהבת ולא משתנה בשום שלב - המשתמש ממשיך לראות בדיוק את
        // תצוגת הספר שהייתה לו, וגם המהירות זהה להדפסה מתצוגת גלילה כי המבנה המודפס בפועל זהה לה
        // לחלוטין (עמודים שטוחים רגילים, בלי leaf-ים/טרנספורמציות/endpaper-ים).