import { useCallback, useEffect, useRef, useState } from "react";
import type { NetflixCode } from "@workspace/api-client-react";

const WELCOME_MESSAGE =
  "Elige el código que sea los datos de tu dispositivo y tu perfil y ponlo en tu dispositivo para seguir disfrutando de Netflix";

const MESSAGE =
  "Llegó un código nuevo, verifica que sean los datos de tu dispositivo y tu perfil y ponlo en tu dispositivo para seguir disfrutando de Netflix";

const CODE_TTL_MS = 15 * 60 * 1000;

const speechSupported =
  typeof window !== "undefined" && "speechSynthesis" in window;

function isExpired(receivedAt: string): boolean {
  return Date.now() - new Date(receivedAt).getTime() > CODE_TTL_MS;
}

function rawSpeak(text: string) {
  if (!speechSupported) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-ES";
  utterance.rate = 0.95;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

export function useSpeechNotification(codes: NetflixCode[]) {
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const unlockedRef = useRef(false);
  const prevTopIdRef = useRef<string | null>(null);
  const isFirstLoadRef = useRef(true);
  const pendingMsgRef = useRef<string | null>(null);

  const tryAutoSpeak = useCallback((text: string) => {
    if (!speechSupported) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-ES";
    utterance.rate = 0.95;
    utterance.pitch = 1;

    let started = false;

    utterance.onstart = () => {
      started = true;
      unlockedRef.current = true;
      setNeedsUnlock(false);
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);

    // Mobile browsers silently block auto-speak — detect it after 1.5s
    setTimeout(() => {
      if (!started && !unlockedRef.current) {
        window.speechSynthesis.cancel();
        pendingMsgRef.current = text;
        setNeedsUnlock(true);
      }
    }, 1500);
  }, []);

  useEffect(() => {
    if (codes.length === 0) return;

    const topCode = codes[0];

    if (isFirstLoadRef.current) {
      prevTopIdRef.current = topCode.id;
      isFirstLoadRef.current = false;
      tryAutoSpeak(WELCOME_MESSAGE);
      return;
    }

    if (topCode.id !== prevTopIdRef.current) {
      prevTopIdRef.current = topCode.id;
      if (!isExpired(topCode.receivedAt)) {
        if (unlockedRef.current) {
          rawSpeak(MESSAGE);
        } else {
          pendingMsgRef.current = MESSAGE;
          setNeedsUnlock(true);
        }
      }
    }
  }, [codes, tryAutoSpeak]);

  const unlock = useCallback(() => {
    unlockedRef.current = true;
    setNeedsUnlock(false);
    const msg = pendingMsgRef.current ?? WELCOME_MESSAGE;
    pendingMsgRef.current = null;
    rawSpeak(msg);
  }, []);

  return { needsUnlock: speechSupported && needsUnlock, unlock };
}
