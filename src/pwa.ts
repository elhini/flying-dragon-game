export function setupPwa(): () => void {
  const events = new AbortController();
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const button = document.querySelector<HTMLButtonElement>('#update-game')!;
    let requested: ServiceWorker | null = null;
    // The worker's directory is its default scope, including on a subpath.
    const worker = new URL(`${import.meta.env.BASE_URL}sw.js`, document.baseURI);
    void navigator.serviceWorker.register(worker, { updateViaCache: 'none' }).then(registration => {
      if (events.signal.aborted) return;
      const showUpdate = () => {
        button.hidden = !registration.active || !registration.waiting;
      };
      const watchDownload = () => {
        registration.installing?.addEventListener('statechange', showUpdate, { signal: events.signal });
        showUpdate();
      };
      registration.addEventListener('updatefound', watchDownload, { signal: events.signal });
      navigator.serviceWorker.addEventListener('controllerchange', showUpdate, { signal: events.signal });
      watchDownload();
      button.addEventListener('click', () => {
        const waiting = registration.waiting;
        if (!waiting || requested) return;
        requested = waiting;
        button.disabled = true;
        waiting.postMessage({ type: 'SKIP_WAITING' });
      }, { signal: events.signal });
      const checkUpdate = () => {
        if (!document.hidden) void registration.update().catch(() => {});
      };
      window.addEventListener('online', checkUpdate, { signal: events.signal });
      document.addEventListener('visibilitychange', checkUpdate, { signal: events.signal });
    }).catch(() => {
      // A failed download must leave the online game and any existing cache usable.
    });
    const showReady = () => {
      if (events.signal.aborted || navigator.serviceWorker.controller?.scriptURL !== worker.href) return;
      // Only the window whose user accepted the update restarts its game.
      if (requested && navigator.serviceWorker.controller === requested) {
        window.location.reload();
        return;
      }
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
