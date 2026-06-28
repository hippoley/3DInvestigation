/**
 * bp3d-camera-tour.js
 * GSAP-powered camera animation system for the ArchViz renderer.
 *
 * Features:
 *  - autoTour(waypoints, opts)   — fly through an array of viewpoints
 *  - flyTo(waypoint, opts)       — animate to a single viewpoint
 *  - stop()                      — halt any running tour
 *  - SCENE_TOURS                 — four built-in tour presets for the duplex
 *
 * Each waypoint: { label?: string, position: [x,y,z], target: [x,y,z], duration?: seconds, hold?: seconds }
 *
 * Usage:
 *   import { CameraTour, SCENE_TOURS } from './bp3d-camera-tour.js';
 *   const tour = new CameraTour(camera, controls, markDirty);
 *   tour.autoTour(SCENE_TOURS.overview);
 */

import { gsap } from 'gsap';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Built-in tour presets (coordinates tuned for the Duplex Apartment model).
// Override freely — these are starting points, not requirements.
// ---------------------------------------------------------------------------

export const SCENE_TOURS = {

  /** Slow interior reel: living objects → kitchen/fixtures → windows/light */
  overview: [
    { label: 'L1 entry depth',       position: [ 5.6, 2.05,  9.6], target: [ 0.8, 1.35,  2.2], duration: 3.6, hold: 1.4 },
    { label: 'Living furniture',     position: [ 2.6, 1.65,  5.2], target: [-1.6, 1.05,  1.4], duration: 4.0, hold: 1.8 },
    { label: 'Kitchen counter',      position: [-3.9, 1.55,  1.6], target: [-7.4, 1.05, -2.6], duration: 4.2, hold: 1.8 },
    { label: 'Bath fixtures',        position: [-6.3, 1.55, -5.2], target: [-8.2, 1.05, -7.4], duration: 3.6, hold: 1.6 },
    { label: 'Window wash L1',       position: [ 1.2, 2.05,  8.8], target: [ 2.0, 1.75, 13.2], duration: 3.8, hold: 2.0 },
    { label: 'Upper room objects',   position: [ 3.6, 5.35,  2.4], target: [-0.8, 4.70, -2.2], duration: 4.2, hold: 1.8 },
    { label: 'Upper window light',   position: [ 6.8, 5.35, -3.1], target: [ 8.8, 4.85, -8.4], duration: 4.0, hold: 2.2 },
  ],

  /** Ground-floor walk: entrance → living → dining → kitchen */
  groundFloor: [
    { label: 'Entry',          position: [0,  1.7, 14],  target: [0,  1.4, 0],   duration: 3.2, hold: 1.2 },
    { label: 'Living objects', position: [4,  1.7, 6],   target: [0,  1.2, 0],   duration: 3.8, hold: 1.6 },
    { label: 'Dining surface', position: [-4, 1.7, 2],   target: [-8, 1.2, 2],   duration: 3.8, hold: 1.6 },
    { label: 'Kitchen',        position: [-8, 1.7, -4],  target: [-8, 1.2, -8],  duration: 3.2, hold: 1.8 },
  ],

  /** Upper-floor walk: staircase landing → master bedroom → balcony */
  upperFloor: [
    { label: 'Landing',       position: [2,  5.5, 8],   target: [0,  4.5, 0],   duration: 3.0, hold: 1.3 },
    { label: 'Room objects',  position: [4,  5.5, 2],   target: [0,  4.5, -2],  duration: 3.8, hold: 1.7 },
    { label: 'Window edge',   position: [6,  5.5, -4],  target: [2,  4.5, -8],  duration: 3.8, hold: 2.0 },
    { label: 'Window view',   position: [10, 5.5, -8],  target: [4,  4.5, -8],  duration: 3.2, hold: 2.0 },
  ],

  upperWindowInterior12: [
    { label: 'L2 window interior start', position: [5.55, 4.78, -4.55], target: [5.95, 4.50, -5.05], duration: 0.00, hold: 0.00 },
    { label: 'Window frame inside',       position: [5.15, 4.76, -4.00], target: [5.40, 4.48, -4.65], duration: 1.60, hold: 0.00 },
    { label: 'Turn along window light',   position: [4.65, 4.74, -3.20], target: [4.30, 4.42, -3.05], duration: 1.60, hold: 0.00 },
    { label: 'Bed depth approach',        position: [3.85, 4.70, -2.25], target: [3.00, 4.36, -2.15], duration: 1.80, hold: 0.00 },
    { label: 'Bedding and pillows',       position: [2.85, 4.66, -1.25], target: [1.65, 4.34, -1.65], duration: 1.80, hold: 0.00 },
    { label: 'Bedside object pass',       position: [1.75, 4.64, -0.05], target: [0.45, 4.30, -0.45], duration: 1.60, hold: 0.00 },
    { label: 'Room object depth',         position: [0.75, 4.68,  1.25], target: [-0.65, 4.36, -0.30], duration: 1.80, hold: 0.00 },
    { label: 'Interior material finish',  position: [0.10, 4.76,  2.20], target: [-1.35, 4.44, -1.25], duration: 1.80, hold: 0.00 },
  ],

  /** Detail tour: closeup on bathroom fixtures → kitchen counter → lighting */
  details: [
    { label: 'Sanitary detail', position: [-6, 1.8, -6],  target: [-8, 1.25, -8], duration: 3.0, hold: 1.9 },
    { label: 'Fixture edge',    position: [-8, 1.5, -4],  target: [-8, 1.15, -6], duration: 3.6, hold: 1.9 },
    { label: 'Counter detail',  position: [-4, 1.6, 0],   target: [-6, 1.00, -2], duration: 3.6, hold: 1.8 },
    { label: 'Window light',    position: [0,  2.5, 4],   target: [2,  1.85, 10], duration: 3.4, hold: 2.2 },
  ],
};

// ---------------------------------------------------------------------------
// Default easing per leg type
// ---------------------------------------------------------------------------
const EASE_FLY   = 'power2.inOut';  // smooth acceleration both ends
const EASE_FIRST = 'power1.out';    // gentler on the opening shot
const EASE_LAST  = 'power2.in';     // purposeful stop on final shot

// ---------------------------------------------------------------------------
// CameraTour class
// ---------------------------------------------------------------------------

export class CameraTour {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {OrbitControls}           controls  — OrbitControls instance
   * @param {Function}                markDirty — renderer's markDirty()
   */
  constructor(camera, controls, markDirty) {
    this._cam      = camera;
    this._ctrl     = controls;
    this._dirty    = markDirty;
    this._tl       = null;   // active GSAP timeline
    this._running  = false;
  }

  /**
   * Fly to a single viewpoint.
   * @param {{ position: number[], target: number[], duration?: number }} wp
   * @param {{ ease?: string, onComplete?: Function }} opts
   * @returns {gsap.core.Timeline}
   */
  flyTo(wp, opts = {}) {
    this.stop();
    const dur    = wp.duration ?? 2.0;
    const ease   = opts.ease   ?? EASE_FLY;

    this._ctrl.enabled = false;
    this._running = true;

    const tl = gsap.timeline({
      onUpdate:   () => {
        this._ctrl.target.set(...wp.target);
        this._ctrl.update?.();
        this._cam.lookAt(this._ctrl.target);
        this._dirty();
      },
      onComplete: () => {
        this._ctrl.enabled = true;
        this._running = false;
        opts.onComplete?.();
      }
    });

    tl.to(this._cam.position, {
      x: wp.position[0], y: wp.position[1], z: wp.position[2],
      duration: dur, ease
    }, 0);

    this._tl = tl;
    return tl;
  }

  /**
   * Fly through an ordered array of waypoints, one after another.
   * @param {Array}   waypoints
   * @param {Object}  [opts]
   * @param {boolean} [opts.loop=false]     repeat indefinitely
   * @param {number}  [opts.pauseAt=1.15]   seconds to pause at each waypoint
   * @param {Function} [opts.onArrive]      called with (index, waypoint) on each arrival
   * @param {Function} [opts.onComplete]    called when the full tour finishes
   * @returns {gsap.core.Timeline}
   */
  autoTour(waypoints, opts = {}) {
    if (!waypoints?.length) return;
    this.stop();

    const { loop = false, pauseAt = 1.15, continuous = false, cinematic = false, duration, onArrive, onComplete, onProgress } = opts;

    this._ctrl.enabled = false;
    this._running = true;

    if (continuous && waypoints.length >= 2) {
      const moveDurations = waypoints.map((wp, i) => i === 0 ? 0 : Math.max(0.05, wp.duration ?? 1.5));
      const holdDurations = waypoints.map((wp, i) => {
        const fallbackHold = i > 0 && i < waypoints.length - 1 ? pauseAt : 0;
        return Math.max(0, wp.hold ?? fallbackHold);
      });
      const computedDuration = moveDurations.reduce((sum, value) => sum + value, 0)
        + holdDurations.reduce((sum, value) => sum + value, 0);
      const totalDuration = duration ?? (computedDuration || 12);
      const durationScale = computedDuration > 0 ? totalDuration / computedDuration : 1;
      const positionCurve = new THREE.CatmullRomCurve3(
        waypoints.map((wp) => new THREE.Vector3(...wp.position)),
        false,
        'centripetal',
        0.28
      );
      const targetCurve = new THREE.CatmullRomCurve3(
        waypoints.map((wp) => new THREE.Vector3(...wp.target)),
        false,
        'centripetal',
        0.28
      );
      const segmentCount = waypoints.length - 1;
      const waypointTiming = waypoints.map((wp, index) => {
        if (Number.isFinite(wp.at)) return Math.max(0, Math.min(1, wp.at));
        if (Number.isFinite(wp.time) && totalDuration > 0) return Math.max(0, Math.min(1, wp.time / totalDuration));
        return index / segmentCount;
      });
      const hasWaypointTiming = waypointTiming.length === waypoints.length
        && waypointTiming[0] === 0
        && waypointTiming[waypointTiming.length - 1] === 1
        && waypointTiming.every((value, index) => index === 0 || value >= waypointTiming[index - 1]);
      const timeProgressToCurveT = (progress) => {
        if (!hasWaypointTiming) return progress;
        const p = Math.max(0, Math.min(1, progress));
        if (p <= 0) return 0;
        if (p >= 1) return 1;
        let index = 0;
        while (index < waypointTiming.length - 2 && p > waypointTiming[index + 1]) index++;
        const start = waypointTiming[index];
        const end = Math.max(start + 0.0001, waypointTiming[index + 1]);
        const local = Math.max(0, Math.min(1, (p - start) / (end - start)));
        return Math.max(0, Math.min(1, (index + gsap.parseEase('sine.inOut')(local)) / segmentCount));
      };
      const hasFov = waypoints.some((wp) => Number.isFinite(wp.fov));
      const baseFov = this._cam.fov;
      const fovValues = waypoints.map((wp) => (
        Number.isFinite(wp.fov) ? Math.max(18, Math.min(62, wp.fov)) : baseFov
      ));
      const state = { raw: 0, t: 0 };
      const startPos = positionCurve.getPoint(0);
      const startTarget = targetCurve.getPoint(0);
      const applyCurvePose = () => {
        const curveT = cinematic && hasWaypointTiming ? timeProgressToCurveT(state.t) : state.t;
        const pos = cinematic && !hasWaypointTiming ? positionCurve.getPointAt(curveT) : positionCurve.getPoint(curveT);
        const tgt = cinematic && !hasWaypointTiming ? targetCurve.getPointAt(curveT) : targetCurve.getPoint(curveT);
        this._cam.position.copy(pos);
        this._ctrl.target.copy(tgt);
        if (hasFov) {
          const scaled = curveT * segmentCount;
          const index = Math.min(waypoints.length - 2, Math.max(0, Math.floor(scaled)));
          const local = Math.max(0, Math.min(1, scaled - index));
          const easedLocal = gsap.parseEase('sine.inOut')(local);
          this._cam.fov = THREE.MathUtils.lerp(fovValues[index], fovValues[index + 1], easedLocal);
          this._cam.updateProjectionMatrix();
        }
        this._ctrl.update?.();
        this._cam.lookAt(tgt);
        this._dirty();
      };
      this._cam.position.copy(startPos);
      this._ctrl.target.copy(startTarget);
      if (hasFov) {
        this._cam.fov = fovValues[0];
        this._cam.updateProjectionMatrix();
      }
      this._ctrl.update?.();
      this._cam.lookAt(startTarget);
      this._dirty();
      onArrive?.(0, waypoints[0]);

      const tl = gsap.timeline({
        repeat: loop ? -1 : 0,
        onComplete: () => {
          if (!loop) {
            this._ctrl.enabled = true;
            this._running = false;
            onComplete?.();
          }
        }
      });
      const progressState = { elapsed: 0 };
      if (onProgress && !cinematic) {
        tl.to(progressState, {
          elapsed: totalDuration,
          duration: totalDuration,
          ease: 'none',
          onUpdate: () => {
            onProgress?.({
              elapsed: progressState.elapsed,
              duration: totalDuration,
              progress: totalDuration > 0 ? progressState.elapsed / totalDuration : 0,
              raw: totalDuration > 0 ? progressState.elapsed / totalDuration : 0,
              t: state.t,
              waypoints
            });
          },
          onComplete: () => {
            onProgress?.({
              elapsed: totalDuration,
              duration: totalDuration,
              progress: 1,
              raw: 1,
              t: state.t,
              waypoints
            });
          }
        }, 0);
      }

      if (cinematic) {
        const keyTs = hasWaypointTiming ? waypointTiming : waypoints.map((_, index) => index / segmentCount);
        const easeProgress = hasWaypointTiming ? ((value) => value) : gsap.parseEase(opts.ease || 'power1.inOut');
        let lastArrived = 0;
        const lingerRadius = Math.max(0.012, Math.min(0.07, opts.lingerRadius ?? 0.035));
        const lingerStrength = Math.max(0, Math.min(0.26, opts.lingerStrength ?? 0.08));
        const mapCinematicProgress = (raw) => {
          const eased = easeProgress(raw);
          let mapped = eased;
          for (let i = 1; i < keyTs.length - 1; i++) {
            const holdWeight = Math.min(1, Math.max(0, holdDurations[i] / 1.2));
            if (holdWeight <= 0) continue;
            const d = mapped - keyTs[i];
            const ad = Math.abs(d);
            if (ad >= lingerRadius) continue;
            const influence = (1 - ad / lingerRadius) ** 2 * lingerStrength * holdWeight;
            mapped = THREE.MathUtils.lerp(mapped, keyTs[i] + d * 0.42, influence);
          }
          return Math.max(0, Math.min(1, mapped));
        };

        tl.to(state, {
          raw: 1,
          duration: totalDuration,
          ease: 'none',
          onUpdate: () => {
            state.t = mapCinematicProgress(state.raw);
            applyCurvePose();
            onProgress?.({
              elapsed: state.raw * totalDuration,
              duration: totalDuration,
              progress: state.raw,
              raw: state.raw,
              t: state.t,
              waypoints
            });
            while (lastArrived < keyTs.length - 1 && state.t >= keyTs[lastArrived + 1] - 0.002) {
              lastArrived++;
              onArrive?.(lastArrived, waypoints[lastArrived]);
            }
          },
          onComplete: () => {
            state.t = 1;
            applyCurvePose();
            onProgress?.({
              elapsed: totalDuration,
              duration: totalDuration,
              progress: 1,
              raw: 1,
              t: state.t,
              waypoints
            });
            if (lastArrived < waypoints.length - 1) onArrive?.(waypoints.length - 1, waypoints[waypoints.length - 1]);
          }
        });
        this._tl = tl;
        return tl;
      }

      const addContinuousHold = (index, holdSeconds) => {
        if (holdSeconds <= 0.001) return;
        const baseT = index / segmentCount;
        const nextIndex = Math.min(waypoints.length - 1, index + 1);
        const prevIndex = Math.max(0, index - 1);
        const neighborT = index < waypoints.length - 1
          ? nextIndex / segmentCount
          : prevIndex / segmentCount;
        const driftT = THREE.MathUtils.lerp(baseT, neighborT, index < waypoints.length - 1 ? 0.08 : 0.045);
        tl.to(state, {
          t: driftT,
          duration: holdSeconds,
          ease: 'sine.inOut',
          onUpdate: applyCurvePose
        });
      };
      addContinuousHold(0, holdDurations[0] * durationScale);

      for (let i = 1; i < waypoints.length; i++) {
        const wp = waypoints[i];
        tl.to(state, {
          t: i / segmentCount,
          duration: moveDurations[i] * durationScale,
          ease: i === 1 ? 'power2.out' : (i === waypoints.length - 1 ? 'power2.inOut' : 'none'),
          onUpdate: applyCurvePose,
          onComplete: () => {
            onArrive?.(i, wp);
          }
        });
        addContinuousHold(i, holdDurations[i] * durationScale);
      }
      this._tl = tl;
      return tl;
    }

    const tl = gsap.timeline({
      repeat:    loop ? -1 : 0,
      onComplete: () => {
        if (!loop) {
          this._ctrl.enabled = true;
          this._running = false;
          onComplete?.();
        }
      }
    });

    let cursor = 0; // timeline cursor in seconds
    const targetState = {
      x: this._ctrl.target.x,
      y: this._ctrl.target.y,
      z: this._ctrl.target.z
    };

    waypoints.forEach((wp, i) => {
      const dur  = wp.duration ?? 2.5;
      const ease = i === 0 ? EASE_FIRST : (i === waypoints.length - 1 ? EASE_LAST : EASE_FLY);

      const tgt = new THREE.Vector3(...wp.target);

      if (dur <= 0.001) {
        tl.set(this._cam.position, {
          x: wp.position[0], y: wp.position[1], z: wp.position[2],
          onComplete: () => {
            if (Number.isFinite(wp.fov)) {
              this._cam.fov = Math.max(18, Math.min(62, wp.fov));
              this._cam.updateProjectionMatrix();
            }
            this._ctrl.target.copy(tgt);
            targetState.x = wp.target[0];
            targetState.y = wp.target[1];
            targetState.z = wp.target[2];
            this._ctrl.update?.();
            this._cam.lookAt(tgt);
            this._dirty();
            onArrive?.(i, wp);
          }
        }, cursor);
      } else {
        tl.to(this._cam.position, {
          x: wp.position[0], y: wp.position[1], z: wp.position[2],
          duration: dur, ease,
          onUpdate: () => {
            this._ctrl.update?.();
            this._cam.lookAt(this._ctrl.target);
            this._dirty();
          },
          onComplete: () => {
            this._ctrl.target.copy(tgt);
            this._ctrl.update?.();
            this._cam.lookAt(tgt);
            onArrive?.(i, wp);
          }
        }, cursor);
        if (Number.isFinite(wp.fov)) {
          tl.to(this._cam, {
            fov: Math.max(18, Math.min(62, wp.fov)),
            duration: dur,
            ease,
            onUpdate: () => {
              this._cam.updateProjectionMatrix();
              this._dirty();
            }
          }, cursor);
        }
        tl.to(targetState, {
          x: wp.target[0], y: wp.target[1], z: wp.target[2],
          duration: dur, ease,
          onUpdate: () => {
            this._ctrl.target.set(targetState.x, targetState.y, targetState.z);
            this._ctrl.update?.();
            this._cam.lookAt(this._ctrl.target);
            this._dirty();
          },
          onComplete: () => {
            this._ctrl.target.copy(tgt);
            this._ctrl.update?.();
            this._cam.lookAt(tgt);
          }
        }, cursor);
      }

      cursor += dur + (wp.hold ?? pauseAt);
    });

    this._tl = tl;
    return tl;
  }

  /** Stop any running tour and restore orbit controls. */
  stop() {
    if (this._tl) {
      this._tl.kill();
      this._tl = null;
    }
    this._ctrl.enabled = true;
    this._running = false;
  }

  get isRunning() { return this._running; }
}
