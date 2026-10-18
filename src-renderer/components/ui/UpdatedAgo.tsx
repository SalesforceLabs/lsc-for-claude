import React, { useEffect, useState } from "react";
import { updatedAgo } from "./updated-ago";

/** How old a (possibly cached) answer is, kept current while it's on screen. Sits beside a Refresh button. */
export default function UpdatedAgo({ at }: { at: string | null | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [at]);
  const label = at ? updatedAgo(at, now) : "";
  if (!label) return null;
  return (
    <span className="ui-updated" title={new Date(at as string).toLocaleString()}>
      {label}
    </span>
  );
}
