// Intentionally non-terminating: use to check watchdog interruption.
export default class WatchdogWorker implements Klanker.Worker {
    flightTick({ vessel }: Klanker.FlightContext): void {
        vessel.control.throttle = 1;
        while (true) { }
    }
}
