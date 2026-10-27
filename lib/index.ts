// The importable Klanker worker library. These are the same modules workers
// reach through `klanker:<name>` / `klanker/<name>`; importing them here from a
// normal TypeScript project gives editor completion and type checking.
//
//   import { PID } from 'klanker';            // named re-exports
//   import { vec } from 'klanker';            // one namespace per module
//   import { PID } from 'klanker/pid';        // subpath imports
import * as vec from './vec';
import * as pid from './pid';
import * as attitude from './attitude';
import * as frame from './frame';
import * as orbit from './orbit';
import * as mechjeb from './mechjeb';

export { vec, pid, attitude, frame, orbit, mechjeb };
export { PID } from './pid';
export { AttitudeHold } from './attitude';
export type { Vec3 } from './vec';
export type { AttitudeOptions, AttitudeContext } from './attitude';
export type { FrameContext, Basis } from './frame';
export type { BodyLike } from './orbit';
export type { MechJebLike } from './mechjeb';

export default { vec, pid, attitude, frame, orbit, mechjeb };
