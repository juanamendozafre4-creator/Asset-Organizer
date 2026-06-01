import { useState, useEffect } from "react";

export function getAdminToken() {
  return localStorage.getItem("admin_token");
}

export function setAdminToken(token: string) {
  localStorage.setItem("admin_token", token);
}

export function removeAdminToken() {
  localStorage.removeItem("admin_token");
}

export function getAdminHeaders() {
  const token = getAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
