// Material-style scrollbars for the navigation, search and pages panes.
// The three panes use a DOM thumb so Chromium can animate opacity independently
// from hover color, matching Flutter's Material Scrollbar behavior.
(function () {
    'use strict';

    const SELECTOR = '#toc-scroll-area, #search-results-list, #page-nav-list';
    const SCROLLBAR_WIDTH = 12;
    const THUMB_WIDTH = 8;
    const THUMB_MARGIN = 2;
    const MIN_THUMB_LENGTH = 48;
    const FADE_DELAY = 600;

    const states = new Map();
    let lastPointer = null;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function clearHideTimer(state) {
        if (state.hideTimer !== null) {
            clearTimeout(state.hideTimer);
            state.hideTimer = null;
        }
    }

    function show(state) {
        clearHideTimer(state);
        state.track.classList.add('is-visible');
    }

    function scheduleHide(state) {
        clearHideTimer(state);
        if (state.hovered || state.dragging || state.focused) return;

        state.hideTimer = setTimeout(() => {
            state.hideTimer = null;
            if (!state.hovered && !state.dragging && !state.focused) {
                state.track.classList.remove('is-visible');
            }
        }, FADE_DELAY);
    }

    function hasOverflow(state) {
        const element = state.element;
        return element.clientHeight > 0 &&
            element.scrollHeight > element.clientHeight + 1;
    }

    function updateThumb(state) {
        const element = state.element;
        const trackHeight = element.clientHeight;
        const maxScroll = element.scrollHeight - trackHeight;

        if (trackHeight <= 0 || maxScroll <= 1) {
            state.track.style.display = 'none';
            clearHideTimer(state);
            state.track.classList.remove('is-visible', 'is-hovered', 'is-dragging');
            state.hovered = false;
            state.dragging = false;
            return;
        }

        state.track.style.display = 'block';

        const thumbHeight = Math.min(
            trackHeight,
            Math.max(MIN_THUMB_LENGTH, trackHeight * trackHeight / element.scrollHeight)
        );
        const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
        const thumbTop = maxScroll > 0
            ? clamp(element.scrollTop / maxScroll, 0, 1) * maxThumbTop
            : 0;

        state.thumb.style.height = thumbHeight + 'px';
        state.thumb.style.top = thumbTop + 'px';
        state.thumb.setAttribute('aria-valuemax', String(Math.round(maxScroll)));
        state.thumb.setAttribute('aria-valuenow', String(Math.round(element.scrollTop)));
    }

    function updateTrackPosition(state) {
        const element = state.element;
        const parent = state.parent;

        if (!element.isConnected || !parent.isConnected) {
            state.track.style.display = 'none';
            return;
        }

        const style = getComputedStyle(element);
        if (style.display === 'none' || element.clientHeight === 0) {
            state.track.style.display = 'none';
            return;
        }

        // parent is the containing block, so the overlay follows panel movement
        // and resize without relying on viewport-fixed coordinates.
        state.track.style.top = element.offsetTop + 'px';
        state.track.style.left = Math.max(
            0,
            element.offsetLeft + element.offsetWidth - SCROLLBAR_WIDTH
        ) + 'px';
        state.track.style.height = element.clientHeight + 'px';

        updateThumb(state);
    }

    function insideScrollbarLane(state, x, y) {
        if (!hasOverflow(state)) return false;
        const rect = state.element.getBoundingClientRect();
        return x >= rect.right - SCROLLBAR_WIDTH &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom;
    }

    function setHovered(state, hovered) {
        if (state.hovered === hovered) return;
        state.hovered = hovered;

        if (hovered) {
            show(state);
            state.track.classList.add('is-hovered');
        } else {
            state.track.classList.remove('is-hovered');
            scheduleHide(state);
        }
    }

    function refreshHover(pointer) {
        if (!pointer || pointer.pointerType !== 'mouse') return;

        let hoveredState = null;
        for (const state of states.values()) {
            if (insideScrollbarLane(state, pointer.clientX, pointer.clientY)) {
                hoveredState = state;
                break;
            }
        }

        for (const state of states.values()) {
            setHovered(state, state === hoveredState);
        }
    }

    function moveThumbToPointer(state, clientY, offsetFromTop) {
        const trackRect = state.track.getBoundingClientRect();
        const trackHeight = state.element.clientHeight;
        const thumbHeight = state.thumb.offsetHeight;
        const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
        const maxScroll = Math.max(0, state.element.scrollHeight - trackHeight);

        if (maxThumbTop <= 0 || maxScroll <= 0) return;

        const nextTop = clamp(
            clientY - trackRect.top - offsetFromTop,
            0,
            maxThumbTop
        );
        state.element.scrollTop = (nextTop / maxThumbTop) * maxScroll;
        updateThumb(state);
    }

    function beginThumbDrag(state, event) {
        const thumbRect = state.thumb.getBoundingClientRect();
        state.dragging = true;
        state.dragPointerId = event.pointerId;
        state.dragOffsetY = event.clientY - thumbRect.top;
        state.track.classList.add('is-dragging');
        show(state);

        if (typeof state.thumb.setPointerCapture === 'function') {
            try {
                state.thumb.setPointerCapture(event.pointerId);
            } catch (_) {
                // Document-level pointer listeners remain the fallback.
            }
        }
    }

    function finishThumbDrag(state) {
        state.dragging = false;
        state.dragPointerId = null;
        state.track.classList.remove('is-dragging');
        updateThumb(state);
        refreshHover(lastPointer);
        scheduleHide(state);
    }

    function onPointerMove(event) {
        lastPointer = event;

        let handledDrag = false;
        for (const state of states.values()) {
            if (state.dragging && state.dragPointerId === event.pointerId) {
                moveThumbToPointer(state, event.clientY, state.dragOffsetY);
                show(state);
                handledDrag = true;
                break;
            }
        }

        if (!handledDrag) refreshHover(event);
    }

    function onPointerDown(event) {
        if (event.button !== 0) return;

        for (const state of states.values()) {
            if (!insideScrollbarLane(state, event.clientX, event.clientY)) continue;

            const thumbRect = state.thumb.getBoundingClientRect();
            const onThumb = event.clientX >= thumbRect.left &&
                event.clientX <= thumbRect.right &&
                event.clientY >= thumbRect.top &&
                event.clientY <= thumbRect.bottom;

            event.preventDefault();
            event.stopPropagation();
            show(state);

            if (onThumb) {
                beginThumbDrag(state, event);
            } else {
                // A click on the track moves the thumb toward that position.
                moveThumbToPointer(
                    state,
                    event.clientY,
                    state.thumb.offsetHeight / 2
                );
                scheduleHide(state);
            }
            break;
        }
    }

    function onPointerUp(event) {
        for (const state of states.values()) {
            if (state.dragging && state.dragPointerId === event.pointerId) {
                finishThumbDrag(state);
                break;
            }
        }
    }

    function onScroll(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        const state = states.get(target);
        if (state) {
            updateThumb(state);
            show(state);
            scheduleHide(state);
            return;
        }

        // Preserve the previous behavior for scrollable areas outside the
        // navigation/search/pages pane.
        const overflowY = getComputedStyle(target).overflowY;
        if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') {
            return;
        }

        target.classList.add('scrollbar-visible');
        if (target.__otzariaScrollbarTimer) {
            clearTimeout(target.__otzariaScrollbarTimer);
        }
        target.__otzariaScrollbarTimer = setTimeout(() => {
            target.classList.remove('scrollbar-visible');
            target.__otzariaScrollbarTimer = null;
        }, FADE_DELAY);
    }

    function onKeyDown(state, event) {
        const element = state.element;
        const pageStep = Math.max(40, element.clientHeight * 0.9);
        let next = element.scrollTop;

        switch (event.key) {
            case 'ArrowUp': next -= 40; break;
            case 'ArrowDown': next += 40; break;
            case 'PageUp': next -= pageStep; break;
            case 'PageDown': next += pageStep; break;
            case 'Home': next = 0; break;
            case 'End': next = element.scrollHeight; break;
            default: return;
        }

        event.preventDefault();
        element.scrollTop = next;
        show(state);
        scheduleHide(state);
    }

    function createScrollbar(element) {
        const parent = element.parentElement;
        if (!parent) return;

        if (getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
        }

        const track = document.createElement('div');
        track.className = 'nav-panel-scrollbar-track';

        const thumb = document.createElement('div');
        thumb.className = 'nav-panel-scrollbar-thumb';
        thumb.setAttribute('role', 'scrollbar');
        thumb.setAttribute('aria-orientation', 'vertical');
        thumb.setAttribute('aria-controls', element.id);
        thumb.setAttribute('aria-valuemin', '0');
        thumb.setAttribute('aria-valuemax', '0');
        thumb.setAttribute('aria-valuenow', '0');
        thumb.setAttribute('tabindex', '0');
        thumb.setAttribute('aria-label', 'גלילה');

        track.appendChild(thumb);
        parent.appendChild(track);

        const state = {
            element,
            parent,
            track,
            thumb,
            hideTimer: null,
            hovered: false,
            dragging: false,
            dragPointerId: null,
            dragOffsetY: 0,
            focused: false
        };
        states.set(element, state);

        thumb.addEventListener('focus', () => {
            state.focused = true;
            show(state);
        });
        thumb.addEventListener('blur', () => {
            state.focused = false;
            scheduleHide(state);
        });
        thumb.addEventListener('keydown', event => onKeyDown(state, event));

        updateTrackPosition(state);
    }

    function init() {
        document.querySelectorAll(SELECTOR).forEach(createScrollbar);

        if (states.size === 0) return;

        document.addEventListener('scroll', onScroll, true);
        document.addEventListener('pointermove', onPointerMove, true);
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('pointerup', onPointerUp, true);
        document.addEventListener('pointercancel', onPointerUp, true);

        window.addEventListener('blur', () => {
            lastPointer = null;
            for (const state of states.values()) {
                setHovered(state, false);
                if (state.dragging) finishThumbDrag(state);
            }
        });

        const resizeObserver = new ResizeObserver(() => {
            for (const state of states.values()) updateTrackPosition(state);
            refreshHover(lastPointer);
        });

        const mutationObserver = new MutationObserver(() => {
            for (const state of states.values()) updateTrackPosition(state);
            refreshHover(lastPointer);
        });

        for (const state of states.values()) {
            resizeObserver.observe(state.element);
            resizeObserver.observe(state.parent);
            mutationObserver.observe(state.element, {
                childList: true,
                subtree: true,
                characterData: true
            });
        }

        window.addEventListener('resize', () => {
            for (const state of states.values()) updateTrackPosition(state);
            refreshHover(lastPointer);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
