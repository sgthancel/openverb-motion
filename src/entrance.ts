/**
 * Elements arriving and leaving on their own schedule.
 *
 * A GeoStory animates exactly one thing - the camera - and gives everything
 * else a half-second opacity fade at the edges of its window. That is right
 * for a map, where the subject is the ground and the annotations are
 * labelling it. It is not enough for a frame where the elements ARE the
 * content: a slide whose four parts all appear at once has no sequence, and
 * sequence is most of what makes a presentation readable.
 *
 * ON THE FIELD NAMES. Not `animate`: that is already the flow block, and
 * `drawAnnotations` skips anything carrying it while `drawFlow` claims it.
 * Not `at` either - the format uses `at` for when an annotation appears, in
 * seconds, and writing a position there was how nineteen elements silently
 * drew nothing in the last phase. So `enter` and `exit`, both free, with
 * `delay` and `duration` nested inside where they cannot be mistaken for
 * the `delay` a scene carries.
 *
 * Returns null when a document declares neither, and the caller keeps its
 * existing fade. Nothing already written changes.
 */

export interface Entrance {
  /** Replaces the caller's default window fade. */
  alpha: number
  /** Pixels to shift by while arriving or leaving. */
  dx: number
  dy: number
  /** 0..1 of the label to show, for a typewriter. 1 means all of it. */
  reveal: number
  /**
   * 0..1 through the entrance, whatever its type.
   *
   * Separate from `alpha` because some things grow rather than fade: a bar
   * chart rising from its baseline wants the progress at full opacity, not
   * a half-transparent bar at full height.
   */
  progress: number
}

interface Step {
  type: string
  delay: number
  duration: number
}

const DEFAULT_DURATION = 0.6
const DEFAULT_EXIT = 0.4

/** How far a sliding element travels, as a share of the frame's short side. */
const TRAVEL = 0.045

function stepOf(raw: unknown, fallbackDuration: number): Step | null {
  if (!raw) return null
  if (typeof raw === "string") {
    return { type: raw, delay: 0, duration: fallbackDuration }
  }
  if (typeof raw !== "object") return null
  const block = raw as { type?: unknown; delay?: unknown; duration?: unknown }
  const duration = Number(block.duration)
  return {
    type: typeof block.type === "string" ? block.type : "fade",
    delay: Math.max(0, Number(block.delay) || 0),
    duration: Number.isFinite(duration) && duration > 0 ? duration : fallbackDuration,
  }
}

/** Fast at first and settling at the end, which is how things arrive. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/**
 * Where a sliding element starts, per direction.
 *
 * `rise` comes up from below, so it begins displaced downwards and the
 * offset shrinks to nothing. The others are the same idea turned around.
 */
function offsetFor(type: string, amount: number): { dx: number; dy: number } {
  switch (type) {
    case "rise":
      return { dx: 0, dy: amount }
    case "fall":
      return { dx: 0, dy: -amount }
    case "left":
      return { dx: amount, dy: 0 }
    case "right":
      return { dx: -amount, dy: 0 }
    default:
      return { dx: 0, dy: 0 }
  }
}

export function entranceAt(
  annotation: unknown,
  window_: { start: number; end: number },
  now: number,
  frame: { width: number; height: number }
): Entrance | null {
  const loose = annotation as { enter?: unknown; exit?: unknown } | null
  const enter = stepOf(loose?.enter, DEFAULT_DURATION)
  const exit = stepOf(loose?.exit, DEFAULT_EXIT)
  if (!enter && !exit) return null

  const travel = TRAVEL * Math.min(frame.width, frame.height)
  let alpha = 1
  let dx = 0
  let dy = 0
  let reveal = 1
  let progress = 1

  if (enter) {
    const from = window_.start + enter.delay
    if (now < from) {
      // Declared but not yet due: nothing on screen, and nothing drawn.
      return { alpha: 0, dx: 0, dy: 0, reveal: 0, progress: 0 }
    }
    const t = Math.min(1, (now - from) / enter.duration)
    const eased = easeOut(t)
    progress = eased
    if (enter.type === "typewriter") {
      reveal = eased
    } else {
      alpha = Math.min(alpha, eased)
      const start = offsetFor(enter.type, travel)
      dx += start.dx * (1 - eased)
      dy += start.dy * (1 - eased)
    }
  }

  if (exit) {
    // An exit lands on the end of the window rather than starting from it,
    // so a line that is leaving has finished leaving when its scene does.
    const begins = window_.end - exit.duration - exit.delay
    if (now > begins) {
      const t = Math.min(1, Math.max(0, (now - begins) / exit.duration))
      const eased = easeOut(t)
      alpha = Math.min(alpha, 1 - eased)
      const away = offsetFor(exit.type, travel)
      // Leaving the way it came would read as rewinding, so it continues.
      dx -= away.dx * eased
      dy -= away.dy * eased
    }
  }

  return { alpha: Math.max(0, Math.min(1, alpha)), dx, dy, reveal, progress }
}

/** How much of a label to draw, given a typewriter in progress. */
export function revealText(text: string, reveal: number): string {
  if (reveal >= 1) return text
  if (reveal <= 0) return ""
  return text.slice(0, Math.max(1, Math.round(text.length * reveal)))
}
