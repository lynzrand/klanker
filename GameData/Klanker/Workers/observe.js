// A first-load smoke test: reads live telemetry without changing controls.
export default {
    flightTick({ vessel }) {
        if (!Number.isFinite(vessel.altitude)) throw new Error('Invalid altitude');
    },
};
