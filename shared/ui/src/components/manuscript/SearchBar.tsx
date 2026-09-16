export function SearchBar({ query, onQueryChange }: { query: string; onQueryChange: (value: string) => void }) {
  return (
    <div>
      <label className="sr-only" htmlFor="manuscript-search">
        Search manuscript
      </label>
      <input
        id="manuscript-search"
        className="input"
        type="text"
        placeholder="Search manuscript…"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
    </div>
  );
}
