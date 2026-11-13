(function () {
    const wrapper = document.getElementById('preview-area-wrapper');
    const previewArea = document.getElementById('preview-area');
    if (!wrapper || !previewArea) return;

    const track = document.createElement('div');
    track.className = 'preview-scrollbar';
    track.setAttribute('role', 'scrollbar');
    track.setAttribute('aria-orientation', 'vertical');
    track.setAttribute('aria-label', 'גלילה בין עמודי התצוגה');
    track.tabIndex = 0;
    const thumb = document.createElement('div');
    thumb.className = 'preview-scrollbar-thumb';
    track.appendChild(thumb);

    const label = document.createElement('div');
    label.className = 'preview-scrollbar-label';
    label.hidden = true;
    label.setAttribute('role', 'tooltip');
    wrapper.appendChild(track);
    wrapper.appendChild(label);

    let thumbHeight = 1;
    let thumbPosition = 0;
    let dragging = false;
    let dragOffset = 0;

    function getMetrics() {
        const range = previewArea.scrollHeight - previewArea.clientHeight;
        const visible = range > 1 && !document.body.classList.contains('book-view-active');
        return { range: Math.max(0, range), visible };
    }

    function update() {
        const metrics = getMetrics();
        wrapper.classList.toggle('has-preview-scrollbar', metrics.visible);
        previewArea.classList.toggle('has-preview-scrollbar', metrics.visible);
        if (!metrics.visible) {
            hideLabel();
            return;
        }

        const trackHeight = track.clientHeight;
        if (trackHeight <= 0) return;
        // Match Otzaria's ScrollablePositionedListScrollbar: the thumb is at
        // least 5% of the track (not Material Scrollbar's 48px minimum).
        thumbHeight = Math.max(0.05, Math.min(1, previewArea.clientHeight / previewArea.scrollHeight));
        if (!dragging) {
            thumbPosition = metrics.range > 0
                ? Math.max(0, Math.min(1, previewArea.scrollTop / metrics.range)) * (1 - thumbHeight)
                : 0;
        }
        thumb.style.top = `${thumbPosition * trackHeight}px`;
        thumb.style.height = `${thumbHeight * trackHeight}px`;
        track.setAttribute('aria-valuemin', '1');
        track.setAttribute('aria-valuemax', String(previewArea.querySelectorAll(':scope > .print-page').length));
        track.setAttribute('aria-valuenow', String(getCurrentPageIndex() + 1));
    }

    function targetScrollTop(clientY) {
        const metrics = getMetrics();
        const rect = track.getBoundingClientRect();
        const available = Math.max(0, rect.height * (1 - thumbHeight));
        const offset = Math.max(0, Math.min(available, clientY - rect.top - rect.height * thumbHeight / 2));
        return available > 0 ? (offset / available) * metrics.range : 0;
    }

    function getPageIndexAtScrollTop(scrollTop) {
        const pages = previewArea.querySelectorAll(':scope > .print-page');
        if (!pages.length) return 0;
        const areaTop = previewArea.getBoundingClientRect().top;
        let low = 0;
        let high = pages.length - 1;
        let result = 0;
        while (low <= high) {
            const middle = (low + high) >> 1;
            const pageTop = previewArea.scrollTop + pages[middle].getBoundingClientRect().top - areaTop;
            if (pageTop <= scrollTop + 2) {
                result = middle;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        return result;
    }

    function getCurrentPageIndex() {
        return getPageIndexAtScrollTop(previewArea.scrollTop);
    }

    function showLabel(clientX, clientY) {
        const pageIndex = getPageIndexAtScrollTop(targetScrollTop(clientY));
        label.textContent = `עמוד ${pageIndex + 1}`;
        label.hidden = false;
        label.style.right = `${Math.max(0, window.innerWidth - clientX + 10)}px`;
        label.style.top = `${Math.max(24, Math.min(window.innerHeight - 24, clientY))}px`;
    }

    function hideLabel() {
        label.hidden = true;
    }

    function scrollToPointer(clientX, clientY) {
        const metrics = getMetrics();
        if (!metrics.visible) return;
        const rect = track.getBoundingClientRect();
        const available = Math.max(0, rect.height * (1 - thumbHeight));
        const nextPosition = Math.max(0, Math.min(available,
            clientY - rect.top - dragOffset));
        thumbPosition = available > 0 ? nextPosition / rect.height : 0;
        thumb.style.top = `${thumbPosition * rect.height}px`;
        previewArea.scrollTo({
            top: available > 0 ? (nextPosition / available) * metrics.range : 0,
            behavior: 'instant'
        });
        showLabel(clientX, clientY);
    }

    track.addEventListener('pointermove', (event) => {
        if (dragging) {
            scrollToPointer(event.clientX, event.clientY);
        } else {
            showLabel(event.clientX, event.clientY);
        }
    });
    track.addEventListener('pointerleave', () => {
        if (!dragging) hideLabel();
    });
    track.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 && event.pointerType === 'mouse') return;
        const rect = track.getBoundingClientRect();
        const thumbTop = rect.top + thumbPosition * rect.height;
        const thumbBottom = thumbTop + thumbHeight * rect.height;
        dragging = true;
        track.classList.add('is-dragging');
        dragOffset = event.clientY >= thumbTop && event.clientY <= thumbBottom
            ? event.clientY - thumbTop
            : thumbHeight * rect.height / 2;
        track.setPointerCapture(event.pointerId);
        scrollToPointer(event.clientX, event.clientY);
        event.preventDefault();
    });
    track.addEventListener('pointerup', (event) => {
        dragging = false;
        track.classList.remove('is-dragging');
        if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
        hideLabel();
        update();
    });
    track.addEventListener('pointercancel', () => {
        dragging = false;
        track.classList.remove('is-dragging');
        hideLabel();
        update();
    });
    track.addEventListener('keydown', (event) => {
        const pageStep = previewArea.clientHeight;
        const steps = {
            ArrowUp: -40,
            ArrowDown: 40,
            PageUp: -pageStep,
            PageDown: pageStep,
            Home: -Infinity,
            End: Infinity
        };
        if (!Object.prototype.hasOwnProperty.call(steps, event.key)) return;
        event.preventDefault();
        const step = steps[event.key];
        previewArea.scrollTo({
            top: step === -Infinity
                ? 0
                : step === Infinity
                    ? previewArea.scrollHeight
                    : previewArea.scrollTop + step,
            behavior: 'instant'
        });
    });

    previewArea.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    new ResizeObserver(update).observe(previewArea);
    new MutationObserver(update).observe(previewArea, { childList: true, subtree: true });
    new MutationObserver(update).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    update();
})();
