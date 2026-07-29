const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL
    ?? (import.meta.env.PROD ? "/api" : "http://localhost:3001");

export const API_BASE_URL = configuredBaseUrl.replace(/\/$/, "");

export const apiUrl = (path) => `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;

export default apiUrl;
