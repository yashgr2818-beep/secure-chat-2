import { createRoot } from "react-dom/client";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";
import App from "./App";
import "./index.css";

const savedApiUrl = localStorage.getItem("securechat_api_url");
const apiUrl = savedApiUrl || import.meta.env.VITE_API_URL;
if (apiUrl) {
  setBaseUrl(apiUrl);
}

// Ensure all authenticated API requests carry the bearer JWT token
setAuthTokenGetter(getToken);

createRoot(document.getElementById("root")!).render(<App />);

