        function destroyBookDOM() {
            const previewArea = document.getElementById('preview-area');
            const wrapper = previewArea.querySelector('.book-wrapper');
            if (!wrapper) return;

            const leaves = wrapper.querySelectorAll('.book-leaf');
            const fragment = document.createDocumentFragment();

            leaves.forEach(leaf => {
                const pages = leaf.querySelectorAll('.print-page');
                pages.forEach(p => {
                    p.classList.remove('front', 'back');
                    const shadow = p.querySelector('.page-shadow');
                    if (shadow) shadow.remove();
                    fragment.appendChild(p);
                });
            });

            previewArea.innerHTML = '';
            previewArea.appendChild(fragment);
        }

function updateBookViewPages(skipPanReset) {
            const leaves = document.querySelectorAll('.book-leaf');
            if (leaves.length === 0) return;

            // איפוס ההיסט האנכי (פאן) בכל פעולה שמרכזת את הספר מחדש (בניית ספר, מעבר טאב,
            // קפיצה לעמוד וכו') - אך לא בדפדוף רגיל בין עמודים (ראו הקריאה עם skipPanReset=true
            // מתוך nextBookPage/prevBookPage), כדי שדפדוף עם החיצים לא ימרכז אוטומטית
            if (!skipPanReset) resetBookPanY();

            leaves.forEach((leaf, index) => {
                // קביעת מצב הדפדוף והסדר בערמה
                if (index < currentLeaf) {
                    leaf.classList.add('flipped');
                    leaf.style.zIndex = index;
                } else {
                    leaf.classList.remove('flipped');
                    leaf.style.zIndex = leaves.length - index;
                }

                // --- פתרון העומס (אופטימיזציה) ---
                // מציג רק 3 דפים אחורה ו-3 דפים קדימה. כל שאר הדפים מוסתרים לחלוטין
                // כדי לשחרר את העומס מהמעבד הגרפי של הדפדפן.
                if (index >= currentLeaf - 5 && index <= currentLeaf + 4) {
                    leaf.style.display = 'block';
                } else {
                    leaf.style.display = 'none';
                }
            });

            // עדכון לחצני הניווט הצפים
            const nextBtn = document.getElementById('book-nav-next');
            const prevBtn = document.getElementById('book-nav-prev');
            if (nextBtn && prevBtn) {
                nextBtn.disabled = (currentLeaf >= leaves.length);
                prevBtn.disabled = (currentLeaf === 0);
            }
            if (typeof scheduleNavBarUpdate === 'function') scheduleNavBarUpdate();

            requestAnimationFrame(updateNavArrowOverlap);

            // ה"עלה" (2 עמודים) המוצג עשוי היה להשתנות - אם חלונית המפרשים פתוחה, מרעננים
            // כדי שהתוכן יתאים בדיוק לשני העמודים המוצגים עכשיו (ראו refreshCommentaryPanel)
            if (activeTabIndex !== -1 && tabs[activeTabIndex] && tabs[activeTabIndex].commentaryPanelOpen) {
                refreshCommentaryPanel();
            }
        }

        // בדיקה גיאומטרית: האם הספר (book-wrapper) חופף בפועל לאזור של כל אחד מחצי הניווט.
        // אם כן - החץ נעשה כמעט שקוף כדי לא להסתיר את הטקסט שמתחתיו; אם הוא יושב על הרקע
        // הריק שמסביב לספר - הוא נשאר נראה היטב.
        function updateNavArrowOverlap() {
            if (!currentSettings.isBookView) {
                document.querySelectorAll('.nav-arrow.over-book').forEach(el => el.classList.remove('over-book'));
                return;
            }
            const wrapper = document.querySelector('.book-wrapper');
            const arrows = document.querySelectorAll('.nav-arrow');
            if (!wrapper || arrows.length === 0) return;
            const b = wrapper.getBoundingClientRect();
            arrows.forEach(arrow => {
                const a = arrow.getBoundingClientRect();
                const overlaps = !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
                arrow.classList.toggle('over-book', overlaps);
            });
        }

        window.addEventListener('resize', updateNavArrowOverlap);
        // שינוי גודל חלון עשוי לשנות את גבולות ההיסט האנכי המותרים (ראו getMaxBookPanY) -
        // מהדקים (clamp) את ההיסט הקיים לגבולות המעודכנים כדי שהספר לא יישאר "תקוע" מחוץ
        // לגבולותיו האמיתיים אחרי שינוי גודל
        window.addEventListener('resize', function() {
            if (!currentSettings.isBookView) return;
            const maxPan = getMaxBookPanY();
            const clamped = Math.max(-maxPan, Math.min(maxPan, bookPanY));
            if (clamped !== bookPanY) {
                bookPanY = clamped;
                document.documentElement.style.setProperty('--book-pan-y', bookPanY + 'px');
            }
        });

        function nextBookPage() {
            const leaves = document.querySelectorAll('.book-leaf');
            if (currentLeaf < leaves.length) {
                leaves[currentLeaf].classList.add('flipped');
                currentLeaf++;
                updateBookViewPages(true);
            }
        }

        function prevBookPage() {
            const leaves = document.querySelectorAll('.book-leaf');
            if (currentLeaf > 0) {
                currentLeaf--;
                leaves[currentLeaf].classList.remove('flipped');
                updateBookViewPages(true);
            }
        }

        function toggleBookView() {
            const newValue = !currentSettings.isBookView;
            const checkbox = document.getElementById('setting-is-book-view');
            if (checkbox) checkbox.checked = newValue;
            updateBookViewSetting(newValue);
            saveSettings();
        }

        function selectViewMode(isBookView) {
            if (Boolean(currentSettings.isBookView) === isBookView) {
                closeAllPopovers();
                return;
            }
            const checkbox = document.getElementById('setting-is-book-view');
            if (checkbox) checkbox.checked = isBookView;
            updateBookViewSetting(isBookView);
            saveSettings();
            closeAllPopovers();
        }

function appendPagesToBookDOM(fragment) {
            const previewArea = document.getElementById('preview-area');
            let wrapper = previewArea.querySelector('.book-wrapper');
            if (!wrapper) {
                wrapper = document.createElement('div');
                wrapper.className = 'book-wrapper';
                
                // הזרקת דף בטנה שמאלי קבוע (ריפוד כריכה שמאלי)
                const leftEndpaper = document.createElement('div');
                leftEndpaper.className = 'book-endpaper left-endpaper';
                wrapper.appendChild(leftEndpaper);

                // הזרקת דף בטנה ימני קבוע (ריפוד כריכה ימני)
                const rightEndpaper = document.createElement('div');
                rightEndpaper.className = 'book-endpaper right-endpaper';
                wrapper.appendChild(rightEndpaper);
                
                previewArea.appendChild(wrapper);
                currentLeaf = 0;
            }

            const newPages = Array.from(fragment.childNodes).filter(n => n.nodeType === 1 && n.classList.contains('print-page'));

            newPages.forEach(p => {
                let lastLeaf = wrapper.lastElementChild;
                // בדיקה שאיננו מתייחסים לדפי הבטנה הקבועים כעלה מדפדף
                if (!lastLeaf || lastLeaf.classList.contains('book-endpaper') || lastLeaf.childElementCount >= 2) {
                    lastLeaf = document.createElement('div');
                    lastLeaf.className = 'book-leaf';
                    wrapper.appendChild(lastLeaf);
                }

                if (lastLeaf.childElementCount === 0) {
                    p.classList.add('front');
                } else {
                    p.classList.add('back');
                }
                
                if (!p.querySelector('.page-shadow')) {
                    p.insertAdjacentHTML('beforeend', '<div class="page-shadow"></div>');
                }
                lastLeaf.appendChild(p);
            });

            updateBookViewPages();
        }

        function updateMarginValue(val) {
            currentSettings.margin = parseInt(val, 10);
            document.documentElement.style.setProperty('--page-margin', val + 'mm');
            const marginVal = document.getElementById('setting-margin-val');
            if (marginVal) marginVal.innerText = val + ' מ"מ';
            triggerRepagination();
        }

        function updateColumnGapValue(val) {
            currentSettings.columnGap = parseInt(val, 10);
            document.documentElement.style.setProperty('--column-gap', val + 'mm');
            const gapVal = document.getElementById('setting-column-gap-val');
            if (gapVal) gapVal.innerText = val + ' מ"מ';
            triggerRepagination();
        }
        function updateColumnRuleSetting(isChecked) {
            currentSettings.showColumnRule = isChecked;
            const ruleStyle = isChecked ? '2px solid var(--color-outline-subtle)' : 'none';
            document.documentElement.style.setProperty('--column-rule-style', ruleStyle);
            // אין צורך לשמור תצוגה מקדימה כאן: זהו משתנה CSS גלובלי, כל עמוד (גם דרך מטמון) יקרא
            // אותו מחדש ממילא בכל רגע נתון - אין תוכן HTML "קפוא" שדורש סנכרון ידני.
        }

        function updateCompactToolbarSetting(isChecked) {
            currentSettings.compactToolbar = isChecked;
            document.body.classList.toggle('compact-toolbar', isChecked);
        }

function updateHeaderSetting(val) {
            currentSettings.showHeader = val;
            // הכותרת תמיד קיימת בעמוד (ראו preparePageWithHeader) ותופסת את אותו מקום בדיוק בין
            // אם היא מוצגת ובין אם לא - ולכן די בהחלפת מחלקה על ה-body כדי להסתיר/להציג אותה
            // חזותית (visibility, לא display), בלי שום עימוד מחדש של הספר.
            document.body.classList.toggle('hide-page-header', val === false);
        }

        function updateHideNikudSetting(val) {
            currentSettings.hideNikud = val;
            triggerRepaginationFast();
        }

        function updateHideTeamimSetting(val) {
            currentSettings.hideTeamim = val;
            triggerRepaginationFast();
        }

        function updateHidePunctuationSetting(val) {
            currentSettings.hidePunctuation = val;
            triggerRepaginationFast();
        }

        function updateHolyNamesFilterSetting(val) {
            currentSettings.holyNamesFilter = val;
            if (typeof scheduleNavBarUpdate === 'function') scheduleNavBarUpdate();
            const displayCard = document.getElementById('holy-names-display-card');
            if (displayCard) displayCard.style.display = val === 'none' ? 'none' : '';
            updateHolyNamesYYCardVisibility();
            triggerRepaginationFast();
        }

        function updateHolyNamesDisplaySetting(val) {
            currentSettings.holyNamesDisplay = val;
            if (typeof scheduleNavBarUpdate === 'function') scheduleNavBarUpdate();
            updateHolyNamesYYCardVisibility();
            triggerRepaginationFast();
        }

        // מתג "שם הוי"ה יופיע כ-י"י" רלוונטי רק כשהסינון פעיל ואופן ההצגה הוא כינוי (לא מקף)
        function updateHolyNamesYYSetting(val) {
            currentSettings.holyNamesYY = Boolean(val);
            if (typeof scheduleNavBarUpdate === 'function') scheduleNavBarUpdate();
            triggerRepaginationFast();
        }

        function updateHolyNamesYYCardVisibility() {
            const card = document.getElementById('holy-names-yy-card');
            if (!card) return;
            const filterOn = (currentSettings.holyNamesFilter || 'havaya') !== 'none';
            const kinuyMode = (currentSettings.holyNamesDisplay || 'hyphen') === 'kinuy';
            card.style.display = (filterOn && kinuyMode) ? '' : 'none';
        }

        function updateAggressiveAlefSetting(val) {
            currentSettings.holyNamesAggressiveAlef = val;
            triggerRepaginationFast();
        }

        // טווחי יוניקוד נפרדים: ניקוד (תנועות) לעומת טעמי מקרא (טעמים)
        const NIKUD_RE = /[\u05B0-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g;
        const TEAMIM_RE = /[\u0591-\u05AF]/g;

        /* --- שמות קדושים: זיהוי והחלפה/פירוק לפי הגדרות המשתמש (settings > שמות קדושים) ---
           טווח ניקוד+טעמים המשמש הן לתמיכה בטקסט מנוקד בין אותיות השם עצמו (נפוץ בספרי קודש) והן
           לוודא שאות מנוקדת לא נחשבת "אות נפרדת" לצורך בדיקת גבולות המילה */
        // טווח הניקוד/הטעמים המשמש לזיהוי גבולות מילה סביב שמות קדושה. מוציא במפורש את תו המקף
        // העברי (\u05BE) - למרות שהוא נופל מספרית בתוך הטווח \u0591-\u05C7, הוא אינו ניקוד/טעם
        // אלא סימן פיסוק, ולכן אסור שהוא "יוסתר" בבדיקת "קדמה אות עברית ממש" (NOT_PRECEDED_BY_LETTER
        // למטה) - בלעדי ההוצאה הזו, מקף מיד לפני שם קדושה (כגון "בית־יהוה") גרם לבדיקה לחשוב
        // בטעות שהאות שלפני המקף "צמודה" לשם הקדושה, וכך מנע את זיהוי השם וההסתרה שלו.
        const HOLY_DIACRITIC_RE_SRC = '[\\u0591-\\u05BD\\u05BF-\\u05C7]*';
        const HEBREW_LETTER_RE_SRC = '[\\u05D0-\\u05EA]';
        // גרסה יחידנית (בודקת תו בודד, לא רצף) של אותו טווח ניקוד/טעמים - משמשת לבדיקת "מהו הניקוד
        // המדויק הצמוד לאות פלונית" (למשל קמץ תחת ה-נ' של "אדני", או צירה תחת ה-ל' שלפני "יה") ולא
        // רק "האם יש כאן ניקוד כלשהו" - ראו textHasDiacriticAfterLetter למטה.
        const DIACRITIC_SINGLE_CHAR_RE = /[\u0591-\u05BD\u05BF-\u05C7]/;

        // בדיקת "תחילת מילה"/"סוף מילה" שמתעלמת מניקוד/טעמים - כלומר בודקת שאין אות עברית ממש
        // לפני/אחרי ההתאמה, גם אם ביניהן יש ניקוד/טעמים. תיקון קריטי לעומת גרסה קודמת: בדיקה
        // נאיבית שבודקת רק את התו הבודד הסמוך "מתבלבלת" כשיש ניקוד בין האות הקודמת/הבאה לבין
        // ההתאמה - למשל במילה "עֲלִיָּה" הניקוד (חיריק) שיושב מיד לפני ה-"יה" גורם לבדיקה הנאיבית
        // לחשוב בטעות שאין שום אות עברית "ממש ליד" ולכן שמדובר בתחילת מילה, בעוד שבפועל יש אות
        // עברית (ל') לפני הניקוד הזה - וכך "יה" (וכן "אל") היו מזוהים בטעות גם באמצע מילים. לכן
        // הבדיקה כאן "מדלגת" מעל ניקוד/טעמים ובודקת את האות שמעבר להם (lookbehind במידה משתנה).
        const NOT_PRECEDED_BY_LETTER_SRC = '(?<!' + HEBREW_LETTER_RE_SRC + HOLY_DIACRITIC_RE_SRC + ')';
        // בדומה ל-NOT_PRECEDED_BY_LETTER_SRC למעלה - יש "לדלג" מעל ניקוד/טעמים גם כשבודקים את
        // האות שאחרי ההתאמה, לא רק את זו שלפניה. בלי זה (הבדיקה הישנה בדקה רק את התו הבודד הסמוך)
        // המחוון הגרידי של הניקוד בתוך corePattern נסוג (backtrack) כדי לאפשר לבדיקה להצליח,
        // ומשאיר ניקוד "חשוף" מיד אחרי ההתאמה - כך ששם קדושה באמצע מילה (כגון "יה" בתוך "יְהַלְלוּ")
        // זוהה בטעות כאילו הוא עומד בפני עצמו, במקום שיישאר חסום כי בפועל יש עוד אות עברית (ל') מיד אחריו.
        const NOT_FOLLOWED_BY_LETTER_SRC = '(?!' + HOLY_DIACRITIC_RE_SRC + HEBREW_LETTER_RE_SRC + ')';

        // אותיות שימוש (ב' ו' ל' מ' כ' ה' ד' ש') שיכולות להופיע בתחילת המילה מיד לפני שם קדושה -
        // עם כל ניקוד שהוא - ולהתעלם מהן בזיהוי השם עצמו (כגון "לאלהים", "באלהים", "כאלהים" וכו').
        // מוגבלת לאות שימוש בודדת אחת (לא כמה אותיות שימוש ברצף), ותמיד נשארת ללא שינוי בתוצאה -
        // רק השם הקדוש עצמו מוסתר/מוחלף. חלה על כל השמות הקדושים (כולל "אל"/"אלי" למטה).
        const PREFIX_LETTERS_RE_SRC = '[בולמכהדש]';
        // תמיכה באות שימוש נוספת - וי"ו החיבור - שיכולה להופיע לפני אות השימוש עצמה, כגון
        // "ובאלהים", "ומאלהים", "ולאלהים" (ולא רק אות שימוש בודדת כמו שהיה עד כה). חלה על כל
        // אותיות השימוש וכל שמות הקדושה, כי כולם משתמשים ב-PREFIX_GROUP_RE_SRC המשותף הזה. כל
        // אותיות השימוש (כולל ה-ו' הנוספת, אם קיימת) תמיד נשארות ללא שינוי בתוצאה.
        const PREFIX_GROUP_RE_SRC = '(?:' + '(?:ו' + HOLY_DIACRITIC_RE_SRC + ')?' + PREFIX_LETTERS_RE_SRC + HOLY_DIACRITIC_RE_SRC + ')?';

        // כל שם קדושה מוגדר לפי רצף אותיות היסוד שלו (ללא ניקוד) ותחליף הכינוי המקובל לו.
        // havayaOnly=true מסמן שהשם נכלל גם בסינון "רק שם הוי"ה המפורש" (לא רק ב"כל שמות הקדושה")
        const HOLY_NAMES = [
            { letters: 'יהוה', kinuy: 'יקוק', havayaOnly: true },
            { letters: 'אלהים', kinuy: 'אלקים', havayaOnly: false },
            { letters: 'אדני', kinuy: "ה'", havayaOnly: false, allowInnerHyphen: true },
            { letters: 'שדי', kinuy: 'שקי', havayaOnly: false, allowInnerHyphen: true },
            { letters: 'יה', kinuy: 'קה', havayaOnly: false },
            { letters: 'צבאות', kinuy: 'צבקות', havayaOnly: false },
            { letters: 'אלוה', kinuy: 'אלוק', havayaOnly: false },
            { letters: 'אלהי', kinuy: 'אלקי', havayaOnly: false },
            { letters: 'אלהינו', kinuy: 'אלוקינו', havayaOnly: false },
            { letters: 'אלהיך', kinuy: 'אלקיך', havayaOnly: false },
            { letters: 'אלהיכם', kinuy: 'אלקיכם', havayaOnly: false },
            { letters: 'אלהיו', kinuy: 'אלקיו', havayaOnly: false },
            { letters: 'אלוהי', kinuy: 'אלוקי', havayaOnly: false },
            { letters: 'אלוהים', kinuy: 'אלוקים', havayaOnly: false },
            { letters: 'אלוהינו', kinuy: 'אלוקינו', havayaOnly: false },
            { letters: 'אלוהיך', kinuy: 'אלוקיך', havayaOnly: false },
            { letters: 'אלוהיכם', kinuy: 'אלוקיכם', havayaOnly: false },
            { letters: 'אלוהיו', kinuy: 'אלוקיו', havayaOnly: false },
            { letters: 'אלהותו', kinuy: 'אלקותו', havayaOnly: false },
            { letters: 'אלוהותו', kinuy: 'אלוקותו', havayaOnly: false }
        ];

        function buildHolyNameLetterPattern(word, allowInnerHyphen) {
            // תבנית שמאפשרת ניקוד/טעמים אופציונליים בין כל אות ואות של המילה - כדי לתפוס גם טקסט מנוקד.
            // allowInnerHyphen: מאפשר גם מקף (רגיל או עברי) אופציונלי בין אותיות השם - למקרה שהמקור כבר
            // כתוב בחלוקה להברות (כגון "ש-די", "אֲדֹ-נָי")
            const letters = Array.from(word);
            return letters.map((ch, i) => ch + HOLY_DIACRITIC_RE_SRC +
                ((allowInnerHyphen && i < letters.length - 1) ? '(?:[\\u05BE\\-])?' : '')).join('');
        }

        // בונה regex לשם קדושה בודד, כולל קבוצת "אות שימוש" אופציונלית (group 1) לפני קבוצת השם
        // עצמו (group 2) - כך שאפשר להשאיר את אות השימוש ללא שינוי, ולהחליף/לפרק רק את השם עצמו
        function buildSingleHolyNameRegex(nameDef, allowInnerHyphen) {
            const corePattern = buildHolyNameLetterPattern(nameDef.letters, Boolean(allowInnerHyphen));
            return new RegExp(
                NOT_PRECEDED_BY_LETTER_SRC +
                '(' + PREFIX_GROUP_RE_SRC + ')' +
                '(' + corePattern + ')' +
                NOT_FOLLOWED_BY_LETTER_SRC,
                'g'
            );
        }

        // "היה" / "והיה" (עם או בלי ניקוד) הן מילות חול (הפועל "להיות") ולא שם קדושה, למרות שהן נראות
        // כאות שימוש (ה / וה) + "יה". מוחרגות מההסתרה הכללית כשהן עומדות כמילה שלמה: לפניהן ואחריהן
        // רווח / תחילת-סוף טקסט / סימן פיסוק (ולא מקף - מקף צמוד לא נחשב מילה עצמאית).
        const HAYA_BOUNDARY_RE = /[\s.,;:!?()\[\]{}"'\u05F3\u05F4\u2026]/;
        function isPlainHayaWord(prefix, matchedText, fullString, offset) {
            const strippedPrefix = (prefix || '').replace(/[\u0591-\u05C7]/g, '');
            if (strippedPrefix !== 'ה' && strippedPrefix !== 'וה') return false;
            const before = offset > 0 ? fullString.charAt(offset - 1) : '';
            const after = fullString.charAt(offset + matchedText.length);
            const okBefore = before === '' || HAYA_BOUNDARY_RE.test(before);
            const okAfter = after === '' || HAYA_BOUNDARY_RE.test(after);
            return okBefore && okAfter;
        }

        // הצגה בכינוי עם שמירת הניקוד/הטעמים של המקור: כל אות של הכינוי מקבלת את הניקוד שהיה על האות
        // המקבילה לה בשם המקורי (אֱלֹהִים -> אֱלֹקִים). כשאין בשם המקורי שום ניקוד, או כשאי אפשר ליישר
        // את האותיות אחת-לאחת (כגון "ה'" במקום אדני), מוחזר הכינוי כפי שהוא, בדיוק כמו קודם.
        function applyKinuyKeepingNikud(coreText, kinuyText, originalLetters) {
            if (!/[\u0591-\u05C7]/.test(coreText)) return kinuyText;
            if (!/^[\u05D0-\u05EA]+$/.test(kinuyText)) return kinuyText;
            const groups = coreText.match(new RegExp(HEBREW_LETTER_RE_SRC + HOLY_DIACRITIC_RE_SRC, 'g'));
            if (!groups) return kinuyText;
            let target = kinuyText;
            if (target.length !== groups.length && originalLetters) {
                // כינוי עם אות נוספת (אלוקינו) - עם ניקוד משתמשים בהחלפת ה'->ק' אות-באות (אֱלֹקֵינוּ)
                target = originalLetters.replace(/ה/g, 'ק');
            }
            if (target.length !== groups.length) return kinuyText;
            return groups.map((g, i) => target.charAt(i) + g.slice(1)).join('');
        }

        // המרת טקסט השם הקדוש עצמו (ללא אות השימוש, אם הייתה) לתצוגה המבוקשת - מקף (פירוק אות-אות,
        // כל אחת עם הניקוד/הטעמים הצמודים לה) או כינוי קבוע (kinuyText)
        function transformHolyCoreText(coreText, displayMode, kinuyText, originalLetters) {
            if (displayMode === 'kinuy') {
                return applyKinuyKeepingNikud(coreText, kinuyText, originalLetters);
            }
            const letterGroups = coreText.match(new RegExp(HEBREW_LETTER_RE_SRC + HOLY_DIACRITIC_RE_SRC, 'g'));
            return letterGroups ? letterGroups.join('-') : coreText;
        }

        // בודקת אם התו letterChar (למשל 'נ' או 'ל') מופיע בתוך text, ואם כן - האם אחד מתווי
        // הניקוד/הטעמים הצמודים מיד אחריו (עד לאות העברית הבאה) הוא בדיוק diacriticChar המבוקש.
        // בשונה מ-HOLY_DIACRITIC_RE_SRC (שרק בודק "יש/אין ניקוד"), כאן בודקים ניקוד מדויק - כדי
        // להבחין בין שם קדושה לבין מילת חול הכתובה באותן אותיות ממש עם ניקוד שונה. משמשת הן
        // לבדיקת קמץ תחת ה-נ' של "אדני" (לעומת "אדני המשכן"/"אדני האדונים" בניקוד אחר) והן
        // לבדיקת צירה תחת ה-ל' שלפני "יה" (להחריג "ליה" מזיהוי כשם קדושה) - ראו קריאות למטה.
        function textHasDiacriticAfterLetter(text, letterChar, diacriticChar) {
            if (!text) return false;
            const idx = text.lastIndexOf(letterChar);
            if (idx === -1) return false;
            let i = idx + 1;
            while (i < text.length && DIACRITIC_SINGLE_CHAR_RE.test(text[i])) {
                if (text[i] === diacriticChar) return true;
                i++;
            }
            return false;
        }

        /* --- הרחבה: "אל" ו"אלי" - מזוהים כשם קדושה רק עם ניקוד מדויק (חלק מ"כל שמות הקדושה") ---
           בשונה משאר השמות ב-HOLY_NAMES (המזוהים תחת כל ניקוד, כולל בלי ניקוד כלל), "אל" ו"אלי"
           הן גם מילות חול נפוצות ביותר ("אַל תעשה", "אֵלַי הגיע") - ולכן מטופלות כאן בנפרד, ומזוהות
           כשם קדושה רק כשקיים הניקוד המדויק הבא: "אל" - צירה מתחת א' ובלי שום ניקוד נוסף מתחת ל'
           (אֵל); "אלי" - צירה מתחת א' וחיריק מתחת ל' (אֵלִי). ניקוד אחר (כגון סגול/פתח מתחת א', או
           צירה מתחת ל') לא נחשב שם קדושה כלל, כי אז זו יכולה להיות גם מילת חול. טעמי המקרא (בניגוד
           לניקוד) מתעלמים מהם לגמרי ומותרים בכל מקום בין האותיות. מקף (עברי או רגיל) מיד לפני "אל"
           (למשל "בית־אל") מזהה את השם גם בלי שום ניקוד, כי צירוף כזה הוא תמיד שם קדושה ולא מילת
           החיבור "אל" (=to); לעומת זאת מקף מיד אחרי ה-ל' (למשל "אל־הבית") שולל את הזיהוי תמיד -
           גם עם הניקוד המדויק - כי זו בוודאות מילת החיבור. בדיקות גבול המילה (כולל תמיכה באות
           שימוש מובילה - ראו PREFIX_GROUP_RE_SRC למעלה) מבטיחות גם שלעולם לא יתבלבל עם "אלהים"
           (שיש לה טיפול נפרד משלה למעלה).*/
        const TEAMIM_ONLY_RE_SRC = '[\\u0591-\\u05AF]*';
        const NIQQUD_MARK_RE_SRC = '[\\u05B0-\\u05BD\\u05BF\\u05C1\\u05C2\\u05C4\\u05C5\\u05C7]';
        const MAQAF_CHAR_RE_SRC = '[\\u05BE\\-]';

        // "א" עם צירה בדיוק (טעמים מותרים מסביב, שום ניקוד אחר לא מתקבל)
        const ALEF_TZERE_RE_SRC = 'א' + TEAMIM_ONLY_RE_SRC + '\\u05B5' + TEAMIM_ONLY_RE_SRC;
        // "ל" ללא שום ניקוד (רק טעמים מותרים) - נדרש עבור "אל" בדיוק
        const LAMED_BARE_RE_SRC = 'ל' + TEAMIM_ONLY_RE_SRC;
        // "ל" עם חיריק בדיוק (טעמים מותרים מסביב) - נדרש עבור "אלי" בדיוק
        const LAMED_HIRIQ_RE_SRC = 'ל' + TEAMIM_ONLY_RE_SRC + '\\u05B4' + TEAMIM_ONLY_RE_SRC;
        const YOD_TEAMIM_RE_SRC = 'י' + TEAMIM_ONLY_RE_SRC;

        // "אל" עם הניקוד המדויק - עם שמירה שאין ניקוד "שיורי" מיד אחרי ה-ל' (LAMED_BARE_RE_SRC
        // בולע רק טעמים, לא ניקוד; אם בכל זאת יש ניקוד אחרי ה-ל' - זו בעצם מילה אחרת, כמו "אלי")
        const EL_PRECISE_WITH_GUARD_SRC = ALEF_TZERE_RE_SRC + LAMED_BARE_RE_SRC + '(?!' + NIQQUD_MARK_RE_SRC + ')';
        // "אל" מיד אחרי מקף - כל ניקוד (או בלי ניקוד כלל) מתקבל, כי המקף עצמו כבר מוכיח שזה שם קדושה
        const EL_AFTER_MAQAF_RE_SRC = '(?<=' + MAQAF_CHAR_RE_SRC + ')' + 'א' + HOLY_DIACRITIC_RE_SRC + 'ל' + HOLY_DIACRITIC_RE_SRC;
        // "אלי" עם הניקוד המדויק בלבד (אותה שמירה מפני ניקוד שיורי לאחר מכן)
        const ELI_PRECISE_RE_SRC = ALEF_TZERE_RE_SRC + LAMED_HIRIQ_RE_SRC + YOD_TEAMIM_RE_SRC + '(?!' + NIQQUD_MARK_RE_SRC + ')';

        function buildElRegex() {
            // לא מזוהה אם אחרי ה-ל' יש עוד אות עברית (סימן שהמילה ממשיכה) ולא אם מיד אחריה מקף
            // (סימן שזו מילת החיבור "אל", לא שם הקדושה) - בדיקות אלו משותפות לשתי החלופות.
            // group 1 = אות שימוש אופציונלית לפני השם, group 2 = השם "אל" עצמו
            return new RegExp(
                NOT_PRECEDED_BY_LETTER_SRC +
                '(' + PREFIX_GROUP_RE_SRC + ')' +
                '(' + '(?:' + EL_PRECISE_WITH_GUARD_SRC + '|' + EL_AFTER_MAQAF_RE_SRC + ')' + ')' +
                NOT_FOLLOWED_BY_LETTER_SRC + '(?!' + MAQAF_CHAR_RE_SRC + ')',
                'g'
            );
        }

        function buildEliRegex() {
            return new RegExp(
                NOT_PRECEDED_BY_LETTER_SRC +
                '(' + PREFIX_GROUP_RE_SRC + ')' +
                '(' + ELI_PRECISE_RE_SRC + ')' +
                NOT_FOLLOWED_BY_LETTER_SRC,
                'g'
            );
        }

        // הסתרת "א-ל" אגרסיבית (הגדרה נפרדת ועצמאית מתפריט הסינון הכללי, כבויה כברירת מחדל - ראו
        // settings > שמות קדושים): מזהה את "אל" גם ללא שום ניקוד בכלל. "אלי" מוחרגת ממנה לגמרי
        // בזכות בדיקת "לא ממשיכה באות עברית נוספת" (ה-י' של "אלי" היא אות עברית) - וכן מוחרג מקף
        // מיד אחרי ה-ל' (למשל "אל־הבית", שזו בוודאות מילת החיבור). ניקוד סגול או פתח מתחת ה-א'
        // (אֶל/אַל) מוחרג גם כאן, גם במצב אגרסיבי - כי אלו כמעט תמיד מילות חול ("to"/"don't") ולא
        // שם קדושה; הבדיקה בפועל מתבצעת ב-callback שבפונקציית הקורא (applyTextFilters) ולא כאן,
        // כי קל יותר לבדוק זאת על הטקסט שנתפס בפועל מאשר לבטא זאת בתוך ה-regex עצמו.
        function buildElAggressiveRegex() {
            return new RegExp(
                NOT_PRECEDED_BY_LETTER_SRC +
                '(' + PREFIX_GROUP_RE_SRC + ')' +
                '(' + 'א' + HOLY_DIACRITIC_RE_SRC + 'ל' + HOLY_DIACRITIC_RE_SRC + ')' +
                NOT_FOLLOWED_BY_LETTER_SRC + '(?!' + MAQAF_CHAR_RE_SRC + ')',
                'g'
            );
        }

        // הסרת ניקוד/טעמים/סימני פיסוק בהתאם להגדרות (ללא שינוי rawContent המקורי בטאב).
        // עובד ברמת ה-DOM (לא regex גולמי על מחרוזת ה-HTML) כדי להבדיל בין כותרות לגוף הטקסט,
        // ולא לפגוע בתגיות עצמן.
        function applyTextFilters(html) {
            // ניקוי שארית טקסט שבורה שדולפת מתוך תכונת HTML פנימית (data-commentator) שנחתכה בין
            // צ'אנקים ולא זוהתה כתגית/תכונה תקינה בשלב הסניטציה - תמיד מוסר, ללא תלות בהגדרות אחרות.
            // שימוש בביטוי רגולרי (ולא התאמת מחרוזת מדויקת) כדי לתפוס גם וריאציות של סוג המרכאה
            // (ישרה/עקומה/HTML entity) וגם תווי כיווניות נסתרים (RLM/LRM) שעלולים להימצא בין התווים
            if (html) {
                html = html.replace(/i[\s\u200e\u200f]*Berurah[\s\u200e\u200f]*("|&quot;|[\u201c\u201d\u05f4])?/gi, '');
            }

            const holyNamesActive = currentSettings.holyNamesFilter && currentSettings.holyNamesFilter !== 'none';
            // הסתרת "א-ל" אגרסיבית היא הגדרה עצמאית משלה, שפועלת גם ללא תלות בתפריט הסינון הכללי
            const aggressiveAlefActive = Boolean(currentSettings.holyNamesAggressiveAlef);

            if (!currentSettings.hideNikud && !currentSettings.hideTeamim && !currentSettings.hidePunctuation && !holyNamesActive && !aggressiveAlefActive) {
                return html;
            }

            const container = document.createElement('div');
            container.innerHTML = html;

            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
            const textNodes = [];
            while (walker.nextNode()) textNodes.push(walker.currentNode);

            // רשימת שמות הקדושה הפעילים לפי היקף הסינון שנבחר, כל אחד עם ה-regex שלו (נבנה פעם
            // אחת בלבד לכל הקריאה - לא בכל צומת טקסט בנפרד - כדי לא לבנות אותו שוב ושוב על פני
            // אלפי צמתים באותו עמוד)
            const activeHolyNameEntries = holyNamesActive
                ? HOLY_NAMES.filter(n => currentSettings.holyNamesFilter === 'all' || n.havayaOnly)
                    .map(n => ({ regex: buildSingleHolyNameRegex(n), kinuy: n.kinuy, letters: n.letters }))
                : [];
            // שמות שבמקור עשויים להיות כתובים כבר עם מקף בין ההברות ("ש-די", "אֲדֹ-נָי") - מאחדים אותם
            // לפני כל שאר העיבוד (ובפרט לפני החלפת המקף ברווח בהסתרת פיסוק), כדי שיזוהו ויוצגו כשם קדוש
            const hyphenatedNameEntries = activeHolyNameEntries.length
                ? HOLY_NAMES.filter(n => n.allowInnerHyphen && (currentSettings.holyNamesFilter === 'all' || n.havayaOnly))
                    .map(n => ({ regex: buildSingleHolyNameRegex(n, true), letters: n.letters }))
                : [];
            // ספרים שכבר נכתבו במקור עם הכינוי "יקוק": בהצגה בכינוי, כשהמתג "שם הוי"ה יופיע כ-י"י" דולק,
            // מזהים גם אותו והופכים ל-י"י (עם ניקוד: יְיָ). כל שאר הכינויים שכתובים בספר (אלקים וכו') ושם
            // יקוק כשהמתג כבוי - נשארים בדיוק כפי שנכתבו, כולל הניקוד שלהם.
            const sourceKinuyHavayaRegex = (holyNamesActive && currentSettings.holyNamesDisplay === 'kinuy' && currentSettings.holyNamesYY)
                ? buildSingleHolyNameRegex({ letters: 'יקוק' })
                : null;
            // "אל"/"אלי" עם ניקוד מדויק מתווספות רק תחת "כל שמות הקדושה" (לא בסינון "רק הוי\"ה המפורש")
            const elPreciseRegex = (holyNamesActive && currentSettings.holyNamesFilter === 'all') ? buildElRegex() : null;
            const eliPreciseRegex = (holyNamesActive && currentSettings.holyNamesFilter === 'all') ? buildEliRegex() : null;
            // הסתרת "א-ל" אגרסיבית - נבנית לפי ההגדרה העצמאית שלה בלבד
            const elAggressiveRegex = aggressiveAlefActive ? buildElAggressiveRegex() : null;

            textNodes.forEach(node => {
                let t = node.textContent;
                if (!t) return;

                hyphenatedNameEntries.forEach(entry => {
                    entry.regex.lastIndex = 0;
                    t = t.replace(entry.regex, (fullMatch, prefix, core) => {
                        if (!/[\u05BE\-]/.test(core)) return fullMatch;
                        const cleanCore = core.replace(/[\u05BE\-]/g, '');
                        if (entry.letters === 'אדני' && !textHasDiacriticAfterLetter(cleanCore, 'נ', '\u05B8')) {
                            return fullMatch;
                        }
                        return (prefix || '') + cleanCore;
                    });
                });

                if (currentSettings.hidePunctuation) {
                    // מקף -> מוחלף ברווח (ולא נמחק) כדי שהמילים משני צדדיו לא ידבקו זו לזו
                    t = t.replace(/-/g, ' ');

                    const isHeading = !!(node.parentElement && node.parentElement.closest('h1, h2, h3, h4, h5, h6'));
                    if (isHeading) {
                        // בכותרות משאירים את הנקודתיים (:) ומסירים רק את שאר סימני הפיסוק
                        t = t.replace(/[?!_*]/g, '');
                    } else {
                        t = t.replace(/[?!:_*]/g, '');
                    }
                }

                // זיהוי שמות קדושה מתבצע לפני הסרת הניקוד/הטעמים - חלק מהזיהויים (בעיקר "אל"/"אלי"
                // המדויקים למטה, וגם ההחרגה של סגול/פתח בהסתרה האגרסיבית) חייבים לבדוק ניקוד מדויק
                // כדי להבחין בין שם קדושה למילת חול, ולכן חובה שירוצו בזמן שהניקוד המקורי עדיין
                // קיים בטקסט - גם כשההגדרה "הסתר ניקוד" פעילה ואמורה בסופו של דבר להעלים את הניקוד
                // מהתצוגה הסופית (ראו הסרת הניקוד/הטעמים בהמשך, שרצה רק אחרי שכל זיהויי שמות
                // הקדושה כבר הסתיימו) - אחרת שם קדושה כמו "אל" (המזוהה רק לפי ניקוד מדויק) לעולם
                // לא היה מזוהה כלל כאשר המשתמש גם מבקש להסתיר את הניקוד.
                activeHolyNameEntries.forEach(entry => {
                    entry.regex.lastIndex = 0;
                    t = t.replace(entry.regex, (fullMatch, prefix, core, offset, wholeString) => {
                        // "היה"/"והיה" - פועל רגיל, לא שם קדושה (ראו isPlainHayaWord)
                        if (entry.letters === 'יה' && isPlainHayaWord(prefix, fullMatch, wholeString, offset)) {
                            return fullMatch;
                        }
                        // "אדני" מזוהה כשם קדושה רק כשהניקוד תחת האות נ' הוא קמץ (ההגייה הקדושה) -
                        // ניקוד אחר תחת ה-נ' (או העדר ניקוד) הוא לשון חול ("אדני המשכן",
                        // "אדני האדונים" וכדומה) ולכן אינו מוסתר/מוחלף כלל.
                        if (entry.letters === 'אדני' && !textHasDiacriticAfterLetter(core, 'נ', '\u05B8')) {
                            return fullMatch;
                        }
                        // "יה" אינה מזוהה כשם קדושה כשהיא באה מיד אחרי ל' בניקוד צירה (כגון "לֵיָה") -
                        // מקרה חריג בודד שאינו שם הקדושה, ולכן כל הביטוי (כולל אות השימוש) נשאר
                        // ללא שום שינוי.
                        if (entry.letters === 'יה' && textHasDiacriticAfterLetter(prefix, 'ל', '\u05B5')) {
                            return fullMatch;
                        }
                        // שם הוי"ה המפורש בהסתרת כינוי + המתג "שם הוי"ה יופיע כ-י"י": "יי" (עם ניקוד:
                        // שווא תחת הי' הראשונה וקמץ תחת השנייה). במצב מקף - ללא שינוי.
                        if (entry.letters === 'יהוה' && currentSettings.holyNamesDisplay === 'kinuy' && currentSettings.holyNamesYY) {
                            const hasNikud = /[\u05B0-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/.test(core);
                            return (prefix || '') + (hasNikud ? 'י\u05B0י\u05B8' : 'יי');
                        }
                        return (prefix || '') + transformHolyCoreText(core, currentSettings.holyNamesDisplay, entry.kinuy, entry.letters);
                    });
                });

                if (sourceKinuyHavayaRegex) {
                    sourceKinuyHavayaRegex.lastIndex = 0;
                    t = t.replace(sourceKinuyHavayaRegex, (fullMatch, prefix, core) => {
                        const hasNikud = /[\u05B0-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/.test(core);
                        return (prefix || '') + (hasNikud ? 'י\u05B0י\u05B8' : 'יי');
                    });
                }

                if (elPreciseRegex) {
                    elPreciseRegex.lastIndex = 0;
                    t = t.replace(elPreciseRegex, (fullMatch, prefix, core) => {
                        return (prefix || '') + transformHolyCoreText(core, currentSettings.holyNamesDisplay, 'קל', 'אל');
                    });
                }
                if (eliPreciseRegex) {
                    eliPreciseRegex.lastIndex = 0;
                    t = t.replace(eliPreciseRegex, (fullMatch, prefix, core) => {
                        return (prefix || '') + transformHolyCoreText(core, currentSettings.holyNamesDisplay, 'קלי', 'אלי');
                    });
                }
                if (elAggressiveRegex) {
                    elAggressiveRegex.lastIndex = 0;
                    t = t.replace(elAggressiveRegex, (fullMatch, prefix, core) => {
                        // אם הניקוד מתחת ל-א' הוא סגול או פתח (אֶל/אַל) - כמעט תמיד מילת חול, לא שם
                        // קדושה - יש להחריג מהסתרה אגרסיבית זו ולהשאיר את הטקסט ללא שינוי כלל
                        const alefDiacriticsMatch = core.match(/^א([\u0591-\u05C7]*)ל/);
                        const alefDiacritics = alefDiacriticsMatch ? alefDiacriticsMatch[1] : '';
                        if (/[\u05B6\u05B7]/.test(alefDiacritics)) {
                            return fullMatch;
                        }
                        return (prefix || '') + transformHolyCoreText(core, currentSettings.holyNamesDisplay, 'קל', 'אל');
                    });
                }

                if (currentSettings.hideNikud) {
                    t = t.replace(NIKUD_RE, '');
                }
                if (currentSettings.hideTeamim) {
                    t = t.replace(TEAMIM_RE, '');
                }

                node.textContent = t;
            });

            return container.innerHTML;
        }

        // הסרת ניקוד/טעמים/סימני פיסוק בתוכן חלונית המפרשים (מפרשים/קישורים/הערות), לפי הגדרות
        // נפרדות ועצמאיות לגמרי מהגדרות הטקסט הראשי (commentaryHideNikud/commentaryHideTeamim/
        // commentaryHidePunctuation, הגדרות > הערות > הגדרות גופן למפרשים) - הסתרה בטקסט הספר
        // אינה משפיעה כאן, ולהיפך. הלוגיקה עצמה (הסרת המקף/החלפתו ברווח, אילו סימני פיסוק
        // מוסרים בכותרות לעומת גוף הטקסט, והביטויים הרגולריים לניקוד/טעמים) מועתקת במדויק
        // מ-applyTextFilters למעלה - רק בלי סינון שמות קדושה/הסתרת "א-ל" אגרסיבית, שאינם
        // חלק מהבקשה הזו וממילא שייכים אך ורק לטקסט הספר עצמו.
        function applyCommentaryTextFilters(html) {
            if (!html) return html;
            if (!currentSettings.commentaryHideNikud && !currentSettings.commentaryHideTeamim && !currentSettings.commentaryHidePunctuation) {
                return html;
            }

            const container = document.createElement('div');
            container.innerHTML = html;

            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
            const textNodes = [];
            while (walker.nextNode()) textNodes.push(walker.currentNode);

            textNodes.forEach(node => {
                let t = node.textContent;
                if (!t) return;

                if (currentSettings.commentaryHidePunctuation) {
                    // מקף -> מוחלף ברווח (ולא נמחק) כדי שהמילים משני צדדיו לא ידבקו זו לזו
                    t = t.replace(/-/g, ' ');

                    const isHeading = !!(node.parentElement && node.parentElement.closest('h1, h2, h3, h4, h5, h6'));
                    if (isHeading) {
                        t = t.replace(/[?!_*]/g, '');
                    } else {
                        t = t.replace(/[?!:_*]/g, '');
                    }
                }

                if (currentSettings.commentaryHideNikud) {
                    t = t.replace(NIKUD_RE, '');
                }
                if (currentSettings.commentaryHideTeamim) {
                    t = t.replace(TEAMIM_RE, '');
                }

                node.textContent = t;
            });

            return container.innerHTML;
        }

        // המרת מספר עמוד לגימטריה (א, ב, ג...)
        // טבלת האותיות והמפתחות הממוינים שלה קבועים לחלוטין ולא תלויים ב-num - מחושבים פעם אחת
        // כאן במקום מחדש בכל קריאה בודדת לפונקציה (כפי שהיה קודם), כדי לחסוך עבודה מיותרת
        // כשקוראים לפונקציה הזו אלפי פעמים ברצף (למשל מ-buildPageNav על ספר גדול)
        const GEMATRIA_LETTERS = {
            400: 'ת', 300: 'ש', 200: 'ר', 100: 'ק',
            90: 'צ', 80: 'פ', 70: 'ע', 60: 'ס', 50: 'נ', 40: 'מ', 30: 'ל', 20: 'כ', 10: 'י',
            9: 'ט', 8: 'ח', 7: 'ז', 6: 'ו', 5: 'ה', 4: 'ד', 3: 'ג', 2: 'ב', 1: 'א'
        };
        const GEMATRIA_KEYS = Object.keys(GEMATRIA_LETTERS).map(Number).sort((a, b) => b - a);
        function numToGematria(num) {
            if (num <= 0) return "";
            let result = '';
            let n = num;
            if (n === 15) return 'טו';
            if (n === 16) return 'טז';
            for (let val of GEMATRIA_KEYS) {
                while (n >= val) {
                    result += GEMATRIA_LETTERS[val];
                    n -= val;
                }
            }
            return result;
        }

        // יצירת מבנה כותרת עליונה משתקפת (ספר פתוח)
function preparePageWithHeader(container, pageNum, bookTitle, runningHeading) {
            container.innerHTML = '';
            // הכותרת נבנית תמיד (גם כשההגדרה "הצג כותרת עליונה ומספר עמוד" כבויה) כדי שהמקום
            // שלה בעמוד תמיד יישמר - הכיבוי בפועל הוא ויזואלי בלבד (visibility, דרך מחלקת
            // hide-page-header על ה-body, ראו updateHeaderSetting) ולכן אינו משפיע כלל על עימוד
            // הדפים ואינו מצריך סידור מחדש של הספר.
            const header = document.createElement('div');
            header.className = 'page-header';
            
            // שימוש ב-space-between כדי למתוח את האיברים לקצוות הנגדיים
            header.style.columnSpan = 'all';
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.borderBottom = '1px solid var(--color-border-subtle)';
            header.style.paddingBottom = '6px';
            header.style.marginBottom = '30px';
            header.style.fontSize = '10pt';
            header.style.fontFamily = 'var(--font-book)';
            header.style.color = 'var(--color-on-surface-subtle)';
            header.style.direction = 'rtl';
            
            // הסרנו את המילה "עמוד" - כעת מוצגת רק האות בגימטריה (א, ב, ג...)
            const pageNumHeb = numToGematria(pageNum);
            const isEven = (pageNum % 2 === 0);
            
            if (isEven) {
                // עמוד זוגי (דף ימין): מספר עמוד בימין קיצון ---------------- שם הספר בשמאל קיצון
                header.innerHTML = `
                    <span style="font-weight: 600;">${pageNumHeb}</span>
                    <span style="font-weight: 700;">${bookTitle}</span>
                `;
            } else {
                // עמוד אי-זוגי (דף שמאל): כותרת הפרק בימין קיצון ----------- מספר עמוד בשמאל קיצון
                header.innerHTML = `
                    <span style="font-weight: 700;">${runningHeading || bookTitle}</span>
                    <span style="font-weight: 600;">${pageNumHeb}</span>
                `;
            }
            
            container.appendChild(header);
        }
