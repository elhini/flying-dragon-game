export function setupPwa(): () => void {
  const events = new AbortController();
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    // The worker's directory is its default scope, including on a subpath.
    const worker = new URL(`${import.meta.env.BASE_URL}sw.js`, document.baseURI);
    void navigator.serviceWorker.register(worker, { updateViaCache: 'none' }).catch(() => {
      // A failed download must leave the online game and any existing cache usable.
    });
    const showReady = () => {
      if (events.signal.aborted || navigator.serviceWorker.controller?.scriptURL !== worker.href) return;
      const status = document.querySelector<HTMLElement>('#offline-status');
      if (status) {
        status.textContent = 'Можно играть без интернета.';
        status.hidden = false;
      }
    };
    navigator.serviceWorker.addEventListener('controllerchange', showReady, { signal: events.signal });
    void navigator.serviceWorker.ready.then(showReady);
  }
  return () => events.abort();
}
