// Launch a vertically pointed rocket manually; this worker controls throttle only.
export default class ApoapsisWorker implements Klanker.Worker {
    flightTick({ vessel }: Klanker.FlightContext): void {
        vessel.control.throttle = vessel.orbit.apoapsis < 100000 ? 1 : 0;
    }
}
