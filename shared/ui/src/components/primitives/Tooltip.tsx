import { createContext, isValidElement, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type ActiveTooltip = { text: string; rect: DOMRect; key: number };
type TooltipController = { show: (text: string, rect: DOMRect) => void; hide: () => void };
const TooltipContext = createContext<TooltipController | undefined>(undefined);

function TooltipPortal({ active }: { active?: ActiveTooltip }) {
  if (!active) return null;
  const width = 240;
  const left = Math.min(Math.max(8, active.rect.left + active.rect.width / 2 - width / 2), Math.max(8, window.innerWidth - width - 8));
  const canFitAbove = active.rect.top > 54;
  const top = canFitAbove ? active.rect.top - 10 : active.rect.bottom + 10;
  return createPortal(
    <span
      id="tooltip-layer"
      className="pointer-events-none fixed z-[1000] w-max max-w-60 translate-y-1 animate-[tooltip-in_0.12s_ease] rounded-[0.4rem] bg-[var(--text)] px-[0.65rem] py-2 text-[0.78rem] leading-[1.35] text-[var(--bg)] shadow-[var(--shadow-lg)]"
      role="tooltip"
      style={{ left, top, transform: canFitAbove ? 'translateY(-100%)' : undefined }}
    >
      {active.text}
    </span>,
    document.body,
  );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveTooltip>();
  const controller = useMemo<TooltipController>(
    () => ({
      show: (text, rect) => setActive({ text, rect, key: Date.now() }),
      hide: () => setActive(undefined),
    }),
    [],
  );
  return (
    <TooltipContext.Provider value={controller}>
      {children}
      <TooltipPortal active={active} />
    </TooltipContext.Provider>
  );
}

export function TooltipTarget({ text, children, className = '', style }: { text: string; children: ReactNode; className?: string; style?: CSSProperties }) {
  const shared = useContext(TooltipContext);
  const [local, setLocal] = useState<ActiveTooltip>();
  const isActiveRef = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const disabledChild = isValidElement(children) && Boolean((children.props as { disabled?: boolean }).disabled);
  const show = (rect: DOMRect) => {
    isActiveRef.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!isActiveRef.current) return;
      if (shared) shared.show(text, rect);
      else setLocal({ text, rect, key: Date.now() });
    }, 1000);
  };
  const hide = () => {
    isActiveRef.current = false;
    window.clearTimeout(timer.current);
    if (shared) shared.hide();
    else setLocal(undefined);
  };
  const showImmediately = (rect: DOMRect) => {
    isActiveRef.current = true;
    window.clearTimeout(timer.current);
    if (shared) shared.show(text, rect);
    else setLocal({ text, rect, key: Date.now() });
  };
  useEffect(
    () => () => {
      // If this target is unmounted (e.g. a click navigates away) while its
      // tooltip is showing, no mouseleave/blur ever fires to hide it - clear
      // it explicitly so it doesn't stay stuck on the next page.
      window.clearTimeout(timer.current);
      if (isActiveRef.current) hide();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- must run only on unmount; hide() reads isActiveRef, not stale state
    [],
  );
  return (
    <span
      className={`inline-flex ${className}`}
      style={style}
      tabIndex={disabledChild ? 0 : undefined}
      aria-describedby={shared || local ? 'tooltip-layer' : undefined}
      onMouseEnter={(e) => show(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={hide}
      onFocus={(e) => showImmediately(e.currentTarget.getBoundingClientRect())}
      onBlur={hide}
    >
      {children}
      {!shared && <TooltipPortal active={local} />}
    </span>
  );
}

export function Tooltip({ text }: { text: string }) {
  return (
    <TooltipTarget text={text} className="ml-1">
      <span
        aria-label="More information"
        className="inline-flex h-[15px] w-[15px] cursor-help items-center justify-center rounded-full border border-[var(--text-faint)] font-['IBM_Plex_Mono',monospace] text-[0.68rem] text-[var(--text-faint)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        i
      </span>
    </TooltipTarget>
  );
}
