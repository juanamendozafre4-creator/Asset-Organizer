import { useEffect, useRef, useState } from "react";
import type { NetflixCode } from "@workspace/api-client-react";

const DEFAULT_WELCOME_MESSAGE =
  "Elige el código que sea los datos de tu dispositivo y tu perfil y ponlo en tu dispositivo para seguir disfrutando de Netflix";

const DEFAULT_NEW_CODE_MESSAGE =
  "Llegó un código nuevo, verifica que sean los datos de tu dispositivo y tu perfil y ponlo en tu dispositivo para seguir disfrutando de Netflix";

const CODE_TTL_MS = 15 * 60 * 1000;

const speechSupported =
  typeof window !== "undefined" && "speechSynthesis" in window;

function isExpired(receivedAt: string) {
  return Date.now() - new Date(receivedAt).getTime() > CODE_TTL_MS;
}

export interface SpeechConfig {
  welcomeMessage?: string | null;
  newCodeMessage?: string | null;
  /** Repeat interval in seconds. null / 0 = no repeat. */
  repeatInterval?: number | null;
}

export function useSpeechNotification(codes: NetflixCode[], config?: SpeechConfig) {
  const unlockedRef      = useRef(false);   // audio context unlocked by browser
  const hasInteractedRef = useRef(false);   // user has touched/clicked/moved mouse
  const isSpeakingRef    = useRef(false);   // speech is currently playing
  const prevTopIdRef     = useRef<string | null>(null);
  const [needsUnlock, setNeedsUnlock] = useState(false);

  // Always reference latest config text via refs (avoids stale closures)
  const welcomeTextRef  = useRef(DEFAULT_WELCOME_MESSAGE);
  const newCodeTextRef  = useRef(DEFAULT_NEW_CODE_MESSAGE);
  welcomeTextRef.current  = config?.welcomeMessage?.trim()  || DEFAULT_WELCOME_MESSAGE;
  newCodeTextRef.current  = config?.newCodeMessage?.trim()  || DEFAULT_NEW_CODE_MESSAGE;

  const repeatMs = config?.repeatInterval && config.repeatInterval > 0
    ? config.repeatInterval * 1000
    : null;

  /**
   * Core speak function.
   * priority=true  → cancels whatever is playing (used for new-code message)
   * priority=false → silently skipped if something is already playing
   */
  function speak(text: string, priority: boolean) {
    if (!speechSupported || !unlockedRef.current) return;
    if (!priority && isSpeakingRef.current) return; // skip repeats while busy

    window.speechSynthesis.cancel();
    isSpeakingRef.current = false;

    const u = new SpeechSynthesisUtterance(text);
    u.lang  = "es-ES";
    u.rate  = 0.95;
    u.pitch = 1;
    u.onstart = () => { isSpeakingRef.current = true; };
    u.onend   = () => { isSpeakingRef.current = false; };
    u.onerror = () => { isSpeakingRef.current = false; };
    window.speechSynthesis.speak(u);
  }

  /** Called when we need to unlock + speak simultaneously */
  function unlockAndSpeak(text: string) {
    if (!speechSupported) return;
    unlockedRef.current = true;
    setNeedsUnlock(false);
    window.speechSynthesis.cancel();
    isSpeakingRef.current = false;

    const u = new SpeechSynthesisUtterance(text);
    u.lang  = "es-ES";
    u.rate  = 0.95;
    u.pitch = 1;
    let started = false;
    u.onstart = () => { started = true; isSpeakingRef.current = true; };
    u.onend   = () => { isSpeakingRef.current = false; };
    u.onerror = () => {
      isSpeakingRef.current = false;
      if (!started) setNeedsUnlock(true);
    };
    window.speechSynthesis.speak(u);
    setTimeout(() => { if (!started) setNeedsUnlock(true); }, 400);
  }

  /** Public: manually unlock when user taps the banner */
  function unlockAudio() {
    unlockAndSpeak(welcomeTextRef.current);
  }

  // ── FIRST INTERACTION LISTENER ──────────────────────────────────────────────
  // Welcome message is ONLY spoken after the first user interaction (touch /
  // click / mousemove / pointerdown).  NOT on page load.
  useEffect(() => {
    if (!speechSupported) return;

    function handleFirstInteraction() {
      if (hasInteractedRef.current) return;
      hasInteractedRef.current = true;

      document.removeEventListener("touchstart",  handleFirstInteraction);
      document.removeEventListener("click",        handleFirstInteraction);
      document.removeEventListener("mousemove",    handleFirstInteraction);
      document.removeEventListener("pointerdown",  handleFirstInteraction);

      if (!unlockedRef.current) {
        unlockAndSpeak(welcomeTextRef.current); // first time: also unlock audio
      } else {
        speak(welcomeTextRef.current, false);
      }
    }

    document.addEventListener("touchstart",  handleFirstInteraction, { passive: true });
    document.addEventListener("click",        handleFirstInteraction);
    document.addEventListener("mousemove",    handleFirstInteraction, { passive: true });
    document.addEventListener("pointerdown",  handleFirstInteraction, { passive: true });

    return () => {
      document.removeEventListener("touchstart",  handleFirstInteraction);
      document.removeEventListener("click",        handleFirstInteraction);
      document.removeEventListener("mousemove",    handleFirstInteraction);
      document.removeEventListener("pointerdown",  handleFirstInteraction);
    };
  }, []); // mount only — intentional

  // ── UNLOCK BANNER LISTENERS ─────────────────────────────────────────────────
  // If the browser blocks audio (mobile autoplay policy), show a banner.
  // Any interaction on the banner → unlock.
  useEffect(() => {
    if (!needsUnlock || !speechSupported) return;
    const handler = () => unlockAudio();
    document.addEventListener("touchstart",  handler, { once: true, passive: true });
    document.addEventListener("click",        handler, { once: true });
    document.addEventListener("mousemove",    handler, { once: true, passive: true });
    document.addEventListener("pointerdown",  handler, { once: true, passive: true });
    return () => {
      document.removeEventListener("touchstart",  handler);
      document.removeEventListener("click",        handler);
      document.removeEventListener("mousemove",    handler);
      document.removeEventListener("pointerdown",  handler);
    };
  }, [needsUnlock]);

  // ── NEW CODE DETECTOR ────────────────────────────────────────────────────────
  // Plays the new-code message with PRIORITY (cancels welcome/repeat if playing).
  useEffect(() => {
    if (codes.length === 0) return;
    const topCode = codes[0];

    // Initialize on first code list (no message on first load)
    if (prevTopIdRef.current === null) {
      prevTopIdRef.current = topCode.id;
      return;
    }

    if (topCode.id !== prevTopIdRef.current) {
      prevTopIdRef.current = topCode.id;
      // Only speak if user has already interacted and code is not expired
      if (hasInteractedRef.current && !isExpired(topCode.receivedAt)) {
        speak(newCodeTextRef.current, true); // priority = true
      }
    }
  }, [codes]);

  // ── REPEAT WELCOME ───────────────────────────────────────────────────────────
  // Repeats welcome message every N seconds.
  // Skipped silently if the new-code message is currently playing.
  useEffect(() => {
    if (!repeatMs) return;

    const interval = setInterval(() => {
      if (hasInteractedRef.current) {
        speak(welcomeTextRef.current, false); // no priority = skip if busy
      }
    }, repeatMs);

    return () => clearInterval(interval);
  }, [repeatMs]);

  return { needsUnlock, unlockAudio };
}
