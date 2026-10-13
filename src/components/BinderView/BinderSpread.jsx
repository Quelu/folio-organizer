import { useCallback, useEffect, useState } from 'react';
import { motion, animate, useMotionValue, useTransform, useReducedMotion } from 'motion/react';
import { getSpread, getSpreadPages } from '../../utils/calculations';
import { PageHeader, PagePanel, CoverPanel } from './PageGrid';

const TURN_DURATION = 0.9;
const TURN_EASE = [0.42, 0.05, 0.22, 1];
const GHOST_STAGGER = 0.09;
const MAX_GHOSTS = 3;

/** Blank sheet used for the extra leaves flicking past when jumping several pages. */
const BlankPanel = () => <div className="binder-page h-full rounded-2xl" />;

/**
 * One turning leaf, driven by a single angle: 0deg lies on the right, -180deg on the left.
 *
 * The two sides are separate flat elements, each with its own perspective, instead of two faces
 * in a preserve-3d box: Safari flattens that box as soon as the pages inside have their own
 * transforms, which hides the landing side. Here the front (right page) swings from 0 to -90deg
 * around the spine, then the back (new left page) swings from 90 to 0deg on the left side.
 */
const Leaf = ({ id, from, to, delay = 0, front, back, single, zIndex, onDone }) => {
  const rotate = useMotionValue(from);

  useEffect(() => {
    const controls = animate(rotate, to, { duration: TURN_DURATION, ease: TURN_EASE, delay });
    controls.then(() => onDone?.(id));
    return () => controls.stop();
  }, [rotate, to, delay, id, onDone]);

  const frontAngle = useTransform(rotate, (r) => Math.max(r, -90));
  const backAngle = useTransform(rotate, (r) => Math.min(r + 180, 90));
  const frontVisibility = useTransform(rotate, (r) => (r > -90 ? 'visible' : 'hidden'));
  const backVisibility = useTransform(rotate, (r) => (r <= -90 ? 'visible' : 'hidden'));
  // The sheet lifts toward the viewer mid-turn, with a soft shadow under it
  const lift = useTransform(rotate, [0, -90, -180], [0, 70, 0]);
  const liftShadow = useTransform(
    rotate,
    [0, -90, -180],
    ['0 0 0 rgba(0,0,0,0)', '0 30px 60px rgba(0,0,0,0.55)', '0 0 0 rgba(0,0,0,0)']
  );
  // Light and shade follow the angle: darker as the sheet stands up, a gloss sweeping across it
  const frontShade = useTransform(rotate, [0, -90], [0, 0.6]);
  const backShade = useTransform(rotate, [-90, -180], [0.6, 0]);
  const gloss = useTransform(rotate, [0, -40, -90, -140, -180], [0, 0.22, 0, 0.18, 0]);
  // Shadow cast on the page underneath, on whichever side the sheet hangs over
  const rightCast = useTransform(rotate, [0, -25, -90], [0, 0.75, 0]);
  const leftCast = useTransform(rotate, [-90, -155, -180], [0, 0.6, 0]);

  const side = (content, { angle, visibility, originX, shade, shadeDir, glossDir, pad }) => (
    <motion.div
      className={`absolute inset-y-0 ${pad}`}
      style={{
        left: originX === 0 ? 0 : undefined,
        right: originX === 1 ? (single ? 0 : 'calc(100% + 0px)') : undefined,
        width: '100%',
        rotateY: angle,
        z: lift,
        originX,
        transformPerspective: 1800,
        visibility,
      }}
    >
      <motion.div className="relative h-full rounded-2xl" style={{ boxShadow: liftShadow }}>
        {content}
        <motion.div
          className={`absolute inset-0 rounded-2xl ${shadeDir} from-black/90 to-black/40`}
          style={{ opacity: shade }}
        />
        <motion.div
          className={`absolute inset-0 rounded-2xl ${glossDir} from-white via-transparent to-transparent mix-blend-overlay`}
          style={{ opacity: gloss }}
        />
      </motion.div>
    </motion.div>
  );

  return (
    <div
      className="pointer-events-none absolute inset-y-0 left-1/2 w-1/2 data-[single=true]:left-0 data-[single=true]:w-full"
      data-leaf
      data-single={Boolean(single)}
      style={{ zIndex }}
    >
      <motion.div
        aria-hidden
        className="absolute inset-0 rounded-2xl bg-gradient-to-r from-black to-transparent"
        style={{ opacity: rightCast, left: single ? 0 : '1rem' }}
      />
      {!single && (
        <motion.div
          aria-hidden
          className="absolute inset-y-0 w-full rounded-2xl bg-gradient-to-l from-black to-transparent"
          style={{ opacity: leftCast, right: 'calc(100% + 1rem)' }}
        />
      )}

      {/* Front: the page lying on the right, hinged on its left edge (the spine) */}
      {side(front, {
        angle: frontAngle,
        visibility: frontVisibility,
        originX: 0,
        shade: frontShade,
        shadeDir: 'bg-gradient-to-l',
        glossDir: 'bg-gradient-to-r',
        pad: single ? '' : 'pl-4',
      })}
      {/* Back: the new left page, hinged on its right edge (the spine) */}
      {!single &&
        side(back, {
          angle: backAngle,
          visibility: backVisibility,
          originX: 1,
          shade: backShade,
          shadeDir: 'bg-gradient-to-r',
          glossDir: 'bg-gradient-to-l',
          pad: 'pr-4',
        })}
    </div>
  );
};

/** Turning sheets for one navigation: extra blank leaves when jumping, then the real one. */
const TurningLeaves = ({ turn, front, back, single, onDone }) => {
  const forward = turn.dir > 0;
  // Single view has no left page: the sheet only swings up to the vertical and disappears
  const far = single ? -90 : -180;
  const from = forward ? 0 : far;
  const to = forward ? far : 0;
  const ghosts = Math.min(turn.steps - 1, MAX_GHOSTS);

  return (
    <>
      {Array.from({ length: ghosts }, (_, i) => (
        <Leaf
          key={i}
          from={from}
          to={to}
          delay={i * GHOST_STAGGER}
          front={<BlankPanel />}
          back={<BlankPanel />}
          single={single}
          zIndex={10 + i}
        />
      ))}
      <Leaf
        id={turn.id}
        from={from}
        to={to}
        delay={ghosts * GHOST_STAGGER}
        front={front}
        back={back}
        single={single}
        zIndex={20}
        onDone={onDone}
      />
    </>
  );
};

const Rings = () => (
  <div className="relative z-30 flex flex-col justify-center items-center gap-10">
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        className="w-5 h-2.5 rounded-full bg-gradient-to-b from-slate-300 via-slate-500 to-slate-700 shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),0_2px_4px_rgba(0,0,0,0.5)]"
      />
    ))}
  </div>
);

const FadeIn = ({ children, k, delay = 0 }) => (
  <motion.div key={k} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35, delay }}>
    {children}
  </motion.div>
);

/** Time until the last leaf of a turn lands, so the label on that side changes with it. */
const landingDelay = (turn) =>
  turn ? Math.min(turn.steps - 1, MAX_GHOSTS) * GHOST_STAGGER + TURN_DURATION * 0.75 : 0;

/**
 * Shows either a single page or the open-binder spread (verso on the left, recto on the right),
 * and turns the sheets like a real binder when navigating.
 */
const BinderSpread = ({ binder, page, spreadMode, ...gridProps }) => {
  const reduceMotion = useReducedMotion();
  const viewKey = spreadMode ? getSpread(page) : page;

  // What is displayed vs. what is asked: a change of spread (or page in single view) starts a turn
  const [shown, setShown] = useState({ key: viewKey, page, spreadMode });
  const [turn, setTurn] = useState(null); // { id, fromPage, toPage, dir, steps }

  if (shown.key !== viewKey || shown.spreadMode !== spreadMode) {
    setShown({ key: viewKey, page, spreadMode });
    if (shown.spreadMode !== spreadMode || reduceMotion) {
      setTurn(null);
    } else {
      // A turn already running is snapped to its end before the next one starts
      const fromPage = turn ? turn.toPage : shown.page;
      const fromKey = spreadMode ? getSpread(fromPage) : fromPage;
      setTurn({
        id: (turn?.id ?? 0) + 1,
        fromPage,
        toPage: page,
        dir: viewKey > fromKey ? 1 : -1,
        steps: Math.abs(viewKey - fromKey),
      });
    }
  }

  const finishTurn = useCallback((id) => setTurn((t) => (t?.id === id ? null : t)), []);

  const panel = (p) =>
    p ? <PagePanel binder={binder} page={p} compact={spreadMode} {...gridProps} /> : <CoverPanel />;

  if (!spreadMode) {
    const forward = turn?.dir > 0;
    // Forward: the old page lifts off and reveals the new one. Backward: the new page comes back over.
    const under = turn ? (forward ? turn.toPage : turn.fromPage) : page;
    const leafPage = turn ? (forward ? turn.fromPage : turn.toPage) : null;
    return (
      <div style={{ perspective: 2000 }}>
        <FadeIn k={page} delay={turn?.dir < 0 ? landingDelay(turn) : 0}>
          <PageHeader binder={binder} page={page} />
        </FadeIn>
        <div className="relative">
          {panel(under)}
          {turn && (
            <TurningLeaves
              key={turn.id}
              turn={turn}
              front={panel(leafPage)}
              back={<BlankPanel />}
              single
              onDone={finishTurn}
            />
          )}
        </div>
      </div>
    );
  }

  const [left, right] = getSpreadPages(getSpread(page));
  let underLeft = left;
  let underRight = right;
  let leafFront = null;
  let leafBack = null;
  if (turn) {
    const [fromLeft, fromRight] = getSpreadPages(getSpread(turn.fromPage));
    const [toLeft, toRight] = getSpreadPages(getSpread(turn.toPage));
    if (turn.dir > 0) {
      // The right page of the old spread turns over and becomes the left page of the new one
      underLeft = fromLeft;
      underRight = toRight;
      leafFront = fromRight;
      leafBack = toLeft;
    } else {
      underLeft = toLeft;
      underRight = fromRight;
      leafFront = toRight;
      leafBack = fromLeft;
    }
  }

  return (
    <div style={{ perspective: 2400 }}>
      <div className="grid grid-cols-[1fr_2rem_1fr]">
        <div className="min-w-0">
          {left ? (
            <FadeIn k={left} delay={turn?.dir > 0 ? landingDelay(turn) : 0}>
              <PageHeader binder={binder} page={left} />
            </FadeIn>
          ) : (
            <div className="h-[34px]" />
          )}
        </div>
        <div />
        <div className="min-w-0">
          <FadeIn k={right} delay={turn?.dir < 0 ? landingDelay(turn) : 0}>
            <PageHeader binder={binder} page={right} />
          </FadeIn>
        </div>
      </div>

      <div className="relative grid grid-cols-[1fr_2rem_1fr]">
        <div className="min-w-0">{panel(underLeft)}</div>
        <Rings />
        <div className="min-w-0">{panel(underRight)}</div>
        {turn && (
          <TurningLeaves
            key={turn.id}
            turn={turn}
            front={panel(leafFront)}
            back={panel(leafBack)}
            onDone={finishTurn}
          />
        )}
      </div>
    </div>
  );
};

export default BinderSpread;
