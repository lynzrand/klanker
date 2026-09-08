// Intentionally non-terminating: use to check watchdog interruption.
export default {
    flightTick({ vessel }) {
        vessel.control.throttle = 1;
        while (true) {}
    },
};
