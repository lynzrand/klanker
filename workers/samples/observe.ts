// A first-load smoke test: reads live telemetry without changing controls.
let reported = false;

export default {
    flightTick({ vessel }) {
        if (!Number.isFinite(vessel.altitude)) throw new Error('Invalid altitude');
        if (!reported) {
            const charge = vessel.resources.get('ElectricCharge');
            console.log('Observing', vessel.name, {
                massKg: vessel.mass,
                body: vessel.body.name,
                charge: charge.amount,
                chargeCapacity: charge.capacity,
            });
            reported = true;
        }
    },
} satisfies Klanker.Worker;
