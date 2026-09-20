import { SearchField } from '../primitives/SearchField';

export function SearchBar({ query, onQueryChange }: { query: string; onQueryChange: (value: string) => void }) {
  return (
    <div>
      <SearchField label="Search manuscript" value={query} onChange={onQueryChange} placeholder="Search manuscript…" />
    </div>
  );
}
