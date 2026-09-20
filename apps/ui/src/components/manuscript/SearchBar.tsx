export function SearchBar({ query, onQueryChange }: { query: string; onQueryChange: (value: string) => void }) {
  return (
    <div>
      <label className="sr-only" htmlFor="manuscript-search">
        Search manuscript
      </label>
      <input
        id="manuscript-search"
        className="min-h-[var(--control-height)] w-full rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-[0.6rem] text-[0.88rem] leading-[1.35] text-[var(--text)] focus:outline-2 focus:outline-offset-1 focus:outline-[var(--accent)]"
        type="text"
        placeholder="Search manuscript…"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
    </div>
  );
}
