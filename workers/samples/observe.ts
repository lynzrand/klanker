// Read live telemetry once without changing controls.
export default class ObserveWorker implements Klanker.Worker {
    private reported = false;
    flightTick({ vessel }: Klanker.FlightContext): void {
        if (!Number.isFinite(vessel.altitude))
            throw new Error('Invalid altitude');
        if (!this.reported) {
            const charge = vessel.resources.get('ElectricCharge');
            console.log('Observing', vessel.name, {
                massKg: vessel.mass,
                body: vessel.body.name,
                charge: charge.amount,
                chargeCapacity: charge.capacity,
            });
            this.reported = true;
        }
    }
}
