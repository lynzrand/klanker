// The staged throttle write must be discarded and the fault must stay sticky.
export default class FaultWorker implements Klanker.Worker {
    flightTick({ vessel }: Klanker.FlightContext): void {
        vessel.control.throttle = 1;
        throw new Error('Intentional rollback test');
    }
}
