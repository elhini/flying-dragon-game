export function setupTouchControls({ isFinished, onKeyDown, onKeyUp }) {
    const controls = document.querySelector('#touch-controls');
    if (!window.matchMedia('(pointer: coarse)').matches) {
        return;
    }

    controls.hidden = false;
    controls.addEventListener('contextmenu', event => event.preventDefault());
    const activePointers = new Map();
    let movementInterval = null;
    const updateMovementLoop = () => {
        const direction = [...activePointers.values()].find(active => active.code !== 32);
        if (!direction) {
            clearInterval(movementInterval);
            movementInterval = null;
        } else if (movementInterval === null) {
            // One keyboard event moves along every held direction once per tick.
            movementInterval = setInterval(() => {
                if (isFinished()) {
                    for (const { release } of [...activePointers.values()]) release();
                    return;
                }
                const active = [...activePointers.values()].find(pointer => pointer.code !== 32);
                if (active) onKeyDown(active.code);
            }, 110);
        }
    };

    controls.querySelectorAll('[data-key]').forEach(button => {
        const code = Number(button.dataset.key);
        button.addEventListener('pointerdown', event => {
            event.preventDefault();
            if (activePointers.has(button) || isFinished()) return;
            button.setPointerCapture(event.pointerId);
            const release = () => {
                const active = activePointers.get(button);
                if (!active) return;
                activePointers.delete(button);
                button.classList.remove('pressed');
                onKeyUp(code);
                updateMovementLoop();
            };
            activePointers.set(button, { code, pointerId: event.pointerId, release });
            button.classList.add('pressed');
            onKeyDown(code);
            updateMovementLoop();
        });
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
            button.addEventListener(type, event => {
                const active = activePointers.get(button);
                if (active?.pointerId === event.pointerId) active.release();
            });
        }
    });

    window.addEventListener('blur', () => {
        for (const { release } of [...activePointers.values()]) release();
    });
}
