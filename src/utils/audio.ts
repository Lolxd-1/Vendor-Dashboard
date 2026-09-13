// Legacy wrapper — kept so old imports don't break.
// New code should import from "./order-alert" directly (Web Audio engine,
// GUIDE.md Layer 1). The old <audio>-element approach is retained only as a
// fallback for very old browsers.
import * as Alert from "./order-alert";

// Shared <audio> fallback instance (loop until acknowledged).
export const notificationAudio = new Audio("/Alert_ringtone.mp3");

// Pre-configure it
notificationAudio.loop = true;
notificationAudio.preload = "auto";
notificationAudio.volume = 1; // ensure audible

/**
 * Unlock audio. Prefers the Web Audio engine (sticky-activation safe);
 * falls back to the legacy play-then-pause trick.
 * MUST be called synchronously from a user gesture handler.
 */
export const unlockAudio = async () => {
  try {
    const armed = await Alert.arm();
    if (armed) {
      console.log("✅ Audio Unlocked Successfully (Web Audio)");
      return true;
    }
  } catch (error) {
    console.error("Web Audio arm failed, trying legacy element:", error);
  }
  try {
    await notificationAudio.play();
    notificationAudio.pause();
    notificationAudio.currentTime = 0;
    console.log("✅ Audio Unlocked Successfully (legacy element)");
    return true;
  } catch (error) {
    console.error("❌ Audio Unlock Failed:", error);
    return false;
  }
};
