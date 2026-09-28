import { useId, type ReactNode } from 'react';
import { PANEL_BODY_CLASS, PANEL_CAPS_TITLE_CLASS, PANEL_FRAME_CLASS, PANEL_HEADER_CLASS, PANEL_SUBTITLE_CLASS, PANEL_TITLE_CLASS } from './panelStyles';

type PanelTitleStyle = 'card' | 'caps';

type PanelLook = {
  children: ReactNode;
  // The body has no padding, so a table (or a list of rows) runs to the card's edges under the header's divider.
  flush?: boolean;
  // The body scrolls inside the height the caller gives the panel (through `className`), under a header that stays put.
  scroll?: boolean;
  // A panel asking for the narrator's attention: its frame takes the review colour.
  tone?: 'review';
  // Layout only (width, flex, margin): the look is the panel's own.
  className?: string;
};

// `titleStyle="caps"` is the dark Settings mocks' category title. `subtitle`, `leading` and `actions` sit in the header
// row, so they need a title. A bare panel may still be named by `label` when a visible title would repeat what is already
// on screen.
type PanelProps = PanelLook &
  (
    | { title?: undefined; titleStyle?: undefined; subtitle?: undefined; leading?: undefined; actions?: undefined; label?: string }
    | { title: string; titleStyle?: PanelTitleStyle; subtitle?: ReactNode; leading?: ReactNode; actions?: ReactNode; label?: undefined }
  );

// A card around a group of content (ADR 0058, the look ADR 0640). With a `title` it is a named region: the title is a
// level-2 heading (a panel sits beneath the page's level-1 heading) in a header row with a divider under it, and the
// section is labelled by it, so a screen reader can list and jump to it. Without one it is the bare card.
export function Panel({ title, titleStyle, subtitle, leading, actions, label, flush = false, scroll = false, tone, className = '', children }: PanelProps) {
  const titleId = useId();
  const layout = scroll ? 'flex flex-col overflow-hidden' : '';
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : label}
      className={`${PANEL_FRAME_CLASS} ${layout} ${className}`}
      style={tone === 'review' ? { borderColor: 'var(--review)' } : undefined}
    >
      {title && <PanelHeader title={title} titleId={titleId} titleStyle={titleStyle} subtitle={subtitle} leading={leading} actions={actions} />}
      <div
        className={`${flush ? '[--panel-pad:0px]' : PANEL_BODY_CLASS} ${scroll ? 'min-h-0 flex-1 overflow-y-auto' : ''}`}
        // A scrolling body is a tab stop, so the keyboard can scroll it when nothing inside it takes focus.
        {...(scroll ? { tabIndex: 0, role: 'group', 'aria-labelledby': title ? titleId : undefined, 'aria-label': title ? undefined : label } : {})}
      >
        {children}
      </div>
    </section>
  );
}

// The header row on its own, for a card that is not a `section` of its own (a TabPanel drawn as a card): the title, the
// subtitle on its line, whatever leads it (a category dot) and the actions at the right, over a divider. The caller
// names its surface by `titleId`.
export function PanelHeader({
  title,
  titleId,
  titleStyle = 'card',
  subtitle,
  leading,
  actions,
}: {
  title: string;
  titleId?: string;
  titleStyle?: PanelTitleStyle;
  subtitle?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={PANEL_HEADER_CLASS}>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5 gap-y-1">
        {leading && <span className="flex items-center gap-2 self-center">{leading}</span>}
        <h2 id={titleId} className={titleStyle === 'caps' ? PANEL_CAPS_TITLE_CLASS : PANEL_TITLE_CLASS}>
          {title}
        </h2>
        {subtitle && <div className={PANEL_SUBTITLE_CLASS}>{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
