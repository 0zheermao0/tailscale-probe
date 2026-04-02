/**
 * Shared search + sort utilities for headscale admin tables.
 *
 * Usage:
 *   const state = makeTableState(items, columns);
 *   // render search input + sortable headers using state
 *   // on search input: state.query = value; rerenderFn()
 *   // on header click: sortBy(state, col); rerenderFn()
 */

export interface SortState {
  col: string;
  dir: 'asc' | 'desc';
}

export interface TableState<T> {
  all: T[];
  query: string;
  sort: SortState;
  /** Returns filtered + sorted subset */
  view(): T[];
}

/**
 * Create a reactive table state.
 * @param items  Full data array
 * @param sortCol  Initial sort column key
 * @param getField  Extract a sortable string/number value from an item by column key
 */
export function makeTableState<T>(
  items: T[],
  sortCol: string,
  getField: (item: T, col: string) => string | number
): TableState<T> {
  const state: TableState<T> = {
    all: items,
    query: '',
    sort: { col: sortCol, dir: 'asc' },
    view() {
      let result = state.all;

      // Fuzzy search: match query against all fields
      const q = state.query.trim().toLowerCase();
      if (q) {
        result = result.filter(item => {
          // Stringify all field values and check if any contains the query
          const text = Object.values(item as Record<string, unknown>)
            .map(v => {
              if (v === null || v === undefined) return '';
              if (typeof v === 'object') return JSON.stringify(v);
              return String(v);
            })
            .join(' ')
            .toLowerCase();
          return text.includes(q);
        });
      }

      // Sort
      const { col, dir } = state.sort;
      result = [...result].sort((a, b) => {
        const av = getField(a, col);
        const bv = getField(b, col);
        let cmp = 0;
        if (typeof av === 'number' && typeof bv === 'number') {
          cmp = av - bv;
        } else {
          cmp = String(av).localeCompare(String(bv));
        }
        return dir === 'asc' ? cmp : -cmp;
      });

      return result;
    },
  };
  return state;
}

/** Toggle sort: same col → flip dir; new col → asc */
export function sortBy<T>(state: TableState<T>, col: string): void {
  if (state.sort.col === col) {
    state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sort = { col, dir: 'asc' };
  }
}

/** Render a <th> with sort indicator and data-col attribute */
export function sortTh(label: string, col: string, state: TableState<unknown>): string {
  const active = state.sort.col === col;
  const arrow = active ? (state.sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
  return `<th class="hs-sortable-th${active ? ' hs-th-active' : ''}" data-col="${col}" style="cursor:pointer;user-select:none">${label}${arrow}</th>`;
}

/** Render a search input HTML string */
export function searchInput(placeholder = 'Search…'): string {
  return `<input class="hs-search-input" type="search" placeholder="${placeholder}"
    style="background:rgba(0,0,0,.25);border:1px solid var(--border);border-radius:var(--radius-sm);
           color:var(--text-primary);font-size:12px;padding:4px 10px;width:180px;outline:none;"
    autocomplete="off" />`;
}

/**
 * Wire the search input (called ONCE after initial render).
 * The input element persists across re-renders, so this must not be called again.
 */
export function wireSearch<T>(
  container: HTMLElement,
  state: TableState<T>,
  rerender: () => void
): void {
  const input = container.querySelector<HTMLInputElement>('.hs-search-input');
  if (!input) return;
  input.value = state.query;
  input.addEventListener('input', () => {
    state.query = input.value;
    rerender();
  });
}

/**
 * Wire sortable table headers (called after EACH re-render because thead is rebuilt).
 * Safe to call repeatedly — headers are new DOM nodes each time.
 */
export function wireSortHeaders<T>(
  tableWrap: HTMLElement,
  state: TableState<T>,
  rerender: () => void
): void {
  tableWrap.querySelectorAll<HTMLElement>('.hs-sortable-th').forEach(th => {
    th.addEventListener('click', () => {
      sortBy(state, th.dataset.col!);
      rerender();
    });
  });
}
