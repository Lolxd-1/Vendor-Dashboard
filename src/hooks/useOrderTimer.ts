import { useState, useEffect } from "react";

export const useOrderTimer = (startTime: string | undefined, type: "UP" | "DOWN", durationMinutes: number = 0) => {
  const [displayTime, setDisplayTime] = useState("--:--");

  useEffect(() => {
    if (!startTime) {
       setDisplayTime("--:--");
       return;
    }

    // ─── SMART DATE PARSER ───
    // moveToAccepted / moveToReady store UTC ISO strings (with Z) in sessionStorage.
    // Those are always used first, so we only reach this with backend timestamps as
    // a last-resort fallback. Just normalise the space separator; browser will use
    // the OS/browser locale for timezone, which is fine for the fallback path.
    let startTimestamp: number;
    if (typeof startTime === 'string') {
        if (/^\d+$/.test(startTime)) {
            startTimestamp = Number(startTime); // Unix ms timestamp
        } else {
            const safeTimeStr = startTime.replace(" ", "T");
            startTimestamp = new Date(safeTimeStr).getTime();
        }
    } else {
        startTimestamp = new Date(startTime).getTime();
    }

    if (isNaN(startTimestamp)) {
        setDisplayTime("--:--");
        return;
    }

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

    const calculateTime = () => {
      const now = Date.now();
      
      if (type === "UP") {
        // UP TIMER (Starts from 0, goes up)
        const diffInSeconds = Math.max(0, Math.floor((now - startTimestamp) / 1000));
        setDisplayTime(formatTime(diffInSeconds));
      } 
      else if (type === "DOWN") {
        // DOWN TIMER (Reverse timer based on prep time)
        const targetTimestamp = startTimestamp + (durationMinutes * 60 * 1000);
        const diffInSeconds = Math.floor((targetTimestamp - now) / 1000);
        
        if (diffInSeconds <= 0) {
          setDisplayTime("00:00"); // Stops exactly at 0
        } else {
          setDisplayTime(formatTime(diffInSeconds));
        }
      }
    };

    calculateTime(); // Immediate call to avoid flicker
    const intervalId = setInterval(calculateTime, 1000);

    return () => clearInterval(intervalId);
  }, [startTime, type, durationMinutes]);

  return { displayTime };
};