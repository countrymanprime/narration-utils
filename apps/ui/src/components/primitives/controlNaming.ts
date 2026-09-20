// Every form control has a name a screen reader can say: `label` (written as an aria-label) or an `id` that a visible
// `<label htmlFor>` points at. The type asks for one of the two, so a control cannot be written with neither. A control that
// has its own visible label, hint and error is a `Field`.
export type ControlNaming = { label: string; id?: string } | { label?: undefined; id: string };
