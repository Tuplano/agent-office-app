import { useEffect, useState } from 'react';

// The time, told again every `everyMs`, for text that ages: "idle for 4m".
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const ticking = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(ticking);
  }, [everyMs]);
  return now;
}
