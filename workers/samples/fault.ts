// The staged throttle write must be discarded and the fault must stay sticky.
export default {
    flightTick({ vessel }) {
        vessel.control.throttle = 1;
        throw new Error('Intentional rollback test');
    },
} satisfies Klanker.Worker;
