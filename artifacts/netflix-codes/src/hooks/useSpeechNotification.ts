import { useEffect, useRef } from "react";
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

  useEffect(() => {
    if (codes.length === 0) return;

    const topCode = codes[0];

    if (isFirstLoadRef.current) {
      prevTopIdRef.current = topCode.id;
      isFirstLoadRef.current = false;
      speak(WELCOME_MESSAGE);
      return;
    }

    if (topCode.id !== prevTopIdRef.current) {
      prevTopIdRef.current = topCode.id;
      if (!isExpired(topCode.receivedAt)) {
        speak(MESSAGE);
      }
    }
  }, [codes]);
}
