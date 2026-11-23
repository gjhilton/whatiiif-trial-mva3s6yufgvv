// How the picture moves: for a visitor whose computer is set to reduce motion, straight to where it is sent, rather
// than gliding there, in OpenSeadragon on its own, in the notes helper, and inside Mirador. Nothing here imports a
// viewer, so either viewer's bundle can use it.

/** OpenSeadragon's options for how the picture moves: no time to get anywhere, if motion is to be reduced. */
export const motion = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? { animationTime: 0 } : {});
