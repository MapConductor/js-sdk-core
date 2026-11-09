import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    AbstractMarkerController,
    BaseMapViewController,
    DefaultMarkerEventController,
    MarkerManager,
    createGeoPoint,
    createMarkerEntity,
    createMarkerState,
} from '../dist/index.mjs';

/**
 * A press on a draggable marker belongs to the marker, and the browser's `click`
 * that follows it must not reach the map.
 *
 * `pointerdown` calls `preventDefault()`, which stops the compatibility
 * `mousedown`/`mouseup` but **not** `click`. maplibre-gl (and the GL providers
 * built on it) turn that click into `map.on('click')` → `dispatchTap`, so:
 *  - releasing a dragged vertex over a polygon fired the polygon's onClick;
 *  - tapping a draggable, clickable marker fired its onClick twice (once from
 *    `finishDrag`, once from the leaked click).
 *
 * A tap (no drag) on a draggable marker with `clickable: false` passes through
 * to whatever is under it, as on Android: there the tap is the native map click,
 * and `dispatchTap` skips markers that are not clickable.
 */

/** Just enough of EventTarget for the controller: listeners per type, capture flag kept. */
class FakeTarget {
    constructor() { this.listeners = []; }
    addEventListener(type, fn, options) {
        const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
        this.listeners.push({ type, fn, capture });
    }
    removeEventListener(type, fn, options) {
        const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
        const i = this.listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
        if (i >= 0) this.listeners.splice(i, 1);
    }
    /** Calls the listeners for `type`; returns false if one stopped propagation. */
    fire(type, event) {
        for (const l of this.listeners.filter((x) => x.type === type)) {
            l.fn(event);
            if (event.stopped) return false;
        }
        return true;
    }
}

function domEvent(fields) {
    return {
        isPrimary: true,
        button: 0,
        pointerType: 'mouse',
        defaultPrevented: false,
        stopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; },
        stopImmediatePropagation() { this.stopped = true; },
        ...fields,
    };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Screen x/y map 1:1 to longitude/latitude, which is all the gesture needs. */
function makeMap() {
    const win = new FakeTarget();
    const canvas = new FakeTarget();
    canvas.ownerDocument = { defaultView: win };
    canvas.captured = new Set();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0 });
    canvas.setPointerCapture = (id) => canvas.captured.add(id);
    canvas.hasPointerCapture = (id) => canvas.captured.has(id);
    canvas.releasePointerCapture = (id) => canvas.captured.delete(id);
    let dragPan = true;
    const map = {
        getCanvas: () => canvas,
        getZoom: () => 10,
        getLayer: () => ({}),
        dragPan: { isEnabled: () => dragPan, enable: () => { dragPan = true; }, disable: () => { dragPan = false; } },
    };
    return { win, canvas, map };
}

class Renderer {
    constructor(map) {
        this.holder = {
            map,
            fromScreenOffsetSync: ({ x, y }) => createGeoPoint({ latitude: y, longitude: x }),
        };
        this.markerLayer = { layerId: 'markers' };
    }
    async onAdd(data) { return data.map((p) => p.state.id); }
    async onChange(data) { return data.map((p) => p.current.state.id); }
    async onRemove() {}
    async onAnimate() {}
    async onPostProcess() {}
}

/** The shape GL marker controllers have: a selection for the drag, and a hit test. */
class GlMarkerController extends AbstractMarkerController {
    constructor(map) {
        super({ markerManager: MarkerManager.defaultManager(), renderer: new Renderer(map) });
        this.selected = null;
        this.under = null;
    }
    findWithZoom() { return this.under; }
    getSelectedMarker() { return this.selected; }
    setSelectedMarker(entity) { this.selected = entity; }
    updateSelectedPosition() {}
}

/** A polygon that covers the whole screen. */
class PolygonController {
    constructor(log) { this.kind = 'polygon'; this.log = log; }
    hasId() { return false; }
    async compositionAny() {}
    async updateAny() {}
    setClickListenerAny() {}
    async clear() {}
    resolveTap(position) {
        return { kind: 'polygon', clicked: position, dispatch: () => this.log.push('polygon') };
    }
}

/** A GL provider: the marker hit test runs first in the cascade, clickable markers only. */
class Provider extends BaseMapViewController {
    constructor() {
        super();
        this.log = [];
        const { win, canvas, map } = makeMap();
        this.win = win;
        this.canvas = canvas;
        this.markers = new GlMarkerController(map);
        this.registerOverlayController(this.markers);
        this.registerOverlayController(new PolygonController(this.log));
        this.events = new DefaultMarkerEventController(this.markers);
        this.setMapClickListener(() => this.log.push('map'));
    }
    dispatchMarkerTap() {
        const entity = this.markers.under;
        if (!entity?.state.clickable) return false;
        this.markers.dispatchClick(entity.state);
        return true;
    }
    putMarker({ clickable }) {
        const state = createMarkerState({
            id: 'vertex',
            position: createGeoPoint({ latitude: 50, longitude: 50 }),
            draggable: true,
            clickable,
            onClick: () => this.log.push('marker'),
            onDragEnd: () => this.log.push('dragEnd'),
        });
        this.markers.under = createMarkerEntity({ state, marker: 'vertex' });
        this.markers.markerManager.registerEntity(this.markers.under);
    }

    /**
     * A press and release the way Chrome delivers it: pointerdown, the moves,
     * pointerup, then — in the same task — the `click`, which goes through the
     * window's capture listeners first and then reaches the map
     * (maplibre's `map.on('click')` → `dispatchTap`).
     *
     * `mapTakesClick: false` is maplibre after an earlier press elsewhere: it drops
     * a click that lands far from its last `mousedown`, and `preventDefault()` on
     * `pointerdown` means it never saw this gesture's `mousedown`.
     */
    async gesture(points, { mapTakesClick = true } = {}) {
        const [first, ...rest] = points;
        this.win.fire('pointerdown', domEvent({ pointerId: 1, clientX: first.x, clientY: first.y }));
        this.canvas.fire('pointerdown', domEvent({ pointerId: 1, clientX: first.x, clientY: first.y }));
        for (const p of rest) this.canvas.fire('pointermove', domEvent({ pointerId: 1, clientX: p.x, clientY: p.y }));
        const last = points[points.length - 1];
        this.canvas.fire('pointerup', domEvent({ pointerId: 1, clientX: last.x, clientY: last.y }));
        const click = domEvent({ clientX: last.x, clientY: last.y });
        if (this.win.fire('click', click) && mapTakesClick) {
            this.dispatchTap(createGeoPoint({ latitude: last.y, longitude: last.x }));
        }
        await flush();
    }
}

test('dragging a marker and releasing over a polygon does not click the polygon', async () => {
    const provider = new Provider();
    provider.putMarker({ clickable: false });
    await provider.gesture([{ x: 50, y: 50 }, { x: 60, y: 50 }, { x: 80, y: 60 }]);
    assert.deepEqual(provider.log, ['dragEnd']);
});

test('dragging a clickable marker reports dragEnd only', async () => {
    const provider = new Provider();
    provider.putMarker({ clickable: true });
    await provider.gesture([{ x: 50, y: 50 }, { x: 80, y: 60 }]);
    assert.deepEqual(provider.log, ['dragEnd']);
});

test('tapping a draggable, clickable marker fires its onClick once', async () => {
    const provider = new Provider();
    provider.putMarker({ clickable: true });
    await provider.gesture([{ x: 50, y: 50 }]);
    assert.deepEqual(provider.log, ['marker']);
});

test('tapping a draggable marker with clickable: false passes through to the polygon under it, once', async () => {
    const provider = new Provider();
    provider.putMarker({ clickable: false });
    await provider.gesture([{ x: 50, y: 50 }]);
    assert.deepEqual(provider.log, ['polygon']);
});

test('the pass-through does not depend on the map engine taking the browser click', async () => {
    const provider = new Provider();
    provider.putMarker({ clickable: false });
    await provider.gesture([{ x: 50, y: 50 }], { mapTakesClick: false });
    assert.deepEqual(provider.log, ['polygon']);
});

test('the pass-through tap reaches the map click when nothing else is under it', async () => {
    const provider = new Provider();
    provider.unregisterOverlayController([...provider['overlayControllers']].find((c) => c.kind === 'polygon'));
    provider.putMarker({ clickable: false });
    await provider.gesture([{ x: 50, y: 50 }]);
    assert.deepEqual(provider.log, ['map']);
});

test('the swallowed click is only the one that ends the marker gesture', async () => {
    const provider = new Provider();
    provider.putMarker({ clickable: false });
    await provider.gesture([{ x: 50, y: 50 }, { x: 80, y: 60 }]);
    provider.markers.under = null;
    // The next press is on the map, not on a marker: its click must get through.
    await provider.gesture([{ x: 10, y: 10 }]);
    assert.deepEqual(provider.log, ['dragEnd', 'polygon']);
});

test('the pointerup that ends a marker gesture is marked as handled', async () => {
    // deck.gl recognizes taps from pointer events itself (mjolnir.js listens for
    // pointerup on window, after the canvas), so it never sees the browser click;
    // it skips a tap whose pointerup was defaultPrevented.
    const provider = new Provider();
    provider.putMarker({ clickable: true });
    provider.canvas.fire('pointerdown', domEvent({ pointerId: 1, clientX: 50, clientY: 50 }));
    const up = domEvent({ pointerId: 1, clientX: 50, clientY: 50 });
    provider.canvas.fire('pointerup', up);
    await flush();
    assert.equal(up.defaultPrevented, true);

    provider.markers.under = null;
    provider.canvas.fire('pointerdown', domEvent({ pointerId: 2, clientX: 10, clientY: 10 }));
    const mapUp = domEvent({ pointerId: 2, clientX: 10, clientY: 10 });
    provider.canvas.fire('pointerup', mapUp);
    assert.equal(mapUp.defaultPrevented, false);
});

test('a marker controller that is no longer registered does not forward taps', async () => {
    const provider = new Provider();
    provider.unregisterOverlayController(provider.markers);
    provider.putMarker({ clickable: false });
    provider.canvas.fire('pointerdown', domEvent({ pointerId: 1, clientX: 50, clientY: 50 }));
    provider.canvas.fire('pointerup', domEvent({ pointerId: 1, clientX: 50, clientY: 50 }));
    await flush();
    assert.deepEqual(provider.log, []);
});
