import { useEffect, useState } from "react";
import * as Alert from "../utils/order-alert";
import type { AlertState } from "../utils/order-alert";

/**
 * Sound status chip (GUIDE.md §3.6). Always visible in the header.
 * Green "Sound on" when armed, loud red "Sound off — click here to fix" otherwise.
 * Clicking the broken state re-arms. Includes a "Test sound" action.
 */
const SoundStatusChip = () => {
  const [state, setState] = useState<AlertState>(() => Alert.getState());
  const [testing, setTesting] = useState(false);

  useEffect(() => Alert.subscribe(setState), []);

  const handleFix = () => {
    // Called from a real click → valid gesture for arm().
    void Alert.arm();
  };

  const handleTest = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (testing) return;
    setTesting(true);
    await Alert.selfTest();
    setTesting(false);
  };

  if (state.armed) {
    return (
      <div className="flex items-center gap-1.5">
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20"
          title={`AudioContext: ${state.contextState} — alerts will ring`}
        >
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-black text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
            Sound on
          </span>
        </div>
        <button
          onClick={handleTest}
          disabled={testing}
          className="text-[10px] font-bold text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-100 underline underline-offset-2 disabled:opacity-50"
          title="Play a short test ring"
        >
          {testing ? "Testing…" : "Test sound"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={handleFix}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600 border border-red-600 text-white shadow-md hover:bg-red-700 transition-colors"
        style={{ animation: "sound-chip-pulse 1.2s ease-in-out infinite" }}
        title={`Audio blocked (AudioContext: ${state.contextState}). Click to fix.`}
      >
        <span className="text-xs">🔔</span>
        <span className="text-[10px] font-black uppercase tracking-wider">
          Sound off — click here to fix
        </span>
      </button>
      <style>{`
        @keyframes sound-chip-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
};

export default SoundStatusChip;
