import { QueryClient } from "@tanstack/react-query";
import { getToken } from "./auth";

export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10000 } } });

// Patch global fetch to inject Authorization header for all /api requests
const origFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  if (url.includes("/api/")) {
    const token = getToken();
    if (token) {
      init = { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } };
    }
  }
  return origFetch(input, init);
};