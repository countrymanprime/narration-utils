// Whether the last thing the user did was press a key, as opposed to pointing. Focus that arrives by keyboard shows a hint
// at once; focus that follows a mouse click does not (the pointer already told the user what they clicked). `:focus-visible`
// answers the same question but its state is engine-specific, so this tracks the two kinds of input directly. It starts as
// keyboard, like a page that has had no input yet.
let keyboard = true;

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', () => (keyboard = true), true);
  for (const type of ['pointerdown', 'mousedown', 'touchstart']) document.addEventListener(type, () => (keyboard = false), true);
}

export const lastInputWasKeyboard = (): boolean => keyboard;
