// lib/transitions.ts
// Choreography of a track change. One place to tune the sequence:
// gradient starts first, the player content follows, the notification lands last.
export const TRACK_TRANSITION = {
  /** Gradient colour crossfade, in ms. */
  gradientDuration: 1000,
  /** Delay before the player card animates its new content, in ms. */
  playerDelay: 150,
  /** Duration of the player card content animation, in ms. */
  playerDuration: 350,
  /** Delay before the track notification shows, in ms. */
  notificationDelay: 450,
} as const;
