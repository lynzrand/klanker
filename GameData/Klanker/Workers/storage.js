// @ts-check
/// <reference path="./klanker.d.ts" />
// Read-only flight example: quicksave, run a while, then quickload or reload this file.
let reported = false;
/** @satisfies {Klanker.Worker} */
export default {
    flightTick({ storage, deltaTime }) {
        const ticks = typeof storage.ticks === 'number' ? storage.ticks : 0;
        const seconds = typeof storage.flightSeconds === 'number' ? storage.flightSeconds : 0;
        if (!reported) {
            console.log('Storage restored:', { ticks, flightSeconds: seconds });
            reported = true;
        }
        storage.ticks = ticks + 1;
        storage.flightSeconds = seconds + deltaTime;
    },
};
