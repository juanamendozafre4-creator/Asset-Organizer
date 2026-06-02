export function getAdminToken() {
  return localStorage.getItem("admin_token");
}

export function getAdminEmail(): string | null {
  const token = getAdminToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return (payload as { email?: string }).email ?? null;
  } catch {
    return null;
  }
}

export function setAdminToken(token: string) {
  localStorage.setItem("admin_token", token);
}

export function removeAdminToken() {
  localStorage.removeItem("admin_token");
}

export function getAdminHeaders(): Record<string, string> {
  const token = getAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : { Authorization: "" };
}
