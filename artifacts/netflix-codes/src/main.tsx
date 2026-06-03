import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";

const API_BASE_URL = "https://netflix-codes-api.onrender.com";
setBaseUrl(API_BASE_URL);

createRoot(document.getElementById("root")!).render(<App />);
