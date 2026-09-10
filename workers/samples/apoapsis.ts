// Launch a simple vertically pointed rocket yourself, then load this worker.
// This controls throttle only. SAS and attitude remain under player control.
export default {
    flightTick({ vessel }) {
        vessel.control.throttle = vessel.orbit.apoapsis < 100_000 ? 1 : 0;
    },
} satisfies Klanker.Worker;
