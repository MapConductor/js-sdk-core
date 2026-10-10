import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { MapViewStyleHost, MutableMapServiceRegistry } from '../dist/index.mjs';

/**
 * The decision table of `MapViewStyleHost.apply`.
 *
 * The only part of this class that carries a decision is when to install
 * again and when to leave things alone; the rest is handing things through
 * to a provider. And that condition was once inverted, unnoticed: **the
 * same key called `update`** (recompile → diagnostics → setState → another
 * render → round again, which showed up as a flickering panel), and **a
 * changed key never called `update`** (dispose and install every time,
 * which is the reload the whole delta-compiling design exists to avoid).
 * Both are the kind of break that compiles and still draws a map, so the
 * table is written down here.
 *
 * android-sdk の `MapViewStyleHostTest`、ios-sdk の `MapViewStyleHostTests`
 * と 1 対 1 で対応する。
 */
describe('MapViewStyleHost', () => {
    let calls;
    let warnings;
    let originalWarn;

    beforeEach(() => {
        calls = [];
        warnings = [];
        originalWarn = console.warn;
        console.warn = (message) => warnings.push(String(message));
    });

    // node:test has no global afterEach hook ordering guarantee with the
    // stubbed console, so each test restores through this.
    const restore = () => {
        console.warn = originalWarn;
    };

    /**
     * Records what it was asked to do, and nothing else.
     *
     * `takesUpdates` is a function so the answer can change after the style
     * is installed — which is what the reset test needs.
     */
    const style = (key, takesUpdates = () => true) => ({
        key,
        install() {
            calls.push(`install(${key})`);
            return {
                dispose: () => calls.push(`dispose(${key})`),
                update: (next) => {
                    calls.push(`update(${key} -> ${next.key})`);
                    return takesUpdates();
                },
            };
        },
    });

    // The controller is never reached by a decision: `apply` only uses it
    // through `onStyleLoaded` / `upsertRaster` / `removeRaster`, and a
    // recording style asks for none of them.
    const host = () => new MapViewStyleHost(new MutableMapServiceRegistry(), {});

    test('the first apply installs', () => {
        host().apply(style('a'));
        assert.deepEqual(calls, ['install(a)']);
        restore();
    });

    /**
     * An unchanged key does nothing. Inverted, this was the flicker: the
     * recompile is not merely wasted work, it re-reports the diagnostics,
     * and an app that renders them sets state and renders again.
     */
    test('an unchanged key does nothing', () => {
        const subject = host();
        subject.apply(style('a'));
        calls = [];

        // Different objects, same content — which is what a style built
        // inline in JSX produces on every render.
        subject.apply(style('a'));
        subject.apply(style('a'));

        assert.deepEqual(calls, []);
        restore();
    });

    /**
     * A changed key is offered to what is installed before anything is torn
     * down. A slider that does not reload the map is this one line.
     */
    test('a changed key is offered before being reinstalled', () => {
        const subject = host();
        subject.apply(style('a'));
        calls = [];

        subject.apply(style('b'));

        assert.deepEqual(calls, ['update(a -> b)']);
        restore();
    });

    test('an accepted key becomes the installed one', () => {
        const subject = host();
        subject.apply(style('a'));
        subject.apply(style('b'));
        calls = [];

        subject.apply(style('b'));

        assert.deepEqual(calls, []);
        restore();
    });

    test('a refused update disposes and installs', () => {
        const no = () => false;
        const subject = host();
        subject.apply(style('a', no));
        calls = [];

        subject.apply(style('b', no));

        assert.deepEqual(calls, ['update(a -> b)', 'dispose(a)', 'install(b)']);
        restore();
    });

    /**
     * A style with no `update` at all is the documented default — it has to
     * mean "refused", not "took it".
     */
    test('a style that cannot update is reinstalled', () => {
        const plain = (key) => ({
            key,
            install() {
                calls.push(`install(${key})`);
                return { dispose: () => calls.push(`dispose(${key})`) };
            },
        });
        const subject = host();
        subject.apply(plain('a'));
        calls = [];

        subject.apply(plain('b'));

        assert.deepEqual(calls, ['dispose(a)', 'install(b)']);
        restore();
    });

    /** Null takes it off: the app gets the map it had, not what the style left. */
    test('null takes it off', () => {
        const subject = host();
        subject.apply(style('a'));
        calls = [];

        subject.apply(null);
        assert.deepEqual(calls, ['dispose(a)']);

        // And the same key afterwards installs rather than being left alone.
        calls = [];
        subject.apply(style('a'));
        assert.deepEqual(calls, ['install(a)']);
        restore();
    });

    /**
     * Refusing every time is correct but slow, and the cause is almost
     * always a rasteriser rebuilt on each render. Say so rather than
     * quietly being slow.
     */
    test('a run of refusals is reported, with the fix', () => {
        const no = () => false;
        const subject = host();
        subject.apply(style('k0', no));
        for (let index = 0; index < 5; index += 1) subject.apply(style(`k${index + 1}`, no));

        const refused = warnings.filter((line) => line.includes('refused'));
        assert.equal(refused.length, 1, 'once, not on every change');
        assert.match(refused[0], /useMemo/, 'says how to fix it, not just that it happened');
        restore();
    });

    /** Only a *run* is a problem, so one that is taken starts the count over. */
    test('an accepted update resets the run', () => {
        let takes = false;
        const answer = () => takes;
        const subject = host();
        subject.apply(style('k0', answer));
        for (let index = 0; index < 4; index += 1) subject.apply(style(`r${index}`, answer));
        takes = true;
        subject.apply(style('ok', answer));
        takes = false;
        for (let index = 0; index < 4; index += 1) subject.apply(style(`s${index}`, answer));

        assert.deepEqual(
            warnings.filter((line) => line.includes('refused')),
            [],
        );
        restore();
    });
});
