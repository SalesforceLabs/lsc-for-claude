import React, { useState } from "react";

/** Rows drawn before "Show more" — enough to scan, few enough that a 5,000-row list stays fast. */
export const LIST_LIMIT = 200;

interface Props<T> {
  items: readonly T[];
  render: (item: T, index: number) => React.ReactNode;
  limit?: number;
  /** Wrapper for the button: `li` inside a `ul`, `div` elsewhere. */
  as?: "li" | "div";
}

/**
 * Draws the first `limit` items and a "Show more" button for the rest. Keeps the DOM small
 * for lists that can hold thousands of rows without hiding any of them.
 */
export function Limited<T>({ items, render, limit = LIST_LIMIT, as: Wrap = "div" }: Props<T>) {
  const [shown, setShown] = useState(limit);
  const hidden = items.length - shown;
  return (
    <>
      {items.slice(0, shown).map(render)}
      {hidden > 0 && (
        <Wrap className="ui-show-more">
          <button type="button" className="studio-link-btn" onClick={() => setShown((n) => n + limit)}>
            Show {Math.min(hidden, limit).toLocaleString("en-US")} more
            <span className="ui-show-more-total"> ({hidden.toLocaleString("en-US")} hidden)</span>
          </button>
        </Wrap>
      )}
    </>
  );
}
