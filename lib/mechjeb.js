// Thin wrappers over ctx.mechjeb. Every call throws when MechJeb is not on the
// vessel, so check available() first. Import as:
//   import mj, { SmartAss, smartAss } from 'klanker:mechjeb';

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
});

export const available = context => context.mechjeb.available;
export const smartAss = (context, mode = SmartAss.PROGRADE) => context.mechjeb.smartAss.engage(mode);
export const disableSmartAss = context => context.mechjeb.smartAss.disable();
export const executeNode = context => context.mechjeb.node.execute();
export const abortNode = context => context.mechjeb.node.abort();
export const startLanding = context => context.mechjeb.landing.start();
export const stopLanding = context => context.mechjeb.landing.stop();

export default { SmartAss, available, smartAss, disableSmartAss, executeNode, abortNode, startLanding, stopLanding };
