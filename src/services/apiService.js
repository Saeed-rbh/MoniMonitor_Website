import { apiUrl } from "../config/api";

const API_URL = apiUrl("/MoniMonitor_ToDB");

export const GetDataFromDB = async () => {
    try {
        const token = localStorage.getItem("token");
        if (!token) return [];

        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ status: "read" })
        });

        if (!response.ok) {
            console.error("Failed to fetch data", response.status);
            return [];
        }

        return await response.json();
    } catch (error) {
        console.error("Error fetching data:", error);
        return [];
    }
};

export const GetSummary = async () => {
    try {
        const token = localStorage.getItem("token");
        if (!token) return null;

        const response = await fetch(apiUrl("/summary"), {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });

        if (!response.ok) {
            console.error("Failed to fetch summary data", response.status);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error("Error fetching summary:", error);
        return null;
    }
};

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
            return { status: "error", message: "Failed to update transaction" };
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
            return { status: "error", message: "Failed to delete transaction" };
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
            return { status: "error", message: "Failed to save" };
        }

        return await response.json();
    } catch (error) {
        console.error("Error saving data:", error);
        return { status: "error", message: error.message };
    }
};

export const getSettingsAPI = async () => {
    const token = localStorage.getItem("token");
    if (!token) return null;
    const response = await fetch(apiUrl("/settings"), { headers: { Authorization: `Bearer ${token}` } });
    return response.ok ? response.json() : null;
};

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

export const getBudgetsAPI = async (month) => {
    const token = localStorage.getItem("token");
    if (!token) return [];
    const response = await fetch(apiUrl(`/budgets?month=${encodeURIComponent(month)}`), { headers: { Authorization: `Bearer ${token}` } });
    return response.ok ? response.json() : [];
};

export const saveBudgetAPI = async (budget) => {
    const token = localStorage.getItem("token");
    if (!token) return null;
    const response = await fetch(apiUrl("/budgets"), { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(budget) });
    return response.ok ? response.json() : null;
};

export const getGoalsAPI = async () => {
    const token = localStorage.getItem("token");
    if (!token) return [];
    const response = await fetch(apiUrl("/goals"), { headers: { Authorization: `Bearer ${token}` } });
    return response.ok ? response.json() : [];
};

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
    if (!response.ok) return null;
    return response.status === 204 ? true : response.json();
};

export const getPortfolioAPI = () => portfolioRequest();

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
