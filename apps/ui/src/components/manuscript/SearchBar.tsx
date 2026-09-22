import { SearchField } from '../primitives/SearchField';

export function SearchBar({
  query,
  onQueryChange,
  autoFocus = false,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  // Focuses the input as soon as the Chapters & Search panel opens (R8), so typing can start
  // immediately without a click.
  autoFocus?: boolean;
}) {
  return (
    <div>
      <SearchField label="Search manuscript" value={query} onChange={onQueryChange} placeholder="Search manuscript…" autoFocus={autoFocus} />
    </div>
  );
}
