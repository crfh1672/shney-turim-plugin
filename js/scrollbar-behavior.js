// Port of Otzaria's EdgeScrollbarBehavior + ScrollbarGutter + Material Scrollbar
// for the plugin's navigation, search and pages panes.
//
// Source of truth:
// - app_scrollbar.dart: 12px reserved gutter, enabled only when scrollable.
// - app_theme_data.dart / app_tokens.dart: 8px thumb, 2px cross-axis margin,
//   4px radius; gutter = 2 + 8 + 2.
// - Flutter Material Scrollbar: 48px minimum thumb, 600ms fade delay,
//   300ms fastOutSlowIn fade, 200ms linear hover-color transition.
// This is a browser port of those behaviors, not a native Flutter widget.
(function () {
    'use strict';

    const SELECTOR = '#toc-scroll-area, #search-results-list, #page-nav-list';
    const GUTTER_WIDTH = 12;
    const THUMB_WIDTH = 8;
    const THUMB_MARGIN = 2;
    const MIN_THUMB_LENGTH = 48;
    const HOVER_DISCOVERY_RADIUS = 24; // Flutter's 48px minimum mouse hit target.
    const FADE_DELAY = 600;
    const TRACK_TAP_PAGE_FACTOR = 0.8;
    const TRACK_TAP_DURATION = 100;

    const states = new Map();
    let lastPointer = null;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function hasOverflow(state) {
        const element = state.element;
        return element.clientHeight > 0 &&
            element.scrollHeight > element.clientHeight;
    }

    // Mirrors _RenderScrollbarGutter.performLayout:
    // 1. Lay out without a gutter and open it if content overflows.
    // 2. Once open, when content no longer overflows, test again without the
    //    gutter. Keep the gutter only if removing it makes content overflow.
    function updateGutter(state) {
        const element = state.element;
        if (element.clientHeight <= 0) return;

        if (!state.hasGutter) {
            if (hasOverflow(state)) {
                state.hasGutter = true;
                element.classList.add('has-scrollbar-gutter');
            }
            return;
        }

        if (!hasOverflow(state)) {
            state.hasGutter = false;
            element.classList.remove('has-scrollbar-gutter');

            if (hasOverflow(state)) {
                state.hasGutter = true;
                element.classList.add('has-scrollbar-gutter');
            }
        }
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
        if (state.hovered || state.dragging || state.gutterPanning) return;

        state.hideTimer = setTimeout(() => {
            state.hideTimer = null;
            if (!state.hovered && !state.dragging && !state.gutterPanning) {
                state.track.classList.remove('is-visible');
            }
        }, FADE_DELAY);
    }

    function thumbOpacity(state) {
        const value = Number.parseFloat(getComputedStyle(state.thumb).opacity);
        return Number.isFinite(value) ? value : 0;
    }

    function updateThumb(state) {
        updateGutter(state);

        const element = state.element;
        const trackHeight = element.clientHeight;
        const maxScroll = element.scrollHeight - trackHeight;

        if (!state.hasGutter || trackHeight <= 0 || maxScroll <= 0) {
            state.track.style.display = 'none';
            clearHideTimer(state);
            state.track.classList.remove('is-visible', 'is-hovered', 'is-dragging');
            state.hovered = false;
            state.dragging = false;
            state.gutterPanning = false;
            state.dragPointerId = null;
            return;
        }

        state.track.style.display = 'block';

        // Flutter ScrollbarPainter._setThumbExtent(), for ordinary desktop
        // scrolling: max(48, viewport² / contentHeight), capped to the track.
        const minimum = Math.min(MIN_THUMB_LENGTH, trackHeight);
        const thumbHeight = Math.min(
            trackHeight,
            Math.max(minimum, trackHeight * trackHeight / element.scrollHeight)
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
            clearHideTimer(state);
            state.track.classList.remove('is-visible', 'is-hovered', 'is-dragging');
            state.hovered = false;
            state.dragging = false;
            state.gutterPanning = false;
            state.dragPointerId = null;
            return;
        }

        updateGutter(state);

        // Physical right edge, irrespective of the Hebrew/RTL text direction.
        state.track.style.top = element.offsetTop + 'px';
        state.track.style.left = Math.max(
            0,
            element.offsetLeft + element.offsetWidth - GUTTER_WIDTH
        ) + 'px';
        state.track.style.height = element.clientHeight + 'px';

        updateThumb(state);
    }

    function inTrack(state, x, y) {
        if (!state.hasGutter || !hasOverflow(state)) return false;
        const rect = state.element.getBoundingClientRect();
        return x >= rect.right - GUTTER_WIDTH &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom;
    }

    // Flutter expands the hit target to a 48px diameter around the thumb while
    // fully transparent. Once any opacity is painted, normal 12px track hit
    // testing applies.
    function inHoverTarget(state, x, y) {
        if (!state.hasGutter || !hasOverflow(state)) return false;
        const rect = state.element.getBoundingClientRect();
        if (y < rect.top || y > rect.bottom) return false;

        if (thumbOpacity(state) > 0.001) {
            return x >= rect.right - GUTTER_WIDTH && x <= rect.right;
        }

        const thumbCenterX = rect.right - THUMB_MARGIN - THUMB_WIDTH / 2;
        const hoverLeft = Math.min(
            rect.right - GUTTER_WIDTH,
            thumbCenterX - HOVER_DISCOVERY_RADIUS
        );
        const hoverRight = Math.max(
            rect.right,
            thumbCenterX + HOVER_DISCOVERY_RADIUS
        );
        return x >= hoverLeft && x <= hoverRight;
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
            if (inHoverTarget(state, pointer.clientX, pointer.clientY)) {
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
        const currentTop = Number.parseFloat(state.thumb.style.top || '0');
        state.element.scrollTop += ((nextTop - currentTop) / maxThumbTop) * maxScroll;
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

    function beginGutterPan(state, event) {
        state.gutterPanning = true;
        state.dragPointerId = event.pointerId;
        state.panStartY = event.clientY;
        state.panStartScrollTop = state.element.scrollTop;
        show(state);
    }

    function finishGutterPan(state) {
        state.gutterPanning = false;
        state.dragPointerId = null;
        scheduleHide(state);
    }

    function onPointerMove(event) {
        lastPointer = event;

        let handledDrag = false;
        for (const state of states.values()) {
            if (state.dragPointerId !== event.pointerId) continue;

            if (state.dragging) {
                moveThumbToPointer(state, event.clientY, state.dragOffsetY);
                show(state);
                handledDrag = true;
                break;
            }

            if (state.gutterPanning) {
                state.element.scrollTop = state.panStartScrollTop -
                    (event.clientY - state.panStartY);
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
            if (!inTrack(state, event.clientX, event.clientY)) continue;

            const opacity = thumbOpacity(state);
            const thumbRect = state.thumb.getBoundingClientRect();
            const onThumb = event.clientX >= thumbRect.left &&
                event.clientX <= thumbRect.right &&
                event.clientY >= thumbRect.top &&
                event.clientY <= thumbRect.bottom;

            if (event.pointerType !== 'mouse' && !(opacity > 0.001 && onThumb)) {
                // ScrollbarGutter forwards touch drags in its reserved lane.
                event.preventDefault();
                event.stopPropagation();
                beginGutterPan(state, event);
                break;
            }

            // RawScrollbar is not hit-testable by a mouse while fully transparent.
            if (opacity <= 0.001) continue;

            event.preventDefault();
            event.stopPropagation();

            if (onThumb) {
                beginThumbDrag(state, event);
            } else {
                // RawScrollbar pages by 0.8 * viewportDimension, animated
                // for 100ms with Curves.easeInOut.
                const rect = state.track.getBoundingClientRect();
                const thumbTop = Number.parseFloat(state.thumb.style.top || '0');
                const direction = event.clientY > rect.top + thumbTop ? 1 : -1;
                const increment = TRACK_TAP_PAGE_FACTOR * state.element.clientHeight;
                animateScrollTo(
                    state,
                    state.element.scrollTop + direction * increment,
                    TRACK_TAP_DURATION
                );
            }
            break;
        }
    }

    function cubicBezierProgress(x, x1, y1, x2, y2) {
        function curve(t, a, b) {
            const u = 1 - t;
            return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
        }
        let low = 0;
        let high = 1;
        let t = x;
        for (let i = 0; i < 12; i++) {
            const estimate = curve(t, x1, x2);
            if (Math.abs(estimate - x) < 0.0001) break;
            if (estimate < x) low = t;
            else high = t;
            t = (low + high) / 2;
        }
        return curve(t, y1, y2);
    }

    function animateScrollTo(state, requestedTarget, duration) {
        if (state.tapAnimationFrame !== null) {
            cancelAnimationFrame(state.tapAnimationFrame);
            state.tapAnimationFrame = null;
        }

        const element = state.element;
        const start = element.scrollTop;
        const target = clamp(
            requestedTarget,
            0,
            element.scrollHeight - element.clientHeight
        );
        const startedAt = performance.now();

        function frame(now) {
            const progress = clamp((now - startedAt) / duration, 0, 1);
            const eased = cubicBezierProgress(progress, 0.42, 0, 0.58, 1);
            element.scrollTop = start + (target - start) * eased;

            if (progress < 1) {
                state.tapAnimationFrame = requestAnimationFrame(frame);
            } else {
                state.tapAnimationFrame = null;
                element.scrollTop = target;
            }
        }

        state.tapAnimationFrame = requestAnimationFrame(frame);
    }

    function onPointerUp(event) {
        for (const state of states.values()) {
            if (state.dragPointerId !== event.pointerId) continue;
            if (state.dragging) finishThumbDrag(state);
            else if (state.gutterPanning) finishGutterPan(state);
            break;
        }
    }

    function onWheel(event) {
        for (const state of states.values()) {
            if (!inTrack(state, event.clientX, event.clientY)) continue;

            let delta = event.shiftKey && event.deltaX !== 0
                ? event.deltaX
                : event.deltaY;
            if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
                delta *= 16;
            } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
                delta *= state.element.clientHeight;
            }

            const maxScroll = state.element.scrollHeight - state.element.clientHeight;
            const target = clamp(state.element.scrollTop + delta, 0, maxScroll);
            if (target === state.element.scrollTop) return;

            // ScrollbarGutter routes wheel signals in its reserved lane to the
            // same Scrollable rather than allowing the outer pane to move.
            event.preventDefault();
            event.stopPropagation();
            state.element.scrollTop = target;
            return;
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

        // Keep the original behavior for scrollable areas outside these panes.
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

    function createScrollbar(element) {
        const parent = element.parentElement;
        if (!parent) return;

        if (getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
        }

        const track = document.createElement('div');
        track.className = 'nav-panel-scrollbar-track';
        track.setAttribute('aria-hidden', 'false');

        const thumb = document.createElement('div');
        thumb.className = 'nav-panel-scrollbar-thumb';
        thumb.setAttribute('role', 'scrollbar');
        thumb.setAttribute('aria-orientation', 'vertical');
        thumb.setAttribute('aria-controls', element.id);
        thumb.setAttribute('aria-valuemin', '0');
        thumb.setAttribute('aria-valuemax', '0');
        thumb.setAttribute('aria-valuenow', '0');
        thumb.setAttribute('tabindex', '-1');
        thumb.setAttribute('aria-label', 'גלילה');

        track.appendChild(thumb);
        parent.appendChild(track);

        const state = {
            element,
            parent,
            track,
            thumb,
            hasGutter: false,
            hideTimer: null,
            hovered: false,
            dragging: false,
            gutterPanning: false,
            dragPointerId: null,
            dragOffsetY: 0,
            panStartY: 0,
            panStartScrollTop: 0,
            tapAnimationFrame: null
        };
        states.set(element, state);

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
        document.addEventListener('wheel', onWheel, { capture: true, passive: false });

        window.addEventListener('blur', () => {
            lastPointer = null;
            for (const state of states.values()) {
                setHovered(state, false);
                if (state.dragging) finishThumbDrag(state);
                else if (state.gutterPanning) finishGutterPan(state);
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
