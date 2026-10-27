// Quicksave, run a while, then quickload or reload this worker.
export default class StorageWorker implements Klanker.Worker {
    private ticks = 0;
    private flightSeconds = 0;

    onLoad({ storage }: Klanker.LifecycleContext): void {
        this.ticks = typeof storage.ticks === 'number' ? storage.ticks : 0;
        this.flightSeconds = typeof storage.flightSeconds === 'number' ? storage.flightSeconds : 0;
        console.log('Storage restored:', { ticks: this.ticks, flightSeconds: this.flightSeconds });
    }

    flightTick({ deltaTime }: Klanker.FlightContext): void {
        this.ticks++;
        this.flightSeconds += deltaTime;
    }

    onSave({ storage }: Klanker.LifecycleContext): void {
        storage.ticks = this.ticks;
        storage.flightSeconds = this.flightSeconds;
    }
}
