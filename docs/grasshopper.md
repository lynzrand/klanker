# Grasshopper hop test

[`grasshopper.js`](../GameData/Klanker/Workers/grasshopper.js) is an experimental
autonomous hopper for a small upright rocket. It climbs about 30 m above its
starting ground clearance, translates 20 m east, brakes, then descends at 1 m/s,
slowing toward 0.3 m/s near the ground. Braking and descent target **zero horizontal
velocity**, not a fixed landing coordinate, and the burn ends when KSP reports
contact with land. The landing position may drift from the nominal 20 m target.

This is a tuning example, not a general-purpose landing autopilot. On 2026-09-09,
the user reported a successful in-game test in Windows KSP 1.12.5 after the
horizontal PID / velocity-cancellation update. The earlier controller had rocked
sideways during descent. This confirms the revised controller worked on that
test craft, not that its tuning suits every rocket.

Automated checks also cover simplified rigid-body flights, a descent disturbance,
PID behavior, and startup through ClearScript. The simulation does not validate
real gimbal response, flexible joints, aerodynamics, or landing-leg contact.

## Set up the craft

Use a small, reasonably rigid liquid-fuel rocket with:

- An upright command pod/probe core selected with **Control from Here**.
- A throttleable engine aligned with that part's nose axis. No SRBs.
- Launch thrust-to-weight around 2, enough fuel for roughly two minutes, and
  reaction-wheel or gimbal authority on pitch and yaw.
- Landing legs already deployed, electrical charge, and no staging during the hop.

Start on flat, open terrain near sea level, away from buildings and steep slopes.
The script uses changes in latitude/longitude for a short-distance east/north
position estimate. It is not designed for the poles, water landings, terrain
avoidance, or long-range navigation.

## Configure and fly

1. Close KSP and build/deploy the updated mod with
   `pnpm make deploy --configuration Release`. The older mod lacks the attitude
   and timing properties this script needs.
2. Edit the settings at the top of `GameData/Klanker/Workers/grasshopper.js`.
   Set `hoverThrottle` to approximately **1 / launch TWR**, with the current
   engine thrust limiter and local atmospheric thrust taken into account.
   For TWR 2, use 0.5. This estimate is for the mass at worker startup; the
   script compensates for changing mass during the flight.
3. For the first trial, set `eastDistance: 0` and `hopHeight: 10` to check
   vertical control. Use the default 20 m / 30 m hop after that works.
4. Launch the craft, turn **SAS off**, disable other autopilots, and stay at
   normal 1x physics speed. Leave manual pitch/yaw/roll inputs neutral.
5. Assign `grasshopper.js` to the active command part while stationary on the
   ground. Activate the engine and release any clamps manually, then start the
   worker. It commands takeoff throttle immediately; it does not stage for you.
6. Watch `KSP.log` for `Grasshopper: climb`, `translate`, `brake`,
   `descend`, and `landed`. Phase changes are logged, not every physics tick.

Do not reload or restart the worker in midair. Its flight plan and controller
state are intentionally local JS variables; a fresh runtime refuses an airborne
start. Switching control points/vessels also recreates the runtime.

If it tilts the wrong way, oscillates, or leaves the test area, take manual
control or revert the test flight. A worker fault releases Klanker's control
writes; it does not itself shut down a running engine. The script's envelope
checks are diagnostic stops, not an emergency landing system.

## Controllers and tuning

The controller is deliberately small:

- Position **P** loops request bounded speeds during climb/translation.
  Braking begins near the horizontal target, then both horizontal speed targets
  become zero throughout braking and descent.
- Independent horizontal-speed **PID** loops request north/east acceleration.
  They use simulation timestep integration, a filtered derivative on measurement,
  bounded integrals, conditional-integration anti-windup, and back-calculation
  for the shared two-axis tilt limit. Phase transitions reset these PID states.
  A 0.05 m/s error deadband reduces corrections for tiny speed errors during landing.
- The tilt limit is 8 degrees for translation, 3 degrees for braking/descent,
  tapering to 1 degree in the last 5 m. This is a requested tilt limit, not a
  guarantee that the craft's actual attitude cannot overshoot.
- A vertical-speed **PI** loop adjusts throttle around the hover estimate.
  The integral is bounded, frozen on the ground, and not accumulated when
  the requested throttle is saturated.
- An attitude **PD** loop points the nose along the requested thrust direction.
  Measured angular velocity provides damping, rather than a numerical derivative
  of pitch/heading. Roll rate is damped without holding a particular roll angle.

Attitude gains depend on the craft's torque-to-inertia ratio. If it wobbles,
reduce `attitudeGain` and/or increase `dampingGain` in small steps, then repeat
the vertical-only test. An engine that cannot throttle low enough, a weak or
flexible vehicle, or a badly wrong hover estimate needs a craft/configuration
change rather than more integral gain.

The script considers braking complete after it is moving slowly and holding
altitude for two seconds; it does not return to the exact target. Near the ground it
uses its initial ground clearance as a landing-height estimate, and waits for
KSP's landed state rather than guessing that a particular altitude means contact.

## Telemetry conventions

`ctx.universalTime` and `ctx.deltaTime` use simulation seconds.
`vessel.attitude.up/north/east`, `attitude.angularVelocity`, and
`velocity.localSurface` are expressed in the active control part's frame:
**x right, y nose, z belly**. Angular velocity is in radians per second.
The direction of positive KSP control input is opposite to geometric rotation
about the corresponding local axis.

The adapter uses the command reference transform and root rigidbody angular
velocity, consistent with the approach in
[kRPC's vessel helpers](https://github.com/krpc/krpc/blob/main/service/SpaceCenter/src/ExtensionMethods/VesselExtensions.cs).
This is not a dependency on kRPC. See
[`klanker.d.ts`](../GameData/Klanker/Workers/klanker.d.ts) for the complete interface.
