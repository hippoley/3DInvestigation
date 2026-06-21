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
 * Each waypoint: { position: [x,y,z], target: [x,y,z], duration?: seconds }
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

  /** Aerial overview → living room → kitchen → master bedroom */
  overview: [
    { position: [14, 18, 20],  target: [0, 1, 0],    duration: 2.0 },
    { position: [6,  2.2, 10], target: [0, 1.5, 0],  duration: 3.5 },
    { position: [-2, 2.2, 6],  target: [-6, 1.5, 2], duration: 3.0 },
    { position: [4,  5.5, -4], target: [0, 4.5, -8], duration: 3.0 },
  ],

  /** Ground-floor walk: entrance → living → dining → kitchen */
  groundFloor: [
    { position: [0,  1.7, 14],  target: [0,  1.4, 0],   duration: 2.5 },
    { position: [4,  1.7, 6],   target: [0,  1.4, 0],   duration: 3.0 },
    { position: [-4, 1.7, 2],   target: [-8, 1.4, 2],   duration: 3.0 },
    { position: [-8, 1.7, -4],  target: [-8, 1.4, -8],  duration: 2.5 },
  ],

  /** Upper-floor walk: staircase landing → master bedroom → balcony */
  upperFloor: [
    { position: [2,  5.5, 8],   target: [0,  4.5, 0],   duration: 2.0 },
    { position: [4,  5.5, 2],   target: [0,  4.5, -2],  duration: 3.0 },
    { position: [6,  5.5, -4],  target: [2,  4.5, -8],  duration: 3.0 },
    { position: [10, 5.5, -8],  target: [4,  4.5, -8],  duration: 2.5 },
  ],

  /** Detail tour: closeup on bathroom fixtures → kitchen counter → lighting */
  details: [
    { position: [-6, 1.8, -6],  target: [-8, 1.4, -8],  duration: 2.0 },
    { position: [-8, 1.5, -4],  target: [-8, 1.2, -6],  duration: 3.5 },
    { position: [-4, 1.6, 0],   target: [-6, 1.0, -2],  duration: 3.0 },
    { position: [0,  2.5, 4],   target: [0,  2.0, 0],   duration: 2.5 },
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
      onUpdate:   () => { this._ctrl.target.set(...wp.target); this._dirty(); },
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
   * @param {number}  [opts.pauseAt=0.5]    seconds to pause at each waypoint
   * @param {Function} [opts.onArrive]      called with (index, waypoint) on each arrival
   * @param {Function} [opts.onComplete]    called when the full tour finishes
   * @returns {gsap.core.Timeline}
   */
  autoTour(waypoints, opts = {}) {
    if (!waypoints?.length) return;
    this.stop();

    const { loop = false, pauseAt = 0.5, onArrive, onComplete } = opts;

    this._ctrl.enabled = false;
    this._running = true;

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

    // Capture the starting position as implicit waypoint 0
    const startPos    = this._cam.position.clone();
    const startTarget = this._ctrl.target.clone();

    let cursor = 0; // timeline cursor in seconds

    waypoints.forEach((wp, i) => {
      const dur  = wp.duration ?? 2.5;
      const ease = i === 0 ? EASE_FIRST : (i === waypoints.length - 1 ? EASE_LAST : EASE_FLY);

      const tgt = new THREE.Vector3(...wp.target);

      // Camera position tween
      tl.to(this._cam.position, {
        x: wp.position[0], y: wp.position[1], z: wp.position[2],
        duration: dur, ease,
        onUpdate: () => {
          // Interpolate controls.target so the look-at tracks smoothly
          const prog = tl.progress();
          this._ctrl.target.lerp(tgt, 0.08);
          this._dirty();
        },
        onComplete: () => {
          this._ctrl.target.copy(tgt);
          onArrive?.(i, wp);
        }
      }, cursor);

      cursor += dur + pauseAt;
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
