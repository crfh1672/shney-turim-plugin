// Reproduce Flutter Material Scrollbar visibility for ordinary scrollable panes.
// Otzaria shows the bar while scrolling, keeps it for 600ms, then fades it
// over 300ms. Hovering the thumb reveals it immediately via CSS.
(function () {
    const fadeTimers = new WeakMap();

    document.addEventListener('scroll', (event) => {
        const element = event.target;
        if (!(element instanceof HTMLElement)) return;

        const overflowY = getComputedStyle(element).overflowY;
        if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') {
            return;
        }

        element.classList.add('scrollbar-visible');

        const previousTimer = fadeTimers.get(element);
        if (previousTimer) clearTimeout(previousTimer);

        const timer = setTimeout(() => {
            element.classList.remove('scrollbar-visible');
            fadeTimers.delete(element);
        }, 600);
        fadeTimers.set(element, timer);
    }, true);
})();
