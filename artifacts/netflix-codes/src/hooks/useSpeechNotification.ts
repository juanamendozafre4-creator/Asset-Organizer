import { useEffect, useRef, useState } from "react";
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

function speak(text: string) {
  if (!speechSupported) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-ES";
  utterance.rate = 0.95;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

export function useSpeechNotification(codes: NetflixCode[]) {
  const prevTopIdRef = useRef<string | null>(null);
  const isFirstLoadRef = useRef(true);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const pendingCodesRef = useRef<NetflixCode[]>([]);

  function unlockAudio() {
    if (!speechSupported) return;
    // Play a silent utterance to unlock the audio context on mobile
    window.speechSynthesis.cancel();
    const silent = new SpeechSynthesisUtterance(" ");
    silent.volume = 0;
    window.speechSynthesis.speak(silent);
    setAudioUnlocked(true);
    // If codes were already loaded before unlock, speak welcome now
    if (pendingCodesRef.current.length > 0) {
      speak(WELCOME_MESSAGE);
    }
  }

  useEffect(() => {
    if (codes.length === 0) return;

    const topCode = codes[0];

    if (isFirstLoadRef.current) {
      prevTopIdRef.current = topCode.id;
      isFirstLoadRef.current = false;
      if (audioUnlocked) {
        speak(WELCOME_MESSAGE);
      } else {
        // Save for when user taps unlock
        pendingCodesRef.current = codes;
      }
      return;
    }

    if (topCode.id !== prevTopIdRef.current) {
      prevTopIdRef.current = topCode.id;
      if (!isExpired(topCode.receivedAt) && audioUnlocked) {
        speak(MESSAGE);
      }
    }
  }, [codes, audioUnlocked]);

  return { audioUnlocked, unlockAudio };
}
