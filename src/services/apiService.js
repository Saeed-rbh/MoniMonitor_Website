import { apiUrl } from "../config/api";

const API_URL = apiUrl("/MoniMonitor_ToDB");

const handleExpiredSession = (response) => {
    if (response.status !== 401 || typeof window === "undefined") return false;

    localStorage.removeItem("token");
    localStorage.removeItem("username");
    localStorage.removeItem("userId");
    localStorage.removeItem("profilePhotoUrl");
    localStorage.removeItem("joinedAt");

    // Telegram's in-app browser keeps its own storage. Returning to the login
    // route lets LoginPage exchange fresh Telegram initData for a new token.
    if (window.location.pathname !== "/login") window.location.replace("/login");
    return true;
};

export const readFinancialData = async (path, options = {}) => {
    const token = localStorage.getItem('token');
    if (!token) throw new Error('Please sign in to load your financial data.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch(apiUrl(path), {
            ...options, signal: controller.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers },
        });
        if (!response.ok) {
            handleExpiredSession(response);
            throw Object.assign(new Error(response.status === 401 ? 'Your session expired. Please sign in again.' : 'Could not refresh financial data. Please try again.'), { status: response.status });
        }
        return await response.json();
    } finally { clearTimeout(timer); }
};

export const GetDataFromDB = async () => {
    const data = await readFinancialData('/MoniMonitor_ToDB', { method: 'POST', body: JSON.stringify({ status: 'read' }) });
    if (!Array.isArray(data)) throw new Error('The server returned invalid transaction data. Please retry.');
    return data;
};

export const GetSummary = (currency) => readFinancialData(`/summary${currency ? '?currency=' + encodeURIComponent(currency) : ''}`);

export const updateTransactionAPI = async (id, updates) => {
    try {
        const token = localStorage.getItem("token");
        if (!token) return { status: "error", message: "Not authenticated" };

        const response = await fetch(apiUrl(`/transactions/${id}`), {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(updates)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            return { status: "error", message: error.error || "Failed to update transaction" };
        }

        return await response.json();
    } catch (error) {
        console.error("Error updating transaction:", error);
        return { status: "error", message: error.message };
    }
};

export const deleteTransactionAPI = async (id) => {
    try {
        const token = localStorage.getItem("token");
        if (!token) return { status: "error", message: "Not authenticated" };

        const response = await fetch(apiUrl(`/transactions/${id}`), {
            method: "DELETE",
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            return { status: "error", message: error.error || "Failed to delete transaction" };
        }

        return await response.json();
    } catch (error) {
        console.error("Error deleting transaction:", error);
        return { status: "error", message: error.message };
    }
};

export const sendDataToDB = async ({ record_entry, record_type }) => {
    try {
        const token = localStorage.getItem("token");
        if (!token) return { status: "error", message: "Not authenticated" };

        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                status: "record",
                record_entry,
                record_type
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            return { status: "error", message: error.error || "Failed to save" };
        }

        return await response.json();
    } catch (error) {
        console.error("Error saving data:", error);
        return { status: "error", message: error.message };
    }
};

export const getSettingsAPI = () => readFinancialData('/settings');

export const saveSettingsAPI = async (settings) => {
    const token = localStorage.getItem("token");
    if (!token) return null;
    const response = await fetch(apiUrl("/settings"), {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(settings),
    });
    return response.ok ? response.json() : null;
};

export const getBudgetsAPI = (month) => readFinancialData(`/budgets?month=${encodeURIComponent(month)}`);

export const saveBudgetAPI = async (budget) => {
    const token = localStorage.getItem("token");
    if (!token) return null;
    const response = await fetch(apiUrl("/budgets"), { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(budget) });
    return response.ok ? response.json() : null;
};

export const getGoalsAPI = () => readFinancialData('/goals');

export const createGoalAPI = async (goal) => {
    const token = localStorage.getItem("token");
    if (!token) return null;
    const response = await fetch(apiUrl("/goals"), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(goal) });
    return response.ok ? response.json() : null;
};

export const GetLabel = async ({ record_entry }) => {
    // Keep mock for OpenAI for now or update if backend has endpoint
    console.log("Mocking GetLabel for:", record_entry);
    return "Expense";
};

export const updateGoalAPI = async (id, updates) => {
    const token = localStorage.getItem("token");
    if (!token) return null;
    const response = await fetch(apiUrl(`/goals/${id}`), { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(updates) });
    return response.ok ? response.json() : null;
};

export const deleteGoalAPI = async (id) => {
    const token = localStorage.getItem("token");
    if (!token) return false;
    const response = await fetch(apiUrl(`/goals/${id}`), { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    return response.ok;
};
const portfolioRequest = async (path = '', options = {}) => {
    const token = localStorage.getItem('token');
    if (!token) return null;
    const response = await fetch(apiUrl(`/portfolio${path}`), {
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            Authorization: `Bearer ${token}`,
            ...options.headers,
        },
    });
    if (!response.ok) {
        handleExpiredSession(response);
        return null;
    }
    return response.status === 204 ? true : response.json();
};

export const getPortfolioAPI = async () => {
    const data = await readFinancialData('/portfolio');
    if (!data || !Array.isArray(data.accounts) || !Array.isArray(data.totalsByCurrency)) throw new Error('The server returned invalid account data.');
    return data;
};

export const createInvestmentAccountAPI = (account) => portfolioRequest('/accounts', {
    method: 'POST',
    body: JSON.stringify(account),
});

export const updateInvestmentAccountAPI = (id, updates) => portfolioRequest(`/accounts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
});

export const deleteInvestmentAccountAPI = (id) => portfolioRequest(`/accounts/${id}`, {
    method: 'DELETE',
});

export const saveInvestmentHoldingAPI = (accountId, holding) => portfolioRequest(`/accounts/${accountId}/holdings`, {
    method: 'PUT',
    body: JSON.stringify(holding),
});

export const deleteInvestmentHoldingAPI = (accountId, holdingId) => portfolioRequest(
    `/accounts/${accountId}/holdings/${holdingId}`,
    { method: 'DELETE' },
);

export const getEmailStatusAPI = async () => {
    try { return await readFinancialData('/email/status'); }
    catch (error) {
        if (error.status === 403) return { status: 'not_linked' };
        throw error;
    }
};
