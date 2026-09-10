// Thin wrappers over ctx.mechjeb. Every call throws when MechJeb is not on the
// vessel, so check available() first. Import as:
//   import mj, { SmartAss, smartAss } from 'klanker:mechjeb';
// The context is typed structurally so this module stays independent of the
// host API declaration.
export interface MechJebLike {
    mechjeb: {
        available: boolean;
        smartAss: { engage(mode: string): void; disable(): void };
        node: { execute(): void; abort(): void };
        landing: { start(): void; stop(): void };
    };
}

export const SmartAss = Object.freeze({
    OFF: 'off',
    KILLROT: 'killrot',
    PROGRADE: 'prograde',
    RETROGRADE: 'retrograde',
    NORMAL: 'normal',
    ANTINORMAL: 'antinormal',
    RADIAL: 'radial',
    ANTIRADIAL: 'antiradial',
    TARGET: 'target',
    ANTITARGET: 'antitarget',
    RELATIVE: 'relative',
    ANTIRELATIVE: 'antirelative',
    SURFACE_PROGRADE: 'surfaceprograde',
    SURFACE_RETROGRADE: 'surfaceretrograde',
    HORIZONTAL: 'horizontal',
    VERTICAL: 'vertical',
    MANEUVER_NODE: 'maneuvernode',
} as const);

export const available = (context: MechJebLike): boolean => context.mechjeb.available;
export const smartAss = (context: MechJebLike, mode: string = SmartAss.PROGRADE): void =>
    context.mechjeb.smartAss.engage(mode);
export const disableSmartAss = (context: MechJebLike): void => context.mechjeb.smartAss.disable();
export const executeNode = (context: MechJebLike): void => context.mechjeb.node.execute();
export const abortNode = (context: MechJebLike): void => context.mechjeb.node.abort();
export const startLanding = (context: MechJebLike): void => context.mechjeb.landing.start();
export const stopLanding = (context: MechJebLike): void => context.mechjeb.landing.stop();

export default { SmartAss, available, smartAss, disableSmartAss, executeNode, abortNode, startLanding, stopLanding };
