        // Glyph code points from fluentui_system_icons 1.1.273, used by Otzaria.
        const FLUENT_ICON_GLYPHS = Object.freeze({
            arrow_autofit_height: [0xF8CD, 0xF8E5],
            arrow_autofit_width: [0xF8CE, 0xF8E6],
            arrow_clockwise: [0xF13E, 0xF13E],
            arrow_collapse_all: [0xE0B1, 0xE0B1],
            arrow_expand_all: [0xF0624, 0xF06A0],
            arrow_reset: [0xF1A0, 0xF1A0],
            book: [0xF8FE, 0xE173],
            book_open: [0xE179, 0xE18D],
            caret_left: [0xF266, 0xF266],
            caret_right: [0xF26A, 0xF26A],
            checkbox_checked: [0xF28E, 0xF28E],
            checkbox_unchecked: [0xF292, 0xF292],
            checkmark: [0xF295, 0xF295],
            chevron_down: [0xF2A4, 0xF2A4],
            chevron_up: [0xF2B7, 0xF2B7],
            comment_multiple: [0xF308, 0xF308],
            dismiss: [0xF36A, 0xF36A],
            document_pdf: [0xF3AD, 0xF3AD],
            document_multiple: [0xE521, 0xE52D],
            document_text: [0xE558, 0xE564],
            edit: [0xF3DE, 0xF3DD],
            folder: [0xF419, 0xF41D],
            full_screen_maximize: [0xE685, 0xE692],
            keyboard: [0xF4B9, 0xF4C3],
            line_horizontal_3: [0xF0765, 0xF07E2],
            link: [0xF4E5, 0xF4EF],
            more_horizontal: [0xE825, 0xE833],
            note: [0xF56C, 0xF56C],
            pin: [0xF602, 0xF60C],
            print: [0xF62B, 0xF635],
            search: [0xF690, 0xF69A],
            settings: [0xF6AA, 0xF6B3],
            split_vertical: [0xEB61, 0xEB6A],
            text_bullet_list: [0xF0291, 0xF02A4],
            text_bullet_list_ltr: [0xECDA, 0xECD8],
            text_column_two: [0xF7C6, 0xF7DE],
            warning: [0xF86A, 0xF882],
            zoom_in: [0xF8C5, 0xF8DD],
            zoom_out: [0xF8C7, 0xF8DF]
        });

        // Otzaria Icons 0.7.0 glyphs; license and attribution are in fonts/OtzariaIcons-NOTICE.txt.
        const OTZARIA_ICON_GLYPHS = Object.freeze({
            book: [0xE001, 0xE001],
            document_column: [0xE024, 0xE024],
            links: [0xE027, 0xE027],
            list: [0xE03A, 0xE039],
            search: [0xE02C, 0xE02B],
            text_continuous_rtl: [0xE05D, 0xE05C],
            text_continuous_ltr: [0xE0FE, 0xE0FD]
        });

        function fluentIconCodePoint(name, filled = false) {
            const glyphs = FLUENT_ICON_GLYPHS[name];
            if (!glyphs) {
                throw new RangeError(`Unknown Fluent icon: ${name}`);
            }
            return glyphs[filled ? 1 : 0];
        }

        function otzariaIconCodePoint(name, filled = false) {
            const glyphs = OTZARIA_ICON_GLYPHS[name];
            if (!glyphs) {
                throw new RangeError(`Unknown Otzaria icon: ${name}`);
            }
            return glyphs[filled ? 1 : 0];
        }

        function fluentIconHTML(name, className = '', filled = false) {
            const glyph = String.fromCodePoint(fluentIconCodePoint(name, filled));
            const classes = ['ui-icon', className, filled ? 'ui-icon-filled' : '']
                .filter(Boolean)
                .join(' ');
            return `<i class="${classes}" aria-hidden="true">${glyph}</i>`;
        }

        function initializeFluentIcons(root = document) {
            root.querySelectorAll('.ui-icon[data-fluent-icon]').forEach((icon) => {
                const name = icon.dataset.fluentIcon;
                const filled = icon.dataset.fluentWeight === 'filled';
                icon.textContent = String.fromCodePoint(fluentIconCodePoint(name, filled));
                icon.classList.toggle('ui-icon-filled', filled);
                delete icon.dataset.fluentIcon;
                delete icon.dataset.fluentWeight;
            });
        }

        function initializeOtzariaIcons(root = document) {
            root.querySelectorAll('.ui-icon[data-otzaria-icon]').forEach((icon) => {
                const name = icon.dataset.otzariaIcon;
                const filled = icon.dataset.otzariaWeight === 'filled';
                icon.textContent = String.fromCodePoint(otzariaIconCodePoint(name, filled));
                delete icon.dataset.otzariaIcon;
                delete icon.dataset.otzariaWeight;
            });
        }

        initializeFluentIcons();
        initializeOtzariaIcons();
