import { useState, useEffect } from "react";

// ─── SMART DATE PARSER ───
// moveToAccepted / moveToReady store UTC ISO strings (with Z) in sessionStorage.
// Those are always used first, so we only reach this with backend timestamps as
// a last-resort fallback. Just normalise the space separator; browser will use
// the OS/browser locale for timezone, which is fine for the fallback path.
// NaN when missing or unreadable.
const parseStartTime = (startTime: string | undefined): number => {
  if (!startTime) return NaN;
  if (typeof startTime === 'string') {
      if (/^\d+$/.test(startTime)) {
          return Number(startTime); // Unix ms timestamp
      }
      const safeTimeStr = startTime.replace(" ", "T");
      return new Date(safeTimeStr).getTime();
  }
  return new Date(startTime).getTime();
};

const formatTime = (totalSeconds: number) => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  } else {
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
};

const calculateTime = (startTimestamp: number, type: "UP" | "DOWN", durationMinutes: number, now: number) => {
  if (type === "UP") {
    // UP TIMER (Starts from 0, goes up)
    const diffInSeconds = Math.max(0, Math.floor((now - startTimestamp) / 1000));
    return formatTime(diffInSeconds);
  }
  // DOWN TIMER (Reverse timer based on prep time)
  const targetTimestamp = startTimestamp + (durationMinutes * 60 * 1000);
  const diffInSeconds = Math.floor((targetTimestamp - now) / 1000);
  return diffInSeconds <= 0 ? "00:00" : formatTime(diffInSeconds); // Stops exactly at 0
};

export const useOrderTimer = (startTime: string | undefined, type: "UP" | "DOWN", durationMinutes: number = 0) => {
  const startTimestamp = parseStartTime(startTime);
  const valid = !isNaN(startTimestamp);
  // Computed on the first render too, so the card never flashes "--:--".
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!valid) return;
    const intervalId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, [valid, startTimestamp, type, durationMinutes]);

  const displayTime = valid ? calculateTime(startTimestamp, type, durationMinutes, now) : "--:--";
  return { displayTime };
};
