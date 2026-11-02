/**
 * When the playhead should wait for a sentence.
 *
 * A document's scene durations were measured against recordings that may
 * never have existed, and a browser voice does not take the same time as
 * whoever was originally timed. Run the picture on the declared clock and
 * the voice on its own and sentences get cut off at scene boundaries - the
 * exact complaint this rule exists to answer. `mode: derived` in the format
 * means the beat stretches to fit the narration, so the clock waits.
 *
 * Kept as a pure function with no imports because the alternative is a
 * dozen lines buried inside a requestAnimationFrame callback, which cannot
 * be tested: rAF does not fire at all in a window that is not compositing,
 * so a bug in there is invisible until someone watches the page.
 */

export interface SceneEdge {
  id: string
  /** Document-absolute start of the scene, in seconds. */
  start: number
  /** Document-absolute end of the scene, in seconds. */
  end: number
}

/**
 * How long before a scene ends things start fading out.
 *
 * Three different places count down to the declared scene end and dim
 * whatever they are drawing: the caption at `(end - now) / 0.4`, an
 * annotation's window at `(end - now) / 0.5`, and a flow line's own
 * `fade_out`. Parking the playhead at `end - 0.01` to wait for a sentence
 * therefore froze all three at about two percent opacity, so the caption
 * and the lines vanished while the voice kept talking.
 *
 * The playhead waits in front of the ramp instead, and is released into it
 * so the fade still plays on the way out. One number here rather than a
 * "we are holding" flag threaded into three drawing sites, which is how a
 * fourth one would eventually get missed.
 */
export const FADE_RAMP = 0.6

/** Set when a line finishes, to hold a beat before the next scene. */
export interface Rest {
  sceneId: string
  /** A `performance.now()` deadline, in milliseconds. */
  until: number
}

export interface HoldInput {
  /** Where the clock would be if nothing held it. */
  clock: number
  /** The scene the clock is currently inside, if any. */
  scene: SceneEdge | undefined
  /** The scene whose line is being spoken right now, if any. */
  speakingSceneId: string | null
  rest: Rest | null
  /** `performance.now()`, in milliseconds. */
  now: number
}

export interface HoldResult {
  /** Where the clock should actually be. */
  clock: number
  /** True when the rest has been served and should be forgotten. */
  clearRest: boolean
}

/**
 * Holds the playhead at the edge of a scene whose line is still being said,
 * and for the breath afterwards; then steps across the boundary deliberately
 * rather than drifting there, so a scene that finished early does not sit in
 * silence waiting out a duration nothing is filling.
 */
export function holdForNarration({
  clock,
  scene,
  speakingSceneId,
  rest,
  now,
}: HoldInput): HoldResult {
  if (!scene) return { clock, clearRest: false }

  const mine = rest !== null && rest.sceneId === scene.id
  const resting = rest !== null && mine && now < rest.until

  if (speakingSceneId === scene.id || resting) {
    // Still talking, or still breathing. Wait in front of the fade rather
    // than inside it, so everything on screen stays at full strength until
    // the sentence is actually over.
    // Never earlier than the scene's own start: a scene shorter than the
    // ramp would otherwise pull the playhead back into the one before it.
    const waitAt = Math.max(scene.start, scene.end - FADE_RAMP)
    return { clock: Math.min(clock, waitAt), clearRest: false }
  }

  if (mine) {
    // The line is done and the breath is over. Let the clock run on into
    // the ramp rather than jumping the boundary: the fade is the last
    // half-second of the scene and skipping it would make every scene end
    // on a cut.
    return { clock, clearRest: true }
  }

  // Nothing is being said for this scene - the declared duration governs.
  return { clock, clearRest: false }
}
