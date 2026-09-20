// Every id an `aria-describedby`, `aria-labelledby` or `aria-controls` names must exist, or the reference is silently
// dropped: the defect the old tooltip had (every target pointed at one id that usually was not in the page). Returns
// what is dangling as "attribute -> id" strings, empty when every reference resolves.
export function danglingAriaReferences(root: ParentNode = document): string[] {
  const dangling: string[] = [];
  for (const attribute of ['aria-describedby', 'aria-labelledby', 'aria-controls']) {
    for (const element of root.querySelectorAll(`[${attribute}]`)) {
      for (const id of (element.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean)) {
        if (!document.getElementById(id)) dangling.push(`${attribute} -> ${id}`);
      }
    }
  }
  return dangling;
}
