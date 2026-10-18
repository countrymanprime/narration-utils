/** Icons: FontAwesome Free, through one mapping so a screen asks for a meaning ("download"), not a glyph. */
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faArrowsLeftRight, faBook, faCalendarDays, faCheck, faChevronDown, faChevronUp,
  faCircle, faCircleQuestion, faCopy, faDownload, faFileLines, faFont, faGauge, faGear, faHighlighter, faHouse,
  faListUl, faMagnifyingGlass, faMicrophone, faMinus, faMoon, faPen, faPlay, faPlus,
  faRotate, faRotateLeft, faStop, faSun, faTableColumns, faUpload, faWaveSquare, faXmark,
  faVolumeHigh, faArrowRight, faFolderOpen, faScissors, faCircleHalfStroke, faTrashCan, faSliders,
  faBackwardStep, faForwardStep, faMagnifyingGlassPlus, faMagnifyingGlassMinus, faFileImport, faFileExport, faFlag,
  faArrowUpRightFromSquare, faLocationCrosshairs, faComment, faListCheck, faListOl, faUpRightAndDownLeftFromCenter,
  faEarListen, faCaretDown, faThumbtack, faNoteSticky, faCircleCheck, faPause, faArrowLeft,
  faCircleXmark, faTriangleExclamation, faCircleInfo, faLayerGroup, faObjectUngroup, faBroom, faWandMagicSparkles, faGlobe, faBookOpen, faEye, faEyeSlash, faMicrophoneLines, faBookmark, faLock,
} from '@fortawesome/free-solid-svg-icons'
import { faCircle as faCircleRegular, faCircleCheck as faCircleCheckRegular, faNoteSticky as faNoteStickyRegular } from '@fortawesome/free-regular-svg-icons'

export const ICONS = {
  lock: faLock, download: faDownload, upload: faUpload, mic: faMicrophone, pencil: faPen, marker: faHighlighter,
  search: faMagnifyingGlass, x: faXmark, check: faCheck, play: faPlay, font: faFont,
  sidebar: faTableColumns, book: faBook, copy: faCopy, plus: faPlus,
  home: faHouse, calendar: faCalendarDays, script: faFileLines, wave: faWaveSquare, gauge: faGauge, gear: faGear,
  moon: faMoon, sun: faSun, minus: faMinus,
  refresh: faRotate, undo: faRotateLeft, up: faChevronUp, down: faChevronDown, list: faListUl,
  arrowRight: faArrowRight, arrowLeft: faArrowLeft, folder: faFolderOpen, scissors: faScissors, stop: faStop, pause: faPause, record: faCircle,
  trash: faTrashCan, sliders: faSliders, circleHalf: faCircleHalfStroke, circleEmpty: faCircleRegular,
  stepPrev: faBackwardStep, stepNext: faForwardStep, zoomIn: faMagnifyingGlassPlus, zoomOut: faMagnifyingGlassMinus,
  import: faFileImport, export: faFileExport, speaker: faVolumeHigh, flag: faFlag, external: faArrowUpRightFromSquare,
  locate: faLocationCrosshairs, comment: faComment, listCheck: faListCheck, listOl: faListOl, expand: faUpRightAndDownLeftFromCenter,
  listen: faEarListen, caret: faCaretDown, thumbtack: faThumbtack, note: faNoteSticky, noteOff: faNoteStickyRegular,
  doneOff: faCircleCheckRegular, done: faCircleCheck,
  auto: faWandMagicSparkles, globe: faGlobe, dictionary: faBookOpen, show: faEye, hide: faEyeSlash,
  /* Recording levels: a microphone with sound lines. Plain `mic` stays the Booth and recording; `speaker` stays hearing a reference clip. */
  levels: faMicrophoneLines,
  /* A bookmark is a ribbon. */
  bookmark: faBookmark,
  /* Verdicts and information. */
  notReady: faCircleXmark, alert: faTriangleExclamation, info: faCircleInfo, unknown: faCircleQuestion,
  /* Retries: stack them on the first read, put one back where it was recorded, clean up the reads that were not kept. */
  stack: faLayerGroup, unstack: faObjectUngroup, cleanup: faBroom,
} satisfies Record<string, IconDefinition>

export type IconName = keyof typeof ICONS

/** An icon by a name that comes from data (a source list); an unknown name falls back to a neutral glyph. */
export const iconNamed = (name: string): IconName => (name in ICONS ? (name as IconName) : 'list')

export function Icon({ name, flip }: { name: IconName; flip?: boolean }) {
  return <FontAwesomeIcon icon={ICONS[name]} fixedWidth flip={flip ? 'horizontal' : undefined} aria-hidden="true" />
}
