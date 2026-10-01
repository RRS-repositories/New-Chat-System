type Props = {
  query: string;
  onQuery: (value: string) => void;
  role: string;
  onRole: (value: string) => void;
  roles: string[];
};

/** Search box and role picker used above both admin people tables. */
export function PeopleFilters({ query, onQuery, role, onRole, roles }: Props) {
  return (
    <div className="admin-filters">
      <input
        className="admin-search"
        type="search"
        placeholder="Search people"
        aria-label="Search people"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <select aria-label="Role" value={role} onChange={(e) => onRole(e.target.value)}>
        <option value="">All roles</option>
        {roles.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </div>
  );
}
